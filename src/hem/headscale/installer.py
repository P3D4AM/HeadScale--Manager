"""دانلود و نصب بسته رسمی headscale (.deb) با راستی‌آزمایی «الزامی» SHA-256.

اصلاح ۴.۵: چک‌سام در همهٔ مسیرها (نصب تازه، ارتقا، dry-run، تعاملی و
غیرتعاملی) الزامی است؛ اگر SHA-256 رسمی برای نسخه+معماری دقیق به‌دست نیاید،
عملیات با NeedsActionError متوقف می‌شود — هیچ گزینهٔ عبوری وجود ندارد.
"""

from __future__ import annotations

import hashlib
import re
import urllib.request
from pathlib import Path

from hem import __version__
from hem import constants as C
from hem.core import hemlog
from hem.core.exec import HemExecError, run, which
from hem.core.runner import NeedsActionError
from hem.headscale import releases
from hem.i18n import fmt
from hem.system import packages

logger = hemlog.get("hs-installer")


class HemDownloadError(NeedsActionError):
    """خطای دانلود/راستی‌آزمایی — پیام فارسی؛ توقف امن (نیازمند اقدام کاربر)."""


_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def sha256_file(path) -> str:
    """محاسبه SHA-256 یک فایل."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, dest, expected_sha256: str | None = None, chunk: int = 64 * 1024) -> Path:
    """دانلود فایل با نمایش پیشرفت و راستی‌آزمایی «الزامی» SHA-256 (اصلاح ۴.۵).

    * expected_sha256 تهی یا نامعتبر → HemDownloadError «قبل از هر دانلودی».
    * ناهمخوانی هش → حذف فایل ناقص + HemDownloadError.
    * خطای میانهٔ دانلود → فایل ناقص پاک می‌شود و خطا منتشر می‌شود.
    خودِ فایل دانلودی هرگز منبع checksum خودش نیست.
    """
    dest = Path(dest)
    if not expected_sha256 or not _SHA256_RE.match(str(expected_sha256)):
        raise HemDownloadError(fmt("checksum_missing_expected"))
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": f"hem/{__version__}"})
    try:
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
    except Exception:
        # فایل ناقص/خراب نباید روی دیسک بماند (پاک‌سازی همیشه)
        dest.unlink(missing_ok=True)
        raise
    actual = sha256_file(dest)
    if actual.lower() != str(expected_sha256).lower():
        dest.unlink(missing_ok=True)
        raise HemDownloadError(fmt("checksum_mismatch", path=dest))
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


def mandatory_checksum(version: str, arch: str | None = None) -> str:
    """SHA-256 رسمی بستهٔ نسخه/معماری — «الزامی» (اصلاح ۴.۵).

    منبع: جدول پین‌شدهٔ constants (فقط نسخهٔ پین‌شده) یا checksums.txt رسمیِ
    همان انتشار. اگر هیچ‌کدام در دسترس نباشد → NeedsActionError با پیام فارسی
    (توقف امن؛ خودِ فایل دانلودی هرگز منبع checksum خودش نیست).
    """
    arch = arch or _arch()
    sha256 = releases.checksum_for(version, arch)
    if not sha256:
        raise NeedsActionError(
            fmt(
                "checksum_unresolvable",
                version=releases.normalize_version(version),
                arch=arch,
                pinned=C.PINNED_HS_VERSION,
            )
        )
    return sha256


def resolve_target_version(requested: str | None = None) -> tuple[str, str]:
    """تعیین نسخه هدف نصب — همیشه همراه SHA-256 معتبر (اصلاح ۴.۵).

    Returns:
        (نسخه، sha256) — sha256 هرگز None نیست؛ در نبود checksum رسمی،
        NeedsActionError با پیام فارسی مطرح می‌شود (الزام امنیتی، بدون مسیر عبور).
    """
    if requested:
        version = releases.normalize_version(requested)
        source = "درخواست کاربر"
    else:
        version, from_network = releases.latest_version()
        source = "آخرین نسخه پایدار GitHub" if from_network else "نسخه پین‌شده (بدون دسترسی شبکه)"
    print(f"  نسخه هدف: {version} — منبع: {source}")
    sha256 = mandatory_checksum(version)
    return version, sha256


def _arch() -> str:
    """نقشه معماری پلتفرم → نام معماری بسته (x86_64→amd64، aarch64→arm64)."""
    import platform

    machine = platform.machine().lower()
    return {"x86_64": "amd64", "aarch64": "arm64"}.get(machine, machine)
