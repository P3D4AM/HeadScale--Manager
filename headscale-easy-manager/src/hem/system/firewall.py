"""مدیریت فایروال UFW — همیشه با حفظ دسترسی SSH (قاعده SSH اول اضافه می‌شود).

سیاست‌ها:
  * اگر ufw نصب نیست → از apt نصب می‌شود.
  * اگر فایروال دیگری (nftables/iptables) قواعد فعال دارد → فقط گزارش و «نیاز به اقدام»؛ دست نمی‌زنیم.

اصلاح ۴.۶:
  * قبل از هر تغییری، تصویر وضعیت («ufw status verbose» + «ss -tulpn») هم در
    state (کلید firewall_snapshot) و هم در فایل پشتیبان زمان‌دار ۰۶۰۰ ذخیره
    می‌شود (BACKUP_DIR/firewall → LOG_DIR/firewall → /tmp).
  * پورت‌های در حال شنیدن با فرایند مالک شمرده می‌شوند؛ سرویس بیرونیِ ناشناس
    بدون رضایت صریح قطع نمی‌شود: تعاملی → انتخاب ادامه/لغو (پیش‌فرض لغو)،
    غیرتعاملی → توقف کامل (NeedsActionError).
  * نتیجهٔ «ufw --force enable» بررسی می‌شود؛ شکست → NeedsActionError (نه موفقیت).
  * firewall_rollback فقط کارهای خود همین اجرا را برمی‌گرداند (قواعد افزودهٔ
    خودمان + غیرفعال‌کردن ufw اگر خودمان فعالش کرده بودیم).
"""

from __future__ import annotations

import os
import re
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from hem import constants as C
from hem.core import hemlog
from hem.core.exec import HemExecError, run, which
from hem.core.prompts import NonInteractiveError, PromptError, is_non_interactive, select
from hem.core.runner import NeedsActionError
from hem.i18n import fmt
from hem.system import packages

logger = hemlog.get("firewall")

_SSHD_CONFIG = Path("/etc/ssh/sshd_config")
_SSHD_CONFIG_D = Path("/etc/ssh/sshd_config.d")

# پورت‌های شناخته‌شدهٔ خودِ ابزار/سرور — این‌ها هشدار/رضایت نمی‌گیرند
# (پورت SSH جداگانه از پارامتر بررسی می‌شود).
_ALLOWED_PORTS = {80, 443, 3478, 8080, 9090, 50443}


def detect_ssh_port() -> int | None:
    """تشخیص پورت SSH فعلی — به‌ترتیب: SSH_CONNECTION ← ss ← sshd_config (پیش‌فرض ۲۲)."""
    # ۱) نشست جاری
    parts = os.environ.get("SSH_CONNECTION", "").split()
    if len(parts) >= 4 and parts[3].isdigit():
        return int(parts[3])

    # ۲) سوکت‌های شنیده‌شدهٔ sshd
    try:
        res = run(["ss", "-tlnp"], check=False, timeout=15)
        ports = set()
        for line in res.stdout.splitlines():
            if "sshd" not in line:
                continue
            fields = line.split()
            if len(fields) < 5:
                continue
            match = re.search(r":(\d+)$", fields[3])
            if match:
                ports.add(int(match.group(1)))
        if len(ports) == 1:
            return ports.pop()
        if len(ports) > 1:
            logger.warning("چند پورت sshd دیده شد: %s — از sshd_config استفاده می‌شود", sorted(ports))
    except HemExecError:
        pass

    # ۳) پیکربندی sshd (فایل اصلی + پوشه drop-in)
    config_files = [_SSHD_CONFIG]
    if _SSHD_CONFIG_D.is_dir():
        config_files.extend(sorted(_SSHD_CONFIG_D.glob("*.conf")))
    last_port: str | None = None
    for cfg in config_files:
        try:
            for line in cfg.read_text(encoding="utf-8", errors="replace").splitlines():
                match = re.match(r"^\s*Port\s+(\d+)\s*$", line)
                if match:
                    last_port = match.group(1)
        except OSError:
            continue
    if last_port:
        return int(last_port)

    # ۴) پیش‌فرض OpenSSH
    return 22


def ufw_status() -> str:
    """وضعیت ufw: 'active' | 'inactive' | 'not-installed'."""
    if which("ufw") is None:
        return "not-installed"
    try:
        res = run(["ufw", "status"], check=False, timeout=30)
    except HemExecError:
        return "not-installed"
    return "active" if "Status: active" in res.stdout else "inactive"


def ufw_status_verbose() -> str:
    """متن کامل وضعیت ufw (برای گزارش)."""
    if which("ufw") is None:
        return fmt("not_installed")
    try:
        return run(["ufw", "status", "verbose"], check=False, timeout=30).stdout.strip()
    except HemExecError as exc:
        return str(exc)


def ufw_allow(port: int, proto: str = "tcp", comment: str = "hem", dry_run: bool = False) -> bool:
    """افزودن قاعده مجاز به ufw."""
    cmd = ["ufw", "allow", f"{port}/{proto}"]
    if comment:
        cmd += ["comment", comment]
    try:
        run(cmd, dry_run=dry_run, timeout=60)
        return True
    except HemExecError as exc:
        print(fmt("ufw_allow_failed", port=f"{port}/{proto}", error=exc))
        return False


def ufw_delete(spec: str, dry_run: bool = False) -> bool:
    """حذف قاعده ufw (مثلاً spec=«22/tcp») — برای uninstall."""
    try:
        res = run(["ufw", "delete", "allow", spec], check=False, dry_run=dry_run, timeout=60)
        return res.returncode == 0
    except HemExecError:
        return False


def ufw_enable(dry_run: bool = False) -> bool:
    """فعال‌سازی ufw (--force برای بدون پرسش)."""
    try:
        run(["ufw", "--force", "enable"], dry_run=dry_run, timeout=120)
        return True
    except HemExecError as exc:
        logger.error("فعال‌سازی ufw ناموفق بود: %s", exc)
        return False


def ufw_disable(dry_run: bool = False) -> bool:
    """غیرفعال‌سازی ufw (--force) — فقط برای rollback کارهای خودمان."""
    try:
        run(["ufw", "--force", "disable"], dry_run=dry_run, timeout=120)
        return True
    except HemExecError as exc:
        logger.error("غیرفعال‌سازی ufw ناموفق بود: %s", exc)
        return False


# --- تصویر وضعیت و شمارش سرویس‌های شنیده‌شده (اصلاح ۴.۶) ---------------------

@dataclass
class Listener:
    """یک سوکت در حال شنیدن با فرایند مالک."""

    proto: str  # tcp | udp
    port: int
    bind: str  # آدرس اتصال (قبل از آخرین «:») — خالی/«*» یعنی همهٔ رابط‌ها
    process: str  # نام فرایند مالک (اگر قابل تشخیص نبود، خالی)


def _snapshot_text() -> tuple[str, str]:
    """گرفتن متن «ufw status verbose» و «ss -tulpn» — فرمان‌های خواندنِ خالص."""
    ufw_text = ufw_status_verbose()
    try:
        ss_text = run(["ss", "-tulpn"], check=False, timeout=30).stdout.strip()
    except HemExecError as exc:
        ss_text = f"(ss در دسترس نبود: {exc})"
    return ufw_text, ss_text


def _save_snapshot_file(ufw_text: str, ss_text: str) -> Path | None:
    """ذخیرهٔ تصویر وضعیت در فایل زمان‌دار ۰۶۰۰.

    ترتیب تلاش: BACKUP_DIR/firewall → LOG_DIR/firewall → tmp — برای محیط‌های
    بدون root (تست) مسیر قابل‌نوشتن پیدا می‌شود؛ در شکست کامل، None.
    """
    stamp = time.strftime("%Y%m%d-%H%M%S")
    content = (
        f"# HEM firewall snapshot — {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        "# تصویر وضعیت «قبل از» هر تغییر فایروال (اصلاح ۴.۶)\n"
        "\n## ufw status verbose\n" + (ufw_text or "") + "\n"
        "\n## ss -tulpn\n" + (ss_text or "") + "\n"
    )
    bases = [
        Path(C.BACKUP_DIR) / "firewall",
        Path(C.LOG_DIR) / "firewall",
        Path(tempfile.gettempdir()) / "hem-firewall",
    ]
    for base in bases:
        try:
            base.mkdir(parents=True, exist_ok=True)
            path = base / f"firewall-snapshot-{stamp}.txt"
            counter = 2
            while path.exists():  # چند snapshot در یک ثانیه
                path = base / f"firewall-snapshot-{stamp}-{counter}.txt"
                counter += 1
            path.write_text(content, encoding="utf-8")
            os.chmod(path, 0o600)
            return path
        except OSError:
            continue
    return None


def parse_ss_listeners(ss_text: str) -> list[Listener]:
    """پارس خروجی «ss -tulpn» به اتصال‌های در حال شنیدن با فرایند مالک."""
    listeners: list[Listener] = []
    for line in (ss_text or "").splitlines():
        fields = line.split()
        if len(fields) < 5:
            continue
        proto = fields[0].lower()
        state = fields[1].upper() if len(fields) > 1 else ""
        # tcp: فقط LISTEN — udp: سوکت‌های UNCONN (نسخه‌های ss وضعیت خالی هم می‌دهند)
        if proto.startswith("tcp") and state != "LISTEN":
            continue
        if proto.startswith("udp") and state not in ("UNCONN", ""):
            continue
        local = fields[4]
        match = re.search(r":(\d+)$", local)
        if not match:
            continue
        bind = local[: match.start()].strip("[]")
        proc = re.search(r'users:\(\("([^"]+)"', line)
        listeners.append(
            Listener(proto.split(":")[0], int(match.group(1)), bind,
                     proc.group(1) if proc else "")
        )
    return listeners


def _is_loopback_bind(bind: str) -> bool:
    """آیا سوکت فقط روی loopback است؟ (از بیرون قابل دسترسی نیست)"""
    b = bind.strip().strip("[]")
    if b in ("::1", "localhost") or b.startswith("127."):
        return True
    return False


def risky_listeners(listeners: list[Listener], ssh_port: int | None) -> list[Listener]:
    """شنونده‌های غیرمجازِ غیر-loopback — با فعال‌شدن UFW از بیرون قطع می‌شوند.

    مستثنا: پورت SSH، پورت‌های شناخته‌شدهٔ ابزار (80/443/3478/8080/9090/50443)
    و هر سرویسی که فقط روی loopback گوش می‌دهد.
    """
    allowed = set(_ALLOWED_PORTS)
    if ssh_port:
        allowed.add(int(ssh_port))
    out = []
    for ln in listeners:
        if ln.port in allowed:
            continue
        if _is_loopback_bind(ln.bind):
            continue
        out.append(ln)
    return out


def _state_append(state: dict, key: str, value) -> None:
    """افزودن به لیستِ داخل state بدون تکرار (هم‌ارز append_unique در flow)."""
    lst = state.setdefault(key, [])
    if value not in lst:
        lst.append(value)


def firewall_setup(ssh_port: int | None, derper_enabled: bool, dry_run: bool = False,
                   state: dict | None = None):
    """راه‌اندازی فایروال — «اول» SSH، بعد 80/443 (و 3478/udp در صورت DERP).

    اصلاح ۴.۶ — قبل از هر تغییری تصویر وضعیت ذخیره می‌شود؛ سرویس‌های شنیده‌شدهٔ
    بیرونیِ ناشناس بدون رضایت صریح قطع نمی‌شوند (تعاملی: انتخاب ادامه/لغو با
    پیش‌فرض لغو — غیرتعاملی: توقف کامل)؛ شکست فعال‌سازی → NeedsActionError.

    Args:
        ssh_port: پورت SSH (الزامی برای فعال‌سازی امن).
        derper_enabled: افزودن 3478/udp برای embedded-DERP.
        dry_run: فقط برنامه‌ریزی.
        state: دیکشنری state ابزار (ثبت firewall_snapshot و قواعد افزوده).

    Returns:
        (rules_added, problem) — اگر problem پر باشد، نیاز به اقدام کاربر است.
    """
    # ۱) تصویر وضعیت قبل از هر تغییری (فرمان‌های خواندن خالص — حتی در dry-run واقعی)
    ufw_text, ss_text = _snapshot_text()
    snapshot = {
        "captured_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "ufw_status_verbose": ufw_text,
        "ss_tulpn": ss_text,
    }
    snapshot_path = _save_snapshot_file(ufw_text, ss_text)
    if snapshot_path is not None:
        snapshot["file"] = str(snapshot_path)
        print("  " + fmt("firewall_snapshot_saved", path=snapshot_path))
    else:
        print(f"  ⚠ {fmt('firewall_snapshot_state_only')}")
    if state is not None:
        state["firewall_snapshot"] = snapshot

    # ۲) اگر ufw نصب نیست، نصب می‌کنیم (فعال‌سازی نمی‌کند — قواعد تغییر نمی‌کنند)
    if which("ufw") is None:
        print("ufw نصب نیست؛ در حال نصب از apt …")
        packages.apt_install(["ufw"], dry_run=dry_run)
        if not dry_run and which("ufw") is None:
            return [], fmt("ufw_install_failed")

    status = ufw_status()
    if status == "not-installed":
        if dry_run:
            status = "inactive"  # در اجرای واقعی، نصب و سپس فعال می‌شود
        else:
            return [], fmt("ufw_install_failed")

    # فایروال دیگری فعال است → دست نمی‌زنیم
    if status == "inactive" and other_firewall_rules_present():
        return [], fmt("other_firewall_active")

    # بدون پورت SSH مطمئن، فعال‌سازی ufw خطر قفل‌شدن سرور دارد
    if ssh_port is None or not (1 <= int(ssh_port) <= 65535):
        return [], fmt("ssh_port_unknown")

    # ۳) شمارش سرویس‌های شنیده‌شده و رضایت صریح (اصلاح ۴.۶)
    risky = risky_listeners(parse_ss_listeners(ss_text), ssh_port)
    for ln in risky:
        print(
            "  ⚠ " + fmt(
                "firewall_risky_listener",
                process=ln.process or "فرایند نامشخص",
                port=f"{ln.port}/{ln.proto}",
                bind=ln.bind or "*",
            )
        )
    if risky and status == "inactive" and not dry_run:
        # فعال‌کردن UFW این سرویس‌ها را از بیرون قطع می‌کند → رضایت صریح الزامی
        listing = "\n".join(
            f"    • {ln.process or 'فرایند نامشخص'} — پورت {ln.port}/{ln.proto} "
            f"(اتصال {ln.bind or '*'})"
            for ln in risky
        )
        if is_non_interactive():
            # هرگز سرویسی را بی‌صدا قطع نمی‌کنیم — توقف کامل
            raise NeedsActionError(fmt("firewall_consent_noninteractive") + "\n" + listing)
        print(fmt("firewall_consent_title"))
        print(listing)
        try:
            choice = select(
                "ادامه دهیم؟",
                [
                    ("cancel", "لغو — فایروال فعال نشود (پیش‌فرض)"),
                    ("continue", "ادامه — می‌دانم این سرویس‌ها از بیرون قطع می‌شوند"),
                ],
            )
        except (PromptError, NonInteractiveError):
            choice = "cancel"
        if choice != "continue":
            return [], fmt("firewall_consent_cancelled")

    # ۴) قواعد — اولِ اول: SSH
    rules: list[tuple[int, str]] = [
        (int(ssh_port), "tcp", "SSH (hem)"),
        (80, "tcp", "HTTP caddy (hem)"),
        (443, "tcp", "HTTPS caddy (hem)"),
    ]
    if derper_enabled:
        rules.append((3478, "udp", "STUN embedded-DERP (hem)"))

    added: list[str] = []
    for port, proto, comment in rules:
        if ufw_allow(port, proto, comment, dry_run=dry_run):
            added.append(f"{port}/{proto}")
            if state is not None:
                _state_append(state, "firewall_rules_added", f"{port}/{proto}")

    # ۵) فعال‌سازی با بررسی نتیجه (اصلاح ۴.۶ — نتیجه دیگر نادیده گرفته نمی‌شود)
    if status == "inactive":
        if not ufw_enable(dry_run=dry_run):
            raise NeedsActionError(fmt("ufw_enable_failed"))
        if state is not None:
            state["firewall_enabled_by_hem"] = True
            state["firewall_was_inactive_before"] = True
    return added, None


def firewall_rollback(state: dict | None, dry_run: bool = False) -> tuple[int, bool]:
    """بازگرداندن «فقط» کارهای فایروالِ خودِ ابزار (اصلاح ۴.۶).

    * قواعدی که خودمان افزوده‌ایم (firewall_rules_added در state) حذف می‌شوند.
    * اگر خودمان ufw را در همین اجرا فعال کرده باشیم (firewall_enabled_by_hem)،
      دوباره غیرفعال می‌شود.

    Returns:
        (تعداد قواعد حذف‌شده، آیا ufw غیرفعال شد)
    """
    state = state or {}
    rules = state.get("firewall_rules_added") or []
    removed = 0
    for rule in rules:
        if ufw_delete(rule, dry_run=dry_run):
            removed += 1
        else:
            logger.warning("حذف قاعده %s ناموفق بود", rule)
    disabled = False
    if state.get("firewall_enabled_by_hem"):
        disabled = ufw_disable(dry_run=dry_run)
    return removed, disabled


def other_firewall_rules_present() -> bool:
    """آیا فایروال دیگری (nftables/iptables) قواعد فعال دارد؟"""
    if which("nft") is not None:
        try:
            res = run(["nft", "list", "ruleset"], check=False, timeout=30)
            if res.returncode == 0 and "chain" in res.stdout:
                return True
        except HemExecError:
            pass
    if which("iptables") is not None:
        try:
            res = run(["iptables", "-S"], check=False, timeout=30)
            if res.returncode == 0 and "-A" in res.stdout:
                return True
        except HemExecError:
            pass
    return False
