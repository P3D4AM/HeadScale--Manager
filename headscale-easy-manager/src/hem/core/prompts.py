"""پرسش‌های تعاملی از کاربر — با اعتبارسنجی و پشتیبانی حالت غیرتعاملی.

در حالت non_interactive هر پرسشی خطای NonInteractiveError با راهنمای فارسی می‌دهد.
"""

from __future__ import annotations

import ipaddress
import re

from hem.i18n import fmt

_NON_INTERACTIVE = False

FQDN_RE = re.compile(
    r"^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$"
)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class PromptError(RuntimeError):
    """خطای کلی پرسش/اعتبارسنجی."""


class NonInteractiveError(PromptError):
    """در حالت غیرتعاملی پرسش ممکن نیست."""

    def __init__(self, message: str | None = None):
        super().__init__(message or fmt("non_interactive_error"))


def set_non_interactive(value: bool = True) -> None:
    """فعال/غیرفعال‌کردن حالت غیرتعاملی."""
    global _NON_INTERACTIVE
    _NON_INTERACTIVE = bool(value)


def is_non_interactive() -> bool:
    """آیا حالت غیرتعاملی فعال است؟"""
    return _NON_INTERACTIVE


# --- اعتبارسنج‌ها -----------------------------------------------------------

def is_valid_domain(value: str) -> bool:
    """آیا مقدار یک FQDN معتبر است؟"""
    return bool(FQDN_RE.match(value or ""))


def is_valid_ip(value: str) -> bool:
    """آیا مقدار یک IP معتبر (v4/v6) است؟"""
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def is_valid_port(value: int | str) -> bool:
    """آیا پورت در بازه ۱ تا ۶۵۵۳۵ است؟"""
    try:
        return 1 <= int(value) <= 65535
    except (TypeError, ValueError):
        return False


def is_valid_email(value: str) -> bool:
    """آیا ایمیل به‌ظاهر معتبر است؟"""
    return bool(EMAIL_RE.match(value or ""))


# --- پرسش‌های پایه ----------------------------------------------------------

def ask(prompt: str, default: str | None = None, validator=None, max_retry: int = 3) -> str:
    """پرسش متنی با پیش‌فرض و اعتبارسنج (validator: None|True → قبول، رشته → پیام خطا)."""
    if _NON_INTERACTIVE:
        raise NonInteractiveError()
    suffix = f" [{default}]" if default not in (None, "") else ""
    for _ in range(max_retry):
        try:
            raw = input(f"{prompt}{suffix}: ").strip()
        except EOFError as exc:
            raise NonInteractiveError() from exc
        if not raw and default is not None:
            return str(default)
        if validator is None:
            return raw
        verdict = validator(raw)
        if verdict is True or verdict is None:
            return raw
        print(f"  ✗ {verdict if isinstance(verdict, str) else fmt('invalid_input')}")
    raise PromptError(fmt("invalid_retries", times=max_retry))


def confirm(prompt: str, default: bool = False) -> bool:
    """پرسش بله/خیر — پذیرش y/yes/بله (و Enter با پیش‌فرض)."""
    if _NON_INTERACTIVE:
        raise NonInteractiveError()
    hint = "Y/n" if default else "y/N"
    try:
        raw = input(f"{prompt} [{hint}]: ").strip().lower()
    except EOFError:
        return default
    if not raw:
        return default
    return raw in ("y", "yes", "b", "بله")


def select(prompt: str, choices: list) -> str:
    """انتخاب از فهرست گزینه‌ها — choices: لیست جفت‌های (کلید، برچسب)."""
    if _NON_INTERACTIVE:
        raise NonInteractiveError()
    print(prompt)
    for idx, (key, label) in enumerate(choices, start=1):
        print(f"  {idx}) {label}  [{key}]")
    while True:
        try:
            raw = input(fmt("select_number")).strip()
        except EOFError as exc:
            raise NonInteractiveError() from exc
        if raw.isdigit() and 1 <= int(raw) <= len(choices):
            return choices[int(raw) - 1][0]
        for key, _label in choices:
            if raw == key:
                return key
        print(f"  ✗ {fmt('invalid_choice')}")


# --- پرسش‌های تخصصی ---------------------------------------------------------

def ask_domain(prompt: str | None = None, default: str | None = None) -> str:
    """پرسش دامنه با اعتبارسنجی FQDN."""
    return ask(
        prompt or "دامنه (FQDN)",
        default,
        validator=lambda v: True if is_valid_domain(v) else fmt("invalid_domain"),
    )


def ask_ip(prompt: str | None = None, default: str | None = None) -> str:
    """پرسش IP با اعتبارسنجی."""
    return ask(
        prompt or "آدرس IP",
        default,
        validator=lambda v: True if is_valid_ip(v) else fmt("invalid_ip"),
    )


def ask_email(prompt: str | None = None, default: str = "") -> str:
    """پرسش ایمیل (مقدار خالی مجاز است)."""
    def _validate(v: str):
        if not v or is_valid_email(v):
            return True
        return fmt("invalid_email")

    return ask(prompt or "ایمیل", default or None, validator=_validate)


def ask_port(prompt: str, default: str | int | None = None) -> int:
    """پرسش پورت با اعتبارسنجی."""
    raw = ask(
        prompt,
        str(default) if default is not None else None,
        validator=lambda v: True if is_valid_port(v) else fmt("invalid_port"),
    )
    return int(raw)
