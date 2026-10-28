@echo off
setlocal
chcp 65001 >nul
title Headscale Easy Manager — حذف

echo ============================================================
echo   حذف Headscale Easy Manager
echo ============================================================
echo.
echo این عملیات:
echo   • میان‌برهای دسکتاپ/منوی استارت را حذف می‌کند
echo   • پوشهٔ برنامه را حذف می‌کند
echo داده‌های شما (پروفایل سرورها/لاگ) در:
echo   %%LOCALAPPDATA%%\headscale-easy-manager
echo باقی می‌ماند و حذف نمی‌شود (برای حذف کامل، آن پوشه را دستی پاک کنید).
echo.
set /p CONFIRM=ادامه دهید؟ (y/n):
if /i not "%CONFIRM%"=="y" (
  echo لغو شد.
  exit /b 0
)

echo [۱/۳] توقف سرویس…
call "%~dp0stop.bat" >nul 2>&1

echo [۲/۳] حذف میان‌برها…
powershell -NoProfile -Command ^
  "Remove-Item -Force ([IO.Path]::Combine($env:USERPROFILE,'Desktop','Headscale Easy Manager.lnk')) -ErrorAction SilentlyContinue; $sp=[Environment]::GetFolderPath('Programs'); Remove-Item -Force ([IO.Path]::Combine($sp,'Headscale Easy Manager.lnk')) -ErrorAction SilentlyContinue" >nul 2>&1

echo [۳/۳] حذف پوشهٔ برنامه…
cd /d "%TEMP%"
rmdir /s /q "%~dp0" 2>nul
echo.
echo ✔ حذف انجام شد. داده‌ها در %%LOCALAPPDATA%%\headscale-easy-manager باقی است.
pause
exit /b 0
