// hsctl invocation on the server — backup/restore/update (§4) all go through here.
// Discovery order: 1) hsctl on the server PATH  2) explicit profile path (hsctlPath)  3) the
// default install path /opt/headscale-easy-manager/hsctl. If none exists → honest
// NOT_AVAILABLE (these features only exist "after first install" — not installed = honest refusal).

import { HemError } from "./errors";
import { shellQuote, type SshSession } from "./ssh";

export const DEFAULT_REMOTE_INSTALL_DIR = "/opt/headscale-easy-manager";

export type HsctlArgv = string[];

export async function resolveHsctl(ssh: SshSession, hsctlPath?: string): Promise<HsctlArgv | null> {
  // 1) on PATH
  const onPath = await ssh.exec("command -v hsctl", { timeoutMs: 10_000 }).catch(() => null);
  if (onPath && onPath.code === 0 && onPath.stdout.trim().length > 0) {
    return ["hsctl"];
  }
  // 2) explicit profile path (script file on the server)
  if (hsctlPath && hsctlPath !== "hsctl") {
    const t = await ssh.exec(`test -f ${shellQuote(hsctlPath)}`, { timeoutMs: 10_000 }).catch(() => null);
    if (t && t.code === 0) return ["python3", hsctlPath];
  }
  // 3) default install path
  const def = `${DEFAULT_REMOTE_INSTALL_DIR}/hsctl`;
  const t2 = await ssh.exec(`test -f ${shellQuote(def)}`, { timeoutMs: 10_000 }).catch(() => null);
  if (t2 && t2.code === 0) return ["python3", def];
  return null;
}

/** Typed "hsctl unavailable" error — the mission's contractual message */
export function hsctlNotAvailable(): HemError {
  return new HemError("NOT_AVAILABLE", undefined, {
    hint: "پس از نصب اولیه (بخش نصب)، hsctl روی سرور در دسترس می‌شود.",
  });
}

/** Build the hsctl command string with arguments */
export function hsctlCommand(argv: HsctlArgv, args: string[]): string {
  return [...argv, ...args].map(shellQuote).join(" ");
}
