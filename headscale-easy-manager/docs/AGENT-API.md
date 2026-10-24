# HEM Agent — Architecture & API Contract (v1, single source of truth)

Product: **Headscale Easy Manager** — Windows desktop exe + local browser Web UI managing a VPS over **real SSH**.
This document is the binding contract for `mini-services/hem-agent/` (backend) and the Next.js UI (`src/`).

## 1. Runtime & Layout

```
mini-services/hem-agent/
├── package.json          # bun project; deps: express, socket.io, ssh2; dev: @types/*
├── index.ts              # bootstrap: express + socket.io on 127.0.0.1:3005 (env HEM_AGENT_PORT/HOST)
├── tsconfig.json         # strict
├── src/
│   ├── config.ts         # port, home dir (HEM_AGENT_HOME || ~/.hem-agent), version
│   ├── types.ts          # ALL shared types (Profile, SessionState, ProbeResult, …)
│   ├── ssh.ts            # SshSession class over ssh2 (connect/exec/stream/sftp/timeout/keepalive)
│   ├── sessions.ts       # SessionManager: two-phase connect (fingerprint confirm), TTL, keepalive
│   ├── profiles.ts       # profiles.json + known_hosts.json in agent home (0600)
│   ├── secrets.ts        # win32: Credential Manager via PowerShell PasswordVault; else file 0600 (dev). NEVER in logs.
│   ├── audit.ts          # JSONL audit log w/ redaction (passwords, keys, preauthkey/apikey secrets, passphrases)
│   ├── sudo.ts           # detect NOPASSWD (`sudo -n true`); else `sudo -S -p '' <cmd>` password via stdin
│   ├── headscaleExec.ts  # builds headscale invocation per profile.hsMode: 'system-sudo'|'system'|'custom'
│   ├── api.ts            # express routers (see §4)
│   ├── events.ts         # socket.io wiring (see §5)
│   ├── remote/
│   │   ├── probe.ts      # system probe (real commands, §6)
│   │   └── headscale.ts  # ALL headscale CLI adapters (exact 0.29.5 syntax, §7)
│   ├── installer.ts      # upload repo → build answers → dry-run → execute w/ live stream (§8)
│   └── allowlist.ts      # console command allowlist (§9)
├── ui/                   # (optional) static export of Next.js UI; served if present
└── test/
    ├── server.ts         # REAL ssh2 server on 127.0.0.1:2222 (RSA hostkey fixture) exec→local shell
    ├── fixtures/         # generated keys (ed25519 openssh + rsa + passphrase-protected)
    └── *.test.ts         # bun test
```

- `bun run dev` → `bun --hot index.ts`. Server binds **127.0.0.1 only**. Gateway access in sandbox uses `?XTransformPort=3005` (agent MUST ignore the query param itself).
- Optional bearer token (`X-HEM-Token`): if env `HEM_AGENT_TOKEN` set (desktop mode), every /api request must carry it (header or `hem_token` cookie; comparison is timing-safe). UI is opened with `/?token=…` — **one-time exchange (v0.3.1 §4)**: the first GET of a UI path with the correct token sets a session cookie (`HttpOnly; SameSite=Strict`, no Max-Age) and 303-redirects to the same path without `token` (other query params like `XTransformPort` are preserved); replaying the link from browser history/logs never yields another cookie, and `token` in a query string is never an API auth method. WebSocket (socket.io) connections are authenticated the same way — connections without a valid header/cookie are disconnected immediately and receive no events. Tests: `test/auth.test.ts` (positive+negative). In sandbox dev it is unset.
- **UI static serving**: if `ui/` dir exists → serve it at `/` (SPA fallback to index.html, no cache headers for index.html). Else `/` returns `{ok:true, service:'hem-agent'}`.

## 2. Facts (verified against REAL headscale v0.29.5 binary in this sandbox)

- Binary runs at `/tmp/hs-bin/headscale`, server config `/home/z/hs-test/config.yaml`, socket `/home/z/hs-test/run/headscale.sock`, health `http://127.0.0.1:8080/health` → `{"status":"pass"}`.
- **NO top-level `routes` command**; use `nodes list-routes` / `nodes approve-routes --identifier <ID> --routes <comma-list>` (empty string = revoke all).
- `preauthkeys create -u <USER_ID> --reusable --ephemeral -e 24h --tags tag:x` → prints **full key once**.
- `preauthkeys list -o json` (⚠️ **NO --user flag**) → array of `{user:{id,name},id,key:"masked***",reusable,expiration,created_at}`.
- `preauthkeys expire --id <ID>` / `preauthkeys delete --id <ID>` — need `-u`? (verify with --help in tests; factory default: expire uses `--id`).
- `users list|create <NAME>|rename --identifier? (verify exact flags via --help)|destroy --identifier <ID>|--name <NAME>`
- `nodes list -o json`, `nodes expire --identifier <ID> [--disable]`, `nodes rename --identifier <ID> <NEW>` (verify), `nodes tag --identifier <ID> --tags <T>`, `nodes delete --identifier <ID>`
- `policy get -o json` (errors when no policy set → agent maps to `{policy:null}`), `policy set -f <file>` (verify flag), `policy check`
- `apikeys create --expiration 90d` → full key once; `apikeys list` (table, masked); `apikeys expire --prefix <P>`
- `configtest` (validates config), `dump_config`, `version`, `health`
- Global flags: `-c/--config`, `-o json|json-line|yaml`, `--force` (skip prompts on destructive ops)
- Installer repo to upload: `/home/z/my-project/headscale-easy-manager` (env `HEM_PROJECT_ROOT` override).

## 3. Sessions & Connection Flow (two-phase TOFU)

1. `POST /api/connect` `{profileId?|inline:{host,port,username,authMethod:'password'|'key',password?,keyPath?,keyContent?,passphrase?,hsMode,hsCustomPrefix?}, sessionId?, fingerprintAccept?}`
   - Agent connects (ssh2, readyTimeout 15s).
   - Host key check against `known_hosts.json[host:port]`:
     - unknown → respond `{status:"fingerprint-required", sessionId, fingerprint:{algo:"ssh-ed25519", hash:"SHA256:…", base64Md5:"…"}}` (session parked, unauthenticated, 120s TTL). NEVER auto-accept.
     - match → authenticated session; return `{status:"connected", sessionId, serverInfo:{banner?}}`
     - MISMATCH → close socket, respond **409** `{status:"hostkey-changed", error:"HOSTKEY_CHANGED", stored, presented}` + big warning text. No override without `confirmHostKeyChange:true` which requires deleting the stored entry first (`POST /api/known-hosts/forget`).
2. `POST /api/connect/confirm` `{sessionId, accept:true}` → completes login, stores fingerprint, `{status:"connected",…}`. `accept:false` → closes session.
3. Sessions: keepalive every 15s; auto-disconnect on error → event `conn:status`. `GET /api/sessions` lists. `POST /api/disconnect {sessionId}`.
4. Sudo detection per session: `sudo -n true` → `sudoMode:'nopasswd'`; with password → `sudoMode:'password'` (password kept **in memory only**); none → `sudoMode:'none'`.
5. Errors: typed `{error: CODE, message: fa, detail?}`; codes: `AUTH_FAILED, CONNECT_TIMEOUT, HOSTKEY_CHANGED, FINGERPRINT_REQUIRED, NOT_CONNECTED, EXEC_FAILED, PARSE_FAILED, NEED_CONFIRM, UNSUPPORTED, SUDO_REQUIRED, VALIDATION_FAILED, COMMAND_BLOCKED`.

## 4. REST API (all JSON; every mutating op returns REAL result; never fake)

Health & profiles:
- `GET /api/health` → `{ok:true, version, uptimeSec, platform, hsBinaryFound?}`
- `GET/POST /api/profiles`, `PUT/DELETE /api/profiles/:id` — never return secrets (mask: `••••`)
- `GET /api/known-hosts`, `POST /api/known-hosts/forget {host,port,confirm:true}`

Connection: (§3) + `GET /api/sessions`.

Probe & system (per session, path prefix `/api/s/:sid/...`):
- `GET /api/s/:sid/probe` → §6 ProbeResult (real commands)
- `GET /api/s/:sid/system/info|ports|disk` (ports=ss -tulpn parse; disk=df -h /)
- `GET /api/s/:sid/service/:unit/status` (systemctl is-active/is-enabled + `systemctl status` head; fallback: `pgrep -af`, unit missing → `{available:false}`)
- `GET /api/s/:sid/logs?unit=headscale&lines=100` (journalctl -u; fallback: tail server log file path from profile or last 200 lines of `headscale serve` output if custom mode: `/home/z/hs-test/server.log`)
- `GET /api/s/:sid/health` — three-layer real check: (a) `systemctl is-active` OR process check, (b) local curl of health URL (via SSH: `curl -s -m 5 <url>`), (c) `headscale health` CLI. Honest per-layer results.

Headscale management (`/api/s/:sid/hs/...`) — §7 for exact commands; standard response `{ok, data, error?}`:
- `GET users` | `POST users {name}` | `POST users/rename {id,newName}` | `POST users/destroy {id,confirm:true}`
- `GET nodes` | `GET nodes/routes` | `POST nodes/approve-routes {id,routes:[]}` | `POST nodes/expire {id,disable?}` | `POST nodes/rename {id,newName}` | `POST nodes/tag {id,tags:[]}` | `POST nodes/delete {id,confirm:true}`
- `GET preauthkeys` | `POST preauthkeys {userId,reusable?,ephemeral?,expiration?,tags?}` → `{key:"hskey-auth-…FULL…"}` ONCE (audit stores masked only) | `POST preauthkeys/expire {id}` | `POST preauthkeys/delete {id}`
- `GET apikeys` (masked) | `POST apikeys {expiration}` → full key once | `POST apikeys/expire {prefix}`
- `GET policy` → `{policy: string|null, format:'hujson|json'}` | `POST policy/validate {content}` (policy check via temp file) | `POST policy/set {content,confirm:true}` (backup current to /var/backups/hem + apply + verify by re-get)
- `GET config` (redacted server_url etc.? NO — full config, it contains no secrets except maybe db creds; apply same redaction as hsctl) | `POST config/validate {content}` (write temp + `configtest`) | `POST config/set {content,confirm:true}` (backup `.hem-backup-*` + write + configtest + restart service + health re-check; on failure → auto-restore backup)
- `POST service/:action {confirm?}` action ∈ start|stop|restart|enable|disable (stop needs confirm)
- `GET version`

Backup / restore / update (`/api/s/:sid/...`):
- `GET backup/list` (ls /var/backups/hem) | `POST backup/create` (hsctl backup create, real) | `POST backup/verify {file}` (hsctl backup verify → per-file hash results after fix 4.8)
- `POST restore {file,confirm:true}` (backs up current state first: hsctl does `.pre-restore-*`; then `hsctl restore`; then health check; honest report)
- `GET update/check` (current vs pinned/latest) | `POST update/execute {version?,confirm:true}` → runs `hsctl update --yes` (post-fix 4.7 real rollback) streamed via socket.io

Installer: §8. Console: §9. `GET /api/audit?limit=100` (redacted).

## 5. socket.io (default path "/", room per session `sid:<id>`, job rooms `job:<id>`)

Events server→client:
- `conn:status {sessionId,status:'connected'|'disconnected'|'error',detail?}`
- `job:log {jobId,line,stream:'stdout'|'stderr'}` (raw line, live)
- `job:stage {jobId,stage,total,title,risk}` (installer 17 steps parsed from hsctl output markers, or update 5 steps)
- `job:progress {jobId,pct}`
- `job:done {jobId,ok,exitCode,summary}` / `job:error {jobId,error}`
Client→server: `job:cancel {jobId}` (agent sends Ctrl-C / closes stream, never leaves half-run state silently).

## 6. ProbeResult (real, from commands)

`{os:{id,versionId,pretty,arch}, kernel, python3:{version,hasYaml}, systemd:{available,initPid}, disk:{rootGb,availGb}, mem:{totalMb,availMb}, cpu:{cores}, net:{publicIp,isCgnat,addresses[]}, ports:[{proto,local,port,process}], firewall:{ufw:'active|inactive|not-installed',otherRules:boolean}, sudo:{mode:'root|nopasswd|password|none'}, existing:{headscale:{installed,version?,serviceActive},caddy:{…},nginx:{…}}, headscaleConfigExists, hemInstalled:{stateFile,hsctlOnPath}, warnings:[fa…], blockers:[fa…]}`

Blockers (install impossible): non-Debian OS, arch unsupported, disk<10G, no-sudo & non-root, port 80/443 occupied by non-caddy/nginx, headscale installed *without* state (needs adopt decision).

## 7. headscale adapter mapping (agent runs these EXACTLY; verify unknown flags with `--help` at runtime — never guess)

users list→`users list -o json`; create→`users create <NAME> --force`? (only if prompts; verify) ; rename→`users rename --identifier <ID> --new-name <NAME>` (verify via --help; docs say switches exist) ; destroy→`users destroy --identifier <ID> --force`
nodes: list→`nodes list -o json`; routes→`nodes list-routes -o json` (fallback table parse); approve→`nodes approve-routes --identifier <ID> --routes <csv>` (empty string allowed = revoke all); expire→`nodes expire --identifier <ID> [--disable] --force`; rename/tag/delete→ per --help with `--force`.
policy set→`policy set -f <tmpfile>` (verify flag name; if it reads stdin use that). apikeys expire→`apikeys expire --prefix <P>`.
All destructive ops: agent asks UI confirm BEFORE running; after run, re-fetch list to show REAL new state.

## 8. Installer flow (uses Python repo as single source of truth)

1. `POST /api/s/:sid/install/prepare` → sftp-upload tarball of `$HEM_PROJECT_ROOT` (git archive or tar excluding .git/__pycache__/tests) to `/tmp/hem-install-<ts>/` + extract. Returns `{planInputs}` schema.
2. `POST /api/s/:sid/install/validate {settings}` → writes answers file remotely (`answers.conf`, schema = `examples/hem-install.conf.example` fields — `domain, server_ip?, dns_mode, acme_email, caddy_mode: install|reuse|skip, embedded_derp, magic_dns_base, ip_prefixes?, first_user, firewall, ssh_port?, headscale_version?`), runs `bash install.sh --dry-run --config answers.conf --non-interactive` (post-fix 4.1: works pre-install, real exit code) → returns `{exitCode, output, steps[]}` parsed.
3. `POST /api/s/:sid/install/execute {settings,confirm:true}` → runs `sudo -S -p '' bash install.sh --config answers.conf --yes --non-interactive` (or `sudo bash …` under nopasswd) with live `job:*` events; exit code + final health honest (post-fix 4.4). On failure: report stage, suggest `hsctl doctor`; NO fake success.
4. `GET /api/s/:sid/install/state` → parse remote state.json if exists.

## 9. Console allowlist (NO free shell — security requirement)

- Allowed program roots: `headscale`, `hsctl`, `systemctl status|is-active|journalctl?` (status only), `journalctl -u <unit> [-n N]`, `curl -s -m <t> <url>` (scheme http/https, host must be profile host/localhost/127.0.0.1), `ufw status*`, `df -h`, `ss -tulpn`.
- Args are validated (types/ranges), no shell metachars (`;&|$><\`` backticks, quotes normalized), argv-array execution only (ssh exec gets a single safe string built from validated parts — still no user-raw interpolation).
- `POST /api/s/:sid/console/preview {cmd}` → `{allowed, exactCommand}` ; `POST …/console {cmd}` → executes, returns `{exitCode, stdout, stderr}` (streamed if `stream:true` via job events).

## 10. UI contract (frontend)

- Base URL: same-origin `/api/...`; in sandbox dev (port 3000) every fetch/IO appends `XTransformPort=3005` — implement in ONE helper `src/lib/agent.ts` (`agentFetch(path, init)`, `agentSocket()` returns socket.io client connected to `/?XTransformPort=3005` — in desktop mode (served from agent) query param may be omitted; harmless either way. Use env `NEXT_PUBLIC_AGENT_PORT` default `3005`.)
- All UI text: Persian RTL, emerald/slate/amber palette (no blue/indigo), Vazirmatn font, dark default, sticky footer, ≥44px touch targets, real loading/success/failure/unsupported states for EVERY action. No demo data anywhere; empty states explain next real step.
- Sections (hash routes): `#/` dashboard+home, `#/connect`, `#/install`, `#/users`, `#/nodes`, `#/keys`, `#/routes`, `#/policy`, `#/config`, `#/server` (services+logs+ports+disk), `#/backup` (backup/restore/update), `#/console`, `#/learn` (existing 14 chapters, content build-time generated), `#/help` (troubleshooting data). Global header: connection status pill (connected host / disconnected), quick connect button.
- Destructive actions: explicit confirm dialog quoting REAL object names (e.g. node name+id) + typed confirmation for destroy/restore/stop/policy-set/config-set.
- PreAuthKey/APIKey full value: shown ONCE in a copyable secure reveal, warning "این کلید دیگر نمایش داده نمی‌شود".
