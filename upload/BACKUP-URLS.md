# نشانی‌های پشتیبان ابری — Headscale Easy Manager v0.3.0 (2026-10-24)

> قانون پایدار کاربر: کل پروژه همیشه روی «سه سایت آپلود» به‌عنوان پشتیبان خارج از سندباکس نگهداری شود و در صورت پاک‌شدن سندباکس از همین نشانی‌ها بازیابی شود.

## فایل‌ها و نشانی‌ها

| # | فایل | نشانی دانلود | ماندگاری سایت |
|---|---|---|---|
| ۱ | headscale-easy-manager-v0.3.0.tar.gz (۱.۶MB) | https://gofile.io/d/9TItyelY | بلندمدت (gofile.io) |
| ۲ | headscale-easy-manager-v0.3.0.tar.gz | https://n.uguu.se/EhTkSWkl.gz | ۴۸ ساعت (uguu.se) |
| ۳ | headscale-easy-manager-v0.3.0.tar.gz | https://tmpfiles.org/w3ANUUBONErk/headscale-easy-manager-v0.3.0.tar.gz | ۶۰ دقیقه (tmpfiles.org) |
| ۴ | HeadscaleEasyManager-v0.3.0-win64.zip (۳۹MB — بستهٔ ویندوزی) | https://gofile.io/d/Wg5mXHgI | بلندمدت (gofile.io) |

## چک‌سام‌ها (SHA-256)

```
17e19ed9d4021f46fd57777e9f9e1c43d11be6efd9e9d9a02730e20e60b17d90  headscale-easy-manager-v0.3.0.tar.gz
2166e8d6a52cb489ecc9a749107929366f25614b42535713d9092d31d2840c3e  HeadscaleEasyManager-v0.3.0-win64.zip
```

## بازیابی پس از پاک‌شدن سندباکس

1. `curl -L -o headscale-easy-manager-v0.3.0.tar.gz https://gofile.io/d/9TItyelY` (یا نشانی‌های ۲/۳)
2. `sha256sum` را با جدول بالا تطبیق دهید.
3. `tar xzf headscale-easy-manager-v0.3.0.tar.gz` → ساختار کامل: `src/` (رابط وب)، `mini-services/hem-agent/` (سرویس SSH)، `headscale-easy-manager/` (نصب‌کنندهٔ سرور + hsctl + ۱۵ فصل آموزش).
4. راه‌اندازی dev: `bun install && bun run docs:generate && bun run dev` (پورت ۳۰۰۰) + `cd mini-services/hem-agent && bun install && bun run dev` (پورت ۳۰۰۵).
5. مخزن git داخلی هم داخل بسته است (`git archive` تمیز) و تاریخچهٔ کامل در `headscale-easy-manager/` بازسازی می‌شود.

## یادداشت صادقانه

- transfer.sh، 0x0.st، file.io، catbox، bashupload، x0.at، temp.sh و pixeldrain از این سندباکس در دسترس نبودند (خطای شبکه/احراز هویت/۵۰۰) — سه سایت بالا از ده کاندیدا واقعاً جواب دادند.
- نشانی‌های uguu (۴۸س) و tmpfiles (۶۰د) موقتی‌اند؛ برای پشتیبان بلندمدت gofile معتبرترین است. پس از هر انتشار جدید، این فایل باید به‌روز شود.
