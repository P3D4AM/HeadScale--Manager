"""دکتر — بررسی سلامت کل زنجیره با گزارش ساختارمند چهاربخشی فارسی.

هر چک: مشکل چیست / چرا اتفاق افتاده / چگونه بررسی شد / راهکار.
«--fix» فقط چک‌های risk='safe' را اصلاح می‌کند (مثل راه‌اندازی مجدد سرویس).
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field

from hem import __version__
from hem import constants as C
from hem.core import hemlog
from hem.core.exec import HemExecError, run, which
from hem.headscale import installer as hs_installer
from hem.network import dnscheck
from hem.network import ips as net_ips
from hem.network import ports as net_ports
from hem.system import firewall, services

logger = hemlog.get("doctor")


@dataclass
class Check:
    """نتیجه یک بررسی — fix_fn فقط برای ریسک safe اجرا می‌شود."""

    id: str
    title_fa: str
    status: str = "unknown"  # ok/warn/fail/unknown
    problem: str = ""
    cause: str = ""
    how_checked: str = ""
    fix: str = ""
    risk: str = "safe"
    fix_fn: object = field(default=None, repr=False)


def _load_state() -> dict:
    """خواندن state.json (در صورت وجود)."""
    import pathlib

    try:
        text = pathlib.Path(C.STATE_FILE).read_text(encoding="utf-8", errors="replace")
        import json as _json

        data = _json.loads(text)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _domain_from_state() -> str:
    """دامنه سرور از state (یا از config.yaml)."""
    state = _load_state()
    domain = str(state.get("domain") or "").strip()
    if domain:
        return domain
    try:
        import yaml

        with open(C.HEADSCALE_CONFIG_PATH, encoding="utf-8") as fh:
            cfg = yaml.safe_load(fh) or {}
        url = str(cfg.get("server_url") or "")
        if url.startswith("https://"):
            return url[len("https://"):].split("/")[0]
        if url.startswith("http://"):
            return url[len("http://"):].split("/")[0].split(":")[0]
    except (OSError, ValueError, yaml.YAMLError):
        pass
    return ""


def _https_health(domain: str) -> tuple[bool, str]:
    """تست HTTPS به /health دامنه با urllib."""
    import ssl
    import urllib.request

    url = f"https://{domain}/health"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.status == 200, f"کد پاسخ {resp.status}"
    except urllib.error.HTTPError as exc:
        return False, f"پاسخ خطای HTTP {exc.code}"
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(getattr(exc, "reason", None), ssl.SSLCertVerificationError):
            return False, "گواهی TLS معتبر نیست (احتمالاً هنوز صادر نشده)"
        return False, f"اتصال برقرار نشد: {reason}"
    except OSError as exc:
        return False, f"خطای شبکه: {exc}"


# --- چک‌ها -------------------------------------------------------------------

def _check_service() -> Check:
    check = Check(
        "service", "سرویس headscale فعال است؟",
        how_checked="systemctl is-active headscale",
    )
    if hs_installer.is_installed() is False:
        check.status = "fail"
        check.problem = "باینری headscale روی سیستم نیست."
        check.cause = "نصب کامل انجام نشده یا بسته حذف شده است."
        check.fix = "نصب را اجرا کنید: sudo hsctl install"
        check.risk = "safe"
        return check
    if services.service_active(C.HEADSCALE_UNIT):
        check.status = "ok"
        check.problem = "سرویس فعال است."
        return check
    check.status = "fail"
    check.problem = "سرویس headscale فعال نیست."
    check.cause = "سرویس متوقف شده، خطای پیکربندی یا خرابی واحد systemd."
    check.fix = "راه‌اندازی: sudo systemctl start headscale — یا اصلاح خودکار: sudo hsctl doctor --fix"
    check.fix_fn = lambda: services.systemctl("restart", C.HEADSCALE_UNIT)  # noqa: E731
    check.risk = "safe"
    return check


def _check_config() -> Check:
    from hem.headscale import config as hs_config

    check = Check(
        "config", "پیکربندی معتبر است؟",
        how_checked="headscale configtest",
    )
    ok, message = hs_config.validate_config()
    if ok:
        check.status = "ok"
        check.problem = "پیکربندی معتبر است."
        return check
    check.status = "fail"
    check.problem = "پیکربندی configtest را رد نکرد."
    check.cause = message or "خطای نامشخص"
    check.fix = "فایل /etc/headscale/config.yaml را بررسی کنید؛ نسخه پشتیبان‌های hem-backup موجود است."
    return check


def _check_dns(domain: str) -> Check:
    check = Check("dns", "DNS دامنه به این سرور اشاره می‌کند؟", how_checked="getaddrinfo + مقایسه با IP سرور")
    if not domain:
        check.status = "warn"
        check.problem = "دامنه سرور مشخص نیست."
        check.cause = "state.json یا server_url پیکربندی در دسترس نیست."
        check.fix = "hsctl status را اجرا کنید یا نصب را کامل کنید."
        return check
    v4, _v6 = net_ips.server_addresses()
    public = net_ips.public_ip_from_api()
    candidates = v4 + ([public] if public else [])
    result = dnscheck.check_domain(domain, candidates)
    if result.ok:
        check.status = "ok"
        check.problem = result.advice
        return check
    check.status = "warn"
    check.problem = result.advice
    check.cause = "رکورد A در پنل DNS به IP دیگری اشاره می‌کند یا هنوز ساخته نشده است."
    check.fix = "در پنل DNS، رکورد A دامنه را به IP عمومی سرور تغییر دهید (Cloudflare Proxy خاموش باشد)."
    return check


def _check_caddy(domain: str) -> Check:
    from hem.proxy import caddy

    check = Check("caddy", "پروکسی Caddy فعال و پاسخ می‌دهد؟", how_checked="systemctl is-active caddy + درخواست HTTPS")
    if not caddy.caddy_installed():
        check.status = "warn"
        check.problem = "Caddy نصب نیست."
        check.cause = "نصب با حالت caddy=skip انجام شده یا حذف شده است."
        check.fix = "اگر HTTPS می‌خواهید: sudo hsctl install (حالت caddy=install)"
        return check
    if not caddy.caddy_active():
        check.status = "fail"
        check.problem = "سرویس caddy فعال نیست."
        check.cause = "سرویس متوقف/خراب است."
        check.fix = "sudo systemctl start caddy"
        check.risk = "safe"
        check.fix_fn = lambda: services.systemctl("start", C.CADDY_UNIT)  # noqa: E731
        return check
    if not domain:
        check.status = "warn"
        check.problem = "Caddy فعال است اما دامنه برای تست HTTPS مشخص نیست."
        check.fix = "state.json را بررسی کنید."
        return check
    ok, detail = _https_health(domain)
    if ok:
        check.status = "ok"
        check.problem = f"پاسخ HTTPS سالم ({detail})."
        return check
    check.status = "warn"
    check.problem = f"پاسخ HTTPS دریافت نشد: {detail}"
    check.cause = "رکورد DNS، گواهی TLS یا فایروال مشکل دارد؛ اگر نصب تازه است، صدور گواهی چند دقیقه طول می‌کشد."
    check.fix = "چک dns و firewall همین گزارش را ببینید؛ سپس: sudo systemctl reload caddy"
    return check


def _check_ports() -> Check:
    check = Check("ports", "پورت‌های لازم گوش می‌دهند؟", how_checked="ss -ltnup")
    expected = [(80, "tcp"), (443, "tcp")]
    missing = []
    for port, proto in expected:
        taken = net_ports.port_taken_by(port, proto)
        if taken:
            continue
        if not net_ports.port_free(port, proto):
            continue
        missing.append(f"{port}/{proto}")
    if missing:
        check.status = "warn"
        check.problem = f"هیچ سرویسی روی {', '.join(missing)} گوش نمی‌دهد."
        check.cause = "Caddy فعال نیست یا روی این پورت‌ها listen نکرده است."
        check.fix = "sudo systemctl status caddy — در صورت نیاز hsctl doctor --fix"
    else:
        check.status = "ok"
        check.problem = "پورت‌های 80 و 443 در حال سرویس‌دهی‌اند."
    return check


def _check_firewall() -> Check:
    check = Check("firewall", "فایروال قواعد لازم را دارد؟", how_checked="ufw status")
    status = firewall.ufw_status()
    if status == "not-installed":
        check.status = "warn"
        check.problem = "ufw نصب نیست."
        check.fix = "sudo apt install ufw — یا فایروال مورد نظر خودتان را تنظیم کنید."
        return check
    if status == "inactive":
        check.status = "warn"
        check.problem = "ufw غیرفعال است (پورت‌ها فیلتر نمی‌شوند)."
        check.fix = "sudo hsctl install (گام فایروال) یا دستی: sudo ufw enable"
        return check
    rules = firewall.ufw_status_verbose()
    needed = ["80/tcp", "443/tcp"]
    absent = [r for r in needed if r not in rules]
    if absent:
        check.status = "warn"
        check.problem = f"قواعد {', '.join(absent)} در ufw دیده نشد."
        check.fix = f"sudo ufw allow {' و '.join(absent)}"
    else:
        check.status = "ok"
        check.problem = "ufw فعال است و قواعد 80/443 دارد."
    return check


def _check_disk() -> Check:
    check = Check("disk", "فضای دیسک کافی است؟", how_checked="disk_usage('/')")
    usage = shutil.disk_usage("/")
    free_gb = usage.free / (1024 ** 3)
    check.how_checked = f"فضای آزاد پارتیشن ریشه: {free_gb:.1f} گیگابایت"
    if free_gb < 2:
        check.status = "fail"
        check.problem = f"فضای آزاد بحرانی است ({free_gb:.1f} گیگابایت)."
        check.cause = "پرشدن دیسک می‌تواند پایگاه‌داده و لاگ‌ها را خراب کند."
        check.fix = "فایل‌های غیرلازم را پاک کنید (مثلاً پشتیبان‌های قدیمی در /var/backups/hem)."
    elif free_gb < C.MIN_DISK_GB:
        check.status = "warn"
        check.problem = f"فضای آزاد کمتر از حد توصیه‌شده است ({free_gb:.1f} گیگابایت)."
        check.fix = "دیسک را بزرگ کنید یا پاک‌سازی کنید."
    else:
        check.status = "ok"
        check.problem = f"{free_gb:.1f} گیگابایت آزاد است."
    return check


def _check_logs() -> Check:
    check = Check("logs", "خطاهای اخیر سرویس؟", how_checked="journalctl -u headscale -p err -n 50")
    try:
        res = run(
            ["journalctl", "-u", C.HEADSCALE_UNIT, "-p", "err", "-n", "50", "--no-pager"],
            check=False, timeout=60,
        )
        lines = [line for line in res.stdout.splitlines() if line.strip()]
    except HemExecError:
        lines = []
    if not lines:
        check.status = "ok"
        check.problem = "خطای مهمی در ۵۰ رکورد آخر ثبت نشده است."
        return check
    check.status = "warn"
    check.problem = f"{len(lines)} رکورد خطا در لاگ اخیر دیده شد. نمونه:"
    check.cause = "برای علت دقیق، متن کامل را ببینید."
    check.fix = "sudo hsctl logs --lines 100"
    check.problem += "\n         " + lines[-1][:160]
    return check


def _check_versions() -> Check:
    hs_ver = hs_installer.current_version()
    caddy_ver = ""
    if which("caddy"):
        try:
            res = run(["caddy", "version"], check=False, timeout=30)
            caddy_ver = res.stdout.strip().splitlines()[0] if res.stdout.strip() else ""
        except HemExecError:
            pass
    check = Check("versions", "نسخه‌ها", how_checked="headscale version / caddy version")
    check.status = "ok"
    check.problem = (
        f"ابزار hsctl: {__version__} | headscale: {hs_ver or 'نصب نیست'} | "
        f"caddy: {caddy_ver or '—'}"
    )
    if hs_ver and hs_ver != C.PINNED_HS_VERSION:
        check.status = "warn"
        check.cause = "نسخه نصب‌شده با نسخه هدف این ابزار (۰.۲۹.۵) یکی نیست."
        check.fix = "sudo hsctl update --check"
    return check


def _check_noise_key() -> Check:
    from pathlib import Path

    key = Path(C.HEADSCALE_DATA_DIR) / "noise_private.key"
    check = Check("noise_key", "کلید noise موجود است؟", how_checked=f"وجود {key}")
    if key.exists():
        check.status = "ok"
        check.problem = "کلید noise در جای خود است."
        return check
    check.status = "fail"
    check.problem = "فایل کلید noise پیدا نشد."
    check.cause = "پوشه /var/lib/headscale خالی است یا پاک شده است."
    check.fix = "از پشتیبان بازیابی کنید: sudo hsctl backup list → sudo hsctl restore <فایل>"
    return check


def collect_checks() -> list:
    """اجرای همه چک‌ها و بازگرداندن نتایج."""
    domain = _domain_from_state()
    return [
        _check_service(),
        _check_config(),
        _check_dns(domain),
        _check_caddy(domain),
        _check_ports(),
        _check_firewall(),
        _check_disk(),
        _check_logs(),
        _check_versions(),
        _check_noise_key(),
    ]


def render_check(check: Check) -> str:
    """رندر متن ساختارمند یک چک."""
    icons = {"ok": "✓", "warn": "!", "fail": "✗", "unknown": "؟"}
    lines = [f"[{icons.get(check.status, '؟')}] {check.title_fa}"]
    lines.append(f"    وضعیت: {check.problem}")
    if check.status in ("warn", "fail") and check.cause:
        lines.append(f"    علت احتمالی: {check.cause}")
    if check.how_checked:
        lines.append(f"    روش بررسی: {check.how_checked}")
    if check.status in ("warn", "fail") and check.fix:
        lines.append(f"    راهکار: {check.fix}")
    return "\n".join(lines)


def run_doctor(fix: bool = False, json_output: bool = False) -> list:
    """اجرای دکتر — چاپ گزارش فارسی (یا JSON) و بازگرداندن لیست چک‌ها."""
    checks = collect_checks()

    if fix:
        print("── اعمال اصلاحات کم‌خطر (risk=safe) " + "─" * 25)
        for check in checks:
            if check.status in ("warn", "fail") and check.fix_fn and check.risk == "safe":
                try:
                    check.fix_fn()
                    print(f"  ✓ اصلاح اجرا شد: {check.title_fa}")
                except Exception as exc:  # noqa: BLE001
                    print(f"  ✗ اصلاح ناموفق بود ({check.title_fa}): {exc}")
        checks = collect_checks()  # ارزیابی مجدد پس از اصلاح

    if json_output:
        payload = {
            "summary": {
                "ok": sum(1 for c in checks if c.status == "ok"),
                "warn": sum(1 for c in checks if c.status == "warn"),
                "fail": sum(1 for c in checks if c.status == "fail"),
            },
            "checks": [
                {
                    "id": c.id, "title": c.title_fa, "status": c.status,
                    "problem": c.problem, "cause": c.cause,
                    "how_checked": c.how_checked, "fix": c.fix, "risk": c.risk,
                }
                for c in checks
            ],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return checks

    print("═" * 62)
    print("  گزارش سلامت (doctor) — مدیر آسان هداسکیل")
    print("═" * 62)
    for check in checks:
        print(render_check(check))
        print()
    ok = sum(1 for c in checks if c.status == "ok")
    warn = sum(1 for c in checks if c.status == "warn")
    fail = sum(1 for c in checks if c.status == "fail")
    print("─" * 62)
    print(f"جمع‌بندی: {ok} سالم | {warn} هشدار | {fail} مشکل")
    return checks
