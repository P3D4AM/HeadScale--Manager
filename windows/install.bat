@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title Headscale Easy Manager — نصب

REM ============================================================
REM  Headscale Easy Manager — نصب‌کنندهٔ ویندوزی
REM  این اسکریپت داخل بستهٔ ازپیش‌ساخته (dist) اجرا می‌شود؛
REM  نیازی به WSL/لینوکس/داکر/پایتون نیست. زمان اجرا:
REM  bun.exe داخل پوشهٔ runtime\ بسته موجود است.
REM  بوت‌استرپ دیتابیس در اولین اجرای سرور خودکار است.
REM ============================================================

set "APPDIR=%~dp0"
cd /d "%APPDIR%"
set "RUNTIME=%APPDIR%runtime\bun.exe"
if not exist "%RUNTIME%" (
  echo [خطا] runtime\bun.exe پیدا نشد — بستهٔ انتشار ناقص است.
  echo         مجدداً بسته را از منبع رسمی دریافت کنید.
  pause
  exit /b 1
)

echo [۱/۳] بررسی پیش‌نیازها…
ver | findstr /r "10\. [0-9]*\." >nul 2>&1
if errorlevel 1 (
  echo [هشدار] ویندوز ۱۰+ توصیه می‌شود؛ در ویندوز قدیمی ممکن است همهٔ اجزا کار نکنند.
)

echo [۲/۳] ساخت ساختار دادهٔ کاربر…
set "DATADIR=%LOCALAPPDATA%\headscale-easy-manager"
if not exist "%DATADIR%" mkdir "%DATADIR%" >nul 2>&1
if not exist "%DATADIR%" (
  echo [خطا] ساخت پوشهٔ داده ناموفق: %DATADIR%
  pause
  exit /b 1
)

echo [۳/۳] ساخت میان‌برها…
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $lnk = $ws.CreateShortcut([IO.Path]::Combine($env:USERPROFILE,'Desktop','Headscale Easy Manager.lnk')); $lnk.TargetPath = '%APPDIR%start.bat'; $lnk.WorkingDirectory = '%APPDIR%'; $lnk.IconLocation = '%APPDIR%runtime\bun.exe,0'; $lnk.Description = 'پنل مدیریت Headscale'; $lnk.Save()" >nul 2>&1
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; $sp = [Environment]::GetFolderPath('Programs'); $lnk = $ws.CreateShortcut([IO.Path]::Combine($sp,'Headscale Easy Manager.lnk')); $lnk.TargetPath = '%APPDIR%start.bat'; $lnk.WorkingDirectory = '%APPDIR%'; $lnk.IconLocation = '%APPDIR%runtime\bun.exe,0'; $lnk.Save()" >nul 2>&1

echo.
echo ✔ نصب کامل شد.
echo   • اجرا: میان‌بر دسکتاپ/منوی استارت یا start.bat
echo   • پنل: http://localhost:3000  (فقط روی همین سیستم — loopback)
echo   • داده‌ها: %DATADIR%
echo   • راهنمای فارسی: README-fa.md
echo.
echo اولین اجرا کمی طول می‌کشد (بوت‌استرپ دیتابیس خودکار است) و مرورگر خودکار باز می‌شود.
pause
exit /b 0
