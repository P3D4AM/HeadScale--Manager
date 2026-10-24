"""تست ماژول نسخه‌ها/ checksum — FACTS §1."""

from hem import constants as C
from hem.headscale import releases

SAMPLE_CHECKSUMS = """\
9e8ec12a65229435863a2cdf5082853c282808e845efd3a1f0b0c02b8f84d723  headscale_0.29.5_linux_amd64.deb
1111111111111111111111111111111111111111111111111111111111111111  headscale_0.29.5_linux_arm64.deb
2222222222222222222222222222222222222222222222222222222222222222  headscale_0.29.5_linux_amd64.rpm
"""


def test_parse_checksums():
    table = releases.parse_checksums(SAMPLE_CHECKSUMS)
    assert table["headscale_0.29.5_linux_amd64.deb"] == C.PINNED_HS_SHA256_AMD64
    assert table["headscale_0.29.5_linux_arm64.deb"] == "1" * 64
    assert len(table) == 3


def test_parse_checksums_empty():
    assert releases.parse_checksums("") == {}
    assert releases.parse_checksums("garbage line\nno hash here") == {}


def test_deb_url():
    url = releases.deb_url("0.29.5", "amd64")
    assert url == (
        "https://github.com/juanfont/headscale/releases/download/"
        "v0.29.5/headscale_0.29.5_linux_amd64.deb"
    )
    # با پیشوند v هم باید همین نتیجه را بدهد
    assert releases.deb_url("v0.29.5", "amd64") == url


def test_checksum_for_fallback_pinned(monkeypatch):
    # بدون شبکه → fallback به مقدار پین‌شده FACTS §1
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})
    assert releases.checksum_for("0.29.5", "amd64") == C.PINNED_HS_SHA256_AMD64
    # نسخه/معماری دیگر بدون checksum → None
    assert releases.checksum_for("0.28.1", "arm64") is None


def test_checksum_for_prefers_remote(monkeypatch):
    monkeypatch.setattr(
        releases, "fetch_checksums",
        lambda version: {"headscale_0.29.5_linux_amd64.deb": "a" * 64},
    )
    assert releases.checksum_for("0.29.5", "amd64") == "a" * 64


def test_latest_version_fallback_to_pinned(monkeypatch):
    def _raise(*args, **kwargs):
        raise OSError("network down")

    monkeypatch.setattr("urllib.request.urlopen", _raise)
    version, from_network = releases.latest_version()
    assert version == C.PINNED_HS_VERSION
    assert from_network is False


def test_latest_version_from_network(monkeypatch):
    import io

    class _Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    payload = b'{"tag_name": "v0.30.0", "name": "0.30.0"}'
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **kw: _Resp(payload))
    version, from_network = releases.latest_version()
    assert version == "0.30.0"
    assert from_network is True


def test_normalize_version():
    assert releases.normalize_version("v0.29.5") == "0.29.5"
    assert releases.normalize_version("0.29.5") == "0.29.5"
