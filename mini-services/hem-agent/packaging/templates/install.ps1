# Headscale Easy Manager - Windows installer
# No Administrator required; copies to %LOCALAPPDATA% and creates shortcuts.
# Run:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'HeadscaleEasyManager'
$exe  = Join-Path $dest 'hem-manager.exe'

Write-Host "Installing Headscale Easy Manager from: $src"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path "$src\*" -Destination $dest -Recurse -Force
Remove-Item (Join-Path $dest 'install.ps1'), (Join-Path $dest 'uninstall.ps1') -Force -ErrorAction SilentlyContinue

# Stop a running instance launched from the destination folder (if any)
Get-Process hem-manager -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like "$dest*" } | Stop-Process -Force -ErrorAction SilentlyContinue

# Shortcuts - WScript.Shell (no Administrator needed)
$ws        = New-Object -ComObject WScript.Shell
$desktop   = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

$lnk = $ws.CreateShortcut((Join-Path $desktop 'Headscale Easy Manager.lnk'))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.Description = 'Headscale Easy Manager'
$lnk.Save()

$lnk2 = $ws.CreateShortcut((Join-Path $startMenu 'Headscale Easy Manager.lnk'))
$lnk2.TargetPath = $exe
$lnk2.WorkingDirectory = $dest
$lnk2.Description = 'Headscale Easy Manager'
$lnk2.Save()

Write-Host ''
Write-Host 'Installation complete.' -ForegroundColor Green
Write-Host "  Install path : $dest"
Write-Host '  Shortcuts    : Desktop and Start Menu ("Headscale Easy Manager")'
Write-Host ''
Write-Host 'Uninstall: powershell -ExecutionPolicy Bypass -File .\uninstall.ps1'
Write-Host 'Honest note: on first run Windows SmartScreen may show a warning -'
Write-Host '  click "More info" and then "Run anyway" (the app has no digital signature).'
