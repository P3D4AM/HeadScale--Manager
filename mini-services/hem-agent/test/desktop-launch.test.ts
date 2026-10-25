// "EXE closes instantly" regression tests (v0.3.2-beta.2) — two root causes:
//
//   root A) running the Windows package "bare" (double-click, no variables at
//   all) never mapped to desktop mode → the fail-closed policy rightly gave
//   exit≠0 → the window closed instantly. Fix: the "Windows package" rule in
//   resolveDesktopMode (src/config.ts): a compiled binary on win32 with
//   "no token/explicit setting" = desktop with a token generated for that run.
//
//   root B) every startup failure only went to the momentary console — no
//   evidence remained (and if the port was taken, it died completely unhandled).
//   Fix: a file-based diagnostic log (src/startuplog.ts) + a listen error
//   handler (EADDRINUSE) in index.ts.
//
// Layers:
//   A) pure policy — resolveDesktopMode/resolveAuthPlan without I/O (locks root A)
//   B) real process (on a Linux host — locks root B and fail-closed behavior):
//      bare run → exit≠0 + message + file log; busy port → EADDRINUSE + log;
//      a successful desktop run → a file log "without the token".
//   The "Windows package" rule path (actual win32+compiled) only runs on real
//   Windows / Windows CI — here it is covered by the pure layer-A tests and
//   honestly noted in those same tests.

import { afterAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createStartupLog, readStartupEntries } from "../src/startuplog";
import { Redactor } from "../src/redact";
import { resolveAuthPlan, resolveDesktopMode } from "../src/config";

const AGENT_DIR = import.meta.dir + "/..";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** Clean environment for the child process: parent HEM_* variables are dropped so tests stay independent */
function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("HEM_")) continue;
    if (typeof v === "string") env[k] = v;
  }
  return { ...env, ...overrides };
}

interface ProcResult {
  exitCode: number | null;
  output: string;
}

function runExpectExit(env: Record<string, string>, expectInOutput: string[], timeoutMs = 20_000): Promise<ProcResult> {
  return new Promise<ProcResult>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts")], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process did not exit within ${timeoutMs}ms. Output:\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === null) {
        reject(new Error("process was killed by a signal"));
        return;
      }
      for (const needle of expectInOutput) {
        if (!output.includes(needle)) {
          reject(new Error(`"${needle}" not found in output:\n${output}`));
          return;
        }
      }
      resolve({ exitCode: code, output });
    });
  });
}

function killServerChild(c: ChildProcess): void {
  if (c.exitCode !== null) return;
  try {
    c.kill("SIGTERM");
  } catch {
    /* best-effort */
  }
}

// ===========================================================================
// A) pure policy — the "Windows package" rule (locks root A; no I/O)
//    Honest note: the actual win32+compiled path only "runs" on real Windows /
//    Windows CI; its logic is locked right here with synthetic inputs.
// ===========================================================================

test("A1 Windows-package rule: win32 + compiled + no token/explicit setting → desktop", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: {}, argv: [] }),
  ).toBe(true);
});

test("A2 the user's explicit setting wins: same run + HEM_AGENT_TOKEN → auto-desktop off (service)", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_TOKEN: "t" }, argv: [] }),
  ).toBe(false);
});

test("A3 the user's explicit setting wins: same run + HEM_AGENT_AUTH → auto-desktop off", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_AUTH: "open" }, argv: [] }),
  ).toBe(false);
});

test("A4 Linux: compiled binary + bare run → no auto-desktop (the fail-closed lock stays)", () => {
  expect(
    resolveDesktopMode({ platform: "linux", compiledBinary: true, env: {}, argv: [] }),
  ).toBe(false);
});

test("A5 dev run (bun, not a binary): win32 + bare → no auto-desktop", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: false, env: {}, argv: [] }),
  ).toBe(false);
});

test("A6 legacy explicit: HEM_DESKTOP=1 on any platform → desktop", () => {
  expect(resolveDesktopMode({ platform: "linux", compiledBinary: false, env: { HEM_DESKTOP: "1" }, argv: [] })).toBe(true);
});

test("A7 legacy explicit: --desktop → desktop", () => {
  expect(resolveDesktopMode({ platform: "linux", compiledBinary: true, env: {}, argv: ["bun", "index.ts", "--desktop"] })).toBe(true);
});

test("A8 empty/whitespace token or auth values don't count (the auto rule applies)", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_TOKEN: "  ", HEM_AGENT_AUTH: "" }, argv: [] }),
  ).toBe(true);
});

test("A9 combined with the auth policy: Windows-package desktop without a token → generated token (not AUTH_NOT_CONFIGURED)", () => {
  const desktop = resolveDesktopMode({ platform: "win32", compiledBinary: true, env: {}, argv: [] });
  expect(desktop).toBe(true);
  const r = resolveAuthPlan({ auth: undefined, token: undefined, desktop });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.tokenGenerated).toBe(true);
  }
});

test("A10 combined: HEM_AGENT_AUTH=open on the Windows package → auto-desktop off + open mode (user choice respected)", () => {
  const desktop = resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_AUTH: "open" }, argv: [] });
  expect(desktop).toBe(false);
  const r = resolveAuthPlan({ auth: "open", token: undefined, desktop });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.plan.mode).toBe("open");
});

// ===========================================================================
// B) real process — root B: failures leave file-based evidence
//    (on a Linux host; these tests are OS-independent)
// ===========================================================================

test("B1 bare run: exit≠0 + Persian message + file log with a fatal record (evidence survives)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b1-"));
  const port = await freePort();
  const r = await runExpectExit(
    cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_HOME: home }),
    ["AUTH_NOT_CONFIGURED", "refuses to start", "logs/hem-agent.log"],
  );
  expect(r.exitCode).not.toBe(0);
  expect(r.exitCode).not.toBe(null);
  // file log: a known path + JSONL records with ts/phase/code
  const logPath = path.join(home, "logs", "hem-agent.log");
  expect(fs.existsSync(logPath)).toBe(true);
  const entries = readStartupEntries(logPath);
  expect(entries.length).toBeGreaterThan(0);
  const fatal = entries.find((e) => e.phase === "fatal");
  expect(fatal).toBeDefined();
  expect(fatal?.code).toBe("AUTH_NOT_CONFIGURED");
  expect(typeof fatal?.ts).toBe("string");
  expect(fatal?.ts.length).toBeGreaterThan(10);
  const begin = entries.find((e) => e.phase === "startup" && e.event === "begin");
  expect(begin).toBeDefined();
}, 30_000);

test("B2 busy port (two instances): the second gets EADDRINUSE + Persian message + file log — not an unhandled crash", async () => {
  const port = await freePort();
  const home1 = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b2a-"));
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b2b-"));
  const child1 = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts")], {
    env: cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_TOKEN: "b2-token-0123456789abcdef", HEM_AGENT_HOME: home1 }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out1 = "";
  child1.stdout?.on("data", (d: Buffer) => (out1 += d.toString()));
  child1.stderr?.on("data", (d: Buffer) => (out1 += d.toString()));
  try {
    // instance 1 must actually listen before instance 2
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child1.exitCode !== null) throw new Error(`instance 1 died (exit=${child1.exitCode}). Output:\n${out1}`);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (r.status === 200) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`instance 1 did not come up within 30s. Output:\n${out1}`);
      await new Promise((res) => setTimeout(res, 300));
    }

    // instance 2: same port — must honestly return EADDRINUSE (not a crash without evidence)
    const r2 = await runExpectExit(
      cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_TOKEN: "b2-token-0123456789abcdef", HEM_AGENT_HOME: home2 }),
      ["EADDRINUSE", "Listening on", "logs/hem-agent.log"],
    );
    expect(r2.exitCode).not.toBe(0);
    expect(r2.output).toContain("HEM_AGENT_PORT");
    const log2 = path.join(home2, "logs", "hem-agent.log");
    expect(fs.existsSync(log2)).toBe(true);
    const entries2 = readStartupEntries(log2);
    const fatal2 = entries2.find((e) => e.phase === "fatal");
    expect(fatal2?.code).toBe("EADDRINUSE");
    expect(typeof fatal2?.stack === "string" || fatal2?.detail).toBeTruthy();
  } finally {
    killServerChild(child1);
  }
}, 60_000);

test("B3 successful desktop run: the file log is written but the \"token\" is never in it", async () => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b3-"));
  const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts"), "--desktop"], {
    env: cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_HOME: home }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`process died (exit=${child.exitCode}). Output:\n${output}`);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (r.status === 200) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server did not come up within 30s. Output:\n${output}`);
      await new Promise((res) => setTimeout(res, 300));
    }

    // the token can only be extracted from the "desktop UI:" line (console)
    const m = /desktop UI: http:\/\/127\.0\.0\.1:\d+\/\?token=([0-9a-f]{24,})/.exec(output);
    if (!m) throw new Error(`desktop token not found in output:\n${output}`);
    const dtok = m[1]!;

    // file log: exists + startup events — and "without any token"
    const logPath = path.join(home, "logs", "hem-agent.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const logText = fs.readFileSync(logPath, "utf8");
    expect(logText).not.toContain(dtok);
    expect(/[0-9a-f]{48}/.test(logText)).toBe(false); // no 24-byte hex token in the file
    const entries = readStartupEntries(logPath);
    expect(entries.some((e) => e.phase === "startup" && e.event === "begin")).toBe(true);
    expect(entries.some((e) => e.phase === "auth" && e.event === "resolved" && e.code === "token")).toBe(true);
    expect(entries.some((e) => e.phase === "listen" && e.event === "ok")).toBe(true);
  } finally {
    killServerChild(child);
  }
}, 60_000);

test("B4 startuplog unit: redaction (token=***) and size rotation", () => {
  // use createStartupLog directly — no spawn
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b4-"));
  const redactor = new Redactor();
  const slog = createStartupLog(home, redactor);
  slog.event("startup", "begin", { detail: "x" });
  slog.fatal("TEST_CODE", "error with address http://127.0.0.1:1/?token=abcdef0123456789 in the message", new Error("boom"));
  expect(slog.hasFatal()).toBe(true);
  const entries = readStartupEntries(slog.logPath);
  const fatal = entries.find((e) => e.phase === "fatal" && e.code === "TEST_CODE");
  expect(fatal).toBeDefined();
  expect(fatal?.detail).toContain("token=***"); // the token value is masked in the log
  expect(fatal?.detail).not.toContain("abcdef0123456789");
  expect(typeof fatal?.stack === "string").toBe(true);
  expect(fatal?.stack).toContain("boom");
  // size rotation: once past the 256KB cap, the current file moves to *.log.1 and a fresh file starts
  const big = "x".repeat(4096);
  for (let i = 0; i < 80; i++) slog.event("rotation", "fill", { detail: big });
  const size = fs.statSync(slog.logPath).size;
  expect(size).toBeLessThan(256 * 1024 + 64 * 1024); // young file
  expect(fs.existsSync(`${slog.logPath}.1`)).toBe(true); // the previous generation remains
});

afterAll(() => {
  /* nothing long-running: children killed in finally blocks */
});
