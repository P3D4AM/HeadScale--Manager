# گزارش معماری — Headscale Easy Manager

> **مرحله A: تحقیق فنی** — این گزارش حاصل بررسی مستقیم سورس‌کد و مستندات رسمی پروژه Headscale در تگ `v0.29.5` است (کلون واقعی مخزن `juanfont/headscale` و استخراج دستورات از فایل‌های Go در `cmd/headscale/cli/`).

## ۱. تصمیم نسخه هدف

| مورد | مقدار انتخابی | دلیل |
|---|---|---|
| نسخه هدف نصب | **Headscale v0.29.5** | آخرین نسخه پایدار منتشرشده (راستی‌آزمایی شد: صفحه releases گیت‌هاب به `v0.29.5` اشاره می‌کند) |
| بسته نصب | `headscale_0.29.5_linux_amd64.deb` | روش رسمی و توصیه‌شده برای Debian/Ubuntu؛ کاربر `headscale`، فایل پیکربندی پیش‌فرض و سرویس systemd را به‌صورت خودکار ایجاد می‌کند |
| صحت‌سنجی دانلود | فایل رسمی `checksums.txt` هر Release + digest صفحه انتشار | SHA-256 فایل deb نسخه ۰.۲۹.۵ از دو منبع مستقل تطبیق داده شد |
| سیستم‌عامل هدف | Ubuntu Server 24.04 LTS (amd64) | مطابق مأموریت؛ سازگاری رسمی بسته: Ubuntu 22.04+ و Debian 12+ |
| کلاینت | Tailscale Client (نسخه‌های پایدار رسمی) | Headscale «۱۰ نسخه آخر» کلاینت Tailscale را پشتیبانی می‌کند |

**قابلیت PiP (نسخه قابل‌پیش‌بینی):** Installer همیشه نسخه را از `FACTS.md` می‌خواند، اما در زمان اجرا تلاش می‌کند آخرین نسخه پایدار را از GitHub API بگیرد و checksum آن را از همان صفحه دانلود کند. اگر شبکه در دسترس نبود، به نسخه پین‌شده و checksum داخلی برمی‌گردد.

## ۲. معماری شبکه (راستی‌آزمایی‌شده از مستندات رسمی)

```
        ┌──────────────────────────────────────────────┐
        │ VPS (Ubuntu 24.04)                           │
        │  ┌────────┐   ┌───────┐   ┌──────────────┐  │
        │  │Caddy :443│→ │Headscale│  │ embedded DERP│  │
        │  │  (TLS)  │   │:8080    │  │  STUN :3478/udp│ │
        │  └────────┘   └────────┘   └──────────────┘  │
        └───────────────────┬──────────────────────────┘
                            │ Control Plane (هماهنگ‌سازی + گواهی TLS)
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
        ┌─────────┐   ┌──────────┐   ┌───────────┐
        │ گوشی    │   │ لپ‌تاپ    │   │ Subnet     │
        │ Android │   │          │   │ Router دفتر│
        └─────────┘   └──────────┘   └─────┬─────┘
                                            │ Route: 192.168.1.0/24
                                            ▼
                                     ┌─────────────┐
                                     │ LAN دفتر    │
                                     │ CRM :800     │
                                     │ NVR دوربین   │
                                     └─────────────┘
```

- **Control Plane** (هماهنگ‌سازی): گوشی/لپ‌تاپ ↔ Headscale از طریق Caddy روی 443.
- **Data Plane** (داده): بین دستگاه‌ها مستقیم (Peer-to-Peer رمزنگاری‌شده WireGuard) و در صورت نیاز از Relay (DERP). VPS لزوماً مسیر داده نیست.
- **Subnet Router**: یک دستگاه همیشه‌روشن در دفتر، رنج `192.168.1.0/24` را advertise می‌کند؛ Headscale آن را تأیید (approve) و بقیه کلاینت‌ها با `--accept-routes` آن را می‌پذیرند.

## ۳. پورت‌ها (طبق مستندات رسمی Headscale)

| پورت | پروتکل | عمومی؟ | کاربرد |
|---|---|---|---|
| 80 | tcp | بله | ریدایرکت به HTTPS + تأیید ACME (HTTP-01) در صورت نیاز |
| 443 | tcp | بله | HTTPS سرویس کنترل (از طریق Caddy) و DERP تعبیه‌شده |
| 3478 | udp | بله (فقط اگر DERP تعبیه‌شده فعال باشد) | STUN برای عبور NAT |
| 8080 | tcp | خیر (127.0.0.1) | HTTP listener خود Headscale پشت Reverse Proxy |
| 9090 | tcp | خیر (127.0.0.1) | Metrics/Debug |
| 50443 | tcp | خیر (127.0.0.1) | gRPC (کنترل از راه دور — در این معماری استفاده نمی‌شود) |

## ۴. اجزای نرم‌افزاری و نقش‌ها

| جزء | فناوری | نقش |
|---|---|---|
| `install.sh` | Bash (کوتاه، ~۱۲۰ خط) | Bootstrap: بررسی اولیه، نصب python3+PyYAML، کپی پروژه به `/opt/headscale-easy-manager`، ساخت symlink و اجرای `hsctl install` |
| `hsctl` | Python 3.10+ (فقط stdlib + PyYAML) | CLI Manager: وضعیت، عیب‌یابی، کاربران، دستگاه‌ها، Routeها، پشتیبان‌گیری، به‌روزرسانی، دوربین‌ها، آموزش |
| Headscale | Go binary (بسته .deb رسمی) | سرور هماهنگ‌سازی |
| Caddy | بسته رسمی apt | Reverse Proxy + گواهی TLS خودکار (Let's Encrypt) |
| UFW | ابزار استاندارد Ubuntu | فایروال با حفظ دسترسی SSH |
| systemd | واحد رسمی بسته .deb | اجرای سرویس headscale |
| `docs/fa/` | Markdown فارسی | مرکز آموزش (۱۴ فصل) — منبع واحدِ `hsctl learn/explain` و وب‌اپ |

## ۵. جریان‌های کلیدی (راستی‌آزمایی‌شده از سورس — جزئیات در FACTS.md)

1. **نصب**: preflight → تعامل با کاربر → دانلود deb + checksum → `apt install ./headscale.deb` → تولید `config.yaml` → Caddy → UFW → start → health-check → گزارش.
2. **ثبت دستگاه (Web Auth)**: `tailscale up --login-server <URL>` → مرورگر Auth ID نشان می‌دهد → `headscale auth register --user <USER> --auth-id <AUTH_ID>`.
3. **ثبت دستگاه (Preauth Key)**: `headscale users create <USER>` → `headscale users list` (گرفتن ID عددی) → `headscale preauthkeys create --user <ID>` → `tailscale up --login-server <URL> --authkey <KEY>`.
4. **Subnet Router**: `tailscale up --advertise-routes=192.168.1.0/24` + فعال‌سازی IP Forwarding → `headscale nodes approve-routes -i <ID> --routes 192.168.1.0/24` → `tailscale set --accept-routes` روی کلاینت‌ها.
5. **Exit Node**: همان جریان با `--advertise-exit-node` و تأیید `0.0.0.0/0`.
6. **به‌روزرسانی**: توقف سرویس → پشتیبان → نصب نسخه جدید → مقایسه پیکربندی → راه‌اندازی. *(نکته مهم رسمی: ارتقا باید نسخه‌به‌نسخه باشد، بدون پرش از minor به minor)*.
7. **پشتیبان‌گیری**: `sqlite3 db.sqlite ".backup ..."` (ایمن برای SQLite در حال نوشتن) + پیکربندی + کلیدها + manifest.

## ۶. مدل خطا و وضعیت‌ها

- هر مرحله نصب یکی از ۵ وضعیت را دارد: `pending` (انجام‌نشده)، `running` (در حال اجرا)، `ok` (موفق)، `needs-action` (نیازمند اقدام کاربر)، `failed` (ناموفق).
- هر دستور hsctl کد خروج استاندارد دارد: `0` موفق، `1` خطای عمومی، `2` ورودی نامعتبر، `3` نیاز به root، `4` سرویس/زیرساخت ناموجود، `5` تأیید کاربر گرفته نشد.
- ریسک هر عملیات برچسب دارد: `safe` (کم‌خطر)، `risky` (نیازمند تأیید)، `destructive` (نیازمند تأیید صریح + پشتیبان).
- اسرار (کلید noise، preauthkeyها، توکن‌ها) هرگز در لاگ/گزارش چاپ نمی‌شوند؛ لایه Redaction با regex روی همه خروجی‌های گزارش اجرا می‌شود.

## ۷. سیاست سازگاری با سرور موجود

- شناسایی سرویس‌های موجود (headscale، caddy، nginx، x-ui، پنل‌ها) از طریق `systemctl list-units` و `dpkg -l`.
- قبل از هر تغییر، نسخه پشتیبان با timestamp از فایل گرفته می‌شود.
- بلوک Caddy ما با مارکرهای `# BEGIN headscale-easy-manager` / `# END headscale-easy-manager` اضافه می‌شود؛ validate با `caddy validate` و سپس `systemctl reload caddy`. اگر validate رد شد، فایل پشتیبان برمی‌گردد.
- سرویس‌های نامرتبط هرگز متوقف/حذف نمی‌شوند.
- تغییرات فایروال فقط با تشخیص موفق پورت SSH فعلی (از `sshd -T`، `sshd_config` و متغیر `SSH_CONNECTION`) اعمال می‌شود و ابتدا `ufw allow <ssh-port>` اجرا می‌شود.
- همه تغییرات در `/etc/hem/state.json` ثبت می‌شوند تا `uninstall` بتواند فقط کارهای خودمان را برگرداند.

## ۸. محدودیت‌های شناخته‌شده و تصمیم‌ها

1. **Cloudflare Proxy** با Headscale سازگار نیست (WebSocket POST) — در مستندات و doctor ذکر شده است.
2. **DERP تعبیه‌شده** فقط با HTTPS (server_url=https) کار می‌کند؛ اگر کاربر HTTPS نخواهد، DERP تعبیه‌شده غیرفعال می‌ماند و کلاینت‌ها از DERP عمومی Tailscale به‌عنوان relay استفاده می‌کنند.
3. **gRPC از راه دور** (50443) به‌صورت پیش‌فرض روی localhost می‌ماند و hsctl از unix socket محلی استفاده می‌کند؛ باز کردن آن روی اینترنت لازم نیست و انجام نمی‌شود.
4. **پشت CGNAT**: VPS باید IP عمومی داشته باشد (این سرور است). شبکه دفتر پشت CGNAT مشکلی ندارد چون Subnet Router به‌صورت outbound متصل می‌شود.
5. **آزمایش‌پذیری در این محیط**: منطق پایتون (پارسرها، تولید پیکربندی، اعتبارسنجی، مدیریت state، پشتیبان‌گیری) با تست واحد پوشش داده شده و در همین محیط اجرا می‌شود. عملیات واقعی systemd/apt/UFW/Caddy روی سرور هدف Ubuntu اجرا می‌شود و در محیط توسعه این کانتینر Debian قابل اجرای کامل نیست — این محدودیت صادقانه در README و CHANGELOG ذکر شده است.

## ۹. ساختار مخزن

```
headscale-easy-manager/
├── install.sh            # Bootstrap (کوتاه)
├── hsctl                 # نقطه ورود CLI
├── pyproject.toml        # بسته پایتون hem + ابزارهای توسعه
├── Makefile
├── src/hem/              # پکیج پایتون (ماژولار)
│   ├── core/  system/  network/  headscale/  proxy/
│   ├── backup/  diagnostics/  cameras/  learn/  installer/
├── docs/
│   ├── FACTS.md          # قرارداد فنی راستی‌آزمایی‌شده (منبع واحد حقیقت)
│   ├── architecture-report.md
│   └── fa/               # ۱۴ فصل آموزش فارسی (منبع hsctl learn)
├── examples/             # پیکربندی نمونه (بدون هیچ مقدار حساس واقعی)
├── systemd/              # مستندات واحد سرویس رسمی + override نمونه
├── scripts/              # ابزارهای توسعه
└── tests/                # تست‌های pytest
```

## ۱۰. مسیرهای نصب (پیش‌فرض‌ها — همه قابل تغییر)

| مورد | مسیر |
|---|---|
| نصب پروژه | `/opt/headscale-easy-manager` |
| فایل اجرایی | `/usr/local/bin/hsctl` (symlink) |
| State ابزار | `/etc/hem/state.json` |
| دوربین‌ها | `/etc/hem/cameras.yaml` |
| پشتیبان‌ها | `/var/backups/hem/` |
| لاگ | `/var/log/hem/hem.log` |
| پیکربندی Headscale | `/etc/headscale/config.yaml` (استاندارد بسته) |
| داده Headscale | `/var/lib/headscale/` (استاندارد بسته) |
