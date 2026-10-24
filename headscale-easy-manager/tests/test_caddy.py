"""تست مدیریت بلوک Caddy — idempotency و حفظ محتوای غیرمرتبط."""

from hem import constants as C
from hem.proxy import caddy

EXISTING_CADDYFILE = """example.org {
\troot * /var/www
\tfile_server
}
"""


def _write(tmp_path, content=EXISTING_CADDYFILE):
    path = tmp_path / "Caddyfile"
    path.write_text(content, encoding="utf-8")
    return path


def test_inject_is_idempotent(tmp_path):
    path = _write(tmp_path)
    changed1 = caddy.inject_site_block("hs.example.com", path)
    first = path.read_text(encoding="utf-8")
    assert changed1 is True
    assert first.count(C.CADDY_BLOCK_BEGIN) == 1
    assert first.count(C.CADDY_BLOCK_END) == 1

    changed2 = caddy.inject_site_block("hs.example.com", path)
    second = path.read_text(encoding="utf-8")
    assert changed2 is False
    assert second == first  # بدون تغییر


def test_inject_replaces_old_block(tmp_path):
    path = _write(tmp_path)
    caddy.inject_site_block("old.example.com", path)
    caddy.inject_site_block("new.example.com", path)
    text = path.read_text(encoding="utf-8")
    assert "old.example.com" not in text
    assert "new.example.com" in text
    assert text.count(C.CADDY_BLOCK_BEGIN) == 1


def test_inject_preserves_unrelated(tmp_path):
    path = _write(tmp_path)
    caddy.inject_site_block("hs.example.com", path)
    text = path.read_text(encoding="utf-8")
    assert "example.org" in text
    assert "file_server" in text
    # بلوک رسمی FACTS §6: reverse_proxy به 8080 با header_up
    assert "reverse_proxy 127.0.0.1:8080" in text
    assert "header_up X-Real-IP {remote_host}" in text
    assert "handle /generate_204" in text


def test_remove_site_block(tmp_path):
    path = _write(tmp_path)
    caddy.inject_site_block("hs.example.com", path)
    removed = caddy.remove_site_block(path)
    assert removed is not None
    assert C.CADDY_BLOCK_BEGIN in removed
    text = path.read_text(encoding="utf-8")
    assert C.CADDY_BLOCK_BEGIN not in text
    assert "hs.example.com" not in text
    # محتوای غیرمرتبط حفظ شده است
    assert "example.org" in text
    assert "file_server" in text


def test_remove_when_absent(tmp_path):
    path = _write(tmp_path)
    assert caddy.remove_site_block(path) is None


def test_has_and_extract(tmp_path):
    path = _write(tmp_path)
    assert caddy.has_site_block(path) is False
    caddy.inject_site_block("hs.example.com", path)
    assert caddy.has_site_block(path) is True
    block = caddy.extract_site_block(path)
    assert block is not None
    assert "hs.example.com" in block
