@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Headscale Easy Manager — ساخت بستهٔ ویندوزی

REM ============================================================
REM  ساخت بستهٔ انتشار ویندوزی — روی «ماشین توسعه» اجرا می‌شود
REM  (نه روی سیستم کاربر). پیش‌نیاز: Bun روی ماشین ساخت.
REM
REM  ⚠️ صادقانه: این اسکریپت در محیط لینوکسی سندباکس «اجرا نشده»
REM     (قانون محیط: build ممنوع). طبق README-fa.md باید روی یک
REM     ویندوز/محیط ساخت واقعی یک‌بار اجرا و صحت‌سنجی شود —
REM     نتیجهٔ آن در گزارش تست (docs/test-report.md) ثبت می‌شود.
REM ============================================================

set "SRCDIR=%~dp0.."
cd /d "%SRCDIR%"

echo [۱/۸] نصب وابستگی‌ها…
call bun install || goto :fail

echo [۲/۸] تولید کلاینت Prisma…
call bunx prisma generate || goto :fail

echo [۳/۸] ساخت production (next build)…
call bun run build || goto :fail

echo [۴/۸] بازتولید DDL بوت‌استرپ…
bash scripts/regen-bootstrap-sql.sh 2>nul || (
  echo [هشدار] bash در دسترس نیست — از DDL موجود src/server/db/ddl.ts استفاده می‌شود.
)

echo [۵/۸] دریافت runtime مستقل (bun.exe)…
set "BUN_VER=1.3.14"
set "BUN_SHA=PLACEHOLDER_SHA256_OF_BUN_ZIP"
if not exist ".build-cache" mkdir ".build-cache"
if not exist ".build-cache\bun-windows-x64.zip" (
  curl -fsSL -o ".build-cache\bun-windows-x64.zip" "https://github.com/oven-sh/bun/releases/download/bun-v%BUN_VER%/bun-windows-x64.zip" || (
    echo [خطا] دانلود runtime ناموفق. اتصال اینترنت را بررسی و دوباره اجرا کنید.
    goto :fail
  )
)
 REM checksum (اختیاری): SHA256 را از صفحهٔ انتشار bun جایگزین PLACEHOLDER کنید
 powershell -NoProfile -Command "if ('%BUN_SHA%' -like 'PLACEHOLDER*') { exit 0 }; $h=(Get-FileHash '.build-cache\bun-windows-x64.zip' -Algorithm SHA256).Hash.ToLower(); if ($h -ne '%BUN_SHA%') { Write-Host '[خطا] checksum مربوط به runtime مطابق نیست'; exit 1 }"
if errorlevel 1 goto :fail

echo [۶/۸] مونتاژ پوشهٔ dist…
if exist "dist\headscale-easy-manager" rmdir /s /q "dist\headscale-easy-manager"
mkdir "dist\headscale-easy-manager" || goto :fail
REM هستهٔ standalone
xcopy /e /i /y ".next\standalone\*" "dist\headscale-easy-manager\" >nul || goto :fail
REM فایل‌های استاتیک و عمومی
xcopy /e /i /y ".next\static" "dist\headscale-easy-manager\.next\static\" >nul || goto :fail
if exist "public" xcopy /e /i /y "public" "dist\headscale-easy-manager\public\" >nul
REM اسکریپت‌های ویندوزی + راهنما
xcopy /e /i /y "windows\*.bat" "dist\headscale-easy-manager\" >nul || goto :fail
copy /y "windows\README-fa.md" "dist\headscale-easy-manager\" >nul
REM runtime
mkdir "dist\headscale-easy-manager\runtime" >nul
powershell -NoProfile -Command "Expand-Archive -Force '.build-cache\bun-windows-x64.zip' '.build-cache\bun-extract'; Copy-Item '.build-cache\bun-extract\*\bun.exe' 'dist\headscale-easy-manager\runtime\bun.exe' -Force" || goto :fail

echo [۷/۸] پاکسازی امنیتی — بدون secret/.env/کش…
del /q "dist\headscale-easy-manager\.env" >nul 2>&1
del /q "dist\headscale-easy-manager\.env.*" >nul 2>&1
del /q "dist\headscale-easy-manager\db\*.db" >nul 2>&1
if exist "dist\headscale-easy-manager\node_modules\.prisma" rmdir /s /q "dist\headscale-easy-manager\node_modules\.cache" >nul 2>&1

echo [۸/۸] ساخت zip نهایی…
if exist "dist\headscale-easy-manager-win-x64.zip" del /q "dist\headscale-easy-manager-win-x64.zip"
powershell -NoProfile -Command "Compress-Archive -Path 'dist\headscale-easy-manager\*' -DestinationPath 'dist\headscale-easy-manager-win-x64.zip' -Force" || goto :fail
powershell -NoProfile -Command "(Get-FileHash 'dist\headscale-easy-manager-win-x64.zip' -Algorithm SHA256).Hash.ToLower() | Out-File -Encoding ascii 'dist\headscale-easy-manager-win-x64.zip.sha256'"

echo.
echo ✔ بسته آماده است: dist\headscale-easy-manager-win-x64.zip (+ .sha256)
echo   حجم: 
powershell -NoProfile -Command "Write-Host ('{0:N1} MB' -f ((Get-Item 'dist\headscale-easy-manager-win-x64.zip').Length/1MB))"
echo.
echo یادآوری صادقانه: این بسته باید یک‌بار روی ویندوز واقعی نصب و صحت‌سنجی شود
echo (طبق docs/test-report.md — بخش «تست‌های اجرانشده»).
exit /b 0

:fail
echo [خطا] ساخت بسته ناموفق بود — پیام بالا را ببینید.
exit /b 1
