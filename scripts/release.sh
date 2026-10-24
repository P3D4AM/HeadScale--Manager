#!/usr/bin/env bash
#
# release.sh — بستهٔ انتشار تمیز «Headscale Easy Manager» (اصلاح ایراد ۴.۱۱ ممیزی AUDIT-2025-10)
#
# اصول:
#   ۱) هیچ بسته‌ای بدون گذر از گیت‌های واقعی ساخته نمی‌شود:
#      docs:generate → tsc --noEmit → lint (هر سه الزامی، بدون تابعیت به ignore فلگ‌ها)
#   ۲) گردآوری فقط با allowlist — هر چیزی خارج از فهرست، هرگز وارد بسته نمی‌شود
#      (مخزن پایتون از «git archive HEAD:headscale-easy-manager» — بدون کش و فایل‌های
#      ردیابی‌نشده؛ پس از fold v0.3.1 مخزن پایتون در همین گیت ریشه است)
#   ۳) خودآزمایی داخل خود اسکریپت: محتوای تاربال بازرسی می‌شود؛ فایل ممنوعه = شکست
#
# خروجی: download/headscale-easy-manager-v<VERSION>.tar.gz + .sha256
#
# پرتاب‌پذیر: مسیر پروژه از محل خود اسکریپت حساب می‌شود (بدون مسیر ثابت).

set -euo pipefail

# ─── مسیرها (پرتاب‌پذیر) ───
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

log() { printf '%s\n' "$*"; }
die() { printf '✗ release: %s\n' "$*" >&2; exit 1; }

command -v bun >/dev/null 2>&1 || die "bun روی PATH نیست — برای گیت‌های بیلد لازم است"
command -v git >/dev/null 2>&1 || die "git روی PATH نیست — برای git archive مخزن پایتون لازم است"

# نسخهٔ واحد حقیقت: package.json (باید با src/hem/__init__.py مخزن داخلی هم‌راستا باشد)
VERSION="$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
[ -n "$VERSION" ] || die "نسخه از package.json خوانده نشد"
PKG_NAME="headscale-easy-manager-v$VERSION"
OUT_DIR="$PROJECT_DIR/download"
ARTIFACT="$OUT_DIR/$PKG_NAME.tar.gz"

# ─── ۱) تولید محتوای آموزش (build-time — اصلاح ۴.۹) ───
log "▸ [1/5] تولید محتوای مرکز آموزش (bun run docs:generate)…"
bun run docs:generate

# ─── ۲) گیت تایپ (بدون ignoreBuildErrors — اصلاح ۴.۱۰) ───
log "▸ [2/5] بررسی تایپ‌ها (tsc --noEmit)…"
bunx tsc --noEmit

# ─── ۳) گیت lint ───
log "▸ [3/5] lint (eslint .)…"
bun run lint

# ─── پیش‌شرط‌های ساختاری ───
[ -d .git ] || die "release.sh باید از داخل clone گیت اجرا شود (git archive لازم است)"
[ ! -e headscale-easy-manager/.git ] || die "headscale-easy-manager نباید مخزن تو در تو باشد (fold v0.3.1 — .git داخلی حذف شده است)"
[ ! -e src/app/api/docs ] || die "src/app/api/docs باید حذف شده باشد (اصلاح ۴.۹ — مستندات build-time)"
[ -f src/generated/docs-content.ts ] || die "src/generated/docs-content.ts تولید نشد"
[ -f mini-services/hem-agent/index.ts ] || die "mini-services/hem-agent/index.ts پیدا نشد"
[ -f headscale-easy-manager/install.sh ] || die "install.sh مخزن داخلی پیدا نشد"
[ -f README-FA.md ] || die "README-FA.md ریشهٔ پروژه پیدا نشد"

# ─── ۴) گردآوری staging فقط با allowlist ───
log "▸ [4/5] گردآوری بستهٔ $PKG_NAME (فقط allowlist)…"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/hem-release.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
PKG_ROOT="$STAGE/$PKG_NAME"
mkdir -p "$PKG_ROOT"

# ۴-۱) سورس رابط وب
cp -a src "$PKG_ROOT/src"

# ۴-۲) مولد مستندات
mkdir -p "$PKG_ROOT/scripts"
cp scripts/generate-docs.ts "$PKG_ROOT/scripts/generate-docs.ts"

# ۴-۳) سرویس agent — بدون node_modules/لاگ/کش/خروجی بیلد (ui-out همیشه از ابتدا ساخته می‌شود)
mkdir -p "$PKG_ROOT/mini-services/hem-agent"
(
  cd mini-services/hem-agent
  tar -cf - \
    --exclude=node_modules \
    --exclude='*.log' \
    --exclude=.cache \
    --exclude=dist \
    --exclude=ui-out \
    --exclude=__pycache__ \
    .
) | tar -xf - -C "$PKG_ROOT/mini-services/hem-agent"

# ۴-۴) مخزن پایتون — فقط درخت کامیت‌شدهٔ «همین گیت» (پس از fold v0.3.1؛
#      بدون .git/کش/فایل‌های ردیابی‌نشده)
mkdir -p "$PKG_ROOT/headscale-easy-manager"
git archive HEAD:headscale-easy-manager | tar -xf - -C "$PKG_ROOT/headscale-easy-manager"

# ۴-۵) فایل‌های سطح بالای پروژه
for f in package.json bun.lock next.config.ts tsconfig.json tailwind.config.ts \
  postcss.config.mjs components.json eslint.config.mjs README-FA.md; do
  [ -f "$f" ] || die "فایل لازم allowlist پیدا نشد: $f"
  cp "$f" "$PKG_ROOT/$f"
done

# ─── ساخت تاربال + چک‌سام ───
mkdir -p "$OUT_DIR"
rm -f "$ARTIFACT" "$ARTIFACT.sha256"
tar -czf "$ARTIFACT" -C "$STAGE" "$PKG_NAME"
(
  cd "$OUT_DIR"
  sha256sum "$PKG_NAME.tar.gz" > "$PKG_NAME.tar.gz.sha256"
)

# ─── ۵) خودآزمایی: بازرسی محتوای تاربال ───
log "▸ [5/5] خودآزمایی بسته (بازرسی محتوای تاربال)…"
LISTING="$(tar -tzf "$ARTIFACT")"
# برای تست عضویتِ «خط کامل» با ابزار داخلی bash (بدون زیرپروسسه) — مصون از
# SIGPIPE/fork-fail/OOM؛ در اجرای ۱۴:۲۷ یک شکست کاذبِ `grep -q` زیر pipefail
# رخ داد (پیدا نشدن کاذبِ index.ts در حالی که در بسته بود) → این الگو حذف شد.
LF=$'\n'
LISTING_ALL="$LF$LISTING$LF"
tarball_has() { # $1 = مدخل دقیق (خط کامل) — خروجی ۰ یعنی موجود
  case "$LISTING_ALL" in
    *"$LF$1$LF"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ۵-۱) هیچ فایل ممنوعه‌ای نباید در بسته باشد
FORBIDDEN='(^|/)\.git(/|$)|(^|/)\.env($|\.)|(^|/)node_modules(/|$)|__pycache__|\.pytest_cache|\.ruff_cache|\.sqlite|\.log$|(^|/)agent-ctx(/|$)|(^|/)download(/|$)|(^|/)\.next(/|$)|(^|/)ui-out(/|$)|(^|/)prisma(/|$)|(^|/)src/lib/db\.ts$'
if printf '%s\n' "$LISTING" | grep -Eq "$FORBIDDEN"; then
  printf '%s\n' "$LISTING" | grep -E "$FORBIDDEN" | head -n 20 >&2
  die "بسته شامل فایل(های) ممنوع است — فهرست بالا؛ بسته ساخته نشد."
fi

# ۵-۲) حداقل ۱۴ فصل مستندات فارسی مخزن داخلی
# (|| true چون grep -c با صفر تطابق خروجی ۱ می‌دهد — عدد صفر همچنان چاپ و پایین بررسی می‌شود)
CHAPTERS="$(printf '%s\n' "$LISTING" | grep -Ec '^'"$PKG_NAME"'/headscale-easy-manager/docs/fa/[^/]+\.md$' || true)"
case "$CHAPTERS" in ''|*[!0-9]*) die "شمارش فصل‌های docs/fa در بسته خراب است: '$CHAPTERS'" ;; esac
[ "$CHAPTERS" -ge 14 ] || die "فصل‌های docs/fa در بسته $CHAPTERS است — کمتر از ۱۴"

# ۵-۳) اجزای حیاتی agent و نصب‌کننده
tarball_has "$PKG_NAME/mini-services/hem-agent/index.ts" \
  || die "index.ts سرویس agent در بسته نیست ($PKG_NAME/mini-services/hem-agent/index.ts)"
tarball_has "$PKG_NAME/headscale-easy-manager/install.sh" \
  || die "install.sh مخزن داخلی در بسته نیست ($PKG_NAME/headscale-easy-manager/install.sh)"

# ۵-۴) هم‌گامی محتوای آموزش UI با مخزن داخلیِ داخل بسته (اصلاح ۴.۹):
#      docs/fa آرشیوشده (git HEAD) باید کاملاً در ماژول تولیدی src/generated موجود باشد.
ARCHIVE_CHAPTERS="$CHAPTERS"
GENERATED_CHAPTERS="$(grep -c '"slug"' "$PKG_ROOT/src/generated/docs-content.ts" || true)"
case "$GENERATED_CHAPTERS" in ''|*[!0-9]*) die "شمارش فصل‌های ماژول تولیدی خراب است: '$GENERATED_CHAPTERS'" ;; esac
if [ "$GENERATED_CHAPTERS" -lt "$ARCHIVE_CHAPTERS" ]; then
  die "ماژول تولیدی ($GENERATED_CHAPTERS فصل) از docs/fa داخل بسته ($ARCHIVE_CHAPTERS فصل) عقب است — bun run docs:generate اجرا نشد یا کهنه است"
elif [ "$GENERATED_CHAPTERS" -gt "$ARCHIVE_CHAPTERS" ]; then
  log "⚠ هشدار: محتوای تولیدی ($GENERATED_CHAPTERS فصل) جلوتر از HEAD گیت اصلی ($ARCHIVE_CHAPTERS فصل) است —"
  log "⚠ یعنی docs/fa کاری (کامیت‌نشده) در بسته نیست؛ پس از کامیت، release.sh را دوباره اجرا کنید."
fi

# ─── جمع‌بندی ───
FILES="$(printf '%s\n' "$LISTING" | wc -l | tr -d ' ')"
SIZE="$(du -h "$ARTIFACT" | cut -f1)"
SHA256="$(cut -d' ' -f1 "$ARTIFACT.sha256")"

log ""
log "✓ بستهٔ انتشار آماده شد:"
log "    مسیر:    $ARTIFACT"
log "    چک‌سام:  $ARTIFACT.sha256"
log "    حجم:     $SIZE"
log "    فایل‌ها: $FILES"
log "    فصل‌ها:  $CHAPTERS فصل docs/fa"
log "    sha256:  $SHA256"
