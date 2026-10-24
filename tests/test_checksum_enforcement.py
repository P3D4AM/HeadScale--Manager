"""تست ۴.۵ — الزامی‌بودن راستی‌آزمایی SHA-256 در «همهٔ» مسیرها (AUDIT §1 ردیف 4.5).

  (الف) گام _step_headscale با checksum غیرقابل‌حل (sha256=None) → توقف با پیام
        فارسی حاوی SHA-256 — هم در حالت تعاملی و هم غیرتعاملی (پیش‌تر در
        غیرتعاملی بی‌صدا ادامه می‌یافت).
  (ب) download با هَش مورد انتظار اشتباه → استثنا + حذف فایل (نصب نمی‌شود)؛
        فقط «تحویل» شبکه mock است، مسیر مقایسهٔ هش واقعی است.
  (ج) مسیر ارتقا (cmd_update/_install) با checksum غیرقابل‌حل برای نسخهٔ جدید →
        توقف «قبل از دانلود نسخهٔ جدید».
  (د) دانلود ناقص/کوتاه‌شده → ناهمخوانی کشف و فایل حذف می‌شود.
"""

import hashlib
import io
from pathlib import Path
from types import SimpleNamespace

import pytest

from hem import constants as C
from hem.core.runner import NeedsActionError, Step
from hem.headscale import installer as hs_installer
from hem.headscale import releases

# ─── ابزارهای مشترک ─────────────────────────────────────────────────────

_CONF_V030 = """\
domain: checksum.example.com
magic_dns_base: ts.checksum.example.com
headscale_version: "0.30.0"
caddy_mode: skip
embedded_derp: false
firewall: false
first_user: admin
acme_email: ""
"""


class _Resp(io.BytesIO):
    """پاسخ HTTP شبیه‌سازی‌شده — فقط لایهٔ تحویل؛ محتوای بایت واقعی."""

    def __init__(self, payload: bytes, content_length: int | None = None):
        super().__init__(payload)
        self.headers = {"Content-Length": str(content_length if content_length is not None else len(payload))}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _flow_for_headscale_step(tmp_path, monkeypatch, non_interactive: bool):
    """ساخت InstallFlow با پاسخ‌های واقعی از فایل — برای فراخوانی مستقیم گام ۱۰."""
    from hem.core import prompts
    from hem.installer.flow import InstallFlow

    conf = tmp_path / "conf.yaml"
    conf.write_text(_CONF_V030, encoding="utf-8")
    flow = InstallFlow(
        config_file=str(conf), non_interactive=non_interactive,
        dry_run=False, assume_yes=True,
    )
    flow.answers = hs_installer  # جای‌نگهدار؛ در پایین پاسخ واقعی جایگزین می‌شود
    from hem.installer.answers import load_from_file

    flow.answers = load_from_file(str(conf))
    # منابع گام plan: نسخهٔ هدف مشخص ولی بدون checksum (سناریوی sha256=None)
    flow.resources["target_version"] = "0.30.0"
    flow.resources["target_sha256"] = None
    monkeypatch.setattr(prompts, "_NON_INTERACTIVE", non_interactive)
    return flow


# ─── (الف) توقف گام headscale بدون checksum — تعاملی و غیرتعاملی ────────

def test_step_headscale_without_checksum_stops_interactive(tmp_path, monkeypatch):
    flow = _flow_for_headscale_step(tmp_path, monkeypatch, non_interactive=False)
    # بدون شبکه → checksum نسخهٔ 0.30.0 نه در جدول پین‌شده و نه از checksums.txt
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})
    monkeypatch.setattr(hs_installer, "current_version", lambda: None)
    downloads = []
    monkeypatch.setattr(
        hs_installer, "download",
        lambda *a, **kw: downloads.append(a) or pytest.fail("دانلود بدون checksum نباید رخ می‌داد"),
    )

    with pytest.raises(NeedsActionError) as excinfo:
        flow._step_headscale(Step("دانلود و نصب headscale"))
    assert "SHA-256" in str(excinfo.value), "پیام باید صریحاً SHA-256 را نام ببرد"
    assert "0.30.0" in str(excinfo.value)
    assert "الزام امنیتی" in str(excinfo.value)
    assert downloads == []


def test_step_headscale_without_checksum_stops_non_interactive(tmp_path, monkeypatch):
    """حالت غیرتعاملی — پیش‌تر همین مسیر «بی‌صدا» ادامه می‌یافت (ایراد 4.5)."""
    flow = _flow_for_headscale_step(tmp_path, monkeypatch, non_interactive=True)
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})
    monkeypatch.setattr(hs_installer, "current_version", lambda: None)
    monkeypatch.setattr(
        hs_installer, "download",
        lambda *a, **kw: pytest.fail("دانلود بدون checksum نباید رخ می‌داد"),
    )

    with pytest.raises(NeedsActionError) as excinfo:
        flow._step_headscale(Step("دانلود و نصب headscale"))
    assert "SHA-256" in str(excinfo.value)
    assert "الزام امنیتی" in str(excinfo.value)


def test_step_headscale_pinned_version_resolves_offline(tmp_path, monkeypatch, capsys):
    """مسیر سالم: نسخهٔ پین‌شده بدون شبکه → checksum از constants می‌آید (توقف کاذب نه)."""
    flow = _flow_for_headscale_step(tmp_path, monkeypatch, non_interactive=True)
    flow.answers.headscale_version = "0.29.5"
    flow.resources["target_version"] = "0.29.5"
    flow.resources["target_sha256"] = None
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})
    monkeypatch.setattr(hs_installer, "current_version", lambda: None)
    flow.dry_run = True  # برنامه‌ریزی — دانلود واقعی نمی‌خواهیم

    result = flow._step_headscale(Step("دانلود و نصب headscale"))
    out = capsys.readouterr().out
    assert "نسخه هدف: 0.29.5" in out
    assert C.PINNED_HS_SHA256_AMD64 in out or "SHA-256" in out
    assert result  # گام بدون توقف کامل شد


# ─── (ب) download — مسیر واقعی مقایسهٔ هش ───────────────────────────────

def test_download_rejects_missing_or_malformed_checksum(tmp_path):
    dest = tmp_path / "headscale.deb"
    with pytest.raises(hs_installer.HemDownloadError):
        hs_installer.download("http://example.com/x.deb", dest, expected_sha256=None)
    with pytest.raises(hs_installer.HemDownloadError):
        hs_installer.download("http://example.com/x.deb", dest, expected_sha256="not-a-hash")
    assert not dest.exists(), "هیچ فایلی نباید ساخته شود"


def test_download_wrong_hash_raises_and_no_install(tmp_path, monkeypatch):
    payload = b"FAKE-DEB-BODY-" * 200
    monkeypatch.setattr(
        "urllib.request.urlopen", lambda *a, **kw: _Resp(payload)
    )
    dest = tmp_path / "headscale.deb"
    wrong_hash = "0" * 64
    with pytest.raises(hs_installer.HemDownloadError) as excinfo:
        hs_installer.download("http://example.com/x.deb", dest, expected_sha256=wrong_hash)
    assert "SHA-256" in str(excinfo.value)
    assert not dest.exists(), "فایل نامعتبر باید حذف شود و نصب نشود"

    # همان بدنه با هش درست → موفق (اثبات اینکه مسیر مقایسه واقعی است)
    good_hash = hashlib.sha256(payload).hexdigest()
    result = hs_installer.download("http://example.com/x.deb", dest, expected_sha256=good_hash)
    assert result == dest
    assert dest.read_bytes() == payload


def test_download_network_error_cleans_partial_file(tmp_path, monkeypatch):
    """شکست میانهٔ دانلود → فایل ناقص پاک می‌شود (حفظ رفتار partial-download)."""

    def _flaky(url, timeout=None):
        raise OSError("connection reset")

    class _Req:
        pass

    monkeypatch.setattr("urllib.request.Request", lambda *a, **kw: _Req())
    monkeypatch.setattr("urllib.request.urlopen", _flaky)
    dest = tmp_path / "headscale.deb"
    with pytest.raises(OSError):
        hs_installer.download("http://example.com/x.deb", dest, expected_sha256="a" * 64)
    assert not dest.exists(), "فایل ناقص نباید بماند"


# ─── (د) بدنهٔ کوتاه/ناقص → ناهمخوانی کشف می‌شود ─────────────────────────

def test_download_truncated_body_detected(tmp_path, monkeypatch):
    payload = b"REAL-DEB-BODY-" * 500
    truncated = payload[: len(payload) // 3]
    # سرور ادعای طول کامل را دارد ولی فقط بخشی می‌رسد (شبیه قطع دانلود)
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda *a, **kw: _Resp(truncated, content_length=len(payload)),
    )
    dest = tmp_path / "headscale.deb"
    expected_full = hashlib.sha256(payload).hexdigest()  # هشِ «فایل کامل»
    with pytest.raises(hs_installer.HemDownloadError):
        hs_installer.download("http://example.com/x.deb", dest, expected_sha256=expected_full)
    assert not dest.exists()


# ─── (ج) ارتقا: checksum غیرقابل‌حل نسخهٔ جدید → توقف قبل از دانلود ───────

def test_update_unresolvable_checksum_aborts_before_new_download(
    tmp_path, monkeypatch, capsys
):
    from hem import cli
    from hem.system import services

    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(C, "STATE_FILE", str(tmp_path / "state.json"))
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})
    monkeypatch.setattr(hs_installer, "current_version", lambda: "0.29.5")
    monkeypatch.setattr(hs_installer, "is_installed", lambda: True)

    downloads, installs = [], []

    def fake_download(url, dest, expected_sha256=None, **kw):
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"DEB-BYTES:" + url.encode())
        downloads.append(url)
        return dest

    monkeypatch.setattr(hs_installer, "download", fake_download)
    monkeypatch.setattr(
        hs_installer, "install_deb", lambda path: installs.append(str(path))
    )
    monkeypatch.setattr(
        "hem.backup.create.create_backup",
        lambda output=None, **kw: (tmp_path / "backup.tar.gz"),
    )
    (tmp_path / "backup.tar.gz").write_bytes(b"fake-backup")
    monkeypatch.setattr(services, "systemctl", lambda action, unit=None, **kw: None)
    monkeypatch.setattr(services, "service_active", lambda unit: False)
    monkeypatch.setattr(services, "wait_healthy", lambda unit, timeout=60, **kw: True)

    # بستهٔ rollback نسخهٔ قبلی ممکن است از اجرای قبلی مانده باشد — برای قطعیت پاک می‌شود
    rollback_deb = Path("/var/tmp") / "hem-rollback-headscale-0.29.5-amd64.deb"
    rollback_deb.unlink(missing_ok=True)

    args = SimpleNamespace(check=False, version="0.30.0", yes=True)
    rc = cli.cmd_update(args)
    out = capsys.readouterr().out

    assert rc == C.EXIT_ERROR
    # پیام توقف امنیتی با ذکر SHA-256
    assert "SHA-256" in out
    assert "الزام امنیتی" in out
    # دانلودِ نسخهٔ جدید هرگز شروع نشد — تنها دانلود مجاز، بستهٔ rollback قبلی است
    assert downloads, "بستهٔ نسخهٔ قبلی (برای rollback) باید دانلود شده باشد"
    assert all("0.29.5" in url for url in downloads), downloads
    assert not any("0.30.0" in url for url in downloads), downloads
    # نصب فقط بستهٔ قبلی (rollback) — نه نسخهٔ جدید
    assert len(installs) == 1
    assert "0.29.5" in installs[0]
    # گزارش صادقانهٔ rollback
    assert "بازگشت به نسخهٔ قبلی (0.29.5) کامل شد" in out
