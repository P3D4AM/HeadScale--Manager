"""فهرست دوربین‌ها — ذخیره در /etc/hem/cameras.yaml (بدون هیچ رمز یا اطلاعات محرمانه)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import yaml

from hem import constants as C
from hem.core import prompts
from hem.i18n import fmt

CAMERA_SCHEMA_HINT = "cameras: [{name, host, http_port, rtsp_port, brand, notes}]"


@dataclass
class Camera:
    """یک دوربین/NVR در شبکه دفتر."""

    name: str
    host: str
    http_port: int | None = None
    rtsp_port: int | None = None
    brand: str = ""
    notes: str = ""

    def to_dict(self) -> dict:
        """تبدیل به دیکشنری قابل ذخیره در YAML."""
        return {
            "name": self.name,
            "host": self.host,
            "http_port": self.http_port,
            "rtsp_port": self.rtsp_port,
            "brand": self.brand,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, data: dict) -> Camera:
        """ساخت از دیکشنری YAML (با مقادیر پیش‌فرض امن)."""
        return cls(
            name=str(data.get("name") or ""),
            host=str(data.get("host") or ""),
            http_port=data.get("http_port") if isinstance(data.get("http_port"), int) else None,
            rtsp_port=data.get("rtsp_port") if isinstance(data.get("rtsp_port"), int) else None,
            brand=str(data.get("brand") or ""),
            notes=str(data.get("notes") or ""),
        )


def load(path=None) -> list:
    """خواندن فهرست دوربین‌ها — نبود فایل یعنی لیست خالی."""
    p = Path(path or C.CAMERAS_FILE)
    if not p.exists():
        return []
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8", errors="replace")) or {}
    except yaml.YAMLError:
        print(f"⚠ فایل دوربین‌ها ({p}) قابل خواندن نیست؛ خروجی: لیست خالی.")
        return []
    cams = data.get("cameras") or []
    return [
        Camera.from_dict(item)
        for item in cams
        if isinstance(item, dict) and item.get("name") and item.get("host")
    ]


def save(cameras: list, path=None) -> Path:
    """ذخیره فهرست دوربین‌ها با دسترسی ۶۰۰."""
    p = Path(path or C.CAMERAS_FILE)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = {"cameras": [cam.to_dict() for cam in cameras]}
    p.write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    os.chmod(p, 0o600)
    return p


def add(cam: Camera, path=None) -> Path:
    """افزودن (یا به‌روزرسانی هم‌نام) یک دوربین."""
    cameras = [c for c in load(path) if c.name != cam.name]
    cameras.append(cam)
    return save(cameras, path)


def remove(name: str, path=None) -> bool:
    """حذف دوربین با نام — True یعنی حذف شد."""
    cameras = load(path)
    remaining = [c for c in cameras if c.name != name]
    if len(remaining) == len(cameras):
        return False
    save(remaining, path)
    return True


def _ask_optional_port(prompt: str, hint: str, default: str) -> int | None:
    """پرسش پورت اختیاری — پذیرش «نمی‌دانم» با آموزش کوتاه."""
    while True:
        raw = prompts.ask(prompt, default=default).strip().lower()
        if raw in ("نمی‌دانم", "نمیدانم", "?", "-", "dk"):
            print(f"  ℹ {hint}")
            return None
        if prompts.is_valid_port(raw):
            return int(raw)
        print(f"  ✗ {fmt('invalid_port')} (یا بنویسید: نمی‌دانم)")


def add_interactive(path=None) -> Camera | None:
    """افزودن تعاملی دوربین — مرحله‌به‌مرحله؛ هرگز رمز یا نام کاربری خواسته نمی‌شود."""
    print("─" * 60)
    print("افزودن دوربین/NVR — هیچ رمز یا اطلاعات ورودی خواسته نمی‌شود.")
    print("این ابزار فقط «مسیر شبکه» را بررسی می‌کند؛ تماشای تصویر کار خود دستگاه است.")
    print("─" * 60)

    name = prompts.ask(
        "نام دلخواه این دستگاه (مثلاً nvr-daftar)",
        validator=lambda v: True if v else "نام نمی‌تواند خالی باشد.",
    )
    brand = prompts.select(
        "برند دستگاه را انتخاب کنید:",
        [
            ("dahua", "داهوا (Dahua)"),
            ("hikvision", "هایک‌ویژن (Hikvision)"),
            ("other", "سایر / نمی‌دانم"),
        ],
    )
    host = prompts.ask_ip("IP دستگاه در شبکه دفتر (مثلاً 192.168.1.108)")
    http_port = _ask_optional_port(
        "پورت وب مدیریتی (HTTP) — اگر نمی‌دانید بنویسید: نمی‌دانم",
        "پورت وب معمولاً همان است که در مرورگر دفتر باز می‌کنید (اغلب ۸۰). "
        "در دستگاه‌های داهوا: Main Menu → Network → TCP/IP.",
        "80",
    )
    rtsp_port = _ask_optional_port(
        "پورت ویدیو (RTSP) — اگر نمی‌دانید بنویسید: نمی‌دانم",
        "پورت RTSP اغلب ۵۵۴ است؛ در تنظیمات دستگاه/NVR بخش Network → RTSP دیده می‌شود.",
        "554",
    )
    notes = prompts.ask("یادداشت (اختیاری)", default="")

    cam = Camera(
        name=name, host=host, http_port=http_port, rtsp_port=rtsp_port,
        brand=brand, notes=notes,
    )
    add(cam, path)
    print(f"✓ دوربین «{cam.name}» ذخیره شد. بررسی دسترسی: hsctl cameras check --name {cam.name}")
    return cam
