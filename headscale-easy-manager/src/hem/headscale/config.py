"""تولید و مدیریت پیکربندی config.yaml نسخه ۰.۲۹ — قالب دقیقاً از FACTS §3.

نکته: در قالب از قالب‌بندی %()s استفاده شده چون YAML (بر خلاف Caddyfile) هیچ «{}» ندارد.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

from hem import constants as C
from hem.core import exec as hemexec
from hem.core.prompts import is_valid_domain, is_valid_email, is_valid_ip
from hem.headscale import installer as hs_installer
from hem.i18n import fmt

# --- قالب کامل پیکربندی (FACTS §3 — هیچ کلید حدسی وجود ندارد) ----------------
TEMPLATE = """# پیکربندی Headscale — تولیدشده توسط Headscale Easy Manager (hsctl)
# دامنه سرور: %(domain)s
server_url: %(server_url)s
listen_addr: 127.0.0.1:8080
metrics_listen_addr: 127.0.0.1:9090
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false
trusted_proxies: ["127.0.0.1/32", "::1/128"]
noise:
  private_key_path: /var/lib/headscale/noise_private.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential
derp:
  server:
    enabled: %(derp_enabled)s
    region_id: 999
    region_code: "headscale"
    region_name: "Headscale Embedded DERP"
    verify_clients: true
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: /var/lib/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true
  urls:
    - https://controlplane.tailscale.com/derpmap/default
  paths: []
  auto_update_enabled: true
  update_frequency: 3h
disable_check_updates: false
node:
  expiry: 0
  ephemeral:
    inactivity_timeout: 30m
  routes:
    ha:
      probe_interval: 10s
      probe_timeout: 5s
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite
    write_ahead_log: true
    wal_autocheckpoint: 1000
acme_url: https://acme-v02.api.letsencrypt.org/directory
acme_email: "%(acme_email)s"
tls_letsencrypt_hostname: ""
tls_letsencrypt_cache_dir: /var/lib/headscale/cache
tls_letsencrypt_challenge_type: HTTP-01
tls_letsencrypt_listen: ":http"
tls_cert_path: ""
tls_key_path: ""
log:
  level: info
  format: text
policy:
  # حالت database تا CLI رسمی (policy get/set/check) و رابط گرافیکی بتوانند
  # سیاست دسترسی را مدیریت کنند (در حالت file با path خالی، policy set کار نمی‌کند).
  mode: database
  path: ""
dns:
  magic_dns: true
  base_domain: %(magic_dns_base)s
  override_local_dns: true
  nameservers:
    global:
%(nameservers_block)s
    split: {}
  search_domains: []
  extra_records: []
unix_socket: /var/run/headscale/headscale.sock
unix_socket_permission: "0770"
logtail:
  enabled: false
taildrop:
  enabled: true
auto_update:
  enabled: false
"""


class ConfigError(ValueError):
    """خطای اعتبارسنجی پیکربندی — پیام فارسی."""


def default_magic_dns_base(domain: str) -> str:
    """پیشنهاد پیش‌فرض دامنه MagicDNS (مثلاً ts.example.com برای headscale.example.com)."""
    parts = domain.split(".", 1)
    if len(parts) == 2 and parts[1]:
        return f"ts.{parts[1]}"
    return f"ts.{domain}"


def render(answers: dict) -> str:
    """ساخت متن config.yaml از پاسخ‌های نصب — با همه اعتبارسنجی‌های حیاتی."""
    domain = str(answers.get("domain") or "").strip().lower()
    if not is_valid_domain(domain):
        raise ConfigError(fmt("invalid_domain_value", value=domain or "—"))

    magic = str(answers.get("magic_dns_base") or "").strip().lower()
    if not magic:
        raise ConfigError(fmt("magic_dns_required"))
    if not is_valid_domain(magic):
        raise ConfigError(fmt("invalid_domain_value", value=magic))
    if magic == domain:
        raise ConfigError(fmt("magic_dns_conflict"))

    use_https = bool(answers.get("use_https", True))
    server_url = f"https://{domain}" if use_https else f"http://{domain}:{C.PORT_HS_LISTEN}"

    derp = bool(answers.get("embedded_derp", True))
    if derp and not server_url.startswith("https://"):
        raise ConfigError(fmt("derp_needs_https"))

    nameservers = answers.get("dns_nameservers") or ["1.1.1.1", "8.8.8.8"]
    for ns in nameservers:
        if not is_valid_ip(str(ns)):
            raise ConfigError(fmt("nameserver_invalid", value=ns))

    email = str(answers.get("acme_email") or "").strip()
    if email and not is_valid_email(email):
        raise ConfigError(fmt("invalid_email"))

    ns_block = "\n".join(f"      - {ns}" for ns in nameservers)
    return TEMPLATE % {
        "domain": domain,
        "server_url": server_url,
        "magic_dns_base": magic,
        "acme_email": email,
        "derp_enabled": "true" if derp else "false",
        "nameservers_block": ns_block,
    }


def write_config(path, content: str, dry_run: bool = False) -> Path:
    """نوشتن پیکربندی — پشتیبان از فایل موجود، chmod 640 و مالکیت root:headscale."""
    path = Path(path)
    if path.exists():
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = path.with_name(path.name + f".hem-backup-{stamp}")
        if not dry_run:
            shutil.copy2(path, backup)
        print(fmt("file_backed_up", src=path, dst=backup))
    if dry_run:
        print(f"[dry-run] نوشتن پیکربندی در {path}")
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o640)
    if hemexec.is_root():
        try:
            shutil.chown(path, user=C.HEADSCALE_USER, group=C.HEADSCALE_GROUP)
        except (LookupError, OSError):
            pass  # کاربر headscale هنوز ساخته نشده است
    return path


def validate_config(dry_run: bool = False) -> tuple[bool, str]:
    """اجرای «headscale configtest» — خروجی: (خوب بودن، پیام)."""
    if dry_run:
        return True, "[dry-run] اعتبارسنجی configtest در اجرای واقعی انجام می‌شود."
    if not hs_installer.is_installed():
        return False, fmt("headscale_not_installed")
    try:
        res = hemexec.run_root(
            ["headscale", "configtest"], check=False, dry_run=dry_run, timeout=60
        )
    except hemexec.HemExecError as exc:
        return False, str(exc)
    if res.returncode == 0:
        return True, "پیکربندی معتبر است (configtest موفق بود)."
    return False, (res.stdout + "\n" + res.stderr).strip()
