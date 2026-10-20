"""تست تولید پیکربندی config.yaml — قالب FACTS §3."""

import pytest
import yaml

from hem.headscale.config import ConfigError, render

GOOD = {
    "domain": "headscale.example.com",
    "magic_dns_base": "ts.example.com",
    "acme_email": "admin@example.com",
    "dns_nameservers": ["1.1.1.1", "8.8.8.8"],
    "embedded_derp": True,
    "use_https": True,
}


def test_render_basic_keys():
    out = render(GOOD)
    assert "server_url: https://headscale.example.com" in out
    assert "base_domain: ts.example.com" in out
    assert 'trusted_proxies: ["127.0.0.1/32", "::1/128"]' in out
    assert "listen_addr: 127.0.0.1:8080" in out
    assert "path: /var/lib/headscale/db.sqlite" in out


def test_render_is_valid_yaml():
    data = yaml.safe_load(render(GOOD))
    assert data["server_url"] == "https://headscale.example.com"
    assert data["dns"]["base_domain"] == "ts.example.com"
    assert data["dns"]["nameservers"]["global"] == ["1.1.1.1", "8.8.8.8"]
    assert data["derp"]["server"]["enabled"] is True
    assert data["trusted_proxies"] == ["127.0.0.1/32", "::1/128"]


def test_base_domain_must_differ_from_domain():
    bad = dict(GOOD, magic_dns_base="headscale.example.com")
    with pytest.raises(ConfigError):
        render(bad)


def test_derp_requires_https():
    bad = dict(GOOD, use_https=False, embedded_derp=True)
    with pytest.raises(ConfigError):
        render(bad)


def test_http_without_derp_renders():
    out = render(dict(GOOD, use_https=False, embedded_derp=False))
    data = yaml.safe_load(out)
    assert data["server_url"] == "http://headscale.example.com:8080"
    assert data["derp"]["server"]["enabled"] is False


def test_invalid_domain_rejected():
    with pytest.raises(ConfigError):
        render(dict(GOOD, domain="not a domain"))
    with pytest.raises(ConfigError):
        render(dict(GOOD, domain=""))


def test_invalid_nameserver_rejected():
    with pytest.raises(ConfigError):
        render(dict(GOOD, dns_nameservers=["not-an-ip"]))


def test_derp_disabled_renders_false():
    out = render(dict(GOOD, embedded_derp=False))
    data = yaml.safe_load(out)
    assert data["derp"]["server"]["enabled"] is False
