"""تست بررسی DNS — با mock شدن socket.getaddrinfo."""

import socket

from hem.network import dnscheck


def _fake_getaddrinfo(results):
    """ساخت getaddrinfo ساختگی برای نتایج مشخص."""

    def fake(host, port, family=0, type=0, proto=0, flags=0):  # noqa: A002
        infos = []
        for ip in results:
            addr_family = socket.AF_INET6 if ":" in ip else socket.AF_INET
            if family and family != addr_family:
                continue
            infos.append((addr_family, socket.SOCK_STREAM, 0, "", (ip, 0)))
        return infos

    return fake


def test_resolve_and_match(monkeypatch):
    monkeypatch.setattr(dnscheck.socket, "getaddrinfo", _fake_getaddrinfo(["1.2.3.4"]))
    result = dnscheck.check_domain("headscale.example.com", ["1.2.3.4"])
    assert result.ok is True
    assert result.matched_ip == "1.2.3.4"
    assert result.has_a is True
    assert result.mismatched is False
    assert result.advice  # توصیه فارسی پر شده است


def test_mismatch(monkeypatch):
    monkeypatch.setattr(dnscheck.socket, "getaddrinfo", _fake_getaddrinfo(["9.9.9.9"]))
    result = dnscheck.check_domain("headscale.example.com", ["1.2.3.4"])
    assert result.ok is False
    assert result.mismatched is True
    assert "9.9.9.9" in result.advice
    assert "1.2.3.4" in result.advice


def test_no_record(monkeypatch):
    def fake(host, port, family=0, type=0, proto=0, flags=0):  # noqa: A002
        raise socket.gaierror("name resolution failed")

    monkeypatch.setattr(dnscheck.socket, "getaddrinfo", fake)
    result = dnscheck.check_domain("headscale.example.com", ["1.2.3.4"])
    assert result.ok is False
    assert result.has_a is False
    assert result.has_aaaa is False
    assert result.mismatched is False
    assert result.advice


def test_resolve_returns_lists(monkeypatch):
    monkeypatch.setattr(
        dnscheck.socket, "getaddrinfo", _fake_getaddrinfo(["1.2.3.4", "fd00::1"])
    )
    a, aaaa = dnscheck.resolve("x.example.com")
    assert a == ["1.2.3.4"]
    assert aaaa == ["fd00::1"]
