"""بررسی DNS دامنه — تطبیق رکورد A با IPهای سرور."""

from __future__ import annotations

import socket
from dataclasses import dataclass, field

from hem.i18n import fmt


@dataclass
class DnsCheckResult:
    """نتیجه بررسی DNS یک دامنه."""

    ok: bool
    a: list = field(default_factory=list)
    aaaa: list = field(default_factory=list)
    matched_ip: str | None = None
    mismatched: bool = False
    has_a: bool = False
    has_aaaa: bool = False
    advice: str = ""


def resolve(name: str) -> tuple[list, list]:
    """تفکیک نام به (رکوردهای A، رکوردهای AAAA) — خطا یعنی لیست خالی."""
    a: list = []
    aaaa: list = []
    for family, out in ((socket.AF_INET, a), (socket.AF_INET6, aaaa)):
        try:
            infos = socket.getaddrinfo(name, None, family)
        except (socket.gaierror, OSError):
            continue
        for info in infos:
            ip = info[4][0]
            if ip not in out:
                out.append(ip)
    return a, aaaa


def check_domain(domain: str, server_ips: list) -> DnsCheckResult:
    """بررسی اینکه دامنه به IPهای این سرور اشاره می‌کند یا نه."""
    a, aaaa = resolve(domain)
    ips = [str(ip) for ip in server_ips]
    matched = next((ip for ip in a if ip in ips), None)
    mismatched = bool(a) and matched is None
    ok = matched is not None

    if not a and not aaaa:
        advice = fmt("dns_no_record", domain=domain, ips="، ".join(ips) or "نامشخص")
    elif mismatched:
        advice = fmt(
            "dns_mismatch", domain=domain, found="، ".join(a), expected="، ".join(ips) or "نامشخص"
        )
    else:
        advice = fmt("dns_ok", domain=domain, ip=matched)

    return DnsCheckResult(
        ok=ok, a=a, aaaa=aaaa, matched_ip=matched, mismatched=mismatched,
        has_a=bool(a), has_aaaa=bool(aaaa), advice=advice,
    )
