"""بررسی پورت‌های شنیده‌شده — از ss (با پشتیبان lsof) و تست bind واقعی."""

from __future__ import annotations

import errno
import re
import socket
from dataclasses import dataclass

from hem.core.exec import HemExecError, run


@dataclass
class PortEntry:
    """یک سوکت شنیده‌شده."""

    proto: str  # tcp | udp
    port: int
    process: str  # نام فرایند (اگر قابل تشخیص بود)


def listening_ports() -> list[PortEntry]:
    """فهرست پورت‌های در حال شنیدن — پارس خروجی ss (پشتیبان: lsof)."""
    entries: list[PortEntry] = []

    # روش اصلی: ss -H -ltnup
    try:
        res = run(["ss", "-H", "-ltnup"], check=False, timeout=15)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                fields = line.split()
                if len(fields) < 5:
                    continue
                proto = fields[0].lower()
                local_match = re.search(r":(\d+)$", fields[4])
                if not local_match:
                    continue
                proc_match = re.search(r'users:\(\("([^"]+)"', line)
                entries.append(PortEntry(proto, int(local_match.group(1)), proc_match.group(1) if proc_match else ""))
            if entries:
                return _dedup(entries)
    except HemExecError:
        pass

    # روش پشتیبان: lsof -nP -i
    try:
        res = run(["lsof", "-nP", "-i"], check=False, timeout=20)
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                fields = line.split()
                if len(fields) < 9 or fields[0] == "COMMAND":
                    continue
                name_match = re.match(r"(TCP|UDP)\s+\S+?:(\d+)", fields[8])
                if not name_match:
                    continue
                entries.append(PortEntry(name_match.group(1).lower(), int(name_match.group(2)), fields[0]))
    except HemExecError:
        pass

    return _dedup(entries)


def _dedup(entries: list[PortEntry]) -> list[PortEntry]:
    seen, out = set(), []
    for entry in entries:
        key = (entry.proto, entry.port, entry.process)
        if key not in seen:
            seen.add(key)
            out.append(entry)
    return out


def _listed(port: int, proto: str) -> bool:
    """آیا پورت در فهرست ss/lsof دیده می‌شود؟"""
    for entry in listening_ports():
        if entry.port == port and entry.proto.startswith(proto.lower()):
            return True
    return False


def port_free(port: int, proto: str = "tcp") -> bool:
    """آیا پورت آزاد است؟ تست bind واقعی؛ در نبود دسترسی از فهرست ss کمک می‌گیریم."""
    for family in (socket.AF_INET, socket.AF_INET6):
        try:
            with socket.socket(
                family, socket.SOCK_STREAM if proto == "tcp" else socket.SOCK_DGRAM
            ) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(("::" if family == socket.AF_INET6 else "0.0.0.0", port))
        except OSError as exc:
            if exc.errno == errno.EADDRINUSE:
                return False
            if isinstance(exc, PermissionError):
                return not _listed(port, proto)
            # مثلاً IPv6 پشتیبانی نمی‌شود → بررسی خانواده بعدی
            continue
    return True


def port_taken_by(port: int, proto: str = "tcp") -> str:
    """نام فرایندِ صاحب پورت (اگر قابل تشخیص نبود، رشته خالی)."""
    for entry in listening_ports():
        if entry.port == port and entry.proto.startswith(proto.lower()) and entry.process:
            return entry.process
    return ""
