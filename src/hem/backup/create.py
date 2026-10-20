"""ساخت پشتیبان کامل — snapshot امن SQLite + پیکربندی + کلیدها + state + بلوک Caddy."""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from hem import __version__
from hem import constants as C
from hem.backup import manager
from hem.core import hemlog
from hem.core.exec import run
from hem.core.prompts import confirm
from hem.headscale import installer as hs_installer
from hem.i18n import fmt
from hem.system import services

logger = hemlog.get("backup-create")


@dataclass
class BackupContext:
    """مسیرهای ورودی پشتیبان — برای تست‌پذیری قابل تزریق است."""

    etc_headscale: str = C.HEADSCALE_CONFIG_DIR
    data_dir: str = C.HEADSCALE_DATA_DIR
    state_dir: str = C.STATE_DIR
    caddyfile: str | None = None
    backup_dir: str = C.BACKUP_DIR


def _os_version() -> str:
    """نام/نسخه سیستم‌عامل از /etc/os-release."""
    try:
        for line in Path("/etc/os-release").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("PRETTY_NAME="):
                return line.split("=", 1)[1].strip('"')
    except OSError:
        pass
    return "unknown"


def _snapshot_sqlite(db_path: Path, dest: Path) -> None:
    """snapshot امن پایگاه‌داده با sqlite3 استاندارد (conn.backup)."""
    src = sqlite3.connect(str(db_path), timeout=10)
    try:
        dst = sqlite3.connect(str(dest))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def _copy_tree(source_dir, staging: Path, logical_prefix: str, manifest: dict) -> int:
    """کپی بازگشتی یک پوشه به staging/<logical_prefix> با ثبت sha256 هر فایل."""
    source = Path(source_dir)
    if not source.is_dir():
        return 0
    count = 0
    for item in sorted(source.rglob("*")):
        if item.is_file():
            rel = item.relative_to(source).as_posix()
            target = staging / logical_prefix / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, target)
            manifest["files"][f"{logical_prefix}/{rel}"] = manager.sha256_file(target)
            count += 1
    return count


def _backup_database(ctx: BackupContext, staging: Path, manifest: dict) -> str:
    """پشتیبان db.sqlite — اول snapshot امن؛ اگر قفل بود، توقف کوتاه سرویس با رضایت."""
    db_path = Path(ctx.data_dir) / "db.sqlite"
    if not db_path.exists():
        return ""
    dest = staging / "var/lib/headscale/db.sqlite"
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        _snapshot_sqlite(db_path, dest)
        method = "sqlite-backup"
    except sqlite3.OperationalError:
        if services.service_active(C.HEADSCALE_UNIT):
            if not confirm(fmt("db_locked_stop_service")):
                raise RuntimeError(
                    "پایگاه‌داده قفل است و اجازه توقف سرویس داده نشد؛ پشتیبان‌گیری متوقف شد."
                )
            print("  توقف کوتاه سرویس برای snapshot مطمئن …")
            services.systemctl("stop", C.HEADSCALE_UNIT)
            try:
                shutil.copy2(db_path, dest)
            finally:
                services.systemctl("start", C.HEADSCALE_UNIT)
            method = "stop-and-copy"
        else:
            shutil.copy2(db_path, dest)
            method = "raw-copy"
    manifest["files"]["var/lib/headscale/db.sqlite"] = manager.sha256_file(dest)
    return method


def create_backup(output=None, dry_run: bool = False, ctx: BackupContext | None = None) -> Path:
    """ساخت فایل پشتیبان کامل.

    مراحل: snapshot db → جمع‌آوری فایل‌ها → manifest.json → tar.gz → chmod 600 → sha256 کناری.
    """
    ctx = ctx or BackupContext()
    out = Path(output) if output else manager.new_backup_path(ctx.backup_dir)
    out.parent.mkdir(parents=True, exist_ok=True)

    manifest = {
        "hem_version": __version__,
        "headscale_version": hs_installer.current_version() or "",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "ubuntu_version": _os_version(),
        "files": {},
        "caddy_block": False,
        "db_method": "",
    }

    if dry_run:
        print(f"[dry-run] ساخت پشتیبان در {out}")
        print(f"[dry-run] منابع: {ctx.etc_headscale}، {ctx.data_dir}، {ctx.state_dir}")
        return out

    staging = Path(tempfile.mkdtemp(prefix="hem-backup-"))
    try:
        # ۱) پیکربندی headscale
        _copy_tree(ctx.etc_headscale, staging, "etc/headscale", manifest)
        # ۲) پایگاه‌داده + کلیدها
        manifest["db_method"] = _backup_database(ctx, staging, manifest)
        for key_file in sorted(Path(ctx.data_dir).glob("*.key")):
            dest = staging / "var/lib/headscale" / key_file.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(key_file, dest)
            manifest["files"][f"var/lib/headscale/{key_file.name}"] = manager.sha256_file(dest)
        # ۳) state ابزار (state.json، cameras.yaml، install-answers.yaml)
        _copy_tree(ctx.state_dir, staging, "etc/hem", manifest)
        # ۴) بلوک Caddy ما (فقط متن بلوک، نه کل Caddyfile)
        caddyfile = ctx.caddyfile or "/etc/caddy/Caddyfile"
        if caddyfile and Path(caddyfile).exists():
            from hem.proxy import caddy

            block = caddy.extract_site_block(caddyfile)
            if block:
                (staging / "caddy-block.txt").write_text(block, encoding="utf-8")
                manifest["caddy_block"] = True
        # ۵) manifest
        (staging / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        # ۶) ساخت آرشیو با tar (لیست آرگومان — بدون شل)
        tops = sorted(p.name for p in staging.iterdir())
        run(["tar", "-czf", str(out), "-C", str(staging), *tops], timeout=600)
        os.chmod(out, 0o600)
        # ۷) فایل sha256 کناری
        manager.sidecar_path(out).write_text(
            f"{manager.sha256_file(out)}  {out.name}\n", encoding="utf-8"
        )
        size_mb = out.stat().st_size / (1024 * 1024)
        print(fmt("backup_created", path=out, size=f"{size_mb:.1f} مگابایت"))
        return out
    finally:
        shutil.rmtree(staging, ignore_errors=True)
