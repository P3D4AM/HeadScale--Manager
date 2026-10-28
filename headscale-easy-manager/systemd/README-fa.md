# سرویس systemd در Headscale Easy Manager

> زبان‌ها: [English](README.md) · **فارسی**

## واحد رسمی سرویس

نصب از طریق بسته رسمی `.deb` یک واحد systemd استاندارد نصب می‌کند (`/usr/lib/systemd/system/headscale.service` یا مسیر معادل توزیع). واحد رسمی (مطابق مخزن upstream نسخه v0.29.5) به این صورت است:

```ini
[Unit]
After=network.target
Description=headscale coordination server for Tailscale

[Service]
Type=simple
User=headscale
Group=headscale
ExecStart=/usr/bin/headscale serve
ExecReload=/usr/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5

WorkingDirectory=/var/lib/headscale
ReadWritePaths=/var/lib/headscale

AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
DevicePolicy=closed
LockPersonality=true
MemoryDenyWriteExecute=true
NoNewPrivileges=true
PrivateDevices=true
PrivateMounts=true
PrivateTmp=true
ProcSubset=pid
ProtectClock=true
ProtectControlGroups=true
ProtectHome=true
ProtectHostname=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectProc=invisible
ProtectSystem=strict
RemoveIPC=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
RuntimeDirectory=headscale
RuntimeDirectoryMode=0750
StateDirectory=headscale
StateDirectoryMode=0750
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged
SystemCallFilter=~@resources
UMask=0077

[Install]
WantedBy=multi-user.target
```

این واحد از نظر امنیتی Harden شده است: اجرا با کاربر اختصاصی `headscale`، فایل‌سیستم فقط‌خواندنی به‌جز `/var/lib/headscale`، محدودیت syscall و غیره. **نیازی به تغییر آن نیست** — نصب‌کننده و `hsctl` همین واحد رسمی را مدیریت می‌کنند.

## ویژگی‌های مدیریت سرویس توسط ابزار

- **اجرای خودکار پس از ری‌استارت سرور:** `systemctl enable headscale` (به‌صورت خودکار در نصب)
- **Restart Policy منطقی:** `Restart=always` با وقفه ۵ ثانیه (بخشی از واحد رسمی)
- **جلوگیری از اجرای چند نمونه:** systemd به‌طور ذاتی فقط یک instance از هر `Type=simple` با این نام اجرا می‌کند
- **اعتبارسنجی پیکربندی قبل از ری‌استارت:** `hsctl config validate` (اجرای `headscale configtest`) — قبل از هر restart/reload که ابزار انجام می‌دهد اجرا می‌شود
- **دسترسی محدود فایل‌ها:** پیکربندی `640` و کلیدهای خصوصی در `/var/lib/headscale` با مالکیت کاربر `headscale`

## دستورات پرکاربرد

```bash
# وضعیت سرویس
sudo systemctl status headscale

# راه‌اندازی / توقف / ری‌استارت
sudo systemctl start headscale
sudo systemctl stop headscale
sudo systemctl restart headscale

# فعال/غیرفعال‌کردن اجرای خودکار در بوت
sudo systemctl enable headscale
sudo systemctl disable headscale

# مشاهده لاگ‌ها
sudo journalctl -u headscale -n 100          # ۱۰۰ خط آخر
sudo journalctl -u headscale -f              # پایش زنده
sudo journalctl -u headscale --since "1 hour ago"

# فقط خطاها
sudo journalctl -u headscale -p err -n 50

# اعمال مجدد پیکربندی systemd بعد از تغییر unit/override
sudo systemctl daemon-reload
```

معادل‌های داخل ابزار: `hsctl status`، `hsctl logs [--follow]`، `hsctl doctor` و `hsctl config validate`.

## Override (تغییر تنظیمات بدون دست‌زدن به فایل اصلی)

اگر روزی لازم شد چیزی را تغییر دهید (مثلاً محدودیت منابع)، به‌جای ویرایش فایل اصلی از override استفاده کنید:

```bash
sudo systemctl edit headscale
```

سپس در ویرایشگر بازشده مثلاً:

```ini
[Service]
MemoryMax=512M
```

و در پایان:

```bash
sudo systemctl daemon-reload
sudo systemctl restart headscale
```

فایل override در `/etc/systemd/system/headscale.service.d/override.conf` ذخیره می‌شود و به‌صورت خودکار در پشتیبان‌گیری `hsctl backup create` هم گنجانده می‌شود.

## نکته درباره سوکت CLI

دستورهای `headscale` از طریق سوکت یونیکس `/var/run/headscale/headscale.sock` (سطح دسترسی `0770`) با سرویس صحبت می‌کنند؛ فقط `root` یا اعضای گروه `headscale` دسترسی دارند. ابزار `hsctl` این را خودکار مدیریت می‌کند (اجرای sudo در صورت نیاز)، بنابراین همیشه `hsctl` را با `sudo` اجرا کنید.
