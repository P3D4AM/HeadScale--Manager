// Detect the server sudo mode (contract §3.4) — fully real:
//  1) Is the user root?
//  2) sudo -n true → nopasswd
//  3) sudo -S with password from stdin → password (only if the password is actually accepted; otherwise none)
//  4) None of these → none (honest: sudo is not possible with what we have)

import { HemError } from "./errors";
import type { SudoMode } from "./types";
import type { SshSession } from "./ssh";

export interface SudoDetectContext {
  username: string;
  /** SSH password — kept in session memory and used only via stdin */
  password?: string;
}

export async function detectSudoMode(ssh: SshSession, ctx: SudoDetectContext): Promise<SudoMode> {
  if (ctx.username === "root") return "root";

  const res = await ssh.exec("sudo -n true 2>&1", { timeoutMs: 10_000 }).catch(() => null);
  if (res && res.code === 0) return "nopasswd";
  if (res && res.code === 127) return "none"; // sudo itself is not installed

  const out = `${res?.stderr ?? ""}\n${res?.stdout ?? ""}`;
  if (/a password is required|sudo: -n|terminal/i.test(out)) {
    if (!ctx.password) return "none";
    // Real password test — password only via stdin
    const res2 = await ssh
      .exec("sudo -S -p '' -k true", { stdin: ctx.password + "\n", timeoutMs: 12_000 })
      .catch(() => null);
    if (res2 && res2.code === 0) return "password";
    return "none"; // password not accepted for sudo (wrong or not a sudoer)
  }
  return "none";
}

/**
 * Build a sudo-wrapped command for cancellable jobs (execCancellable).
 * Equivalent to SshSession.execSudo but returns a string + stdin so it can be
 * combined with execCancellable. none mode → honest SUDO_REQUIRED.
 */
export function buildSudoInvocation(
  cmd: string,
  mode: SudoMode,
  password?: string,
): { cmd: string; stdin?: string } {
  if (mode === "root") return { cmd };
  if (mode === "nopasswd") return { cmd: `sudo -n ${cmd}` };
  if (mode === "password") {
    if (!password) {
      throw new HemError("SUDO_REQUIRED", "رمز sudo در حافطهٔ نشست موجود نیست.");
    }
    return { cmd: `sudo -S -p '' ${cmd}`, stdin: password + "\n" };
  }
  throw new HemError(
    "SUDO_REQUIRED",
    "برای این عملیات sudo لازم است اما روی این سرور در دسترس نیست.",
  );
}
