"""جریان نصب ۱۷گامی Headscale Easy Manager — قلب Installer.

هر گام با StepRunner اجرا و پس از موفقیت در state.json ثبت می‌شود تا
نصب قابل ادامه (resume) و idempotent باشد.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from hem import __version__
from hem import constants as C
from hem.core import hemlog
from hem.core.exec import is_root
from hem.core.prompts import NonInteractiveError, PromptError, confirm, select
from hem.core.runner import NeedsActionError, Step, StepRunner
from hem.headscale import installer as hs_installer
from hem.headscale.config import render, validate_config, write_config
from hem.i18n import fmt
from hem.installer.answers import InstallAnswers, gather_interactive, load_from_file
from hem.network import dnscheck
from hem.network import ips as net_ips
from hem.proxy import caddy
from hem.system import firewall, packages, preflight, services

logger = hemlog.get("flow")

# گام‌های ۱۷گانه به‌ترتیب مأموریت — جمع‌آوری و اعتبارسنجی پاسخ‌ها «قبل از» نمایش
# برنامه و تأیید (گام plan همیشه پاسخ‌های واقعی در اختیار دارد).
STEP_ORDER = [
    "welcome", "preflight", "prereq", "resources", "detect_services",
    "gather", "validate", "plan", "packages", "headscale", "configure",
    "dns_https", "firewall", "start", "health", "report", "next_steps",
]

STEP_TITLES = {
    "welcome": "خوش‌آمد و معرفی",
    "preflight": "بررسی پیش‌نیازهای سرور",
    "prereq": "بررسی دسترسی‌ها و پیش‌نیاز نرم‌افزاری",
    "resources": "بررسی منابع شبکه (IP عمومی و CGNAT)",
    "detect_services": "شناسایی سرویس‌های موجود",
    "plan": "نمایش برنامه تغییرات و تأیید",
    "gather": "جمع‌آوری پاسخ‌های نصب",
    "validate": "اعتبارسنجی DNS دامنه",
    "packages": "نصب بسته‌های پایه",
    "headscale": "دانلود و نصب headscale",
    "configure": "تولید و اعتبارسنجی پیکربندی",
    "dns_https": "تنظیم پروکسی Caddy و HTTPS",
    "firewall": "تنظیم فایروال (اول SSH)",
    "start": "فعال‌سازی سرویس",
    "health": "بررسی سلامت و ساخت اولین کاربر",
    "report": "گزارش نصب",
    "next_steps": "گام‌های بعدی شما",
}

# گام‌های قابل پرش در حالت resume (بدون عارضه جانبی مهم) — جمع‌آوری/اعتبارسنجی
# و خودِ تأیید برنامه عارضه‌ای ندارند؛ در resume با ثبت ok پرش می‌خورند.
RESUME_SKIP = {"welcome", "preflight", "prereq", "resources", "gather", "validate", "plan"}

# وضعیت‌های نهایی نصب (اصلاح ۴.۴) — برچسب‌های فارسی قراردادی؛ هم در جمع‌بندی
# کنسول و هم در گزارش md (گام report) استفاده می‌شوند.
#   full_success        → نصب کاملاً موفق (سلامت داخلی + بیرونی هر دو تأیید)
#   verified            → همهٔ چک‌های الزامیِ این پیکربندی پاس شد (بدون HTTPS بیرونی)
#   pending_verification→ DNS یا گواهی TLS هنوز آماده نیست (بیرونی تأییدنشده)
#   service_not_ready   → سرویس فعال نیست یا سلامت محلی پاس نشد
#   partial_failure     → بخشی از گام‌ها شکست خورد
FINAL_STATES = ("verified", "service_not_ready", "pending_verification", "partial_failure", "full_success")


class InstallCancelled(RuntimeError):
    """کاربر نصب را لغو کرد."""


class PlanConsentError(RuntimeError):
    """در حالت غیرتعاملی، تأیید اجرای برنامه فقط با --yes صریح ممکن است.

    وجود فایل پیکربندی رضایت ضمنی نیست؛ کد خروج قراردادی EXIT_NO_CONFIRM است.
    """

    def __init__(self, message: str | None = None):
        super().__init__(message or fmt("need_explicit_yes"))


@dataclass
class StateManager:
    """مدیریت /etc/hem/state.json — ثبت پیشرفت و کارهای انجام‌شده توسط ابزار."""

    path: Path = field(default_factory=lambda: Path(C.STATE_FILE))
    data: dict = field(default_factory=dict)

    def __post_init__(self):
        self.data = {
            "steps": {},
            "installed_services": [],
            "firewall_rules_added": [],
            "caddy_block": False,
        }
        if self.path.exists():
            try:
                loaded = json.loads(self.path.read_text(encoding="utf-8", errors="replace"))
                if isinstance(loaded, dict):
                    self.data.update(loaded)
            except (OSError, ValueError):
                logger.warning("state.json موجود قابل خواندن نبود؛ از نو شروع می‌شود.")

    def mark(self, step: str, status: str) -> None:
        """ثبت وضعیت یک گام."""
        self.data.setdefault("steps", {})[step] = status
        self.data["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S")

    def step_status(self, step: str) -> str:
        """وضعیت ثبت‌شده یک گام."""
        return (self.data.get("steps") or {}).get(step, "")

    def save(self) -> None:
        """ذخیره state با دسترسی ۶۰۰."""
        self.data["hem_version"] = __version__
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        tmp.replace(self.path)
        import os

        os.chmod(self.path, 0o600)

    def append_unique(self, key: str, value) -> None:
        """افزودن مقدار به یک لیست state بدون تکرار."""
        lst = self.data.setdefault(key, [])
        if value not in lst:
            lst.append(value)


class InstallFlow:
    """اجرای کل جریان نصب با ۱۷ گام."""

    def __init__(self, config_file: str | None = None, non_interactive: bool = False,
                 dry_run: bool = False, install_dir: str = C.DEFAULT_INSTALL_DIR,
                 assume_yes: bool = False):
        self.config_file = config_file
        self.non_interactive = non_interactive
        self.dry_run = dry_run
        self.install_dir = install_dir
        # تأیید صریح برنامه تغییرات (--yes) — در غیرتعاملی تنها راهِ رضایت است.
        self.assume_yes = assume_yes
        # پرچم «نبودِ رضایت صریح در گام plan» — در run() به کد EXIT_NO_CONFIRM تبدیل می‌شود.
        self.plan_consent_missing = False
        self.state = StateManager()
        self.answers: InstallAnswers | None = None
        self.resources: dict = {}
        self.existing: dict = {}
        self.mode = "fresh"  # fresh | resume | repair | adopt
        self.preflight_report = None

    # ├── ورودی جریان ---------------------------------------------------------

    def run(self) -> int:
        """اجرای جریان — کد خروج مطابق قرارداد hsctl."""
        try:
            self._decide_mode()
        except InstallCancelled:
            print(fmt("install_cancelled"))
            return C.EXIT_NO_CONFIRM
        except (PromptError, NonInteractiveError) as exc:
            print(f"✗ {exc}")
            return C.EXIT_NO_CONFIRM

        if self.mode == "adopt":
            return self._run_adopt()

        runner = StepRunner(title="نصب Headscale Easy Manager", total=len(STEP_ORDER))
        handlers = {
            "welcome": self._step_welcome,
            "preflight": self._step_preflight,
            "prereq": self._step_prereq,
            "resources": self._step_resources,
            "detect_services": self._step_detect_services,
            "plan": self._step_plan,
            "gather": self._step_gather,
            "validate": self._step_validate,
            "packages": self._step_packages,
            "headscale": self._step_headscale,
            "configure": self._step_configure,
            "dns_https": self._step_dns_https,
            "firewall": self._step_firewall,
            "start": self._step_start,
            "health": self._step_health,
            "report": self._step_report,
            "next_steps": self._step_next_steps,
        }

        try:
            for name in STEP_ORDER:
                if (
                    self.mode == "resume"
                    and name in RESUME_SKIP
                    and self.state.step_status(name) == "ok"
                ):
                    runner.steps.append(Step(f"[از قبل کامل] {STEP_TITLES[name]}", status="ok"))
                    continue
                risk = "safe"
                if name in ("configure", "dns_https", "firewall", "start"):
                    risk = "risky"
                elif name in ("headscale", "packages"):
                    risk = "risky"
                ok = runner.run(Step(STEP_TITLES[name], risk=risk), handlers[name])
                if ok:
                    self.state.mark(name, "ok")
                    if not self.dry_run:
                        self._safe_save_state()
                    continue
                self.state.mark(name, "failed" if runner.steps[-1].status == "failed" else "needs_action")
                if not self.dry_run:
                    self._safe_save_state()
                # مرز تأیید برنامه (plan): نبودِ رضایت صریح = لغو (کد ۵) نه خطای سیستمی.
                # پیام فارسی خودش توسط runner چاپ شده است؛ اینجا فقط کد خروج درست می‌شود.
                if name == "plan" and self.plan_consent_missing:
                    return C.EXIT_NO_CONFIRM
                break
        except InstallCancelled:
            print(fmt("install_cancelled"))
            return C.EXIT_NO_CONFIRM

        complete = runner.summary()
        # ── وضعیت نهایی صادقانه (اصلاح ۴.۴) ────────────────────────────
        # پیام «نصب کامل شد» فقط وقتی مجاز است که وضعیت واقعاً verified/full_success
        # باشد؛ در غیر این صورت سرِگروهِ وضعیت مربوط چاپ می‌شود.
        if self.dry_run:
            if complete:
                print(
                    "✓ [dry-run] شبیه‌سازی کامل نصب تا انتها انجام شد — "
                    f"{fmt('dry_run_notice')}"
                )
                return C.EXIT_OK
            print("✗ [dry-run] شبیه‌سازی ناتمام ماند — موارد بالا را رفع و دوباره اجرا کنید.")
            return C.EXIT_ERROR

        final_state = "partial_failure" if not complete else self._final_install_state()
        self.state.data["final_status"] = final_state
        self._safe_save_state()
        print("─" * 60)
        headline = {
            "verified": "✅ " + fmt("final_verified"),
            "service_not_ready": "⚠ " + fmt("final_service_not_ready"),
            "pending_verification": "⚠ " + fmt("final_pending_verification"),
            "partial_failure": "✗ " + fmt("final_partial_failure"),
            "full_success": "✅ " + fmt("final_full_success"),
        }[final_state]
        print(headline)
        if final_state == "pending_verification":
            # یادداشت صادقانه: تا آماده‌شدن DNS/گواهی، دسترسی بیرونی تأییدنشده است.
            print(f"  {fmt('final_pending_note')}")
        if final_state == "service_not_ready":
            print("  وضعیت سرویس: systemctl status headscale   |   عیب‌یابی: hsctl doctor")
        print("  وضعیت کامل: hsctl status   |   عیب‌یابی: hsctl doctor")
        if final_state == "partial_failure":
            print(
                "برای ادامه بعد از رفع مشکل، همین دستور را دوباره اجرا کنید؛ "
                "گام‌های انجام‌شده تکرار نمی‌شوند:  sudo hsctl install"
            )
            return C.EXIT_ERROR
        if final_state in ("verified", "full_success"):
            return C.EXIT_OK
        # service_not_ready / pending_verification → کد ۴ (FACTS §10):
        # سرویس/زیرساخت موردنیاز هنوز آماده/تأیید نیست.
        return C.EXIT_MISSING

    # ├── تصمیم حالت ------------------------------------------------------------

    def _decide_mode(self) -> None:
        """تشخیص نصب موجود/ناتمام و انتخاب حالت (ادامه/تعمیر/مدیریت/لغو)."""
        has_state = bool(self.state.data.get("steps"))
        hs_installed = hs_installer.is_installed()

        if not has_state and not hs_installed:
            self.mode = "fresh"
            return

        if has_state:
            done = [k for k, v in (self.state.data.get("steps") or {}).items() if v == "ok"]
            print(f"⚠ نصب ناتمام/موجود شناسایی شد (state.json: {len(done)} گام ثبت‌شده).")
            if self.non_interactive:
                self.mode = "resume"
                print("  حالت خودکار: ادامه نصب از گام‌های باقی‌مانده.")
                return
            choice = select(
                "چه کاری انجام شود؟",
                [
                    ("resume", "ادامه نصب ناتمام (گام‌های کامل پرش می‌شوند)"),
                    ("repair", "تعمیر/اجرای دوباره همه گام‌ها (داده‌ها حفظ می‌شوند)"),
                    ("cancel", "لغو"),
                ],
            )
        else:
            ver = hs_installer.current_version() or "نامشخص"
            print(f"⚠ نصب headscale موجود شناسایی شد (نسخه {ver}) ولی state ابزار نیست.")
            if self.non_interactive:
                self.mode = "adopt"
                print("  حالت خودکار: «مدیریت نصب موجود» — هیچ چیز دوباره نصب/بازنویسی نمی‌شود.")
                return
            choice = select(
                "چه کاری انجام شود؟",
                [
                    ("adopt", "مدیریت نصب موجود (اعتبارسنجی پیکربندی + بررسی سلامت — بدون خرابکاری)"),
                    ("fresh", "نصب تمیز (پکیج دوباره نصب می‌شود؛ داده‌ها سرجایشان می‌مانند)"),
                    ("cancel", "لغو"),
                ],
            )
        if choice == "cancel":
            raise InstallCancelled()
        self.mode = choice

    def _run_adopt(self) -> int:
        """حالت مدیریت نصب موجود — فقط اعتبارسنجی و سلامت، بدون تغییر مخرب."""
        runner = StepRunner(title="مدیریت نصب موجود headscale", total=4)

        def _detect(step):
            self._step_detect_services(step)

        def _validate_cfg(step):
            if not Path(C.HEADSCALE_CONFIG_PATH).exists():
                raise NeedsActionError(
                    f"پیکربندی {C.HEADSCALE_CONFIG_PATH} وجود ندارد؛ نصب موجود ناقص است."
                )
            ok, message = validate_config()
            if not ok:
                raise NeedsActionError(f"configtest رد شد: {message}")
            return "پیکربندی موجود معتبر است."

        def _health(step):
            if not services.service_active(C.HEADSCALE_UNIT):
                services.systemctl("start", C.HEADSCALE_UNIT)
            if not services.wait_healthy(C.HEADSCALE_UNIT, 60):
                raise NeedsActionError("سرویس headscale بالا نیامد؛ «hsctl doctor» را ببینید.")
            return "سرویس فعال و سالم است."

        def _state(step):
            self.state.data["domain"] = self._domain_from_config()
            self.state.data.setdefault("installed_services", []).append("headscale")
            self.state.mark("adopt", "ok")
            self._safe_save_state()
            return "state ابزار ساخته شد."

        steps = [
            (Step("شناسایی سرویس‌ها"), _detect),
            (Step("اعتبارسنجی پیکربندی موجود"), _validate_cfg),
            (Step("بررسی سلامت سرویس"), _health),
            (Step("ثبت در state ابزار"), _state),
        ]
        for step, fn in steps:
            if not runner.run(step, fn):
                return C.EXIT_ERROR
        runner.summary()
        return C.EXIT_OK

    # ├── گام‌ها -----------------------------------------------------------------

    def _step_welcome(self, step: Step) -> str:
        """گام ۱: خوش‌آمد."""
        print("═" * 62)
        print(f"  {C.PRODUCT_NAME_FA} ({C.PRODUCT_NAME})")
        print(f"  نسخه ابزار: {__version__} — نسخه هدف headscale: {C.PINNED_HS_VERSION}")
        print("═" * 62)
        print("این ابزار Headscale را به‌صورت امن و مرحله‌به‌مرحله نصب می‌کند:")
        print("  • دانلود بسته رسمی با راستی‌آزمایی SHA-256")
        print("  • پیکربندی استاندارد + پروکسی Caddy (گواهی TLS خودکار)")
        print("  • فایروال با حفظ دسترسی SSH + سرویس systemd")
        if self.dry_run:
            print(f"\n⚠ {fmt('dry_run_notice')}")
        return "آماده‌ایم."

    def _step_preflight(self, step: Step) -> str:
        """گام ۲: بررسی پیش‌نیازها."""
        report = preflight.run_preflight()
        self.preflight_report = report
        print(report.render())
        if not report.ok:
            raise NeedsActionError(fmt("preflight_failed"))
        return "همه بررسی‌های ضروری پاس شد."

    def _step_prereq(self, step: Step) -> str:
        """گام ۳: دسترسی‌ها و پیش‌نیاز نرم‌افزاری."""
        import sys

        problems = []
        if not is_root():
            if self.dry_run:
                # dry-run فقط برنامه‌ریزی است؛ در نصب واقعی همچنان root الزامی است.
                print("  [dry-run] اجرا بدون root — برای نصب واقعی sudo لازم است (اینجا فقط برنامه‌ریزی است).")
            else:
                problems.append("اجرای بدون root — با sudo اجرا کنید.")
        if sys.version_info < C.MIN_PYTHON:
            problems.append(f"پایتون {sys.version.split()[0]} قدیمی است (حداقل ۳.۱۰).")
        try:
            import yaml  # noqa: F401
        except ImportError:
            problems.append("ماژول PyYAML نصب نیست (sudo apt install python3-yaml).")
        if problems:
            raise NeedsActionError("؛ ".join(problems))
        return "دسترسی‌ها و پیش‌نیازها کامل است."

    def _step_resources(self, step: Step) -> str:
        """گام ۴: منابع شبکه — IP عمومی و هشدار CGNAT."""
        v4, v6 = net_ips.server_addresses()
        public = net_ips.public_ip_from_api()
        self.resources["ips"] = v4 + ([public] if public and public not in v4 else [])
        print(f"  آدرس‌های سرور: {', '.join(v4) or '—'}")
        print(f"  IP عمومی: {public or 'نامشخص (دسترسی به api.ipify.org نبود)'}")
        if public and net_ips.is_cgnat(public):
            print("  ⚠ IP عمومی در رنج CGNAT است — برای «سرور» باید IP عمومی واقعی داشته باشید.")
        return f"IP عمومی: {public or 'نامشخص'}"

    def _step_detect_services(self, step: Step) -> str:
        """گام ۵: شناسایی سرویس‌های موجود (headscale/caddy/nginx)."""
        from hem.network import ports as net_ports

        found = {}
        for name in ("headscale", "caddy", "nginx"):
            found[name] = {
                "package": packages.dpkg_installed(name),
                "active": services.service_active(f"{name}.service"),
            }
        self.existing = found
        print("  سرویس‌های شناسایی‌شده:")
        for name, info in found.items():
            if info["package"] or info["active"]:
                print(
                    f"    • {name}: بسته={'نصب' if info['package'] else 'نه'}، "
                    f"سرویس={'فعال' if info['active'] else 'غیرفعال'}"
                )
        # تداخل پورت با nginx یا هر سرویس غیر caddy
        conflicts = []
        for port in (C.PORT_HTTP, C.PORT_HTTPS):
            owner = net_ports.port_taken_by(port, "tcp")
            if owner and "caddy" not in owner and "headscale" not in owner:
                conflicts.append(f"پورت {port} در اختیار «{owner}» است")
        if conflicts:
            raise NeedsActionError(
                "تداخل پورت: " + "؛ ".join(conflicts) +
                " — ابتدا آن سرویس را متوقف/حذف کنید یا پورت‌ها را آزاد کنید."
            )
        return "بدون تداخل پورت."

    def _step_plan(self, step: Step) -> str:
        """گام ۸: نمایش برنامه تغییرات و تأیید کاربر.

        همیشه بعد از gather اجرا می‌شود؛ پس پاسخ‌های واقعی در اختیار است
        (هک پیش‌نمایش `_load_or_gather_for_plan` حذف شد).
        """
        if self.answers is None:
            # محافظ: gather همیشه قبل از plan است؛ این شاخه نباید رخ دهد.
            raise NeedsActionError(
                "پاسخ‌های نصب قبل از نمایش برنامه باید جمع‌آوری شده باشند (گام gather)."
            )
        ans = self.answers
        lines = ["برنامه تغییرات:"]
        pkgs = ["sqlite3", "curl"]
        if ans.firewall:
            pkgs.append("ufw" if not firewall.ufw_status() or firewall.ufw_status() == "not-installed" else "ufw (نصب است)")
        if ans.caddy_mode == "install" and not caddy.caddy_installed():
            pkgs.append("caddy (از مخزن رسمی)")
        lines.append("  • بسته‌ها: " + "، ".join(pkgs))
        version, sha = hs_installer.resolve_target_version(ans.headscale_version or None)
        self.resources["target_version"] = version
        self.resources["target_sha256"] = sha
        lines.append(f"  • دانلود headscale {version} + راستی‌آزمایی SHA-256 و نصب deb")
        lines.append(f"  • نوشتن {C.HEADSCALE_CONFIG_PATH} (از فایل فعلی پشتیبان گرفته می‌شود)")
        if ans.caddy_mode != "skip":
            lines.append("  • افزودن بلوک سایت به Caddyfile (بین مارکرهای اختصاصی، idempotent)")
        else:
            lines.append("  • بدون پروکسی Caddy (حالت skip)")
        if ans.firewall:
            rules = [f"{ans.ssh_port or firewall.detect_ssh_port() or 22}/tcp (اول SSH!)", "80/tcp", "443/tcp"]
            if ans.embedded_derp:
                rules.append("3478/udp")
            lines.append("  • فایروال UFW: allow " + "، ".join(rules) + " + فعال‌سازی")
        lines.append(f"  • فعال‌سازی سرویس systemd و ساخت کاربر اول: {ans.first_user}")
        if self.existing.get("headscale", {}).get("package"):
            lines.append("  ⚠ بسته headscale از قبل نصب است — همین نسخه/دوباره نصب می‌شود و داده‌ها می‌مانند.")
        print("\n".join(lines))
        # تأیید برنامه — مرز رضایت صریح:
        if self.assume_yes:
            # رضایت صریح --yes (در هر دو حالت تعاملی/غیرتعاملی معتبر است)
            print("  ✓ برنامه با تأیید صریح (--yes) پذیرفته شد.")
        elif self.non_interactive:
            # بدون --yes صریح، اجرای برنامه در حالت غیرتعاملی مجاز نیست؛
            # وجود فایل پیکربندی رضایت ضمنی نیست.
            self.plan_consent_missing = True
            raise PlanConsentError()
        elif not confirm("\nبرنامه بالا اجرا شود؟", default=False):
            raise InstallCancelled()
        return "تأیید شد."

    def _step_gather(self, step: Step) -> str:
        """گام ۶: جمع‌آوری پاسخ‌ها (فایل پیکربندی یا تعاملی) — قبل از plan."""
        if self.config_file:
            self.answers = load_from_file(self.config_file)
            print(f"  پاسخ‌ها از فایل خوانده شد: {self.config_file}")
        elif self.non_interactive:
            raise NeedsActionError(
                "حالت غیرتعاملی بدون --config ممکن نیست؛ فایل پاسخ‌ها را بدهید "
                "(نمونه: examples/hem-install.conf.example)."
            )
        else:
            self.answers = gather_interactive(
                preflight=self.preflight_report, state=self.state.data
            )
        self.answers.install_dir = self.install_dir
        self.answers.dry_run = self.dry_run
        if not self.dry_run:
            self.answers.save()
            print(f"  پاسخ‌ها ذخیره شد: {C.ANSWERS_FILE}")
        # ذخیره خلاصه برای پیش‌نمایش plan در اجرای مجدد
        self.state.data["answers_summary"] = {
            k: v for k, v in self.answers.to_dict().items() if k != "cameras"
        }
        self.state.data["domain"] = self.answers.domain
        return f"دامنه: {self.answers.domain}"

    def _step_validate(self, step: Step) -> str:
        """گام ۷: اعتبارسنجی DNS دامنه — قبل از plan."""
        ans = self.answers
        result = dnscheck.check_domain(ans.domain, self.resources.get("ips") or net_ips.server_addresses()[0])
        print(f"  {result.advice}")
        if result.ok:
            self.state.data["dns_ok"] = True
            return "DNS درست است."
        self.state.data["dns_ok"] = False
        if self.non_interactive:
            print("  ⚠ ناهمخوانی DNS — نصب ادامه می‌یابد ولی تا درست‌شدن آن، HTTPS کار نمی‌کند.")
            return "ادامه با نیاز-اقدام (DNS بعداً درست شود)."
        choice = select(
            "  ادامه نصب با این وضعیت؟",
            [
                ("continue", "ادامه بده؛ بعداً خودم DNS را درست می‌کنم"),
                ("cancel", "لغو نصب"),
            ],
        )
        if choice == "cancel":
            raise InstallCancelled()
        return "ادامه با نیاز-اقدام (DNS بعداً درست شود)."

    def _step_packages(self, step: Step) -> str:
        """گام ۹: نصب بسته‌های پایه (sqlite3، curl، ufw در صورت نیاز، caddy طبق حالت)."""
        ans = self.answers
        packages.apt_update(dry_run=self.dry_run)
        base = ["sqlite3", "curl"]
        if ans.firewall and firewall.ufw_status() == "not-installed":
            base.append("ufw")
        packages.apt_install(base, dry_run=self.dry_run)
        for name in base:
            self.state.append_unique("installed_services", name)

        if ans.caddy_mode == "install":
            if caddy.caddy_installed():
                print("  Caddy از قبل نصب است؛ نصب مجدد لازم نیست.")
            else:
                caddy.install_caddy(dry_run=self.dry_run)
                self.state.append_unique("installed_services", "caddy")
        elif ans.caddy_mode == "reuse":
            if not caddy.caddy_installed():
                raise NeedsActionError(
                    "حالت reuse انتخاب شده ولی Caddy نصب نیست؛ حالت install را انتخاب کنید."
                )
            print("  Caddy موجود استفاده می‌شود (فقط بلوک ما اضافه می‌شود).")
        else:
            print("  حالت skip: بدون پروکسی Caddy ادامه می‌دهیم.")
        return "بسته‌ها آماده‌اند."

    def _step_headscale(self, step: Step) -> str:
        """گام ۱۰: دانلود + راستی‌آزمایی «الزامی» + نصب بستهٔ headscale (اصلاح ۴.۵).

        SHA-256 در همهٔ مسیرها الزامی است (تعاملی/غیرتعاملی، نصب تازه/ارتقا،
        dry-run). اگر checksum رسمی برای نسخه+معماری دقیق به‌دست نیاید، همین‌جا
        با NeedsActionError متوقف می‌شویم — هیچ گزینهٔ «ادامه بدون چک‌سام» وجود
        ندارد (این یک الزام امنیتی است).
        """
        ans = self.answers
        version = self.resources.get("target_version")
        sha256 = self.resources.get("target_sha256")
        if not version or not sha256:
            # resolve_target_version در نبود checksum رسمی خودش متوقف می‌کند.
            version, sha256 = hs_installer.resolve_target_version(ans.headscale_version or None)
        current = hs_installer.current_version()
        if current == version:
            print(f"  headscale نسخهٔ {current} از قبل نصب است؛ دانلود لازم نیست.")
            self.state.data["version"] = current
            return f"نسخهٔ {current} موجود است."
        if sha256 is None:  # محافظ دفاعی — resolve دیگر هرگز None برنمی‌گرداند
            raise NeedsActionError(fmt("checksum_mandatory"))

        arch = hs_installer._arch()
        from hem.headscale import releases

        url = releases.deb_url(version, arch)
        dest = Path("/var/tmp") / f"hem-headscale-{version}-{arch}.deb"
        print(f"  دانلود {url}")
        if not self.dry_run:
            hs_installer.download(url, dest, expected_sha256=sha256)
            hs_installer.install_deb(dest)
            installed = hs_installer.current_version()
            if installed != version:
                raise NeedsActionError(
                    f"نسخهٔ نصب‌شده ({installed}) با نسخهٔ هدف ({version}) یکی نیست."
                )
        else:
            print(f"[dry-run] دانلود → {dest} و نصب با apt (راستی‌آزمایی SHA-256 الزامی)")
        self.state.data["version"] = version
        return f"headscale {version} نصب شد."

    def _step_configure(self, step: Step) -> str:
        """گام ۱۱: تولید پیکربندی + configtest."""
        content = render(self.answers.to_config_params())
        write_config(C.HEADSCALE_CONFIG_PATH, content, dry_run=self.dry_run)
        ok, message = validate_config(dry_run=self.dry_run)
        if not ok:
            raise NeedsActionError(
                f"configtest رد شد: {message}\n"
                "  فایل پشتیبان (.hem-backup-*) کنار config.yaml نگه داشته شده است."
            )
        return "پیکربندی نوشته شد و معتبر است."

    def _step_dns_https(self, step: Step) -> str:
        """گام ۱۲: بلوک Caddy + validate + reload (idempotent)."""
        if self.answers.caddy_mode == "skip":
            return "بدون پروکسی (skip) — رد شد."
        caddyfile = caddy.get_caddyfile_path()
        backup = caddy.backup_caddyfile(caddyfile, dry_run=self.dry_run)
        if backup:
            print(f"  پشتیبان Caddyfile: {backup}")
        changed = caddy.inject_site_block(self.answers.domain, caddyfile, dry_run=self.dry_run)
        print("  بلوک سایت " + ("به‌روزرسانی/افزوده شد." if changed else "از قبل درست است."))
        ok, message = caddy.validate_caddy(caddyfile, dry_run=self.dry_run)
        if not ok:
            if backup and not self.dry_run:
                import shutil as _shutil

                _shutil.copy2(backup, caddyfile)
                print("  ⚠ Caddyfile نامعتبر بود؛ نسخه پشتیبان بازگردانده شد.")
            raise NeedsActionError(f"caddy validate رد شد: {message}")
        if not self.dry_run:
            if not services.service_active(C.CADDY_UNIT):
                services.systemctl("enable", C.CADDY_UNIT)
                services.systemctl("start", C.CADDY_UNIT)
            else:
                caddy.reload_caddy()
        self.state.data["caddy_block"] = True
        return "پروکسی HTTPS فعال شد."

    def _step_firewall(self, step: Step) -> str:
        """گام ۱۳: فایروال — اول SSH، بعد 80/443 (و 3478/udp)."""
        if not self.answers.firewall:
            return "فایروال خاموش ماند (انتخاب کاربر)."
        ssh_port = self.answers.ssh_port or firewall.detect_ssh_port()
        added, problem = firewall.firewall_setup(
            ssh_port, self.answers.embedded_derp, dry_run=self.dry_run,
            state=self.state.data,
        )
        if problem:
            raise NeedsActionError(problem)
        for rule in added:
            self.state.append_unique("firewall_rules_added", rule)
        return "قواعد: " + "، ".join(added) if added else "قواعد از قبل کامل بود."

    def _step_start(self, step: Step) -> str:
        """گام ۱۴: فعال‌سازی سرویس systemd."""
        services.daemon_reload(dry_run=self.dry_run)
        services.systemctl("enable", C.HEADSCALE_UNIT, dry_run=self.dry_run)
        services.systemctl("start", C.HEADSCALE_UNIT, dry_run=self.dry_run)
        if not self.dry_run and not services.wait_healthy(C.HEADSCALE_UNIT, timeout=90):
            logs = services.journal_logs(C.HEADSCALE_UNIT, lines=20) or []
            tail = "\n    ".join(logs[-8:])
            raise NeedsActionError(
                "سرویس headscale بالا نیامد. آخرین لاگ‌ها:\n    " + (tail or "—")
            )
        return "سرویس فعال شد."

    def _step_health(self, step: Step) -> str:
        """گام ۱۵: تست سلامت + ساخت اولین کاربر — با ثبت نتیجهٔ هر چک (اصلاح ۴.۴).

        نتیجهٔ تک‌تک چک‌ها (سلامت محلی، HTTPS بیرونی، headscale health، فعال‌بودن
        سرویس) در state ثبت می‌شود تا جمع‌بندی نهایی و گزارش md صادقانه باشند.
        """
        from hem.headscale import ctl

        local_url = f"http://127.0.0.1:{C.PORT_HS_LISTEN}/health"
        external_url = f"https://{self.answers.domain}/health"
        local_ok = False
        https_ok = False
        hs_health_ok = False
        if self.dry_run:
            print(f"[dry-run] تست سلامت محلی: {local_url}")
            if self.answers.use_https:
                print(f"[dry-run] تست سلامت بیرونی: {external_url}")
            print(f"[dry-run] ساخت اولین کاربر (در صورت نبود): {self.answers.first_user}")
        else:
            import urllib.request

            # چک محلی — در هر دو حالت (با/بدون HTTPS) سرور باید روی پورت محلی جواب بدهد
            try:
                with urllib.request.urlopen(local_url, timeout=15) as resp:
                    local_ok = resp.status == 200
            except OSError as exc:
                print(f"  ⚠ پاسخ {local_url} دریافت نشد ({exc}).")
            if local_ok:
                print(f"  ✓ سلامت محلی ({local_url}) درست بود.")
            # چک بیرونی — فقط در حالت HTTPS معنا دارد
            if self.answers.use_https:
                try:
                    with urllib.request.urlopen(external_url, timeout=15) as resp:
                        https_ok = resp.status == 200
                except OSError as exc:
                    print(
                        f"  ⚠ پاسخ {external_url} دریافت نشد ({exc}) — "
                        "اگر نصب تازه است، صدور گواهی چند دقیقه طول می‌کشد."
                    )
                if https_ok:
                    print(f"  ✓ سلامت بیرونی ({external_url}) درست بود.")
            try:
                print("  " + ctl.health().strip().replace("\n", "\n  ")[:500])
                hs_health_ok = True
            except Exception as exc:  # noqa: BLE001
                print(f"  ⚠ headscale health خطا داد: {exc}")
            # اولین کاربر
            try:
                users = ctl.users_list()
                if not users:
                    ctl.users_create(self.answers.first_user)
                    print(f"  ✓ اولین کاربر ساخته شد: {self.answers.first_user}")
                else:
                    names = ", ".join(str(u.get("name")) for u in users[:5])
                    print(f"  کاربران موجود: {names}")
            except Exception as exc:  # noqa: BLE001
                raise NeedsActionError(f"ساخت/خواندن کاربران ناموفق بود: {exc}")
        # ثبت نتیجهٔ هر چک در state — مبنای وضعیت نهایی صادقانه (اصلاح ۴.۴)
        self.state.data["health"] = {
            "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "simulated": self.dry_run,
            "local_url": local_url,
            "local_ok": local_ok,
            "use_https": bool(self.answers.use_https),
            "https_url": external_url if self.answers.use_https else "",
            "https_ok": https_ok,
            "hs_health_ok": hs_health_ok,
            "service_active": (not self.dry_run) and services.service_active(C.HEADSCALE_UNIT),
            "dns_ok": self.state.data.get("dns_ok"),
        }
        return "بررسی‌های سلامت ثبت شد (نتیجهٔ نهایی در جمع‌بندی)."

    def _final_install_state(self) -> str:
        """محاسبهٔ وضعیت نهایی صادقانه از دادهٔ ثبت‌شدهٔ گام‌ها (اصلاح ۴.۴).

        قواعد:
          * full_success فقط با: سرویس فعال + سلامت محلی ۲۰۰ + (در حالت HTTPS:
            پاسخ ۲۰۰ از https://دامنه/health) + DNS درست.
          * DNS ناهمخوان/ردشده → حداکثر pending_verification (بیرونی تأییدنشده).
          * سرویس غیرفعال یا سلامت محلی ناموفق → service_not_ready.
          * شکست هر گام → partial_failure (در run تشخیص داده می‌شود).
        """
        h = self.state.data.get("health") or {}
        service_ok = bool(h.get("service_active"))
        local_ok = bool(h.get("local_ok"))
        https_checked = bool(h.get("use_https"))
        https_ok = bool(h.get("https_ok"))
        dns_ok = self.state.data.get("dns_ok") is True
        if not service_ok or not local_ok:
            return "service_not_ready"
        if https_checked and not https_ok:
            return "pending_verification"
        if not dns_ok:
            return "pending_verification"
        if https_checked and https_ok:
            return "full_success"
        # حالت بدون HTTPS: همهٔ چک‌های الزامیِ این پیکربندی پاس شده است
        return "verified"

    def _step_report(self, step: Step) -> str:
        """گام ۱۶: ذخیره گزارش نصب."""
        report_dir = Path(C.LOG_DIR)
        path = report_dir / f"install-report-{time.strftime('%Y%m%d-%H%M%S')}.md"
        lines = [
            "# گزارش نصب — Headscale Easy Manager",
            f"- تاریخ: {time.strftime('%Y-%m-%d %H:%M:%S')}",
            f"- نسخه ابزار: {__version__}",
            f"- نسخه headscale: {self.state.data.get('version', '—')}",
            f"- دامنه: {self.answers.domain}",
            f"- URL سرور: {self.answers.server_url}",
            f"- MagicDNS: {self.answers.magic_dns_base}",
            f"- حالت Caddy: {self.answers.caddy_mode}",
            f"- DERP تعبیه‌شده: {'فعال' if self.answers.embedded_derp else 'غیرفعال'}",
            f"- قواعد فایروال: {', '.join(self.state.data.get('firewall_rules_added') or []) or '—'}",
            "",
            "## گام‌های انجام‌شده",
        ]
        for s in STEP_ORDER:
            status = self.state.step_status(s)
            if status:
                lines.append(f"- {STEP_TITLES[s]}: {status}")
        # وضعیت نهایی + نتیجهٔ تک‌تک چک‌ها (اصلاح ۴.۴) — همان وضعیتی که
        # جمع‌بندی کنسول نیز اعلام می‌کند؛ هرگز «موفق» نوشته نمی‌شود مگر واقعاً باشد.
        if self.dry_run:
            lines.append("- وضعیت نهایی: (dry-run — شبیه‌سازی، بدون بررسی واقعی)")
        else:
            final_state = self._final_install_state()
            lines.append(f"- وضعیت نهایی نصب: {final_state}")
            h = self.state.data.get("health") or {}
            if h:
                lines.append("- بررسی‌های سلامت:")
                lines.append(
                    f"  - سرویس فعال: {'بله' if h.get('service_active') else 'خیر'}"
                )
                lines.append(
                    f"  - سلامت محلی ({h.get('local_url') or '—'}): "
                    f"{'۲۰۰' if h.get('local_ok') else 'ناموفق'}"
                )
                if h.get("use_https"):
                    lines.append(
                        f"  - سلامت بیرونی ({h.get('https_url') or '—'}): "
                        f"{'۲۰۰' if h.get('https_ok') else 'ناموفق/در انتظار'}"
                    )
                else:
                    lines.append("  - سلامت بیرونی: (حالت بدون HTTPS — بررسی بیرونی انجام نمی‌شود)")
                lines.append(
                    f"  - DNS دامنه: "
                    f"{'درست' if self.state.data.get('dns_ok') else 'ناهمخوان/در انتظار'}"
                )
                if h.get("use_https") and not h.get("https_ok"):
                    lines.append(
                        "  - توجه: دسترسی از بیرون «تأییدنشده» است تا آماده‌شدن DNS/گواهی TLS."
                    )
        if not self.dry_run:
            report_dir.mkdir(parents=True, exist_ok=True)
            path.write_text("\n".join(lines), encoding="utf-8")
            import os

            os.chmod(path, 0o600)
            print(f"  گزارش نصب ذخیره شد: {path}")
        print("─" * 60)
        print(f"  آدرس سرور شما: {self.answers.server_url}")
        return f"گزارش: {path if not self.dry_run else '(dry-run)'}"

    def _step_next_steps(self, step: Step) -> str:
        """گام ۱۷: راهنمای گام بعدی."""
        ans = self.answers
        print("─" * 60)
        print("گام‌های بعدی شما:")
        print("  ۱) روی هر دستگاه (گوشی/لپ‌تاپ) Tailscale را نصب کنید و اجرا کنید:")
        print(f"       sudo tailscale up --login-server {ans.server_url}")
        print(f"  ۲) برای اتصال بدون مرورگر، کلید بسازید: hsctl preauth create {ans.first_user}")
        print("  ۳) برای دسترسی به شبکه دفتر: فصل ۶ (hsctl learn 6)")
        print("  ۴) وضعیت کلی: hsctl status   |   عیب‌یابی: hsctl doctor")
        print("  ۵) آموزش کامل: hsctl learn list  (۱۷ فصل فارسی)")
        return "موفق باشید!"

    # ├── ابزارهای کمکی -----------------------------------------------------------

    def _safe_save_state(self) -> None:
        """ذخیره state با تحمل خطای دسترسی (محیط‌های بدون root)."""
        try:
            self.state.save()
        except OSError as exc:
            logger.debug("ذخیره state ممکن نبود: %s", exc)

    def _domain_from_config(self) -> str:
        """خواندن دامنه از config.yaml موجود (برای adopt)."""
        try:
            import yaml

            cfg = yaml.safe_load(Path(C.HEADSCALE_CONFIG_PATH).read_text(encoding="utf-8")) or {}
            url = str(cfg.get("server_url") or "")
            for prefix in ("https://", "http://"):
                if url.startswith(prefix):
                    return url[len(prefix):].split("/")[0].split(":")[0]
        except (OSError, ValueError, yaml.YAMLError):
            pass
        return ""
