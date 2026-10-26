import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { inCompiledBinary } from "./exepath";

/** Agent version — kept in sync with package.json (v0.3.2: Windows UI bug fix) */
export const AGENT_VERSION = "0.3.2-beta.5"; // development pre-release (develop) — stable branch: main

/** Bind address (loopback by default — network access must be a conscious, token-protected choice) */
export function agentHost(): string {
  return process.env.HEM_AGENT_HOST || "127.0.0.1";
}

/** Is the bind address loopback-only? (127.x / localhost / ::1 — open mode is allowed only there) */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === "localhost" || h === "::1" || h === "[::1]") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/** Default port 3005 — reachable through the gateway with ?XTransformPort=3005 */
export function agentPort(): number {
  const p = Number(process.env.HEM_AGENT_PORT || 3005);
  if (!Number.isInteger(p) || p <= 0 || p > 65535) return 3005;
  return p;
}

/** Agent home folder — profiles, known_hosts, audit log and secrets (dev mode) */
export function agentHome(): string {
  return process.env.HEM_AGENT_HOME || path.join(homedir(), ".hem-agent");
}

/** Optional X-HEM-Token (desktop mode) */
export function agentToken(): string | undefined {
  const t = process.env.HEM_AGENT_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

// ---------------------------------------------------------------------------
// Auth policy (v0.3.2 §2 — the "pass-through without token" security fix)
//
// Bug: previously, if HEM_AGENT_TOKEN was not set, the /api middleware let
// requests through "unauthenticated" and WebSocket was equally exposed; in
// other words: no token meant an open service — the exact opposite of the
// secure behavior (fail-closed).
//
// New model — three explicit states:
//   • token: all /api routes (except the minimal public health endpoint) and
//     all WebSockets require the X-HEM-Token header or the hem_token cookie
//     (timing-safe comparison).
//   • open:  the "documented and restricted" local-development exception —
//     only with an explicit HEM_AGENT_AUTH=open and only on a loopback
//     address; anything else stops startup with a clear error.
//   • No token and nothing explicit: the service "refuses to start"
//     (non-zero exit with a clear message). The API layer also answers with a
//     defensive 503 AUTH_NOT_CONFIGURED (defense-in-depth for direct
//     createApp calls in tests).
//
// Desktop mode is always token-protected: an explicit token, or a secure
// random one generated for that single run (randomBytes(24)) — never open.
// (v0.3.2-beta.3: these messages go to the console/terminal — English-only
// per user directive; the browser UI strings stay Persian.)
// ---------------------------------------------------------------------------

export type AgentAuthMode = "token" | "open";

export interface AuthPlan {
  mode: AgentAuthMode;
  /** Active token in token mode (explicit, or generated for this run) */
  token?: string;
  /** true = a token generated for this run (desktop only) */
  tokenGenerated: boolean;
  desktop: boolean;
}

export interface AuthPlanInput {
  /** HEM_AGENT_AUTH value (optional — empty means unset) */
  auth?: string;
  /** HEM_AGENT_TOKEN value (optional — empty means unset) */
  token?: string;
  desktop: boolean;
}

export type AuthPlanResult = { ok: true; plan: AuthPlan } | { ok: false; code: string; message: string };

/** Policy validation — a pure, testable function; every combination explicit and unambiguous */
export function resolveAuthPlan(input: AuthPlanInput): AuthPlanResult {
  const auth = (input.auth ?? "").trim().toLowerCase();
  // A whitespace-only token counts as unset (equivalent to
  // resolveDesktopMode/agentAuthPolicy) — otherwise a "two-space token" would
  // be accepted as a real token in token mode.
  const token = input.token && input.token.trim().length > 0 ? input.token : undefined;

  // Invalid HEM_AGENT_AUTH value — anything other than token/open is rejected
  if (auth && auth !== "token" && auth !== "open") {
    return {
      ok: false,
      code: "AUTH_INVALID_POLICY",
      message:
        `HEM_AGENT_AUTH="${input.auth}" is not valid. Allowed values: token or open ` +
        "(or leave it unset to use HEM_AGENT_TOKEN).",
    };
  }

  if (auth === "open") {
    if (input.desktop) {
      return {
        ok: false,
        code: "AUTH_DESKTOP_REQUIRES_TOKEN",
        message:
          "Desktop mode always runs with a token (explicit, or generated for this run) and is not compatible with open mode. " +
          "Remove HEM_AGENT_AUTH.",
      };
    }
    if (token) {
      return {
        ok: false,
        code: "AUTH_OPEN_WITH_TOKEN",
        message:
          "HEM_AGENT_AUTH=open and HEM_AGENT_TOKEN are both set — this combination is ambiguous. " +
          "For authentication, remove HEM_AGENT_AUTH; for local no-token development, remove HEM_AGENT_TOKEN.",
      };
    }
    return { ok: true, plan: { mode: "open", token: undefined, tokenGenerated: false, desktop: false } };
  }

  if (auth === "token" && !token && !input.desktop) {
    return {
      ok: false,
      code: "AUTH_TOKEN_MISSING",
      message:
        "HEM_AGENT_AUTH=token is set but HEM_AGENT_TOKEN is empty. Set a token " +
        "or remove HEM_AGENT_AUTH.",
    };
  }

  // auth = "token" or unset -> token policy; explicit token or (desktop) generated
  if (token || input.desktop) {
    return { ok: true, plan: { mode: "token", token, tokenGenerated: !token && input.desktop, desktop: input.desktop } };
  }

  // No token and open not explicitly requested -> we refuse to start (fail-closed)
  return {
    ok: false,
    code: "AUTH_NOT_CONFIGURED",
    message:
      "No token is configured; the service refuses to start without authentication.\n" +
      "  - For real deployments: set HEM_AGENT_TOKEN to a long random secret.\n" +
      "  - For local development only (loopback): explicitly set HEM_AGENT_AUTH=open — " +
      "it runs without authentication on 127.0.0.1 only.",
  };
}

/** HEM_AGENT_AUTH value from the environment (no validation — validation lives in resolveAuthPlan) */
export function agentAuthPolicy(): string | undefined {
  const v = process.env.HEM_AGENT_AUTH;
  return v && v.trim().length > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Desktop mode (v0.3.2-beta.2 — the "EXE flash-close" fix):
//
// Bug: in v0.3.2-beta.1, a "bare" hem-manager.exe run on Windows
// (double-click, no environment variables at all) had no token, no
// HEM_DESKTOP, nothing explicit — the fail-closed policy behaved correctly
// (AUTH_NOT_CONFIGURED + exit≠0) but the "user-visible" result was the console
// window closing instantly with nothing readable. The default launch path of
// "the packaged Windows app" had never been mapped to desktop mode.
//
// New model — three explicit routes + one "enclosed" automatic rule:
//   1) HEM_DESKTOP=1 or --desktop (explicit — as before);
//   2) Windows packaged rule: a compiled binary on win32 "with no token and
//      no HEM_AGENT_AUTH" = the user's double-click -> desktop; a random
//      token is generated for that run (same secure model as v0.3.2 §2 —
//      never open). User explicitness always wins: if HEM_AGENT_TOKEN or
//      HEM_AGENT_AUTH is set, the automatic rule is off (service/dev runs
//      untouched).
//   3) All other cases (Linux, dev runs with bun, ...): as before, the
//      fail-closed lock — "refuses to start" with a clear error.
// ---------------------------------------------------------------------------

export interface DesktopModeInput {
  env?: Record<string, string | undefined>;
  argv?: string[];
  /** process.platform */
  platform?: string;
  /** Are we running from inside a compiled binary? ($bunfs / ~BUN virtual fs member) */
  compiledBinary?: boolean;
}

/** Pure and testable — "is this run a desktop run?" */
export function resolveDesktopMode(input: DesktopModeInput): boolean {
  const env = input.env ?? {};
  const argv = input.argv ?? [];
  const platform = input.platform ?? process.platform;
  const compiled = input.compiledBinary ?? false;

  // 1) Explicit — always wins
  if (env.HEM_DESKTOP === "1" || argv.includes("--desktop")) return true;

  // 2) Windows packaged rule — only when there is NO explicit auth config at
  //    all. A set token or HEM_AGENT_AUTH means the user/service decided.
  //    Empty/whitespace values do NOT count as "set" (same as agentAuthPolicy).
  const tokenSet = !!(env.HEM_AGENT_TOKEN && env.HEM_AGENT_TOKEN.trim().length > 0);
  const authSet = !!(env.HEM_AGENT_AUTH && env.HEM_AGENT_AUTH.trim().length > 0);
  if (platform === "win32" && compiled && !tokenSet && !authSet) {
    return true;
  }
  return false;
}

/**
 * Desktop mode for this actual run.
 * Behavior: if HEM_AGENT_TOKEN is not set, a random one-time token for this
 * run is generated, the UI URL with ?token= is printed and the default
 * browser opens (index.ts). The API accepts the token from the X-HEM-Token
 * header "or" the hem_token cookie (api.ts) — so the UI works in desktop
 * mode without any change.
 */
export function desktopMode(): boolean {
  return resolveDesktopMode({
    env: process.env,
    argv: process.argv,
    platform: process.platform,
    compiledBinary: inCompiledBinary(import.meta.dir),
  });
}

// ---------------------------------------------------------------------------
// Python installer repository root (single source of installation) —
// resolution chain (v0.3.1 §1):
//   1) explicit HEM_PROJECT_ROOT (for tests/CI) — whatever is set, wins;
//   2) packaged layout: <executable folder>/installer — both the Windows exe
//      and the Linux binary get this layout from build-windows.sh; in a dev
//      run with bun, process.execPath is bun itself with no installer/ next
//      to it -> naturally falls through to the next candidate;
//   3) dev checkout: relative to this source file's location (three folders
//      up) — only meaningful when running from source; in a compiled binary
//      import.meta.dir is inside bun's virtual filesystem ($bunfs on POSIX,
//      ~BUN virtual drive on Windows — src/exepath.ts) and this
//      candidate is rejected.
//   There is NO "developer default path". If no candidate is valid, the
//   "packaged expectation" is returned so the caller's error message can
//   include that path — an honest stop, no fallback, no false readiness.
// ---------------------------------------------------------------------------

/** Marker file — a repository without install.sh is not valid */
const INSTALL_MARKER = "install.sh";

/** Executable folder — in a bun dev run, the folder of the bun binary itself */
function processExeDir(): string {
  return path.dirname(process.execPath);
}

/** true when running from inside a compiled binary (bun virtual fs — $bunfs on POSIX, ~BUN virtual drive on Windows) */
function inCompiledBinaryRun(): boolean {
  return inCompiledBinary(import.meta.dir);
}

export type InstallerRootCandidateSource = "env" | "packaged" | "dev";

export interface InstallerRootCandidate {
  source: InstallerRootCandidateSource;
  path: string;
}

/**
 * Ordered candidate list as a pure, testable function — takes mock inputs;
 * undefined/empty means "do not consider that candidate at all".
 * Order is always: env, then packaged, then dev.
 */
export function installerRootCandidates(
  explicit?: string,
  exeDir?: string,
  srcDir?: string,
): InstallerRootCandidate[] {
  const list: InstallerRootCandidate[] = [];
  const env = (explicit ?? "").trim();
  if (env) list.push({ source: "env", path: path.resolve(env) });
  if (exeDir) list.push({ source: "packaged", path: path.join(exeDir, "installer") });
  const devSrc = (srcDir ?? "").trim();
  // In a compiled binary, the source is inside bun's virtual fs ($bunfs on
  // POSIX; on Windows a "~BUN" virtual drive — beta.4) — a dev candidate
  // makes no sense. Detection lives in src/exepath.ts (inCompiledBinary) —
  // never a POSIX-only prefix (Windows bugs v0.3.1 and v0.3.2-beta.4:
  // C:\$bunfs\root and B:\~BUN\root were not rejected and produced a
  // meaningless dev candidate).
  if (devSrc && !inCompiledBinary(devSrc)) {
    list.push({ source: "dev", path: path.resolve(devSrc, "..", "..", "..", "headscale-easy-manager") });
  }
  return list;
}

export type InstallerRootSource = "env" | "packaged" | "dev" | "none";

export interface InstallerRootTry {
  source: InstallerRootCandidateSource;
  path: string;
  exists: boolean;
}

export interface InstallerRootSkipped {
  source: InstallerRootCandidateSource;
  reason: string;
}

export interface InstallerRootStatus {
  ok: boolean;
  /** Chosen path; on failure = the "packaged expectation" (for the error message) */
  path: string;
  source: InstallerRootSource;
  /** All checked candidates with the result of the install.sh existence check */
  tried: InstallerRootTry[];
  /** Candidates not checked at all, and why (today only dev inside a compiled binary) */
  skipped: InstallerRootSkipped[];
}

/**
 * Testable resolver: the first candidate that has install.sh wins; if none
 * does, ok=false and path = the "packaged expectation" (or the last
 * candidate).
 */
export function resolveInstallerRoot(
  candidates: InstallerRootCandidate[],
  skipped: InstallerRootSkipped[] = [],
): InstallerRootStatus {
  const tried: InstallerRootTry[] = [];
  let chosen: InstallerRootTry | null = null;
  for (const c of candidates) {
    const exists = fs.existsSync(path.join(c.path, INSTALL_MARKER));
    const t: InstallerRootTry = { source: c.source, path: c.path, exists };
    tried.push(t);
    if (chosen === null && exists) chosen = t;
  }
  const packagedPath = candidates.find((c) => c.source === "packaged")?.path;
  const fallback = packagedPath ?? tried[tried.length - 1]?.path ?? "";
  if (chosen) return { ok: true, path: chosen.path, source: chosen.source, tried, skipped };
  return { ok: false, path: fallback, source: "none", tried, skipped };
}

/** Real status of this run — for rich error messages and UX. */
export function installerRootStatus(): InstallerRootStatus {
  const skipped: InstallerRootSkipped[] = [];
  if (inCompiledBinaryRun()) {
    skipped.push({
      source: "dev",
      reason: "در باینری کامپایل‌شده، سورس داخل فایل‌سیستم مجازی bun ($bunfs) است",
    });
  }
  return resolveInstallerRoot(
    installerRootCandidates(process.env.HEM_PROJECT_ROOT, processExeDir(), import.meta.dir),
    skipped,
  );
}

/**
 * Python installer repository root (single source of installation) — for
 * prepare/tarball.
 * Behavior: the resolved valid path; if no candidate is valid, the "packaged
 * expectation".
 */
export function projectRoot(): string {
  return installerRootStatus().path;
}

/**
 * Rich Persian message for "installer repository not found" — this message is
 * returned to the browser UI (install wizard, api.ts error handler), so it
 * deliberately stays in Persian (product UI language). All checked paths are
 * listed with their existence result; an honest stop, never a false
 * success/ready claim.
 */
export function installerRootErrorMessage(status: InstallerRootStatus): string {
  const envT = status.tried.find((t) => t.source === "env");
  const pkgT = status.tried.find((t) => t.source === "packaged");
  const devT = status.tried.find((t) => t.source === "dev");
  const devSkipped = status.skipped.find((s) => s.source === "dev");
  const note = (t?: InstallerRootTry): string => (t ? `${t.path}${t.exists ? "" : " — install.sh نیست"}` : "");
  const lines: string[] = [
    "مخزن نصب‌کننده پیدا نشد — ویزارد نصب متوقف می‌شود (هرگز «آماده» اعلام نمی‌شود).",
    "مسیرهای بررسی‌شده:",
    `  ۱) HEM_PROJECT_ROOT: ${envT ? note(envT) : "تنظیم نشده"}`,
    `  ۲) کنار فایل اجرایی: ${pkgT ? note(pkgT) : "در دسترس نیست"}`,
    `  ۳) checkout توسعه: ${devT ? note(devT) : (devSkipped?.reason ?? "در دسترس نیست")}`,
    "راه‌حل: بستهٔ ویندوزی باید پوشهٔ installer/ را کنار hem-manager.exe داشته باشد (build-windows.sh آن را می‌سازد)؛ یا HEM_PROJECT_ROOT را صریح تنظیم کنید.",
    `مسیر مورد انتظار بسته (packaged): ${status.path}`,
  ];
  return lines.join("\n");
}
