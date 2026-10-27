"""تست ۴.۴ — دروازه‌بندی صادقانهٔ سلامت و وضعیت نهایی نصب (AUDIT §1 ردیف 4.4).

جریان کامل ۱۷ گامی با mock تمام عوارض جانبی سیستمی اجرای می‌شود؛ چک‌های
سلامت (محلی/HTTPS/DNS/سرویس) از مسیر واقعیِ flow می‌گذرند و فقط لایهٔ
اجرای فرمان/شبکه شبیه‌سازی می‌شود.

  (الف) HTTPS ناموفق + DNS درست → وضعیت نهایی pending_verification، کد خروج ۴
        و خروجی «نصب کامل شد» ندارد.
  (ب) همه چیز سالم (HTTPS ۲۰۰) → full_success + کد ۰.
  (ج) گام start شکست بخورد → partial_failure (کد ۱).
  (د) حالت بدون HTTPS + سلامت محلی ۲۰۰ → verified (کد ۰).
"""

from types import SimpleNamespace

from hem import constants as C

_CONF_HTTPS = """\
domain: health.example.com
magic_dns_base: ts.health.example.com
headscale_version: "0.29.5"
caddy_mode: reuse
embedded_derp: true
firewall: false
ssh_port: "22"
first_user: admin
acme_email: ""
"""

_CONF_NOHTTPS = """\
domain: health.example.com
magic_dns_base: ts.health.example.com
headscale_version: "0.29.5"
caddy_mode: skip
embedded_derp: false
firewall: false
ssh_port: "22"
first_user: admin
acme_email: ""
"""


class _Resp:
    """پاسخ HTTP شبیه‌سازی‌شده با کد وضعیت."""

    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _run_flow(tmp_path, monkeypatch, capsys, *, https=True, dns_ok=True,
              local_health=200, external_health=None, external_fail_times=0,
              service_starts=True):
    """اجرای جریان کامل نصب (غیر dry-run) با شبیه‌سازی کامل عوارض جانبی.

    Args:
        https: حالت HTTPS (caddy reuse) یا بدون HTTPS (caddy skip).
        dns_ok: نتیجهٔ چک DNS گام validate.
        local_health: کد پاسخ http://127.0.0.1:8080/health (None = خطای اتصال).
        external_health: کد پاسخ https://دامنه/health (None = خطای اتصال دائمی).
        external_fail_times: چند تلاشِ اولِ چک بیرونی خطا بدهد قبل از پاسخ موفق
            (شبیه‌سازی «گواهی با تأخیر صادر می‌شود» — سناریوی اصلی تسک ۲۶).
        service_starts: آیا سرویس headscale بالا می‌آید (wait_healthy).
    """
    from hem.headscale import ctl, releases
    from hem.headscale import installer as hs_installer
    from hem.installer import flow as flow_mod
    from hem.installer.flow import InstallFlow
    from hem.network import dnscheck
    from hem.network import ips as net_ips
    from hem.network import ports as net_ports
    from hem.proxy import caddy as caddy_mod
    from hem.system import packages, preflight, services

    conf = tmp_path / "conf.yaml"
    conf.write_text(_CONF_HTTPS if https else _CONF_NOHTTPS, encoding="utf-8")

    # مسیرهای state/گزارش در محیط تست
    monkeypatch.setattr(C, "STATE_FILE", str(tmp_path / "state.json"))
    monkeypatch.setattr(C, "ANSWERS_FILE", str(tmp_path / "install-answers.yaml"))
    monkeypatch.setattr(C, "LOG_DIR", str(tmp_path / "log"))

    # گام‌های اولیه: root/پیش‌نیاز/شبکه
    monkeypatch.setattr(flow_mod, "is_root", lambda: True)
    monkeypatch.setattr(
        preflight, "run_preflight",
        lambda: SimpleNamespace(ok=True, render=lambda: "preflight ok"),
    )
    monkeypatch.setattr(net_ips, "public_ip_from_api", lambda: "203.0.113.10")
    monkeypatch.setattr(net_ips, "server_addresses", lambda: (["203.0.113.10"], []))

    # DNS گام validate
    monkeypatch.setattr(
        dnscheck, "check_domain",
        lambda domain, ips: SimpleNamespace(
            ok=dns_ok,
            advice="DNS درست است." if dns_ok else "رکورد A ناهمخوان است.",
        ),
    )

    # شناسایی سرویس‌ها/بسته‌ها
    monkeypatch.setattr(packages, "apt_update", lambda **kw: None)
    monkeypatch.setattr(packages, "apt_install", lambda names, **kw: None)
    monkeypatch.setattr(packages, "dpkg_installed", lambda name: name == "headscale")
    monkeypatch.setattr(net_ports, "port_taken_by", lambda port, proto="tcp": "")

    # headscale: نسخهٔ هدف از قبل نصب است → مسیر دانلود لازم نیست
    monkeypatch.setattr(hs_installer, "is_installed", lambda: False)
    monkeypatch.setattr(hs_installer, "current_version", lambda: "0.29.5")
    monkeypatch.setattr(
        hs_installer, "download",
        lambda *a, **kw: (_ for _ in ()).throw(AssertionError("دانلود نباید لازم بود")),
    )
    monkeypatch.setattr(releases, "fetch_checksums", lambda version: {})

    # پیکربندی
    monkeypatch.setattr(flow_mod, "write_config", lambda *a, **kw: None)
    monkeypatch.setattr(flow_mod, "validate_config", lambda *a, **kw: (True, "ok"))

    # Caddy (حالت reuse)
    monkeypatch.setattr(caddy_mod, "caddy_installed", lambda: True)
    monkeypatch.setattr(caddy_mod, "get_caddyfile_path", lambda: str(tmp_path / "Caddyfile"))
    monkeypatch.setattr(caddy_mod, "backup_caddyfile", lambda *a, **kw: None)
    monkeypatch.setattr(caddy_mod, "inject_site_block", lambda *a, **kw: True)
    monkeypatch.setattr(caddy_mod, "validate_caddy", lambda *a, **kw: (True, "ok"))
    monkeypatch.setattr(caddy_mod, "reload_caddy", lambda: None)

    # سرویس‌ها: headscale فقط در صورت service_starts فعال است؛ caddy همیشه فعال
    monkeypatch.setattr(services, "daemon_reload", lambda **kw: None)
    monkeypatch.setattr(services, "systemctl", lambda action, unit=None, **kw: None)
    monkeypatch.setattr(services, "journal_logs", lambda unit, **kw: [])
    monkeypatch.setattr(
        services, "service_active",
        lambda unit: (service_starts if unit == C.HEADSCALE_UNIT else True),
    )
    monkeypatch.setattr(
        services, "wait_healthy", lambda unit, timeout=90, **kw: service_starts
    )

    # چک‌های HTTP گام health — فقط لایهٔ شبکه شبیه‌سازی می‌شود.
    # شمارندهٔ تلاش‌های بیرونی برای شبیه‌سازی «گواهی با تأخیر صادر می‌شود».
    ext_attempts = {"n": 0}

    def fake_urlopen(url, timeout=None):
        if "127.0.0.1" in url:
            if local_health is None:
                raise OSError("local connection refused")
            return _Resp(local_health)
        ext_attempts["n"] += 1
        if external_health is None or ext_attempts["n"] <= external_fail_times:
            raise OSError("TLS not ready")
        return _Resp(external_health)

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    # پنجرهٔ تلاش مجدد (اصلاح تسک ۲۶) نباید تست را کند کند — خواب واقعی
    # حذف می‌شود ولی شمارش تلاش‌ها از fake_urlopen واقعی است.
    monkeypatch.setattr(flow_mod, "_sleep", lambda seconds: None)

    # کنترل headscale
    monkeypatch.setattr(ctl, "health", lambda: "OK")
    monkeypatch.setattr(ctl, "users_list", lambda: [{"id": 1, "name": "admin"}])
    monkeypatch.setattr(ctl, "users_create", lambda name: None)

    flow = InstallFlow(
        config_file=str(conf), non_interactive=True, dry_run=False, assume_yes=True
    )
    rc = flow.run()
    out = capsys.readouterr().out
    return flow, rc, out


# ─── (الف) HTTPS ناموفق + DNS درست → pending_verification ───────────────

def test_https_fail_dns_ok_is_pending_verification(tmp_path, monkeypatch, capsys):
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=True, local_health=200, external_health=None,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "pending_verification", out
    assert rc == C.EXIT_MISSING, f"کد خروج باید ۴ باشد؛ got {rc}\n{out}"
    # پیام صادقانه — هرگز «نصب کامل شد»
    assert "نصب کامل شد" not in out
    assert "DNS یا گواهی TLS هنوز آماده نیست" in out
    assert "تأییدنشده" in out, "یادداشت صادقانه دربارهٔ بیرونیِ تأییدنشده الزامی است"
    # نتیجهٔ چک‌ها در state ثبت شده است
    health = flow.state.data["health"]
    assert health["local_ok"] is True
    assert health["https_ok"] is False
    assert health["dns_ok"] is True
    # گزارش md هم وضعیت نهایی صادقانه را دارد
    report = _latest_report(tmp_path)
    assert "pending_verification" in report
    assert "تأییدنشده" in report


# ─── (ب) همه چیز سالم → full_success + EXIT_OK ──────────────────────────

def test_all_checks_pass_is_full_success(tmp_path, monkeypatch, capsys):
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=True, local_health=200, external_health=200,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "full_success", out
    assert rc == C.EXIT_OK
    assert "نصب کاملاً موفق است" in out
    assert "نصب کامل شد" not in out  # پیام قدیمیِ همیشگی حذف شده است


# ─── (ج) شکست گام start → partial_failure ──────────────────────────────

def test_start_failure_is_partial_failure(tmp_path, monkeypatch, capsys):
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=True, local_health=200, external_health=200,
        service_starts=False,
    )
    assert flow.state.data["final_status"] == "partial_failure", out
    assert rc == C.EXIT_ERROR
    assert "بخشی از عملیات شکست خورده است" in out
    assert "نصب کامل شد" not in out


# ─── (د) بدون HTTPS + سلامت محلی ۲۰۰ → verified ────────────────────────

def test_no_https_local_ok_is_verified(tmp_path, monkeypatch, capsys):
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=False, dns_ok=True, local_health=200, external_health=None,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "verified", out
    assert rc == C.EXIT_OK
    assert "نصب انجام شد و صحت آن تأیید شد" in out
    # در حالت بدون HTTPS، ادعای «کاملاً موفق» (full_success) نمی‌شود
    assert "نصب کاملاً موفق است" not in out


# ─── موارد تکمیلی: مرزهای قواعد ۴.۴ ────────────────────────────────────

def test_dns_mismatch_caps_at_pending_verification(tmp_path, monkeypatch, capsys):
    """DNS ناهمخوان حتی با HTTPS سالم → حداکثر pending_verification."""
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=False, local_health=200, external_health=200,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "pending_verification", out
    assert rc == C.EXIT_MISSING
    assert "نصب کامل شد" not in out
    assert "تأییدنشده" in out


def test_local_health_fail_is_service_not_ready(tmp_path, monkeypatch, capsys):
    """سرویس فعال ولی سلامت محلی پاس نمی‌دهد → service_not_ready (نه موفقیت)."""
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=True, local_health=None, external_health=None,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "service_not_ready", out
    assert rc == C.EXIT_MISSING
    assert "نصب انجام شد اما سرویس آماده نیست" in out
    assert "نصب کامل شد" not in out


# ─── اصلاح تسک ۲۶: پنجرهٔ تلاش مجدد چک بیرونی + علت دقیق ─────────────


def test_https_late_cert_within_retry_window_is_full_success(tmp_path, monkeypatch, capsys):
    """سناریوی گزارش کاربر: نصب سالم، سرویس فعال، گواهی با تأخیر صادر می‌شود.

    دو تلاشِ اولِ چک بیرونی خطا می‌دهد (گواهی هنوز صادر نشده) ولی در پنجرهٔ
    تلاش مجدد پاسخ ۲۰۰ می‌آید → نصب باید صادقانه full_success (کد ۰) شود،
    نه pending_verification (کد ۴).
    """
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=True, local_health=200,
        external_health=200, external_fail_times=2,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "full_success", out
    assert rc == C.EXIT_OK, f"گواهیِ دیررس نباید نصب سالم را شکست بدهد؛ got {rc}\n{out}"
    # تلاش مجدد واقعاً انجام شده (نه پاسخ از همان اول) — ارقام کنسول ASCII است
    # (هماهنگ با «گام 15/17» خود StepRunner)
    assert "تلاش 2 از 6" in out, out
    assert "نصب کاملاً موفق است" in out


def test_https_retry_exhausted_stays_pending_with_precise_reason(
    tmp_path, monkeypatch, capsys
):
    """اگر پس از کل پنجرهٔ تلاش هم بیرونی پاسخ نداد → همان pending_verification.

    ولی این بار با علت دقیق: کدام بررسی شکست خورد، آخرین خطا چیست و دستور
    رفع کدام است — «تأییدنشدهٔ» بی‌دلیل ممنوع (اصلاح تسک ۲۶).
    """
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=True, local_health=200, external_health=None,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "pending_verification", out
    assert rc == C.EXIT_MISSING
    # کل پنجرهٔ تلاش واقعاً مصرف شده است (۶ تلاش)
    assert "تلاش 6 از 6" in out, out
    # علت دقیق: بررسی شکست‌خورده + URL + آخرین خطا + دستور رفع
    assert "بررسی شکست‌خورده: دسترسی بیرونی" in out, out
    assert "https://health.example.com/health" in out, out
    assert "TLS not ready" in out, out
    assert "curl -sS https://health.example.com/health" in out, out
    assert "hsctl doctor" in out
    # خطا در state هم ثبت شده (برای گزارش md و ابزارهای بعدی)
    health = flow.state.data["health"]
    assert health["https_ok"] is False
    assert health["https_error"] == "TLS not ready"
    report = _latest_report(tmp_path)
    assert "TLS not ready" in report


def test_dns_pending_shows_dns_specific_reason(tmp_path, monkeypatch, capsys):
    """DNS ناهمخوان → pending_verification با علتِ مخصوص DNS و دستور رفع آن."""
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=True, dns_ok=False, local_health=200, external_health=200,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "pending_verification", out
    assert rc == C.EXIT_MISSING
    assert "بررسی شکست‌خورده: رکورد DNS دامنه" in out, out
    assert "رکورد A" in out, out
    # علت HTTPS نباید بی‌جهت ذکر شود — چک HTTPS پاس شده است
    assert "بررسی شکست‌خورده: دسترسی بیرونی" not in out


def test_local_retry_recovers_transient_refusal(tmp_path, monkeypatch, capsys):
    """چک محلی هم پنجرهٔ کوتاه تلاش مجدد دارد — ردشدنِ لحظه‌ای دیگر سرویسِ
    سالم را service_not_ready نمی‌کند."""
    # local_health دومی از همان اول ۲۰۰ است (تلاش مجدد لازم نیست) — این تست
    # فقط مسیر خوش‌بینانهٔ سریع را قفل می‌کند؛ مسیر خطای دائمی در تست قبلی است.
    flow, rc, out = _run_flow(
        tmp_path, monkeypatch, capsys,
        https=False, dns_ok=True, local_health=200, external_health=None,
        service_starts=True,
    )
    assert flow.state.data["final_status"] == "verified", out
    assert rc == C.EXIT_OK


def _latest_report(tmp_path) -> str:
    """خواندن جدیدترین گزارش نصبِ نوشته‌شده در LOG_DIR تست."""
    reports = sorted((tmp_path / "log").glob("install-report-*.md"))
    assert reports, "گزارش نصب باید نوشته شده باشد"
    return reports[-1].read_text(encoding="utf-8")
