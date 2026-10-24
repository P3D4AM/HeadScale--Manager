"""گزارش وضعیت قابل‌ارسال — با محوسازی اطلاعات حساس و ذخیره با دسترسی ۶۰۰."""

from __future__ import annotations

import os
import time
from pathlib import Path

from hem import __version__
from hem import constants as C
from hem.core import hemlog
from hem.diagnostics import doctor
from hem.headscale import installer as hs_installer
from hem.i18n import fmt
from hem.system import services
from hem.system.firewall import ufw_status_verbose

logger = hemlog.get("report")


def apply_redactions(text: str) -> str:
    """اعمال لایه محوسازی روی متن گزارش (tskey، authkey، token، hex بلند و…)."""
    return hemlog.redact(text)


def build_report() -> str:
    """ساخت متن کامل گزارش وضعیت — دکتر بدون اصلاح + وضعیت کلی."""
    lines: list[str] = []
    lines.append("گزارش وضعیت — مدیر آسان هداسکیل (Headscale Easy Manager)")
    lines.append(f"تاریخ تولید: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"نسخه ابزار: {__version__}")
    lines.append("")
    lines.append("── وضعیت کلی " + "─" * 46)
    hs_ver = hs_installer.current_version()
    lines.append(f"headscale نصب‌شده: {hs_ver or 'نصب نیست'}")
    lines.append(f"سرویس headscale: {'فعال' if services.service_active(C.HEADSCALE_UNIT) else 'غیرفعال/ناموجود'}")
    lines.append(f"سرویس caddy: {'فعال' if services.service_active(C.CADDY_UNIT) else 'غیرفعال/ناموجود'}")
    state = doctor._load_state()
    if state:
        lines.append(f"دامنه ثبت‌شده: {state.get('domain', '—')}")
        lines.append(f"نسخه نصب‌شده توسط ابزار: {state.get('version', '—')}")
    lines.append("")
    lines.append("── فایروال " + "─" * 49)
    lines.append(ufw_status_verbose() or "نامشخص")
    lines.append("")
    lines.append("── نتایج بررسی سلامت (doctor) " + "─" * 30)
    for check in doctor.collect_checks():
        lines.append(doctor.render_check(check))
        lines.append("")
    return "\n".join(lines)


def save_report(path=None) -> Path:
    """ذخیره گزارش با محوسازی — پیش‌فرض در /var/log/hem با دسترسی ۶۰۰."""
    text = apply_redactions(build_report())
    if path:
        target = Path(path)
    else:
        target = Path(C.LOG_DIR) / f"report-{time.strftime('%Y%m%d-%H%M%S')}.txt"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        os.chmod(target, 0o600)
    except OSError:
        # در محیط بدون دسترسی، فایل در پوشه جاری ذخیره می‌شود
        target = Path(f"hem-report-{time.strftime('%Y%m%d-%H%M%S')}.txt")
        target.write_text(text, encoding="utf-8")
        os.chmod(target, 0o600)
        print("⚠ مسیر لاگ قابل نوشتن نبود؛ گزارش در پوشه جاری ذخیره شد.")
    print(fmt("report_saved", path=target))
    print(fmt("report_review"))
    return target
