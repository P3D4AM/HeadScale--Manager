"""CLI اصلی hsctl — قرارداد دقیق در docs/FACTS.md §11.

دستورهای سیستمی بدون root با کد ۳ متوقف می‌شوند؛ فقط learn/explain/report
(و --help/--version) بدون root کار می‌کنند.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
from pathlib import Path

from hem import __version__
from hem import constants as C
from hem.core import hemlog
from hem.core.exec import HemExecError
from hem.core.hemlog import redact
from hem.core.prompts import NonInteractiveError, PromptError, confirm, set_non_interactive
from hem.headscale.ctl import HemCtlError
from hem.i18n import fmt

ROOT_REQUIRED = {
    "install", "status", "doctor", "logs", "users", "devices", "preauth", "routes",
    "backup", "restore", "update", "config", "uninstall", "cameras",
}

# الگوی محوسازی توکن‌های بلند (برای نمایش فهرست کلیدها)
_TOKENISH = re.compile(r"\b(?=[A-Za-z0-9_-]{24,}\b)(?=[^\s]*[a-zA-Z])[A-Za-z0-9_-]{24,}\b")


# --- ابزارهای نمایش -----------------------------------------------------------

def _icon(status: bool) -> str:
    return "✓" if status else "✗"


def print_table(headers: list, rows: list) -> None:
    """جدول متنی ساده — عنوان راست‌چین، داده چپ‌چین."""
    if not rows:
        print("  (موردی نیست)")
        return
    widths = [
        max(len(str(header)), *(len(str(row[i])) for row in rows))
        for i, header in enumerate(headers)
    ]
    header_line = "  ".join(str(h).rjust(w) for h, w in zip(headers, widths))
    print(header_line)
    print("─" * len(header_line))
    for row in rows:
        print("  ".join(str(cell).ljust(w) for cell, w in zip(row, widths)))


def _mask_tokens(text: str) -> str:
    """محوسازی توکن‌های بلند در خروجی جدولی (لایه دوم روی redact)."""
    return _TOKENISH.sub("•••••", text)


# --- ساختار دستورها -----------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    """ساخت کامل پارسر مطابق FACTS §11."""
    parser = argparse.ArgumentParser(
        prog="hsctl",
        description="مدیر آسان هداسکیل (Headscale Easy Manager) — نصب و مدیریت Headscale",
        epilog="مستندات فارسی: hsctl learn list   |   توضیح موضوع: hsctl explain <topic>",
    )
    parser.add_argument("--version", action="version", version=f"hsctl {__version__} — {C.PRODUCT_NAME}")

    sub = parser.add_subparsers(dest="command", metavar="<دستور>")

    # install
    p = sub.add_parser("install", help="نصب/تعمیر کامل (تعاملی یا خودکار)")
    p.add_argument("--config", metavar="FILE", help="فایل پاسخ‌های نصب (YAML)")
    p.add_argument("--non-interactive", action="store_true", help="حالت خودکار بدون پرسش")
    p.add_argument("--dry-run", action="store_true", help="فقط نمایش، بدون اعمال")
    p.add_argument("--yes", action="store_true", help="تأیید صریح برنامه تغییرات — در حالت غیرتعاملی الزامی است")
    p.add_argument("--install-dir", default=C.DEFAULT_INSTALL_DIR, metavar="DIR", help="مسیر نصب ابزار")
    p.set_defaults(handler=cmd_install)

    # status
    p = sub.add_parser("status", help="وضعیت کلی سرور و سرویس‌ها")
    p.set_defaults(handler=cmd_status)

    # doctor
    p = sub.add_parser("doctor", help="بررسی سلامت کل زنجیره")
    p.add_argument("--fix", action="store_true", help="اصلاح خودکار موارد کم‌خطر")
    p.add_argument("--json", action="store_true", help="خروجی JSON")
    p.set_defaults(handler=cmd_doctor)

    # logs
    p = sub.add_parser("logs", help="لاگ سرویس headscale (journalctl)")
    p.add_argument("--lines", type=int, default=100, metavar="N", help="تعداد خط (پیش‌فرض ۱۰۰)")
    p.add_argument("--since", metavar="DURATION", help="از زمان مشخص (مثلاً 1h یا 2024-01-01)")
    p.add_argument("--follow", "-f", action="store_true", help="دنبال‌کردن زنده لاگ")
    p.set_defaults(handler=cmd_logs)

    # users
    p = sub.add_parser("users", help="مدیریت کاربران")
    users_sub = p.add_subparsers(dest="action")
    users_sub.add_parser("list", help="فهرست کاربران")
    pu = users_sub.add_parser("create", help="ساخت کاربر")
    pu.add_argument("name")
    pu = users_sub.add_parser("delete", help="حذف کاربر")
    pu.add_argument("target", metavar="name-or-id")
    pu.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_users)

    # devices
    p = sub.add_parser("devices", help="مدیریت دستگاه‌ها")
    devices_sub = p.add_subparsers(dest="action")
    devices_sub.add_parser("list", help="فهرست دستگاه‌ها")
    pd = devices_sub.add_parser("delete", help="حذف دستگاه")
    pd.add_argument("id", type=int)
    pd.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_devices)

    # preauth
    p = sub.add_parser("preauth", help="کلیدهای اتصال از پیش تأییدشده")
    preauth_sub = p.add_subparsers(dest="action")
    pc = preauth_sub.add_parser("create", help="ساخت کلید برای کاربر")
    pc.add_argument("user", help="نام کاربر (به شناسه عددی تبدیل می‌شود)")
    pc.add_argument("--reusable", action="store_true", help="چندبار مصرف")
    pc.add_argument("--ephemeral", action="store_true", help="دستگاه موقت")
    pc.add_argument("--expiration", default="1h", metavar="1h", help="انقضا (پیش‌فرض 1h)")
    pc.add_argument("--tags", nargs="+", metavar="TAG", help="برچسب‌ها (مثلاً tag:camera)")
    pl = preauth_sub.add_parser("list", help="فهرست کلیدهای کاربر")
    pl.add_argument("user")
    p.set_defaults(handler=cmd_preauth)

    # routes
    p = sub.add_parser("routes", help="مدیریت مسیرها (Routes)")
    routes_sub = p.add_subparsers(dest="action")
    routes_sub.add_parser("list", help="فهرست مسیرها")
    pr = routes_sub.add_parser("approve", help="تأیید مسیرهای دستگاه")
    pr.add_argument("node_id", type=int, metavar="node-id")
    pr.add_argument("--routes", required=True, metavar="CIDR,CIDR", help="رنج‌ها با کاما")
    pr = routes_sub.add_parser("revoke", help="لغو همه تأییدهای دستگاه")
    pr.add_argument("node_id", type=int, metavar="node-id")
    pr.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_routes)

    # backup
    p = sub.add_parser("backup", help="پشتیبان‌گیری")
    backup_sub = p.add_subparsers(dest="action")
    pb = backup_sub.add_parser("create", help="ساخت پشتیبان کامل")
    pb.add_argument("--output", metavar="FILE", help="مسیر خروجی")
    backup_sub.add_parser("list", help="فهرست پشتیبان‌ها")
    pb = backup_sub.add_parser("verify", help="راستی‌آزمایی فایل پشتیبان")
    pb.add_argument("file")
    p.set_defaults(handler=cmd_backup)

    # restore
    p = sub.add_parser("restore", help="بازیابی از پشتیبان")
    p.add_argument("file")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_restore)

    # update
    p = sub.add_parser("update", help="به‌روزرسانی headscale (نسخه‌به‌نسخه)")
    p.add_argument("--check", action="store_true", help="فقط بررسی نسخه جدید")
    p.add_argument("--version", metavar="X.Y.Z", help="نسخه هدف مشخص")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_update)

    # config
    p = sub.add_parser("config", help="پیکربندی headscale")
    config_sub = p.add_subparsers(dest="action")
    config_sub.add_parser("show", help="نمایش فایل پیکربندی (محوسازی‌شده)")
    config_sub.add_parser("path", help="نمایش مسیر فایل پیکربندی")
    config_sub.add_parser("validate", help="اعتبارسنجی با configtest")
    p.set_defaults(handler=cmd_config)

    # cameras
    p = sub.add_parser("cameras", help="مدیریت دوربین‌های مداربسته")
    cameras_sub = p.add_subparsers(dest="action")
    cameras_sub.add_parser("list", help="فهرست دوربین‌ها")
    cameras_sub.add_parser("add", help="افزودن تعاملی")
    pc = cameras_sub.add_parser("remove", help="حذف")
    pc.add_argument("name")
    pc = cameras_sub.add_parser("check", help="بررسی دسترسی شبکه")
    pc.add_argument("--name", metavar="NAME", help="فقط دوربین مشخص")
    pc.add_argument("--from-client", action="store_true", help="تست TCP واقعی به پورت‌ها")
    p.set_defaults(handler=cmd_cameras)

    # learn
    p = sub.add_parser("learn", help="مرکز آموزش فارسی (۱۷ فصل)")
    p.add_argument("topic", nargs="?", default=None, help="شماره فصل یا list")
    p.set_defaults(handler=cmd_learn)

    # explain
    p = sub.add_parser("explain", help="توضیح کوتاه یک موضوع")
    p.add_argument("topic", help="موضوع (مثلاً routes، subnet-router، preauthkey)")
    p.set_defaults(handler=cmd_explain)

    # report
    p = sub.add_parser("report", help="گزارش وضعیت قابل‌ارسال (محوسازی‌شده)")
    p.add_argument("--output", metavar="FILE", help="مسیر خروجی")
    p.set_defaults(handler=cmd_report)

    # uninstall
    p = sub.add_parser("uninstall", help="حذف نصب (فقط کارهای خود ابزار)")
    p.add_argument("--purge-data", action="store_true", help="حذف کامل داده‌ها و پشتیبان‌ها")
    p.add_argument("--yes", action="store_true")
    p.set_defaults(handler=cmd_uninstall)

    return parser


# --- توابع کمکی مشترک ---------------------------------------------------------

def _require_hscli():
    """بارگذاری ماژول ctl — با پیام فارسی در صورت نبود headscale."""
    from hem.headscale import ctl
    from hem.headscale import installer as hs_installer

    if not hs_installer.is_installed():
        print(f"✗ {fmt('headscale_not_installed')}")
        return None, C.EXIT_MISSING
    return ctl, None


def _load_state() -> dict:
    """خواندن state.json (خالی در صورت نبود)."""
    from hem.installer.flow import StateManager

    return StateManager().data


def _parse_cidrs(raw: str) -> tuple:
    """اعتبارسنجی رشته CIDRها — خروجی: (لیست درست، خطای فارسی)."""
    networks = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            networks.append(str(ipaddress.ip_network(part, strict=False)))
        except ValueError:
            return [], fmt("invalid_cidr", value=part)
    if not networks:
        return [], "حداقل یک CIDR لازم است."
    return networks, None


# --- دستورها -------------------------------------------------------------------

def cmd_install(args) -> int:
    """نصب/تعمیر — منطق کامل در installer.flow."""
    from hem.installer.flow import InstallFlow

    if args.non_interactive:
        set_non_interactive(True)
    try:
        flow = InstallFlow(
            config_file=args.config,
            non_interactive=args.non_interactive,
            dry_run=args.dry_run,
            install_dir=args.install_dir,
            assume_yes=args.yes,
        )
        return flow.run()
    except ValueError as exc:  # خطای فایل پیکربندی
        print(f"✗ {exc}")
        return C.EXIT_INVALID
    except (PromptError, NonInteractiveError) as exc:
        print(f"✗ {exc}")
        return C.EXIT_NO_CONFIRM


def cmd_status(args) -> int:  # noqa: ARG001
    """وضعیت کلی — همه چیز در یک نگاه با آیکن."""
    from hem.headscale import installer as hs_installer
    from hem.installer.flow import StateManager
    from hem.network import dnscheck
    from hem.network import ips as net_ips
    from hem.network import ports as net_ports
    from hem.proxy import caddy
    from hem.system import services

    state = StateManager().data
    domain = str(state.get("domain") or "")
    if not domain:
        # تلاش برای خواندن از config.yaml
        from hem.diagnostics.doctor import _domain_from_state

        domain = _domain_from_state()

    print("═" * 62)
    print(f"  وضعیت — {C.PRODUCT_NAME_FA}")
    print("═" * 62)
    hs_ver = hs_installer.current_version()
    if hs_ver is None:
        print(f"  {_icon(False)} headscale: {fmt('not_installed')}")
        print("    → نصب: sudo hsctl install")
        return C.EXIT_MISSING
    print(f"  {_icon(True)} headscale نسخه {hs_ver} نصب است (ابزار: {__version__})")

    active = services.service_active(C.HEADSCALE_UNIT)
    enabled = services.service_enabled(C.HEADSCALE_UNIT)
    print(f"  {_icon(active)} سرویس headscale: {'فعال' if active else 'غیرفعال'}"
          f" | شروع خودکار: {'فعال' if enabled else 'غیرفعال'}")
    if not active:
        print("    → راه‌اندازی: sudo systemctl start headscale")

    caddy_on = caddy.caddy_installed() and caddy.caddy_active()
    print(f"  {_icon(caddy_on)} Caddy: "
          f"{'نصب و فعال' if caddy_on else ('نصب ولی غیرفعال' if caddy.caddy_installed() else 'نصب نیست')}")

    # گواهی TLS
    if domain:
        from hem.diagnostics.doctor import _https_health

        tls_ok, tls_detail = _https_health(domain)
        print(f"  {_icon(tls_ok)} HTTPS ({domain}/health): {tls_detail}")
        # DNS
        v4, _v6 = net_ips.server_addresses()
        public = net_ips.public_ip_from_api()
        dns = dnscheck.check_domain(domain, v4 + ([public] if public else []))
        print(f"  {_icon(dns.ok)} DNS: {dns.advice}")
    else:
        print("  ؟ دامنه در state ثبت نشده (hsctl install یا config show را ببینید).")

    # پورت‌ها
    for port, proto in ((80, "tcp"), (443, "tcp"), (3478, "udp")):
        owner = net_ports.port_taken_by(port, proto)
        if owner:
            print(f"  {_icon(True)} پورت {port}/{proto}: در اختیار {owner}")
        elif net_ports.port_free(port, proto):
            print(f"  ! پورت {port}/{proto}: آزاد (سرویس‌دهی نمی‌کند)")
        else:
            print(f"  {_icon(False)} پورت {port}/{proto}: اشغال")

    import shutil

    free_gb = shutil.disk_usage("/").free / (1024 ** 3)
    print(f"  {_icon(free_gb >= 1)} فضای دیسک: {free_gb:.1f} گیگابایت آزاد")
    print(f"  • پیکربندی: {C.HEADSCALE_CONFIG_PATH}")
    from hem.backup import manager

    backups = manager.list_backups()
    print(f"  • پشتیبان‌ها: {C.BACKUP_DIR} ({len(backups)} فایل)")
    return C.EXIT_OK


def cmd_doctor(args) -> int:
    """دکتر — بررسی سلامت کل زنجیره."""
    from hem.diagnostics.doctor import run_doctor

    checks = run_doctor(fix=args.fix, json_output=args.json)
    bad = sum(1 for c in checks if c.status in ("warn", "fail"))
    return C.EXIT_OK if bad == 0 else C.EXIT_ERROR


def cmd_logs(args) -> int:
    """لاگ سرویس headscale با محوسازی."""
    from hem.system import services

    if args.follow:
        try:
            services.journal_logs(C.HEADSCALE_UNIT, lines=args.lines, since=args.since, follow=True)
        except HemExecError as exc:
            print(f"✗ {exc}")
            return C.EXIT_MISSING
        return C.EXIT_OK
    lines = services.journal_logs(C.HEADSCALE_UNIT, lines=args.lines, since=args.since)
    if lines is None:
        print("✗ خواندن لاگ ممکن نشد (journalctl موجود نیست یا سرویس تعریف نشده).")
        return C.EXIT_MISSING
    for line in lines:
        print(redact(line))
    return C.EXIT_OK


def cmd_users(args) -> int:
    """مدیریت کاربران."""
    ctl, rc = _require_hscli()
    if ctl is None:
        return rc
    action = args.action or "list"
    try:
        if action == "list":
            users = ctl.users_list()
            rows = [[str(u.get("id", "")), str(u.get("name", "")),
                     str(u.get("email", "—"))] for u in users]
            print("کاربران شبکه:")
            print_table(["شناسه", "نام", "ایمیل"], rows)
            return C.EXIT_OK
        if action == "create":
            ctl.users_create(args.name)
            print(f"✓ کاربر «{args.name}» ساخته شد.")
            return C.EXIT_OK
        if action == "delete":
            user = ctl.find_user(args.target)
            if user is None:
                print(f"✗ {fmt('user_not_found', name=args.target)}")
                return C.EXIT_MISSING
            if not args.yes and not confirm(
                fmt("confirm_delete_user", name=user.get("name"), id=user.get("id"))
            ):
                return C.EXIT_NO_CONFIRM
            ctl.users_delete(args.target)
            print(f"✓ کاربر «{user.get('name')}» حذف شد.")
            return C.EXIT_OK
    except (HemCtlError, HemExecError) as exc:
        print(f"✗ {exc}")
        return C.EXIT_ERROR
    return C.EXIT_INVALID


def cmd_devices(args) -> int:
    """مدیریت دستگاه‌ها."""
    ctl, rc = _require_hscli()
    if ctl is None:
        return rc
    action = args.action or "list"
    try:
        if action == "list":
            nodes = ctl.nodes_list()
            rows = []
            for node in nodes:
                ips = ",".join(str(ip) for ip in (node.get("ipAddresses") or []))
                user = node.get("user") or {}
                user_name = user.get("name", "") if isinstance(user, dict) else str(user)
                rows.append([
                    str(node.get("id", "")),
                    str(node.get("name", "")),
                    str(user_name),
                    ips,
                ])
            print("دستگاه‌های شبکه:")
            print_table(["شناسه", "نام", "کاربر", "IPها"], rows)
            return C.EXIT_OK
        if action == "delete":
            if not args.yes and not confirm(fmt("confirm_delete_device", name=f"#{args.id}", id=args.id)):
                return C.EXIT_NO_CONFIRM
            ctl.delete_node(args.id)
            print(f"✓ دستگاه #{args.id} حذف شد.")
            return C.EXIT_OK
    except (HemCtlError, HemExecError) as exc:
        print(f"✗ {exc}")
        return C.EXIT_ERROR
    return C.EXIT_INVALID


def cmd_preauth(args) -> int:
    """کلیدهای preauth — نام کاربر به شناسه عددی تبدیل می‌شود (FACTS §4)."""
    ctl, rc = _require_hscli()
    if ctl is None:
        return rc
    action = args.action or "create"
    try:
        user = ctl.find_user(args.user)
        if user is None:
            print(f"✗ {fmt('user_not_found', name=args.user)}")
            return C.EXIT_MISSING
        user_id = user.get("id")
        if action == "create":
            key = ctl.preauth_create(
                user_id,
                reusable=args.reusable,
                ephemeral=args.ephemeral,
                expiration=args.expiration,
                tags=args.tags,
            )
            print("═" * 62)
            print(f"کلید اتصال برای کاربر «{user.get('name')}» ساخته شد:")
            print()
            print(f"  {key}")
            print()
            print(fmt("key_shown_once"))
            print("═" * 62)
            return C.EXIT_OK
        if action == "list":
            output = ctl.preauth_list(user_id)
            print(f"کلیدهای کاربر «{user.get('name')}» (محوسازی‌شده):")
            print(_mask_tokens(redact(output)))
            return C.EXIT_OK
    except (HemCtlError, HemExecError) as exc:
        print(f"✗ {exc}")
        return C.EXIT_ERROR
    return C.EXIT_INVALID


def cmd_routes(args) -> int:
    """مدیریت مسیرها."""
    ctl, rc = _require_hscli()
    if ctl is None:
        return rc
    action = args.action or "list"
    try:
        if action == "list":
            try:
                summary = ctl.routes_summary()
                rows = [
                    [str(s["id"]), s["name"], s["user"],
                     "، ".join(s["approved"]) or "—",
                     "، ".join(s["available"]) or "—"]
                    for s in summary
                ]
                print("مسیرهای شبکه (Routes):")
                print_table(["شناسه", "دستگاه", "کاربر", "تأییدشده", "در دسترس"], rows)
            except HemCtlError as exc:
                print(f"⚠ {exc} — نمایش خروجی خام:")
                print(ctl.nodes_list_routes())
            return C.EXIT_OK
        if action == "approve":
            networks, error = _parse_cidrs(args.routes)
            if error:
                print(f"✗ {error}")
                return C.EXIT_INVALID
            ctl.approve_routes(args.node_id, networks)
            print(f"✓ مسیرهای {'، '.join(networks)} برای دستگاه #{args.node_id} تأیید شد.")
            cmd_routes(argparse.Namespace(action="list"))
            return C.EXIT_OK
        if action == "revoke":
            if not args.yes and not confirm(fmt("confirm_revoke_routes", id=args.node_id)):
                return C.EXIT_NO_CONFIRM
            ctl.revoke_routes(args.node_id)
            print(f"✓ همه تأییدهای دستگاه #{args.node_id} لغو شد.")
            return C.EXIT_OK
    except (HemCtlError, HemExecError) as exc:
        print(f"✗ {exc}")
        return C.EXIT_ERROR
    return C.EXIT_INVALID


def cmd_backup(args) -> int:
    """پشتیبان‌گیری."""
    action = args.action or "create"
    if action == "create":
        from hem.backup.create import create_backup

        try:
            path = create_backup(output=args.output)
            print(f"برای اطمینان: sudo hsctl backup verify {path}")
            return C.EXIT_OK
        except Exception as exc:  # noqa: BLE001
            print(f"✗ {exc}")
            return C.EXIT_ERROR
    if action == "list":
        from hem.backup import manager

        backups = manager.list_backups()
        if not backups:
            print(f"هیچ پشتیبانی در {C.BACKUP_DIR} نیست. ساخت: sudo hsctl backup create")
            return C.EXIT_OK
        rows = [[b.name, f"{b.stat().st_size / (1024 * 1024):.1f} MB"] for b in backups]
        print(f"پشتیبان‌ها در {C.BACKUP_DIR}:")
        print_table(["نام فایل", "حجم"], rows)
        return C.EXIT_OK
    if action == "verify":
        from hem.backup import manager

        ok, issues = manager.verify_backup(args.file)
        if ok:
            print(f"✓ {fmt('backup_verify_ok')}")
            return C.EXIT_OK
        print("✗ پشتیبان قابل اعتماد نیست:")
        for issue in issues:
            print(f"  - {issue}")
        return C.EXIT_ERROR
    return C.EXIT_INVALID


def cmd_restore(args) -> int:
    """بازیابی پشتیبان."""
    from hem.backup.restore import restore_backup

    return restore_backup(args.file, yes=args.yes)


def cmd_update(args) -> int:
    """به‌روزرسانی headscale — نسخه‌به‌نسخه، با پشتیبان و rollback واقعی (اصلاح ۴.۷).

    در شکست نصب/اعتبارسنجی/راه‌اندازیِ نسخهٔ جدید، بستهٔ قبلی واقعاً برمی‌گردد:
    توقف سرویس → نصب مجدد deb قبلی → بازگرداندن پیکربندی (در صورت لزوم) →
    راه‌اندازی و بررسی سلامت. اگر خود rollback هم شکست بخورد، هر دو شکست
    صادقانه گزارش می‌شوند — هرگز «بازگشت انجام شد» ادعا نمی‌شود.
    """
    import json as _json
    import shutil as _shutil
    import time as _time
    from pathlib import Path

    from hem.core.runner import Step, StepRunner
    from hem.headscale import installer as hs_installer
    from hem.headscale import releases
    from hem.installer.flow import StateManager

    current = hs_installer.current_version()
    if current is None:
        print(f"✗ {fmt('headscale_not_installed')}")
        return C.EXIT_MISSING

    if args.version:
        target = releases.normalize_version(args.version)
        target_from = "نسخه درخواستی شما"
    else:
        target, from_network = releases.latest_version()
        target_from = "آخرین نسخه پایدار GitHub" if from_network else "نسخه پین‌شده (شبکه در دسترس نبود)"

    print(f"نسخه فعلی: {current} | نسخه هدف: {target} ({target_from})")
    if args.check:
        if current == target:
            print("✓ به‌روز هستید.")
        else:
            print("برای ارتقا: sudo hsctl update --yes")
        return C.EXIT_OK
    if current == target:
        print("✓ به‌روز هستید؛ کاری لازم نیست.")
        return C.EXIT_OK

    cur = tuple(int(x) for x in current.split("."))
    tgt = tuple(int(x) for x in target.split("."))
    if tgt < cur:
        print(f"⚠ {fmt('update_downgrade', target=target, current=current)}")
    elif tgt[:2] != cur[:2] and not (tgt[0] == cur[0] and tgt[1] == cur[1] + 1):
        # پرش minor — قید رسمی: ارتقا نسخه‌به‌نسخه
        print(f"⚠ {fmt('update_version_jump', current=current, target=target)}")
    if not args.yes:
        try:
            if not confirm("ارتقا انجام شود؟", default=False):
                return C.EXIT_NO_CONFIRM
        except NonInteractiveError:
            print("✗ در حالت غیرتعاملی از --yes استفاده کنید.")
            return C.EXIT_NO_CONFIRM

    runner = StepRunner(title=f"به‌روزرسانی headscale {current} → {target}", total=6)
    backup_path = None
    old_deb_path: Path | None = None
    failed_step: str | None = None
    # دایرکتوری شناسنامهٔ بازگشت (اصلاح ۴.۷) — همهٔ مسیرهای rollback اینجا ثبت می‌شوند
    rollback_dir = Path(C.BACKUP_DIR) / "updates" / _time.strftime("%Y%m%d-%H%M%S")
    config_backup_path = rollback_dir / "config.yaml.pre-update"

    def _backup(step: Step):
        nonlocal backup_path
        from hem.backup.create import create_backup

        backup_path = create_backup()
        return str(backup_path)

    def _prepare_rollback(step: Step):
        """آماده‌سازی واقعی بازگشت: بستهٔ فعلی + پشتیبان پیکربندی + manifest (اصلاح ۴.۷).

        اگر بستهٔ فعلی نه در کش apt باشد و نه با checksum رسمی قابل دانلود،
        ارتقا «قبل از هر تغییری» متوقف می‌شود (rollback بدون بستهٔ قبلی ممکن نیست).
        """
        nonlocal old_deb_path
        arch = hs_installer._arch()
        dest = Path("/var/tmp") / f"hem-rollback-headscale-{current}-{arch}.deb"
        if not dest.exists():
            cached = Path("/var/cache/apt/archives") / releases.deb_filename(current, arch)
            if cached.exists():
                _shutil.copy2(cached, dest)
                print(f"  بستهٔ فعلی از کش apt کپی شد: {cached}")
            else:
                # checksum الزامی (اصلاح ۴.۵) — در نبود checksum رسمی، توقف کامل
                sha256 = hs_installer.mandatory_checksum(current)
                url = releases.deb_url(current, arch)
                print(f"  دانلود بستهٔ فعلی برای بازگشت: {url}")
                hs_installer.download(url, dest, expected_sha256=sha256)
        old_deb_path = dest
        manifest = {
            "old_version": current,
            "new_version": target,
            "deb_path": str(dest),
            "config_backup": "",
            "db_backup": str(backup_path) if backup_path else "",
            "created_at": _time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        # پشتیبان مستقیم پیکربندی فعلی (برای بازگردانی سریع در rollback)
        cfg = Path(C.HEADSCALE_CONFIG_PATH)
        if cfg.exists():
            try:
                rollback_dir.mkdir(parents=True, exist_ok=True)
                _shutil.copy2(cfg, config_backup_path)
                manifest["config_backup"] = str(config_backup_path)
            except OSError as exc:
                print(f"  ⚠ پشتیبان مستقیم پیکربندی ممکن نشد ({exc}) — پشتیبان کامل بالا مرجع است.")
        try:
            rollback_dir.mkdir(parents=True, exist_ok=True)
            (rollback_dir / "manifest.json").write_text(
                _json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            print(f"  شناسنامهٔ بازگشت: {rollback_dir / 'manifest.json'}")
        except OSError as exc:
            print(f"  ⚠ نوشتن manifest بازگشت ناموفق بود ({exc}).")
        return f"بستهٔ قبلی آمادهٔ بازگشت: {dest.name}"

    def _stop(step: Step):
        from hem.system import services

        services.systemctl("stop", C.HEADSCALE_UNIT)

    def _install(step: Step):
        # checksum الزامی (اصلاح ۴.۵) — نسخهٔ بدون checksum رسمی هرگز نصب نمی‌شود
        version, sha256 = hs_installer.resolve_target_version(target)
        url = releases.deb_url(version, hs_installer._arch())
        dest = Path("/var/tmp") / f"hem-headscale-{version}.deb"
        hs_installer.download(url, dest, expected_sha256=sha256)
        hs_installer.install_deb(dest)
        installed = hs_installer.current_version()
        if installed != version:
            raise RuntimeError(f"نسخهٔ نصب‌شده ({installed}) با نسخهٔ هدف ({version}) یکی نیست.")

    def _configtest(step: Step):
        from hem.headscale.config import validate_config

        ok, message = validate_config()
        if not ok:
            raise RuntimeError(f"configtest رد شد: {message}")

    def _start(step: Step):
        from hem.system import services

        services.systemctl("start", C.HEADSCALE_UNIT)
        if not services.wait_healthy(C.HEADSCALE_UNIT, 60):
            raise RuntimeError("سرویس بالا نیامد (لاگ: hsctl logs)")

    for step, fn in (
        (Step("پشتیبان کامل قبل از ارتقا", risk="safe"), _backup),
        (Step("آماده‌سازی بازگشت (بستهٔ فعلی)", risk="safe"), _prepare_rollback),
        (Step("توقف سرویس", risk="risky"), _stop),
        (Step("دانلود و نصب نسخه جدید", risk="risky"), _install),
        (Step("اعتبارسنجی پیکربندی", risk="safe"), _configtest),
        (Step("راه‌اندازی و بررسی سلامت", risk="safe"), _start),
    ):
        if not runner.run(step, fn):
            failed_step = step.name
            break

    if failed_step is not None or not runner.summary():
        # ── شکست ارتقا: گزارش صادقانه + بازگشت واقعی (اصلاح ۴.۷) ─────────
        print("─" * 60)
        print(f"✗ {fmt('update_failed_title')} (گام: {failed_step or 'نامشخص'})")
        if backup_path:
            print(f"    پشتیبان کامل پیش از ارتقا: {backup_path}")
        if old_deb_path is not None:
            print(fmt("update_rollback_started"))
            rollback_ok = False
            try:
                rollback_ok = _run_update_rollback(
                    current=current,
                    old_deb_path=old_deb_path,
                    config_backup_path=config_backup_path,
                    restore_config=(failed_step == "اعتبارسنجی پیکربندی"),
                )
            except Exception as exc:  # noqa: BLE001 — گزارش صادقانه، نه فروافتادن
                print(f"✗ {fmt('update_rollback_failed')} ({exc})")
            if rollback_ok:
                print(f"✓ {fmt('update_rollback_ok', version=current)}")
                if backup_path:
                    print(f"    پشتیبان کامل (در صورت نیاز): sudo hsctl restore {backup_path}")
            else:
                # هرگز «بازگشت انجام شد» ادعا نمی‌شود — هر دو شکست صادقانه می‌مانند
                print(f"✗ {fmt('update_rollback_failed')}")
                print("    وضعیت سرور را بررسی کنید: hsctl doctor  |  لاگ: hsctl logs")
                if backup_path:
                    print(f"    پشتیبان کامل: sudo hsctl restore {backup_path}")
        else:
            # شکست در آماده‌سازی — هنوز هیچ تغییری روی سرویس/بسته اعمال نشده است
            print(f"✗ {fmt('update_rollback_not_prepared')}")
        return C.EXIT_ERROR

    state = StateManager()
    state.data["version"] = target
    try:
        state.save()
    except OSError:
        pass
    print(f"✓ ارتقا به headscale {target} کامل شد.")
    return C.EXIT_OK


def _run_update_rollback(current: str, old_deb_path: Path, config_backup_path: Path,
                         restore_config: bool) -> bool:
    """بازگشت واقعی به نسخهٔ قبلی با StepRunner (اصلاح ۴.۷) — فقط از cmd_update.

    مراحل: توقف سرویس → نصب مجدد deb قبلی (apt با DEBIAN_FRONTEND=noninteractive)
    → بازگرداندن پیکربندی پیش از ارتقا (فقط اگر شکست مربوط به configtest بود)
    → راه‌اندازی و بررسی سلامت. خروجی False یعنی rollback کامل نشد.
    """
    import shutil as _shutil
    from pathlib import Path

    from hem.core.runner import Step, StepRunner
    from hem.headscale import installer as hs_installer
    from hem.system import services

    rb = StepRunner(title=f"بازگشت به headscale {current}", total=4)

    def _rb_stop(step: Step):
        if services.service_active(C.HEADSCALE_UNIT):
            services.systemctl("stop", C.HEADSCALE_UNIT)
            return "سرویس متوقف شد."
        return "سرویس از قبل متوقف بود."

    def _rb_install(step: Step):
        if not old_deb_path or not Path(old_deb_path).exists():
            raise RuntimeError("بستهٔ نسخهٔ قبلی در دسترس نیست.")
        hs_installer.install_deb(old_deb_path)
        ver = hs_installer.current_version()
        if ver != current:
            raise RuntimeError(f"نسخهٔ بازگردانده‌شده ({ver}) با نسخهٔ قبلی ({current}) یکی نیست.")
        return f"بستهٔ {current} نصب شد."

    def _rb_config(step: Step):
        if not restore_config:
            return "پیکربندی دست‌نخورده ماند (شکست مربوط به پیکربندی نبود)."
        if config_backup_path.exists():
            _shutil.copy2(config_backup_path, C.HEADSCALE_CONFIG_PATH)
            return "پیکربندی پیش از ارتقا بازگردانده شد."
        raise RuntimeError("پشتیبان پیکربندی پیش از ارتقا پیدا نشد.")

    def _rb_start(step: Step):
        services.systemctl("start", C.HEADSCALE_UNIT)
        if not services.wait_healthy(C.HEADSCALE_UNIT, 60):
            raise RuntimeError("سرویس پس از بازگشت بالا نیامد (لاگ: hsctl logs)")
        return "سرویس سالم بالا آمد."

    for step, fn in (
        (Step("توقف سرویس", risk="risky"), _rb_stop),
        (Step("نصب بستهٔ نسخهٔ قبلی", risk="risky"), _rb_install),
        (Step("بازگرداندن پیکربندی (در صورت نیاز)", risk="risky"), _rb_config),
        (Step("راه‌اندازی و بررسی سلامت", risk="safe"), _rb_start),
    ):
        if not rb.run(step, fn):
            return False
    return rb.summary()


def cmd_config(args) -> int:
    """پیکربندی headscale."""
    from pathlib import Path

    action = args.action or "show"
    if action == "path":
        print(C.HEADSCALE_CONFIG_PATH)
        return C.EXIT_OK
    path = Path(C.HEADSCALE_CONFIG_PATH)
    if action == "show":
        if not path.exists():
            print(f"✗ فایل پیکربندی وجود ندارد: {path}")
            return C.EXIT_MISSING
        print(redact(path.read_text(encoding="utf-8", errors="replace")))
        return C.EXIT_OK
    if action == "validate":
        from hem.headscale.config import validate_config

        ok, message = validate_config()
        if ok:
            print(f"✓ {message}")
            return C.EXIT_OK
        print(f"✗ {message}")
        return C.EXIT_ERROR
    return C.EXIT_INVALID


def cmd_cameras(args) -> int:
    """مدیریت دوربین‌ها."""
    from hem.cameras import checker, registry

    action = args.action or "list"
    if action == "list":
        cams = registry.load()
        if not cams:
            print(fmt("cameras_empty"))
            return C.EXIT_OK
        rows = [[c.name, c.host, str(c.http_port or "؟"), str(c.rtsp_port or "؟"), c.brand or "—"]
                for c in cams]
        print("دستگاه‌های ثبت‌شده (هیچ رمزی ذخیره نمی‌شود):")
        print_table(["نام", "IP", "پورت HTTP", "پورت RTSP", "برند"], rows)
        print("بررسی دسترسی: sudo hsctl cameras check")
        return C.EXIT_OK
    if action == "add":
        registry.add_interactive()
        return C.EXIT_OK
    if action == "remove":
        if registry.remove(args.name):
            print(f"✓ دوربین «{args.name}» حذف شد.")
            return C.EXIT_OK
        print(f"✗ {fmt('camera_not_found', name=args.name)}")
        return C.EXIT_ERROR
    if action == "check":
        cams = registry.load()
        if args.name:
            cams = [c for c in cams if c.name == args.name]
            if not cams:
                print(f"✗ {fmt('camera_not_found', name=args.name)}")
                return C.EXIT_ERROR
        if not cams:
            print(fmt("cameras_empty"))
            return C.EXIT_OK
        exit_code = C.EXIT_OK
        for cam in cams:
            try:
                result = checker.check_camera(cam, from_client=args.from_client)
                print(checker.describe(result, cam))
            except (HemCtlError, HemExecError) as exc:
                print(f"✗ دوربین «{cam.name}»: {exc}")
                exit_code = C.EXIT_MISSING
            print()
        return exit_code
    return C.EXIT_INVALID


def cmd_learn(args) -> int:
    """مرکز آموزش."""
    from hem.learn import chapters

    topic = (args.topic or "list").strip().lower()
    if topic in ("list", "فهرست", ""):
        found = chapters.list_chapters()
        if not found:
            print(f"✗ {chapters.chapters_help()}")
            return C.EXIT_MISSING
        print("فصل‌های آموزشی:")
        for chapter in found:
            print(f"  {chapter.number:>2}. {chapter.title}")
            if chapter.description:
                print(f"       {chapter.description}")
        print("\nخواندن فصل: hsctl learn <شماره>   |   توضیح موضوع: hsctl explain <topic>")
        return C.EXIT_OK
    if not topic.isdigit():
        print("✗ ورودی نامعتبر — شماره فصل یا list بدهید.")
        return C.EXIT_INVALID
    text = chapters.read_chapter(int(topic))
    if text is None:
        print(f"✗ {fmt('chapter_not_found', n=topic)}")
        return C.EXIT_INVALID
    print(text)
    return C.EXIT_OK


def cmd_explain(args) -> int:
    """توضیح موضوع."""
    from hem.learn.explain import explain

    return C.EXIT_OK if explain(args.topic) else C.EXIT_INVALID


def cmd_report(args) -> int:
    """گزارش وضعیت محوسازی‌شده."""
    from hem.diagnostics.report import save_report

    save_report(args.output)
    return C.EXIT_OK


def cmd_uninstall(args) -> int:
    """حذف نصب — فقط کارهای خود ابزار برمی‌گردد؛ پشتیبان‌ها حفظ می‌شوند."""
    import shutil as _shutil
    from pathlib import Path

    from hem.core.runner import Step, StepRunner
    from hem.installer.flow import StateManager
    from hem.proxy import caddy
    from hem.system import firewall, packages, services

    state = StateManager().data
    if not state.get("steps"):
        print("⚠ state.json پیدا نشد — فقط موارد قابل‌تشخیص حذف می‌شوند.")

    print("─" * 60)
    print("برنامه حذف نصب (فقط کارهای خود ابزار):")
    we_installed_caddy = "caddy" in (state.get("installed_services") or [])
    actions = []
    if caddy.has_site_block():
        actions.append("حذف بلوک headscale از Caddyfile (بین مارکرها)")
    rules = state.get("firewall_rules_added") or []
    if rules:
        actions.append(f"حذف قواعد فایروال خودمان: {'، '.join(rules)}")
    actions.append("توقف و غیرفعال‌کردن سرویس headscale")
    actions.append("حذف بسته headscale" + (" (با purge کامل داده‌ها)" if args.purge_data else " (بدون حذف داده‌ها)"))
    if we_installed_caddy:
        actions.append("حذف بسته caddy (خودمان نصبش کرده بودیم)")
    if args.purge_data:
        actions.append("حذف پوشه پشتیبان‌ها /var/backups/hem")
    for line in actions:
        print(f"  • {line}")
    print("  • پشتیبان‌ها حفظ می‌شوند" + (" مگر با --purge-data" if not args.purge_data else ""))
    print("  • سرویس‌های نامرتبط (nginx و…) هرگز دست نمی‌خورند")

    try:
        if not args.yes and not confirm(fmt("confirm_uninstall"), default=False):
            return C.EXIT_NO_CONFIRM
        if args.purge_data and not confirm(fmt("confirm_purge"), default=False):
            return C.EXIT_NO_CONFIRM
    except NonInteractiveError:
        print("✗ در حالت غیرتعاملی از --yes استفاده کنید.")
        return C.EXIT_NO_CONFIRM

    runner = StepRunner(title="حذف نصب", total=len(actions))

    def _remove_caddy_block(step: Step):
        removed = caddy.remove_site_block()
        if removed is None:
            return "بلوکی نبود."
        ok, message = caddy.validate_caddy()
        if not ok:
            print(f"  ⚠ caddy validate پس از حذف بلوک رد شد: {message}")
        if caddy.caddy_active():
            caddy.reload_caddy()
        return "بلوک حذف و Caddy بارگذاری مجدد شد."

    def _remove_firewall(step: Step):
        # بازگشت واقعی کارهای فایروال خودمان (اصلاح ۴.۶): فقط قواعد افزودهٔ خودِ
        # ابزار حذف می‌شوند و اگر خودمان ufw را فعال کرده بودیم، دوباره غیرفعال می‌شود.
        removed, disabled = firewall.firewall_rollback(state)
        message = f"{removed} قاعده حذف شد."
        if disabled:
            message += " (ufw که خودمان فعال کرده بودیم، دوباره غیرفعال شد)"
        return message

    def _stop_service(step: Step):
        services.systemctl("stop", C.HEADSCALE_UNIT)
        services.systemctl("disable", C.HEADSCALE_UNIT)
        return "سرویس متوقف و غیرفعال شد."

    def _remove_headscale(step: Step):
        packages.apt_remove(["headscale"], purge=args.purge_data)
        return "بسته headscale حذف شد."

    def _remove_caddy_pkg(step: Step):
        packages.apt_remove(["caddy"])
        return "بسته caddy حذف شد."

    def _remove_backups(step: Step):
        backup_dir = Path(C.BACKUP_DIR)
        if backup_dir.is_dir():
            _shutil.rmtree(backup_dir)
        return "پوشه پشتیبان‌ها حذف شد."

    steps = []
    if caddy.has_site_block():
        steps.append((Step("حذف بلوک Caddy", risk="risky"), _remove_caddy_block))
    if rules:
        steps.append((Step("حذف قواعد فایروال", risk="risky"), _remove_firewall))
    steps.append((Step("توقف سرویس headscale", risk="risky"), _stop_service))
    steps.append((Step("حذف بسته headscale", risk="destructive"), _remove_headscale))
    if we_installed_caddy:
        steps.append((Step("حذف بسته caddy", risk="destructive"), _remove_caddy_pkg))
    if args.purge_data:
        steps.append((Step("حذف پشتیبان‌ها", risk="destructive"), _remove_backups))

    for step, fn in steps:
        if not runner.run(step, fn):
            return C.EXIT_ERROR
    runner.summary()

    # حذف state خودمان (در حالت purge) یا بازنشانی گام‌ها
    state_path = Path(C.STATE_FILE)
    if args.purge_data and state_path.exists():
        state_path.unlink()
    # symlink ابزار
    link = Path("/usr/local/bin/hsctl")
    if link.is_symlink() and "headscale-easy-manager" in str(link.resolve()):
        link.unlink()
        print("  • symlink /usr/local/bin/hsctl حذف شد.")

    print("─" * 60)
    print(fmt("uninstall_done"))
    if not args.purge_data:
        print(f"  • پشتیبان‌ها: {C.BACKUP_DIR}")
        print(f"  • داده‌های headscale: {C.HEADSCALE_DATA_DIR} (با نصب مجدد قابل استفاده)")
    print(f"  • فایل‌های پروژه: {state.get('install_dir', C.DEFAULT_INSTALL_DIR)} (برای حذف کامل، خودتان پاک کنید)")
    return C.EXIT_OK


# --- ورودی اصلی ---------------------------------------------------------------

def main(argv=None) -> int:
    """نقطه ورود CLI — بازگرداندن کد خروج مطابق FACTS §10."""
    hemlog.setup()
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return C.EXIT_OK

    if getattr(args, "non_interactive", False):
        set_non_interactive(True)

    # استثنا: «install --dry-run» فقط برنامه‌ریزیِ فقط-خواندنی است؛ الزام root
    # برداشته می‌شود (نصب واقعی همچنان به sudo نیاز دارد — کد ۳).
    _dryrun_install = args.command == "install" and getattr(args, "dry_run", False)
    if _dryrun_install and os.geteuid() != 0:
        print("⚠ [dry-run] بدون root اجرا می‌شود — فقط برنامه‌ریزی است؛ برای نصب واقعی sudo لازم است.")
    if args.command in ROOT_REQUIRED and os.geteuid() != 0 and not _dryrun_install:
        print(f"✗ {fmt('need_root')}")
        print(fmt("need_root_hint", command=args.command))
        return C.EXIT_NEED_ROOT

    try:
        return args.handler(args)
    except NonInteractiveError as exc:
        print(f"✗ {exc}")
        return C.EXIT_NO_CONFIRM
    except PromptError as exc:
        print(f"✗ {exc}")
        return C.EXIT_NO_CONFIRM
    except (HemCtlError, HemExecError) as exc:
        print(f"✗ {exc}")
        return C.EXIT_ERROR
    except KeyboardInterrupt:
        print("\n" + fmt("cancelled"))
        return C.EXIT_NO_CONFIRM
    except json.JSONDecodeError as exc:
        print(f"✗ خطای پردازش JSON: {exc}")
        return C.EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())
