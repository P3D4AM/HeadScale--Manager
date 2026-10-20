"""تست پشتیبان‌گیری/راستی‌آزمایی — با مسیرهای موقت (بدون نیاز به headscale نصب‌شده)."""

import sqlite3

from hem.backup import manager
from hem.backup.create import BackupContext, create_backup


def _make_layout(tmp_path):
    """ساخت ساختار نمونه: پیکربندی + پایگاه‌داده واقعی + state."""
    etc = tmp_path / "etc-headscale"
    etc.mkdir()
    (etc / "config.yaml").write_text("server_url: https://x.example.com\n", encoding="utf-8")

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


def test_create_and_verify_backup(tmp_path):
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    assert path.exists()
    assert path.name.startswith("hem-backup-")
    assert path.name.endswith(".tar.gz")

    sidecar = manager.sidecar_path(path)
    assert sidecar.exists()
    assert sidecar.read_text().split()[0] == manager.sha256_file(path)

    ok, issues = manager.verify_backup(path)
    assert ok, issues

    manifest = manager.read_manifest(path)
    assert manifest is not None
    assert manifest["headscale_version"] == ""  # headscale در محیط تست نصب نیست
    assert "var/lib/headscale/db.sqlite" in manifest["files"]
    assert "etc/headscale/config.yaml" in manifest["files"]
    assert "etc/hem/state.json" in manifest["files"]


def test_backup_database_is_valid_sqlite(tmp_path):
    """پشتیبان db.sqlite باید یک snapshot سالم و خوانا باشد."""
    import tarfile

    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    with tarfile.open(path, "r:gz") as tf:
        member = next(m for m in tf.getmembers() if m.name.endswith("db.sqlite"))
        extracted = tf.extractfile(member)
        assert extracted is not None
        import os
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tmp:
            tmp.write(extracted.read())
            tmp_name = tmp.name
    try:
        conn = sqlite3.connect(tmp_name)
        rows = conn.execute("SELECT name FROM users").fetchall()
        conn.close()
        assert rows == [("admin",)]
    finally:
        os.unlink(tmp_name)


def test_verify_corrupt_backup(tmp_path):
    ctx = _make_layout(tmp_path)
    path = create_backup(ctx=ctx)
    # خراب‌کردن محتوای آرشیو
    data = bytearray(path.read_bytes())
    data[len(data) // 2] ^= 0xFF
    path.write_bytes(bytes(data))
    ok, issues = manager.verify_backup(path)
    assert ok is False
    assert issues


def test_verify_missing_file(tmp_path):
    ok, issues = manager.verify_backup(tmp_path / "nonexistent.tar.gz")
    assert ok is False
    assert any("وجود ندارد" in issue for issue in issues)


def test_list_backups(tmp_path):
    ctx = _make_layout(tmp_path)
    create_backup(ctx=ctx)
    create_backup(ctx=ctx)
    backups = manager.list_backups(ctx.backup_dir)
    assert len(backups) == 2
    assert all(b.name.startswith("hem-backup-") for b in backups)
