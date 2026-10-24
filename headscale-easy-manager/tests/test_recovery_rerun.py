"""تست §۵ (v0.3.1) — «اجرای دوبارهٔ عملیات پس از خطا» با نتیجهٔ واقعی.

سناریو (صادقانه — dry-run است، پس هیچ تغییری واقعاً اعمال نمی‌شود و این با
snapshot مسیرهای حساس هم اثبات می‌شود):
  ۱) اجرای اول با answers ناقص (magic_dns_base == domain — قید رسمی Headscale)
     → خطا: خروج غیرصفر + پیام فارسی قابل‌مشاهده.
  ۲) اصلاح answers → اجرای دوباره → خروج ۰ + «۱۷ گام موفق» (نتیجهٔ واقعی
     از منطق واقعیِ برنامه‌ریزی، نه فقط کد خروج).
  ۳) اجرای «مجدد» همان dry-run موفق → همان گام‌های موفق به همان ترتیب
     (خروجی قطعی/idempotent) — دوباره‌اجرایی پس از موفقیت هم امن است.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

_IGNORE = shutil.ignore_patterns(
    ".git", "__pycache__", ".pytest_cache", "*.pyc", "*.pyo",
    ".hem-backup-*", "hem-report-*.txt",
)

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

# نقض قید رسمی Headscale: magic_dns_base == domain
_BROKEN_CONF = _GOOD_CONF.replace("magic_dns_base: ts.dryrun.example.com", "magic_dns_base: dryrun.example.com")

_GUARDED_PATHS = (
    Path("/opt/headscale-easy-manager"),
    Path("/usr/local/bin/hsctl"),
    Path("/etc/hem/state.json"),
    Path("/etc/headscale/config.yaml"),
)

# عنوانِ گام («گام N/17 — عنوان») قطعی است؛ متن نتیجهٔ بعضی گام‌ها به شبکه
# وابسته است (مثلاً گام ۴/۷: IP عمومی و وضعیت DNS) و برای مقایسهٔ idempotency
# فقط عناوين مقایسه می‌شوند تا تست از نوسان شبکه قرمز کاذب نگیرد.
_STEP_RE = re.compile(r"^\[✓\] (گام \d+/17 — [^—]+)")


def _tmp_repo(tmp_path: Path) -> Path:
    dst = tmp_path / "repo"
    shutil.copytree(REPO, dst, ignore=_IGNORE)
    return dst


def _write_conf(tmp_path: Path, name: str, content: str) -> str:
    path = tmp_path / name
    path.write_text(content, encoding="utf-8")
    return str(path)


def _run_install_sh(repo: Path, *args: str) -> subprocess.CompletedProcess:
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
    return {p: p.exists() for p in _GUARDED_PATHS}


def _assert_untouched(before: dict) -> None:
    for path, existed in before.items():
        assert path.exists() == existed, f"وجود «{path}» تغییر کرد (قبل: {existed}، بعد: {path.exists()})"
    assert not Path("/opt/headscale-easy-manager").exists()
    assert not Path("/usr/local/bin/hsctl").exists()


def _ok_steps(output: str) -> list[str]:
    out: list[str] = []
    for line in output.splitlines():
        m = _STEP_RE.match(line.strip())
        if m:
            out.append(m.group(1))
    return out


def test_rerun_after_error(tmp_path):
    """خطا → اصلاح → دوباره → موفقیت واقعی؛ سپس اجرای مجدد → همان خروجی."""
    repo = _tmp_repo(tmp_path)
    broken = _write_conf(tmp_path, "broken.conf", _BROKEN_CONF)
    good = _write_conf(tmp_path, "good.conf", _GOOD_CONF)
    before = _snapshot()

    # ۱) اجرای اول: خطا — خروج غیرصفر + پیام فارسی + هیچ تغییری
    r1 = _run_install_sh(repo, "--dry-run", "--config", broken, "--non-interactive", "--yes")
    out1 = r1.stdout + r1.stderr
    assert r1.returncode != 0, f"answers ناقص باید خطا بدهد؛ خروجی:\n{out1}"
    assert "magic" in out1 or "MagicDNS" in out1 or "دامنه" in out1, "پیام خطا قابل‌مشاهده نیست"
    _assert_untouched(before)

    # ۲) اصلاح → اجرای دوباره: موفقیت واقعی (نه فقط کد ۰ — نشانگرهای منطق)
    r2 = _run_install_sh(repo, "--dry-run", "--config", good, "--non-interactive", "--yes")
    out2 = r2.stdout + r2.stderr
    assert r2.returncode == 0, f"پس از اصلاح باید موفق شود؛ خروجی:\n{out2}"
    assert "17 گام موفق" in out2, "جمع‌بندی ۱۷گامی نیست"
    assert "هیچ تغییری واقعاً اعمال نشد" in out2
    steps2 = _ok_steps(out2)
    assert len(steps2) == 17, "۱۷ گام موفق انتظار می‌رفت؛ {} گام پیدا شد".format(len(steps2))
    _assert_untouched(before)

    # ۳) اجرای مجدد همان dry-run موفق → خروجی قطعی (همان گام‌ها به همان ترتیب)
    r3 = _run_install_sh(repo, "--dry-run", "--config", good, "--non-interactive", "--yes")
    out3 = r3.stdout + r3.stderr
    assert r3.returncode == 0
    steps3 = _ok_steps(out3)
    assert steps3 == steps2, "اجرای مجدد dry-run نباید خروجی گام‌ها را عوض کند"
    assert "17 گام موفق" in out3
    _assert_untouched(before)
