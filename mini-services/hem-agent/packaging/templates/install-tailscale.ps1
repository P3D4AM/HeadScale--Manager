# Headscale Easy Manager - OFFLINE Tailscale installer (bundled)
# Installs the official Tailscale MSI that ships inside this package, so the
# target Windows machine does NOT need winget or internet access.
# Run:  powershell -ExecutionPolicy Bypass -File .\install-tailscale.ps1
# Options:
#   -Interactive : show the normal Tailscale installer UI instead of a silent install
# Note: the Tailscale MSI installs a system service, so this script asks for
# Administrator via the Windows UAC prompt (the manager itself never needs it).
param(
    [switch]$Interactive,
    [switch]$Elevated
)
$ErrorActionPreference = 'Stop'

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$msiDir = Join-Path $src 'vendor\tailscale'

if (-not $Elevated) {
    # Re-launch ourselves elevated (UAC) and wait for the install to finish.
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Host 'Administrator is required to install the Tailscale system service.'
        Write-Host 'Asking Windows for permission (UAC prompt) ...'
        $args = @('-ExecutionPolicy','Bypass','-NoProfile','-File',('"{0}"' -f $PSCommandPath),'-Elevated')
        if ($Interactive) { $args += '-Interactive' }
        $p = Start-Process -FilePath 'powershell.exe' -ArgumentList ($args -join ' ') -Verb RunAs -PassThru -Wait
        if ($p.ExitCode -eq 0) {
            Write-Host ''
            Write-Host 'Tailscale installed (offline, from this package).' -ForegroundColor Green
            Write-Host 'Next step: connect to your server - see README-WINDOWS-FA.txt,'
            Write-Host 'section "Tailscale" (chapter 17 of the guide inside the manager).'
        } else {
            Write-Host ''
            Write-Host "Tailscale install did not finish (exit code $($p.ExitCode))." -ForegroundColor Red
            Write-Host 'If you cancelled the UAC prompt, simply run this script again.'
        }
        exit $p.ExitCode
    }
}

# Locate the bundled MSI (exact name is pinned by the build; accept any
# tailscale-setup-*-amd64.msi in vendor\tailscale for forward compatibility).
if (-not (Test-Path $msiDir)) {
    Write-Host "ERROR: '$msiDir' not found." -ForegroundColor Red
    Write-Host 'This script must stay in the Headscale Easy Manager folder'
    Write-Host 'next to the vendor\tailscale folder it ships with.'
    exit 1
}
$msi = Get-ChildItem -Path $msiDir -Filter 'tailscale-setup-*-amd64.msi' |
    Sort-Object Name -Descending | Select-Object -First 1
if (-not $msi) {
    Write-Host "ERROR: no tailscale-setup-*-amd64.msi inside '$msiDir'." -ForegroundColor Red
    exit 1
}
Write-Host "Bundled installer: $($msi.FullName)"
Write-Host "Size: $([math]::Round($msi.Length / 1MB, 1)) MB"

# Honest pre-check: an existing installation is upgraded in place by the MSI.
$existing = Get-Service Tailscale -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Tailscale is already installed (service: $($existing.Status))."
    Write-Host 'The MSI will upgrade/repair it in place; your login and settings are kept.'
}

$log = Join-Path $env:TEMP ('hem-tailscale-install-{0}.log' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
if ($Interactive) {
    Write-Host 'Running the Tailscale installer with its normal UI ...'
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList ('/i "{0}" /norestart' -f $msi.FullName) -Wait -PassThru
} else {
    Write-Host 'Installing Tailscale silently (this takes a minute) ...'
    $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList ('/i "{0}" /qn /norestart /l*v "{1}"' -f $msi.FullName, $log) -Wait -PassThru
}

if ($p.ExitCode -ne 0) {
    Write-Host ''
    Write-Host "msiexec failed with exit code $($p.ExitCode) (3010 = reboot required)." -ForegroundColor Red
    if (-not $Interactive) { Write-Host "Full MSI log: $log" }
    exit $p.ExitCode
}

# Post-install verification - the Tailscale service must exist.
$svc = Get-Service Tailscale -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host ''
    Write-Host 'The MSI reported success, but the Tailscale service was not found.' -ForegroundColor Red
    Write-Host 'Reboot Windows once (some service installs need it) and check again with:'
    Write-Host '  Get-Service Tailscale'
    exit 1
}

Write-Host ''
Write-Host 'Tailscale service: ' -NoNewline
Write-Host $svc.Status -ForegroundColor Green
$tsExe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (Test-Path $tsExe) {
    Write-Host 'Installed version:'
    & $tsExe version | Select-Object -First 1
}
Write-Host ''
Write-Host 'Install log (silent mode):' $log
Write-Host ''
Write-Host 'NEXT STEP - connect to your Headscale server (see chapter 17 of the'
Write-Host 'guide inside the manager UI, or README-WINDOWS-FA.txt):'
Write-Host '  tailscale login --login-server=https://YOUR_SERVER_URL'
exit 0
