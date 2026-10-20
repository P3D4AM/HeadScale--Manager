# گزارش تغییرات (Changelog)

## [0.1.0] — نسخه اول

### افزوده‌شده
- نصب‌کننده تعاملی و خودکار Headscale v0.29.5 روی Ubuntu Server 22.04/24.04 (amd64/arm64)
- بررسی پیش‌نیازها (preflight): سیستم‌عامل، معماری، دیسک، RAM، sudo، پورت‌ها، سرویس‌های موجود
- تشخیص و احترام به سرویس‌های موجود (Caddy/Headscale/nginx/… ) با پشتیبان‌گیری قبل از هر تغییر
- پیکربندی Headscale + Caddy (TLS خودکار) + فایروال UFW با حفظ دسترسی SSH
- ابزار مدیریت `hsctl`: status, doctor, logs, users, devices, preauth, routes, backup, restore, update, config, cameras, learn, explain, report, uninstall
- پشتیبان‌گیری/بازیابی کامل (SQLite با .backup امن + کلیدها + پیکربندی + manifest)
- مدیریت دوربین‌های مداربسته و دستگاه ضبط Dahua از طریق Subnet Router
- مرکز آموزش فارسی (۱۴ فصل) به‌همراه `hsctl learn` و `hsctl explain`
- گزارش تشخیصی قابل‌ارسال با حذف خودکار اطلاعات حساس
- حالت `--dry-run` برای نمایش تغییرات بدون اعمال

### محدودیت‌های شناخته‌شده
- تست‌های یکپارچه واقعی (systemd/apt/UFW/Caddy) باید روی VPS آزمایشی Ubuntu 22.04/24.04 اجرا شوند؛
  در محیط توسعه فقط منطق (parserها، تولید پیکربندی، state، پشتیبان) تست واحد شده است.
- ارتقا باید نسخه‌به‌نسخه انجام شود (قید رسمی Headscale)؛ `hsctl update` هشدار می‌دهد.
