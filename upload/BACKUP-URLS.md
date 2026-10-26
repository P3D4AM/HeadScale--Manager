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

---

## v0.3.1 (۲۰۲۶-۱۰-۲۴) — «فاز اصلاح پیش از انتشار»

### پشتیبان اصلی (بادوام): GitHub Release
- https://github.com/P3D4AM/HeadScale--Manager/releases/tag/v0.3.1
- دارایی‌ها: tar.gz + zip ویندوزی + هر دو فایل .sha256 (چهار آپلود موفق 201)

### SHA-256
```
14dd97116c227de5e9964b173f66eadc82418eae2fa1396cfaa4244396e82d30  headscale-easy-manager-v0.3.1.tar.gz
6e97f8383d045d18814fe70841be1402c477b47b90402a1ab069f5705e8d2974  HeadscaleEasyManager-v0.3.1-win64.zip
```
(راستی‌آزمایی مستقل: sha256 داراییِ zip در GitHub Release با فایل محلی بایت‌به‌بایت یکی است — 6e97f838…؛ هر اجرای build-windows.sh به‌دلیل timestamp داخل zip هش تازه می‌سازد — «بستهٔ نهایی» یعنی همان که در Release آپلود شده و .sha256 کنارش نوشته است. مقدار 219afa88… که پیش‌تر ثبت شد مربوط به build مستقلِ clone تمیز در /tmp بود — اصلاح شد. tar.gz نیز به‌دلیل mtime هش متغیر دارد؛ .sha256 هم‌زمان بازتولید می‌شود.)

### نشانی‌های موقت (تاریخ انقضا کوتاه)
- tmpfiles.org (۶۰د): tar.gz → https://tmpfiles.org/wAASUdmoPMIx/headscale-easy-manager-v0.3.1.tar.gz
- tmpfiles.org (۶۰د): zip → https://tmpfiles.org/wMADUhmYqZ5h/headscaleeasymanager-v0.3.1-win64.zip
- uguu.se (۴۸س): tar.gz → https://d.uguu.se/kSxPyrpB.gz

### صداقت این جلسه
- gofile.io در این لحظه از سندباکس پاسخ نمی‌داد (store1 آویزان/غیرJSON، store2 404) — در جلسات بعدی دوباره امتحان می‌شود.
- uguu.se فایل zip را با خطای 415 («Filetype not allowed») رد می‌کند (حتی با پسوند مجاز) — محدودیت میزبان است، نه بسته.
- بازیابی مطمئن: GitHub Release (بادوام) → در نبود آن tmpfiles (۶۰د) → در جلسهٔ بعدی gofile.

---

## v0.3.2-beta.2 (۲۰۲۶-۱۰-۲۵) — «رفع دو باگ اجرای ویندوزی: Parser نصب‌کننده + بسته‌شدن سریع EXE» (Pre-release از develop)

### پشتیبان اصلی (بادوام): GitHub Release
- https://github.com/P3D4AM/HeadScale-Manager/releases/tag/v0.3.2-beta.2
- کامیت دقیق: f36ad071efa5895b9d2e942dc1d47afceeb187be (develop)
- دارایی‌ها: tar.gz + zip ویندوزی + هر دو فایل .sha256 (چهار آپلود موفق + راستی‌آزمایی بازدانلود بایت‌به‌بایت)

### SHA-256
```
e00a0da9926fcc972d98314437a9b6ce2098304f3655f823830bdce750f2675f  headscale-easy-manager-v0.3.2-beta.2.tar.gz
d8c33cdaa9512e49c144150d30159e320a47af0b53330b5c5dd9498f30a6c769  HeadscaleEasyManager-v0.3.2-beta.2-win64.zip
```
(هر دو دارایی پس از آپلود دوباره دانلود و sha256 آنها با مقادیر بالا تطبیق داده شد؛ install.ps1 داخل zip بازرسی شد: BOM + فقط CRLF.)

### یادداشت
- این نسخه رفع دو باگ گزارش‌شدهٔ کاربر است: خطای نحوی install.ps1 (ریشه: UTF-8 بدون BOM + LF در خوانش ANSI → کوتیشن‌های یونی‌کد U+2018..U+201E به‌عنوان جداکنندهٔ رشتهٔ Parser) و بسته‌شدن سریع EXE (ریشه: دابل‌کلیک بدون متغیر → fail-closed → exit≠0 فوری؛ اصلاح: قاعدهٔ دسکتاپ برای بستهٔ ویندوزی + لاگ فایل تشخیصی).
- جزئیات کامل در CHANGELOG (بخش 0.3.2-beta.2) و release notes.

---

## v0.3.2-beta.4 (۲۰۲۶-۱۰-۲۵) — «UI بستهٔ ویندوزی روی ویندوزِ واقعی» (کامیت f4716f4 روی develop — **CI هر دو شغل ویندوزی/لینوکسی سبز** + GitHub Release منتشر شد)

| فایل | نشانی دانلود | ماندگاری سایت |
|---|---|---|
| HeadscaleEasyManager-v0.3.2-beta.4-win64.zip (۳۸MB) | https://gofile.io/d/QH8Q0bPi | بلندمدت (gofile.io) — md5 با پاسخ سرور تطبیق شد |
| HeadscaleEasyManager-v0.3.2-beta.4-win64.zip | https://tmpfiles.org/wrA5VCj8CtA3/headscaleeasymanager-v0.3.2-beta.4-win64.zip | ۶۰ دقیقه (tmpfiles.org) |
| HeadscaleEasyManager-v0.3.2-beta.4-win64.zip.sha256 | https://gofile.io/d/HndgVGDd | بلندمدت (gofile.io) |
| headscale-easy-manager-v0.3.2-beta.4.tar.gz (۷۹۶K) | https://gofile.io/d/rPSMD1Up | بلندمدت (gofile.io) — md5 با پاسخ سرور تطبیق شد |
| headscale-easy-manager-v0.3.2-beta.4.tar.gz | https://d.uguu.se/eVFORAEa.gz | ۴۸ ساعت (uguu.se) |
| headscale-easy-manager-v0.3.2-beta.4.tar.gz | https://tmpfiles.org/wgAKVMj0CA60/headscale-easy-manager-v0.3.2-beta.4.tar.gz | ۶۰ دقیقه (tmpfiles.org) |
| headscale-easy-manager-v0.3.2-beta.4.tar.gz.sha256 | https://gofile.io/d/muRPvXtQ | بلندمدت (gofile.io) |

```
cee64b28298dc09fde2026d02f920203e46bafa8d2902fb12c5c81502605734a  HeadscaleEasyManager-v0.3.2-beta.4-win64.zip
de9eb726d8d11ef8be6ae48fcac1207f6a86cfb28d856edf210a3bf7e6bbf924  headscale-easy-manager-v0.3.2-beta.4.tar.gz
```

### یادداشت
- **پشتیبان بادوام اصلی: GitHub Release v0.3.2-beta.4** (هر ۴ دارایی پس از آپلود دوباره دانلود و sha256 بایت‌به‌بایت تطبیق شد): https://github.com/P3D4AM/HeadScale-Manager/releases/tag/v0.3.2-beta.4
- این نسخه حاصل اولین اجرای سبز CI ویندوزی واقعی است: اجرای واقعی EXE روی windows-latest (۱۲ چک زنده + شبیه‌سازی دابل‌کلیک + fail-closed + نصب/حذف واقعی با PowerShell 5.1). ریشهٔ باگ مسیر: درایو مجازی `~BUN` در bun ویندوزی (نه `$bunfs`).
- v0.3.2-beta.3 (سیاست انگلیسی‌سازی) هرگز Release نشد؛ محتوایش کامل در beta.4 است (کامیت‌های ae048be/bec73b9 روی develop).

---

## v0.3.2-beta.3 (۲۰۲۶-۱۰-۲۵) — «ترمینال و کامنت‌ها فقط انگلیسی» (کامیت ec81a08 روی develop — هنوز push نشده: توکن این سندباکس باطل است؛ جزئیات در worklog تسک ۱۹)

### بستهٔ ویندوزی (تست‌شده با Parser واقعی PowerShell + ۳۰ چک زندهٔ باینری هم‌سورس)
| فایل | نشانی | ماندگاری |
|---|---|---|
| HeadscaleEasyManager-v0.3.2-beta.3-win64.zip (۳۸MB) | https://gofile.io/d/qzWvs2q2 | بلندمدت (gofile.io) |
| HeadscaleEasyManager-v0.3.2-beta.3-win64.zip | https://tmpfiles.org/wHA3VCyigIcB/headscaleeasymanager-v0.3.2-beta.3-win64.zip | ۶۰ دقیقه (tmpfiles.org) |
| HeadscaleEasyManager-v0.3.2-beta.3-win64.zip.sha256 | https://gofile.io/d/ltTDOe22 | بلندمدت (gofile.io) |

### بستهٔ سرور (tar.gz — gates کامل سبز: docs:generate + tsc + lint)
| فایل | نشانی | ماندگاری |
|---|---|---|
| headscale-easy-manager-v0.3.2-beta.3.tar.gz (۷۹۲K) | https://gofile.io/d/flLUet1W | بلندمدت (gofile.io) |
| headscale-easy-manager-v0.3.2-beta.3.tar.gz | https://d.uguu.se/JqBLZWBu.gz | ۴۸ ساعت (uguu.se) |
| headscale-easy-manager-v0.3.2-beta.3.tar.gz.sha256 | https://gofile.io/d/pMcX22tX | بلندمدت (gofile.io) |

### چک‌سام‌ها (SHA-256)
```
77cc3e28f90c5539edcffcdb409304fa62ff126c8176934e4f9b70f0193f5331  HeadscaleEasyManager-v0.3.2-beta.3-win64.zip
67484d37ec3103d5875498d07cf8f4cd249da786c01f42988af7374ef89f7ff1  headscale-easy-manager-v0.3.2-beta.3.tar.gz
```
- md5 زیپ آپلودشده با پاسخ سرور gofile تطبیق داده شد (f6df09b1…) — آپلود سالم است.
- صادقانه: انتشار GitHub Release این نسخه انجام نشد (توکن push این سندباکس «Invalid username or token» می‌دهد — به‌احتمال زیاد هم‌زمان با ارسال مجدد توکن به جلسهٔ موازی، توکن قدیمی regenerate شده). پس از رفع توکن، همین کامیت (ec81a08) باید push و از همان، Release ساخته شود.

## Release v0.3.2-beta.5 (2026-10-26) — پنل: نام/برچسب/مسیر + نصب آفلاین Tailscale

- **پشتیبان بادوام اصلی: GitHub Release v0.3.2-beta.5** (هر ۴ دارایی پس از آپلود دوباره دانلود و sha256 بایت‌به‌بایت تطبیق شد):
  - بستهٔ سرور: `headscale-easy-manager-v0.3.2-beta.5.tar.gz` — sha256 = `898b0d313c7ee59a7c3646ae30e19d4479dea15772cae5ac8c12f79552e815f2`
  - بستهٔ ویندوزی (شامل Tailscale MSI رسمی 1.104.2 برای نصب آفلاین): `HeadscaleEasyManager-v0.3.2-beta.5-win64.zip` — sha256 = `2c26e8b85a92caf6165cdc2b21e32f79e7e98ca55f0f4a27b06950c8d26bc5c4`
  - نشانی: https://github.com/P3D4AM/HeadScale-Manager/releases/tag/v0.3.2-beta.5
- کامیت: 5a68b0e (از develop؛ remote main دست‌نخورده: 7318212)
