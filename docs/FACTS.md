# FACTS — قرارداد فنی راستی‌آزمایی‌شده (منبع واحد حقیقت)

> ⚠️ **قانون طلایی:** هیچ فایل، دستور، مسیر یا کلید تنظیماتی در این پروژه نباید «حدس» زده شود. هرچه در این فایل است، مستقیماً از سورس‌کد و مستندات رسمی Headscale **v0.29.5** استخراج و راستی‌آزمایی شده است. اگر موردی اینجا نیست، آن را از مستندات رسمی نسخه ۰.۲۹ بیابید یا به‌عنوان «آزمایش‌نشده» علامت بزنید.

## ۱. نسخه‌ها و دانلود

- نسخه پایدار هدف: **v0.29.5**
- URL دانلود بسته Ubuntu amd64:
  `https://github.com/juanfont/headscale/releases/download/v0.29.5/headscale_0.29.5_linux_amd64.deb`
- SHA-256 فایل بالا (راستی‌آزمایی‌شده از فایل رسمی `checksums.txt` و صفحه انتشار):
  `9e8ec12a65229435863a2cdf5082853c282808e845efd3a1f0b0c02b8f84d723`
- فایل checksums هر نسخه: `https://github.com/juanfont/headscale/releases/download/v<VER>/checksums.txt`
- الگوی نام بسته: `headscale_<VER>_linux_<ARCH>.deb` (ARCH: `amd64` یا `arm64`)
- آخرین نسخه پایدار از API: `https://api.github.com/repos/juanfont/headscale/releases/latest` (فیلد `tag_name` بدون پیشوند `v` در `name`)

## ۲. مسیرهای استاندارد بسته .deb

| مورد | مسیر |
|---|---|
| باینری | `/usr/bin/headscale` |
| پیکربندی | `/etc/headscale/config.yaml` |
| نمونه پیکربندی | `/usr/share/doc/headscale/examples/config-example.yaml` |
| داده/کلیدها/DB | `/var/lib/headscale/` (شامل `db.sqlite`, `noise_private.key`, `derp_server_private.key`) |
| سوکت یونیکس | `/var/run/headscale/headscale.sock` (سطح دسترسی 0770 — فقط root/گروه headscale) |
| سرویس | `headscale.service` (User=headscale، ExecStart=/usr/bin/headscale serve، StateDirectory=/var/lib/headscale، hardened) |

## ۳. پیکربندی config.yaml نسخه ۰.۲۹ (کلیدهای معتبر — دقیقاً همین نام‌ها)

```yaml
server_url: https://headscale.example.com        # URLی که کلاینت‌ها با آن وصل می‌شوند
listen_addr: 127.0.0.1:8080                      # پشت Reverse Proxy فقط localhost
metrics_listen_addr: 127.0.0.1:9090
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false
trusted_proxies: ["127.0.0.1/32", "::1/128"]     # الزامی پشت Reverse Proxy برای IP واقعی کلاینت
noise:
  private_key_path: /var/lib/headscale/noise_private.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential
derp:
  server:
    enabled: true                                # فقط وقتی server_url از نوع https است
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
acme_email: ""
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
  mode: file
  path: ""                                       # مسیر فایل HuJSON سیاست‌ها
dns:
  magic_dns: true
  base_domain: ts.example.com                    # باید با دامنه server_url متفاوت باشد!
  override_local_dns: true
  nameservers:
    global:
      - 1.1.1.1
      - 8.8.8.8
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
```

**نکات حیاتی:**
- `dns.base_domain` باید FQDN و **متفاوت از دامنه server_url** باشد (مثلاً `ts.example.com` در برابر `headscale.example.com`).
- `derp.server.enabled: true` فقط در صورت HTTPS معتبر کار می‌کند (لازم است stun روی 3478/udp عمومی باشد).
- فیلدهای `acls`, `acl_policy_path`, `node_update_interval` مربوط به نسخه‌های قدیمی‌اند و در ۰.۲۹ **حذف شده‌اند** — استفاده ممنوع.

## ۴. دستورات CLI نسخه ۰.۲۹ (استخراج‌شده از سورس `cmd/headscale/cli/`)

فلگ سراسری: `--output` یا `-o` با مقادیر `json`، `json-line`، `yaml` (خالی = جدول متنی). فلگ `--force` برای حذف پیام‌های تعاملی. `--config`/`-c` برای فایل پیکربندی.

### کاربران
```bash
headscale users list                                   # جدول: ID | Name | Username | Email | Created
headscale users create <NAME>
headscale users destroy --identifier <ID>   # یا --name <NAME>
headscale users rename --identifier <ID> --new-name <NAME>   # یا --name <OLD> --new-name <NEW>
```
⚠️ در ۰.۲۹.۵ برای `users list` فلگ‌های فیلتر `-n/--name`، `-e/--email` و `-i/--identifier` هم موجود است (خروجی `--help` واقعی).

### گره‌ها (دستگاه‌ها)
```bash
headscale nodes list [--user <NAME>]                    # جدول: ID | Hostname | Name | MachineKey | NodeKey | User | Tags | IP addresses | Ephemeral | Last seen | Expiration | Connected | Expired
headscale nodes register --user <USER> --key <KEY>      # ثبت تعاملی قدیمی
headscale nodes list-routes                             # ستون‌ها: ID | Hostname | Approved | Available | Serving (Primary)
headscale nodes approve-routes --identifier <ID> --routes 10.0.0.0/8,192.168.0.0/24   # رشته خالی = حذف همه تأییدها
headscale nodes expire --identifier <ID> [--expiry RFC3339 | --disable]
headscale nodes delete --identifier <ID>
headscale nodes rename <NEW_NAME> --identifier <ID>
headscale nodes tag --identifier <ID> --tags <TAGS>
headscale nodes backfillips
```
⚠️ در ۰.۲۹ دستور سطح‌بالای `routes` وجود ندارد؛ فقط alias `routes` برای `nodes list-routes` است. تأیید/لغو Route فقط از طریق `nodes approve-routes` انجام می‌شود.

### احراز هویت تعاملی (Web Auth)
```bash
headscale auth register --user <USER> --auth-id <AUTH_ID>
headscale auth approve --auth-id <AUTH_ID>
headscale auth reject  --auth-id <AUTH_ID>
```

### کلیدهای از پیش تأییدشده (Preauth)
```bash
# ساخت: -u شناسهٔ عددی (ID) کاربر است؛ انقضای پیش‌فرض «1h»
headscale preauthkeys create --user <USER_ID> [--reusable] [--ephemeral] [--expiration 30m] [--tags tag:x]
# فهرست: در 0.29.5 فلگ --user «وجود ندارد»؛ همهٔ کلیدها فهرست می‌شوند و کلیدها ماسک‌شده‌اند
headscale preauthkeys list
# انقضا/حذف: شناسهٔ عددی خودِ کلید با -i/--id
headscale preauthkeys expire --id <KEY_ID>
headscale preauthkeys delete --id <KEY_ID>
```
⚠️ نکته‌های راستی‌آزمایی‌شده با باینری واقعی 0.29.5:
- `preauthkeys list` هیچ فلگی جز `-h` ندارد (لیست همهٔ کلیدها؛ کلیدها همیشه ماسک‌شده برمی‌گردند).
- `--user` فقط در `create` معتبر است و **شناسهٔ عددی (ID)** است نه نام کاربر؛ ابتدا با `headscale users list` شناسه را بگیرید.
- `expire`/`delete` کلید را با `-i, --id uint` (شناسهٔ عددی کلید از ستون ID خروجی list) انتخاب می‌کنند.
- نام‌های جایگزین: `list` = `ls`/`show`؛ `expire` = `revoke`/`exp`/`e`؛ `delete` = `del`/`rm`/`d`.

### سیاست، سلامت، پیکربندی
```bash
headscale policy get|set|check
# set واقعی (0.29.5): فقط با policy_mode=db کار می‌کند و فایل HuJSON می‌گیرد
headscale policy set --file <PATH.hujson>
# (فلگ --bypass-grpc-and-access-database-directly برای اجرا بدون سرویس در حال اجرا)
headscale health
headscale configtest          # اعتبارسنجی فایل پیکربندی
headscale dump_config         # چاپ پیکربندی مؤثر
headscale version
headscale serve               # اجرای سرویس (استفاده در systemd)
```
⚠️ `policy get` فقط وقتی `acl.policy_mode` روی `db` باشد سیاست را از پایگاه‌داده نشان می‌دهد؛ در حالت `file` مسیر فایل HuJSON از پیکربندی خوانده می‌شود.

## ۵. جریان‌های سمت کلاینت Tailscale (رسمی)

```bash
# نصب کلاینت روی Ubuntu/Debian (اسکریپت رسمی):
curl -fsSL https://tailscale.com/install.sh | sh

# اتصال به سرور دلخواه:
sudo tailscale up --login-server https://headscale.example.com
# → مرورگر باز می‌شود و Auth ID می‌دهد → روی سرور: headscale auth register --user <USER> --auth-id <AUTH_ID>

# اتصال غیرتعاملی با کلید:
sudo tailscale up --login-server https://headscale.example.com --authkey <PREAUTHKEY>

# Subnet Router (روی دستگاه دفتر):
sudo tailscale up --login-server https://headscale.example.com --advertise-routes=192.168.1.0/24
sudo tailscale set --advertise-routes=192.168.1.0/24        # اگر قبلاً ثبت شده
# فعال‌سازی IP Forwarding (لازم برای مسیریابی):
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf

# پذیرش Route روی کلاینت‌ها (در Linux لازم است؛ ویندوز/macOS به‌صورت پیش‌فرض می‌پذیرند):
sudo tailscale set --accept-routes

# Exit Node:
sudo tailscale up --login-server <URL> --advertise-exit-node
sudo tailscale set --advertise-exit-node          # اگر قبلاً ثبت شده
# روی سرور تأیید: headscale nodes approve-routes --identifier <ID> --routes 0.0.0.0/0
# (تأیید 0.0.0.0/0 کافی است؛ ::/0 خودکار تأیید می‌شود)
# روی کلاینت مصرف‌کننده:
sudo tailscale set --exit-node <NAME>

# بررسی:
tailscale status
tailscale ip -4
tailscale ping <peer-ip-or-name>
```

## ۶. Reverse Proxy — Caddy (پیکربندی رسمی مستندات Headscale)

نصب رسمی Caddy (مخزن apt رسمی):
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

Caddyfile رسمی (با تشخیص captive portal اندروید):
```caddyfile
http://headscale.example.com {
        handle /generate_204 {
                respond 204
        }
        handle * {
                redir https://{host}{uri}
        }
}

headscale.example.com {
        reverse_proxy 127.0.0.1:8080 {
                header_up True-Client-IP {remote_host}
                header_up X-Real-IP {remote_host}
        }
}
```
- اعتبارسنجی قبل از reload: `caddy validate --config /etc/caddy/Caddyfile`
- reload: `systemctl reload caddy`
- گواهی TLS به‌صورت خودکار از Let's Encrypt صادر/تمدید می‌شود.
- Cloudflare Proxy/Tunnel پشتیبانی **نمی‌شود** (مشکل WebSocket POST).

## ۷. پورت‌ها و فایروال

| پورت | پروتکل | عمومی | کاربرد |
|---|---|---|---|
| 80 | tcp | بله | HTTP→HTTPS و ACME HTTP-01 |
| 443 | tcp | بله | سرویس کنترل HTTPS + DERP |
| 3478 | udp | فقط با DERP تعبیه‌شده | STUN |
| 8080 | tcp | خیر | Headscale پشت پروکسی (127.0.0.1) |
| 9090 | tcp | خیر | metrics |
| 50443 | tcp | خیر | gRPC |

قواعد UFW که Installer اضافه می‌کند (فقط پس از اطمینان از مجازبودن پورت SSH فعلی):
```
ufw allow <ssh-port>/tcp     # اول! (پورت از sshd_config یا SSH_CONNECTION)
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/udp           # فقط اگر DERP تعبیه‌شده فعال باشد
ufw --force enable
```

## ۸. پشتیبان‌گیری و به‌روزرسانی (رسمی)

- پشتیبان امن SQLite در حال کار: `sqlite3 /var/lib/headscale/db.sqlite ".backup '/target/path/db.sqlite'"`
  (اگر sqlite3 نبود: `apt install sqlite3`؛ اگر نشد، توقف کوتاه سرویس + کپی با رضایت کاربر)
- محتوای کامل پشتیبان: `/etc/headscale/`، `db.sqlite` (با .backup)، کلیدهای `/var/lib/headscale/*.key`، فایل سرویس/overrideهای systemd، بلوک Caddy ما، `/etc/hem/` (state + cameras)، `manifest.json` (نسخه headscale، تاریخ، نسخه ابزار).
- **مسیر ارتقا**: نسخه‌به‌نسخه بدون پرش minor (مثلاً 0.27→0.28→0.29). hsctl update این را چک می‌کند و هشدار می‌دهد.
- ترتیب ارتقا (رسمی): توقف → پشتیبان → نصب نسخه جدید → مقایسه/به‌روزرسانی پیکربندی → اجرا.

## ۹. ثابت‌های پروژه (همه Agentها باید از همین‌ها استفاده کنند)

- نام محصول: **Headscale Easy Manager** (نام فارسی: «مدیر آسان هداسکیل»)
- نام CLI: **hsctl**
- مسیر نصب پیش‌فرض: `/opt/headscale-easy-manager` (قابل تغییر با `--install-dir`)
- State: `/etc/hem/state.json` — دوربین‌ها: `/etc/hem/cameras.yaml` — پاسخ‌های نصب: `/etc/hem/install-answers.yaml`
- پشتیبان‌ها: `/var/backups/hem/` (الگوی نام: `hem-backup-YYYYmmdd-HHMMSS.tar.gz`)
- لاگ: `/var/log/hem/hem.log`
- مارکر بلوک Caddy: `# BEGIN headscale-easy-manager` تا `# END headscale-easy-manager`
- نسخه فعلی ابزار: `0.1.0`
- حداقل پیش‌نیاز سرور: Ubuntu 22.04+/24.04 amd64، ۱GB RAM، ۱۰GB فضای آزاد، دسترسی sudo، پورت‌های آزاد 80/443 (و 3478/udp در صورت DERP)
- حداقل Python: 3.10 (استفاده فقط از stdlib + PyYAML)

## ۱۰. کدهای خروج hsctl

| کد | معنی |
|---|---|
| 0 | موفق |
| 1 | خطای عمومی/اجرای عملیات |
| 2 | ورودی/آرگومان نامعتبر |
| 3 | نیاز به اجرا با sudo |
| 4 | سرویس/زیرساخت موردنیاز موجود نیست — شامل وضعیت‌های پایانی نصب (اصلاح ۴.۴): `service_not_ready` (نصب انجام شد اما سرویس آماده نیست) و `pending_verification` (DNS یا گواهی TLS هنوز آماده نیست؛ دسترسی بیرونی تأییدنشده) |
| 5 | تأیید کاربر گرفته نشد / لغو عملیات |

## ۱۱. دستورات hsctl (قرارداد رابط — پیاده‌سازی باید دقیقاً همین باشد)

```
hsctl --help | --version
hsctl install [--config FILE] [--non-interactive] [--dry-run] [--install-dir DIR]
hsctl status
hsctl doctor [--fix] [--json]
hsctl logs [--lines N] [--since DURATION] [--follow]
hsctl users [list] | users create <name> | users delete <name-or-id> [--yes]
hsctl devices [list] | devices delete <id> [--yes]
hsctl preauth create <user> [--reusable] [--expiration 1h] | preauth list <user>
hsctl routes list | routes approve <node-id> --routes <CIDR,CIDR> | routes revoke <node-id> [--yes]
hsctl backup create [--output FILE] | backup list | backup verify <FILE>
hsctl restore <FILE> [--yes]
hsctl update [--check] [--version X.Y.Z] [--yes]
hsctl config show | config path | config validate
hsctl cameras list | cameras add | cameras remove <name> | cameras check [--name <name>] [--from-client]
hsctl learn [list | <شماره فصل>]
hsctl explain <topic>            # topics: vpn, headscale, dns, routes, subnet-router, exit-node, firewall, tls, derper, magicdns, preauthkey, backup
hsctl report [--output FILE]
hsctl uninstall [--purge-data] [--yes]
```

## ۱۲. فصل‌های مستندات فارسی (نام فایل‌ها قرارداد است)

| فایل | عنوان |
|---|---|
| `01-vpn-chist.md` | فصل اول: VPN چیست؟ |
| `02-headscale-chist.md` | فصل دوم: Headscale چیست؟ |
| `03-mafahim-shabake.md` | فصل سوم: مفاهیم ضروری شبکه |
| `04-nasb-avvalieh.md` | فصل چهارم: نصب اولیه |
| `05-ettesal-dastgahha.md` | فصل پنجم: اتصال دستگاه‌ها |
| `06-dastresi-shabake-daftar.md` | فصل ششم: دسترسی از بیرون به شبکه دفتر |
| `07-exit-node.md` | فصل هفتم: Exit Node |
| `08-modiriyat-roozmareh.md` | فصل هشتم: مدیریت روزمره |
| `09-eibyabi.md` | فصل نهم: عیب‌یابی |
| `10-amniyat-negahdari.md` | فصل دهم: امنیت و نگهداری |
| `11-vazhenameh.md` | فصل یازدهم: واژه‌نامه فارسی–انگلیسی |
| `12-poroje-nemooneh.md` | فصل دوازدهم: پروژه نمونه عملی (از صفر تا CRM) |
| `13-dorbin-madarbaste.md` | فصل سیزدهم: دوربین‌های مداربسته و Dahua |
| `14-rahnamaye-sari.md` | راهنمای سریع شروع |

Frontmatter الزامی هر فصل:
```yaml
---
title: "فصل اول: VPN چیست؟"
description: "توضیح یک‌خطی فصل"
order: 1
icon: "Shield"        # نام آیکن lucide
---
```
