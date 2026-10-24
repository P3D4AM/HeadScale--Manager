#!/usr/bin/env bash
# ============================================================================
# build-windows.sh — ساخت بستهٔ ویندوزی «مدیر آسان هداسکیل» (Headscale Easy Manager)
# ----------------------------------------------------------------------------
# ورودی‌ها:
#   UI_OUT (env, اختیاری)  — پوشهٔ حاوی خروجی استاتیک Next.js (out/) برای UI.
#                            اگر خالی/غایب باشد، همین اسکریپت UI را می‌سازد
#                            (کپی بی‌اثرِ پروژهٔ بیرونی به /tmp + bunx next build).
#                            «مسیر 7-a» (اسکریپت release/تولید مستندات) نیز می‌تواند
#                            همین ورودی را تأمین کند — هر دو روش پشتیبانی می‌شوند.
#   HEM_VERSION (env, اختیاری) — پیش‌فرض: فیلد version در package.json.
#
# خروجی‌ها (زیر packaging/dist/):
#   hem-manager/                    محتوای پوشهٔ برنامهٔ ویندوزی:
#     ├─ hem-manager.exe            باینری agent (bun --compile، cross-compile ویندوز)
#     ├─ ui/                         رابط وب فارسی (استاتیک؛ exe آن را سرو می‌کند)
#     ├─ README-WINDOWS-FA.txt       راهنمای سریع فارسی
#     ├─ install.ps1                 نصب (LOCALAPPDATA + میانبرها، بدون Administrator)
#     └─ uninstall.ps1               حذف
#   linux-verify/hem-manager         باینری لینوکس همان سورس — «واقعاً اجرا» و
#                                    راستی‌آزمایی می‌شود (پایین)؛ دلیل: exe ویندوزی
#                                    در این لینوکس‌باکس اجرا نمی‌شود؛ باینری لینوکسی
#                                    از «همان سورس» کامپایل شده و زنده آزموده می‌شود
#                                    (صادقانه: این جایگزینِ آزمون روی خودِ ویندوز نیست).
#   HeadscaleEasyManager-v<VER>-win64.zip (+ .sha256)
#
# راستی‌آزمایی زندهٔ باینری لینوکسی (هر بار اجرای اسکریپت):
#   ۱) /?token=… → Set-Cookie hem_token + index.html (نشانگر فارسی) — no-store
#   ۲) assetها با mime درست (svg/css/js) + fallback SPA برای مسیر ناشناخته
#   ۳) /api/health با کوکی (بدون هدر) → 200؛ بدون توکن → 401
#   ۴) اتصال SSH واقعی به سرور آزمایشی 127.0.0.1:2222 (کاربر z / رمز hemtest-pass):
#      جریان کامل TOFU (fingerprint-required → confirm → connected) + exec واقعی
#      (console allowlist: df -h) + probe واقعی — یعنی ssh2ِ داخل باینری کامپایل‌شده کار می‌کند.
#
# یادداشت‌های فنی (انحراف‌های موجه):
#   • node_modules با «hardlink» (cp -al) به کپی /tmp وصل می‌شود نه symlink —
#     Turbopack سیم‌لینک به بیرون از ریشهٔ build را رد می‌کند (خطای واقعی).
#   • پچ‌های UI فقط «درون کپی» اعمال می‌شوند (output:export، تبدیل docs API به
#     force-static + generateStaticParams، جابه‌جایی /api/docs → /api/docs-index به
#     دلیل برخورد مسیر فایل/پوشه در static export). وقتی مسیر 7-a (next.config
#     static + scripts/generate-docs.ts) فرود کند، این پچ‌ها بی‌اثر/بدون‌تغییر می‌مانند.
#   • packaging/dist در گیت ignore نمی‌شود — mini-services خودش مخزن گیت نیست و
#     پروژهٔ بیرونی هم track نمی‌شود (توصیهٔ مأموریت: skip).
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                       # mini-services/hem-agent
OUTER_DIR="$(cd "$AGENT_DIR/../.." && pwd)"                     # ریشهٔ پروژهٔ بیرونی (Next.js app)
VERSION="${HEM_VERSION:-$(grep -m1 '"version"' "$AGENT_DIR/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
UI_OUT="${UI_OUT:-$AGENT_DIR/ui-out}"
DIST="$SCRIPT_DIR/dist"
STAGE="$DIST/hem-manager"
LINUX_DIR="$DIST/linux-verify"
ZIP_NAME="HeadscaleEasyManager-v$VERSION-win64.zip"
ZIP="$DIST/$ZIP_NAME"
HEM_UI_PORT=3015

log()  { printf '\033[1;36m[build-windows]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[build-windows] خطا:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$AGENT_DIR/index.ts" ] || fail "index.ts در $AGENT_DIR پیدا نشد."
[ -d "$OUTER_DIR/src/app" ]  || fail "پروژهٔ بیرونی (Next.js) در $OUTER_DIR پیدا نشد."
log "نسخه: $VERSION | agent: $AGENT_DIR | پروژهٔ بیرونی: $OUTER_DIR"

# ----------------------------------------------------------------------------
# ۰) در صورت فرود مسیر 7-a: تولید مستندات build-time (امروز اختیاری/بی‌اثر)
# ----------------------------------------------------------------------------
if grep -q '"docs:generate"' "$OUTER_DIR/package.json" 2>/dev/null; then
  log "scripts/generate-docs.ts فرود کرده — اجرای bun run docs:generate (مسیر 7-a)"
  (cd "$OUTER_DIR" && bun run docs:generate) || fail "docs:generate شکست خورد."
else
  log "docs:generate هنوز فرود نکرده (مسیر 7-a) — فصل‌ها در زمان build از docs/fa خوانده می‌شوند."
fi

# ----------------------------------------------------------------------------
# ۱) UI استاتیک — از UI_OUT آماده، یا ساخت خودکار در /tmp
# ----------------------------------------------------------------------------
build_ui() {
  local work="/tmp/hem-ui-build-$(date +%s)-$$"
  log "ساخت UI استاتیک در $work …"
  mkdir -p "$work"
  tar -C "$OUTER_DIR" -cf - \
    --exclude=node_modules --exclude=.next --exclude=.git \
    --exclude=download --exclude=upload --exclude=dev.log --exclude=agent-ctx \
    --exclude='mini-services/*/node_modules' --exclude=db --exclude=tool-results \
    . | tar -C "$work" -xf -

  # node_modules با hardlink (Turbopack symlink به بیرون از ریشهٔ build را رد می‌کند)
  if ! cp -al "$OUTER_DIR/node_modules" "$work/node_modules" 2>/dev/null; then
    log "hardlink ممکن نشد — کپی کامل node_modules (کندتر)"
    cp -a "$OUTER_DIR/node_modules" "$work/node_modules"
  fi

  # ---- پچ‌های فقط-درون-کپی -------------------------------------------------
  # next.config: اگر static export هنوز تنظیم نشده (مسیر 7-a هنوز فرود نکرده)
  if ! grep -q 'output: "export"' "$work/next.config.ts"; then
    log "پچ کپی: next.config → static export (تا وقتی 7-a خودش تنظیمش کند)"
    cat > "$work/next.config.ts" <<'EOF'
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: true },
  reactStrictMode: false,
};

export default nextConfig;
EOF
  fi

  # مسیر hello قالب — در بستهٔ دسکتاپ، /api متعلق به agent است
  rm -f "$work/src/app/api/route.ts"

  # docs API: force-dynamic → force-static + generateStaticParams؛ و جابه‌جایی
  # فهرست به /api/docs-index (برخورد فایل/پوشه در static export — out/api/docs)
  if [ -f "$work/src/app/api/docs/route.ts" ]; then
    log "پچ کپی: docs API → force-static + انتقال فهرست به /api/docs-index"
    sed -i "s/export const dynamic = 'force-dynamic'/export const dynamic = 'force-static'/" \
      "$work/src/app/api/docs/route.ts" "$work/src/app/api/docs/[slug]/route.ts"
    mkdir -p "$work/src/app/api/docs-index"
    mv "$work/src/app/api/docs/route.ts" "$work/src/app/api/docs-index/route.ts"
    cat >> "$work/src/app/api/docs/[slug]/route.ts" <<'EOF'

// Static export: پیش‌تولید همهٔ slugهای فصل (فقط در کپیِ بسته‌بندی)
export async function generateStaticParams() {
  const fs = await import('node:fs/promises')
  try {
    const files = await fs.readdir(DOCS_FA_DIR)
    return files.filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, '') }))
  } catch {
    return []
  }
}
EOF
    sed -i "s|fetch('/api/docs')|fetch('/api/docs-index')|" \
      "$work/src/components/home/sections/learn-section.tsx"
  fi

  (cd "$work" && bunx next build) || fail "next build شکست خورد."
  [ -f "$work/out/index.html" ] || fail "out/index.html ساخته نشد."
  rm -rf "$UI_OUT"
  mkdir -p "$(dirname "$UI_OUT")"
  cp -a "$work/out" "$UI_OUT"
  rm -rf "$work"
  log "UI آماده شد: $UI_OUT ($(du -sh "$UI_OUT" | cut -f1))"
}

if [ -f "$UI_OUT/index.html" ]; then
  log "UI آماده در $UI_OUT (ورودی UI_OUT) — ساخت مجدد لازم نیست."
else
  build_ui
fi

# ----------------------------------------------------------------------------
# ۲) استیج پوشهٔ برنامهٔ ویندوزی
# ----------------------------------------------------------------------------
log "استیج $STAGE …"
rm -rf "$STAGE"
mkdir -p "$STAGE/ui"
cp -a "$UI_OUT/." "$STAGE/ui/"

log "کامپایل exe ویندوزی (bun --compile --target=bun-windows-x64) …"
bun build --compile --target=bun-windows-x64 "$AGENT_DIR/index.ts" \
  --outfile "$STAGE/hem-manager.exe" >/dev/null || fail "کامپایل exe ویندوزی شکست خورد."
[ -f "$STAGE/hem-manager.exe" ] || fail "hem-manager.exe ساخته نشد."

cat > "$STAGE/README-WINDOWS-FA.txt" <<'EOF'
================================================================
  مدیر آسان هداسکیل — Headscale Easy Manager
  نسخهٔ 0.3.0 — راهنمای سریع ویندوز (فارسی)
================================================================

این بسته چه چیزی است؟
  یک برنامهٔ ویندوزی کوچک که روی «کامپیوتر شما» اجرا می‌شود و از طریق
  SSH واقعی، سرور هداسکیلِ شما (اوبونتو) را مدیریت می‌کند. رابط کاربری
  فارسی، همین‌جا در مرورگر خودتان (127.0.0.1:3005) باز می‌شود.
  هیچ پورتی به اینترنت باز نمی‌شود و نیازی به Administrator نیست.

محتویات:
  hem-manager.exe   برنامهٔ اصلی (اجرا مستقیم، بدون نصب)
  ui\               رابط وب فارسی (داخلی — دست نزنید)
  install.ps1       نصب اختیاری در %LOCALAPPDATA% + میانبر دسکتاپ/منوی استارت
  uninstall.ps1     حذف کامل برنامه از ویندوز
  README-WINDOWS-FA.txt   همین راهنما

----------------------------------------------------------------
۱) اجرا (بدون نصب)
----------------------------------------------------------------
  فایل hem-manager.exe را دابل‌کلیک کنید (یا از PowerShell اجرا کنید).
  مرورگر پیش‌فرض با نشانی http://127.0.0.1:3005/?token=... باز می‌شود.
  اگر مرورگر باز نشد، همان نشانیِ چاپ‌شده در پنجرهٔ برنامه را دستی باز کنید.

  هشدار SmartScreen ویندوز («Windows protected your PC»):
    چون این برنامه امضای دیجیتال (Code Signing) ندارد، ویندوز پیش‌فرض
    اجازهٔ اجرا نمی‌دهد. روی «More info» و بعد «Run anyway» بزنید.
    این پیام طبیعی است؛ فایل‌های .sha256 کنار بستهٔ zip برای مقایسهٔ
    دستی SHA-256 هستند. آموزش کامل: فصل ۱۵ مستندات (hsctl learn 15).

----------------------------------------------------------------
۲) اولین اتصال به سرور
----------------------------------------------------------------
  در برنامه، بخش «اتصال» → «اتصال سریع» را باز کنید و بدهید:
    آدرس سرور (IP) ، پورت SSH (پیش‌فرض 22) ، نام کاربری لینوکس،
    و یکی از دو روش: رمز عبور یا مسیر فایل کلید SSH.
  بار اول، برنامه «اثر انگشت» سرور را نشان می‌دهد (SHA256/MD5) —
  با ssh-keygen روی سرور مقایسه کنید و تأیید کنید. معنی این تأیید و
  هشدار «کلید میزبان تغییر کرده» در فصل ۱۵ توضیح داده شده است.

  فایل کلید SSH در ویندوز معمولاً اینجاست:
    %USERPROFILE%\.ssh\id_ed25519   (کلید PuTTY با پسوند .ppk مستقیم
    خوانده نمی‌شود؛ در PuTTYgen با Export OpenSSH key تبدیلش کنید.)

----------------------------------------------------------------
۳) نصب اختیاری (میانبر در دسکتاپ و منوی استارت)
----------------------------------------------------------------
  PowerShell را در همین پوشه باز کنید و بزنید:
    powershell -ExecutionPolicy Bypass -File .\install.ps1
  برنامه به %LOCALAPPDATA%\HeadscaleEasyManager کپی می‌شود و دو میانبر
  ساخته می‌شود. حذف کامل: powershell -ExecutionPolicy Bypass -File .\uninstall.ps1

----------------------------------------------------------------
۴) موارد بیشتر
----------------------------------------------------------------
  • ذخیرهٔ امن رمز: تیک «ذخیرهٔ امن» رمز را در Windows Credential Manager
    نگه می‌دارد (فقط اگر خودتان بخواهید). بدون تیک، رمز فقط در حافظه است.
  • بخش «نصب سرور» همان ویزارد ۵ مرحله‌ای است (بررسی → تنظیمات →
    Dry-Run → اجرا → نتیجهٔ صادقانه). اگر سرور sudo داشته باشد پیش
    می‌رود؛ وگرنه صادقانه در «نیاز به sudo» متوقف می‌شود.
  • مرجع کامل: فصل ۱۵ مستندات فارسی، در خود برنامه (بخش آموزش) یا
    روی سرور: hsctl learn 15

  صادقانه: بستهٔ exe از همان سورس، برای ویندوز کامپایل شده است؛
  در محیط ساخت، «باینری لینوکسیِ همان سورس» به‌صورت زنده آزموده می‌شود.
EOF

cat > "$STAGE/install.ps1" <<'EOF'
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
EOF

cat > "$STAGE/uninstall.ps1" <<'EOF'
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
EOF

# ----------------------------------------------------------------------------
# ۳) باینری لینوکسی همان سورس + راستی‌آزمایی زندهٔ کامل
# ----------------------------------------------------------------------------
log "کامپایل باینری لینوکسی برای راستی‌آزمایی زنده …"
rm -rf "$LINUX_DIR"
mkdir -p "$LINUX_DIR"
cp -a "$STAGE/ui" "$LINUX_DIR/ui"
bun build --compile --target=bun-linux-x64 "$AGENT_DIR/index.ts" \
  --outfile "$LINUX_DIR/hem-manager" >/dev/null || fail "کامپایل باینری لینوکسی شکست خورد."
chmod +x "$LINUX_DIR/hem-manager"

# سرور SSH آزمایشی باید روشن باشد (127.0.0.1:2222) — اگر نبود، روشنش کن
started_demo=0
if ! (ss -tulpn 2>/dev/null | grep -q '127.0.0.1:2222'); then
  log "سرور SSH آزمایشی روشن نیست — راه‌اندازی …"
  (cd "$AGENT_DIR" && setsid bun run test/server.ts >> test-server.log 2>&1 &)
  for i in $(seq 1 40); do (ss -tulpn 2>/dev/null | grep -q '127.0.0.1:2222') && break; sleep 0.25; done
  started_demo=1
fi
(ss -tulpn 2>/dev/null | grep -q '127.0.0.1:2222') || fail "سرور SSH آزمایشی 2222 بالا نیامد."

VERIFY_HOME="$LINUX_DIR/verify-home"
VERIFY_LOG="$LINUX_DIR/verify.log"
rm -rf "$VERIFY_HOME"
log "اجرای باینری لینوکسی روی پورت $HEM_UI_PORT (HEM_DESKTOP=1، home تازه) …"
HEM_AGENT_PORT=$HEM_UI_PORT HEM_DESKTOP=1 HEM_AGENT_HOME="$VERIFY_HOME" \
  "$LINUX_DIR/hem-manager" > "$VERIFY_LOG" 2>&1 &
BIN_PID=$!

cleanup_bin() {
  kill "$BIN_PID" 2>/dev/null || true
  wait "$BIN_PID" 2>/dev/null || true
}
trap cleanup_bin EXIT

for i in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$HEM_UI_PORT/api/health" && break
  sleep 0.25
done

TOKEN="$(grep -oE 'token=[0-9a-f]+' "$VERIFY_LOG" | head -1 | cut -d= -f2)"
[ -n "$TOKEN" ] || { cat "$VERIFY_LOG" >&2; fail "توکن دسکتاپ در لاگ پیدا نشد."; }
log "توکن دسکتاپ استخراج شد: ${TOKEN:0:8}… (کامل در verify.log)"

errors=0
chk() { # chk <شرح> <کد موفقیت 0/1>
  if [ "$2" = 0 ]; then log "  [OK]   $1"; else log "  [شکست] $1"; errors=$((errors+1)); fi
}

# --- ۱) /?token= → Set-Cookie + index.html فارسی
head_root="$(mktemp)"; head_hdr="$(mktemp)"
curl -s -o "$head_root" -D "$head_hdr" "http://127.0.0.1:$HEM_UI_PORT/?token=$TOKEN" -w '%{http_code}' > "$LINUX_DIR/http_code.txt"
code="$(cat "$LINUX_DIR/http_code.txt")"
r=0; grep -qi '^set-cookie: *hem_token=' "$head_hdr" || r=1
chk "GET /?token → Set-Cookie hem_token (HttpOnly)" $r
r=0; grep -q 'lang="fa"' "$head_root" || r=1; grep -q 'Headscale Easy Manager' "$head_root" || r=1
chk "GET / → index.html با نشانگر فارسی (lang=fa + title)" $r
r=0; [ "$code" = 200 ] || r=1
chk "GET / → HTTP 200 (کد: $code)" $r

# --- ۲) assetها با mime درست
asset_css="$(find "$LINUX_DIR/ui/_next" -name '*.css' | head -1)"
asset_js="$(find "$LINUX_DIR/ui/_next" -name '*.js' | head -1)"
svg_ct="$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$HEM_UI_PORT/logo.svg")"
css_ct="$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$HEM_UI_PORT${asset_css#$LINUX_DIR/ui}")"
js_ct="$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$HEM_UI_PORT${asset_js#$LINUX_DIR/ui}")"
r=0; [ "$svg_ct" = 'image/svg+xml' ] || r=1
chk "logo.svg → image/svg+xml (بازیافتی: $svg_ct)" $r
r=0; case "$css_ct" in text/css*) ;; *) r=1;; esac
chk "css → text/css (بازیافتی: $css_ct)" $r
r=0; case "$js_ct" in application/javascript*|text/javascript*) ;; *) r=1;; esac
chk "js → application/javascript (بازیافتی: $js_ct)" $r

# --- ۳) fallback SPA برای مسیر ناشناخته + no-cache روی index
spa="$(mktemp)"; spa_hdr="$(mktemp)"
curl -s -o "$spa" -D "$spa_hdr" "http://127.0.0.1:$HEM_UI_PORT/route/nashnakhte/xyz"
r=0; grep -q 'lang="fa"' "$spa" || r=1
chk "fallback SPA → index.html برای مسیر ناشناخته" $r
r=0; grep -qi '^cache-control: *no-store' "$spa_hdr" || r=1
grep -qi '^cache-control: *no-store' "$head_hdr" || r=1
chk "index.html بدون کش (Cache-Control: no-store)" $r

# --- ۴) توکن: کوکی کافی است؛ بدون توکن 401؛ XTransformPort بی‌ضرر است
h_code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-HEM-Token: $TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health")
c_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: hem_token=$TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health")
n_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HEM_UI_PORT/api/health")
g_code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-HEM-Token: $TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health?XTransformPort=$HEM_UI_PORT")
r=0; [ "$h_code" = 200 ] || r=1; chk "هدر X-HEM-Token → 200" $r
r=0; [ "$c_code" = 200 ] || r=1; chk "کوکی hem_token (بدون هدر) → 200" $r
r=0; [ "$n_code" = 401 ] || r=1; chk "بدون توکن → 401" $r
r=0; [ "$g_code" = 200 ] || r=1; chk "XTransformPort نادیده گرفته می‌شود → 200" $r
ver="$(curl -s -H "X-HEM-Token: $TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health" | grep -oE '"version":"[^"]+"')"
r=0; echo "$ver" | grep -q "\"$VERSION\"" || r=1; chk "نسخهٔ گزارش‌شدهٔ agent = $VERSION ($ver)" $r

# --- ۵) اتصال SSH واقعی (TOFU کامل) + exec واقعی روی باینری کامپایل‌شده
AH="X-HEM-Token: $TOKEN"
CT='content-type: application/json'
c1="$(curl -s -X POST -H "$AH" -H "$CT" -d '{"inline":{"host":"127.0.0.1","port":2222,"username":"z","authMethod":"password","password":"hemtest-pass","hsMode":"custom"}}' "http://127.0.0.1:$HEM_UI_PORT/api/connect")"
r=0; echo "$c1" | grep -q '"status":"fingerprint-required"' || r=1
chk "اتصال → fingerprint-required (TOFU؛ home تازه)" $r
SID="$(echo "$c1" | grep -oE '"sessionId":"[^"]+"' | head -1 | cut -d'"' -f4)"
r=0; [ -n "$SID" ] || r=1; chk "شناسهٔ نشست: ${SID:0:8}…" $r
c2="$(curl -s -X POST -H "$AH" -H "$CT" -d "{\"sessionId\":\"$SID\",\"accept\":true}" "http://127.0.0.1:$HEM_UI_PORT/api/connect/confirm")"
r=0; echo "$c2" | grep -q '"status":"connected"' || r=1
chk "confirm → connected (اثرانگشت ذخیره شد)" $r

prev="$(curl -s -H "$AH" -H "$CT" -d '{"cmd":"df -h"}' "http://127.0.0.1:$HEM_UI_PORT/api/s/$SID/console/preview")"
r=0; echo "$prev" | grep -q '"allowed":true' || r=1
chk "کنسول: پیش‌نمایش df -h مجاز" $r
execd="$(curl -s -H "$AH" -H "$CT" -d '{"cmd":"df -h"}' "http://127.0.0.1:$HEM_UI_PORT/api/s/$SID/console")"
r=0; echo "$execd" | grep -q '"exitCode":0' || r=1; echo "$execd" | grep -q 'Filesystem' || r=1
chk "exec واقعی df -h از طریق ssh2ِ کامپایل‌شده (exitCode 0)" $r

probe_code=$(curl -s -o /tmp/hem-probe.json -w '%{http_code}' -H "$AH" "http://127.0.0.1:$HEM_UI_PORT/api/s/$SID/probe")
r=0; { [ "$probe_code" = 200 ] && grep -q '"os"' /tmp/hem-probe.json; } || r=1
chk "probe واقعی (دستورات زندهٔ سرور)" $r

disc="$(curl -s -X POST -H "$AH" -H "$CT" -d "{\"sessionId\":\"$SID\"}" "http://127.0.0.1:$HEM_UI_PORT/api/disconnect")"
r=0; echo "$disc" | grep -q '"ok":true' || r=1
chk "قطع نشست" $r

cleanup_bin
trap - EXIT
[ "$started_demo" = 0 ] || log "سرور SSH آزمایشی در همین اجرا روشن شد و روشن می‌ماند."
[ "$errors" = 0 ] || fail "راستی‌آزمایی زندهٔ باینری لینوکسی شکست خورد ($errors مورد)."
log "راستی‌آزمایی زندهٔ باینری لینوکسی کامل شد — ssh2/exec/UI/توکن همه واقعی کار می‌کنند."

# ----------------------------------------------------------------------------
# ۴) zip + sha256
# ----------------------------------------------------------------------------
log "ساخت $ZIP_NAME …"
(cd "$DIST" && rm -f "$ZIP_NAME" && zip -r -q "$ZIP_NAME" hem-manager)
(cd "$DIST" && sha256sum "$ZIP_NAME" > "$ZIP_NAME.sha256")

echo
log "================= خروجی نهایی ================="
log "zip     : $ZIP ($(du -h "$ZIP" | cut -f1))"
log "sha256  : $(cut -d' ' -f1 "$DIST/$ZIP_NAME.sha256")"
log "exe     : $STAGE/hem-manager.exe ($(du -h "$STAGE/hem-manager.exe" | cut -f1))"
log "ui      : $STAGE/ui ($(du -sh "$STAGE/ui" | cut -f1))"
log "لینوکس : $LINUX_DIR/hem-manager ($(du -h "$LINUX_DIR/hem-manager" | cut -f1)) — آزموده‌شدهٔ زنده"
echo
log "محتویات zip:"
unzip -l "$ZIP" | sed 's/^/  /'
echo
log "صادقانه: exe ویندوزی cross-compile از همین سورس است و در این لینوکس‌باکس"
log "قابل اجرا نیست؛ «باینری لینوکسیِ همان سورس» به‌صورت زنده راستی‌آزمایی شد"
log "(UI، توکن/کوکی، اتصال TOFU و exec واقعی SSH). آزمون روی خودِ ویندوز باید"
log "در اولین فرصت روی یک ویندوز واقعی تکرار شود."
