"""دانلود و نصب بسته رسمی headscale (.deb) با راستی‌آزمایی SHA-256."""

from __future__ import annotations

import hashlib
import re
import urllib.request
from pathlib import Path

from hem import __version__
from hem.core import hemlog
from hem.core.exec import HemExecError, run, which
from hem.headscale import releases
from hem.system import packages

logger = hemlog.get("hs-installer")


class HemDownloadError(RuntimeError):
    """خطای دانلود/راستی‌آزمایی — پیام فارسی."""


def sha256_file(path) -> str:
    """محاسبه SHA-256 یک فایل."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, dest, expected_sha256: str | None = None, chunk: int = 64 * 1024) -> Path:
    """دانلود فایل با نمایش پیشرفت و راستی‌آزمایی SHA-256 اختیاری."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": f"hem/{__version__}"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as out:
        total_raw = resp.headers.get("Content-Length")
        total = int(total_raw) if total_raw and total_raw.isdigit() else None
        done = 0
        last_shown = -1
        while True:
            block = resp.read(chunk)
            if not block:
                break
            out.write(block)
            done += len(block)
            if total:
                percent = done * 100 // total
                if percent != last_shown and percent % 5 == 0:
                    print(f"  دانلود: {percent}٪ ({done // (1024 * 1024)} مگابایت)", end="\r", flush=True)
                    last_shown = percent
        print()
    if expected_sha256:
        actual = sha256_file(dest)
        if actual.lower() != str(expected_sha256).lower():
            dest.unlink(missing_ok=True)
            raise HemDownloadError(
                f"راستی‌آزمایی SHA-256 فایل دانلودشده ناموفق بود ({dest}). "
                "اتصال اینترنت را بررسی کنید و دوباره تلاش کنید."
            )
        print("  ✓ راستی‌آزمایی SHA-256 موفق بود.")
    return dest


def install_deb(deb_path, dry_run: bool = False):
    """نصب فایل deb از طریق apt."""
    return packages.apt_install_local(deb_path, dry_run=dry_run)


def is_installed() -> bool:
    """آیا باینری headscale موجود است؟"""
    return which("headscale") is not None


def current_version() -> str | None:
    """نسخه نصب‌شده headscale از خروجی «headscale version» — نبودِ باینری یعنی None."""
    if not is_installed():
        return None
    try:
        res = run(["headscale", "version"], check=False, timeout=30)
    except HemExecError:
        return None
    match = re.search(r"v?(\d+\.\d+\.\d+)", res.stdout)
    return match.group(1) if match else None


def uninstall_deb(purge: bool = False, dry_run: bool = False):
    """حذف (یا purge) بسته headscale."""
    return packages.apt_remove(["headscale"], purge=purge, dry_run=dry_run)


def resolve_target_version(requested: str | None = None) -> tuple[str, str | None]:
    """تعیین نسخه هدف نصب.

    Returns:
        (نسخه، sha256 یا None) — اگر sha256 در دسترس نباشد None است.
    """
    if requested:
        version = releases.normalize_version(requested)
        source = "درخواست کاربر"
    else:
        version, from_network = releases.latest_version()
        source = "آخرین نسخه پایدار GitHub" if from_network else "نسخه پین‌شده (بدون دسترسی شبکه)"
    print(f"  نسخه هدف: {version} — منبع: {source}")
    sha256 = releases.checksum_for(version, _arch())
    if sha256 is None:
        logger.warning("checksum نسخه %s در دسترس نیست", version)
    return version, sha256


def _arch() -> str:
    """نقشه معماری پلتفرم → نام معماری بسته (x86_64→amd64، aarch64→arm64)."""
    import platform

    machine = platform.machine().lower()
    return {"x86_64": "amd64", "aarch64": "arm64"}.get(machine, machine)
