"""بازیابی پشتیبان — با پشتیبان ایمنی، توقف سرویس، جای‌گذاری و بررسی سلامت."""

from __future__ import annotations

import shutil
import tarfile
import tempfile
import time
from pathlib import Path

from hem import constants as C
from hem.backup import manager
from hem.backup.create import BackupContext, create_backup
from hem.core import hemlog
from hem.core.prompts import confirm
from hem.headscale import installer as hs_installer
from hem.i18n import fmt
from hem.system import services

logger = hemlog.get("backup-restore")


def _safe_members(tf: tarfile.TarFile, dest: Path) -> list:
    """اعتبارسنجی اعضای آرشیو در برابر مسیر خارج‌شده (path traversal)."""
    safe = []
    root = dest.resolve()
    for member in tf.getmembers():
        target = (dest / member.name).resolve()
        if not str(target).startswith(str(root)):
            raise ValueError(f"عضو مشکوک آرشیو رد شد: {member.name}")
        if member.issym() or member.islnk():
            raise ValueError(f"پیاد نمادین در آرشیو پشتیبانی نمی‌شود: {member.name}")
        safe.append(member)
    return safe


def _place(source: Path, dest_dir: Path, chown_user: str | None = None) -> int:
    """جای‌گذاری محتوا در مقصد — از وضعیت فعلی پشتیبان .pre-restore گرفته می‌شود."""
    if not source.exists():
        return 0
    if dest_dir.exists():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        shutil.move(str(dest_dir), str(dest_dir.with_name(dest_dir.name + f".pre-restore-{stamp}")))
    dest_dir.mkdir(parents=True, exist_ok=True)
    count = 0
    for item in sorted(source.rglob("*")):
        if not item.is_file():
            continue
        target = dest_dir / item.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        if chown_user:
            try:
                shutil.chown(target, user=chown_user, group=chown_user)
            except (LookupError, OSError):
                pass
        count += 1
    return count


def restore_backup(path, yes: bool = False, dry_run: bool = False,
                   ctx: BackupContext | None = None) -> int:
    """بازیابی کامل از فایل پشتیبان — کد خروج مطابق قرارداد hsctl."""
    ok, issues = manager.verify_backup(path)
    if not ok:
        print("✗ پشتیبان قابل اعتماد نیست:")
        for issue in issues:
            print(f"  - {issue}")
        return C.EXIT_ERROR

    manifest = manager.read_manifest(path) or {}
    print("── اطلاعات پشتیبان " + "─" * 40)
    print(f"  تاریخ ساخت:      {manifest.get('created_at', '—')}")
    print(f"  نسخه headscale:  {manifest.get('headscale_version') or '—'}")
    print(f"  نسخه ابزار:      {manifest.get('hem_version', '—')}")
    print(f"  سیستم‌عامل منبع: {manifest.get('ubuntu_version', '—')}")

    current = hs_installer.current_version()
    backup_ver = manifest.get("headscale_version") or ""
    if current and backup_ver and current != backup_ver:
        print(
            f"  ⚠ هشدار تطابق نسخه: نسخه نصب‌شده {current} است ولی این پشتیبان با {backup_ver} "
            "ساخته شده — پس از بازیابی، سرویس را با «hsctl doctor» بررسی کنید."
        )

    if not yes and not confirm(fmt("confirm_restore")):
        return C.EXIT_NO_CONFIRM

    ctx = ctx or BackupContext()
    if dry_run:
        print(f"[dry-run] بازیابی {path} (بدون اعمال)")
        print(f"[dry-run] جای‌گذاری در: {ctx.etc_headscale}، {ctx.data_dir}، {ctx.state_dir}")
        return C.EXIT_OK

    # پشتیبان ایمنی از وضعیت فعلی
    safety_path = None
    try:
        safety_path = create_backup(
            output=Path(ctx.backup_dir) / f"{manager.SAFETY_PREFIX}-{time.strftime('%Y%m%d-%H%M%S')}.tar.gz",
            ctx=ctx,
        )
        print(f"  پشتیبان ایمنی از وضعیت فعلی: {safety_path}")
    except Exception as exc:  # noqa: BLE001
        print(f"✗ ساخت پشتیبان ایمنی ناموفق بود ({exc}) — بازیابی ادامه نمی‌یابد.")
        return C.EXIT_ERROR

    # توقف سرویس
    was_active = services.service_active(C.HEADSCALE_UNIT)
    if was_active:
        print("  توقف سرویس headscale …")
        services.systemctl("stop", C.HEADSCALE_UNIT)

    # استخراج و جای‌گذاری
    tmp = Path(tempfile.mkdtemp(prefix="hem-restore-"))
    try:
        with tarfile.open(path, "r:gz") as tf:
            members = _safe_members(tf, tmp)
            tf.extractall(tmp, members=members)
        count_cfg = _place(tmp / "etc/headscale", Path(ctx.etc_headscale))
        count_data = _place(
            tmp / "var/lib/headscale", Path(ctx.data_dir), chown_user=C.HEADSCALE_USER
        )
        count_state = _place(tmp / "etc/hem", Path(ctx.state_dir))
        # بلوک Caddy
        caddy_block_file = tmp / "caddy-block.txt"
        if caddy_block_file.exists():
            from hem.proxy import caddy

            caddy.restore_site_block(caddy_block_file.read_text(encoding="utf-8"))
        print(f"  جای‌گذاری شد: {count_cfg} فایل پیکربندی، {count_data} فایل داده، {count_state} فایل state")
    except Exception as exc:  # noqa: BLE001
        print(f"✗ خطا در جای‌گذاری فایل‌ها: {exc}")
        if was_active:
            services.systemctl("start", C.HEADSCALE_UNIT)
        return C.EXIT_ERROR
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    # راه‌اندازی و بررسی سلامت
    print("  راه‌اندازی مجدد سرویس …")
    services.systemctl("start", C.HEADSCALE_UNIT)
    if not services.wait_healthy(C.HEADSCALE_UNIT, timeout=60):
        print("✗ سرویس پس از بازیابی سالم بالا نیامد. آخرین خطاها:")
        for line in (services.journal_logs(C.HEADSCALE_UNIT, lines=20) or [])[-15:]:
            print(f"    {line}")
        print(
            "برای بازگشت به وضعیت قبل از بازیابی، پشتیبان ایمن زیر را بازیابی کنید:\n"
            f"    sudo hsctl restore {safety_path}"
        )
        return C.EXIT_ERROR

    print("✓ بازیابی کامل شد و سرویس سالم است.")
    print(f"  (پشتیبان ایمن وضعیت قبلی نگه داشته شد: {safety_path})")
    return C.EXIT_OK
