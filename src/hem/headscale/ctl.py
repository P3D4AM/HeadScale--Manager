"""اجرای دستورات CLI خود headscale نسخه ۰.۲۹ — دقیقاً مطابق FACTS §4.

نکته‌های حیاتی:
  * preauthkeys شناسه عددی کاربر می‌گیرد (نه نام).
  * تأیید/لغو Route فقط با nodes approve-routes انجام می‌شود.
  * «nodes list-routes» با -o json همان خروجی nodes می‌دهد؛ برای خلاصه مسیرها از routes_summary استفاده کنید.
"""

from __future__ import annotations

import json

from hem.core.exec import ExecResult, run_root


class HemCtlError(RuntimeError):
    """خطای کار با CLI خود headscale — پیام فارسی."""


def run_hs(args: list, json_output: bool = False, dry_run: bool = False,
           timeout: float = 120) -> ExecResult:
    """اجرای «headscale ...» با دسترسی لازم (sudo در صورت نیاز)."""
    cmd = ["headscale", *args]
    if json_output:
        cmd += ["-o", "json"]
    return run_root(cmd, dry_run=dry_run, timeout=timeout)


def _hs_json(args: list, what: str):
    """اجرای دستور با خروجی JSON و پارس — خطای پارس = پیام «نسخه متفاوت»."""
    res = run_hs(args, json_output=True)
    try:
        return json.loads(res.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise HemCtlError(
            f"خروجی JSON دستور «{what}» قابل خواندن نبود؛ "
            "احتمالاً نسخه headscale با نسخه پشتیبانی‌شده (۰.۲۹) متفاوت است."
        ) from exc


def _node_field(node: dict, *names: str):
    """خواندن فیلد با نام‌های جایگزین (سازگاری با ساختارهای JSON مختلف)."""
    for name in names:
        if name in node:
            return node[name]
    return None


# --- کاربران ----------------------------------------------------------------

def users_list() -> list:
    """فهرست کاربران — خروجی: لیست دیکشنری (id، name، …)."""
    data = _hs_json(["users", "list"], "users list")
    return data if isinstance(data, list) else []


def users_create(name: str) -> ExecResult:
    """ساخت کاربر جدید."""
    return run_hs(["users", "create", str(name)])


def users_delete(id_or_name) -> ExecResult:
    """حذف کاربر با شناسه عددی یا نام (users destroy)."""
    target = str(id_or_name)
    if target.isdigit():
        return run_hs(["users", "destroy", "--identifier", target])
    return run_hs(["users", "destroy", "--name", target])


def find_user(name_or_id) -> dict | None:
    """یافتن کاربر بر اساس نام یا شناسه — برای تبدیل نام به شناسه عددی."""
    target = str(name_or_id)
    users = users_list()
    if target.isdigit():
        for user in users:
            if str(user.get("id")) == target:
                return user
    for user in users:
        if user.get("name") == target or user.get("username") == target:
            return user
    return None


# --- گره‌ها (دستگاه‌ها) ------------------------------------------------------

def nodes_list() -> list:
    """فهرست دستگاه‌ها — خروجی: لیست دیکشنری."""
    data = _hs_json(["nodes", "list"], "nodes list")
    return data if isinstance(data, list) else []


def nodes_list_routes(dry_run: bool = False) -> str:
    """خروجی جدولی «nodes list-routes» (alias: routes)."""
    return run_hs(["nodes", "list-routes"], dry_run=dry_run).stdout


def routes_summary() -> list:
    """خلاصه مسیرهای (Route) هر دستگاه — ساخته‌شده از nodes list.

    فیلدهای JSON نسخه‌های مختلف ممکن است متفاوت باشند؛ نام‌های جایگزین بررسی می‌شوند
    و در صورت نبود ساختار مورد انتظار، خطای «نسخه متفاوت» صادر می‌شود.
    """
    nodes = nodes_list()
    summary = []
    for node in nodes:
        approved = _node_field(node, "approvedRoutes", "approved_routes") or []
        available = _node_field(node, "availableRoutes", "available_routes") or []
        serving = _node_field(node, "subnetRoutes", "subnet_routes") or []
        user = node.get("user") or {}
        if not isinstance(user, dict):
            user = {"name": str(user)}
        summary.append({
            "id": node.get("id"),
            "name": _node_field(node, "givenName", "name") or "",
            "user": user.get("name", ""),
            "approved": [str(r) for r in approved],
            "available": [str(r) for r in available],
            "serving": [str(r) for r in serving],
            "online": bool(_node_field(node, "online", "connected")),
        })
    return summary


def approve_routes(node_id, routes: list) -> ExecResult:
    """تأیید رنج‌های مسیر یک دستگاه (nodes approve-routes)."""
    return run_hs([
        "nodes", "approve-routes",
        "--identifier", str(node_id),
        "--routes", ",".join(routes),
    ])


def revoke_routes(node_id) -> ExecResult:
    """لغو همه تأییدهای مسیر یک دستگاه (رشته خالی = حذف همه)."""
    return run_hs([
        "nodes", "approve-routes",
        "--identifier", str(node_id),
        "--routes", "",
    ])


def delete_node(node_id) -> ExecResult:
    """حذف یک دستگاه."""
    return run_hs(["nodes", "delete", "--identifier", str(node_id)])


# --- کلیدهای از پیش تأییدشده (Preauth) ---------------------------------------

def preauth_create(user_id, reusable: bool = False, ephemeral: bool = False,
                   expiration: str = "1h", tags: list | None = None) -> str:
    """ساخت کلید preauth — user_id باید «شناسه عددی» کاربر باشد (FACTS §4)."""
    args = ["preauthkeys", "create", "--user", str(user_id)]
    if reusable:
        args.append("--reusable")
    if ephemeral:
        args.append("--ephemeral")
    if expiration:
        args += ["--expiration", str(expiration)]
    for tag in tags or []:
        args += ["--tags", str(tag)]
    res = run_hs(args)
    lines = [line.strip() for line in res.stdout.splitlines() if line.strip()]
    if not lines:
        raise HemCtlError("ساخت کلید preauth ناموفق بود؛ خروجی خالی بود.")
    return lines[-1]


def preauth_list(user_id) -> str:
    """فهرست کلیدهای preauth یک کاربر (شناسه عددی) — خروجی جدولی خام."""
    return run_hs(["preauthkeys", "list", "--user", str(user_id)]).stdout


# --- سلامت/نسخه --------------------------------------------------------------

def health() -> str:
    """اجرای «headscale health»."""
    return run_hs(["health"], timeout=60).stdout


def version() -> str:
    """اجرای «headscale version»."""
    return run_hs(["version"]).stdout


__all__ = [
    "HemCtlError", "run_hs", "users_list", "users_create", "users_delete", "find_user",
    "nodes_list", "nodes_list_routes", "routes_summary", "approve_routes",
    "revoke_routes", "delete_node", "preauth_create", "preauth_list", "health", "version",
]
