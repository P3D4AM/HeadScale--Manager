"""تست چک «خطاهای اخیر سرویس» دکتر — تفکیک درست چهار حالت خروجی journalctl.

گزارش کاربر: پس از نصب موفق، دکتر هشدار کاذب می‌داد:
    [!] خطاهای اخیر سرویس؟
        وضعیت: 1 رکورد خطا در لاگ اخیر دیده شد. نمونه:
             -- No entries --
ریشه: پیام نمایشی خودِ journalctl (که در نبود رکوردِ مطابق فیلتر، روی stdout
چاپ می‌شود) به‌عنوان «رکورد خطا» شمرده می‌شد و کد خروج دستور هم بررسی نمی‌شد.

این تست‌ها چهار حالت را قفل می‌کنند:
  ۱) خروجی فقط «-- No entries --» → ok (نه هشدار)
  ۲) خروجی کاملاً خالی → ok
  ۳/۴) رکورد خطای واقعی (یکی/چندتا، حتی مخلوط با پیام‌های نمایشی) → warn
       با شمارش درست و نمایش نمونه
  ۵) شکست اجرای journalctl (HemExecError) → warn «بررسی لاگ انجام نشد»
  ۶) کد خروج غیرصفر → warn «بررسی لاگ انجام نشد» (متمایز از ok)
  ۷) پیام‌های نمایشی journalctl («-- Journal begins … --»، «-- Reboot --»)
     هرگز خطا شمرده نمی‌شوند
  ۸/۹) منطق واحد: هم «hsctl doctor» و هم «hsctl report» از همان
       _check_logs می‌گذرند (جایگزینی marker در هر دو دیده می‌شود)
"""

import json

from hem.core.exec import ExecResult, HemExecError
from hem.diagnostics import doctor
from hem.diagnostics.doctor import Check

# ─── ابزار ساخت نتیجهٔ شبیه‌سازی‌شدهٔ journalctl ─────────────────────────


def _res(code=0, stdout="", stderr=""):
    return ExecResult(code, stdout, stderr, ["journalctl", "…"])


def _patch_run(monkeypatch, result=None, error=None):
    """جایگزینی doctor.run با نتیجه/خطای دلخواه — لایهٔ اجرای فرمان شبیه‌سازی می‌شود."""
    def fake_run(cmd, **kwargs):
        if error is not None:
            raise error
        return result
    monkeypatch.setattr(doctor, "run", fake_run)


# ─── حالت ۱: خروجی فقط «-- No entries --» (دقیقاً گزارش کاربر) ───────────


def test_no_entries_notice_is_ok(monkeypatch):
    """«-- No entries --» پیام نمایشی است، نه رکورد خطا — نباید هشدار بسازد."""
    _patch_run(monkeypatch, result=_res(stdout="-- No entries --\n"))
    check = doctor._check_logs()
    assert check.status == "ok", check.problem
    assert "پیدا نشد" in check.problem
    # متن قدیمیِ گمراه‌کننده نباید برگردد
    assert "رکورد خطا در لاگ اخیر" not in check.problem
    assert "-- No entries --" not in check.problem


def test_no_entries_without_trailing_newline_is_ok(monkeypatch):
    """بدون خط جدید انتهایی هم همان نتیجه."""
    _patch_run(monkeypatch, result=_res(stdout="-- No entries --"))
    check = doctor._check_logs()
    assert check.status == "ok", check.problem


# ─── حالت ۲: خروجی کاملاً خالی ──────────────────────────────────────────


def test_empty_output_is_ok(monkeypatch):
    _patch_run(monkeypatch, result=_res(stdout=""))
    check = doctor._check_logs()
    assert check.status == "ok", check.problem
    assert "پیدا نشد" in check.problem


# ─── حالت ۳: یک خطای واقعی ─────────────────────────────────────────────


def test_single_real_error_is_warn_with_sample(monkeypatch):
    line = "Oct 25 10:00:00 srv headscale[99]: failed to listen on :8080"
    _patch_run(monkeypatch, result=_res(stdout=line + "\n"))
    check = doctor._check_logs()
    assert check.status == "warn", check.problem
    assert "1 رکورد خطا" in check.problem
    assert line in check.problem  # نمونهٔ خطا نمایش داده می‌شود
    assert "hsctl logs" in check.fix


# ─── حالت ۴: چند خطای واقعی (مخلوط با پیام‌های نمایشی) ──────────────────


def test_multiple_real_errors_counted_correctly(monkeypatch):
    stdout = "\n".join([
        "-- Journal begins at Sat 2026-10-25 08:00:00 UTC. --",
        "Oct 25 10:00:00 srv headscale[99]: error one",
        "-- Reboot --",
        "Oct 25 10:01:00 srv headscale[99]: error two",
        "Oct 25 10:02:00 srv headscale[99]: error three",
        "-- No entries --",  # حتی اگر وسط خروجی باشد، نمایشی است
        "",
        "   ",
    ]) + "\n"
    _patch_run(monkeypatch, result=_res(stdout=stdout))
    check = doctor._check_logs()
    assert check.status == "warn", check.problem
    assert "3 رکورد خطا" in check.problem  # فقط رکوردهای واقعی شمرده می‌شوند
    assert "error three" in check.problem  # آخرین رکورد به‌عنوان نمونه


# ─── حالت ۵: شکست اجرای خود دستور (نبود journalctl/تایم‌اوت) ────────────


def test_journalctl_missing_is_check_failed_not_ok(monkeypatch):
    """اجرای نشدنِ خود بررسی ≠ نبود خطا — باید صادقانه «انجام نشد» بگوید."""
    _patch_run(monkeypatch, error=HemExecError(None, "فرمان پیدا نشد: journalctl"))
    check = doctor._check_logs()
    assert check.status == "warn", check.problem
    assert "انجام نشد" in check.problem
    assert "نبود خطا قطعی نیست" in check.problem
    assert "journalctl" in check.fix


# ─── حالت ۶: کد خروج غیرصفر ────────────────────────────────────────────


def test_nonzero_exit_is_check_failed_with_stderr_detail(monkeypatch):
    _patch_run(monkeypatch, result=_res(
        code=1, stderr="Failed to add match ...\nHint: journal is not accessible\n",
    ))
    check = doctor._check_logs()
    assert check.status == "warn", check.problem
    assert "انجام نشد" in check.problem
    assert "کد خروج غیرصفر" in check.cause
    assert "journal is not accessible" in check.cause  # آخرین خط stderr به‌عنوان علت


def test_nonzero_exit_without_stderr_is_still_check_failed(monkeypatch):
    """حتی بدون stderr هم «انجام نشد» — هرگز ok اعلام نمی‌شود."""
    _patch_run(monkeypatch, result=_res(code=1))
    check = doctor._check_logs()
    assert check.status == "warn", check.problem
    assert "انجام نشد" in check.problem


# ─── حالت ۷: پیام‌های نمایشی journalctl هرگز خطا شمرده نمی‌شوند ──────────


def test_journal_notice_lines_alone_are_ok(monkeypatch):
    stdout = (
        "-- Journal begins at Sat 2026-10-25 08:00:00 UTC. --\n"
        "-- Reboot --\n"
    )
    _patch_run(monkeypatch, result=_res(stdout=stdout))
    check = doctor._check_logs()
    assert check.status == "ok", check.problem


def test_parser_unit_edge_cases():
    """تست مستقیم پارسر: خط خالی، فاصلهٔ خالی، پیام نمایشیِ با تورفتگی."""
    res = _res(stdout="  -- No entries --  \n\t\n  \n")
    assert doctor._journal_error_records(res) == []
    # خط واقعی با فاصلهٔ اضافی → نگه داشته می‌شود (trim شده)
    res = _res(stdout="  Oct 25 10:00:00 srv headscale[1]: boom  \n")
    assert doctor._journal_error_records(res) == ["Oct 25 10:00:00 srv headscale[1]: boom"]


# ─── حالت ۸/۹: منطق واحد در doctor و report ─────────────────────────────

_MARKER = "MARKER-LOGS-CHECK-999"


def _stub_all_checks(monkeypatch, logs_check=None):
    """جایگزینی همهٔ چک‌ها با نمونهٔ بی‌اثر؛ چک لاگ با نمونهٔ نشانه‌دار."""
    def ok_check(cid, title):
        return lambda *a, **kw: Check(cid, title, status="ok", problem="…")
    for cid, title in (
        ("service", "سرویس"), ("config", "پیکربندی"), ("dns", "DNS"),
        ("caddy", "Caddy"), ("ports", "پورت‌ها"), ("firewall", "فایروال"),
        ("disk", "دیسک"), ("versions", "نسخه‌ها"), ("noise_key", "کلید noise"),
    ):
        monkeypatch.setattr(doctor, f"_check_{cid}", ok_check(cid, title))
    monkeypatch.setattr(doctor, "_check_logs", lambda: logs_check)


def test_run_doctor_uses_shared_check(monkeypatch, capsys):
    """hsctl doctor از همان _check_logs می‌گذرد — خروجی JSON نشانگر را دارد."""
    marker_check = Check(
        "logs", "خطاهای اخیر سرویس؟", status="ok", problem=_MARKER,
    )
    _stub_all_checks(monkeypatch, logs_check=marker_check)
    doctor.run_doctor(fix=False, json_output=True)
    payload = json.loads(capsys.readouterr().out)
    logs = [c for c in payload["checks"] if c["id"] == "logs"]
    assert logs and logs[0]["problem"] == _MARKER


def test_build_report_uses_shared_check(monkeypatch, capsys):
    """گزارش وضعیت (hsctl report) هم از همان _check_logs می‌گذرد."""
    from hem.diagnostics import report as report_mod
    from hem.system import services

    marker_check = Check(
        "logs", "خطاهای اخیر سرویس؟", status="warn", problem=_MARKER,
        cause="علت آزمایشی", how_checked="…", fix="…",
    )
    _stub_all_checks(monkeypatch, logs_check=marker_check)
    # وابستگی‌های گزارش به سیستم — شبیه‌سازی بی‌اثر
    monkeypatch.setattr(doctor, "_load_state", lambda: {})
    monkeypatch.setattr(report_mod.hs_installer, "current_version", lambda: "0.29.5")
    monkeypatch.setattr(services, "service_active", lambda unit: False)
    monkeypatch.setattr(report_mod, "ufw_status_verbose", lambda: "")

    text = report_mod.build_report()
    assert _MARKER in text  # همان چک مشترک در گزارش هم می‌نشیند
    rendered = doctor.render_check(marker_check)
    assert rendered in text
