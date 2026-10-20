"""پاسخ‌های نصب — تعاملی (مرحله‌به‌مرحله) یا از فایل پیکربندی YAML.

ساختار فایل مطابق examples/hem-install.conf.example است.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from pathlib import Path

import yaml

from hem import constants as C
from hem.core import prompts
from hem.i18n import fmt
from hem.network import dnscheck
from hem.network import ips as net_ips
from hem.system import firewall

VALID_CADDY_MODES = ("install", "reuse", "skip")


@dataclass
class InstallAnswers:
    """همه پاسخ‌های لازم برای نصب."""

    domain: str = ""
    acme_email: str = ""
    first_user: str = "admin"
    magic_dns_base: str = ""
    dns_nameservers: list = field(default_factory=lambda: ["1.1.1.1", "8.8.8.8"])
    embedded_derp: bool = True
    caddy_mode: str = "install"  # install | reuse | skip
    firewall: bool = True
    ssh_port: int | None = None
    cameras: list = field(default_factory=list)
    headscale_version: str = ""
    install_dir: str = C.DEFAULT_INSTALL_DIR
    non_interactive: bool = False
    dry_run: bool = False

    # --- محاسبات کمکی -------------------------------------------------------

    @property
    def use_https(self) -> bool:
        """HTTPS فقط وقتی پروکسی Caddy فعال است."""
        return self.caddy_mode != "skip"

    @property
    def server_url(self) -> str:
        """URLی که کلاینت‌ها با آن وصل می‌شوند."""
        if self.use_https:
            return f"https://{self.domain}"
        return f"http://{self.domain}:{C.PORT_HS_LISTEN}"

    def validate(self) -> list:
        """اعتبارسنجی کامل — خروجی: لیست خطاهای فارسی (خالی یعنی سالم)."""
        errors: list[str] = []
        if not prompts.is_valid_domain(self.domain):
            errors.append(fmt("invalid_domain_value", value=self.domain or "—"))
        if not self.magic_dns_base:
            errors.append(fmt("magic_dns_required"))
        elif not prompts.is_valid_domain(self.magic_dns_base):
            errors.append(fmt("invalid_domain_value", value=self.magic_dns_base))
        elif self.magic_dns_base == self.domain:
            errors.append(fmt("magic_dns_conflict"))
        if self.caddy_mode not in VALID_CADDY_MODES:
            errors.append(fmt("invalid_caddy_mode", value=self.caddy_mode))
        if self.caddy_mode == "skip" and self.embedded_derp:
            errors.append(fmt("derp_needs_https"))
        for ns in self.dns_nameservers or []:
            if not prompts.is_valid_ip(str(ns)):
                errors.append(fmt("nameserver_invalid", value=ns))
        if not self.first_user or " " in self.first_user:
            errors.append("نام اولین کاربر نمی‌تواند خالی یا دارای فاصله باشد.")
        if self.ssh_port is not None and not prompts.is_valid_port(self.ssh_port):
            errors.append(fmt("invalid_port"))
        return errors

    def to_config_params(self) -> dict:
        """تبدیل به ورودی render پیکربندی headscale."""
        return {
            "domain": self.domain,
            "acme_email": self.acme_email,
            "magic_dns_base": self.magic_dns_base,
            "dns_nameservers": self.dns_nameservers or ["1.1.1.1", "8.8.8.8"],
            "embedded_derp": self.embedded_derp and self.use_https,
            "use_https": self.use_https,
        }

    # --- ذخیره/بارگذاری ------------------------------------------------------

    def to_dict(self) -> dict:
        """تبدیل به دیکشنری قابل ذخیره."""
        return asdict(self)

    def save(self, path=None) -> Path:
        """ذخیره پاسخ‌ها در YAML با دسترسی ۶۰۰."""
        target = Path(path or C.ANSWERS_FILE)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            yaml.safe_dump(self.to_dict(), allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )
        os.chmod(target, 0o600)
        return target


def from_dict(data: dict) -> InstallAnswers:
    """ساخت پاسخ‌ها از دیکشنری (سخاویمانه با کلیدهای جایگزین مثل caddy)."""
    data = dict(data or {})
    # کلید جایگزین: caddy (مطابق فایل نمونه) → caddy_mode
    if "caddy" in data and "caddy_mode" not in data:
        data["caddy_mode"] = data.pop("caddy")
    known = {f for f in InstallAnswers.__dataclass_fields__}  # noqa: C416
    filtered = {k: v for k, v in data.items() if k in known}
    answers = InstallAnswers(**filtered)
    # نرمال‌سازی مقادیر YAML (مثلاً ssh_port: "" یا headscale_version: "")
    if answers.ssh_port in ("", "None", 0):
        answers.ssh_port = None
    if isinstance(answers.ssh_port, str) and answers.ssh_port.isdigit():
        answers.ssh_port = int(answers.ssh_port)
    if answers.headscale_version in ("None",):
        answers.headscale_version = ""
    if answers.dns_nameservers is None:
        answers.dns_nameservers = []
    return answers


def load_from_file(path) -> InstallAnswers:
    """بارگذاری پاسخ‌ها از فایل YAML — با اعتبارسنجی سخت‌گیرانه (خطا = فارسی)."""
    p = Path(path)
    if not p.exists():
        raise ValueError(f"فایل پیکربندی پیدا نشد: {p}")
    try:
        data = yaml.safe_load(p.read_text(encoding="utf-8", errors="replace")) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"فایل پیکربندی YAML معتبر نیست ({p}): {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"محتوای فایل پیکربندی باید یک نگاشت (mapping) باشد: {p}")
    answers = from_dict(data)
    answers.non_interactive = True  # فایل یعنی حالت خودکار
    errors = answers.validate()
    if errors:
        raise ValueError("خطاهای فایل پیکربندی:\n  - " + "\n  - ".join(errors))
    return answers


# --- جمع‌آوری تعاملی ---------------------------------------------------------

def _dns_tutorial(domain: str, public_ip: str | None) -> str:
    """آموزش کوتاه تنظیم رکورد A."""
    return f"""
راهنمای تنظیم رکورد A برای «{domain}»:
  ۱) به پنل مدیریت DNS دامنه بروید (جایی که دامنه را خریده‌اید).
  ۲) یک رکورد از نوع A بسازید:
       نام/میزبان (Host): {domain.split('.')[0]}  (یا @ اگر دامنه اصلی است)
       مقدار (Value):    {public_ip or 'IP عمومی این سرور'}
       TTL:              پیش‌فرض (مثلاً 300)
  ۳) ذخیره کنید؛ اعمال تغییر معمولاً چند دقیقه طول می‌کشد.
⚠ اگر از Cloudflare استفاده می‌کنید، حالت Proxy (ابر نارنجی) را خاموش کنید (فقط DNS) —
   Headscale با Cloudflare Proxy سازگار نیست (مشکل WebSocket POST).
"""


def _server_ips() -> list:
    """IPهای کاندید این سرور (محلی + عمومی)."""
    v4, _v6 = net_ips.server_addresses()
    public = net_ips.public_ip_from_api()
    if public and public not in v4:
        v4.append(public)
    return v4


def gather_interactive(preflight=None, state=None, answers: InstallAnswers | None = None) -> InstallAnswers:
    """جمع‌آوری پاسخ‌ها به‌صورت مرحله‌به‌مرحله — با بررسی خودکار DNS بعد از دامنه."""
    ans = answers or InstallAnswers()
    print("─" * 60)
    print("پرسش‌های نصب — با Enter مقدار پیش‌فرض [داخل کروشه] پذیرفته می‌شود.")
    print("─" * 60)

    # ۱) دامنه ← بررسی خودکار DNS
    while True:
        ans.domain = prompts.ask_domain("۱) دامنه سرور (FQDN — رکورد A آن به این سرور اشاره می‌کند)")
        if not prompts.is_valid_domain(ans.domain):
            continue
        break

    ips = _server_ips()
    result = dnscheck.check_domain(ans.domain, ips)
    print(f"  بررسی DNS: {result.advice}")
    while not result.ok:
        choice = prompts.select(
            "  رکورد DNS هنوز به این سرور اشاره نمی‌کند — چه می‌کنید؟",
            [
                ("guide", "راهنمایی کن چطور تنظیم کنم"),
                ("recheck", "تنظیم کردم؛ دوباره بررسی کن"),
                ("continue", "بعداً خودم تنظیم می‌کنم — ادامه بده"),
                ("cancel", "لغو نصب"),
            ],
        )
        if choice == "guide":
            print(_dns_tutorial(ans.domain, next((ip for ip in ips if not net_ips.is_cgnat(ip)), None)))
            continue_check = prompts.confirm("  دوباره بررسی کنیم؟", default=True)
            if continue_check:
                result = dnscheck.check_domain(ans.domain, _server_ips())
                print(f"  بررسی DNS: {result.advice}")
        elif choice == "recheck":
            result = dnscheck.check_domain(ans.domain, _server_ips())
            print(f"  بررسی DNS: {result.advice}")
        elif choice == "continue":
            print("  ⚠ نصب ادامه می‌یابد ولی تا درست‌شدن DNS، گواهی HTTPS صادر نمی‌شود (نیاز به اقدام).")
            break
        else:
            raise prompts.PromptError(fmt("install_cancelled"))

    # ۲) ایمیل گواهی
    ans.acme_email = prompts.ask_email("۲) ایمیل برای گواهی Let's Encrypt (اختیاری ولی توصیه‌شده)")

    # ۳) اولین کاربر
    ans.first_user = prompts.ask(
        "۳) نام اولین کاربر شبکه",
        default="admin",
        validator=lambda v: True if (v and " " not in v) else "نام نمی‌تواند خالی یا دارای فاصله باشد.",
    )

    # ۴) دامنه MagicDNS
    from hem.headscale.config import default_magic_dns_base

    default_magic = default_magic_dns_base(ans.domain)

    def _magic_validator(v: str):
        if not prompts.is_valid_domain(v):
            return fmt("invalid_domain")
        if v == ans.domain:
            return fmt("magic_dns_conflict")
        return True

    ans.magic_dns_base = prompts.ask(
        f"۴) دامنه MagicDNS (باید با {ans.domain} متفاوت باشد)",
        default=default_magic,
        validator=_magic_validator,
    )

    # ۵) DNS سرورها
    raw_ns = prompts.ask(
        "۵) سرورهای DNS شبکه (با کاما جدا)",
        default=",".join(ans.dns_nameservers or ["1.1.1.1", "8.8.8.8"]),
    )
    ans.dns_nameservers = [item.strip() for item in raw_ns.split(",") if item.strip()]

    # ۶) پروکسی معکوس
    mode = prompts.select(
        "۶) پروکسی معکوس (Reverse Proxy) و HTTPS:",
        [
            ("install", "نصب Caddy جدید — توصیه‌شده (گواهی TLS خودکار)"),
            ("reuse", "استفاده از Caddy موجود (فقط بلوک ما اضافه می‌شود)"),
            ("skip", "بدون پروکسی — فقط برای تست؛ HTTPS و DERP تعبیه‌شده خاموش می‌شود"),
        ],
    )
    ans.caddy_mode = mode
    if mode == "skip":
        ans.embedded_derp = False
        print("  ⚠ بدون پروکسی، server_url از نوع http می‌شود و DERP تعبیه‌شده غیرفعال می‌ماند.")
    else:
        ans.embedded_derp = prompts.confirm(
            "۷) سرور DERP تعبیه‌شده فعال شود؟ (کیفیت اتصال در شبکه‌های سخت بهتر می‌شود؛ پورت 3478/udp باز می‌شود)",
            default=True,
        )

    # ۷) فایروال
    ans.firewall = prompts.confirm(
        "۸) فایروال UFW با قواعد حداقلی تنظیم شود؟ (پورت SSH فعلی همیشه اول مجاز می‌شود)",
        default=True,
    )
    if ans.firewall:
        detected = firewall.detect_ssh_port()
        if detected:
            ans.ssh_port = prompts.ask_port("۹) پورت SSH (شناسایی‌شده)", default=detected)
        else:
            ans.ssh_port = prompts.ask_port("۹) پورت SSH سرور را وارد کنید (تشخیص خودکار نشد)")

    # ۸) دوربین‌ها
    if prompts.confirm(
        "۱۰) همین حالا دوربین/NVR شبکه دفتر را اضافه می‌کنید؟ (بعداً هم شدنی است: hsctl cameras add)",
        default=False,
    ):
        from hem.cameras import registry as cams_registry

        while True:
            cam = cams_registry.add_interactive()
            if cam:
                ans.cameras.append(cam.to_dict())
            if not prompts.confirm("دوربین دیگری اضافه می‌کنید؟", default=False):
                break

    errors = ans.validate()
    if errors:
        raise prompts.PromptError("خطا در پاسخ‌ها:\n  - " + "\n  - ".join(errors))
    return ans
