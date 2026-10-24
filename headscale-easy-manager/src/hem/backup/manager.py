"""مدیریت فایل‌های پشتیبان — نام‌گذاری، فهرست و راستی‌آزمایی.

الگوی نام: hem-backup-YYYYmmdd-HHMMSS.tar.gz در /var/backups/hem + فایل sha256 کناری.

اصلاح ۴.۸: verify_backup علاوه بر سلامت tar/چک‌سام کناری/کلیدهای manifest،
«تک‌تک» فایل‌های manifest را با محتوای واقعی داخل آرشیو تطبیق می‌دهد و
مسیرهای خطرناک/فایل‌های اضافه/گمشده را گزارش می‌کند.
"""

from __future__ import annotations

import hashlib
import json
import tarfile
import time
from pathlib import Path

from hem import constants as C
from hem.i18n import fmt

BACKUP_GLOB = "hem-backup-*.tar.gz"
SAFETY_PREFIX = "hem-safety"

# مدخل‌های مجاز ریشهٔ آرشیو (ساختار create.py) — هر چیز دیگر «غیرمنتظره» است
_ALLOWED_TOP_ENTRIES = {"etc", "var", "caddy-block.txt", "manifest.json"}
# حداکثر تعداد ایراد نمایشی — برای جلوگیری از سیل خروجی
_MAX_ISSUES_SHOWN = 20


def default_backup_dir() -> Path:
    """پوشه پیش‌فرض پشتیبان‌ها."""
    return Path(C.BACKUP_DIR)


def new_backup_path(backup_dir=None, prefix: str = "hem-backup") -> Path:
    """ساخت نام فایل پشتیبان با زمان‌سنج — در تکرار، شماره پسوند می‌گیرد."""
    directory = Path(backup_dir) if backup_dir else default_backup_dir()
    base = directory / f"{prefix}-{time.strftime('%Y%m%d-%H%M%S')}.tar.gz"
    if not base.exists():
        return base
    counter = 2
    while True:
        candidate = directory / f"{base.stem}-{counter}.tar.gz"
        if not candidate.exists():
            return candidate
        counter += 1


def list_backups(backup_dir=None) -> list:
    """فهرست پشتیبان‌ها (مرتب از قدیم به جدید)."""
    directory = Path(backup_dir) if backup_dir else default_backup_dir()
    if not directory.is_dir():
        return []
    return sorted(directory.glob(BACKUP_GLOB))


def sha256_file(path) -> str:
    """محاسبه SHA-256 فایل."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sidecar_path(path) -> Path:
    """مسیر فایل sha256 کناری (path + «.sha256»)."""
    path = Path(path)
    return path.with_name(path.name + ".sha256")


def _norm_name(name: str) -> str:
    """نرمال‌سازی نام عضو آرشیو — فقط حذف پیشوند «./» (نه lstrip نقطه‌ها)."""
    name = (name or "").replace("\\", "/")
    while name.startswith("./"):
        name = name[2:]
    return name


def dangerous_member_reason(member) -> str | None:
    """دلیل خطرناک‌بودن یک عضو آرشیو — None یعنی بی‌خطر (اصلاح ۴.۸).

    هم‌ارز منطق `_safe_members` در restore.py: مسیر مطلق، شامل «..»، یا
    پیوند نمادین/سخت هرگز نباید از پشتیبان استخراج/پذیرفته شود.
    """
    if member.name.startswith("/") or member.name.startswith("\\"):
        return "مسیر مطلق"
    if ".." in member.name.replace("\\", "/").split("/"):
        return "شامل .."
    if member.issym() or member.islnk():
        return "پیوند نمادین/سخت"
    return None


def _hash_member(tf: tarfile.TarFile, member) -> str | None:
    """SHA-256 محتوای یک عضو آرشیو به‌صورت استریم (بدون فایل موقت)."""
    fobj = tf.extractfile(member)
    if fobj is None:
        return None
    digest = hashlib.sha256()
    for block in iter(lambda: fobj.read(1024 * 1024), b""):
        digest.update(block)
    return digest.hexdigest()


def read_manifest(backup_path) -> dict | None:
    """خواندن manifest.json از داخل آرشیو — خطا یعنی None."""
    try:
        with tarfile.open(backup_path, "r:gz") as tf:
            member = next(
                (m for m in tf.getmembers() if _norm_name(m.name) == "manifest.json"), None
            )
            if member is None:
                return None
            extracted = tf.extractfile(member)
            if extracted is None:
                return None
            data = json.loads(extracted.read().decode("utf-8", "replace"))
            return data if isinstance(data, dict) else None
    except (tarfile.TarError, OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def verify_backup(path) -> tuple[bool, list]:
    """راستی‌آزمایی کامل پشتیبان (اصلاح ۴.۸).

    بررسی‌ها:
      ۱. وجود فایل و سلامت tar.gz؛
      ۲. چک‌سام فایل با فایل sha256 کناری؛
      ۳. وجود و کلیدهای manifest.json؛
      ۴. تطبیق «تک‌تک» فایل‌های manifest با محتوای واقعی داخل آرشیو (استریم):
         ناهمخوانی هش، فایلِ در manifest ولی نه در آرشیو، فایلِ در آرشیو ولی نه
         در manifest؛
      ۵. مسیرهای خطرناک (مطلق/..‌/پیوند) و مدخل‌های غیرمنتظرهٔ ریشهٔ آرشیو.

    Returns:
        (خوب بودن، لیست ایرادهای فارسی — حداکثر ۲۰ مورد با جزئیات)
    """
    issues: list[str] = []
    path = Path(path)
    if not path.exists():
        return False, [fmt("backup_missing", path=path)]
    if not path.is_file() or path.stat().st_size == 0:
        return False, [fmt("backup_not_tar")]

    manifest: dict | None = None
    try:
        with tarfile.open(path, "r:gz") as tf:
            members = tf.getmembers()

            # ۵-الف) مسیرهای خطرناک — مستقل از manifest، همیشه بررسی می‌شود
            for member in members:
                reason = dangerous_member_reason(member)
                if reason:
                    issues.append(
                        fmt("backup_dangerous_member", path=member.name, reason=reason)
                    )

            # ۳) manifest از داخل همان آرشیو
            for member in members:
                if _norm_name(member.name) == "manifest.json":
                    extracted = tf.extractfile(member)
                    if extracted is not None:
                        try:
                            data = json.loads(extracted.read().decode("utf-8", "replace"))
                            manifest = data if isinstance(data, dict) else None
                        except (json.JSONDecodeError, UnicodeDecodeError):
                            manifest = None

            # ۴-الف) نقشهٔ هش فایل‌های واقعی آرشیو (استریم، بدون فایل موقت)
            archive_hashes: dict[str, str] = {}
            for member in members:
                if _norm_name(member.name) == "manifest.json":
                    continue
                if not member.isfile():
                    continue
                digest = _hash_member(tf, member)
                if digest is not None:
                    archive_hashes[_norm_name(member.name)] = digest

            # ۵-ب) مدخل‌های غیرمنتظرهٔ ریشهٔ آرشیو
            tops: set[str] = set()
            for member in members:
                top = _norm_name(member.name).split("/", 1)[0]
                if top:
                    tops.add(top)
            for top in sorted(tops):
                if top not in _ALLOWED_TOP_ENTRIES:
                    issues.append(fmt("backup_extra_top", name=top))
    except (tarfile.TarError, OSError, EOFError):
        # آرشیو ناقص/خراب — حتی اگر هدرها سالم به‌نظر برسند، خواندن کامل نشد
        return False, [fmt("backup_not_tar")]

    # ۲) چک‌سام کناری
    side = sidecar_path(path)
    if side.exists():
        content = side.read_text(encoding="utf-8", errors="replace").strip()
        expected = content.split()[0].lower() if content else ""
        if not expected or expected != sha256_file(path):
            issues.append(fmt("backup_checksum_bad"))
    else:
        issues.append(fmt("backup_sidecar_missing"))

    # ۳-ب) کلیدهای manifest + ۴-ب) تطبیق تک‌تک فایل‌ها
    if manifest is None:
        issues.append(fmt("backup_manifest_bad"))
    else:
        for key in ("hem_version", "headscale_version", "created_at", "files"):
            if key not in manifest:
                issues.append(fmt("backup_manifest_key_missing", key=key))
        files = manifest.get("files")
        if isinstance(files, dict):
            for rel, expected_hash in files.items():
                actual = archive_hashes.get(str(rel))
                if actual is None:
                    issues.append(fmt("backup_file_missing_in_archive", path=rel))
                elif str(expected_hash).lower() != actual:
                    issues.append(fmt("backup_file_hash_mismatch", path=rel))
            for rel in sorted(archive_hashes):
                if str(rel) not in files:
                    issues.append(fmt("backup_file_extra_in_archive", path=rel))
        elif "files" in manifest:
            issues.append(fmt("backup_manifest_key_missing", key="files"))

    # جلوگیری از سیل خروجی — فقط ۲۰ مورد اول با جزئیات
    if len(issues) > _MAX_ISSUES_SHOWN:
        hidden = len(issues) - _MAX_ISSUES_SHOWN
        issues = issues[:_MAX_ISSUES_SHOWN]
        issues.append(fmt("backup_more_issues", count=hidden))
    return len(issues) == 0, issues
