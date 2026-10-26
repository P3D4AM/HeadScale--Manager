#!/usr/bin/env bash
# ============================================================================
# fetch-tailscale-msi.sh — download the official Tailscale Windows installer
# ----------------------------------------------------------------------------
# Bundles the OFFICIAL Tailscale MSI (amd64) into the Headscale Easy Manager
# Windows package so the user can install Tailscale LOCALLY on Windows,
# without needing winget or the internet on the target machine.
#
# Source (pinned): https://pkgs.tailscale.com/stable/ — the same server the
# official https://tailscale.com/download/windows page downloads from.
#
# Inputs:
#   $1 (optional) — target directory (default: ./vendor-download).
#   HEM_TS_MSI_CACHE (env, optional) — cache dir for re-runs (default:
#     /tmp/hem-ts-msi-cache).
#
# Outputs:
#   <target>/tailscale-setup-<version>-amd64.msi   (verified, ready to bundle)
#   stdout: the final file path (for callers that want to consume it).
#
# Hard rules (honesty first):
#   - The version AND SHA-256 below are pinned; a download that does not
#     match the pinned digest FAILS the build — we never bundle an
#     unverified binary next to the manager.
#   - If the pinned file is already present (target or cache) and its digest
#     matches, no network access happens.
# ============================================================================
set -euo pipefail

# --- pinned release (official Tailscale stable channel) ---------------------
TS_VERSION="1.104.2"
TS_MSI_NAME="tailscale-setup-${TS_VERSION}-amd64.msi"
TS_MSI_URL="https://pkgs.tailscale.com/stable/${TS_MSI_NAME}"
TS_MSI_SHA256="7eff4abdcbcf592ac9bce28f2b9f0fd51f8fc09194c955fbe8253b67b531e7f5"
TS_MSI_SIZE="38756352" # bytes — belt and braces next to the digest

TARGET_DIR="${1:-./vendor-download}"
CACHE_DIR="${HEM_TS_MSI_CACHE:-/tmp/hem-ts-msi-cache}"

# Logs go to STDERR so callers can capture the final path from stdout:
#   TS_MSI_PATH="$(bash fetch-tailscale-msi.sh <target-dir>)"
log() { printf '[fetch-tailscale-msi] %s\n' "$*" >&2; }
fail() { printf '[fetch-tailscale-msi] FAIL: %s\n' "$*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || fail "curl is not on PATH."
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is not on PATH."

verify() { # $1 = file path → exit 0 iff the digest matches the pin
  local got
  got="$(sha256sum "$1" | cut -d' ' -f1)"
  [ "$got" = "$TS_MSI_SHA256" ]
}

mkdir -p "$TARGET_DIR"
OUT="$TARGET_DIR/$TS_MSI_NAME"

# 1) already staged from a previous run?
if [ -f "$OUT" ] && verify "$OUT"; then
  log "already present and verified: $OUT — no download needed."
  printf '%s\n' "$OUT"
  exit 0
fi

# 2) cache hit?
mkdir -p "$CACHE_DIR"
CACHED="$CACHE_DIR/$TS_MSI_NAME"
if [ -f "$CACHED" ] && verify "$CACHED"; then
  log "cache hit — copying $CACHED -> $OUT"
  cp "$CACHED" "$OUT"
  printf '%s\n' "$OUT"
  exit 0
fi

# 3) download (official stable channel, pinned version)
log "downloading the official Tailscale MSI (v$TS_VERSION, amd64) …"
log "  $TS_MSI_URL"
if ! curl -fL --retry 3 --max-time 300 -o "$CACHED.part" "$TS_MSI_URL"; then
  rm -f "$CACHED.part"
  fail "download failed — check the network; the manager package is never built with an unverified installer."
fi
mv "$CACHED.part" "$CACHED"

# 4) verify: digest + size (both pinned)
if ! verify "$CACHED"; then
  rm -f "$CACHED"
  fail "SHA-256 mismatch — the downloaded file does not match the pinned digest. Refusing to bundle it."
fi
GOT_SIZE="$(stat -c '%s' "$CACHED" 2>/dev/null || stat -f '%z' "$CACHED")"
if [ "$GOT_SIZE" != "$TS_MSI_SIZE" ]; then
  rm -f "$CACHED"
  fail "size mismatch (expected $TS_MSI_SIZE bytes, got $GOT_SIZE). Refusing to bundle it."
fi

cp "$CACHED" "$OUT"
log "verified (sha256 + size) and staged: $OUT"
printf '%s\n' "$OUT"
