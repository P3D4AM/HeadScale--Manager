"""تست ۴.۷ — rollback واقعی ارتقا (AUDIT §1 ردیف 4.7).

  (الف) شکست راه‌اندازی نسخهٔ جدید (wait_healthy=False) → دنبالهٔ rollback واقعی
        اجرا می‌شود: بستهٔ قدیمی نصب مجدد، سرویس راه‌اندازی؛ خروجی صادقانه
        «هم شکست ارتقا و هم نتیجهٔ بازگشت» را دارد؛ کد خروج ۱.
  (ب) شکست خود rollback هم → هر دو شکست گزارش می‌شوند؛ هرگز «بازگشت انجام شد»
        ادعا نمی‌شود؛ کد خروج ۱.
  (ج) گارد پرش نسخه همچنان کار می‌کند + آماده‌سازی rollback بدون checksum رسمی
        نسخهٔ فعلی → توقف «قبل از هر تغییری» (نه stop، نه نصب).
"""

import argparse
from pathlib import Path

from hem import constants as C
from hem.headscale import installer as hs_installer
from hem.headscale import releases

_ROLLBACK_DEB = Path("/var/tmp") / "hem-rollback-headscale-0.29.5-amd64.deb"
_NEW_DEB = Path("/var/tmp") / "hem-headscale-0.30.0.deb"


def _run_update(tmp_path, monkeypatch, capsys, *, current="0.29.5", target="0.30.0",
                wait_results=None, checksums=None):
    """اجرای cmd_update با شبیه‌سازی کامل عوارض جانبی — خروجی: (rc, out, ضبط‌ها)."""
    from hem import cli
    from hem.system import services

    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(C, "STATE_FILE", str(tmp_path / "state.json"))

    # checksums: {version: sha} — نسخه‌های غایب «غیرقابل‌حل» می‌شوند (پین‌شده همیشه هست)
    if checksums is None:
        checksums = {"0.30.0": "a" * 64}  # 0.29.5 از جدول پین‌شده constants می‌آید

    def fake_fetch_checksums(version):
        return {
            releases.deb_filename(version, "amd64"): sha
            for ver, sha in checksums.items()
            if ver == version
        }

    monkeypatch.setattr(releases, "fetch_checksums", fake_fetch_checksums)

    version_state = {"ver": current}
    monkeypatch.setattr(hs_installer, "current_version", lambda: version_state["ver"])
    monkeypatch.setattr(hs_installer, "is_installed", lambda: True)

    downloads, installs, systemctl_actions, wait_calls = [], [], [], []

    def fake_download(url, dest, expected_sha256=None, **kw):
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"DEB-BYTES:" + url.encode())
        downloads.append(url)
        return dest

    def fake_install_deb(path):
        installs.append(str(path))
        # شبیه‌سازی apt: نصب هر بسته نسخهٔ گزارش‌شده را عوض می‌کند
        version_state["ver"] = "0.30.0" if "0.30.0" in str(path) else "0.29.5"

    monkeypatch.setattr(hs_installer, "download", fake_download)
    monkeypatch.setattr(hs_installer, "install_deb", fake_install_deb)

    backup_file = tmp_path / "backup.tar.gz"
    backup_file.write_bytes(b"fake-backup")
    monkeypatch.setattr(
        "hem.backup.create.create_backup", lambda output=None, **kw: backup_file
    )

    monkeypatch.setattr(
        services, "systemctl",
        lambda action, unit=None, **kw: systemctl_actions.append((action, unit)),
    )
    monkeypatch.setattr(services, "service_active", lambda unit: False)
    waits = iter(wait_results if wait_results is not None else [False])
    monkeypatch.setattr(
        services, "wait_healthy",
        lambda unit, timeout=60, **kw: wait_calls.append(unit) or next(waits),
    )
    monkeypatch.setattr(
        "hem.headscale.config.validate_config", lambda: (True, "ok")
    )

    # بسته‌های اجرای قبلی نباید نتیجه را الکی آماده کنند
    _ROLLBACK_DEB.unlink(missing_ok=True)
    _NEW_DEB.unlink(missing_ok=True)

    args = argparse.Namespace(check=False, version=target, yes=True)
    rc = cli.cmd_update(args)
    out = capsys.readouterr().out
    return rc, out, {
        "downloads": downloads, "installs": installs,
        "systemctl": systemctl_actions, "wait_calls": wait_calls,
    }


# ─── (الف) شکست start نسخهٔ جدید → rollback واقعی اجرا می‌شود ───────────

def test_update_start_failure_triggers_real_rollback(tmp_path, monkeypatch, capsys):
    rc, out, rec = _run_update(
        tmp_path, monkeypatch, capsys, wait_results=[False, True],
    )
    assert rc == C.EXIT_ERROR

    # شکست ارتقا صادقانه گزارش شد
    assert "به‌روزرسانی ناموفق بود" in out
    assert "راه‌اندازی و بررسی سلامت" in out  # نام گام شکست‌خورده

    # دنبالهٔ واقعی: بستهٔ جدید نصب شد، سپس بستهٔ قدیمی (rollback) نصب مجدد شد
    assert len(rec["installs"]) == 2, rec["installs"]
    assert "0.30.0" in rec["installs"][0], "ابتدا بستهٔ جدید"
    assert "0.29.5" in rec["installs"][1], "سپس بستهٔ قدیمی در rollback"
    assert _ROLLBACK_DEB.exists(), "بستهٔ rollback واقعاً باید آماده/دانلود شده باشد"

    # سرویس: stop (ارتقا) → start (جدید) → start (rollback)
    actions = [a for a, _u in rec["systemctl"]]
    assert actions.count("stop") >= 1
    assert actions.count("start") >= 2, actions

    # خروجی هر دو واقعیت را دارد: شکست ارتقا + نتیجهٔ بازگشت
    assert "بازگشت به نسخهٔ قبلی" in out
    assert "بازگشت به نسخهٔ قبلی (0.29.5) کامل شد" in out

    # شناسنامهٔ rollback با مسیرها نوشته شده است
    manifests = list((tmp_path / "backups" / "updates").glob("*/manifest.json"))
    assert manifests, "manifest بازگشت باید نوشته شود"
    import json

    data = json.loads(manifests[0].read_text(encoding="utf-8"))
    assert data["old_version"] == "0.29.5"
    assert data["new_version"] == "0.30.0"
    assert data["deb_path"].endswith(".deb")
    assert data["db_backup"].endswith("backup.tar.gz")


# ─── (ب) شکست خود rollback → هر دو شکست گزارش می‌شوند ──────────────────

def test_update_rollback_failure_reports_both_failures(tmp_path, monkeypatch, capsys):
    rc, out, rec = _run_update(
        tmp_path, monkeypatch, capsys, wait_results=[False, False],
    )
    assert rc == C.EXIT_ERROR
    # شکست ارتقا
    assert "به‌روزرسانی ناموفق بود" in out
    # شکست rollback — و هرگز ادعای موفقیتِ بازگشت نمی‌شود
    assert "بازگشت به نسخهٔ قبلی هم ناموفق بود" in out
    assert "بازگشت به نسخهٔ قبلی (0.29.5) کامل شد" not in out
    # تلاش rollback انجام شده (نصب بستهٔ قدیمی) ولی start دوم هم شکست خورده
    assert any("0.29.5" in p for p in rec["installs"])
    assert len(rec["wait_calls"]) == 2


# ─── (ج) گارد پرش نسخه + توقف آماده‌سازی rollback بدون checksum ─────────

def test_version_jump_guard_and_unresolvable_old_checksum(tmp_path, monkeypatch, capsys):
    """پرش 0.23.0→0.30.0 هشدار می‌دهد؛ بدون checksum نسخهٔ فعلی، قبل از هر تغییری می‌ایستد."""
    rc, out, rec = _run_update(
        tmp_path, monkeypatch, capsys,
        current="0.23.0", target="0.30.0",
        wait_results=[True],
        checksums={"0.30.0": "a" * 64},  # 0.23.0 عمداً بدون checksum رسمی
    )
    # هشدار پرش نسخه (گارد قديم همچنان برقرار است)
    assert "یک پرش نسخه است" in out
    assert rc == C.EXIT_ERROR
    assert "SHA-256" in out, "دلیل توقف باید ذکر شود"
    # توقف «قبل از هر تغییری»: نه stop، نه نصب، نه دانلود نسخهٔ جدید
    assert rec["systemctl"] == [], rec["systemctl"]
    assert rec["installs"] == [], rec["installs"]
    assert rec["downloads"] == [], rec["downloads"]
    assert "هنوز هیچ تغییری روی سرویس/بسته اعمال نشده بود" in out


def test_rollback_config_restore_on_configtest_failure(tmp_path, monkeypatch, capsys):
    """شکست configtest نسخهٔ جدید → پیکربندی پیش از ارتقا در rollback بازمی‌گردد."""
    from hem import cli
    from hem.system import services

    monkeypatch.setattr(C, "BACKUP_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(C, "STATE_FILE", str(tmp_path / "state.json"))
    monkeypatch.setattr(
        releases, "fetch_checksums",
        lambda version: {releases.deb_filename(version, "amd64"): "a" * 64},
    )
    version_state = {"ver": "0.29.5"}
    monkeypatch.setattr(hs_installer, "current_version", lambda: version_state["ver"])

    def fake_download(url, dest, expected_sha256=None, **kw):
        dest = Path(dest)
        dest.write_bytes(b"DEB")
        return dest

    def fake_install_deb(path):
        version_state["ver"] = "0.30.0" if "0.30.0" in str(path) else "0.29.5"

    monkeypatch.setattr(hs_installer, "download", fake_download)
    monkeypatch.setattr(hs_installer, "install_deb", fake_install_deb)
    monkeypatch.setattr(
        "hem.backup.create.create_backup", lambda output=None, **kw: tmp_path / "b.tar.gz"
    )
    (tmp_path / "b.tar.gz").write_bytes(b"x")
    monkeypatch.setattr(services, "systemctl", lambda action, unit=None, **kw: None)
    monkeypatch.setattr(services, "service_active", lambda unit: False)
    monkeypatch.setattr(services, "wait_healthy", lambda unit, timeout=60, **kw: True)

    # پیکربندی «واقعی» سرور + configtest ردشده روی نسخهٔ جدید
    cfg_dir = tmp_path / "headscale"
    cfg_dir.mkdir()
    config_path = cfg_dir / "config.yaml"
    config_path.write_text("server_url: https://health.example.com\n", encoding="utf-8")
    monkeypatch.setattr(C, "HEADSCALE_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(
        "hem.headscale.config.validate_config", lambda: (False, "unknown key: new_option")
    )

    _ROLLBACK_DEB.unlink(missing_ok=True)
    _NEW_DEB.unlink(missing_ok=True)
    rc = cli.cmd_update(argparse.Namespace(check=False, version="0.30.0", yes=True))
    out = capsys.readouterr().out

    assert rc == C.EXIT_ERROR
    assert "configtest رد شد" in out
    assert "بازگشت به نسخهٔ قبلی (0.29.5) کامل شد" in out
    assert "پیکربندی پیش از ارتقا بازگردانده شد" in out
    # فایل پیکربندی بازگردانده شد (محتوای pre-update همان است)
    assert "server_url: https://health.example.com" in config_path.read_text(encoding="utf-8")
