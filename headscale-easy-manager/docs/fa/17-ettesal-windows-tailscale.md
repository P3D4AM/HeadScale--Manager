---
title: "فصل هفدهم: اتصال ویندوز به سرور Headscale (کلاینت Tailscale)"
description: "نصب Tailscale در ویندوز با Winget یا سایت رسمی، اتصال به سرور شخصی Headscale با tailscale login، اتصال خودکار با کلید از پیش تأییدشده، تفاوت خروج/پاک‌سازی محلی/حذف رکورد سرور، حذف کامل و اسکریپت ایمن پاک‌سازی اطلاعات محلی"
order: 17
icon: "MonitorSmartphone"
---

# فصل هفدهم: اتصال ویندوز به سرور Headscale (کلاینت Tailscale)

[فصل پنجم](05-ettesal-dastgahha.md) اتصال دستگاه‌ها را برای همهٔ پلتفرم‌ها مرور کرد. این فصل، **ویندوز را کامل و عمیق** پوشش می‌دهد: نصب، اتصال به سرور شخصی، اتصال خودکار با کلید، و حذف/پاک‌سازی کامل — با دستورهای PowerShell.

> **همهٔ دستورهای این فصل را در PowerShell ویندوز اجرا کنید.** برای بازکردن آن: منوی Start ← تایپ `powershell` ← Enter. دستورهایی که تغییر سیستمی می‌دهند، PowerShell را «Run as administrator» باز کنید.

## ۱۷.۱ Tailscale رسمی و Headscale شخصی — چه تفاوتی دارند؟

- **Tailscale رسمی:** کلاینت Tailscale به‌طور پیش‌فرض به سرورهای شرکت Tailscale (حساب رسمی `login.tailscale.com`) وصل می‌شود.
- **Headscale شخصی:** سرور هماهنگ‌کنندهٔ متن‌بازِ Headscale روی VPS خودِ شماست. کلاینت یکسان است — فقط به‌جای سرور رسمی، به سرور **شما** وصل می‌شود.

نکتهٔ مهم: **می‌توانید از کلاینت رسمی Tailscale برای اتصال به Headscale شخصی استفاده کنید، بدون حساب و پنل رسمی Tailscale.** خود مستندات رسمی Tailscale دربارهٔ پارامتر `--login-server` می‌گوید: «اگر از Headscale به‌عنوان سرور کنترل استفاده می‌کنید، نشانی Headscale خودتان را بدهید.» یعنی این کار، مسیر رسمی و پشتیبانی‌شدهٔ خود Tailscale است.

> **جایگزینی دامنه:** در مثال‌های این فصل دامنهٔ نمونهٔ `head.parande.shop` به‌کار رفته است. **حالت شما:** هر جا این دامنه را دیدید، دامنهٔ واقعی سرور خودتان را بنویسید (همان دامنه‌ای که موقع نصب Headscale وارد کردید).

## ۱۷.۲ نصب Tailscale در ویندوز

### روش ۱ — با Winget (سریع‌ترین)

```powershell
winget install --id Tailscale.Tailscale
```

اگر Winget نصب نیست یا خطا داد، از روش ۲ استفاده کنید.

### روش ۲ — از وب‌سایت رسمی

1. به نشانی رسمی بروید: **https://tailscale.com/download/windows**
2. نصب‌کنندهٔ ویندوز را دانلود و اجرا کنید (فایل `.exe` یا بستهٔ MSI).

### روش ۳ — نصب آفلاین از داخل بستهٔ «مدیر آسان هداسکیل» (بدون اینترنت و بدون Winget)

از نسخهٔ v0.3.2-beta.5 به بعد، **بستهٔ ویندوزی «مدیر آسان هداسکیل» نصب‌کنندهٔ رسمی Tailscale را داخل خودش** دارد (پوشهٔ `vendor\tailscale\`، فایل MSI با نسخهٔ قفل‌شده و SHA-256 تأییدشده در زمان ساخت). پس اگر ویندوز شما اینترنت ندارد یا Winget در دسترس نیست:

1. پوشهٔ باز‌شدهٔ بستهٔ Headscale Easy Manager را باز کنید (همان پوشه‌ای که `hem-manager.exe` در آن است).
2. PowerShell را در همان پوشه باز کنید (Shift + راست‌کلیک روی پوشه → «Open PowerShell window here»).
3. این دستور را اجرا کنید:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-tailscale.ps1
```

4. چون Tailscale یک سرویس ویندوزی نصب می‌کند، پنجرهٔ تأیید UAC باز می‌شود — «Yes» را بزنید. (توجه: خودِ مدیر هداسکیل به Administrator نیاز ندارد؛ فقط همین نصبِ Tailscale این تأیید را می‌خواهد.)
5. نصب بی‌صدا انجام می‌شود (حدود یک دقیقه) و در پایان، وضعیت سرویس (`Running`) و شمارهٔ نسخه چاپ می‌شود. اگر ویندوز درخواست ری‌بوت داد، آن را انجام دهید.

نکته‌های صادقانه دربارهٔ این روش:

- فایل MSI عیناً همان فایل رسمی کانال پایدار Tailscale از `pkgs.tailscale.com` است (همان سروری که صفحهٔ رسمی دانلود از آن می‌دهد)؛ نسخهٔ آن در زمان ساخت بسته قفل شده و هش SHA-256 آن موقع ساخت بررسی شده است.
- اگر Tailscale از قبل نصب باشد، همین اسکریپت آن را در جای خود ارتقا/تعمیر می‌کند؛ تنظیمات و اتصال قبلی شما حفظ می‌شود.
- برای دیدن نصب‌کنندهٔ با رابط گرافیکی معمولی به‌جای نصب بی‌صدا: `.\install-tailscale.ps1 -Interactive`
- راهنمای فارسیِ همین روش، داخل خود بسته هم هست: فایل `README-WINDOWS-FA.txt` (بخش ۶).

### بررسی نصب موفق و وضعیت سرویس

بعد از نصب، سرویس ویندوزی Tailscale باید در حال اجرا باشد:

```powershell
Get-Service Tailscale
```

خروجی سالم چیزی شبیه این است: `Status : Running` و `StartType : Automatic`. نسخهٔ نصب‌شده را هم می‌توانید ببینید:

```powershell
tailscale version
```

بعد از نصب، آیکن Tailscale در سینی کنار ساعت ظاهر می‌شود — فعلاً فقط آن را ببینید؛ اتصال را در ادامه با دستور برقرار می‌کنیم.

## ۱۷.۳ مشاهده وضعیت اتصال: `tailscale status`

```powershell
tailscale status
```

این دستور **وضعیت اتصال دستگاه شما و فهرست دستگاه‌های قابل‌مشاهده در شبکه** را نشان می‌دهد: نام و IP هر دستگاه، کاربر مالک، آنلاین/آفلاین بودن و اینکه اتصال مستقیم است یا از طریق رله (DERP). اگر هنوز وصل نشده باشید، همان حالا هم می‌گوید. این دستورِ «همه‌چیز را یک نگاه»، ابزار روزمرهٔ شماست.

## ۱۷.۴ خروج از حساب یا اتصال قبلی: `tailscale logout`

```powershell
tailscale logout
```

این دستور **نشست فعلی را خارج می‌کند** (اتصال قطع و اعتبار ورود فعلی منقضی می‌شود؛ دفعهٔ بعد برای اتصال باید دوباره احراز هویت کنید). اما به‌تنهایی **تضمین نمی‌کند تمام اطلاعات محلی یا تنظیمات قبلی حذف شوند** — فایل‌های وضعیت محلی سر جای خود می‌مانند (بخش ۱۷.۸).

سه مفهوم را از هم جدا کنید — این جدول مهم‌ترین بخش این فصل است:

| عمل | چه چیزی پاک می‌شود | چه چیزی پاک نمی‌شود |
|---|---|---|
| خروج از اتصال (`tailscale logout`) | نشست/اعتبار ورود فعلی | اطلاعات محلی روی ویندوز؛ **رکورد دستگاه روی سرور** |
| پاک‌سازی اطلاعات محلی (بخش ۱۷.۸) | وضعیت و تنظیمات محلی روی ویندوز | رکورد دستگاه روی سرور Headscale |
| حذف رکورد از سرور (بخش ۱۷.۱۰) | رکورد دستگاه در Headscale | فایل‌های محلی روی ویندوز |

یعنی اگر قصد دارید دستگاه را «کاملاً از شبکه حذف کنید»، هم پاک‌سازی محلی و هم حذف رکورد سمت سرور لازم است — و برعکس، حذف محلی به‌تنهایی رکورد قبلی را از سرور پاک نمی‌کند.

## ۱۷.۵ اتصال به Headscale شخصی: `tailscale login --login-server`

```powershell
tailscale login --login-server=https://head.parande.shop
```

(دامنه را با دامنهٔ سرور خودتان عوض کنید.)

این دستور کلاینت را به **سرور مدیریت مشخص‌شده** وصل می‌کند — به‌جای سرور رسمی Tailscale. بعد از اجرا:

1. معمولاً یک نشانی ثبت دستگاه (URL) در خروجی نمایش داده می‌شود و مرورگر باز می‌شود.
2. **این صفحه لزوماً به معنی نیاز به ورود به حساب رسمی Tailscale نیست** — این صفحه فرایند «ثبت/تأیید دستگاه روی سرور مدیریت شما» است. برای سرور Headscale شخصی، تأیید روی **سمت سرور شما** انجام می‌شود، نه در پنل Tailscale.
3. بسته به تنظیم سرور، ممکن است تأیید دستگاه لازم باشد: از پنل (کنسول یا بخش دستگاه‌ها) یا ترمینال سرور با `headscale auth register --user <کاربر> --auth-id <شناسه>` — شرح کامل جریان تأیید در [فصل پنجم](05-ettesal-dastgahha.md).

بعد از موفقیت، با `tailscale status` (بخش ۱۷.۳) اتصال و دستگاه‌های شبکه را ببینید و با `tailscale ping <IP-دستگاه-دیگر>` ارتباط را تست کنید.

> **اگر قبلاً به سرور دیگری وصل بوده‌اید:** اول `tailscale logout` (بخش ۱۷.۴) و بعد `login` به سرور جدید. اگر باز خطای اتصال قبلی گرفتید، [عیب‌یابی ۱۷.۶](#۱۷۶-اتصال-خودکار-با-کلید-از-پیش-تأییدشده-pre-auth-key) را ببینید.

## ۱۷.۶ اتصال خودکار با کلید از پیش تأییدشده (Pre-Auth Key)

اگر در سرور Headscale کلید اتصال ساخته‌اید (از پنل: بخش «کلیدها» ← «ساخت کلید اتصال جدید» — [فصل شانزدهم](16-amoozesh-panel.md) — یا ترمینال: `hsctl preauth create <کاربر>`)، می‌توانید بدون مرورگر و تأیید دستی وصل شوید:

```powershell
tailscale up --login-server=https://head.parande.shop --authkey=YOUR_AUTH_KEY
```

- `YOUR_AUTH_KEY` را با **کلید معتبر ساخته‌شده در Headscale خودتان** عوض کنید (شکل کلی کلیدها معمولاً چیزی شبیه `tskey-...` است).
- در نسخه‌های جدیدتر، همین پارامتر در مستندات رسمی به شکل `--auth-key` هم نوشته می‌شود — هر دو شکل پذیرفته است.

**قواعد امنیتی و سازگاری:**

- 🔐 **کلید نباید در مخزن Git، گزارش‌ها یا اسناد عمومی ذخیره شود.** کلید را فقط در جای امن (مدیر رمز عبور) نگه دارید و مستقیم در دستور تایپ/پیست کنید.
- کلید را مطابق **سیاست انقضا و استفادهٔ مجدد** بسازید: برای یک دستگاه، کلید یک‌بارمصرفِ کوتاه‌عمر کافی است؛ «قابل استفادهٔ مجدد» فقط وقتی لازم است که چند دستگاه را پشت‌سرهم ثبت می‌کنید. اگر کلید لو رفت، در همان پنل «ابطال»ش کنید.
- این روش فقط وقتی کار می‌کند که **نسخهٔ کلاینت و سرور با آن سازگار باشند** (نسخه‌های خیلی قدیمی کلاینت ممکن است رفتار متفاوتی داشته باشند — در صورت خطا، کلاینت را با `winget upgrade --id Tailscale.Tailscale` به‌روز کنید و دوباره امتحان کنید).

**اگر اتصال قبلی باعث خطا می‌شود** (مثلاً پیام «already logged in» یا خطای تغییر سرور مدیریت): اول `tailscale logout`، بعد دوباره دستور `up` را اجرا کنید. اگر باز هم مشکل داشت، دستگاه را ری‌استارت کنید و اگر لازم شد مسیر پاک‌سازی کامل (۱۷.۸) را پیش بروید — رکورد سمت سرور را جداگانه مدیریت کنید (۱۷.۱۰).

## ۱۷.۷ حذف Tailscale از ویندوز

### روش معمول — با Winget

```powershell
winget uninstall --id Tailscale.Tailscale
```

### روش جایگزین — از تنظیمات ویندوز

1. **Settings** را باز کنید (کلید Windows + I).
2. **Apps** را انتخاب کنید.
3. وارد **Installed apps** شوید.
4. **Tailscale** را پیدا کنید.
5. روی **Uninstall** کلیک کنید و مراحل را تأیید کنید.

> **روند حذف می‌تواند متفاوت باشد** — بسته به روش نصب (Winget/نصب‌کننده/MSI)، نسخهٔ برنامه و وضعیت سرویس (در حال اجرا/متوقف)، ممکن است سرویس قبل از حذف متوقف شود، نیاز به ری‌استارت بماند یا فایل‌هایی باقی بگذارد. به همین دلیل بخش بعدی (پاک‌سازی باقی‌مانده‌ها) را همیشه بعد از حذفِ عادی انجام دهید.

## ۱۷.۸ پاک‌سازی کامل اطلاعات محلی Tailscale

> ⚠️ **قبل از اجرا، پیامدها را بدانید:** این پاک‌سازی، تنظیمات اتصال و وضعیت محلی دستگاه را حذف می‌کند و ممکن است **ثبت مجدد دستگاه در Headscale لازم شود**. اگر فقط می‌خواهید اتصال را عوض کنید، معمولاً `logout` + `login` کافی است — پاک‌سازی کامل فقط برای حذف قطعی همهٔ ردپاهای محلی (مثلاً فروش سیستم یا حل مشکل سرسخت) لازم است.

مسیرهای واقعی داده‌های Tailscale در ویندوز — که طبق مستندات رسمی Tailscale تأیید شده‌اند:

| مسیر | نقش | وضعیت |
|---|---|---|
| `$env:ProgramData\Tailscale` (یعنی `C:\ProgramData\Tailscale`) | وضعیت سرویس، کلیدها و لاگ‌ها (از نسخهٔ 1.14.4 به بعد؛ لاگ‌ها در زیرپوشهٔ `Logs`) | مسیر اصلی نسخه‌های فعلی |
| `$env:LOCALAPPDATA\Tailscale` | داده‌های سطح کاربر برنامه | ممکن است بسته به نسخه موجود باشد |
| `$env:WINDIR\System32\config\systemprofile\AppData\Local\Tailscale` | داده‌های قدیمی سرویس (نسخه‌های قبل از 1.14.4) | فقط میراث نصب‌های خیلی قدیمی |

**مراحل پیشنهادی:** (۱) حذف عادی برنامه (۱۷.۷) ← (۲) ری‌استارت ویندوز در صورت نیاز ← (۳) بررسی فایل‌های باقی‌مانده ← (۴) حذف **فقط** مسیرهای معتبر متعلق به Tailscale ← (۵) نصب مجدد و اتصال (۱۷.۱۰).

### اسکریپت ایمن پاک‌سازی

این اسکریپت را با نام `Cleanup-Tailscale.ps1` ذخیره کنید و **در PowerShell مدیریتی (Run as administrator)** اجرا کنید. متن اسکریپت عمداً انگلیسی است تا در هر نسخهٔ PowerShell بدون مشکل کدگذاری اجرا شود:

```powershell
# Cleanup-Tailscale.ps1 - Safe cleanup of LOCAL Tailscale data on Windows.
# Docs chapter 17 of Headscale Easy Manager. English-only on purpose
# (ASCII-safe for all PowerShell versions).
#
# What it does:  checks Administrator rights, stops the Tailscale service
# (if still present), shows the Tailscale-owned folders that exist, asks
# for explicit confirmation, deletes ONLY those exact folders, and reports
# every result.
#
# What it NEVER touches: the Windows registry, network/VPN settings of
# Windows, other VPN applications, or any parent/shared folder.

$ErrorActionPreference = 'Continue'

# 1) Administrator check (needed to stop the service and delete ProgramData)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: please run this script in an Administrator PowerShell." -ForegroundColor Red
    exit 1
}

# 2) Tailscale-owned candidate paths (verified against official Tailscale docs)
$candidates = @(
    (Join-Path $env:ProgramData 'Tailscale'),                                        # current: service state, keys, logs
    (Join-Path $env:LOCALAPPDATA 'Tailscale'),                                       # user-level app data
    (Join-Path $env:WINDIR 'System32\config\systemprofile\AppData\Local\Tailscale')  # legacy pre-1.14.4 service state
)
$existing = @($candidates | Where-Object { Test-Path -LiteralPath $_ })

Write-Host "Tailscale local data cleanup" -ForegroundColor Cyan
Write-Host "------------------------------"
if ($existing.Count -eq 0) {
    Write-Host "No Tailscale data folders found. Nothing to clean."
    exit 0
}

# 3) Stop the Tailscale service first (only if it still exists)
$svc = Get-Service -Name Tailscale -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne 'Stopped') {
    Write-Host "Stopping the Tailscale service..." -ForegroundColor Yellow
    Stop-Service -Name Tailscale -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# 4) Show exactly what will be deleted, then require explicit confirmation
Write-Host ""
Write-Host "The following Tailscale folders exist and will be DELETED:" -ForegroundColor Yellow
$existing | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "This removes local Tailscale state (settings, machine key, login state)." -ForegroundColor Yellow
Write-Host "You may need to re-register this device on your Headscale server." -ForegroundColor Yellow
$answer = Read-Host "Type DELETE to confirm (anything else cancels)"
if ($answer -cne 'DELETE') {
    Write-Host "Canceled. Nothing was deleted."
    exit 0
}

# 5) Delete ONLY the exact Tailscale-owned paths; report each result
$results = @()
foreach ($path in $existing) {
    # safety guard: the leaf folder must literally be named 'Tailscale'
    if ((Split-Path -Leaf $path) -ne 'Tailscale') { continue }
    try {
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
        $results += "DELETED : $path"
    } catch {
        $results += "FAILED  : $path  ($($_.Exception.Message))"
    }
}

Write-Host ""
Write-Host "Result:" -ForegroundColor Cyan
$results | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Done. Files locked by a running process may fail;" 
Write-Host "reboot Windows and re-run this script if anything FAILED."
```

ویژگی‌های ایمنی این اسکریپت:

- **تأیید صریح:** بدون تایپ دقیق `DELETE` هیچ چیزی حذف نمی‌شود.
- **نمایش قبل از حذف:** مسیرها را اول نشان می‌دهد.
- **فقط مسیرهای متعلق به Tailscale:** فهرست ثابت سه مسیر بالا + گارد اضافی که نام پوشهٔ نهایی حتماً `Tailscale` باشد؛ هیچ پوشهٔ والد/عمومی حذف نمی‌شود.
- **مدیریت خطا:** هر مسیر جداگانه try/catch دارد؛ فایل قفل‌شده کل عملیات را نمی‌شکند و در گزارش می‌آید.
- **گزارش عملیات:** خروجی نهایی موفق/ناموفقِ هر مسیر را فهرست می‌کند.
- **بررسی Administrator:** بدون دسترسی مدیریتی اجرا نمی‌شود.
- **توقف سرویس به روش مستند:** `Stop-Service -Name Tailscale` (نام سرویس طبق مستندات رسمی همین است) و فقط اگر سرویس هنوز موجود باشد.
- **چیزهای دست‌نخورده:** رجیستری، تنظیمات شبکهٔ ویندوز، اطلاعات سایر VPNها و فایل‌های نامرتبط — هیچ‌کدام لمس نمی‌شوند.

> **نکته اجرا:** اگر خطای «running scripts is disabled» گرفتید، سیاست اجرا را فقط برای این فایل باز کنید:
> `powershell -ExecutionPolicy Bypass -File .\Cleanup-Tailscale.ps1`

## ۱۷.۹ بررسی نتیجه پاک‌سازی

وضعیت سرویس (بعد از حذف برنامه باید «نیست» باشد):

```powershell
Get-Service Tailscale -ErrorAction SilentlyContinue
```

اگر خروجی خالی بود، سرویس نصب نیست. بررسی مسیرهای باقی‌مانده:

```powershell
Test-Path "$env:ProgramData\Tailscale"
Test-Path "$env:LOCALAPPDATA\Tailscale"
Test-Path "$env:WINDIR\System32\config\systemprofile\AppData\Local\Tailscale"
```

هر سه باید `False` برگردند.

> **صادقانه:** نبودن سرویس و این چند مسیر فایل، **به‌تنهایی اثبات نمی‌کند** تمام آثار برنامه حذف شده‌اند — نتیجه را با توجه به نسخهٔ Tailscale و روش نصب ارزیابی کنید (مثلاً نصب‌کنندهٔ MSI ممکن است فایل‌هایی در `Program Files\Tailscale` گذاشته باشد که Uninstall خودش برمی‌دارد؛ اگر آن پوشه مانده بود، از Settings ← Apps آن را Uninstall کنید و دوباره بررسی کنید). برای کاربردهای معمول (ثبت مجدد تمیز دستگاه)، همین سطح پاک‌سازی کافی است.

## ۱۷.۱۰ نصب مجدد و اتصال

پس از نصب مجدد (بخش ۱۷.۲):

```powershell
tailscale login --login-server=https://head.parande.shop
```

و بعد از تأیید/ثبت دستگاه، وضعیت را ببینید:

```powershell
tailscale status
```

با `tailscale ping` از یک دستگاه دیگر شبکه، ارتباط داخلی را تست کنید.

> ⚠️ **هشدار مهم:** حذف محلی اطلاعات دستگاه، **رکورد قبلی آن را از سرور Headscale حذف نمی‌کند**. بعد از ثبت مجدد، ممکن است رکورد تکراری (دستگاه قدیمیِ «آفلاین» + دستگاه جدید) ببینید. حذف رکورد سمت سرور را **جداگانه** و **بعد از اطمینان از هویت دستگاه** (نام، کاربر مالک، آخرین اتصال) انجام دهید: از پنل — بخش «دستگاه‌ها» ← منوی ردیف دستگاه قدیمی ← «حذف دستگاه…» ([فصل شانزدهم](16-amoozesh-panel.md)) — یا از ترمینال سرور با `hsctl devices list` و `hsctl devices delete <شناسه>`. اگر رکورد قدیمیِ روشنی را نگه دارید، مشکلی هم ندارد — فقط فهرست شلوغ می‌شود.

## خلاصه فصل

- کلاینت رسمی Tailscale بدون هیچ حساب رسمی، به Headscale شخصی وصل می‌شود: `tailscale login --login-server=https://دامنهٔ-شما`.
- `tailscale status` وضعیت شما و کل شبکه را یک‌جا نشان می‌دهد.
- سه سطح را جدا کنید: خروج (`logout`) ≠ پاک‌سازی اطلاعات محلی ≠ حذف رکورد از سرور.
- کلید از پیش تأییدشده (`--authkey`) ثبت بدون مرورگر می‌دهد؛ کلید را امن نگه دارید و طبق سیاست انقضا بسازید و در صورت لو رفتن ابطال کنید.
- حذف کامل = حذف عادی برنامه ← بررسی ← پاک‌سازی فقط مسیرهای معتبر Tailscale (`ProgramData`، `LOCALAPPDATA` و در نصب‌های خیلی قدیمی `systemprofile`) با اسکریپت ایمن ← بررسی نتیجه ← نصب مجدد و ثبت دوباره.
- رکورد دستگاه روی سرور، فقط از سمت سرور (پنل یا `hsctl`) و با بررسی هویت حذف می‌شود.

[فصل قبلی: آموزش کامل کار با پنل مدیریت](16-amoozesh-panel.md)
