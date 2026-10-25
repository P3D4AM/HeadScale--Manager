// Build headscale invocations according to profile mode (contract §7):
//  - system-sudo: `sudo -n headscale …` or `sudo -S -p '' headscale …` (password via stdin)
//  - system:      `headscale …`
//  - custom:      `<hsCustomPrefix> …` (e.g.: /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml)
// All flags verified against the real v0.29.5 binary (AGENT-API doc §2).

import { HemError } from "./errors";
import { shellQuote, type SshSession } from "./ssh";
import { tokenize } from "./allowlist";
import type { ExecOptions, ExecResult, HsMode, SudoMode } from "./types";

export interface HsRunContext {
  ssh: SshSession;
  hsMode: HsMode;
  hsCustomPrefix?: string;
  sudoMode?: SudoMode;
  sudoPassword?: string;
  /** Server config path (for configGet/configSet) */
  configPath?: string;
  /** Health URL (default http://127.0.0.1:8080/health) */
  healthUrl?: string;
  /** Log file path used as fallback when journalctl is unavailable */
  logPath?: string;
  /** Refresh sudo mode on demand */
  refreshSudo?: () => Promise<SudoMode>;
}

export interface HsRunOptions extends ExecOptions {
  /** Replace the --config flag (e.g. a temp file for configtest) */
  configOverride?: string;
}

/** Replace/insert the --config flag among program args */
function applyConfigOverride(argv: string[], override: string): string[] {
  const out = [...argv];
  const i = out.findIndex((t) => t === "--config" || t === "-c");
  if (i >= 0) {
    if (i + 1 < out.length) out[i + 1] = override;
    else out.splice(i, 1, "--config", override);
    return out;
  }
  // Insert after the program name (before the subcommand) — a global cobra flag
  out.splice(1, 0, "--config", override);
  return out;
}

/** Build the full headscale command argv (without sudo) */
export function buildHsArgv(ctx: HsRunContext, args: string[], opts: { configOverride?: string } = {}): string[] {
  let base: string[];
  if (ctx.hsMode === "custom") {
    const prefix = (ctx.hsCustomPrefix ?? "headscale").trim();
    const toks = tokenize(prefix) ?? prefix.split(/\s+/);
    base = toks.filter((t) => t.length > 0);
  } else {
    base = ["headscale"];
  }
  let argv = [...base, ...args];
  if (opts.configOverride) argv = applyConfigOverride(argv, opts.configOverride);
  return argv;
}

/** Run one headscale command according to profile mode (sudo password only via stdin) */
export async function runHs(ctx: HsRunContext, args: string[], opts: HsRunOptions = {}): Promise<ExecResult> {
  const argv = buildHsArgv(ctx, args, { configOverride: opts.configOverride });
  const cmd = argv.map(shellQuote).join(" ");
  const execOpts: ExecOptions = {
    timeoutMs: opts.timeoutMs,
    onStdout: opts.onStdout,
    onStderr: opts.onStderr,
    stdin: opts.stdin,
  };
  if (ctx.hsMode === "system-sudo") {
    let mode = ctx.sudoMode;
    if (!mode && ctx.refreshSudo) mode = await ctx.refreshSudo();
    if (!mode) mode = "none";
    return ctx.ssh.execSudo(cmd, mode, ctx.sudoPassword, execOpts);
  }
  return ctx.ssh.exec(cmd, execOpts);
}
