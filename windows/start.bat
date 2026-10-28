@echo off
setlocal
chcp 65001 >nul
title Headscale Easy Manager — اجرا

REM ============================================================
REM  اجرای پنل روی همین سیستم (فقط loopback — از اینترنت قابل‌دسترس نیست)
REM ============================================================

set "APPDIR=%~dp0"
cd /d "%APPDIR%"
set "RUNTIME=%APPDIR%runtime\bun.exe"
if not exist "%RUNTIME%" (
  echo [خطا] runtime\bun.exe پیدا نشد. بستهٔ انتشار را دوباره دریافت کنید.
  pause
  exit /b 1
)

REM توقف نمونهٔ قبلی (اگر هست) — restart خودکار
tasklist /fi "imagename eq bun.exe" 2>nul | find /i "bun.exe" >nul
if not errorlevel 1 (
  echo [i] توقف نمونهٔ قبلی…
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bun.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
  timeout /t 1 /nobreak >nul
)

echo [i] راه‌اندازی سرور محلی (۱۲۷.۰.۰.۱:۳۰۰۰)…
set "HOSTNAME=127.0.0.1"
set "PORT=3000"
set "NODE_ENV=production"

start "" /min cmd /c ""%RUNTIME%" "%APPDIR%server.js" > "%APPDIR%server.log" 2>&1"

REM انتظار برای بالا آمدن (حداکثر ~۳۰ ثانیه)
set /a tries=0
:waitloop
set /a tries+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/panel/servers' -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
  if %tries% lss 15 (
    timeout /t 2 /nobreak >nul
    goto waitloop
  )
  echo [خطا] سرور بالا نیامد. آخرین خطاها:
  type "%APPDIR%server.log" 2>nul | more
  echo.
  echo راهنمای رفع خطا در README-fa.md (بخش عیب‌یابی) آمده است.
  pause
  exit /b 1
)

echo [i] سرور آماده است — باز کردن مرورگر…
start "" http://localhost:3000/
exit /b 0
