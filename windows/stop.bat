@echo off
setlocal
chcp 65001 >nul
title Headscale Easy Manager — توقف

echo [i] توقف سرور محلی…
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bun.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
if errorlevel 1 (
  echo [i] نمونهٔ فعالی یافت نشد — چیزی برای توقف نیست.
) else (
  echo ✔ سرور متوقف شد.
)
timeout /t 1 /nobreak >nul
exit /b 0
