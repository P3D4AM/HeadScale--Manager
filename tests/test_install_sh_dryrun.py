"""تست ۴.۱ — install.sh --dry-run.

قرارداد این تست‌ها (مطابق AUDIT §1 ردیف 4.1):
  (الف) dry-run با پیکربندی معتبر: کد خروج ۰ + خروجی حاوی نشانگرهای واقعیِ
        برنامه‌ریزی/اعتبارسنجی (نه فقط پیام خوش‌آمد) — چون hsctl «واقعی»
        از پوشهٔ سورس اجرا می‌شود، نه از INSTALL_DIR که در dry-run کپی نمی‌شود.
  (ب) dry-run با پیکربندی نامعتبر (caddy_mode: install_new): کد خروج غیرصفر
        و متن خطا قابل‌مشاهده — || true حذف شده است.
  (ج) هیچ فایلی زیر /opt یا /usr/local/bin (و /etc/hem) ساخته نمی‌شود.
  (د) dry-run بدون root کار می‌کند؛ نصب واقعی بدون root کد ۳ می‌دهد.
"""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

# پوشه‌هایی که در کپی موقت مخزن لازم نیستند
_IGNORE = shutil.ignore_patterns(
    ".git", "__pycache__", ".pytest_cache", "*.pyc", "*.pyo",
    ".hem-backup-*", "hem-report-*.txt",
)

# پیکربندی معتبر — کلیدها عیناً مطابق parser واقعی (answers.py)
_GOOD_CONF = """\
domain: dryrun.example.com
magic_dns_base: ts.dryrun.example.com
headscale_version: "0.29.5"
caddy_mode: install
embedded_derp: true
firewall: true
ssh_port: "22"
first_user: admin
acme_email: ""
"""

# پیکربندی نامعتبر — caddy_mode خارج از مجموعهٔ مجاز (ایراد ثبت‌شدهٔ ممیزی)
_BAD_CONF = _GOOD_CONF.replace("caddy_mode: install\n", "caddy_mode: install_new\n")

_GUARDED_PATHS = (
    Path("/opt/headscale-easy-manager"),
    Path("/usr/local/bin/hsctl"),
    Path("/etc/hem/state.json"),
    Path("/etc/hem/install-answers.yaml"),
    Path("/etc/headscale/config.yaml"),
)


def _tmp_repo(tmp_path: Path) -> Path:
    """کپی مخزن به پوشهٔ موقت (بدون .git/__pycache__) — شبیه‌سازی ماشین خالی."""
    dst = tmp_path / "repo"
    shutil.copytree(REPO, dst, ignore=_IGNORE)
    return dst


def _write_conf(tmp_path: Path, name: str, content: str) -> str:
    path = tmp_path / name
    path.write_text(content, encoding="utf-8")
    return str(path)


def _run_install_sh(repo: Path, *args: str) -> subprocess.CompletedProcess:
    """اجرای bash install.sh با stdin بسته (غیرتعاملی) به‌عنوان کاربر جاری."""
    env = dict(os.environ)
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    return subprocess.run(
        ["bash", "install.sh", *args],
        cwd=str(repo),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=300,
        env=env,
    )


def _snapshot() -> dict:
    """وجود مسیرهای حساس قبل از اجرا — برای اثبات «ایجاد نشدن»."""
    return {p: p.exists() for p in _GUARDED_PATHS}


def _assert_untouched(before: dict) -> None:
    for path, existed in before.items():
        assert path.exists() == existed, (
            f"dry-run نباید وجود «{path}» را تغییر می‌داد "
            f"(قبل: {existed}، بعد: {path.exists()})"
        )
    # قرارداد صریح تست (ج): مسیر نصب و symlink ساخته نشوند
    assert not Path("/opt/headscale-easy-manager").exists(), "dry-run نباید /opt/headscale-easy-manager بسازد"
    assert not Path("/usr/local/bin/hsctl").exists(), "dry-run نباید /usr/local/bin/hsctl بسازد"
    assert not list(Path("/opt").glob("headscale-easy-manager*")), "dry-run نباید چیزی زیر /opt بسازد"


def test_dryrun_valid_config_runs_real_planning(tmp_path):
    """(الف) خروج ۰ + نشانگرهای واقعی برنامه‌ریزی/اعتبارسنجی — فقط خوش‌آمد کافی نیست."""
    repo = _tmp_repo(tmp_path)
    conf = _write_conf(tmp_path, "good.conf", _GOOD_CONF)
    before = _snapshot()

    result = _run_install_sh(
        repo, "--dry-run", "--config", conf, "--non-interactive", "--yes"
    )

    out = result.stdout + result.stderr
    assert result.returncode == 0, f"خروجی:\n{out}"
    # نشانگرهای واقعیِ اجرای منطق (نه فقط پیام خوش‌آمد install.sh):
    assert "برنامه تغییرات:" in out, "بلوک برنامهٔ تغییرات (گام plan) چاپ نشد"
    assert "پاسخ‌ها از فایل خوانده شد" in out, "گام gather (parser واقعی) اجرا نشد"
    assert "بررسی پیش‌نیازها" in out, "گام preflight واقعاً اجرا نشد"
    assert "17 گام موفق" in out, "جمع‌بندی ۱۷گامی کامل نشد"
    assert "نشانگر [dry-run]" in out or "[dry-run]" in out, "نشانهٔ dry-run در خروجی نیست"
    # خلاصهٔ صادقانهٔ پایان dry-run:
    assert "هیچ تغییری واقعاً اعمال نشد" in out
    # (د) بدون root: تست‌ها با کاربر جاری اجرا می‌شوند؛ پیام صادقانه باید دیده شود
    if os.geteuid() != 0:
        assert "بدون root" in out, "پیام «dry-run بدون root» چاپ نشد"

    _assert_untouched(before)


def test_dryrun_invalid_config_fails_loudly(tmp_path):
    """(ب) پیکربندی نامعتبر: کد خروج غیرصفر + متن خطای فارسی قابل‌مشاهده."""
    repo = _tmp_repo(tmp_path)
    bad = _write_conf(tmp_path, "bad.conf", _BAD_CONF)
    before = _snapshot()

    result = _run_install_sh(
        repo, "--dry-run", "--config", bad, "--non-interactive", "--yes"
    )

    out = result.stdout + result.stderr
    assert result.returncode != 0, "خطای واقعی فرو داده شد (|| true قدیمی)"
    assert "install/reuse/skip" in out, "متن خطای اعتبارسنجی caddy_mode دیده نشد"
    assert "install_new" in out, "مقدار نامعتبر در پیام خطا نیست"
    assert "برنامه‌ریزی/اعتبارسنجی ناموفق بود" in out, "پیام صادقانهٔ شکست dry-run چاپ نشد"
    # نباید ادعای موفقیت کند:
    assert "هیچ تغییری واقعاً اعمال نشد؛ خروجی بالا" not in out
    assert "Traceback" not in out, "خطا باید تمیز باشد، نه traceback"

    _assert_untouched(before)


def test_dryrun_empty_machine_no_config_file(tmp_path):
    """(الف-مکمل) dry-run روی ماشین خالی حتی بدون --config به‌صورت تمیز شکست می‌خورد."""
    repo = _tmp_repo(tmp_path)
    before = _snapshot()

    result = _run_install_sh(repo, "--dry-run", "--non-interactive")

    out = result.stdout + result.stderr
    assert result.returncode != 0
    assert "حالت غیرتعاملی بدون --config" in out, "خطای تمیزِ نبودِ پیکربندی دیده نشد"
    assert "Traceback" not in out

    _assert_untouched(before)


@pytest.mark.skipif(os.geteuid() == 0, reason="این تست فقط با کاربر غیر root معنا دارد")
def test_real_install_without_root_exits_3(tmp_path):
    """(د) نصب واقعی (بدون --dry-run) بدون root همان قرارداد قدیمی: کد ۳ + راهنمای sudo."""
    repo = _tmp_repo(tmp_path)
    conf = _write_conf(tmp_path, "good.conf", _GOOD_CONF)

    result = _run_install_sh(
        repo, "--config", conf, "--non-interactive", "--yes"
    )

    out = result.stdout + result.stderr
    assert result.returncode == 3, f"انتظار کد ۳ (نیاز به root)؛ خروجی:\n{out}"
    assert "sudo" in out
    # و هیچ چیزی نباید ساخته شده باشد (سرعت توقف: قبل از بخش ۵)
    _assert_untouched(_snapshot())
