// ساخت فراخوانی headscale بر اساس حالت پروفایل (قرارداد §7):
//  - system-sudo: `sudo -n headscale …` یا `sudo -S -p '' headscale …` (رمز از stdin)
//  - system:      `headscale …`
//  - custom:      `<hsCustomPrefix> …` (مثل: /tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml)
// همهٔ فلگ‌ها با باینری واقعی v0.29.5 راستی‌آزمایی شده‌اند (سند AGENT-API §2).

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
  /** مسیر پیکربندی سرور (برای configGet/configSet) */
  configPath?: string;
  /** URL سلامت (پیش‌فرض http://127.0.0.1:8080/health) */
  healthUrl?: string;
  /** مسیر فایل لاگ برای fallback وقتی journalctl نیست */
  logPath?: string;
  /** refresh sudo در صورت نیاز */
  refreshSudo?: () => Promise<SudoMode>;
}

export interface HsRunOptions extends ExecOptions {
  /** جایگزینی --config (مثلاً فایل موقت برای configtest) */
  configOverride?: string;
}

/** جایگذاری/درج فلگ --config در آرگومان‌های برنامه */
function applyConfigOverride(argv: string[], override: string): string[] {
  const out = [...argv];
  const i = out.findIndex((t) => t === "--config" || t === "-c");
  if (i >= 0) {
    if (i + 1 < out.length) out[i + 1] = override;
    else out.splice(i, 1, "--config", override);
    return out;
  }
  // درج بعد از نام برنامه (قبل از زیرفرمان) — فلگ سراسری cobra
  out.splice(1, 0, "--config", override);
  return out;
}

/** ساخت argv کامل فرمان headscale (بدون sudo) */
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

/** اجرای یک فرمان headscale با توجه به حالت پروفایل (sudo فقط از stdin) */
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
