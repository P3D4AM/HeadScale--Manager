// Real security tests (v0.3.2 §2) — implementation-independent; they lock the
// "expected security behavior". If these tests fail due to a design flaw, the
// code gets fixed — the tests themselves are never removed/weakened.
//
// Coverage of the mandatory scenarios:
//   1) an API request without a token while a token is active
//   2) an API request with a valid and an invalid token
//   3) the unset-token mode (locked — never "open")
//   4) attempting to bind a non-loopback address without security settings
//   5) HTTP and WebSocket behavior in ALL of the above modes (equivalent and consistent)
//   6) public routes and the Health Check (explicit and narrow)
//   7) the token is never leaked into logs or unnecessary responses
//
// Three independent layers:
//   A) pure policy (resolveAuthPlan/isLoopbackHost — no I/O)
//   B) HTTP/WS behavior via createApp/attachEvents (like a real run)
//   C) "real process": spawning bun index.ts itself — refused startup, network
//      address warning, and a full desktop run with a generated token + no leak into audit.log

import { afterAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { io } from "socket.io-client";
import { buildTestStack, listenApp, listenStackIo, type ListeningServer, type TestStack } from "./helpers";
import { isLoopbackHost, resolveAuthPlan } from "../src/config";

const TOKEN = "security-test-0123456789abcdef0123456789";
const WRONG = "wrong-token-value-000000";

// ---------------------------------------------------------------------------
// shared utilities
// ---------------------------------------------------------------------------
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

// ===========================================================================
// A) pure policy — resolveAuthPlan + isLoopbackHost
// ===========================================================================

test("A1 policy: no token and no explicit setting → rejected (AUTH_NOT_CONFIGURED) — never \"open\"", () => {
  const r = resolveAuthPlan({ auth: undefined, token: undefined, desktop: false });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_NOT_CONFIGURED");
});

test("A2 policy: an explicit token → token mode, not generated", () => {
  const r = resolveAuthPlan({ auth: undefined, token: TOKEN, desktop: false });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.token).toBe(TOKEN);
    expect(r.plan.tokenGenerated).toBe(false);
  }
});

test("A3 policy: desktop without an explicit token → a token generated for this run", () => {
  const r = resolveAuthPlan({ auth: undefined, token: undefined, desktop: true });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.tokenGenerated).toBe(true);
    expect(r.plan.token).toBeUndefined(); // index.ts itself mints the random value
  }
});

test("A4 policy: HEM_AGENT_AUTH=open + no token + non-desktop → allowed (the documented exception)", () => {
  const r = resolveAuthPlan({ auth: "open", token: undefined, desktop: false });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.plan.mode).toBe("open");
});

test("A5 policy: open + token → rejected (an ambiguous combination)", () => {
  const r = resolveAuthPlan({ auth: "open", token: TOKEN, desktop: false });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_OPEN_WITH_TOKEN");
});

test("A6 policy: open + desktop → rejected (desktop is always token-gated)", () => {
  const r = resolveAuthPlan({ auth: "open", token: undefined, desktop: true });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_DESKTOP_REQUIRES_TOKEN");
});

test("A7 policy: HEM_AGENT_AUTH=token without a token and without desktop → rejected", () => {
  const r = resolveAuthPlan({ auth: "token", token: undefined, desktop: false });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_TOKEN_MISSING");
});

test("A8 policy: HEM_AGENT_AUTH=token + desktop → allowed (a generated token)", () => {
  const r = resolveAuthPlan({ auth: "token", token: undefined, desktop: true });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.tokenGenerated).toBe(true);
  }
});

test("A9 policy: an invalid value → rejected with the list of allowed values", () => {
  for (const bad of ["yes", "OPEN!", "public", "0"]) {
    const r = resolveAuthPlan({ auth: bad, token: undefined, desktop: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("AUTH_INVALID_POLICY");
      expect(r.message).toContain("token");
      expect(r.message).toContain("open");
    }
  }
});

test("A10 policy: the value is case-insensitive (OPEN/Token)", () => {
  expect(resolveAuthPlan({ auth: "OPEN", token: undefined, desktop: false }).ok).toBe(true);
  expect(resolveAuthPlan({ auth: " Token ", token: TOKEN, desktop: false }).ok).toBe(true);
});

test("A11 loopback: only 127.x/localhost/::1 — the rest (0.0.0.0, 192.168.x, a domain name) are not", () => {
  expect(isLoopbackHost("127.0.0.1")).toBe(true);
  expect(isLoopbackHost("127.0.0.2")).toBe(true); // the whole 127/8 block
  expect(isLoopbackHost("localhost")).toBe(true);
  expect(isLoopbackHost("LOCALHOST")).toBe(true);
  expect(isLoopbackHost("::1")).toBe(true);
  expect(isLoopbackHost("[::1]")).toBe(true);
  expect(isLoopbackHost("0.0.0.0")).toBe(false);
  expect(isLoopbackHost("192.168.1.10")).toBe(false);
  expect(isLoopbackHost("server.example.com")).toBe(false);
  expect(isLoopbackHost("")).toBe(false);
});

// ===========================================================================
// B) HTTP/WS behavior — three modes, equivalent and consistent
// ===========================================================================

// --- active-token mode ---------------------------------------------------------
let tkStack: TestStack;
let tkSrv: ListeningServer;

test("B1 active-token mode: startup", async () => {
  tkStack = buildTestStack({ token: TOKEN });
  tkSrv = await listenApp(tkStack.app);
});

test("B1-1 scenario 1: a sensitive API without a token → 401 (no management response arrives)", async () => {
  for (const p of ["/api/profiles", "/api/sessions", "/api/jobs"]) {
    const r = await fetch(`${tkSrv.baseUrl}${p}`);
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("UNAUTHORIZED");
  }
});

test("B1-2 scenario 2: a valid token → 200; a wrong token → 401 (header and cookie identical)", async () => {
  const okH = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { "X-HEM-Token": TOKEN } });
  expect(okH.status).toBe(200);
  const okC = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(okC.status).toBe(200);
  const badH = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { "X-HEM-Token": WRONG } });
  expect(badH.status).toBe(401);
  const badC = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { Cookie: `hem_token=${WRONG}` } });
  expect(badC.status).toBe(401);
});

test("B1-3 scenario 6: the minimal public health — only GET /api/health; no POST, no lookalike path", async () => {
  const pub = await fetch(`${tkSrv.baseUrl}/api/health`);
  expect(pub.status).toBe(200);
  const body = (await pub.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["ok", "service", "version"].sort());
  const post = await fetch(`${tkSrv.baseUrl}/api/health`, { method: "POST" });
  expect(post.status).toBe(401); // a different method ≠ the public exception
  const lookalike = await fetch(`${tkSrv.baseUrl}/api/healthX`);
  expect(lookalike.status).toBe(401); // an "exactly lookalike" path is not public either
  const deep = await fetch(`${tkSrv.baseUrl}/api/health/extra`);
  expect(deep.status).toBe(401);
});

// --- locked mode (no token set) -----------------------------------------------
let lkStack: TestStack;
let lkSrv: ListeningServer;

test("B2 locked mode (no token set): startup", async () => {
  lkStack = buildTestStack({}); // no token and no authMode → locked
  lkSrv = await listenApp(lkStack.app);
});

test("B2-1 scenario 3: no token → the APIs give 503 AUTH_NOT_CONFIGURED — never open without auth", async () => {
  for (const p of ["/api/profiles", "/api/sessions", "/api/jobs", "/api/backup"]) {
    const r = await fetch(`${lkSrv.baseUrl}${p}`);
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string; message: string };
    expect(body.error).toBe("AUTH_NOT_CONFIGURED");
    expect(body.message).toContain("HEM_AGENT_TOKEN");
    expect(body.message).toContain("HEM_AGENT_AUTH=open");
  }
});

test("B2-2 scenario 6: in locked mode the minimal public health also works (a non-sensitive response)", async () => {
  const r = await fetch(`${lkSrv.baseUrl}/api/health`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["ok", "service", "version"].sort());
});

// --- open mode (the documented local-dev exception) ----------------------------
let opStack: TestStack;
let opSrv: ListeningServer;

test("B3 open mode: startup (the documented exception — loopback-only in index.ts)", async () => {
  opStack = buildTestStack({ authMode: "open" });
  opSrv = await listenApp(opStack.app);
});

test("B3-1 scenario 5: open → the API is reachable without auth (documented, local-dev only)", async () => {
  const r = await fetch(`${opSrv.baseUrl}/api/profiles`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("B3-2 scenario 6: health gives the full response in open mode (HTTP-equivalent: no auth)", async () => {
  const r = await fetch(`${opSrv.baseUrl}/api/health`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as Record<string, unknown>;
  expect(body.uptimeSec).toBeDefined();
  expect(body.sessions).toBeDefined();
});

// --- WebSocket — equivalence with HTTP in all three modes ---------------------
const WS_GRACE_MS = 400;

function tryConnect(url: string, extraHeaders: Record<string, string>, timeoutMs = 4000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = io(url, { extraHeaders, reconnection: false, timeout: 2500 });
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    client.on("connect", () => {
      graceTimer = setTimeout(() => done(client.connected), WS_GRACE_MS);
    });
    client.on("connect_error", () => done(false));
    client.on("disconnect", () => {
      if (graceTimer) clearTimeout(graceTimer);
      done(false);
    });
    setTimeout(() => done(client.connected), timeoutMs).unref?.();
  });
}

/** Safety cap for closing a server — server.close() hangs on keep-alive sockets (known bun/undici behavior) */
const cap = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

async function closeIoSrv(srv: { closeIo: () => Promise<void>; close: () => Promise<void> }): Promise<void> {
  await Promise.race([srv.closeIo().catch(() => undefined), cap(2500)]);
  await Promise.race([srv.close(), cap(2500)]);
}

test("B4-1 scenario 5, WS in token mode: no/wrong token → cut; valid → connected (header and cookie like HTTP)", async () => {
  const srv = await listenStackIo(tkStack, { token: TOKEN });
  try {
    const ws = srv.baseUrl.replace(/^http/, "ws");
    expect(await tryConnect(ws, {})).toBe(false);
    expect(await tryConnect(ws, { "X-HEM-Token": WRONG })).toBe(false);
    expect(await tryConnect(ws, { "X-HEM-Token": TOKEN })).toBe(true);
    expect(await tryConnect(ws, { Cookie: `hem_token=${TOKEN}` })).toBe(true);
    expect(await tryConnect(ws, { Cookie: `hem_token=${WRONG}` })).toBe(false);
  } finally {
    await closeIoSrv(srv);
  }
});

test("B4-2 scenario 5, WS in locked mode (no token set): every connection is cut immediately", async () => {
  const srv = await listenStackIo(lkStack, {});
  try {
    const ws = srv.baseUrl.replace(/^http/, "ws");
    expect(await tryConnect(ws, {})).toBe(false);
    expect(await tryConnect(ws, { "X-HEM-Token": WRONG })).toBe(false);
  } finally {
    await closeIoSrv(srv);
  }
});

test("B4-3 scenario 5, WS in open mode: connections are open (HTTP-equivalent)", async () => {
  const srv = await listenStackIo(opStack, { authMode: "open" });
  try {
    const ws = srv.baseUrl.replace(/^http/, "ws");
    expect(await tryConnect(ws, {})).toBe(true);
  } finally {
    await closeIoSrv(srv);
  }
});

// ===========================================================================
// C) real process — spawning bun index.ts itself (startup/bind/desktop/leak behavior)
// ===========================================================================

const AGENT_DIR = import.meta.dir + "/..";

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

/** Run index.ts and wait for the exit (the "refuses to start" scenarios) */
function runExpectExit(env: Record<string, string>, expectCode: string, timeoutMs = 20_000): Promise<ProcResult> {
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
      if (!output.includes(expectCode)) {
        reject(new Error(`expected error code "${expectCode}" not found in output:\n${output}`));
        return;
      }
      resolve({ exitCode: code, output });
    });
  });
}

let serverChildren: ChildProcess[] = [];
function killServerChild(c: ChildProcess): void {
  if (c.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(c.pid), "/F", "/T"], { stdio: "ignore" });
    } else {
      c.kill("SIGTERM");
    }
  } catch {
    /* best-effort */
  }
}

test("C1 scenarios 3/4: no token and no explicit setting → the real process stops with a non-zero exit", async () => {
  const r = await runExpectExit(
    cleanEnv({ HEM_AGENT_PORT: "31051", HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c1-")) }),
    "AUTH_NOT_CONFIGURED",
  );
  expect(r.exitCode).not.toBe(0);
  expect(r.output).toContain("refuses to start");
});

test("C2 scenario 4: non-loopback bind without auth (open + 0.0.0.0) → refuses to start", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31052",
      HEM_AGENT_AUTH: "open",
      HEM_AGENT_HOST: "0.0.0.0",
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c2-")),
    }),
    "loopback",
  );
  expect(r.exitCode).not.toBe(0);
  expect(r.output).toContain("startup aborted");
});

test("C3 scenario 4: a non-loopback bind with no token/explicit setting (only HEM_AGENT_HOST) → refuses to start", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31053",
      HEM_AGENT_HOST: "0.0.0.0",
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c3-")),
    }),
    "AUTH_NOT_CONFIGURED",
  );
  expect(r.exitCode).not.toBe(0);
});

test("C4 contradictory config: HEM_AGENT_AUTH=token without a token → refuses to start", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31054",
      HEM_AGENT_AUTH: "token",
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c4-")),
    }),
    "AUTH_TOKEN_MISSING",
  );
  expect(r.exitCode).not.toBe(0);
});

test("C5 contradictory config: open + token → refuses to start", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31055",
      HEM_AGENT_AUTH: "open",
      HEM_AGENT_TOKEN: TOKEN,
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c5-")),
    }),
    "AUTH_OPEN_WITH_TOKEN",
  );
  expect(r.exitCode).not.toBe(0);
});

test("C6 scenario 4: a network bind 'with a token' → starts + an explicit warning (an informed choice)", async () => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-c6-"));
  const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts")], {
    env: cleanEnv({
      HEM_AGENT_PORT: String(port),
      HEM_AGENT_HOST: "0.0.0.0",
      HEM_AGENT_TOKEN: TOKEN,
      HEM_AGENT_HOME: home,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChildren.push(child);
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
    expect(output).toContain("network address"); // explicit warning
    expect(output).toContain(`listening on http://0.0.0.0:${port}`);
    // on the network too: no token → 401, with token → 200
    const no = await fetch(`http://127.0.0.1:${port}/api/profiles`);
    expect(no.status).toBe(401);
    const yes = await fetch(`http://127.0.0.1:${port}/api/profiles`, { headers: { "X-HEM-Token": TOKEN } });
    expect(yes.status).toBe(200);
  } finally {
    killServerChild(child);
  }
}, 60_000);

test("C7 a real desktop run: generated token + fully locked + one-time + \"no leak\" into audit.log and responses", async () => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-c7-"));
  const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts"), "--desktop"], {
    env: cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_HOME: home }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChildren.push(child);
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  try {
    // coming up: the public health (no token) 200 minimal JSON
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

    // the log: token mode with a generated token
    expect(output).toContain("auth: token");
    expect(output).toContain("generated for this run");

    // the token can only be extracted from the "desktop UI:" line (the bootstrap delivery channel)
    const m = /desktop UI: http:\/\/127\.0\.0\.1:\d+\/\?token=([0-9a-f]{24,})/.exec(output);
    if (!m) throw new Error(`desktop token not found in the log. Output:\n${output}`);
    const dtok = m[1]!;
    expect(dtok.length).toBeGreaterThanOrEqual(48); // randomBytes(24) → 48 hex chars

    // no token → 401; with the generated token → 200 (a real API, not just health)
    const no = await fetch(`http://127.0.0.1:${port}/api/profiles`);
    expect(no.status).toBe(401);
    const yes = await fetch(`http://127.0.0.1:${port}/api/profiles`, { headers: { "X-HEM-Token": dtok } });
    expect(yes.status).toBe(200);

    // the one-time exchange + dead replay (the same HTTP behavior as v0.3.1 §4)
    const b1 = await fetch(`http://127.0.0.1:${port}/?token=${dtok}`, { redirect: "manual" });
    expect(b1.status).toBe(303);
    expect(b1.headers.get("set-cookie") ?? "").toContain("HttpOnly");
    const b2 = await fetch(`http://127.0.0.1:${port}/?token=${dtok}`, { redirect: "manual" });
    expect(b2.headers.get("set-cookie")).toBeNull();

    // scenario 7 — no leak:
    // (a) the token appears "only" on the desktop UI line, on no other log line:
    const linesWithToken = output.split("\n").filter((l) => l.includes(dtok));
    expect(linesWithToken.length).toBe(1);
    expect(linesWithToken[0]!.includes("desktop UI:")).toBe(true);
    // (b) API responses never return the token:
    const noBody = (await no.json()) as Record<string, unknown>;
    expect(JSON.stringify(noBody)).not.toContain(dtok);
    // (c) audit.log contains no token (if any record has been written so far):
    const auditFile = path.join(home, "audit.log");
    if (fs.existsSync(auditFile)) {
      const auditText = fs.readFileSync(auditFile, "utf8");
      expect(auditText).not.toContain(dtok);
    }
  } finally {
    killServerChild(child);
  }
}, 60_000);

afterAll(() => {
  for (const c of serverChildren) killServerChild(c);
  tkStack?.dispose();
  lkStack?.dispose();
  opStack?.dispose();
});
