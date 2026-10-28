# Headscale Easy Manager

> Languages: **English** · [فارسی (Persian)](README-FA.md)

**A Windows desktop app + Persian web console for setting up and managing a private Headscale network — with a real SSH connection to your server, a staged installer, and a full management panel.**

This project is built for anyone who owns a server (an Ubuntu VPS) and wants to set up and run their own private network with [Headscale](https://headscale.net) (the open-source, self-hosted control server of Tailscale) — without being a Linux expert: install from scratch, create users and connection keys, approve devices and routes, back up and upgrade — all from one Persian-language interface, with an honest explanation of every step and no fake demo data.

> Target version: **Headscale v0.29.5** — all technical facts are locked in [`headscale-easy-manager/docs/FACTS.md`](headscale-easy-manager/docs/FACTS.md). Changelog: [`headscale-easy-manager/CHANGELOG.md`](headscale-easy-manager/CHANGELOG.md).

---

## What is this product?

| Component | Description |
|---|---|
| **Windows app** | A single exe file (Bun compile) bundling hem-agent and the UI — no extra dependencies to install (build: the "Windows package" section below) |
| **Persian web console** | A complete RTL console: connection hub, live dashboard, 5-step install wizard, users/devices/keys/routes/policy, configuration, service & logs, backup/upgrade, a secure console, and a 17-chapter learning center |
| **Real SSH connection** | Every operation runs on your server through hem-agent over ssh2 — what you see is the server's real output, not a simulation |
| **Staged installer** | The same 17-step Python installer from the `headscale-easy-manager` repo (with Dry-Run and explicit consent), launched from the web UI with live output |
| **Full management panel** | Backup/restore with per-file verification, upgrade with a real rollback to the previous package, firewall with snapshot and rollback |

## Architecture (short)

```
Your Windows PC                            Your server (Ubuntu VPS)
┌───────────────────────────┐              ┌───────────────────────────┐
│  hem-agent.exe            │  SSH (ssh2)  │  install.sh + hsctl       │
│  ├─ REST + socket.io      │ ═══════════► │  ├─ headscale 0.29.5      │
│  ├─ TOFU host-key pinning │  port 22 only│  ├─ Caddy (automatic TLS) │
│  ├─ Windows secret vault  │              │  └─ UFW (with rollback)   │
│  └─ embedded static UI    │              └───────────────────────────┘
└───────────────────────────┘
```

Three main parts:

1. **`mini-services/hem-agent/`** — the agent service (Bun/TypeScript): the real SSH engine, profile and host-key (TOFU) management, the secret vault, the console allowlist, real headscale CLI adapters, and install execution with live streaming over REST and socket.io.
2. **`src/`** — the Persian web UI (Next.js 16, static export) that opens in your local browser and talks to the agent.
3. **`headscale-easy-manager/`** — the Python installer & CLI repo (`install.sh` + `hsctl`): the single source of truth for installation; the agent uploads and runs exactly this repo on the server.

## Quick start (development)

Prerequisite: [Bun](https://bun.sh) (v1 or newer).

```bash
bun install            # install dependencies
bun run docs:generate  # generate learning-center content from docs/fa (required before dev/build)
bun run dev            # web UI on http://localhost:3000

# agent (in a separate terminal):
cd mini-services/hem-agent
bun install
bun run dev            # service on 127.0.0.1:3005
```

Most tasks also work without a real server: in the connection hub, the "Test server" card one-click fills in a built-in demo SSH server (handy for trying the TOFU flow and the management operations on the real headscale inside the sandbox).

## Windows package (exe)

Building the single-file Windows exe (Bun compile + embedded static UI) is documented in [`mini-services/hem-agent/packaging/`](mini-services/hem-agent/packaging/) — the build script, the requirements, and the signing/release steps.

## Building a release

The release package (tarball + checksum) is built and self-checked with a single command:

```bash
bash scripts/release.sh
```

The script regenerates the learning content, runs `tsc --noEmit` and `lint` as mandatory gates, assembles the package strictly from an allowlist (the Python repo from `git archive HEAD` — no `.git` and no caches; no `.env`, dev database, `node_modules`, or logs), then inspects the tarball itself and writes the output to `download/`:

```
download/headscale-easy-manager-v0.3.2-beta.5.tar.gz
download/headscale-easy-manager-v0.3.2-beta.5.tar.gz.sha256
```

## Folder layout

```
├── src/                        # Persian web UI (Next.js 16 — static export)
│   ├── app/                    # single-page, hash-routed app
│   ├── components/console/     # console sections (connect, dashboard, install, manage, server, …)
│   └── generated/              # ⚙️ generated: learning-center content (docs:generate)
├── scripts/
│   ├── generate-docs.ts        # generates src/generated from docs/fa at build time
│   └── release.sh              # clean, self-checked release package
├── mini-services/hem-agent/    # agent service (real SSH, REST + socket.io, port 3005)
├── headscale-easy-manager/     # core repo: Python installer + hsctl + docs
│   ├── src/hem/                # ~6,000 lines of Python — 17-step install + 17 hsctl subcommands
│   ├── docs/                   # FACTS.md + audit + 17 Persian tutorial chapters (docs/fa)
│   └── tests/                  # 103+ Python tests
├── README.md                   # this file (English — the default project README)
└── README-FA.md                # the Persian version of this README
```

## Tests

| Layer | Command | Coverage |
|---|---|---|
| Python installer/CLI | `cd headscale-easy-manager && make test` | 103+ tests: real dry-run, `--yes` consent, mandatory checksum, honest install states, UFW safety, upgrade rollback, per-file backup verification |
| hem-agent | `cd mini-services/hem-agent && bun test` | 83+ tests against a real (ssh2) test SSH server and the real headscale 0.29.5 binary |
| Web UI | `bun run lint` and `bun run typecheck` | real lint and type-check (also mandatory gates in release.sh) |

## Security

- **Host-key fingerprint (TOFU):** the first connection shows the SHA256/MD5 fingerprints of the server's key and nothing connects without your explicit approval; if the server later presents a different key, the connection is stopped with a security warning (possible MITM), and forgetting a pinned key again requires explicit confirmation.
- **Console allowlist:** the advanced console only runs whitelisted local commands with validated argv (no free shell); the preview is exactly the command that will run, and a blocked command never executes.
- **Secure secret storage on Windows:** the server password is stored only with your consent, through the Windows PasswordVault (Credential Manager); by default no secret is ever written to disk, and audit logs never see the password or a full key.
- **Mandatory checksum:** no headscale package is downloaded or installed unless it matches the official SHA-256.
- Full details: [`headscale-easy-manager/SECURITY.md`](headscale-easy-manager/SECURITY.md) and the independent audit [`headscale-easy-manager/docs/AUDIT-2025-10.md`](headscale-easy-manager/docs/AUDIT-2025-10.md).

---

*Headscale Easy Manager — built for your own private network, on your own control server.*
