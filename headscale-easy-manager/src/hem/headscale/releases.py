"""نسخه‌ها و checksum بسته‌های رسمی Headscale — منطق FACTS §1 با بازگشت به نسخه پین‌شده."""

from __future__ import annotations

import json
import re
import urllib.request

from hem import __version__
from hem import constants as C
from hem.core import hemlog

logger = hemlog.get("releases")

_VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")


def normalize_version(version: str) -> str:
    """حذف پیشوند v/V از نسخه."""
    return str(version).strip().lstrip("vV")


def latest_version() -> tuple[str, bool]:
    """آخرین نسخه پایدار از GitHub API.

    Returns:
        (نسخه، از_شبکه) — در خطا/عدم دسترسی به نسخه پین‌شده با هشدار برمی‌گردد.
    """
    try:
        req = urllib.request.Request(
            C.GITHUB_LATEST_API,
            headers={
                "Accept": "application/vnd.github+json",
                "User-Agent": f"hem/{__version__}",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
        version = normalize_version(data.get("tag_name", ""))
        if _VERSION_RE.match(version):
            return version, True
    except OSError as exc:
        logger.warning(
            "دریافت آخرین نسخه از GitHub ناموفق بود (%s) — بازگشت به نسخه پین‌شده %s",
            exc, C.PINNED_HS_VERSION,
        )
    return C.PINNED_HS_VERSION, False


def deb_filename(version: str, arch: str) -> str:
    """نام فایل deb بر اساس الگوی رسمی."""
    return f"headscale_{normalize_version(version)}_linux_{arch}.deb"


def deb_url(version: str, arch: str) -> str:
    """URL دانلود بسته deb (FACTS §1)."""
    return C.HS_DEB_URL_TEMPLATE.format(
        version=normalize_version(version), arch=arch
    )


def parse_checksums(text: str) -> dict:
    """پارس محتوای checksums.txt — خروجی: {نام‌فایل: sha256}."""
    out: dict[str, str] = {}
    for line in (text or "").splitlines():
        parts = line.strip().split()
        if len(parts) >= 2 and re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
            out[parts[-1]] = parts[0].lower()
    return out


def fetch_checksums(version: str) -> dict:
    """دانلود و پارس checksums.txt نسخه — در خطا دیکشنری خالی."""
    url = C.CHECKSUMS_URL_TEMPLATE.format(version=normalize_version(version))
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"hem/{__version__}"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            return parse_checksums(resp.read().decode("utf-8", "replace"))
    except OSError as exc:
        logger.warning("دریافت checksums برای v%s ناموفق بود: %s", normalize_version(version), exc)
        return {}


def checksum_for(version: str, arch: str, filename: str | None = None) -> str | None:
    """SHA-256 بسته — اول از checksums رسمی؛ در نبود آن، مقدار پین‌شده 0.29.5/amd64.

    None یعنی checksum رسمی در دسترس نیست؛ فراخوانندهٔ نصب/ارتقا موظف است در
    این حالت متوقف شود (installer.mandatory_checksum) — ادامه بدون چک‌سام
    مجاز نیست (اصلاح ۴.۵).
    """
    version = normalize_version(version)
    fname = filename or deb_filename(version, arch)
    table = fetch_checksums(version)
    if fname in table:
        return table[fname]
    # بازگشت به مقدار پین‌شده (FACTS §1)
    if version == C.PINNED_HS_VERSION and arch == "amd64" and fname == deb_filename(version, "amd64"):
        return C.PINNED_HS_SHA256_AMD64
    return None
