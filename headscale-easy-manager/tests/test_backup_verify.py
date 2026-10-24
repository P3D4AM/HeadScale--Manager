"""تست ۴.۸ — راستی‌آزمایی per-file پشتیبان (AUDIT §1 ردیف 4.8).

پشتیبان واقعی با create_backup ساخته می‌شود (بایت‌های واقعی، SQLite واقعی)؛
سپس آرشیو دستکاری/بازنویسی می‌شود و verify_backup باید هر خرابی را با نام
فایل گزارش کند. هیچ mockی روی هش‌کردن نیست — همه‌چیز بایت واقعی است.

  (الف) پشتیبان سالم → ok بدون ایراد.
  (ب) دستکاری محتوای یک فایل «داخل» آرشیو → ایرادِ همان فایل.
  (ج) حذف مدخل manifest → فایلِ در آرشیو ولی نه در manifest گزارش می‌شود
        (و برعکس: مدخل بدون فایل).
  (د) آرشیو با مسیر ../evil → ایراد مسیر خطرناک.
  (هـ) آرشیو ناقص (truncate) → ایراد سلامت آرشیو.
"""

import io
import json
import tarfile

from hem.backup import manager
from hem.backup.create import BackupContext, create_backup


def _make_layout(tmp_path):
    """ساختار نمونه: پیکربندی + db واقعی + state (الگوی test_backup.py)."""
    import sqlite3

    etc = tmp_path / "etc-headscale"
    etc.mkdir()
    (etc / "config.yaml").write_text(
        "server_url: https://x.example.com\nnoise: real-config-bytes\n", encoding="utf-8"
    )

    data = tmp_path / "data"
    data.mkdir()
    conn = sqlite3.connect(data / "db.sqlite")
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute("INSERT INTO users (name) VALUES ('admin')")
    conn.commit()
    conn.close()
    (data / "noise_private.key").write_text("TESTKEYDATA", encoding="utf-8")

    state = tmp_path / "state"
    state.mkdir()
    (state / "state.json").write_text('{"domain": "x.example.com"}', encoding="utf-8")

    backups = tmp_path / "backups"
    return BackupContext(
        etc_headscale=str(etc), data_dir=str(data), state_dir=str(state),
        caddyfile=None, backup_dir=str(backups),
    )


def _rewrite_archive(path, *, member_changes=None, drop=None, add_members=None):
    """بازنویسی tar.gz با تغییر محتوای اعضا (بایت واقعی، بدون فایل موقت)."""
    with tarfile.open(path, "r:gz") as tf:
        entries = []
        for m in tf.getmembers():
            if m.isfile():
                fobj = tf.extractfile(m)
                entries.append((m, fobj.read() if fobj else b""))
            else:
                entries.append((m, None))

    with tarfile.open(path, "w:gz") as tf:
        for m, data in entries:
            if drop and m.name in drop:
                continue
            if member_changes and m.name in member_changes:
                data = member_changes[m.name]
                m.size = len(data)
            if data is None:
                tf.addfile(m)
            else:
                tf.addfile(m, io.BytesIO(data))
        for name, data in (add_members or []):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))

    # چک‌سام کناری با هش آرشیو جدید همگام می‌شود تا فقط ایرادِ تحت آزمون دیده شود
    side = manager.sidecar_path(path)
    side.write_text(f"{manager.sha256_file(path)}  {path.name}\n", encoding="utf-8")


# ─── (الف) پشتیبان سالم → ok ─────────────────────────────────────────────

def test_valid_backup_verifies_ok(tmp_path):
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    ok, issues = manager.verify_backup(path)
    assert ok, issues
    assert issues == []


# ─── (ب) دستکاری یک فایل داخل آرشیو ─────────────────────────────────────

def test_tampered_file_inside_archive_is_named(tmp_path):
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    _rewrite_archive(
        path,
        member_changes={
            "etc/headscale/config.yaml": b"server_url: https://EVIL.example.com\n"
        },
    )
    ok, issues = manager.verify_backup(path)
    assert not ok
    named = [i for i in issues if "etc/headscale/config.yaml" in i]
    assert named, issues
    assert any("SHA-256" in i or "می‌خواند" in i for i in named), (
        "ایراد باید ناهمخوانی هش همان فایل باشد"
    )


def test_tampered_db_inside_archive_is_named(tmp_path):
    """دستکاری بدنهٔ پایگاه‌داده داخل آرشیو هم کشف می‌شود (بایت واقعی)."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    with tarfile.open(path, "r:gz") as tf:
        original = next(
            (m, tf.extractfile(m).read()) for m in tf.getmembers()
            if m.name == "var/lib/headscale/db.sqlite"
        )
    # بایت میانی db عوض می‌شود (همان الگوی خراب‌کاری)
    body = bytearray(original[1])
    body[len(body) // 2] ^= 0xFF
    _rewrite_archive(path, member_changes={"var/lib/headscale/db.sqlite": bytes(body)})
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any("var/lib/headscale/db.sqlite" in i for i in issues), issues


# ─── (ج) ناهم‌خوانی manifest ↔ آرشیو ────────────────────────────────────

def test_manifest_entry_removed_flags_archive_file(tmp_path):
    """حذف مدخل manifest → فایل در آرشیو هست ولی در manifest ثبت نشده."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    manifest = manager.read_manifest(path)
    del manifest["files"]["etc/headscale/config.yaml"]
    _rewrite_archive(
        path,
        member_changes={"manifest.json": json.dumps(manifest, ensure_ascii=False).encode()},
    )
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any(
        "etc/headscale/config.yaml" in i and "manifest ثبت نشده" in i for i in issues
    ), issues


def test_manifest_entry_without_archive_file_flags_missing(tmp_path):
    """مدخل manifest بدون فایل متناظر در آرشیو → «در آرشیو پیدا نشد»."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    manifest = manager.read_manifest(path)
    manifest["files"]["var/lib/headscale/ghost.key"] = "b" * 64
    _rewrite_archive(
        path,
        member_changes={"manifest.json": json.dumps(manifest, ensure_ascii=False).encode()},
    )
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any(
        "var/lib/headscale/ghost.key" in i and "پیدا نشد" in i for i in issues
    ), issues


# ─── (د) مسیر خطرناک در آرشیو ───────────────────────────────────────────

def test_dangerous_path_in_archive_is_flagged(tmp_path):
    """ساخت آرشیو با ../evil و /abs — هر دو باید «مسیر خطرناک» گزارش شوند."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    _rewrite_archive(
        path,
        add_members=[
            ("../evil.txt", b"evil-payload"),
            ("/etc/passwd", b"root:x:0:0:root:/root:/bin/bash\n"),
        ],
    )
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any("../evil.txt" in i and "خطرناک" in i for i in issues), issues
    assert any("etc/passwd" in i and "خطرناک" in i for i in issues), issues


def test_symlink_member_is_flagged(tmp_path):
    """عضو پیوند نمادین در آرشیو → مسیر خطرناک (هم‌ارز _safe_members)."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    with tarfile.open(path, "r:gz") as tf:
        entries = [
            (m, tf.extractfile(m).read() if m.isfile() else None) for m in tf.getmembers()
        ]
    with tarfile.open(path, "w:gz") as tf:
        for m, data in entries:
            tf.addfile(m, io.BytesIO(data) if data is not None else None)
        link = tarfile.TarInfo("etc/headscale/noise_private.key")  # نام بی‌خطر ولی پیوند
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        tf.addfile(link)
    manager.sidecar_path(path).write_text(
        f"{manager.sha256_file(path)}  {path.name}\n", encoding="utf-8"
    )
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any("پیوند" in i for i in issues), issues


def test_unexpected_top_level_entry_is_flagged(tmp_path):
    """مدخل غیرمنتظره در ریشهٔ آرشیو (مثلاً usr/...) گزارش می‌شود."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    _rewrite_archive(path, add_members=[("usr/share/evil.txt", b"x")])
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any("usr" in i and "غیرمنتظره" in i for i in issues), issues


# ─── (هـ) آرشیو ناقص ────────────────────────────────────────────────────

def test_truncated_tar_fails_integrity(tmp_path):
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    data = path.read_bytes()
    path.write_bytes(data[: int(len(data) * 0.35)])  # بریدن انتهای آرشیو
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert any("tar.gz" in i or "آرشیو" in i for i in issues), issues


def test_valid_backup_with_caddy_block_hashes_everything(tmp_path):
    """create.py باید hash «همهٔ» فایل‌های آرشیو (حتی caddy-block.txt) را ثبت کند."""
    caddyfile = tmp_path / "Caddyfile"
    caddyfile.write_text(
        "# BEGIN headscale-easy-manager\nhealth.example.com {\n"
        "  reverse_proxy 127.0.0.1:8080\n}\n# END headscale-easy-manager\n",
        encoding="utf-8",
    )
    ctx = _make_layout(tmp_path)
    ctx.caddyfile = str(caddyfile)
    path = create_backup(ctx=ctx)
    manifest = manager.read_manifest(path)
    assert "caddy-block.txt" in manifest["files"], (
        "hash فایل بلوک Caddy باید در manifest ثبت شود (اصلاح ۴.۸)"
    )
    ok, issues = manager.verify_backup(path)
    assert ok, issues


def test_issue_flood_is_capped(tmp_path):
    """بیش از ۲۰ ایراد → فقط ۲۰ مورد + یک خط «و N ایراد دیگر»."""
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    manifest = manager.read_manifest(path)
    # ۳۰ مدخل غیرواقعی → ۳۰ ایراد «در آرشیو پیدا نشد»
    for i in range(30):
        manifest["files"][f"var/lib/headscale/ghost-{i:02d}.key"] = "c" * 64
    _rewrite_archive(
        path,
        member_changes={"manifest.json": json.dumps(manifest, ensure_ascii=False).encode()},
    )
    ok, issues = manager.verify_backup(path)
    assert not ok
    assert len(issues) == 21, len(issues)  # ۲۰ مورد + خط «و N مورد دیگر»
    assert any("ایراد دیگر" in i for i in issues)
