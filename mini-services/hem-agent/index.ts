// hem-agent — entry point
// express + socket.io on 127.0.0.1:3005 (HEM_AGENT_HOST/HEM_AGENT_PORT)
// Gateway requests arrive with ?XTransformPort=3005; express ignores it by itself.
//
// Authentication (v0.3.2 §2 — fail-closed):
//   • token mode (default for real deployments): every /api route (except the
//     minimal public health endpoint) and every WebSocket requires the
//     X-HEM-Token header or the hem_token cookie.
//   • desktop mode (HEM_DESKTOP=1/--desktop, or the Windows packaged rule of
//     v0.3.2-beta.2: compiled binary on win32 with no token/explicit config =
//     user double-click): if HEM_AGENT_TOKEN is not set, a secure random token
//     is generated "for this run only"; the UI URL with ?token= is printed and
//     the browser opens; the token->cookie exchange is one-time-use
//     (v0.3.1 §4): after first use, the old link in the browser history is no
//     longer valid; a session cookie HttpOnly/SameSite=Strict settles on the
//     user's machine and a 303 cleans the URL from the token. API
//     authentication is only via the X-HEM-Token header or that cookie — a
//     token in the query string is never valid.
//   • open mode (HEM_AGENT_AUTH=open — documented local-development exception):
//     no authentication, loopback only; never starts on a network address.
//   • No token and no open (and outside the Windows desktop rule): the service
//     "refuses to start" with a clear error (non-zero exit).
//   • WebSocket is token-checked exactly like HTTP (events.ts) — equivalent
//     and consistent.
//
// Fast-close EXE detection (v0.3.2-beta.2): every startup failure is written to
// a "file-based diagnostic log" (<home>/logs/hem-agent.log — src/startuplog.ts)
// and the console message points at that log path; in an interactive Windows
// run (isTTY) an error popup is also shown (native Windows Popup, 30 seconds,
// never blocks indefinitely). Service/background execution is never locked by a
// pause. (v0.3.2-beta.3: per user directive, ALL terminal output and comments
// are English-only — the browser UI stays Persian.)

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Server as IOServer } from "socket.io";
import {
  agentHome,
  agentHost,
  agentPort,
  desktopMode,
  isLoopbackHost,
  resolveAuthPlan,
  type AuthPlan,
  AGENT_VERSION,
  installerRootStatus,
} from "./src/config";
import { programDir } from "./src/exepath";
import { createApp } from "./src/api";
import { attachEvents, JobManager } from "./src/events";
import { SessionManager } from "./src/sessions";
import { ProfileStore } from "./src/profiles";
import { SecretStore } from "./src/secrets";
import { AuditLogger } from "./src/audit";
import { Redactor } from "./src/redact";
import { createStartupLog, type StartupLog } from "./src/startuplog";

// ---------------------------------------------------------------------------
// Fatal exit — always: console + diagnostic log (+ on interactive Windows, a
// popup). exitCode returns immediately; the popup is shown by a separate
// (detached) process.
// ---------------------------------------------------------------------------
function fatalExit(startupLog: StartupLog, code: string, message: string, err?: unknown): never {
  startupLog.fatal(code, message, err);
  const logPath = startupLog.logPath;
  console.error("[hem-agent] startup aborted:");
  console.error(`[hem-agent] ${code}`);
  console.error(message);
  console.error(`[hem-agent] full details (time/stage/stack trace): ${logPath}`);
  console.error("[hem-agent] to see live output, run the app from PowerShell and check $LASTEXITCODE after it exits.");
  showFatalDialog(code, logPath);
  process.exit(1);
}

/** Native Windows error popup — interactive runs (isTTY) only; auto-closes after 30 seconds */
function showFatalDialog(code: string, logPath: string): void {
  try {
    if (process.platform !== "win32") return;
    if (!process.stdout.isTTY) return; // service/CI/pipe: no window should ever open
    const text =
      `Headscale Easy Manager failed to start.\n` +
      `Error code: ${code}\n\n` +
      `Full details in the log file:\n${logPath}\n\n` +
      `(This message closes automatically in 30 seconds)`;
    const title = "Headscale Easy Manager - startup error";
    const ps = text.replace(/'/g, "''");
    const pt = title.replace(/'/g, "''");
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `(New-Object -ComObject WScript.Shell).Popup('${ps}', 30, '${pt}', 16) | Out-Null`,
      ],
      { detached: true, stdio: "ignore" },
    );
    child.on("error", () => undefined); // best-effort
    child.unref();
  } catch {
    /* best-effort */
  }
}

async function main(): Promise<void> {
  const home = agentHome();
  fs.mkdirSync(home, { recursive: true });

  const redactor = new Redactor();
  const audit = new AuditLogger(home, redactor);
  const secrets = new SecretStore(home);
  const profiles = new ProfileStore(home);
  const jobs = new JobManager();
  const manager = new SessionManager({ home, profiles, secrets, audit, redactor });

  // Startup diagnostic log — from now on no failure dies "unwitnessed".
  const startupLog = createStartupLog(home, redactor);

  // In a compiled binary (Windows exe / Linux binary), import.meta.dir points
  // into the bundle's virtual filesystem (/$bunfs on POSIX, C:\$bunfs on
  // Windows); the "folder next to the program itself" (where ui/ lives in the
  // package) must be derived from process.execPath. Detection lives in
  // src/exepath.ts — membership of "$bunfs" in the path, not a POSIX absolute
  // prefix (Windows bug v0.3.1: startsWith("/$bunfs") failed on C:\$bunfs and
  // the UI was never served; GET / returned ambiguous JSON instead of the UI).
  const exeDir = programDir(import.meta.dir);
  const uiDir = path.join(exeDir, "ui");
  const uiExists = fs.existsSync(uiDir);
  const rootStatus = installerRootStatus();

  startupLog.event("startup", "begin", {
    detail:
      `version=${AGENT_VERSION} platform=${process.platform} ` +
      `execDir=${exeDir} home=${home} ` +
      `ui=${uiExists ? "found" : "missing"} installer=${rootStatus.ok ? `ok(${rootStatus.source})` : "not-found"}`,
  });

  // --- Auth policy (v0.3.2 §2 — fail-closed) ---------------------------------
  // Old behavior: "no token" meant an unprotected service on all of /api and
  // WebSocket — fixed:
  //   • explicit token or (desktop) generated token -> token mode;
  //   • explicit HEM_AGENT_AUTH=open -> documented local-development exception,
  //     loopback only;
  //   • neither (and outside the Windows desktop rule) -> "refuses to start".
  // Desktop token generation happens right here (randomBytes(24) — secure and
  // random).
  const isDesktop = desktopMode();
  const host = agentHost();
  const port = agentPort();
  const auth = resolveAuthPlan({
    auth: process.env.HEM_AGENT_AUTH,
    token: process.env.HEM_AGENT_TOKEN,
    desktop: isDesktop,
  });
  if (!auth.ok) {
    fatalExit(startupLog, auth.code, auth.message);
  }
  let plan: AuthPlan = auth.plan;
  if (plan.tokenGenerated) {
    plan = { ...plan, token: randomBytes(24).toString("hex") };
  }
  const token: string | undefined = plan.token;

  startupLog.event("auth", "resolved", {
    code: plan.mode,
    detail: `host=${host} port=${port} desktop=${isDesktop}${plan.tokenGenerated ? " token=generated-for-this-run" : plan.mode === "token" ? " token=explicit" : " no-auth"}`,
  });

  // open mode is loopback-only — otherwise it refuses to start (clear error):
  // HEM_AGENT_HOST must never be able to put an unauthenticated service on
  // the network.
  if (plan.mode === "open" && !isLoopbackHost(host)) {
    fatalExit(
      startupLog,
      "OPEN_REQUIRES_LOOPBACK",
      `open mode (no authentication) is allowed on loopback only — HEM_AGENT_HOST="${host}" is a network address; an unauthenticated service will not start on the network. For network access, set HEM_AGENT_TOKEN (and remove HEM_AGENT_AUTH).`,
    );
  }
  // token mode on a network address = a conscious choice — explicit warning,
  // startup continues:
  if (plan.mode === "token" && !isLoopbackHost(host)) {
    console.warn(
      `[hem-agent] WARNING: the service will bind on network address "${host}" — make sure the token is strong/random and traffic goes through a trusted proxy/HTTPS.`,
    );
    startupLog.warn("listen", "network-bind-with-token", { detail: `host=${host}` });
  }

  const app = createApp({
    manager,
    profiles,
    secrets,
    audit,
    redactor,
    jobs,
    token,
    authMode: plan.mode,
    // uiDir is served only when it actually exists; the "expected" path is
    // always passed so the error page/log can say exactly where we looked
    // (not ambiguous JSON).
    uiDir: uiExists ? uiDir : undefined,
    uiDirExpected: uiDir,
    version: AGENT_VERSION,
    startedAt: Date.now(),
  });

  const uiUrl = `http://127.0.0.1:${port}/${token ? `?token=${token}` : ""}`;

  // Startup honesty (v0.3.1 §1) + clear error when UI is missing: if ui/ is
  // not next to the program, we never stay silent — an explicit log line is
  // printed and GET / returns a clear error page (api.ts), not ambiguous
  // JSON. (The Windows bug of v0.3.1 slipped through exactly here, silently.)
  if (!uiExists) {
    console.error(`[hem-agent] UI NOT FOUND — expected ui/ at: ${uiDir}`);
    console.error(
      "[hem-agent] WARNING: without a ui/ folder next to the program, the web UI is not served; GET / returns a clear error page (not the app). " +
        "Extract the official ZIP package COMPLETELY — hem-manager.exe and ui/ and installer/ must stay together; " +
        "do not run the EXE from inside the ZIP preview.",
    );
    startupLog.warn("ui", "missing", { detail: `expected=${uiDir}` });
  }
  if (rootStatus.ok) {
    console.log(`[hem-agent] installer: ok (${rootStatus.source}) → ${rootStatus.path}`);
  } else {
    console.log(
      `[hem-agent] installer: NOT FOUND (source: ${rootStatus.source}) — expected: ${rootStatus.path}`,
    );
    console.log(
      "[hem-agent] WARNING: without an installer/ folder next to the program, the install wizard stops with a clear error (it never reports success/ready). The official Windows package ships this folder; HEM_PROJECT_ROOT is also configurable.",
    );
    startupLog.warn("installer", "not-found", { detail: `expected=${rootStatus.path}` });
  }

  const server = app.listen(port, host, () => {
    startupLog.event("listen", "ok", { detail: `http://${host}:${port}` });
    console.log(`[hem-agent] listening on http://${host}:${port} (home: ${home})`);
    console.log(
      `[hem-agent] version ${AGENT_VERSION} | platform ${process.platform} | ui: ${uiExists ? `served (${uiDir})` : `MISSING (expected ${uiDir})`}${plan.desktop ? " | mode: desktop" : ""} | auth: ${plan.mode}${plan.tokenGenerated ? " (generated for this run)" : plan.mode === "token" ? " (explicit HEM_AGENT_TOKEN)" : " (no-auth, loopback dev only)"}`,
    );
    if (plan.mode === "open") {
      console.warn(
        "[hem-agent] WARNING: open mode is active: /api and WebSocket are accessible WITHOUT authentication on this loopback only. This mode is for local development; set HEM_AGENT_TOKEN for real deployments.",
      );
    }
    if (plan.desktop) {
      if (plan.tokenGenerated) {
        console.log("[hem-agent] token: generated for this run (set HEM_AGENT_TOKEN to pin it)");
        console.log("[hem-agent] this URL is one-time-use — after the first open, the old link (browser history) is no longer valid.");
      }
      // The URL is always printed — even if opening the browser fails.
      // (The only place the token is printed: the user's own console on their
      // own machine — the desktop bootstrap delivery channel; it never
      // appears in the audit log, API responses, or the file diagnostic log.)
      console.log(`[hem-agent] desktop UI: ${uiUrl}`);
      openDefaultBrowser(uiUrl);
    }
  });

  // Listen errors (e.g. EADDRINUSE: port already in use) — until this version
  // they died as unhandled and the window closed instantly; now: clear
  // message + log + exit≠0.
  server.on("error", (err: NodeJS.ErrnoException) => {
    const code = err.code ?? "LISTEN_ERROR";
    fatalExit(
      startupLog,
      code,
      `Listening on ${host}:${port} failed — ${err.message}\n` +
        (code === "EADDRINUSE"
          ? "The port is already used by another program (maybe this same app?). Change the port with HEM_AGENT_PORT or close the program holding it."
          : "Check the address/port with HEM_AGENT_HOST/HEM_AGENT_PORT."),
      err,
    );
  });

  const io = new IOServer(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl / same-origin
        if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true);
        return cb(new Error("origin not allowed"), false);
      },
    },
  });
  attachEvents(io, manager, jobs, token, plan.mode);

  function shutdown(signal: string): void {
    console.log(`[hem-agent] ${signal} received — closing sessions…`);
    startupLog.event("shutdown", "signal", { detail: signal });
    try {
      manager.dispose();
    } catch {
      /* ignore */
    }
    io.close(() => undefined);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/** Open the default browser — best-effort; failure is unimportant (the URL was already printed) */
function openDefaultBrowser(url: string): void {
  try {
    let child;
    if (process.platform === "win32") {
      child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    } else if (process.platform === "darwin") {
      child = spawn("open", [url], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    }
    child.on("error", (err: Error) => {
      console.log(`[hem-agent] (could not open the browser — open the URL above manually: ${err.message})`);
    });
    child.unref();
  } catch (err) {
    console.log(`[hem-agent] (could not open the browser — open the URL above manually: ${String(err)})`);
  }
}

// --- Bootstrapped with full protection: any startup error → file log + console + exit≠0 --
main().catch((err: unknown) => {
  // If main itself did not exit via fatalExit (unexpected error at any stage):
  const message = err instanceof Error ? err.message : String(err);
  console.error("[hem-agent] unexpected startup error:");
  console.error(message);
  if (err instanceof Error && err.stack) console.error(err.stack);
  // File log — best-effort (it may itself have failed in the same incident):
  try {
    const home = agentHome();
    fs.mkdirSync(home, { recursive: true });
    const startupLog = createStartupLog(home, new Redactor());
    startupLog.fatal("STARTUP_UNEXPECTED", message, err);
    console.error(`[hem-agent] full details: ${startupLog.logPath}`);
    showFatalDialog("STARTUP_UNEXPECTED", startupLog.logPath);
  } catch {
    /* could not log — console above is the witness */
  }
  process.exit(1);
});

// Late errors never die unwitnessed either (defensive):
process.on("uncaughtException", (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[hem-agent] uncaught exception:");
  console.error(message);
  if (err instanceof Error && err.stack) console.error(err.stack);
  try {
    const home = agentHome();
    const startupLog = createStartupLog(home, new Redactor());
    startupLog.fatal("UNCAUGHT_EXCEPTION", message, err);
  } catch {
    /* ignore */
  }
  process.exit(1);
});

process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error("[hem-agent] unhandled rejection:");
  console.error(message);
  try {
    const home = agentHome();
    const startupLog = createStartupLog(home, new Redactor());
    startupLog.fatal("UNHANDLED_REJECTION", message, reason);
  } catch {
    /* ignore */
  }
  process.exit(1);
});
