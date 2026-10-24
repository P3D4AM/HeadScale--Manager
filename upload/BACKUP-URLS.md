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
219afa88ac086432865584e22d6e6af6d3f88f584dbb233de646772a5420b22d  HeadscaleEasyManager-v0.3.1-win64.zip
```
(توجه: sha256 بستهٔ ویندوزی که «از clone تمیز» ساخته شد 219afa88… است — همان بستهٔ نهایی؛ بستهٔ tar.gz به‌دلیل mtime در tar هش متفاوت در هر اجرا می‌دهد — فایل .sha256 همیشه هم‌زمان بازتولید می‌شود.)

### نشانی‌های موقت (تاریخ انقضا کوتاه)
- tmpfiles.org (۶۰د): tar.gz → https://tmpfiles.org/wAASUdmoPMIx/headscale-easy-manager-v0.3.1.tar.gz
- tmpfiles.org (۶۰د): zip → https://tmpfiles.org/wMADUhmYqZ5h/headscaleeasymanager-v0.3.1-win64.zip
- uguu.se (۴۸س): tar.gz → https://d.uguu.se/kSxPyrpB.gz

### صداقت این جلسه
- gofile.io در این لحظه از سندباکس پاسخ نمی‌داد (store1 آویزان/غیرJSON، store2 404) — در جلسات بعدی دوباره امتحان می‌شود.
- uguu.se فایل zip را با خطای 415 («Filetype not allowed») رد می‌کند (حتی با پسوند مجاز) — محدودیت میزبان است، نه بسته.
- بازیابی مطمئن: GitHub Release (بادوام) → در نبود آن tmpfiles (۶۰د) → در جلسهٔ بعدی gofile.
