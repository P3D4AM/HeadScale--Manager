# Headscale Easy Manager — Windows Install & Usage Guide (English)

> Languages: **English** · [فارسی (Persian)](README-fa.md)

> The GUI-panel edition: manage Headscale on your VPS from Windows, with zero Linux knowledge.
> Every button in this panel is wired to a real operation on your server (over SSH and the official Headscale CLI) — there is no mock data anywhere.

---

## 1. Installation

1. Get `headscale-easy-manager-win-x64.zip` from the official source and verify its integrity against the `.sha256` file next to it.
2. Extract the contents into a permanent folder (for example `C:\Tools\headscale-easy-manager`). **Do not use the Downloads folder for a permanent install.**
3. Double-click `install.bat`. This step:
   - creates a desktop shortcut and a Start-menu entry;
   - creates your data folder at `%LOCALAPPDATA%\headscale-easy-manager`;
   - needs no Administrator rights.
4. Launch the app via the "Headscale Easy Manager" shortcut.

**Prerequisites:** Windows 10/11 only. No WSL, no Linux, no Docker, no Python, and no manual installation of anything — the app's runtime ships inside the package.

## 2. First run (the recommended flow)

1. The app starts and opens `http://localhost:3000` in your browser (on this machine only — it is not reachable from the internet).
2. On the site, open the **Management Panel** section.
3. **Servers → Add server**: enter the VPS address, the SSH port (default 22), the username, the password or private key, and the sudo method.
4. Press **Test connection** — the app actually connects to the server and shows its **SSH host-key fingerprint**. Compare it with the output of `ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub` on the server (or with what you saw the first time you connected over SSH yourself), then press "Approve host key".
   - If this fingerprint ever changes later, the app drops the connection and warns you — that is your protection against a fake server.
5. **Install Headscale**: a 4-step wizard — environment discovery (OS/RAM/disk/ports, with the real reason behind each problem), settings (domain, MagicDNS, TLS via Caddy or your own proxy), an exact preview of the changes, and staged execution with a live report.
6. After the installation, create a connection key under **Device registration** and connect your devices (ready-made guides for Windows/Android/Linux/macOS are on the same page).

## 3. Day-to-day tasks

- **Dashboard**: the real service/version/health status and user/device counts.
- **Users / devices / keys**: create, rename, delete (with explicit confirmation), expire — all real.
- **Routes (subnet router)** and **Exit Node**: with a three-stage separation (client announces → server approves → clients accept) — the "active" status is not shown until the server-side approval has really happened.
- **Access policy / configuration**: an editor with real validation (line/position errors come from the server itself) + diff + an automatic backup before every change.
- **Backup & restore / upgrade**: with an automatic backup before any destructive operation.
- **Capability matrix**: an honest status of how each CLI capability of the target version is covered.

## 4. Troubleshooting

| Symptom | Action |
|---|---|
| "Server refused the SSH connection" | Is the SSH port open in the VPS firewall? Is `sshd` running on the server? |
| "SSH authentication failed" | Edit the profile's password/key/username. |
| "Host key has changed" | If you rebuilt or moved the server, press "Reset fingerprint" on that same card; otherwise take the warning seriously. |
| The wizard says port 80/443 is occupied | A previous service on the server holds that port — the panel's "Discover" stage shows the exact cause (the process name). |
| The server didn't start (start.bat) | Check `server.log` next to the app; usually port 3000 is occupied — close the other program. |
| "General check" doesn't return 200 | Point the domain's A record at the server's public IP and re-check after a few moments (a real error with a real code is shown as the sample). |
| The panel won't open | Make sure only one instance is running (`stop.bat`, then `start.bat`). |

## 5. Security — what is stored, and where

- **SSH passwords/keys of profiles**: only on your own computer, in `%LOCALAPPDATA%\headscale-easy-manager`, encrypted with AES-256-GCM. If you turn "Save secret" off, nothing is stored at all.
- **Raw keys (connection/API)**: shown exactly once at creation; never stored anywhere.
- The panel listens only on `127.0.0.1`; its API is protected against requests from other websites (Origin/DNS rebinding).
- No operation is performed on the VPS without your explicit confirmation (and a preview of the changes).

## 6. Updating / uninstalling

- **Updating the app itself**: extract the new package and run `install.bat` in the same folder — your data (`%LOCALAPPDATA%`) stays untouched.
- **Upgrading Headscale on the VPS**: from inside the panel, the "Upgrade" section (with an automatic backup).
- **Uninstall**: `uninstall.bat` — your data is not removed; for a complete removal, delete the `%LOCALAPPDATA%\headscale-easy-manager` folder manually.

## 7. Honest reporting

This app never fakes success:
- an "active" status appears only after every required step has really been verified;
- errors are verbatim messages from the server/CLI;
- the "Capability matrix" shows the state of each capability (tested / needs a real VPS / needs a client device / not present in the target version).

---

© Headscale Easy Manager — the full Persian guide: in the app's site, the "Learning Center" section (17 chapters).
