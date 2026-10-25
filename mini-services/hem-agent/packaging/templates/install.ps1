# نصب «مدیر آسان هداسکیل» — Headscale Easy Manager
# بدون نیاز به Administrator؛ کپی به %LOCALAPPDATA% + میانبرها.
# اجرا:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'HeadscaleEasyManager'
$exe  = Join-Path $dest 'hem-manager.exe'

Write-Host "نصب مدیر آسان هداسکیل از: $src"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path "$src\*" -Destination $dest -Recurse -Force
Remove-Item (Join-Path $dest 'install.ps1'), (Join-Path $dest 'uninstall.ps1') -Force -ErrorAction SilentlyContinue

# بستن نمونهٔ در حال اجرا از مقصد (در صورت وجود)
Get-Process hem-manager -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$dest*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# میانبرها — WScript.Shell (بدون نیاز به Administrator)
$ws        = New-Object -ComObject WScript.Shell
$desktop   = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

$lnk = $ws.CreateShortcut((Join-Path $desktop 'Headscale Easy Manager.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.Description = 'مدیر آسان هداسکیل — Headscale Easy Manager'
$lnk.Save()

$lnk2 = $ws.CreateShortcut((Join-Path $startMenu 'Headscale Easy Manager.lnk'))
$lnk2.TargetPath = $exe
$lnk2.WorkingDirectory = $dest
$lnk2.Description = 'مدیر آسان هداسکیل — Headscale Easy Manager'
$lnk2.Save()

Write-Host ''
Write-Host 'نصب کامل شد.' -ForegroundColor Green
Write-Host "  مسیر نصب   : $dest"
Write-Host '  میانبرها   : دسکتاپ و منوی استارت («Headscale Easy Manager»)'
Write-Host ''
Write-Host 'حذف برنامه: powershell -ExecutionPolicy Bypass -File .\uninstall.ps1'
Write-Host 'یادآوری صادقانه: نخستین اجرا ممکن است SmartScreen ویندوز پیام بدهد —'
Write-Host '  «More info» و سپس «Run anyway» (برنامه امضای دیجیتال ندارد).'
