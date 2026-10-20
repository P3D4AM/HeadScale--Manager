"""بررسی دسترسی شبکه به دوربین‌ها — مسیر (Route)، ساب‌روتر و تست پورت.

یادآوری مهم که همیشه به کاربر گفته می‌شود:
«دسترسی شبکه ≠ احراز هویت ≠ نمایش تصویر»
"""

from __future__ import annotations

import ipaddress
import socket

from hem.cameras.registry import Camera
from hem.headscale import ctl

# پیام راهنمای همیشگی
NETWORK_NOTE = "دسترسی شبکه ≠ احراز هویت ≠ نمایش تصویر (هر سه باید جداگانه درست باشند)"


def _tcp_test(host: str, port: int, timeout: float = 5.0) -> bool:
    """تست اتصال TCP به میزبان:پورت از همین دستگاه."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _resolve_host(host: str) -> str | None:
    """اگر host نام باشد به IP تبدیل می‌شود (اگر ممکن نبود None)."""
    try:
        ipaddress.ip_address(host)
        return host
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None, socket.AF_INET)
        return infos[0][4][0] if infos else None
    except OSError:
        return None


def check_camera(cam: Camera, from_client: bool = False, timeout: float = 5,
                 routes=None, nodes=None) -> dict:
    """بررسی یک دوربین — طبقه‌بندی: route_missing / router_offline / net_ok / net_fail.

    Args:
        cam: دوربین ثبت‌شده.
        from_client: اگر True، تست TCP واقعی به پورت‌های http/rtsp هم انجام می‌شود.
        timeout: مهلت تست پورت (ثانیه).
        routes: خروجی routes_summary برای تزریق در تست (اختیاری).
        nodes: خروجی nodes_list برای تزریق در تست (اختیاری).
    """
    result = {
        "camera": cam.name,
        "host": cam.host,
        "status": "",
        "matched_route": None,
        "router": None,
        "ports": {},
        "advice": "",
    }

    ip = _resolve_host(cam.host)
    if ip is None:
        result["status"] = "net_fail"
        result["advice"] = (
            f"آدرس «{cam.host}» نه IP معتبر است و نه قابل تبدیل به IP. "
            "IP داخلی دستگاه را در شبکه دفتر وارد کنید."
        )
        return result

    # ۱) این IP داخل کدام رنج Route تأییدشده است؟
    if routes is None:
        routes = ctl.routes_summary()
    matched = None
    for entry in routes:
        for cidr in entry.get("approved") or []:
            try:
                network = ipaddress.ip_network(cidr, strict=False)
            except ValueError:
                continue
            if ipaddress.ip_address(ip) in network:
                matched = entry
                break
        if matched:
            break

    if matched is None:
        result["status"] = "route_missing"
        result["advice"] = (
            f"IP دوربین ({ip}) در هیچ رنج Route تأییدشده‌ای نیست. "
            "روی دستگاه همیشه‌روشنِ دفتر رنج شبکه را advertise کنید و روی سرور تأیید کنید:\n"
            f"  روی دستگاه دفتر:  sudo tailscale up --login-server <آدرس> --advertise-routes={_guess_subnet(ip)}\n"
            "  روی سرور:          hsctl routes list  سپس  hsctl routes approve <شناسه> --routes <رنج>"
        )
        return result

    result["matched_route"] = matched
    result["router"] = matched.get("name")

    # ۲) ساب‌روترِ آن رنج آنلاین است؟
    if not matched.get("online"):
        result["status"] = "router_offline"
        result["advice"] = (
            f"ساب‌روتر «{matched.get('name')}» (مالک رنج {'، '.join(matched.get('approved') or [])}) "
            "الان آنلاین نیست؛ دستگاه دفتر را روشن/متصل کنید و وضعیت را با "
            "«hsctl devices list» ببینید."
        )
        return result

    # ۳) تست پورت‌ها (فقط با from_client که از یک کلاینت معنا دارد)
    if from_client:
        for label, port in (("http", cam.http_port), ("rtsp", cam.rtsp_port)):
            if port:
                result["ports"][label] = _tcp_test(cam.host, port, timeout)
        if result["ports"]:
            result["status"] = "net_ok" if all(result["ports"].values()) else "net_fail"
        else:
            result["status"] = "net_ok"
    else:
        result["status"] = "net_ok"

    if result["status"] == "net_fail":
        bad = "، ".join(k for k, v in result["ports"].items() if not v)
        result["advice"] = (
            f"مسیر و ساب‌روتر سالم‌اند اما اتصال به پورت‌های {bad} برقرار نشد. "
            "پورت‌ها را از داخل خود شبکه دفتر چک کنید و مطمئن شوید دوربین روشن است."
        )
    else:
        result["advice"] = (
            "مسیر شبکه و ساب‌روتر سالم‌اند"
            + (" و تست پورت هم موفق بود." if result["ports"] else ".")
        )
    return result


def _guess_subnet(ip: str) -> str:
    """حدس رنج /24 برای پیام راهنما."""
    addr = ipaddress.ip_address(ip)
    if addr.version == 4:
        return f"{addr.exploded.rsplit('.', 1)[0]}.0/24"
    return str(ipaddress.ip_network(f"{addr}/64", strict=False))


def client_test_commands(cam: Camera) -> list:
    """دستورهای تست سمت کلاینت (روی یک دستگاه متصل‌شده به شبکه)."""
    cmds = [f"tailscale ping {cam.host}"]
    if cam.http_port:
        cmds.append(f"nc -zv -w 3 {cam.host} {cam.http_port}")
    if cam.rtsp_port:
        cmds.append(f"nc -zv -w 3 {cam.host} {cam.rtsp_port}")
    return cmds


def describe(result: dict, cam: Camera) -> str:
    """تبدیل نتیجه به متن فارسی خوانا."""
    status_fa = {
        "route_missing": "رنج شبکه تأیید نشده (route_missing)",
        "router_offline": "ساب‌روتر خاموش است (router_offline)",
        "net_ok": "شبکه در دسترس است (net_ok)",
        "net_fail": "اتصال شبکه برقرار نشد (net_fail)",
    }
    icons = {"net_ok": "✓", "route_missing": "!", "router_offline": "!", "net_fail": "✗"}
    lines = [
        f"[{icons.get(result['status'], '؟')}] دوربین «{result['camera']}» ({result['host']}): "
        f"{status_fa.get(result['status'], result['status'])}",
    ]
    if result.get("matched_route"):
        lines.append(
            f"    رنج تأییدشده: {'، '.join(result['matched_route'].get('approved') or [])} "
            f"توسط ساب‌روتر «{result.get('router')}»"
        )
    for label, ok in (result.get("ports") or {}).items():
        lines.append(f"    تست پورت {label}: {'موفق' if ok else 'ناموفق'}")
    if result.get("advice"):
        lines.append(f"    توصیه: {result['advice']}")
    lines.append(f"    ℹ {NETWORK_NOTE}")
    lines.append("    دستورهای تست سمت کلاینت (روی دستگاه متصل‌شده):")
    for cmd in client_test_commands(cam):
        lines.append(f"      $ {cmd}")
    return "\n".join(lines)
