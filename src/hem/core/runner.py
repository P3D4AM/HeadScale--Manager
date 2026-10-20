"""اجرای گام‌به‌گام عملیات با نمایش وضعیت فارسی.

آیکن‌ها:  [ ] در انتظار   [~] در حال اجرا   [✓] موفق   [!] نیاز به اقدام   [✗] ناموفق
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

STATUS_ICONS = {
    "pending": "[ ]",
    "running": "[~]",
    "ok": "[✓]",
    "needs_action": "[!]",
    "failed": "[✗]",
}


class NeedsActionError(RuntimeError):
    """گام به اقدام کاربر نیاز دارد — جریان متوقف می‌شود."""


@dataclass
class Step:
    """یک گام از یک جریان چندگامی."""

    name: str
    risk: str = "safe"  # 'safe' | 'risky' | 'destructive'
    status: str = "pending"  # pending/running/ok/needs_action/failed
    detail: str = ""


def _color(code: str, text: str) -> str:
    """رنگ‌آمیزی خطوط در ترمینال (با احترام به NO_COLOR)."""
    if os.environ.get("NO_COLOR") or not sys.stdout.isatty():
        return text
    return f"\033[{code}m{text}\033[0m"


def _icon(status: str) -> str:
    palette = {"ok": "32", "needs_action": "33", "failed": "31", "running": "36"}
    icon = STATUS_ICONS.get(status, "[ ]")
    return _color(palette.get(status, "0"), icon)


class StepRunner:
    """اجرای گام‌ها با نمایش زیبای وضعیت و جمع‌بندی نهایی."""

    def __init__(self, title: str = "", total: int | None = None):
        self.title = title
        self.total = total
        self.steps: list[Step] = []

    def run(self, step: Step, fn) -> bool:
        """اجرای یک گام؛ خروجی False یعنی گام کامل نشد (نیاز به اقدام یا ناموفق)."""
        self.steps.append(step)
        n = len(self.steps)
        label = f"گام {n}/{self.total} — {step.name}" if self.total else step.name
        print(f"{_icon('running')} {label}", flush=True)
        step.status = "running"
        try:
            result = fn(step)
        except NeedsActionError as exc:
            step.status, step.detail = "needs_action", str(exc)
            print(f"{_icon('needs_action')} {label} — {step.detail}")
            return False
        except Exception as exc:  # noqa: BLE001 — پیام استثنا باید فارسی باشد
            step.status = "failed"
            step.detail = str(exc) or exc.__class__.__name__
            print(f"{_icon('failed')} {label} — {step.detail}")
            return False
        step.status = "ok"
        if isinstance(result, str) and result:
            step.detail = result
        suffix = f" — {step.detail}" if step.detail else ""
        print(f"{_icon('ok')} {label}{suffix}")
        return True

    def counts(self) -> tuple[int, int, int]:
        """شمارش (موفق، نیاز به اقدام، ناموفق)."""
        ok = sum(1 for s in self.steps if s.status == "ok")
        needs = sum(1 for s in self.steps if s.status == "needs_action")
        failed = sum(1 for s in self.steps if s.status == "failed")
        return ok, needs, failed

    def summary(self) -> bool:
        """چاپ جمع‌بندی؛ True یعنی هیچ گامی ناموفق/نیمه‌کاره نمانده است."""
        ok, needs, failed = self.counts()
        line = f"جمع‌بندی: {ok} گام موفق"
        if needs:
            line += f" | {needs} گام نیازمند اقدام شما"
        if failed:
            line += f" | {failed} گام ناموفق"
        print("─" * 60)
        print(_color("1", line))
        return failed == 0 and needs == 0
