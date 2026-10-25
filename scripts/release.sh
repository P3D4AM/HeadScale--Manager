#!/usr/bin/env bash
#
# release.sh — clean release package for "Headscale Easy Manager" (fix for audit AUDIT-2025-10 finding 4.11)
#
# Principles:
#   1) No package is built without passing the real gates:
#      docs:generate → tsc --noEmit → lint (all three mandatory, regardless of ignore flags)
#   2) Assembly is allowlist-only — anything outside the list never enters the package
#      (the Python repo comes from "git archive HEAD:headscale-easy-manager" — no
#      caches or untracked files; after the v0.3.1 fold the Python repo lives in
#      this same root git repo)
#   3) Self-check inside the script itself: the tarball contents are inspected;
#      any forbidden file = failure
#
# Output: download/headscale-easy-manager-v<VERSION>.tar.gz + .sha256
#
# Portable: the project path is derived from the script's own location (no hardcoded paths).

set -euo pipefail

# ─── Paths (portable) ───
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

log() { printf '%s\n' "$*"; }
die() { printf '✗ release: %s\n' "$*" >&2; exit 1; }

command -v bun >/dev/null 2>&1 || die "bun is not on PATH — required for the build gates"
command -v git >/dev/null 2>&1 || die "git is not on PATH — required for git archive of the Python repo"

# Single source of truth for the version: package.json (must stay in sync with the inner repo's src/hem/__init__.py)
VERSION="$(grep -m1 '"version"' package.json | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
[ -n "$VERSION" ] || die "version could not be read from package.json"
PKG_NAME="headscale-easy-manager-v$VERSION"
OUT_DIR="$PROJECT_DIR/download"
ARTIFACT="$OUT_DIR/$PKG_NAME.tar.gz"

# ─── 1) Generate learning-center content (build-time — fix 4.9) ───
log "▸ [1/5] Generating learning-center content (bun run docs:generate)…"
bun run docs:generate

# ─── 2) Type gate (no ignoreBuildErrors — fix 4.10) ───
log "▸ [2/5] Type-checking (tsc --noEmit)…"
bunx tsc --noEmit

# ─── 3) Lint gate ───
log "▸ [3/5] lint (eslint .)…"
bun run lint

# ─── Structural preconditions ───
[ -d .git ] || die "release.sh must be run from inside a git clone (git archive is required)"
[ ! -e headscale-easy-manager/.git ] || die "headscale-easy-manager must not be a nested repository (fold v0.3.1 — the inner .git was removed)"
[ ! -e src/app/api/docs ] || die "src/app/api/docs must be gone (fix 4.9 — build-time docs)"
[ -f src/generated/docs-content.ts ] || die "src/generated/docs-content.ts was not generated"
[ -f mini-services/hem-agent/index.ts ] || die "mini-services/hem-agent/index.ts not found"
[ -f headscale-easy-manager/install.sh ] || die "inner-repo install.sh not found"
[ -f README-FA.md ] || die "project-root README-FA.md not found"

# ─── 4) Assemble staging with an allowlist only ───
log "▸ [4/5] Assembling package $PKG_NAME (allowlist only)…"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/hem-release.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
PKG_ROOT="$STAGE/$PKG_NAME"
mkdir -p "$PKG_ROOT"

# 4-1) Web UI source
cp -a src "$PKG_ROOT/src"

# 4-2) Docs generator
mkdir -p "$PKG_ROOT/scripts"
cp scripts/generate-docs.ts "$PKG_ROOT/scripts/generate-docs.ts"

# 4-3) agent service — without node_modules/logs/caches/build output (ui-out is always rebuilt from scratch)
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

# 4-4) Python repo — only the committed tree of "this same git repo" (after
#      the v0.3.1 fold; no .git/caches/untracked files)
mkdir -p "$PKG_ROOT/headscale-easy-manager"
git archive HEAD:headscale-easy-manager | tar -xf - -C "$PKG_ROOT/headscale-easy-manager"

# 4-5) Project top-level files
for f in package.json bun.lock next.config.ts tsconfig.json tailwind.config.ts \
  postcss.config.mjs components.json eslint.config.mjs README-FA.md; do
  [ -f "$f" ] || die "required allowlist file not found: $f"
  cp "$f" "$PKG_ROOT/$f"
done

# ─── Build tarball + checksum ───
mkdir -p "$OUT_DIR"
rm -f "$ARTIFACT" "$ARTIFACT.sha256"
tar -czf "$ARTIFACT" -C "$STAGE" "$PKG_NAME"
(
  cd "$OUT_DIR"
  sha256sum "$PKG_NAME.tar.gz" > "$PKG_NAME.tar.gz.sha256"
)

# ─── 5) Self-check: inspect the tarball contents ───
log "▸ [5/5] Package self-check (tarball content inspection)…"
LISTING="$(tar -tzf "$ARTIFACT")"
# Full-line membership is tested with a bash builtin (no subprocess) — immune
# to SIGPIPE/fork-fail/OOM; in the 14:27 run a false failure of `grep -q`
# under pipefail occurred (index.ts falsely reported missing while it was in
# the package) → that pattern was removed.
LF=$'\n'
LISTING_ALL="$LF$LISTING$LF"
tarball_has() { # $1 = exact entry (full line) — exit status 0 means present
  case "$LISTING_ALL" in
    *"$LF$1$LF"*) return 0 ;;
    *) return 1 ;;
  esac
}

# 5-1) No forbidden files may be in the package
FORBIDDEN='(^|/)\.git(/|$)|(^|/)\.env($|\.)|(^|/)node_modules(/|$)|__pycache__|\.pytest_cache|\.ruff_cache|\.sqlite|\.log$|(^|/)agent-ctx(/|$)|(^|/)download(/|$)|(^|/)\.next(/|$)|(^|/)ui-out(/|$)|(^|/)prisma(/|$)|(^|/)src/lib/db\.ts$'
if printf '%s\n' "$LISTING" | grep -Eq "$FORBIDDEN"; then
  printf '%s\n' "$LISTING" | grep -E "$FORBIDDEN" | head -n 20 >&2
  die "package contains forbidden file(s) — list above; package not built."
fi

# 5-2) At least 14 Persian docs chapters of the inner repo
# (|| true because grep -c exits 1 on zero matches — zero is still printed and checked below)
CHAPTERS="$(printf '%s\n' "$LISTING" | grep -Ec '^'"$PKG_NAME"'/headscale-easy-manager/docs/fa/[^/]+\.md$' || true)"
case "$CHAPTERS" in ''|*[!0-9]*) die "docs/fa chapter count in the package is corrupt: '$CHAPTERS'" ;; esac
[ "$CHAPTERS" -ge 14 ] || die "docs/fa chapters in the package: $CHAPTERS — fewer than 14"

# 5-3) Critical agent and installer components
tarball_has "$PKG_NAME/mini-services/hem-agent/index.ts" \
  || die "agent service index.ts is not in the package ($PKG_NAME/mini-services/hem-agent/index.ts)"
tarball_has "$PKG_NAME/headscale-easy-manager/install.sh" \
  || die "inner-repo install.sh is not in the package ($PKG_NAME/headscale-easy-manager/install.sh)"

# 5-4) UI learning-center content must be in sync with the inner repo inside
#      the package (fix 4.9): the archived docs/fa (git HEAD) must be fully
#      present in the generated src/generated module.
ARCHIVE_CHAPTERS="$CHAPTERS"
GENERATED_CHAPTERS="$(grep -c '"slug"' "$PKG_ROOT/src/generated/docs-content.ts" || true)"
case "$GENERATED_CHAPTERS" in ''|*[!0-9]*) die "generated-module chapter count is corrupt: '$GENERATED_CHAPTERS'" ;; esac
if [ "$GENERATED_CHAPTERS" -lt "$ARCHIVE_CHAPTERS" ]; then
  die "generated module ($GENERATED_CHAPTERS chapters) is behind docs/fa in the package ($ARCHIVE_CHAPTERS chapters) — bun run docs:generate was not run or is stale"
elif [ "$GENERATED_CHAPTERS" -gt "$ARCHIVE_CHAPTERS" ]; then
  log "⚠ Warning: generated content ($GENERATED_CHAPTERS chapters) is ahead of the main git HEAD ($ARCHIVE_CHAPTERS chapters) —"
  log "⚠ meaning uncommitted docs/fa work is not in the package; commit it, then run release.sh again."
fi

# ─── Summary ───
FILES="$(printf '%s\n' "$LISTING" | wc -l | tr -d ' ')"
SIZE="$(du -h "$ARTIFACT" | cut -f1)"
SHA256="$(cut -d' ' -f1 "$ARTIFACT.sha256")"

log ""
log "✓ Release package ready:"
log "    path:     $ARTIFACT"
log "    checksum: $ARTIFACT.sha256"
log "    size:     $SIZE"
log "    files:    $FILES"
log "    chapters: $CHAPTERS docs/fa chapters"
log "    sha256:   $SHA256"
