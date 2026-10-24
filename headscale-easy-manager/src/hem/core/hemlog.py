"""لاگ پروژه + لایه محوکردن اطلاعات حساس (redaction).

هیچ رمز/کلید/توکنی نباید در لاگ یا گزارش بنشیند؛ تابع redact روی همه رکوردهای لاگ اعمال می‌شود.
"""

from __future__ import annotations

import logging
import os
import re
import sys

from hem import constants as C

# الگوهای محوکردن: کلیدهای tskey، انتساب‌های حساس، Bearer و رشته‌های hex بلند (≥۳۲)
_TSCALE_KEY = re.compile(r"tskey-[a-zA-Z0-9-]+")
_SECRET_ASSIGN = re.compile(
    r"(?i)\b(authkey|auth[-_]?key|api[-_]?key|token|password|passwd|secret|private[-_]?key)"
    r"(\s*[=:]\s*)\S+"
)
_BEARER = re.compile(r"(?i)bearer\s+\S+")
_HEX_LONG = re.compile(r"\b[0-9a-fA-F]{32,}\b")

_logger: logging.Logger | None = None


def redact(text: str) -> str:
    """محوکردن اطلاعات حساس از متن (کلیدها، توکن‌ها، رمزها و hexهای بلند)."""
    if not text:
        return text
    text = _TSCALE_KEY.sub("tskey-[REDACTED]", text)
    text = _SECRET_ASSIGN.sub(r"\1\2[REDACTED]", text)
    text = _BEARER.sub("Bearer [REDACTED]", text)
    text = _HEX_LONG.sub("[REDACTED]", text)
    return text


class RedactingFormatter(logging.Formatter):
    """فرمتر لاگ که خروجی نهایی را از فیلتر redact عبور می‌دهد."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        return redact(super().format(record))


def setup() -> logging.Logger:
    """راه‌اندازی لاگر اصلی «hem» — فایل (با بازگشت به /tmp) + کنسول."""
    global _logger
    if _logger is not None:
        return _logger
    logger = logging.getLogger("hem")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    file_handler: logging.FileHandler | None = None
    try:
        os.makedirs(C.LOG_DIR, exist_ok=True)
        file_handler = logging.FileHandler(C.LOG_FILE, encoding="utf-8")
    except OSError:
        try:
            file_handler = logging.FileHandler(C.FALLBACK_LOG_FILE, encoding="utf-8")
        except OSError:
            file_handler = None
    if file_handler is not None:
        file_handler.setLevel(logging.DEBUG)
        file_handler.setFormatter(
            RedactingFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
        )
        logger.addHandler(file_handler)

    console = logging.StreamHandler(sys.stderr)
    console.setLevel(logging.WARNING)
    console.setFormatter(RedactingFormatter("%(levelname)s: %(message)s"))
    logger.addHandler(console)

    _logger = logger
    return logger


def get(name: str) -> logging.Logger:
    """گرفتن زیرلاگر با نام مشخص (مطمئن از راه‌اندازی بودن)."""
    setup()
    return logging.getLogger(f"hem.{name}")
