// فراخوانی hsctl روی سرور — پشتیبان/بازیابی/ارتقا (§4) همه از همین جا می‌گذرند.
// ترتیب کشف: ۱) hsctl روی PATH سرور  ۲) مسیر صریح پروفایل (hsctlPath)  ۳) مسیر
// نصب پیش‌فرض /opt/headscale-easy-manager/hsctl. اگر هیچ‌کدام نبود → NOT_AVAILABLE
// صادقانه (این قابلیت‌ها «پس از نصب اولیه» معنا دارند — نصب نشده = صادقانه رد).

import { HemError } from "./errors";
import { shellQuote, type SshSession } from "./ssh";

export const DEFAULT_REMOTE_INSTALL_DIR = "/opt/headscale-easy-manager";

export type HsctlArgv = string[];

export async function resolveHsctl(ssh: SshSession, hsctlPath?: string): Promise<HsctlArgv | null> {
  // ۱) روی PATH
  const onPath = await ssh.exec("command -v hsctl", { timeoutMs: 10_000 }).catch(() => null);
  if (onPath && onPath.code === 0 && onPath.stdout.trim().length > 0) {
    return ["hsctl"];
  }
  // ۲) مسیر صریح پروفایل (فایل اسکریپت روی سرور)
  if (hsctlPath && hsctlPath !== "hsctl") {
    const t = await ssh.exec(`test -f ${shellQuote(hsctlPath)}`, { timeoutMs: 10_000 }).catch(() => null);
    if (t && t.code === 0) return ["python3", hsctlPath];
  }
  // ۳) مسیر نصب پیش‌فرض
  const def = `${DEFAULT_REMOTE_INSTALL_DIR}/hsctl`;
  const t2 = await ssh.exec(`test -f ${shellQuote(def)}`, { timeoutMs: 10_000 }).catch(() => null);
  if (t2 && t2.code === 0) return ["python3", def];
  return null;
}

/** خطای تایپ‌شدهٔ «hsctl نیست» — پیام قراردادی مأموریت */
export function hsctlNotAvailable(): HemError {
  return new HemError("NOT_AVAILABLE", undefined, {
    hint: "پس از نصب اولیه (بخش نصب)، hsctl روی سرور در دسترس می‌شود.",
  });
}

/** ساخت رشتهٔ فرمان hsctl با آرگومان‌ها */
export function hsctlCommand(argv: HsctlArgv, args: string[]): string {
  return [...argv, ...args].map(shellQuote).join(" ");
}
