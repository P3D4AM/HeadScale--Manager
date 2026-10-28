# The systemd service in Headscale Easy Manager

> Languages: **English** · [فارسی (Persian)](README-fa.md)

## The official service unit

Installing via the official `.deb` package installs a standard systemd unit (`/usr/lib/systemd/system/headscale.service` or your distribution's equivalent path). The official unit (matching the upstream repo, version v0.29.5) looks like this:

```ini
[Unit]
After=network.target
Description=headscale coordination server for Tailscale

[Service]
Type=simple
User=headscale
Group=headscale
ExecStart=/usr/bin/headscale serve
ExecReload=/usr/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5

WorkingDirectory=/var/lib/headscale
ReadWritePaths=/var/lib/headscale

AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
DevicePolicy=closed
LockPersonality=true
MemoryDenyWriteExecute=true
NoNewPrivileges=true
PrivateDevices=true
PrivateMounts=true
PrivateTmp=true
ProcSubset=pid
ProtectClock=true
ProtectControlGroups=true
ProtectHome=true
ProtectHostname=true
ProtectKernelLogs=true
ProtectKernelModules=true
ProtectKernelTunables=true
ProtectProc=invisible
ProtectSystem=strict
RemoveIPC=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
RuntimeDirectory=headscale
RuntimeDirectoryMode=0750
StateDirectory=headscale
StateDirectoryMode=0750
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged
SystemCallFilter=~@resources
UMask=0077

[Install]
WantedBy=multi-user.target
```

The unit is security-hardened: it runs as the dedicated `headscale` user, with a read-only filesystem except `/var/lib/headscale`, syscall restrictions, and more. **You never need to modify it** — the installer and `hsctl` manage exactly this official unit.

## Service-management features provided by the tool

- **Automatic start after a server reboot:** `systemctl enable headscale` (done automatically during installation)
- **A sane restart policy:** `Restart=always` with a 5-second pause (part of the official unit)
- **Protection against multiple instances:** systemd inherently runs only one instance of a `Type=simple` unit under a given name
- **Configuration validation before restart:** `hsctl config validate` (runs `headscale configtest`) — executed before every restart/reload the tool performs
- **Restrictive file permissions:** the config file at `640`, and private keys under `/var/lib/headscale` owned by the `headscale` user

## Common commands

```bash
# Service status
sudo systemctl status headscale

# Start / stop / restart
sudo systemctl start headscale
sudo systemctl stop headscale
sudo systemctl restart headscale

# Enable/disable automatic start at boot
sudo systemctl enable headscale
sudo systemctl disable headscale

# View logs
sudo journalctl -u headscale -n 100          # the last 100 lines
sudo journalctl -u headscale -f              # live follow
sudo journalctl -u headscale --since "1 hour ago"

# Errors only
sudo journalctl -u headscale -p err -n 50

# Re-apply the systemd configuration after changing the unit/an override
sudo systemctl daemon-reload
```

In-tool equivalents: `hsctl status`, `hsctl logs [--follow]`, `hsctl doctor`, and `hsctl config validate`.

## Overrides (changing settings without touching the original file)

If one day you need to change something (for example a resource limit), use an override instead of editing the original file:

```bash
sudo systemctl edit headscale
```

Then, in the editor that opens, for example:

```ini
[Service]
MemoryMax=512M
```

And finally:

```bash
sudo systemctl daemon-reload
sudo systemctl restart headscale
```

The override is stored at `/etc/systemd/system/headscale.service.d/override.conf` and is automatically included in `hsctl backup create` backups as well.

## A note about the CLI socket

`headscale` commands talk to the service through the Unix socket `/var/run/headscale/headscale.sock` (mode `0770`); only `root` or members of the `headscale` group have access. The `hsctl` tool handles this automatically (running sudo when needed), so always run `hsctl` with `sudo`.
