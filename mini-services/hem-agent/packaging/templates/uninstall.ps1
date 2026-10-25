# Headscale Easy Manager - Windows uninstaller
# Removes only the Windows app; your server and its data are never touched.
# Run:  powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
$ErrorActionPreference = 'SilentlyContinue'
$dest = Join-Path $env:LOCALAPPDATA 'HeadscaleEasyManager'

# 1) Shortcuts
$desktop   = [Environment]::GetFolderPath('Desktop')
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
Remove-Item (Join-Path $desktop 'Headscale Easy Manager.lnk') -Force
Remove-Item (Join-Path $startMenu 'Headscale Easy Manager.lnk') -Force

# 2) Stop the running app
Get-Process hem-manager | Stop-Process -Force

# 3) Remove the folder (retry via cmd after a few seconds if files are still locked)
if (Test-Path $dest) {
  Remove-Item $dest -Recurse -Force
  if (Test-Path $dest) {
    Start-Process cmd -WindowStyle Hidden -ArgumentList "/c timeout /t 3 /nobreak >nul & rd /s /q `"$dest`""
  }
}
Write-Host 'Uninstalled. (Removing the Windows app changes nothing on your server.)' -ForegroundColor Green
