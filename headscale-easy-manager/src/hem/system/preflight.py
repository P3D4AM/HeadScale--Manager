"""بررسی پیش‌نیازهای سرور قبل از نصب — خروجی: آیتم‌های ok/warn/fail با پیام فارسی.

هر آیتم fail به فرمت چهاربخشی (مشکل/علت/روش بررسی/راهکار) گزارش می‌شود.
"""

from __future__ import annotations

import platform
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

from hem import constants as C
from hem.core import hemlog
from hem.core.exec import which
from hem.network import ports as net_ports
from hem.system import packages

logger = hemlog.get("preflight")

ICONS = {"ok": "✓", "warn": "!", "fail": "✗"}


@dataclass
class CheckItem:
    """نتیجه یک بررسی پیش‌نیاز."""

    check_id: str
    title: str
    status: str  # ok/warn/fail
    message: str = ""
    problem: str = ""
    cause: str = ""
    how_checked: str = ""
    fix: str = ""

    def render(self) -> str:
        """رندر یک‌خطی/چندخطی فارسی."""
        icon = ICONS.get(self.status, "؟")
        line = f"  [{icon}] {self.title}"
        if self.message and self.status == "ok":
            line += f" — {self.message}"
        lines = [line]
        if self.status in ("warn", "fail"):
            for label, value in (
                ("مشکل", self.problem or self.message),
                ("علت", self.cause),
                ("روش بررسی", self.how_checked),
                ("راهکار", self.fix),
            ):
                if value:
                    lines.append(f"        {label}: {value}")
        return "\n".join(lines)


@dataclass
class PreflightReport:
    """گزارش کامل پیش‌نیازها."""

    items: list = field(default_factory=list)

    @property
    def ok(self) -> bool:
        """True یعنی هیچ بررسی fail نشده است."""
        return all(item.status != "fail" for item in self.items)

    @property
    def warn_count(self) -> int:
        """تعداد هشدارها."""
        return sum(1 for item in self.items if item.status == "warn")

    def render(self) -> str:
        """رندر کل گزارش."""
        lines = ["── بررسی پیش‌نیازها " + "─" * 40]
        for item in self.items:
            lines.append(item.render())
        total = len(self.items)
        ok_count = sum(1 for i in self.items if i.status == "ok")
        fail_count = sum(1 for i in self.items if i.status == "fail")
        lines.append("─" * 60)
        summary = f"نتیجه: {ok_count} سالم | {self.warn_count} هشدار | {fail_count} مشکل (از {total})"
        if not self.ok:
            summary += " — ابتدا موارد قرمز را رفع کنید."
        lines.append(summary)
        return "\n".join(lines)


def _read_os_release() -> dict:
    """خواندن /etc/os-release به دیکشنری."""
    data = {}
    try:
        for line in Path("/etc/os-release").read_text(
            encoding="utf-8", errors="replace"
        ).splitlines():
            if "=" in line:
                key, value = line.split("=", 1)
                data[key.strip()] = value.strip().strip('"')
    except OSError:
        pass
    return data


def _check_os() -> CheckItem:
    """بررسی سیستم‌عامل — Ubuntu 22.04/24.04 پشتیبانی؛ Debian بهترین تلاش."""
    info = _read_os_release()
    os_id = info.get("ID", "unknown")
    version = info.get("VERSION_ID", "")
    pretty = info.get("PRETTY_NAME", f"{os_id} {version}")
    item = CheckItem(
        "os", "سیستم‌عامل", "ok", how_checked=f"خواندن /etc/os-release → {pretty}"
    )
    if os_id == C.SUPPORTED_OS_ID and version in C.SUPPORTED_OS_VERSIONS:
        item.message = f"{pretty} — پشتیبانی‌شده و آزموده‌شده."
        return item
    if os_id in C.BEST_EFFORT_OS_IDS:
        item.status = "warn"
        item.message = f"{pretty} — بهترین تلاش (best-effort)."
        item.problem = f"«{pretty}» جزو نسخه‌های رسمی آزموده‌شده نیست."
        item.cause = "این ابزار برای Ubuntu Server 22.04/24.04 ساخته شده است."
        item.fix = "ادامه ممکن است ولی سازگاری «آزمایش‌نشده» است؛ Ubuntu 24.04 LTS توصیه می‌شود."
        return item
    if os_id == C.SUPPORTED_OS_ID:
        item.status = "warn"
        item.message = f"{pretty} — نسخه Ubuntu خارج از لیست پشتیبانی."
        item.problem = f"نسخه {version or 'نامشخص'} از Ubuntu جزو 22.04/24.04 نیست."
        item.fix = "در صورت مشکل، به Ubuntu 22.04/24.04 LTS مهاجرت کنید."
        return item
    item.status = "fail"
    item.problem = f"سیستم‌عامل «{pretty}» پشتیبانی نمی‌شود."
    item.cause = "بسته‌های نصب (deb رسمی headscale و مخزن Caddy) فقط برای اوبونتو/دبیان آزموده شده‌اند."
    item.fix = "از Ubuntu Server 22.04 یا 24.04 LTS (amd64/arm64) استفاده کنید."
    return item


def _check_arch() -> CheckItem:
    """بررسی معماری CPU."""
    machine = platform.machine().lower()
    mapped = {"x86_64": "amd64", "aarch64": "arm64"}.get(machine)
    item = CheckItem(
        "arch", "معماری پردازنده", "ok", how_checked=f"platform.machine() → {machine}"
    )
    if mapped:
        item.message = f"{machine} → بسته {mapped}."
        return item
    item.status = "fail"
    item.problem = f"معماری «{machine}» پشتیبانی نمی‌شود."
    item.cause = "بسته رسمی headscale فقط برای amd64 و arm64 ساخته می‌شود."
    item.fix = "روی سروری با معماری x86_64 یا aarch64 اجرا کنید."
    return item


def _check_disk() -> CheckItem:
    """بررسی فضای آزاد پارتیشن ریشه."""
    usage = shutil.disk_usage("/")
    free_gb = usage.free / (1024 ** 3)
    item = CheckItem(
        "disk", "فضای دیسک", "ok",
        how_checked=f"disk_usage('/') → {free_gb:.1f} گیگابایت آزاد",
    )
    if free_gb >= C.MIN_DISK_GB:
        item.message = f"{free_gb:.1f} گیگابایت آزاد است."
        return item
    if free_gb >= 2:
        item.status = "warn"
        item.message = f"{free_gb:.1f} گیگابایت آزاد (کمتر از حد توصیه‌شده)."
        item.fix = "فضای بیشتری آزاد کنید تا حداقل ۱۰ گیگابایت برسد."
        return item
    item.status = "fail"
    item.problem = f"فضای آزاد فقط {free_gb:.1f} گیگابایت است."
    item.cause = "نصب و به‌ویژه پشتیبان‌ها به فضای بیشتری نیاز دارند."
    item.fix = "فایل‌های غیرلازم را پاک کنید یا دیسک را بزرگ کنید (حداقل ۱۰ گیگابایت)."
    return item


def _check_ram() -> CheckItem:
    """بررسی حافظه — کمتر از ۱ گیگابایت = هشدار."""
    total_mb = 0
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8", errors="replace").splitlines():
            if line.startswith("MemTotal:"):
                total_mb = int(line.split()[1]) // 1024
                break
    except (OSError, ValueError, IndexError):
        pass
    item = CheckItem(
        "ram", "حافظه (RAM)", "ok", how_checked=f"/proc/meminfo → {total_mb} مگابایت"
    )
    if total_mb >= C.MIN_RAM_MB:
        item.message = f"{total_mb} مگابایت — کافی است."
        return item
    item.status = "warn"
    item.problem = f"حافظه فقط {total_mb} مگابایت است (کمتر از ۱ گیگابایت)."
    item.cause = "با حافظه کم، سرویس ممکن است تحت فشار قرار گیرد."
    item.fix = "در صورت امکان swap اضافه کنید یا سرور را ارتقا دهید."
    return item


def _check_sudo() -> CheckItem:
    """بررسی دسترسی مدیر (root یا sudo)."""
    import os

    item = CheckItem("sudo", "دسترسی مدیر (sudo)", "ok", how_checked="os.geteuid() و which(sudo)")
    if os.geteuid() == 0:
        item.message = "اجرا با root — کامل."
        return item
    if which("sudo") is not None:
        item.message = "برنامه sudo موجود است."
        return item
    item.status = "fail"
    item.problem = "نه root هستیم و نه برنامه sudo موجود است."
    item.cause = "نصب بسته‌ها و سرویس‌ها به دسترسی مدیر نیاز دارد."
    item.fix = "با کاربر root وارد شوید یا بسته sudo را نصب کنید."
    return item


def _check_ports() -> CheckItem:
    """بررسی پورت‌های 80/443 (tcp) و 3478 (udp) — آزاد یا در اختیار caddy."""
    problems = []
    ok_notes = []
    for port, proto in ((C.PORT_HTTP, "tcp"), (C.PORT_HTTPS, "tcp"), (C.PORT_STUN, "udp")):
        owner = net_ports.port_taken_by(port, proto)
        if owner:
            if "caddy" in owner or "headscale" in owner:
                ok_notes.append(f"{port}/{proto} در اختیار {owner} (طبیعی)")
            else:
                problems.append(f"{port}/{proto} در اختیار «{owner}»")
        elif net_ports.port_free(port, proto):
            ok_notes.append(f"{port}/{proto} آزاد")
        else:
            problems.append(f"{port}/{proto} اشغال")
    item = CheckItem(
        "ports", "پورت‌های 80/443 و 3478", "ok",
        how_checked="تست bind + ss -ltnup",
    )
    if not problems:
        item.message = "؛ ".join(ok_notes)
        return item
    item.status = "fail"
    item.problem = "؛ ".join(problems)
    item.cause = "این پورت‌ها برای Caddy (و STUN در صورت DERP تعبیه‌شده) لازم‌اند."
    item.fix = "سرویس اشغال‌کننده را متوقف/حذف کنید یا پورت آن را تغییر دهید."
    return item


def _check_existing_services() -> CheckItem:
    """شناسایی headscale/caddy/nginx موجود — فقط اطلاع‌رسانی."""
    found = []
    for name in ("headscale", "caddy", "nginx"):
        if packages.dpkg_installed(name):
            found.append(name)
    item = CheckItem(
        "services", "سرویس‌های موجود", "ok", how_checked="dpkg-query + systemctl list-units"
    )
    if not found:
        item.message = "هیچ سرویس مرتبطی از قبل نصب نیست — نصب تمیز."
        return item
    item.status = "warn"
    item.message = "نصب‌شده: " + "، ".join(found)
    item.problem = "این سرویس‌ها از قبل نصب‌اند: " + "، ".join(found)
    item.cause = "نصب موجود ممکن است با تنظیمات جدید تداخل داشته باشد."
    item.fix = "در ادامه، حالت مناسب (استفاده مجدد/مدیریت نصب موجود) انتخاب می‌شود؛ داده‌ها حفظ می‌شوند."
    return item


def _check_kernel() -> CheckItem:
    """بررسی نسخه هسته لینوکس."""
    release = platform.release()
    item = CheckItem(
        "kernel", "هسته لینوکس", "ok", how_checked=f"platform.release() → {release}"
    )
    try:
        major = int(release.split(".")[0])
    except (ValueError, IndexError):
        major = 0
    if major >= 5:
        item.message = f"{release} — مناسب."
        return item
    if major == 0:
        item.status = "warn"
        item.message = f"نسخه {release} قابل تشخیص نبود."
        return item
    item.status = "warn"
    item.problem = f"هسته قدیمی است: {release}"
    item.cause = "Tailscale به قابلیت‌های هسته‌های جدیدتر وابسته است."
    item.fix = "به هسته ۵.۱۰ یا جدیدتر ارتقا دهید (Ubuntu 22.04+ پیش‌فرض دارد)."
    return item


def _check_python() -> CheckItem:
    """بررسی نسخه پایتون."""
    item = CheckItem(
        "python", "پایتون", "ok",
        how_checked=f"sys.version_info → {sys.version.split()[0]}",
    )
    if sys.version_info >= C.MIN_PYTHON:
        item.message = f"{sys.version.split()[0]} — کافی است."
        return item
    item.status = "fail"
    item.problem = f"پایتون {sys.version.split()[0]} قدیمی است."
    item.cause = "این ابزار حداقل Python 3.10 لازم دارد."
    item.fix = "python3 جدیدتر نصب کنید (Ubuntu 22.04+ پیش‌فرض دارد)."
    return item


def run_preflight() -> PreflightReport:
    """اجرای همه بررسی‌ها."""
    report = PreflightReport(items=[
        _check_os(),
        _check_arch(),
        _check_disk(),
        _check_ram(),
        _check_sudo(),
        _check_ports(),
        _check_existing_services(),
        _check_kernel(),
        _check_python(),
    ])
    logger.debug("preflight انجام شد: %s آیتم", len(report.items))
    return report


__all__ = ["CheckItem", "PreflightReport", "run_preflight"]
