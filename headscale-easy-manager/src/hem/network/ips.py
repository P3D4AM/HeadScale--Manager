"""تشخیص آدرس‌های IP سرور — محلی (ip/ifconfig) و عمومی (api.ipify.org)."""

from __future__ import annotations

import ipaddress
import json
import re

from hem import constants as C
from hem.core import hemlog
from hem.core.exec import HemExecError, run

logger = hemlog.get("ips")


def _dedup(items: list) -> list:
    """حذف موارد تکراری با حفظ ترتیب."""
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def server_addresses() -> tuple[list[str], list[str]]:
    """آدرس‌های IP سرور — خروجی: (لیست IPv4، لیست IPv6) بدون loopback و link-local."""
    v4: list[str] = []
    v6: list[str] = []

    # روش اصلی: ip -j addr (خروجی JSON)
    try:
        res = run(["ip", "-j", "addr"], check=False, timeout=15)
        if res.returncode == 0 and res.stdout.strip():
            for iface in json.loads(res.stdout):
                if iface.get("ifname") == "lo" or iface.get("link_type") == "loopback":
                    continue
                for info in iface.get("addr_info", []):
                    local = info.get("local")
                    if not local:
                        continue
                    if info.get("family") == "inet" and not local.startswith("169.254."):
                        v4.append(local)
                    elif info.get("family") == "inet6" and not local.lower().startswith("fe80:"):
                        v6.append(local)
    except (HemExecError, json.JSONDecodeError, ValueError):
        pass

    if v4 or v6:
        return _dedup(v4), _dedup(v6)

    # روش پشتیبان: ifconfig -a
    try:
        res = run(["ifconfig", "-a"], check=False, timeout=15)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                v4match = re.match(r"^\s*inet\s+(\S+)", line)
                v6match = re.match(r"^\s*inet6\s+(\S+)", line)
                if v4match and not v4match.group(1).startswith("127."):
                    v4.append(v4match.group(1))
                elif v6match and not v6match.group(1).lower().startswith(("fe80:", "::1")):
                    v6.append(v6match.group(1))
    except HemExecError:
        pass

    return _dedup(v4), _dedup(v6)


def public_ip_from_api() -> str | None:
    """IP عمومی سرور از api.ipify.org — در صورت خطا None."""
    import urllib.request

    for url in C.PUBLIC_IP_URLS:
        try:
            with urllib.request.urlopen(url, timeout=C.PUBLIC_IP_TIMEOUT) as resp:
                value = resp.read().decode("utf-8", "replace").strip()
        except OSError as exc:
            logger.debug("دریافت IP عمومی از %s ناموفق بود: %s", url, exc)
            continue
        try:
            ipaddress.ip_address(value)
            return value
        except ValueError:
            continue
    return None


def is_cgnat(ip: str) -> bool:
    """آیا IP در رنج CGNAT (100.64.0.0/10) است؟"""
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network("100.64.0.0/10")
    except ValueError:
        return False
