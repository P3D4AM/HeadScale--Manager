# Headscale Easy Manager

> Languages: **English** · [فارسی (Persian)](README-fa.md)

**A Persian-language Windows app + smart installer + CLI manager + a 17-chapter Persian tutorial, for setting up a Headscale-based private network**

This product is built for people who want to run their own private network with Headscale (the open-source, self-hosted Tailscale control server) on a VPS — without being a Linux, networking, or VPN expert.

> **Target version:** Headscale **v0.29.5** (verified against the official source) — every technical fact of the project is documented in [`docs/FACTS.md`](docs/FACTS.md).

## What is the product made of?

| Component | Where the code lives | What it does |
|---|---|---|
| **Windows app** (exe) | `mini-services/hem-agent/` in the dev environment | The local agent + Persian web UI; manages the server over **real SSH** |
| **Server installer** | this repo (`install.sh` + `src/hem/`) | Installs from scratch to a working server on Ubuntu — the single source of installation truth (the GUI runs exactly this) |
| **CLI manager** (`hsctl`) | this repo | Day-to-day management on the server itself |
| **Persian docs** | `docs/fa/` (17 chapters) | Beginner-friendly tutorial; readable in the CLI (`hsctl learn`), inside the Windows app, and right here |

> **Honesty note:** the exe package has no digital signature; on first run Windows SmartScreen may show a warning (More info → Run anyway). Full guide: [chapter 15](docs/fa/15-barnameh-windows.md).

## What does it do for you?

- ✅ **Install with a few clicks or one command:** from a bare Ubuntu VPS to a working Headscale server with valid HTTPS
- ✅ **A Windows app with a Persian UI:** real SSH connection (host-key fingerprint/TOFU), a 5-step install wizard, user/device/key/route/policy/config management, backup and upgrade — all with honest results
- ✅ **Pre-flight checks:** OS, architecture, disk, RAM, occupied ports, existing services
- ✅ **Respects an existing server:** a pre-installed Caddy/Headscale is detected; a backup is taken before any change
- ✅ **A safe firewall:** your SSH port is always allowed first
- ✅ **Office network access:** a step-by-step Subnet Router guide (chapter 6) and CCTV cameras (chapter 13)
- ✅ **A Persian learning center:** 17 beginner-friendly chapters (`hsctl learn`, or the "Learn" section of the Windows app)

## Prerequisites (server side)

| Item | Details |
|---|---|
| Server (VPS) | Ubuntu Server 22.04 or 24.04 LTS — amd64/arm64 — at least 1GB RAM and 10GB free disk — a public IP |
| Domain | one subdomain (e.g. `headscale.example.com`) with DNS access (an A record pointing to the server IP) |
| Access | an SSH login with a sudo-capable user |
| Clients | the official Tailscale app (Android/iOS/Windows/macOS/Linux — free) |

> Ubuntu 22.04 is officially supported; Debian 12+ works with an "untested" warning.

## Quick start — five paths

### 1) Windows user (zero commands)

Grab `HeadscaleEasyManager-v<version>-win64.zip` from the official release, verify its SHA-256 against the `.sha256` file next to it, extract, and run `hem-manager.exe` (SmartScreen: **More info → Run anyway**). In the app: "Connect" section → IP/port/user/password or key → approve the host-key fingerprint → "Install server" section. Full guide: [chapter 15](docs/fa/15-barnameh-windows.md).

### 2) Server install with the CLI (the classic path)

After logging in over SSH and fetching this repo:

```bash
cd headscale-easy-manager
sudo ./install.sh
```

The installer is interactive: it asks for the domain, checks DNS, and prints a full report at the end. Unattended mode: `sudo ./install.sh --config hem-install.conf --non-interactive` (a sample config is in `examples/`). Practice without changing anything: `--dry-run`. Full tutorial: [chapter 4](docs/fa/04-nasb-avvalieh.md).

### 3) Developer (this project's sandbox environment)

Three services must be running (ports can be changed from the defaults):

```bash
# 1) Web UI (Next.js) — port 3000
bun run dev
# 2) Management agent (hem-agent) — port 3005
cd mini-services/hem-agent && bun run dev
# 3) Test/demo SSH server — port 2222 (user z, password hemtest-pass)
cd mini-services/hem-agent && bun run test-server
```

The API/flow contract: [`docs/AGENT-API.md`](docs/AGENT-API.md) — binding for both the agent and the UI.

### 4) Building the Windows package

```bash
cd mini-services/hem-agent
bash packaging/build-windows.sh          # or: bun run package:windows
```

Output under `packaging/dist/`: the `hem-manager/` folder (exe + ui + install/uninstall.ps1 + the Persian guide), `HeadscaleEasyManager-v<VER>-win64.zip` + `.sha256`, and a Linux binary of the same source that is **verified live** (UI, token, TOFU connection, and real SSH exec). Pass an already-built UI with `UI_OUT`; without it, the script builds the UI itself. Details and justified deviations: documented throughout the script itself.

### 5) Building a full release

```bash
bash scripts/release.sh    # from the outer project root — the v0.3.1 release path
```

This script owns the release path: build-time learning-content generation (`bun run docs:generate`), type/lint gates, and a clean release package of the repo (`download/headscale-easy-manager-v<VER>.tar.gz` + `.sha256`) with a strict allowlist (no `.git`, no `.env`, no dev database, caches, or logs). The Windows package is built separately via path 4.

## The on-server management tool: `hsctl`

| Command | What it does |
|---|---|
| `hsctl status` / `hsctl doctor [--fix]` | overall status / four-part diagnostics |
| `hsctl users create sara` / `hsctl devices list` | users and devices |
| `hsctl preauth create admin --reusable --expiration 24h` | a pre-auth key (the full value is shown exactly once) |
| `hsctl routes list` / `routes approve <id> --routes <CIDR>` | office-network routes |
| `hsctl backup create` / `backup verify` / `restore` | backup and restore |
| `hsctl update --check` | a safe version-to-version upgrade |
| `hsctl cameras add` / `check` | cameras/NVR |
| `hsctl learn list` / `hsctl learn 15` / `hsctl explain <topic>` | the Persian learning center |
| `hsctl report` | a shareable report (no sensitive data) |

Full reference: `hsctl --help` and [chapter 8](docs/fa/08-modiriyat-roozmareh.md).

## Security

- The Headscale package is downloaded only from the official GitHub release + **SHA-256** verification (on every path — even dry-run and upgrade)
- No password or key is ever printed to logs, output, or reports (an automatic redaction layer); keys are shown **once** and masked
- The Windows app's agent listens only on `127.0.0.1`; it generates a random token on every run and the UI opens with `?token=…`; **it never opens a port to the internet**
- Connections use the two-step host-key fingerprint flow (TOFU); a host-key mismatch → a full stop with a security warning (no automatic bypass)
- Storing the password on Windows happens only with your consent and in Windows Credential Manager (default: memory only)
- The app console runs only pre-approved commands (preview = the exact command) — no free shell
- Every destructive operation requires explicit confirmation; all changes are recorded in `/etc/hem/state.json`
- Details: [`SECURITY.md`](SECURITY.md)

## Persian documentation (17 chapters)

The complete learning center lives in [`docs/fa/`](docs/fa/):

1. What is a VPN? · 2. What is Headscale? · 3. Essential networking concepts · 4. Initial installation · 5. Connecting devices · 6. Office-network access · 7. Exit Node · 8. Day-to-day management · 9. Troubleshooting · 10. Security & maintenance · 11. Glossary · 12. A practical sample project · 13. CCTV cameras & Dahua · 14. Quick reference · **15. The Windows app (managing with a GUI)** · 16. The complete panel tutorial · 17. Connecting Windows to the Headscale server (Tailscale client)

The same chapters are available inside the CLI (`hsctl learn`) and inside the Windows app (the "Learn" section).

## Project structure

```
headscale-easy-manager/            ← this repo (server side)
├── install.sh                     # the bootstrap installer
├── hsctl                          # the CLI entry point
├── src/hem/                       # the Python package: installer, system, network, headscale,
│                                  #   proxy, backup, diagnostics, cameras, learn, core
├── docs/                          # FACTS + AGENT-API + architecture + fa/ (17 Persian chapters)
├── examples/ systemd/ scripts/ tests/

Dev environment (outside this repo):
mini-services/hem-agent/           # the Windows/local agent: src/ (real SSH), test/ (test server),
│                                  #   packaging/build-windows.sh (the exe package), ui/ (served)
Next.js project (src/)             # the Persian web UI — served statically inside the Windows package
scripts/release.sh                 # the full release script
```

## Development and tests

| Suite | Count | Run |
|---|---|---|
| Python (installer/hsctl/learn) | **103 tests** | `python3 -m pytest tests/ -q` |
| hem-agent (real SSH/install/console/backup) | **83 tests** | `cd mini-services/hem-agent && bun test` |

```bash
python3 -m pip install -e ".[dev]"
make test      # pytest
make lint      # ruff
```

> **Testing scope, stated honestly:** real integration tests (a full install on a VPS, systemd, UFW, real certificate issuance, real client connections) must run on a **dedicated Ubuntu 22.04/24.04 test server**. The Windows exe is cross-compiled; in the build environment, "the Linux binary of the same source" is verified live (on every run of `packaging/build-windows.sh`), and testing on Windows itself must be repeated at the first opportunity.

## Pushing the repo to Git

```bash
cd headscale-easy-manager
git remote add origin git@github.com:USERNAME/headscale-easy-manager.git
git push -u origin main
```

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

**A conceptual note:** Headscale is only the network's "coordinator"; data traffic between devices usually flows directly and encrypted (WireGuard). To reach the office network, one device inside the office must become a "subnet router" — the full tutorial is in chapter 6.
