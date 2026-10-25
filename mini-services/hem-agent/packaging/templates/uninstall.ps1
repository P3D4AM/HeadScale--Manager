# حذف «مدیر آسان هداسکیل» — فقط برنامهٔ خودِ ویندوز؛ سرور و داده‌های شما دست‌نخورده می‌مانند.
# اجرا:  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
$ErrorActionPreference = 'SilentlyContinue'
$dest = Join-Path $env:LOCALAPPDATA 'HeadscaleEasyManager'

# ۱) میانبرها
$desktop   = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Remove-Item (Join-Path $desktop 'Headscale Easy Manager.lnk') -Force
Remove-Item (Join-Path $startMenu 'Headscale Easy Manager.lnk') -Force

# ۲) بستن برنامهٔ در حال اجرا
Get-Process hem-manager | Stop-Process -Force

# ۳) حذف پوشه (اگر فایل هنوز قفل بود، حذف با چند ثانیه تأخیر)
if (Test-Path $dest) {
  Remove-Item $dest -Recurse -Force
  if (Test-Path $dest) {
    Start-Process cmd -WindowStyle Hidden -ArgumentList "/c timeout /t 3 /nobreak >nul & rd /s /q `"$dest`""
  }
}
Write-Host 'برنامه حذف شد. (حذف برنامهٔ ویندوزی هیچ چیزی روی سرور شما تغییر نمی‌دهد.)' -ForegroundColor Green
