// تشخیص حالت sudo روی سرور (قرارداد §3.4) — کاملاً واقعی:
//  1) کاربر root؟
//  2) sudo -n true → nopasswd
//  3) sudo -S با رمز از stdin → password (اگر رمز واقعاً پذیرفته شد؛ وگرنه none)
//  4) هیچ‌کدام → none (صادقانه: با آنچه داریم sudo ممکن نیست)

import { HemError } from "./errors";
import type { SudoMode } from "./types";
import type { SshSession } from "./ssh";

export interface SudoDetectContext {
  username: string;
  /** رمز عبور SSH — در حافظهٔ نشست نگه داشته می‌شود و فقط از stdin استفاده می‌شود */
  password?: string;
}

export async function detectSudoMode(ssh: SshSession, ctx: SudoDetectContext): Promise<SudoMode> {
  if (ctx.username === "root") return "root";

  const res = await ssh.exec("sudo -n true 2>&1", { timeoutMs: 10_000 }).catch(() => null);
  if (res && res.code === 0) return "nopasswd";
  if (res && res.code === 127) return "none"; // خود sudo نصب نیست

  const out = `${res?.stderr ?? ""}\n${res?.stdout ?? ""}`;
  if (/a password is required|sudo: -n|terminal/i.test(out)) {
    if (!ctx.password) return "none";
    // آزمون واقعی رمز — رمز فقط از stdin
    const res2 = await ssh
      .exec("sudo -S -p '' -k true", { stdin: ctx.password + "\n", timeoutMs: 12_000 })
      .catch(() => null);
    if (res2 && res2.code === 0) return "password";
    return "none"; // رمز برای sudo پذیرفته نشد (نادرست یا بدون امتیار sudoer)
  }
  return "none";
}

/**
 * ساخت فرمان sudo-wrapped برای jobهای قابل‌لغو (execCancellable).
 * هم‌ارز SshSession.execSudo است اما به‌صورت رشته + stdin برمی‌گردد تا با
 * execCancellable ترکیب شود. حالت none → SUDO_REQUIRED صادقانه.
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
