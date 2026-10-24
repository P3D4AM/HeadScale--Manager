"""اسکن فصل‌های مستندات فارسی docs/fa — پارس frontmatter با YAML."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml

from hem import constants as C
from hem.i18n import fmt

FRONTMATTER_SEP = "---"


@dataclass
class Chapter:
    """یک فصل مستندات."""

    number: int
    title: str
    description: str
    icon: str
    path: Path
    filename: str


def docs_dirs() -> list:
    """پوشه‌های کاندید docs/fa — اول نسبت به کد (مخزن/مسیر نصب)، بعد مسیر استاندارد."""
    here = Path(__file__).resolve()
    return [
        here.parents[3] / "docs" / "fa",           # src/hem/learn → ریشه پروژه
        Path(C.DEFAULT_INSTALL_DIR) / "docs" / "fa",  # مسیر نصب استاندارد
        Path.cwd() / "docs" / "fa",
    ]


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    """تفکیک frontmatter از متن — خروجی: (متادیتا، بدنه بدون frontmatter)."""
    if not text.startswith(FRONTMATTER_SEP):
        return {}, text
    lines = text.splitlines()
    # پیدا کردن خط پایانی frontmatter
    for idx in range(1, len(lines)):
        if lines[idx].strip() == FRONTMATTER_SEP:
            raw = "\n".join(lines[1:idx])
            body = "\n".join(lines[idx + 1:]).lstrip("\n")
            try:
                meta = yaml.safe_load(raw) or {}
            except yaml.YAMLError:
                meta = {}
            return (meta if isinstance(meta, dict) else {}), body
    return {}, text


def _scan_dir(directory: Path) -> list:
    """اسکن فایل‌های md یک پوشه و ساخت فصل‌ها."""
    chapters = []
    for md_file in sorted(directory.glob("*.md")):
        try:
            text = md_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        meta, _body = _parse_frontmatter(text)
        try:
            number = int(meta.get("order", 0))
        except (TypeError, ValueError):
            number = 999
        chapters.append(
            Chapter(
                number=number,
                title=str(meta.get("title") or md_file.stem),
                description=str(meta.get("description") or ""),
                icon=str(meta.get("icon") or "Book"),
                path=md_file,
                filename=md_file.name,
            )
        )
    return chapters


def list_chapters() -> list:
    """فهرست فصل‌ها مرتب بر اساس order — اگر پوشه‌ای نبود، لیست خالی."""
    for directory in docs_dirs():
        if directory.is_dir():
            chapters = _scan_dir(directory)
            if chapters:
                chapters.sort(key=lambda c: (c.number, c.filename))
                return chapters
    return []


def read_chapter(n) -> str | None:
    """خواندن متن فصل شماره n (بدون frontmatter) — نبود یعنی None."""
    try:
        number = int(n)
    except (TypeError, ValueError):
        return None
    for chapter in list_chapters():
        if chapter.number == number:
            try:
                text = chapter.path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None
            _meta, body = _parse_frontmatter(text)
            return body
    return None


def chapters_help() -> str:
    """پیام راهنما وقتی هیچ فصلی پیدا نمی‌شود."""
    return fmt("docs_not_found")
