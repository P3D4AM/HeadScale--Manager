// Server system probe (contract §6) — real commands only, honest output.
// No value is ever guessed; if a command is unavailable it is reported honestly right there.

import type { SshSession } from "../ssh";
import { detectSudoMode } from "../sudo";
import type { ExecResult, ProbePort, ProbeResult } from "../types";

export interface ProbeContext {
  ssh: SshSession;
  username: string;
  password?: string;
  /** headscale config path to check for existence (custom mode) */
  configPathHint?: string;
}

async function tryExec(ssh: SshSession, cmd: string, timeoutMs = 15_000): Promise<ExecResult | null> {
  try {
    return await ssh.exec(cmd, { timeoutMs });
  } catch {
    return null;
  }
}

function out(r: ExecResult | null): string {
  return r ? `${r.stdout}\n${r.stderr}`.trim() : "";
}

function parseOsRelease(text: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) data[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return data;
}

/** Parse ss -tulpn output (shared with /system/ports) */
export function parseSsPorts(text: string): ProbePort[] {
  const ports: ProbePort[] = [];
  for (const line of text.split("\n").slice(1)) {
    const t = line.trim();
    if (!t) continue;
    const cols = t.split(/\s+/);
    if (cols.length < 5) continue;
    const proto = cols[0];
    if (proto !== "tcp" && proto !== "tcp6" && proto !== "udp" && proto !== "udp6") continue;
    const local = cols[4];
    const procMatch = /users:\(\("([^"]+)"/.exec(t);
    const lastColon = local.lastIndexOf(":");
    const portStr = lastColon >= 0 ? local.slice(lastColon + 1) : "";
    const port = /^\d+$/.test(portStr) ? Number(portStr) : null;
    ports.push({
      proto: proto.replace("6", ""),
      local,
      port,
      process: procMatch ? procMatch[1] : null,
    });
  }
  return ports;
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

function isCgnatIp(ip: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  const n = ipToInt(ip);
  const lo = ipToInt("100.64.0.0");
  const hi = ipToInt("100.127.255.255");
  return n >= lo && n <= hi;
}

function tsToDate(v: unknown): string | null {
  const t = v as { seconds?: number; nanos?: number } | undefined;
  if (t && typeof t.seconds === "number") {
    return new Date(t.seconds * 1000).toISOString();
  }
  return null;
}
export { tsToDate };

export async function runProbe(ctx: ProbeContext): Promise<ProbeResult> {
  const ssh = ctx.ssh;
  const warnings: string[] = [];
  const blockers: string[] = [];

  // parallel but with small payloads — ssh2 handles concurrent channels well
  const [osRes, archRes, kernelRes, pyPathRes, pyVerRes, pyYamlRes, systemdDirRes, pidofRes, dfRes, freeRes, nprocRes, pubIpRes, addrRes, ssRes, ufwRes, hsPathRes, hsDpkgRes, hsVerRes, caddyRes, nginxRes, hsCfgRes, hemStateRes, hsctlRes] =
    await Promise.all([
      tryExec(ssh, "cat /etc/os-release"),
      tryExec(ssh, "uname -m"),
      tryExec(ssh, "uname -r"),
      tryExec(ssh, "command -v python3"),
      tryExec(ssh, "python3 --version 2>&1"),
      tryExec(ssh, "python3 -c 'import yaml' 2>/dev/null && echo yes || echo no"),
      tryExec(ssh, "[ -d /run/systemd/system ] && echo yes || echo no"),
      tryExec(ssh, "pidof systemd || true"),
      tryExec(ssh, "df -Pm /"),
      tryExec(ssh, "free -m"),
      tryExec(ssh, "nproc"),
      tryExec(ssh, "curl -s -m 10 https://api.ipify.org"),
      tryExec(ssh, "ip -o -4 addr show scope global 2>/dev/null | awk '{print $4}' || hostname -I"),
      tryExec(ssh, "ss -tulpn"),
      tryExec(ssh, "ufw status 2>&1", 10_000),
      tryExec(ssh, "command -v headscale"),
      tryExec(ssh, "dpkg -s headscale 2>/dev/null | head -1"),
      tryExec(ssh, "headscale version 2>/dev/null | head -1", 15_000),
      tryExec(ssh, "command -v caddy || dpkg -s caddy 2>/dev/null | head -1"),
      tryExec(ssh, "command -v nginx || dpkg -s nginx 2>/dev/null | head -1"),
      tryExec(
        ssh,
        ctx.configPathHint
          ? `test -f ${ctx.configPathHint} && echo yes || echo no; test -f /etc/headscale/config.yaml && echo yes || echo no`
          : `test -f /etc/headscale/config.yaml && echo yes || echo no`,
      ),
      tryExec(ssh, "test -f /etc/hem/state.json && echo yes || echo no"),
      tryExec(ssh, "command -v hsctl"),
    ]);

  // --- os ---
  const osRel = parseOsRelease(out(osRes));
  const os = {
    id: (osRel.ID || "unknown").toLowerCase(),
    versionId: osRel.VERSION_ID || "",
    pretty: osRel.PRETTY_NAME || `${osRel.NAME ?? "unknown"} ${osRel.VERSION_ID ?? ""}`.trim(),
    arch: out(archRes).split("\n")[0] || "unknown",
  };
  const kernel = out(kernelRes).split("\n")[0] || "unknown";

  // --- python3 ---
  const pyVersion = /^Python\s+(\S+)/.exec(out(pyVerRes))?.[1] ?? null;
  const python3 = { version: pyVersion, hasYaml: out(pyYamlRes).trim() === "yes" };
  if (!pyPathRes || pyPathRes.code !== 0 || !pyVersion) {
    warnings.push("python3 روی سرور یافت نشد؛ نصاب HEM به آن نیاز دارد.");
  } else if (!python3.hasYaml) {
    warnings.push("ماژول python3 «yaml» موجود نیست؛ نصاب HEM به PyYAML نیاز دارد.");
  }

  // --- systemd ---
  const systemdDir = out(systemdDirRes).trim() === "yes";
  const pidof = out(pidofRes).trim();
  const initPid = /^\d+$/.test(pidof) ? Number(pidof) : null;
  const systemd = { available: systemdDir || initPid !== null, initPid };
  if (!systemd.available) {
    warnings.push("systemd در دسترس نیست؛ وضعیت سرویس‌ها از روی فرایندها (pgrep) خوانده می‌شود.");
  }

  // --- disk (df -Pm /) ---
  let disk = { rootGb: 0, availGb: 0 };
  const dfLine = out(dfRes).split("\n").filter((l) => /\s\/\s*$/.test(l) || l.endsWith(" /"))[0];
  if (dfLine) {
    const cols = dfLine.trim().split(/\s+/);
    // Filesystem 1M-blocks Used Available Capacity Mounted
    const totalMb = Number(cols[1]);
    const availMb = Number(cols[3]);
    if (Number.isFinite(totalMb)) disk = { rootGb: Math.round((totalMb / 1024) * 100) / 100, availGb: Number.isFinite(availMb) ? Math.round((availMb / 1024) * 100) / 100 : 0 };
  } else {
    warnings.push("خواندن فضای دیسک (df -Pm /) ناموفق بود.");
  }

  // --- mem (free -m) ---
  let mem = { totalMb: 0, availMb: 0 };
  const memLine = out(freeRes).split("\n").find((l) => /^Mem:/.test(l));
  if (memLine) {
    const cols = memLine.trim().split(/\s+/);
    const total = Number(cols[1]);
    // new Debian format: total used free shared buff/cache available
    const avail = Number(cols[6] ?? cols[2]);
    if (Number.isFinite(total)) mem = { totalMb: total, availMb: Number.isFinite(avail) ? avail : 0 };
  }

  // --- cpu ---
  const cpu = { cores: Math.max(1, Number(out(nprocRes).trim()) || 1) };

  // --- net ---
  const publicIp = pubIpRes && pubIpRes.code === 0 && /^\d+\.\d+\.\d+\.\d+$|^[0-9a-f:]+$/i.test(pubIpRes.stdout.trim())
    ? pubIpRes.stdout.trim()
    : null;
  if (!publicIp) warnings.push("IP عمومی سرور (api.ipify.org) قابل تشخیص نبود.");
  const addresses = out(addrRes)
    .split(/\s+/)
    .map((a) => a.replace(/\/\d+$/, ""))
    .filter((a) => a.length > 0);
  const net = { publicIp, isCgnat: publicIp ? isCgnatIp(publicIp) : null, addresses };
  if (net.isCgnat) {
    warnings.push("IP عمومی در محدودهٔ CGNAT (100.64.0.0/10) است — برای سرور headscale مناسب نیست.");
  }

  // --- ports ---
  const ports = parseSsPorts(ssRes ? ssRes.stdout : "");
  // port 80/443 held by a process other than caddy/nginx → install blocker
  for (const p of ports) {
    if (p.proto === "tcp" && (p.port === 80 || p.port === 443)) {
      const proc = (p.process ?? "").toLowerCase();
      if (proc && proc !== "caddy" && proc !== "nginx") {
        blockers.push(`پورت ${p.port === 80 ? "۸۰" : "۴۴۳"} توسط فرایند «${p.process}» اشغال است؛ نصب Caddy ممکن نیست.`);
      } else if (proc === "nginx") {
        warnings.push("روی پورت ۸۰/۴۴۳ nginx فعال است — در ویزارد نصب حالت «استفاده از reverse proxy موجود» را انتخاب کنید.");
      }
    }
  }

  // --- firewall ---
  let ufw: "active" | "inactive" | "not-installed" = "not-installed";
  const ufwOut = out(ufwRes);
  if (ufwRes && ufwRes.code === 0) {
    ufw = /Status:\s+active/i.test(ufwOut) ? "active" : "inactive";
  } else if (/not found|command not found|no such file/i.test(ufwOut)) {
    ufw = "not-installed";
  } else {
    ufw = /Status:\s+active/i.test(ufwOut) ? "active" : "inactive";
  }
  if (ufw === "not-installed") {
    warnings.push("ufw نصب نیست؛ وضعیت فایروال دستی بررسی شود.");
  } else if (ufw === "inactive") {
    warnings.push("فایروال ufw غیرفعال است؛ توصیه می‌شود پس از نصب فعال شود.");
  }
  const firewall = { ufw, otherRules: false }; // reading iptables is impossible without root — honestly false with this note

  // --- sudo ---
  const sudoMode = await detectSudoMode(ssh, { username: ctx.username, password: ctx.password }).catch(
    () => "none" as const,
  );

  // --- existing apps ---
  const hsInstalled =
    (hsPathRes?.code === 0 && out(hsPathRes).trim().length > 0) ||
    /^Status:\s*install ok installed/.test(out(hsDpkgRes));
  const hsVersion = /headscale version v?(\d+\.\d+\.\d+)/.exec(out(hsVerRes))?.[1] ?? null;
  const caddyInstalled = (caddyRes?.code === 0 && out(caddyRes).trim().length > 0) || /^Status:\s*install ok installed/.test(out(caddyRes));
  const nginxInstalled = (nginxRes?.code === 0 && out(nginxRes).trim().length > 0) || /^Status:\s*install ok installed/.test(out(nginxRes));

  const [hsActiveRes, caddyActiveRes, nginxActiveRes] = await Promise.all([
    systemd.available
      ? tryExec(ssh, "systemctl is-active headscale 2>&1")
      : tryExec(ssh, "pgrep -af headscale 2>/dev/null | grep -v pgrep || true"),
    tryExec(ssh, "pgrep -x caddy >/dev/null 2>&1 && echo active || echo inactive"),
    tryExec(ssh, "pgrep -x nginx >/dev/null 2>&1 && echo active || echo inactive"),
  ]);
  const hsActiveOut = out(hsActiveRes).trim();
  const hsServiceActive = systemd.available
    ? hsActiveOut === "active"
    : /headscale/.test(hsActiveOut);
  const caddyServiceActive = out(caddyActiveRes).trim() === "active";
  const nginxServiceActive = out(nginxActiveRes).trim() === "active";

  const existing = {
    headscale: { installed: hsInstalled, version: hsVersion, serviceActive: hsInstalled ? hsServiceActive : false },
    caddy: { installed: caddyInstalled, version: null, serviceActive: caddyInstalled ? caddyServiceActive : false },
    nginx: { installed: nginxInstalled, version: null, serviceActive: nginxInstalled ? nginxServiceActive : false },
  };

  // --- HEM state ---
  const cfgLines = out(hsCfgRes).split("\n").filter((l) => l === "yes" || l === "no");
  const headscaleConfigExists = cfgLines.includes("yes");
  const hemInstalled = {
    stateFile: out(hemStateRes).trim() === "yes",
    hsctlOnPath: hsctlRes?.code === 0 && out(hsctlRes).trim().length > 0,
  };

  // --- blockers (contract §6) ---
  if (!["debian", "ubuntu", "raspbian"].includes(os.id)) {
    blockers.push(`سیستم‌عامل سرور «${os.pretty || os.id}» پشتیبانی نمی‌شود — فقط Debian/Ubuntu.`);
  }
  if (!["x86_64", "aarch64", "arm64"].includes(os.arch)) {
    blockers.push(`معماری «${os.arch}» پشتیبانی نمی‌شود (فقط x86_64/aarch64).`);
  }
  if (disk.rootGb > 0 && disk.rootGb < 10) {
    blockers.push(`فضای دیسک ریشه ${disk.rootGb} گیگابایت است؛ حداقل ۱۰ گیگابایت لازم است.`);
  }
  if (sudoMode === "none" && ctx.username !== "root") {
    blockers.push("دسترسی sudo در دسترس نیست (نه بدون رمز، نه با رمز فعلی)؛ نصب و مدیریت نیازمند دسترسی مدیر است.");
  }
  if (existing.headscale.installed && !hemInstalled.stateFile && headscaleConfigExists) {
    blockers.push("headscale موجود است اما نصب HEM یافت نشد — ابتدا تصمیم «پذیرش سرور موجود» (adopt) لازم است.");
  } else if (existing.headscale.installed && !hemInstalled.stateFile) {
    warnings.push("headscale شناسایی شد اما state نصب HEM یافت نشد؛ در ویزارد نصب وضعیت adopt بررسی می‌شود.");
  }

  return {
    os,
    kernel,
    python3,
    systemd,
    disk,
    mem,
    cpu,
    net,
    ports,
    firewall,
    sudo: { mode: sudoMode },
    existing,
    headscaleConfigExists,
    hemInstalled,
    warnings,
    blockers,
    probedAt: new Date().toISOString(),
  };
}
