"""مدیریت فایل‌های پشتیبان — نام‌گذاری، فهرست و راستی‌آزمایی.

الگوی نام: hem-backup-YYYYmmdd-HHMMSS.tar.gz در /var/backups/hem + فایل sha256 کناری.
"""

from __future__ import annotations

import json
import tarfile
import time
from pathlib import Path

from hem import constants as C
from hem.i18n import fmt

BACKUP_GLOB = "hem-backup-*.tar.gz"
SAFETY_PREFIX = "hem-safety"


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
    import hashlib

    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sidecar_path(path) -> Path:
    """مسیر فایل sha256 کناری (path + «.sha256»)."""
    path = Path(path)
    return path.with_name(path.name + ".sha256")


def read_manifest(backup_path) -> dict | None:
    """خواندن manifest.json از داخل آرشیو — خطا یعنی None."""
    try:
        with tarfile.open(backup_path, "r:gz") as tf:
            member = next(
                (m for m in tf.getmembers() if m.name.lstrip("./") == "manifest.json"), None
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
    """راستی‌آزمایی پشتیبان: وجود فایل، سلامت tar، چک‌سام کناری و manifest.

    Returns:
        (خوب بودن، لیست ایرادهای فارسی)
    """
    issues: list[str] = []
    path = Path(path)
    if not path.exists():
        return False, [fmt("backup_missing", path=path)]
    if not path.is_file() or path.stat().st_size == 0:
        return False, [fmt("backup_not_tar")]
    try:
        with tarfile.open(path, "r:gz"):
            pass
    except (tarfile.TarError, OSError):
        return False, [fmt("backup_not_tar")]

    side = sidecar_path(path)
    if side.exists():
        content = side.read_text(encoding="utf-8", errors="replace").strip()
        expected = content.split()[0].lower() if content else ""
        if not expected or expected != sha256_file(path):
            issues.append(fmt("backup_checksum_bad"))
    else:
        issues.append(fmt("backup_sidecar_missing"))

    manifest = read_manifest(path)
    if not manifest:
        issues.append(fmt("backup_manifest_bad"))
    else:
        for key in ("hem_version", "headscale_version", "created_at", "files"):
            if key not in manifest:
                issues.append(fmt("backup_manifest_key_missing", key=key))

    return len(issues) == 0, issues
