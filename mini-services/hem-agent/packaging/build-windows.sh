#!/usr/bin/env bash
# ============================================================================
# build-windows.sh — builds the Windows package of "Headscale Easy Manager"
# ----------------------------------------------------------------------------
# Inputs:
#   HEM_VERSION (env, optional) — default: the version field in package.json.
#   (UI_OUT was removed — v0.3.1 §1: the UI is built "always fresh"; there is
#    no cached reuse from ui-out/, and that folder is deleted at the end of
#    the run.)
#
# Outputs (under packaging/dist/):
#   hem-manager/                    contents of the Windows app folder:
#     ├─ hem-manager.exe            agent binary (bun --compile, Windows cross-compile)
#     ├─ installer/                  installer repo — bundled next to the exe (v0.3.1 §1);
#     │                              without it, the install wizard stops with a clear error.
#     ├─ ui/                         Persian web UI (static; the exe serves it)
#     ├─ vendor/tailscale/           OFFICIAL Tailscale MSI (pinned version + verified
#     │                              SHA-256) so Tailscale can be installed LOCALLY on
#     │                              Windows without winget/internet — run
#     │                              install-tailscale.ps1 from the package folder.
#     ├─ README-WINDOWS-FA.txt       quick-start guide (Persian)
#     ├─ install.ps1                 install (LOCALAPPDATA + shortcuts, no Administrator)
#     ├─ install-tailscale.ps1       OFFLINE Tailscale install from vendor/ (asks UAC once)
#     └─ uninstall.ps1               uninstall
#   linux-verify/hem-manager         Linux binary from the same source — "actually
#                                    run" and verified (below); reason: the Windows
#                                    exe cannot run on this Linux box; the Linux
#                                    binary is compiled from "the same source" and
#                                    tested live (honestly: this is not a substitute
#                                    for testing on Windows itself). The packaged
#                                    layout (installer/ next to the binary) is also
#                                    replicated and checked for it.
#   HeadscaleEasyManager-v<VER>-win64.zip (+ .sha256)
#
# Live verification of the Linux binary (on every run of the script):
#   1) /?token=… → Set-Cookie hem_token + index.html (Persian markers) — no-store
#   2) assets with the correct MIME types (svg/css/js) + SPA fallback for unknown paths
#   3) /api/health with cookie (no header) → 200; without a token → 401
#   4) real SSH connection to the test server 127.0.0.1:2222 (user z / password
#      hemtest-pass): full TOFU flow (fingerprint-required → confirm → connected)
#      + real exec (console allowlist: df -h) + real probe — i.e. the ssh2 inside
#      the compiled binary works.
#
# Technical notes (justified deviations):
#   • The always-fresh UI is built in /tmp (v0.3.1 §1) — the build output goes
#     straight into $STAGE/ui; the stale ui-out/ folder (a cache; git-ignored)
#     is deleted at the end of the run.
#   • node_modules is attached to the /tmp copy via hardlinks (cp -al), not
#     symlinks — Turbopack rejects symlinks pointing outside the build root
#     (a real error we hit).
#   • The in-copy UI patches were removed (v0.3.1): the real next.config.ts has
#     output:"export" and src/app/api no longer exists — path 7-a fully landed.
#   • installer/ is exactly the "committed tree" (git archive
#     HEAD:headscale-easy-manager, the same method as release.sh after the
#     v0.3.1 fold) — not untracked/cached files; no developer paths are
#     assumed on the user's machine.
#   • packaging/dist is git-ignored — it is build output, not source.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"                       # mini-services/hem-agent
OUTER_DIR="$(cd "$AGENT_DIR/../.." && pwd)"                     # root of the outer project (Next.js app)
VERSION="${HEM_VERSION:-$(grep -m1 '"version"' "$AGENT_DIR/package.json" | sed -E 's/.*"version": *"([^"]+)".*/\1/')}"
DIST="$SCRIPT_DIR/dist"
STAGE="$DIST/hem-manager"
LINUX_DIR="$DIST/linux-verify"
ZIP_NAME="HeadscaleEasyManager-v$VERSION-win64.zip"
ZIP="$DIST/$ZIP_NAME"
HEM_UI_PORT=3015

log()  { printf '\033[1;36m[build-windows]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[build-windows] error:\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$AGENT_DIR/index.ts" ] || fail "index.ts not found in $AGENT_DIR."
[ -d "$OUTER_DIR/src/app" ]  || fail "outer project (Next.js) not found in $OUTER_DIR."
# --- installer/ preconditions (v0.3.1 §1) — before anything else -------------
command -v git >/dev/null 2>&1 || fail "git is not on PATH — building installer/ requires git archive."
command -v python3 >/dev/null 2>&1 || fail "python3 is not on PATH — the Windows text-file byte guard (BOM/CRLF) requires it."
[ -d "$OUTER_DIR/.git" ] || fail "$OUTER_DIR is not a git repository — installer/ is built only from that repo's committed tree (no developer paths are assumed)."
[ ! -e "$OUTER_DIR/headscale-easy-manager/.git" ] || fail "nested repository — the v0.3.1 fold was not done (headscale-easy-manager/.git exists)."
[ -f "$OUTER_DIR/headscale-easy-manager/install.sh" ] || fail "install.sh is not in the headscale-easy-manager working tree — the committed tree (HEAD) must contain the Python repo (fold v0.3.1)."
[ -f "$SCRIPT_DIR/templates/install.ps1" ]        || fail "template templates/install.ps1 is missing."
[ -f "$SCRIPT_DIR/templates/uninstall.ps1" ]      || fail "template templates/uninstall.ps1 is missing."
[ -f "$SCRIPT_DIR/templates/install-tailscale.ps1" ] || fail "template templates/install-tailscale.ps1 is missing."
[ -f "$SCRIPT_DIR/templates/README-WINDOWS-FA.txt" ] || fail "template templates/README-WINDOWS-FA.txt is missing."
[ -f "$SCRIPT_DIR/fetch-tailscale-msi.sh" ]        || fail "fetch-tailscale-msi.sh is missing — the offline Tailscale bundle cannot be verified without it."
log "version: $VERSION | agent: $AGENT_DIR | outer project: $OUTER_DIR"

# ----------------------------------------------------------------------------
# Guard for Windows text files (v0.3.2-beta.2 — root-cause fix of the installer Parser bug)
# ----------------------------------------------------------------------------
# Bug: up to v0.3.2-beta.1 these files were written with a bash heredoc:
# "UTF-8 without BOM" + "LF only". Windows PowerShell 5.1 reads a BOM-less
# file with the ANSI code page (CP1256/CP1252) → Persian text gets mangled,
# and worse: some Persian UTF-8 bytes are translated by the ANSI code page
# into "Unicode quotation characters" (a Persian letter → ‚ ; — → ”) which the
# Parser itself then treats as string delimiters → "Unexpected token ')'"
# and "string missing terminator" in install.ps1.
# Hard contract: UTF-8 BOM + CRLF only + no "smart quotes" U+2018..U+201D.
# This guard is the "single source" — every Windows output file must pass it;
# if someone ever saves a template with the wrong editor, the build stops
# right here, loudly (a systematic fix, not a one-off patch).
# ----------------------------------------------------------------------------
guard_windows_text() {
  python3 - "$@" <<'PYGUARD'
import sys
BOM = b"\xef\xbb\xbf"
QUOTES = set(range(0x2018, 0x201F))  # ‘ ’ ‚ ‛ “ ” „ — must never be present (all tested with the real PowerShell parser; U+201F and « » are safe)
ok = True
for p in sys.argv[1:]:
    try:
        data = open(p, "rb").read()
    except OSError as e:
        print(f"GUARD FAIL {p}: cannot read — {e}")
        ok = False
        continue
    why = []
    if not data.startswith(BOM):
        why.append("missing UTF-8 BOM (Windows PowerShell 5.1 reads it with the ANSI code page)")
    body = data[3:] if data.startswith(BOM) else data
    stripped = body.replace(b"\r\n", b"")
    if b"\n" in stripped:
        why.append("has LF without CR (only CRLF is allowed)")
    if b"\r" in stripped:
        why.append("has a lone CR (only CRLF is allowed)")
    if not body.strip():
        why.append("is empty")
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        why.append("is not valid UTF-8")
        text = ""
    if any(ord(c) in QUOTES for c in text):
        why.append("contains Unicode quotation marks (U+2018..U+201E) — the PowerShell parser treats them as string delimiters")
    if why:
        print(f"GUARD FAIL {p}: " + "; ".join(why))
        ok = False
if not ok:
    sys.exit(1)
print("GUARD OK — BOM + CRLF + no smart quotes")
PYGUARD
}

# Syntax check with PowerShell's own Parser — when pwsh is available (optional/honest)
parse_ps1_guard() {
  if command -v pwsh >/dev/null 2>&1; then
    log "Syntax-checking install.ps1/uninstall.ps1 with PowerShell's own Parser …"
    for f in "$@"; do
      PS1FILE="$f" pwsh -NoProfile -Command '
        $errs = $null; $tok = $null
        $null = [System.Management.Automation.Language.Parser]::ParseFile($env:PS1FILE, [ref]$tok, [ref]$errs)
        if ($errs.Count -gt 0) { $errs | ForEach-Object { Write-Output $_.Message }; exit 1 }
        Write-Output "PARSE OK: $env:PS1FILE"
      ' || fail "PowerShell Parser reported errors for $f (see above)."
    done
  else
    log "Honest note: pwsh is not available — the Parser check did not run in this build; it runs in Windows CI with real Windows PowerShell 5.1."
  fi
}

# ----------------------------------------------------------------------------
# 0) If path 7-a has landed: build-time docs generation (today optional/inert)
# ----------------------------------------------------------------------------
if grep -q '"docs:generate"' "$OUTER_DIR/package.json" 2>/dev/null; then
  log "scripts/generate-docs.ts has landed — running bun run docs:generate (path 7-a)"
  (cd "$OUTER_DIR" && bun run docs:generate) || fail "docs:generate failed."
else
  log "docs:generate has not landed yet (path 7-a) — chapters are read from docs/fa at build time."
fi

# ----------------------------------------------------------------------------
# 1) Static UI — "always fresh" in /tmp (v0.3.1 §1; no cache reuse)
# ----------------------------------------------------------------------------
UI_SRC=""   # <work>/out — this run's fresh output; goes straight into $STAGE/ui
UI_WORK=""  # temporary build copy; deleted after staging

build_ui() {
  local work="/tmp/hem-ui-build-$(date +%s)-$$"
  log "Building a fresh static UI in $work (every run — no reuse of previous output) …"
  mkdir -p "$work"
  tar -C "$OUTER_DIR" -cf - \
    --exclude=node_modules --exclude=.next --exclude=.git \
    --exclude=download --exclude=upload --exclude=dev.log --exclude=agent-ctx \
    --exclude='mini-services/*/node_modules' --exclude=db --exclude=tool-results \
    --exclude=headscale-easy-manager \
    . | tar -C "$work" -xf -

  # node_modules via hardlinks (Turbopack rejects symlinks pointing outside the build root)
  if ! cp -al "$OUTER_DIR/node_modules" "$work/node_modules" 2>/dev/null; then
    log "hardlinking failed — full copy of node_modules (slower)"
    cp -a "$OUTER_DIR/node_modules" "$work/node_modules"
  fi

  (cd "$work" && bunx next build) || fail "next build failed."
  [ -f "$work/out/index.html" ] || fail "out/index.html was not built."
  UI_SRC="$work/out"
  UI_WORK="$work"
  log "fresh UI built: $UI_SRC ($(du -sh "$UI_SRC" | cut -f1))"
}

build_ui

# ----------------------------------------------------------------------------
# 2) Stage the Windows app folder
# ----------------------------------------------------------------------------
log "Staging $STAGE …"
rm -rf "$STAGE"
mkdir -p "$STAGE/ui"
cp -a "$UI_SRC/." "$STAGE/ui/"
rm -rf "$UI_WORK"; UI_WORK=""; UI_SRC=""
log "Temporary UI build copy removed (fresh output went into $STAGE/ui)."

# installer/ — the installer repo, bundled next to the exe (v0.3.1 §1). Source:
# the outer git repo's "committed tree" (git archive) — same method as
# release.sh after the fold. A Windows package without an installer is never built.
log "Packaging installer/ from the committed tree (git archive HEAD:headscale-easy-manager) …"
mkdir -p "$STAGE/installer"
if ! git -C "$OUTER_DIR" archive HEAD:headscale-easy-manager | tar -x -C "$STAGE/installer"; then
  fail "git archive HEAD:headscale-easy-manager failed — installer/ was not created from the committed tree."
fi
[ -f "$STAGE/installer/install.sh" ] || fail "installer/ was not created in the Windows package — a package without an installer is never built."

log "Compiling the Windows exe (bun --compile --target=bun-windows-x64) …"
bun build --compile --target=bun-windows-x64 "$AGENT_DIR/index.ts" \
  --outfile "$STAGE/hem-manager.exe" >/dev/null || fail "Windows exe compile failed."
[ -f "$STAGE/hem-manager.exe" ] || fail "hem-manager.exe was not built."

# ----------------------------------------------------------------------------
# 2-b) Windows text files — from "tracked templates" (v0.3.2-beta.2)
# ----------------------------------------------------------------------------
# Single source: packaging/templates/ — tracked in git, with their byte
# contract (UTF-8 BOM + CRLF only + no smart quotes) enforced by
# guard_windows_text.
# Root cause of the v0.3.2-beta.1 bug: a bash heredoc wrote "UTF-8 without
# BOM" + "LF"; Windows PowerShell 5.1 read it with the ANSI code page and hit
# the Parser bug.
# ----------------------------------------------------------------------------
log "Staging Windows text files from templates (install.ps1 / uninstall.ps1 / install-tailscale.ps1 / README) …"
cp "$SCRIPT_DIR/templates/install.ps1"           "$STAGE/install.ps1"
cp "$SCRIPT_DIR/templates/uninstall.ps1"         "$STAGE/uninstall.ps1"
cp "$SCRIPT_DIR/templates/install-tailscale.ps1" "$STAGE/install-tailscale.ps1"
# @VERSION@ → $VERSION — this is the only substitution; every other byte is untouched.
# (Versions never contain & or \; if they ever do, escaping must be added here.)
sed "s/@VERSION@/$VERSION/g" "$SCRIPT_DIR/templates/README-WINDOWS-FA.txt" > "$STAGE/README-WINDOWS-FA.txt"
# Byte guard — all templates and outputs
guard_windows_text "$SCRIPT_DIR/templates/install.ps1" "$SCRIPT_DIR/templates/uninstall.ps1" \
  "$SCRIPT_DIR/templates/install-tailscale.ps1" "$SCRIPT_DIR/templates/README-WINDOWS-FA.txt" \
  "$STAGE/install.ps1" "$STAGE/uninstall.ps1" "$STAGE/install-tailscale.ps1" "$STAGE/README-WINDOWS-FA.txt" \
  || fail "Windows text-file guard rejected the files — contract: UTF-8 BOM + CRLF only + no U+2018..U+201D (review the templates)."
if grep -q "@VERSION@" "$STAGE/README-WINDOWS-FA.txt"; then
  fail "output README still contains @VERSION@ — the version substitution did not happen."
fi
grep -q "نسخهٔ $VERSION" "$STAGE/README-WINDOWS-FA.txt" || fail "output README lacks the Persian version marker for $VERSION."
parse_ps1_guard "$STAGE/install.ps1" "$STAGE/uninstall.ps1" "$STAGE/install-tailscale.ps1"

# ----------------------------------------------------------------------------
# 2-c) OFFLINE Tailscale bundle — the official MSI, pinned + digest-verified
# ----------------------------------------------------------------------------
# User directive: "bring the Tailscale package INSIDE the Headscale Manager
# package so Windows can install it locally". The MSI comes from the official
# pkgs.tailscale.com stable channel with a pinned SHA-256; a download that does
# not match fails the build (fetch-tailscale-msi.sh). install-tailscale.ps1
# (staged above) installs it offline with one UAC prompt.
# ----------------------------------------------------------------------------
log "Bundling the official Tailscale MSI for OFFLINE Windows install …"
TS_MSI_PATH="$(bash "$SCRIPT_DIR/fetch-tailscale-msi.sh" "$STAGE/vendor/tailscale")" \
  || fail "fetch-tailscale-msi.sh failed — the Windows package is never built without a verified Tailscale installer."
[ -f "$TS_MSI_PATH" ] || fail "fetch-tailscale-msi.sh did not produce the MSI."
log "Tailscale MSI staged: $TS_MSI_PATH ($(du -h "$TS_MSI_PATH" | cut -f1))"

# ----------------------------------------------------------------------------
# 3) Linux binary from the same source + full live verification
# ----------------------------------------------------------------------------
log "Compiling the Linux binary for live verification …"
rm -rf "$LINUX_DIR"
mkdir -p "$LINUX_DIR"
cp -a "$STAGE/ui" "$LINUX_DIR/ui"
bun build --compile --target=bun-linux-x64 "$AGENT_DIR/index.ts" \
  --outfile "$LINUX_DIR/hem-manager" >/dev/null || fail "Linux binary compile failed."
chmod +x "$LINUX_DIR/hem-manager"

# The packaged layout is replicated for the Linux binary too (v0.3.1 §1) —
# config.ts's resolution chain must find installer/ right here, like the
# Windows exe on Windows.
cp -a "$STAGE/installer" "$LINUX_DIR/installer"
[ -f "$LINUX_DIR/installer/install.sh" ] || fail "installer/ was not created next to the Linux binary (packaged layout)."

# The test SSH server must be up (127.0.0.1:2222) — if not, start it
started_demo=0
if ! (ss -tulpn 2>/dev/null | grep -q '127.0.0.1:2222'); then
  log "test SSH server is not up — starting it …"
  (cd "$AGENT_DIR" && setsid bun run test/server.ts >> test-server.log 2>&1 &)
  for i in $(seq 1 40); do (ss -tulpn 2>/dev/null | grep -q '127.0.0.1:2222') && break; sleep 0.25; done
  started_demo=1
fi
(ss -tulpn 2>/dev/null | grep -q '127.0.0.1:2222') || fail "test SSH server on port 2222 did not come up."

VERIFY_HOME="$LINUX_DIR/verify-home"
VERIFY_LOG="$LINUX_DIR/verify.log"
rm -rf "$VERIFY_HOME"
log "Running the Linux binary on port $HEM_UI_PORT (HEM_DESKTOP=1, fresh home) …"
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
[ -n "$TOKEN" ] || { cat "$VERIFY_LOG" >&2; fail "desktop token not found in the log."; }
log "desktop token extracted: ${TOKEN:0:8}… (full value in verify.log)"

errors=0
chk() { # chk <description> <success code 0/1>
  if [ "$2" = 0 ]; then log "  [OK]   $1"; else log "  [FAIL] $1"; errors=$((errors+1)); fi
}

# --- 0) Packaged layout: installer/ next to the binary (resolution precondition, v0.3.1 §1)
r=0; [ -f "$LINUX_DIR/installer/install.sh" ] || r=1
chk "installer/ next to the Linux binary (packaged layout)" $r

# --- 0-b) "bare" run of the binary (without any HEM_* variables) — regression
#     test for the "EXE closes instantly" bug (v0.3.2-beta.2): on Linux this
#     exercises the locked fail-closed path live: exit≠0 + the Persian
#     AUTH_NOT_CONFIGURED message + a "diagnostic log file" with a fatal
#     record (its absence would mean the error died unwitnessed). On the
#     packaged Windows build, this same run falls into the "desktop rule"
#     (src/config.ts) and starts up — that path can only be tested on real
#     Windows / Windows CI.
BARE_HOME="$LINUX_DIR/bare-home"
rm -rf "$BARE_HOME"
set +e
BARE_OUT="$(cd "$LINUX_DIR" && env -u HEM_AGENT_PORT -u HEM_AGENT_HOST -u HEM_AGENT_TOKEN -u HEM_AGENT_AUTH -u HEM_DESKTOP -u HEM_AGENT_HOME -u HEM_PROJECT_ROOT \
  HEM_AGENT_HOME="$BARE_HOME" timeout 20 ./hem-manager 2>&1)"
BARE_RC=$?
set -e
r=0
[ "$BARE_RC" -gt 0 ] && [ "$BARE_RC" -ne 124 ] || r=1
echo "$BARE_OUT" | grep -q "AUTH_NOT_CONFIGURED" || r=1
echo "$BARE_OUT" | grep -q "refuses to start" || r=1
[ -f "$BARE_HOME/logs/hem-agent.log" ] || r=1
if [ -f "$BARE_HOME/logs/hem-agent.log" ]; then
  grep -q '"code":"AUTH_NOT_CONFIGURED"' "$BARE_HOME/logs/hem-agent.log" || r=1
  grep -q '"phase":"fatal"' "$BARE_HOME/logs/hem-agent.log" || r=1
fi
if [ "$r" -ne 0 ]; then
  printf '%s\n' "$BARE_OUT" | sed 's/^/  [bare] /' >&2
fi
chk "bare binary run: exit≠0 + AUTH_NOT_CONFIGURED + diagnostic log file (EXE regression)" $r

# --- 1) /?token= → 303 + session Set-Cookie + (after the redirect) Persian index.html
#     Contract v0.3.1 §4: one-time exchange — a session cookie (no Max-Age) and
#     a 303 to the same path without the token; replaying an old link no
#     longer creates a cookie.
head_root="$(mktemp)"; head_hdr="$(mktemp)"
code="$(curl -s -L -o "$head_root" -D "$head_hdr" "http://127.0.0.1:$HEM_UI_PORT/?token=$TOKEN" -w '%{http_code}')"
r=0; grep -qi '^set-cookie: *hem_token=' "$head_hdr" || r=1
grep -qi '^set-cookie: *hem_token=.*max-age' "$head_hdr" && r=1
chk "GET /?token → 303 + session Set-Cookie hem_token (HttpOnly, no Max-Age)" $r
r=0; grep -q 'lang="fa"' "$head_root" || r=1; grep -q 'Headscale Easy Manager' "$head_root" || r=1
chk "GET / (after the 303 redirect) → index.html with Persian markers (lang=fa + title)" $r
r=0; [ "$code" = 200 ] || r=1
chk "GET / → HTTP 200 after 303 (final code: $code)" $r
# v0.3.2 — anti Windows bug: GET / must be text/html, never ambiguous health JSON
root_ct="$(curl -s -o /dev/null -w '%{content_type}' -H "Cookie: hem_token=$TOKEN" "http://127.0.0.1:$HEM_UI_PORT/")"
r=0; case "$root_ct" in text/html*) ;; *) r=1;; esac
chk "GET / → Content-Type: text/html (not ambiguous JSON — Windows UI bug regression)" $r
root_body="$(curl -s -H "Cookie: hem_token=$TOKEN" "http://127.0.0.1:$HEM_UI_PORT/")"
r=0; echo "$root_body" | grep -q '"service":"hem-agent"' && r=1
chk "GET / never returns health JSON (body has no service:hem-agent)" $r
replay_hdr="$(mktemp)"
curl -s -o /dev/null -D "$replay_hdr" "http://127.0.0.1:$HEM_UI_PORT/?token=$TOKEN"
r=0; grep -qi '^set-cookie: *hem_token=' "$replay_hdr" && r=1
chk "old-link replay (browser history) → no Set-Cookie (one-time exchange)" $r

# --- 2) assets with the correct MIME types
asset_css="$(find "$LINUX_DIR/ui/_next" -name '*.css' | head -1)"
asset_js="$(find "$LINUX_DIR/ui/_next" -name '*.js' | head -1)"
svg_ct="$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$HEM_UI_PORT/logo.svg")"
css_ct="$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$HEM_UI_PORT${asset_css#$LINUX_DIR/ui}")"
js_ct="$(curl -s -o /dev/null -w '%{content_type}' "http://127.0.0.1:$HEM_UI_PORT${asset_js#$LINUX_DIR/ui}")"
r=0; [ "$svg_ct" = 'image/svg+xml' ] || r=1
chk "logo.svg → image/svg+xml (actual: $svg_ct)" $r
r=0; case "$css_ct" in text/css*) ;; *) r=1;; esac
chk "css → text/css (actual: $css_ct)" $r
r=0; case "$js_ct" in application/javascript*|text/javascript*) ;; *) r=1;; esac
chk "js → application/javascript (actual: $js_ct)" $r

# --- 3) SPA fallback for unknown paths + no-cache on index
spa="$(mktemp)"; spa_hdr="$(mktemp)"
curl -s -o "$spa" -D "$spa_hdr" "http://127.0.0.1:$HEM_UI_PORT/route/nashnakhte/xyz"
r=0; grep -q 'lang="fa"' "$spa" || r=1
chk "SPA fallback → index.html for an unknown path" $r
r=0; grep -qi '^cache-control: *no-store' "$spa_hdr" || r=1
grep -qi '^cache-control: *no-store' "$head_hdr" || r=1
chk "index.html not cached (Cache-Control: no-store)" $r

# --- 4) token (v0.3.2 §2 model): minimal public health; sensitive route
#        without a token → 401; a cookie is enough; XTransformPort is harmless
h_code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-HEM-Token: $TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health")
c_code=$(curl -s -o /dev/null -w '%{http_code}' -H "Cookie: hem_token=$TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/profiles")
n_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$HEM_UI_PORT/api/profiles")
g_code=$(curl -s -o /dev/null -w '%{http_code}' -H "X-HEM-Token: $TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health?XTransformPort=$HEM_UI_PORT")
pub_body="$(curl -s "http://127.0.0.1:$HEM_UI_PORT/api/health")"
r=0; [ "$h_code" = 200 ] || r=1; chk "X-HEM-Token header → 200 (full health)" $r
r=0; [ "$c_code" = 200 ] || r=1; chk "hem_token cookie (no header) → 200" $r
r=0; [ "$n_code" = 401 ] || r=1; chk "sensitive route /api/profiles without a token → 401" $r
r=0; echo "$pub_body" | grep -q '"service":"hem-agent"' || r=1
echo "$pub_body" | grep -q '"uptimeSec"' && r=1
echo "$pub_body" | grep -q '"sessions"' && r=1
chk "health without a token → 200 minimal (only ok/service/version; no uptime/sessions)" $r
r=0; [ "$g_code" = 200 ] || r=1; chk "XTransformPort is ignored → 200" $r
ver="$(curl -s -H "X-HEM-Token: $TOKEN" "http://127.0.0.1:$HEM_UI_PORT/api/health" | grep -oE '"version":"[^"]+"')"
r=0; echo "$ver" | grep -q "\"$VERSION\"" || r=1; chk "agent-reported version = $VERSION ($ver)" $r

# --- 5) real SSH connection (full TOFU) + real exec on the compiled binary
AH="X-HEM-Token: $TOKEN"
CT='content-type: application/json'
c1="$(curl -s -X POST -H "$AH" -H "$CT" -d '{"inline":{"host":"127.0.0.1","port":2222,"username":"z","authMethod":"password","password":"hemtest-pass","hsMode":"custom"}}' "http://127.0.0.1:$HEM_UI_PORT/api/connect")"
r=0; echo "$c1" | grep -q '"status":"fingerprint-required"' || r=1
chk "connect → fingerprint-required (TOFU; fresh home)" $r
SID="$(echo "$c1" | grep -oE '"sessionId":"[^"]+"' | head -1 | cut -d'"' -f4)"
r=0; [ -n "$SID" ] || r=1; chk "session id: ${SID:0:8}…" $r
c2="$(curl -s -X POST -H "$AH" -H "$CT" -d "{\"sessionId\":\"$SID\",\"accept\":true}" "http://127.0.0.1:$HEM_UI_PORT/api/connect/confirm")"
r=0; echo "$c2" | grep -q '"status":"connected"' || r=1
chk "confirm → connected (fingerprint saved)" $r

prev="$(curl -s -H "$AH" -H "$CT" -d '{"cmd":"df -h"}' "http://127.0.0.1:$HEM_UI_PORT/api/s/$SID/console/preview")"
r=0; echo "$prev" | grep -q '"allowed":true' || r=1
chk "console: df -h preview allowed" $r
execd="$(curl -s -H "$AH" -H "$CT" -d '{"cmd":"df -h"}' "http://127.0.0.1:$HEM_UI_PORT/api/s/$SID/console")"
r=0; echo "$execd" | grep -q '"exitCode":0' || r=1; echo "$execd" | grep -q 'Filesystem' || r=1
chk "real df -h exec via the compiled ssh2 (exitCode 0)" $r

probe_code=$(curl -s -o /tmp/hem-probe.json -w '%{http_code}' -H "$AH" "http://127.0.0.1:$HEM_UI_PORT/api/s/$SID/probe")
r=0; { [ "$probe_code" = 200 ] && grep -q '"os"' /tmp/hem-probe.json; } || r=1
chk "real probe (live server commands)" $r

disc="$(curl -s -X POST -H "$AH" -H "$CT" -d "{\"sessionId\":\"$SID\"}" "http://127.0.0.1:$HEM_UI_PORT/api/disconnect")"
r=0; echo "$disc" | grep -q '"ok":true' || r=1
chk "session disconnect" $r

# --- 6) v0.3.2 §2 — fail-closed model on "this very binary": it must not
# start, rather than run an open service. Without a token and without an
# explicit setting → exit≠0 + AUTH_NOT_CONFIGURED (a clear Persian message).
# Note: under set -e the deliberate non-zero exit is captured with "|| RC=$?"
# so the script does not die.
REF_HOME2="$LINUX_DIR/refuse-home"
rm -rf "$REF_HOME2"
REF_LOG2="$LINUX_DIR/refuse2.log"
REF_RC=0
HEM_AGENT_PORT=31052 HEM_AGENT_HOME="$REF_HOME2" \
  timeout 20 "$LINUX_DIR/hem-manager" > "$REF_LOG2" 2>&1 || REF_RC=$?
r=0; { [ "$REF_RC" -ne 0 ] && [ "$REF_RC" -ne 124 ]; } || r=1
chk "no token and no HEM_AGENT_AUTH → exit≠0 (fail-closed, not an open service)" $r
r=0; grep -q 'AUTH_NOT_CONFIGURED' "$REF_LOG2" && grep -q 'refuses to start' "$REF_LOG2" || r=1
chk "  … with a clear AUTH_NOT_CONFIGURED message (English, per user directive)" $r
# open + HEM_AGENT_HOST=0.0.0.0 → exit≠0 + loopback error (an unauthenticated service on the network is forbidden):
REF_LOG3="$LINUX_DIR/refuse3.log"
REF_RC3=0
HEM_AGENT_PORT=31053 HEM_AGENT_AUTH=open HEM_AGENT_HOST=0.0.0.0 HEM_AGENT_HOME="$REF_HOME2" \
  timeout 20 "$LINUX_DIR/hem-manager" > "$REF_LOG3" 2>&1 || REF_RC3=$?
r=0; { [ "$REF_RC3" -ne 0 ] && [ "$REF_RC3" -ne 124 ]; } || r=1
chk "open + HEM_AGENT_HOST=0.0.0.0 → exit≠0 (loopback only)" $r
r=0; grep -q 'loopback' "$REF_LOG3" || r=1
chk "  … with a clear loopback error" $r

cleanup_bin
trap - EXIT
[ "$started_demo" = 0 ] || log "the test SSH server was started during this run and stays up."
[ "$errors" = 0 ] || fail "live verification of the Linux binary failed ($errors case(s))."
log "live verification of the Linux binary completed — ssh2/exec/UI/token all work for real."

# ----------------------------------------------------------------------------
# 4) zip + sha256
# ----------------------------------------------------------------------------
log "Building $ZIP_NAME …"
(cd "$DIST" && rm -f "$ZIP_NAME" && zip -r -q "$ZIP_NAME" hem-manager)
(cd "$DIST" && sha256sum "$ZIP_NAME" > "$ZIP_NAME.sha256")

echo
log "================= final output ================="
log "zip     : $ZIP ($(du -h "$ZIP" | cut -f1))"
log "sha256  : $(cut -d' ' -f1 "$DIST/$ZIP_NAME.sha256")"
log "exe     : $STAGE/hem-manager.exe ($(du -h "$STAGE/hem-manager.exe" | cut -f1))"
log "ui      : $STAGE/ui ($(du -sh "$STAGE/ui" | cut -f1))"
log "linux  : $LINUX_DIR/hem-manager ($(du -h "$LINUX_DIR/hem-manager" | cut -f1)) — live-tested"
echo
log "zip contents:"
# File membership is checked with a "one-shot listing held in a variable" —
# not `unzip -l | grep -q`. Reason: under pipefail, grep -q with an early
# match (e.g. ui/index.html near the top of the listing) kills unzip with
# SIGPIPE, the pipeline exits 141, and a "file missing" false failure is
# produced — the same pattern recorded in release.sh (the 14:27 run) that
# was mistakenly reintroduced during the v0.3.2-beta.2 checks.
ZIP_LISTING="$(unzip -l "$ZIP")"
printf '%s\n' "$ZIP_LISTING" | sed 's/^/  /'
LF=$'\n'
ZIP_NAMES="$LF$(printf '%s\n' "$ZIP_LISTING" | awk 'NR>3 && NF==4 {print $4}')$LF"
zip_has() { # $1 = exact entry name — exit status 0 means present
  case "$ZIP_NAMES" in *"$LF$1$LF"*) return 0 ;; *) return 1 ;; esac
}
# the zip must contain the installer — a package without an installer is never "built".
zip_has "hem-manager/installer/install.sh" \
  || fail "zip is missing installer/install.sh — a package without an installer is never built."
# the zip must contain all the app's side files (v0.3.2-beta.2 regression):
# ui/, the Windows scripts, and the guide — an incomplete package is never "built".
zip_has "hem-manager/ui/index.html" \
  || fail "zip is missing ui/index.html — a package without a UI is never built."
zip_has "hem-manager/install.ps1" \
  || fail "zip is missing install.ps1."
zip_has "hem-manager/uninstall.ps1" \
  || fail "zip is missing uninstall.ps1."
zip_has "hem-manager/install-tailscale.ps1" \
  || fail "zip is missing install-tailscale.ps1 — the offline Tailscale installer script is part of the package."
TS_MSI_ZIP_NAME="$(basename "${TS_MSI_PATH:-}")"
[ -n "$TS_MSI_ZIP_NAME" ] || fail "TS_MSI_PATH was not set — the MSI bundling step did not run."
zip_has "hem-manager/vendor/tailscale/$TS_MSI_ZIP_NAME" \
  || fail "zip is missing vendor/tailscale/$TS_MSI_ZIP_NAME — the OFFICIAL Tailscale MSI must ship inside the package (user directive: local/offline install)."
zip_has "hem-manager/README-WINDOWS-FA.txt" \
  || fail "zip is missing README-WINDOWS-FA.txt."
# and the bytes of the text files inside the zip must satisfy the same contract (BOM+CRLF).
rm -rf "$DIST/zip-guard" && mkdir -p "$DIST/zip-guard"
unzip -q "$ZIP" "hem-manager/install.ps1" "hem-manager/uninstall.ps1" "hem-manager/install-tailscale.ps1" "hem-manager/README-WINDOWS-FA.txt" -d "$DIST/zip-guard"
guard_windows_text "$DIST/zip-guard/hem-manager/install.ps1" "$DIST/zip-guard/hem-manager/uninstall.ps1" "$DIST/zip-guard/hem-manager/install-tailscale.ps1" "$DIST/zip-guard/hem-manager/README-WINDOWS-FA.txt" \
  || fail "text files inside the zip violate the BOM+CRLF contract."
grep -q "@VERSION@" "$DIST/zip-guard/hem-manager/README-WINDOWS-FA.txt" && fail "README inside the zip still contains @VERSION@."
grep -q "نسخهٔ $VERSION" "$DIST/zip-guard/hem-manager/README-WINDOWS-FA.txt" || fail "README inside the zip lacks the Persian version marker for $VERSION."
# the MSI inside the zip must be byte-identical to the pinned official one
# (digest re-verified — a corrupted or swapped zip is never shipped silently)
unzip -q "$ZIP" "hem-manager/vendor/tailscale/$TS_MSI_ZIP_NAME" -d "$DIST/zip-guard"
TS_MSI_PINNED_SHA="$(grep -m1 '^TS_MSI_SHA256=' "$SCRIPT_DIR/fetch-tailscale-msi.sh" | cut -d'"' -f2)"
TS_MSI_ZIP_SHA="$(sha256sum "$DIST/zip-guard/hem-manager/vendor/tailscale/$TS_MSI_ZIP_NAME" | cut -d' ' -f1)"
[ "$TS_MSI_ZIP_SHA" = "$TS_MSI_PINNED_SHA" ] \
  || fail "the Tailscale MSI inside the zip does not match the pinned SHA-256 — refusing to ship."
log "verified inside the zip: install-tailscale.ps1 (BOM+CRLF) + $TS_MSI_ZIP_NAME (SHA-256 = pinned)."
rm -rf "$DIST/zip-guard"
echo

# Clean up the obsolete cache (v0.3.1 §1): ui-out is no longer an input or an
# output; the UI is always built fresh. This folder is git-ignored.
rm -rf "$AGENT_DIR/ui-out"
log "removed the stale ui-out folder (obsolete cache)."
log "Honest note: the Windows exe is a cross-compile of this same source and"
log "cannot run on this Linux box; the Linux binary from the same source was"
log "verified live (UI, token/cookie, TOFU connection, real SSH exec). Testing"
log "on Windows itself must be repeated on real Windows at the first opportunity."
