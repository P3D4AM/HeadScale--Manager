"""کنترل سرویس‌های systemd و خواندن journal — همه با مقاوم‌سازی در برابر محیط بدون systemd."""

from __future__ import annotations

import time

from hem.core import hemlog
from hem.core.exec import HemExecError, run

logger = hemlog.get("services")


def systemctl(action: str, unit: str | None = None, dry_run: bool = False,
              extra: list | None = None, timeout: float = 300) -> str:
    """اجرای عملیات systemctl (مثلاً action=«start»، unit=«headscale»)."""
    cmd = ["systemctl", action]
    if unit:
        cmd.append(unit)
    if extra:
        cmd.extend(extra)
    return run(cmd, dry_run=dry_run, timeout=timeout).stdout


def service_active(unit: str) -> bool:
    """آیا سرویس فعال است؟ (در نبود systemd/دسترسی، False برمی‌گردد.)"""
    try:
        res = run(["systemctl", "is-active", "--quiet", unit], check=False, timeout=30)
        return res.returncode == 0
    except HemExecError:
        return False


def service_enabled(unit: str) -> bool:
    """آیا سرویس برای شروع خودکار فعال شده است؟"""
    try:
        res = run(["systemctl", "is-enabled", "--quiet", unit], check=False, timeout=30)
        return res.returncode == 0
    except HemExecError:
        return False


def daemon_reload(dry_run: bool = False) -> None:
    """بارگذاری مجدد تعریف سرویس‌ها."""
    systemctl("daemon-reload", dry_run=dry_run)


def journal_logs(unit: str, lines: int = 100, since: str | None = None,
                 follow: bool = False, priority: str | None = None) -> list[str] | None:
    """خواندن لاگ journal سرویس؛ در حالت follow به‌صورت زنده چاپ می‌شود و None برمی‌گردد."""
    cmd = ["journalctl", "-u", unit, "-n", str(lines), "--no-pager"]
    if since:
        cmd += ["--since", since]
    if priority:
        cmd += ["-p", priority]
    if follow:
        cmd += ["-f"]
        run(cmd, check=False, follow=True, timeout=None)
        return None
    try:
        res = run(cmd, check=False, timeout=120)
    except HemExecError:
        return None
    return [line for line in res.stdout.splitlines() if line.strip()]


def wait_healthy(unit: str, timeout: float = 90, interval: float = 2.0) -> bool:
    """انتظار برای فعال‌شدن سرویس تا مهلت مشخص."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if service_active(unit):
            return True
        time.sleep(interval)
    return service_active(unit)
