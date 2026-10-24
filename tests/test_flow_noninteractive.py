"""تست ۴.۲ — ترتیب گام‌ها (gather قبل از plan) و مسیر رضایت صریح --yes.

  (الف) غیرتعاملی بدون --config → شکست تمیز EXIT_* بدون traceback (با stdin بسته).
  (ب) --config معتبر بدون --yes → EXIT_NO_CONFIRM + پیام فارسی حاوی «--yes».
  (ج) --config و --yes → عبور از گام plan در حالت dry-run تا پایان جریان.
  (د) gather واقعاً قبل از plan اجرا می‌شود (ترتیب STEP_ORDER + شبیه‌سازی).
"""

import os
import re
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

REPO = Path(__file__).resolve().parents[1]

# پیکربندی معتبر — همان شکل examples/hem-install.conf.example
_GOOD_CONF = """\
domain: flow.example.com
magic_dns_base: ts.flow.example.com
headscale_version: "0.29.5"
caddy_mode: install
embedded_derp: true
firewall: true
ssh_port: "22"
first_user: admin
acme_email: ""
"""


def run_cli(*args):
    """اجرای python3 hsctl <args> با stdin بسته — الگوی tests/test_cli.py."""
    return subprocess.run(
        [sys.executable, "hsctl", *args],
        cwd=REPO,
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=300,
    )


# ---------------------------------------------------------------------------
# (الف) و (ب): سطح subprocess — واقعی‌ترین شکل، بدون mock
# ---------------------------------------------------------------------------

def test_noninteractive_without_config_fails_clean(tmp_path):
    conf = tmp_path / "unused.conf"
    conf.write_text(_GOOD_CONF, encoding="utf-8")  # موجود ولی عمداً پاس داده نمی‌شود
    result = run_cli("install", "--non-interactive", "--dry-run")

    out = result.stdout + result.stderr
    assert result.returncode != 0, "باید با کد غیرصفر تمیز متوقف شود"
    assert result.returncode in (1, 2, 3, 4, 5), "کد خروج باید از قرارداد FACTS §10 باشد"
    assert "Traceback" not in out, "شکست باید تمیز باشد، نه traceback"
    assert "حالت غیرتعاملی بدون --config" in out, "پیام فارسیِ نبودِ پیکربندی دیده نشد"
    # نباید تا plan برسد (gather قبل از plan شکست می‌خورد)
    assert "برنامه تغییرات:" not in out


def test_noninteractive_config_without_yes_is_exit_no_confirm(tmp_path):
    conf = tmp_path / "good.yaml"
    conf.write_text(_GOOD_CONF, encoding="utf-8")
    result = run_cli(
        "install", "--dry-run", "--non-interactive", "--config", str(conf)
    )

    out = result.stdout + result.stderr
    assert result.returncode == 5, (
        f"انتظار EXIT_NO_CONFIRM(5)؛ دریافت‌شده {result.returncode}\nخروجی:\n{out}"
    )
    assert "Traceback" not in out
    # پیام فارسی الزامی — دقیقاً متن قرارداد ۴.۲:
    assert "در حالت غیرتعاملی، اجرای برنامهٔ تغییرات نیازمند --yes صریح است" in out
    assert "--yes" in out
    # وجود فایل پیکربندی رضایت ضمنی نیست: گام plan رسیده و متوقف شده
    assert "برنامه تغییرات:" in out, "برنامه باید نمایش داده شده و سپس متوقف شود"


def test_noninteractive_with_yes_reaches_past_plan(tmp_path, monkeypatch, capsys):
    """(ج) با --config و --yes در حالت dry-run از plan عبور می‌کند و تا انتها می‌رود."""
    from hem.headscale import releases
    from hem.installer.flow import InstallFlow
    from hem.network import dnscheck
    from hem.network import ips as net_ips

    conf = tmp_path / "good.yaml"
    conf.write_text(_GOOD_CONF, encoding="utf-8")

    # قطع وابستگی‌های شبکه برای قطعیت (الگوی monkeypatch در test_cameras.py)
    monkeypatch.setattr(net_ips, "public_ip_from_api", lambda: "203.0.113.10")
    monkeypatch.setattr(
        dnscheck, "check_domain",
        lambda domain, ips: SimpleNamespace(ok=True, advice="DNS درست است."),
    )
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})

    flow = InstallFlow(
        config_file=str(conf), non_interactive=True, dry_run=True, assume_yes=True
    )
    rc = flow.run()
    out = capsys.readouterr().out

    assert rc == 0, f"خروجی:\n{out}"
    assert "برنامه تغییرات:" in out
    assert "برنامه با تأیید صریح (--yes) پذیرفته شد" in out, "رضایت --yes ثبت نشد"
    # عبور واقعی از plan = رسیدن به گام‌های بعدی:
    assert "نصب بسته‌های پایه" in out, "گام packages (بعد از plan) اجرا نشد"
    assert "17 گام موفق" in out, "جریان تا انتها کامل نشد"


# ---------------------------------------------------------------------------
# (د): ترتیب gather قبل از plan — هم در تعریف و هم در اجرا
# ---------------------------------------------------------------------------

def test_step_order_gather_validate_before_plan():
    from hem.installer.flow import STEP_ORDER

    assert len(STEP_ORDER) == 17, "جریان باید ۱۷ گام بماند"
    assert STEP_ORDER.index("gather") < STEP_ORDER.index("plan"), (
        "gather باید قبل از plan باشد"
    )
    assert STEP_ORDER.index("validate") < STEP_ORDER.index("plan"), (
        "validate باید قبل از plan باشد"
    )
    assert STEP_ORDER.index("plan") < STEP_ORDER.index("packages"), (
        "plan باید قبل از گام‌های اعمال‌کننده باشد"
    )


def test_simulation_gather_runs_before_plan(tmp_path, monkeypatch, capsys):
    """شبیه‌سازی: شمارهٔ گامِ چاپ‌شدهٔ gather باید کوچکتر از plan باشد."""
    from hem.headscale import releases
    from hem.installer.flow import InstallFlow
    from hem.network import dnscheck
    from hem.network import ips as net_ips

    conf = tmp_path / "good.yaml"
    conf.write_text(_GOOD_CONF, encoding="utf-8")
    monkeypatch.setattr(net_ips, "public_ip_from_api", lambda: "203.0.113.10")
    monkeypatch.setattr(
        dnscheck, "check_domain",
        lambda domain, ips: SimpleNamespace(ok=True, advice="DNS درست است."),
    )
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})

    flow = InstallFlow(
        config_file=str(conf), non_interactive=True, dry_run=True, assume_yes=True
    )
    assert flow.run() == 0
    out = capsys.readouterr().out

    found = re.findall(r"گام (\d+)/17 — (.+?)(?: — |\n)", out)
    steps = {title: int(num) for num, title in found}
    assert "جمع‌آوری پاسخ‌های نصب" in steps, "گام gather در خروجی نیست"
    assert "نمایش برنامه تغییرات و تأیید" in steps, "گام plan در خروجی نیست"
    assert steps["جمع‌آوری پاسخ‌های نصب"] < steps["نمایش برنامه تغییرات و تأیید"], (
        f"gather ({steps['جمع‌آوری پاسخ‌های نصب']}) باید قبل از plan "
        f"({steps['نمایش برنامه تغییرات و تأیید']}) اجرا شود"
    )
    # پاسخ‌ها قبل از نمایش برنامه واقعی‌اند (نه پیش‌نمایش خالی):
    assert "برنامه تغییرات:" in out
    assert "دانلود headscale 0.29.5" in out, "برنامه باید نسخهٔ واقعی پاسخ‌ها را نشان دهد"
