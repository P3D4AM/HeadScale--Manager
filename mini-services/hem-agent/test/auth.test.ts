// §4 security tests (v0.3.1) — positive and negative.
// "Auth code exists" is not enough: real HTTP and WebSocket behavior is verified —
// without a valid token, no management operation or sensitive event is reachable.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { io } from "socket.io-client";
import { buildTestStack, listenApp, listenStackIo, type ListeningServer, type TestStack } from "./helpers";

const TOKEN = "auth-test-0123456789abcdef0123456789abcdef"; // 40 chars — like the desktop token

let stack: TestStack;
let srv: ListeningServer;

beforeAll(async () => {
  stack = buildTestStack({ token: TOKEN });
  srv = await listenApp(stack.app);
});

// all teardown in one afterAll — order: WS first, then the stack, then HTTP

// ---------------------------------------------------------------------------
// HTTP — API auth only via the X-HEM-Token header or the hem_token cookie
// ---------------------------------------------------------------------------
test("HTTP: no token → health is the minimal public one (200 with only non-sensitive fields) and sensitive routes 401 (negative)", async () => {
  // v0.3.2 §2: health = the explicit, narrow public exception — a minimal response for everyone;
  // but no management route is reachable without a token:
  const r = await fetch(`${srv.baseUrl}/api/health`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as Record<string, unknown>;
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
  expect(Object.keys(body).sort()).toEqual(["ok", "service", "version"].sort()); // no uptime/platform/sessions
  const r2 = await fetch(`${srv.baseUrl}/api/profiles`);
  expect(r2.status).toBe(401);
  const body2 = (await r2.json()) as { error: string };
  expect(body2.error).toBe("UNAUTHORIZED");
});

test("HTTP: health with a valid token → full response (uptime/platform/sessions only for authenticated clients)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  const body = (await r.json()) as Record<string, unknown>;
  expect(body.uptimeSec).toBeDefined();
  expect(body.platform).toBeDefined();
  expect(body.sessions).toBeDefined();
});

test("HTTP: wrong token in the header → 401 (negative)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/profiles`, { headers: { "X-HEM-Token": "wrong-token-value-000000" } });
  expect(r.status).toBe(401);
});

test("HTTP: token in the query never authenticates the API → 401 and no Set-Cookie (negative)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/profiles?token=${encodeURIComponent(TOKEN)}`);
  expect(r.status).toBe(401);
  expect(r.headers.get("set-cookie")).toBeNull(); // no cookie is created
});

test("HTTP: valid X-HEM-Token header → 200 (positive)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("HTTP: valid hem_token cookie (no header) → 200 (positive)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
});

test("HTTP: wrong hem_token cookie → 401 (negative)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/profiles`, { headers: { Cookie: "hem_token=wrong-token-value-000000" } });
  expect(r.status).toBe(401);
});

test("HTTP Origin: non-local origin on a write operation → 403 (negative)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://evil.example.com" },
    body: JSON.stringify({ inline: { host: "127.0.0.1", port: 2222 } }),
  });
  expect(r.status).toBe(403);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe("FORBIDDEN");
});

test("HTTP Origin: the localhost origin is allowed and reaches the next layer (positive)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://localhost:3000", "X-HEM-Token": TOKEN },
    body: JSON.stringify({ inline: { host: "127.0.0.1", port: 2222 } }),
  });
  // 400 = input validation (no port/user) — i.e. it got past Origin and the token
  expect(r.status).toBe(400);
  expect(r.status).not.toBe(403);
  expect(r.status).not.toBe(401);
});

// ---------------------------------------------------------------------------
// one-time ?token= → session-cookie exchange (token leaking into URL/history/logs)
// ---------------------------------------------------------------------------
test("Bootstrap: first GET /?token=valid → 303 + HttpOnly/SameSite=Strict session Set-Cookie with no Max-Age (positive)", async () => {
  const r = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).toBe(303);
  const sc = r.headers.get("set-cookie") ?? "";
  expect(sc).toContain(`hem_token=${TOKEN}`);
  expect(sc).toContain("HttpOnly");
  expect(sc).toContain("SameSite=Strict");
  expect(sc).not.toContain("Max-Age"); // session cookie — dies when the browser closes
  // location without token, keeping the other params (like XTransformPort)
  expect(r.headers.get("location")).toBe("/");
});

test("Bootstrap: the 303 keeps the other query params (XTransformPort) and only drops token (positive)", async () => {
  // bootstrap is one-time — this test uses its own fresh app/server so it
  // stays independent of the order of previously-run tests.
  const st = buildTestStack({ token: TOKEN });
  const sv = await listenApp(st.app);
  try {
    const r = await fetch(
      `${sv.baseUrl}/ui/route?token=${encodeURIComponent(TOKEN)}&XTransformPort=3005&foo=bar`,
      { redirect: "manual" },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/ui/route?XTransformPort=3005&foo=bar");
  } finally {
    st.dispose();
    await sv.close();
  }
});

test("Bootstrap: a SECOND GET with the same link (browser-history recovery) → no cookie is set (negative — one-time)", async () => {
  const r = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).not.toBe(303);
  expect(r.headers.get("set-cookie")).toBeNull();
});

test("Bootstrap: a wrong token never sets a cookie (negative)", async () => {
  const r = await fetch(`${srv.baseUrl}/?token=wrong-token-value-000000`, { redirect: "manual" });
  expect(r.status).not.toBe(303);
  expect(r.headers.get("set-cookie")).toBeNull();
});

test("Bootstrap: /api routes never exchange — token in the query is only valid on the UI (negative)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/profiles?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).toBe(401); // no 303, no cookie — as before
  expect(r.headers.get("set-cookie")).toBeNull();
});

// ---------------------------------------------------------------------------
// WebSocket — a connection without a valid token receives no sensitive events
// ---------------------------------------------------------------------------
let ioSrv: ListeningServer & { closeIo: () => Promise<void> };

test("WS: start the server with a token", async () => {
  ioSrv = await listenStackIo(stack, { token: TOKEN });
  expect(ioSrv.baseUrl).toBeTruthy();
});

function wsUrl(path = "/"): string {
  return `${ioSrv.baseUrl.replace(/^http/, "ws")}${path}`;
}

/** socket.io connect with a timeout — resolve(true) only if it stays connected for a "reasonable" while;
 *  an immediate disconnect after connect (server-side reject) → false. The millisecond-level
 *  connect/disconnect race is settled with a short grace period. */
const WS_GRACE_MS = 400;

function tryConnect(extraHeaders: Record<string, string>, timeoutMs = 4000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = io(wsUrl(), { extraHeaders, reconnection: false, timeout: 2500 });
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
      // not a "positive" yet — if the server disconnects immediately (reject), disconnect fires
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

test("WS: no token → the connection is cut (negative)", async () => {
  const ok = await tryConnect({});
  expect(ok).toBe(false);
});

test("WS: wrong token in the header → cut (negative)", async () => {
  const ok = await tryConnect({ "X-HEM-Token": "wrong-token-value-000000" });
  expect(ok).toBe(false);
});

test("WS: valid X-HEM-Token header → connects and commands work (positive)", async () => {
  const ok = await tryConnect({ "X-HEM-Token": TOKEN });
  expect(ok).toBe(true);
});

test("WS: valid hem_token cookie (no header) → connects (positive)", async () => {
  const ok = await tryConnect({ Cookie: `hem_token=${TOKEN}` });
  expect(ok).toBe(true);
});

test("WS: a valid client can emit an event (job:cancel with ack — an allowed path)", async () => {
  const ackResult = await new Promise<unknown>((resolve) => {
    const client = io(wsUrl(), {
      extraHeaders: { "X-HEM-Token": TOKEN },
      reconnection: false,
      timeout: 2000,
    });
    client.on("connect", () => {
      client.emit("job:cancel", { jobId: "job-nonexistent" }, (r: unknown) => {
        client.disconnect();
        resolve(r);
      });
    });
    client.on("connect_error", () => resolve(null));
    setTimeout(() => resolve(null), 3000).unref?.();
  });
  expect(ackResult).toEqual({ ok: false }); // the job doesn't exist — but it IS allowed to send
});

afterAll(async () => {
  // teardown with a safety cap (helpers.close pattern): server.close() hangs on
  // fetch keep-alive sockets (known bun/undici behavior) — without this cap,
  // afterAll would hang for at least 120s. Order: WS, stack, HTTP.
  const cap = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));
  if (ioSrv) await Promise.race([ioSrv.closeIo().catch(() => undefined), cap(2500)]);
  stack.dispose();
  await Promise.race([srv.close(), cap(2500)]);
});
