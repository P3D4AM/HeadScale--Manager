"""اجرای فرمان‌های سیستمی — تنها نقطه مجاز اجرای subprocess در کل پروژه.

قواعد:
  * فرمان همیشه به‌صورت «لیست آرگومان» داده می‌شود (هرگز shell=True).
  * dry_run فقط فرمان را چاپ می‌کند و نتیجه موفق ساختگی برمی‌گرداند.
  * خروجی‌ها هنگام لاگ از فیلتر redact عبور می‌کنند.
"""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass, field

from hem.core import hemlog
from hem.i18n import fmt

logger = hemlog.get("exec")


@dataclass
class ExecResult:
    """نتیجه اجرای یک فرمان."""

    returncode: int
    stdout: str
    stderr: str
    cmd: list = field(default_factory=list)


class HemExecError(RuntimeError):
    """خطای اجرای فرمان — پیام فارسی؛ نتیجه خام در result موجود است."""

    def __init__(self, result: ExecResult | None, message: str | None = None):
        self.result = result
        if message:
            msg = message
        else:
            cmd_str = " ".join(result.cmd) if result else "؟"
            msg = fmt(
                "command_failed",
                command=hemlog.redact(cmd_str),
                code=result.returncode if result else -1,
            )
            stderr = hemlog.redact((result.stderr or "").strip()[-400:]) if result else ""
            if stderr:
                msg += "\n" + stderr
        super().__init__(msg)


def run(  # noqa: PLR0913
    cmd: list,
    check: bool = True,
    timeout: float | None = None,
    env: dict | None = None,
    dry_run: bool = False,
    input_bytes: bytes | None = None,
    capture: bool = True,
    follow: bool = False,
    sensitive: bool = False,
) -> ExecResult:
    """اجرای فرمان با لیست آرگومان.

    Args:
        cmd: فرمان به‌صورت لیست (مثلاً ["systemctl", "status", "headscale"]).
        check: اگر True باشد، کد خروج غیرصفر به HemExecError منجر می‌شود.
        timeout: مهلت اجرا بر حسب ثانیه.
        env: متغیرهای اضافه (روی محیط فعلی سوار می‌شود).
        dry_run: فقط چاپ فرمان بدون اجرا.
        input_bytes: ورودی باینری فرمان (جایگزین pipe در شل).
        capture: دریافت stdout/stderr.
        follow: پخش زنده خروجی (برای journalctl -f) با اعمال redact.
        sensitive: آرگومان‌ها در لاگ مخفی می‌شوند.

    Returns:
        ExecResult با کد خروج و خروجی‌ها.
    """
    cmd = [str(c) for c in cmd]
    shown = hemlog.redact(shlex.join(cmd)) if not sensitive else f"{cmd[0]} [آرگومان‌ها مخفی شد]"
    logger.debug("اجرا: %s", shown)
    if dry_run:
        print(f"[dry-run] {shown}")
        return ExecResult(0, "", "", cmd)

    merged_env = dict(os.environ)
    if env:
        merged_env.update({str(k): str(v) for k, v in env.items()})

    try:
        if follow:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, env=merged_env,
            )
            assert proc.stdout is not None
            for line in proc.stdout:
                sys.stdout.write(hemlog.redact(line))
                sys.stdout.flush()
            rc = proc.wait()
            res = ExecResult(rc, "", "", cmd)
        else:
            proc = subprocess.run(
                cmd,
                input=input_bytes,
                stdout=subprocess.PIPE if capture else None,
                stderr=subprocess.PIPE if capture else None,
                timeout=timeout,
                env=merged_env,
            )
            res = ExecResult(
                proc.returncode,
                (proc.stdout or b"").decode("utf-8", "replace"),
                (proc.stderr or b"").decode("utf-8", "replace"),
                cmd,
            )
    except FileNotFoundError as exc:
        raise HemExecError(None, fmt("command_missing", name=cmd[0])) from exc
    except subprocess.TimeoutExpired as exc:
        raise HemExecError(
            None, fmt("command_timeout", command=hemlog.redact(shlex.join(cmd)), timeout=timeout)
        ) from exc

    if check and res.returncode != 0:
        raise HemExecError(res)
    logger.debug("پاسخ (کد %s): %s", res.returncode, hemlog.redact(res.stdout[:500]))
    return res


def which(name: str) -> str | None:
    """مسیر برنامه قابل اجرا یا None."""
    return shutil.which(name)


def is_root() -> bool:
    """آیا فرایند فعلی با root اجرا شده است؟"""
    return os.geteuid() == 0


def run_root(cmd: list, **kwargs) -> ExecResult:
    """اجرای فرمان با دسترسی مدیر — اگر root نباشیم با sudo اجرا می‌شود."""
    if is_root():
        return run(cmd, **kwargs)
    return run(["sudo", *cmd], **kwargs)
