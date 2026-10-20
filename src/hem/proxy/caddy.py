"""مدیریت Caddy — نصب رسمی (FACTS §6)، بلوک سایت idempotent بین مارکرها، validate/reload.

بلوک سایت دقیقاً مطابق پیکربندی رسمی مستندات Headscale است (با تشخیص captive portal اندروید).
"""

from __future__ import annotations

import re
import shutil
import time
from pathlib import Path

from hem import constants as C
from hem.core import hemlog
from hem.core.exec import run, which
from hem.i18n import fmt
from hem.system import packages, services

logger = hemlog.get("caddy")

# بدنه بلوک — {domain} جایگزین می‌شود؛ بقیه آکولادها سینتکس خود Caddy هستند.
_BLOCK_BODY = """http://{domain} {
\t# پاسخ سریع برای تشخیص captive portal اندروید (generate_204)
\thandle /generate_204 {
\t\trespond 204
\t}

\thandle * {
\t\tredir https://{{host}}{{uri}}
\t}
}

{domain} {
\treverse_proxy 127.0.0.1:8080 {
\t\theader_up True-Client-IP {remote_host}
\t\theader_up X-Real-IP {remote_host}
\t}
}
"""


def build_site_block(domain: str) -> str:
    """ساخت بلوک کامل (با مارکرهای BEGIN/END) برای دامنه داده‌شده."""
    body = _BLOCK_BODY.replace("{{host}}", "{host}").replace("{{uri}}", "{uri}")
    body = body.replace("{domain}", domain)
    return f"{C.CADDY_BLOCK_BEGIN}\n{body}{C.CADDY_BLOCK_END}\n"


def _block_pattern() -> re.Pattern:
    """الگوی regex بلوک مارک‌دار — برای جایگزینی/حذف idempotent."""
    return re.compile(
        re.escape(C.CADDY_BLOCK_BEGIN) + r".*?" + re.escape(C.CADDY_BLOCK_END) + r"\n?",
        re.DOTALL,
    )


def get_caddyfile_path() -> str:
    """مسیر Caddyfile — پیش‌فرض /etc/caddy/Caddyfile؛ در صورت نبود، جست‌وجوی ساده."""
    default = Path(C.CADDYFILE_PATH)
    if default.exists() or default.parent.is_dir():
        return str(default)
    # تلاش برای یافتن از فرایند در حال اجرا
    try:
        res = run(["ps", "-o", "args=", "-C", "caddy"], check=False, timeout=15)
        match = re.search(r"--config\s+(\S+)", res.stdout)
        if match:
            return match.group(1)
    except Exception:  # noqa: BLE001 — ps در همه محیط‌ها نیست
        pass
    return str(default)


def has_site_block(caddyfile_path=None) -> bool:
    """آیا بلوک مارک‌دار ما در Caddyfile وجود دارد؟"""
    path = Path(caddyfile_path or get_caddyfile_path())
    if not path.exists():
        return False
    text = path.read_text(encoding="utf-8", errors="replace")
    return C.CADDY_BLOCK_BEGIN in text and C.CADDY_BLOCK_END in text


def extract_site_block(caddyfile_path=None) -> str | None:
    """متن بلوک مارک‌دار فعلی (برای manifest پشتیبان) — نبود یعنی None."""
    path = Path(caddyfile_path or get_caddyfile_path())
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    match = _block_pattern().search(text)
    return match.group(0) if match else None


def inject_site_block(domain: str, caddyfile_path=None, dry_run: bool = False) -> bool:
    """درج/جایگزینی بلوک سایت — idempotent.

    اگر بلوک قبلی بین مارکرها باشد جایگزین می‌شود؛ در غیر این صورت به انتهای فایل
    اضافه می‌شود. محتوای غیرمرتبط دست‌نخورده می‌ماند.
    """
    path = Path(caddyfile_path or get_caddyfile_path())
    block = build_site_block(domain)
    existing = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""

    if C.CADDY_BLOCK_BEGIN in existing and C.CADDY_BLOCK_END in existing:
        new_text = _block_pattern().sub(lambda _m: block, existing, count=1)
    elif existing.strip():
        new_text = existing.rstrip("\n") + "\n\n" + block
    else:
        new_text = block

    if new_text == existing:
        return False
    if dry_run:
        print(f"[dry-run] به‌روزرسانی بلوک headscale در {path}")
        return True
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding="utf-8")
    return True


def remove_site_block(caddyfile_path=None, dry_run: bool = False) -> str | None:
    """حذف بلوک مارک‌دار — متن حذف‌شده را برمی‌گرداند (یا None اگر بلوکی نبود)."""
    path = Path(caddyfile_path or get_caddyfile_path())
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    pattern = _block_pattern()
    match = pattern.search(text)
    if not match:
        return None
    removed = match.group(0)
    if dry_run:
        print(f"[dry-run] حذف بلوک headscale از {path}")
        return removed
    new_text = pattern.sub("", text)
    new_text = re.sub(r"\n{3,}", "\n\n", new_text)
    new_text = new_text.rstrip("\n") + ("\n" if new_text.strip() else "")
    path.write_text(new_text, encoding="utf-8")
    return removed


def restore_site_block(block_text: str, caddyfile_path=None, dry_run: bool = False) -> bool:
    """بازگرداندن بلوک ذخیره‌شده در پشتیبان (حذف بلوک فعلی + درج متن قدیمی)."""
    path = Path(caddyfile_path or get_caddyfile_path())
    remove_site_block(path, dry_run=dry_run)
    if dry_run:
        print(f"[dry-run] درج بلوک پشتیبان در {path}")
        return True
    existing = path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    block = block_text if block_text.endswith("\n") else block_text + "\n"
    new_text = (existing.rstrip("\n") + "\n\n" + block) if existing.strip() else block
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(new_text, encoding="utf-8")
    return True


def backup_caddyfile(caddyfile_path=None, dry_run: bool = False):
    """پشتیبان از Caddyfile — خروجی مسیر پشتیبان یا None."""
    path = Path(caddyfile_path or get_caddyfile_path())
    if not path.exists():
        return None
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup = path.with_name(path.name + f".hem-backup-{stamp}")
    if dry_run:
        print(f"[dry-run] پشتیبان‌گیری از {path} → {backup}")
        return backup
    shutil.copy2(path, backup)
    return backup


def caddy_installed() -> bool:
    """آیا Caddy نصب است؟"""
    return which("caddy") is not None or packages.dpkg_installed("caddy")


def caddy_active() -> bool:
    """آیا سرویس caddy فعال است؟"""
    return services.service_active(C.CADDY_UNIT)


def install_caddy(dry_run: bool = False) -> None:
    """نصب Caddy از مخزن رسمی — دقیقاً دستورات FACTS §6 (pipeها بدون شل اجرا می‌شوند)."""
    packages.apt_install(
        ["debian-keyring", "debian-archive-keyring", "apt-transport-https", "curl"],
        dry_run=dry_run,
    )
    # gpg.key → dearmor (معادل curl | gpg --dearmor -o …)
    key_res = run(["curl", "-1sLf", C.CADDY_GPG_KEY_URL], dry_run=dry_run, timeout=120)
    if dry_run:
        print(f"[dry-run] gpg --dearmor -o {C.CADDY_KEYRING_PATH}")
    else:
        run(
            ["gpg", "--dearmor", "-o", C.CADDY_KEYRING_PATH],
            input_bytes=key_res.stdout.encode("utf-8"),
            timeout=120,
        )
    # debian.deb.txt → sources.list.d (معادل curl | tee)
    repo_res = run(["curl", "-1sLf", C.CADDY_REPO_URL], dry_run=dry_run, timeout=120)
    if dry_run:
        print(f"[dry-run] نوشتن {C.CADDY_REPO_LIST_PATH}")
    else:
        Path(C.CADDY_REPO_LIST_PATH).write_text(repo_res.stdout, encoding="utf-8")
    packages.apt_update(dry_run=dry_run)
    packages.apt_install(["caddy"], dry_run=dry_run)


def validate_caddy(caddyfile=None, dry_run: bool = False) -> tuple[bool, str]:
    """اعتبارسنجی Caddyfile با «caddy validate»."""
    if which("caddy") is None:
        if dry_run:
            return True, "[dry-run] caddy هنوز نصب نیست؛ در اجرای واقعی نصب و اعتبارسنجی می‌شود."
        return False, fmt("command_missing", name="caddy")
    path = str(caddyfile or get_caddyfile_path())
    res = run(
        ["caddy", "validate", "--config", path],
        check=False, dry_run=dry_run, timeout=60,
    )
    output = (res.stdout + "\n" + res.stderr).strip()
    return res.returncode == 0, output


def reload_caddy(dry_run: bool = False) -> bool:
    """بارگذاری مجدد caddy (systemctl reload caddy)."""
    try:
        services.systemctl("reload", C.CADDY_UNIT, dry_run=dry_run)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error("reload کدی ناموفق بود: %s", exc)
        return False
