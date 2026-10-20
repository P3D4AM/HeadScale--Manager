"""مدیریت فایروال UFW — همیشه با حفظ دسترسی SSH (قاعده SSH اول اضافه می‌شود).

سیاست‌ها:
  * اگر ufw نصب نیست → از apt نصب می‌شود.
  * اگر فایروال دیگری (nftables/iptables) قواعد فعال دارد → فقط گزارش و «نیاز به اقدام»؛ دست نمی‌زنیم.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

from hem.core import hemlog
from hem.core.exec import HemExecError, run, which
from hem.i18n import fmt
from hem.system import packages

logger = hemlog.get("firewall")

_SSHD_CONFIG = Path("/etc/ssh/sshd_config")
_SSHD_CONFIG_D = Path("/etc/ssh/sshd_config.d")


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


def firewall_setup(ssh_port: int | None, derper_enabled: bool, dry_run: bool = False):
    """راه‌اندازی فایروال — «اول» SSH، بعد 80/443 (و 3478/udp در صورت DERP).

    Returns:
        (rules_added, problem) — اگر problem پر باشد، نیاز به اقدام کاربر است و چیزی تغییر نکرده است.
    """
    # اگر ufw نصب نیست، نصب می‌کنیم
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

    rules: list[tuple[int, str]] = [
        (int(ssh_port), "tcp", "SSH (hem)"),  # اولِ اول: SSH
        (80, "tcp", "HTTP caddy (hem)"),
        (443, "tcp", "HTTPS caddy (hem)"),
    ]
    if derper_enabled:
        rules.append((3478, "udp", "STUN embedded-DERP (hem)"))

    added: list[str] = []
    for port, proto, comment in rules:
        if ufw_allow(port, proto, comment, dry_run=dry_run):
            added.append(f"{port}/{proto}")

    if status == "inactive":
        ufw_enable(dry_run=dry_run)
    return added, None
