// Connect tests: password/key, two-step TOFU, host-key mismatch (409), exec/timeout, disconnect
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import { buildTestStack, listenApp, type ListeningServer, type TestStack } from "./helpers";
import { SshSession } from "../src/ssh";
import { isHemError } from "../src/errors";

let ts: TestServerHandle;
let stack: TestStack;
let srv: ListeningServer;

beforeAll(async () => {
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: business-logic tests under the documented dev exception (no auth)
  srv = await listenApp(stack.app);
}, 20_000);

afterAll(async () => {
  stack.dispose();
  await srv.close();
  await ts.close();
});

// port 2222 may be taken by the demo server (bun run test/server.ts) → ephemeral port
const base = () => srv.baseUrl;
const srvPort = (): number => ts.port;

test("password connect: fingerprint-required → confirm → connected", async () => {
  const r1 = await fetch(`${base()}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inline: {
        host: TEST_HOST,
        port: srvPort(),
        username: "z",
        authMethod: "password",
        password: TEST_PASSWORD,
        hsMode: "custom",
        hsCustomPrefix: "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml",
      },
    }),
  });
  expect(r1.status).toBe(200);
  const c1 = (await r1.json()) as {
    status: string;
    sessionId: string;
    fingerprint: { algo: string; hash: string; base64Md5: string };
  };
  expect(c1.status).toBe("fingerprint-required");
  expect(c1.fingerprint.algo).toBe("ssh-rsa");
  expect(c1.fingerprint.hash).toMatch(/^SHA256:/);
  expect(c1.fingerprint.base64Md5).toMatch(/^[0-9A-F:]+$/);

  // until confirmed, the session is not usable
  const probe = await fetch(`${base()}/api/s/${c1.sessionId}/probe`);
  expect(probe.status).toBe(409);
  const pbody = (await probe.json()) as { error: string };
  expect(pbody.error).toBe("FINGERPRINT_REQUIRED");

  const r2 = await fetch(`${base()}/api/connect/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: c1.sessionId, accept: true }),
  });
  expect(r2.status).toBe(200);
  const c2 = (await r2.json()) as { status: string; sudoMode: string; serverInfo: { fingerprint?: { algo: string } } };
  expect(c2.status).toBe("connected");
  expect(c2.serverInfo.fingerprint?.algo).toBe("ssh-rsa");
  expect(["root", "nopasswd", "password", "none"]).toContain(c2.sudoMode);

  // in the session list
  const ls = (await (await fetch(`${base()}/api/sessions`)).json()) as { sessions: { id: string; status: string }[] };
  const mine = ls.sessions.find((s) => s.id === c1.sessionId);
  expect(mine?.status).toBe("connected");

  // a real exec of echo hello through the session
  const res = await stack.manager.exec(c1.sessionId, "echo hello");
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe("hello");

  // disconnect
  const dis = await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: c1.sessionId }),
  });
  expect(dis.status).toBe(200);
  const ls2 = (await (await fetch(`${base()}/api/sessions`)).json()) as { sessions: { id: string }[] };
  expect(ls2.sessions.find((s) => s.id === c1.sessionId)).toBeUndefined();
}, 20_000);

test("wrong password → AUTH_FAILED (this server's host key is already known)", async () => {
  const r1 = await fetch(`${base()}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inline: {
        host: TEST_HOST,
        port: srvPort(),
        username: "z",
        authMethod: "password",
        password: "wrong-password",
      },
    }),
  });
  // the host key is known → goes straight to userauth and is rejected there
  expect(r1.status).toBe(401);
  const c1 = (await r1.json()) as { error: string };
  expect(c1.error).toBe("AUTH_FAILED");

  // also exercise the park path: temporarily forget the key → park → confirm → AUTH_FAILED
  await fetch(`${base()}/api/known-hosts/forget`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST, port: srvPort(), confirm: true }),
  });
  const p1 = await fetch(`${base()}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inline: {
        host: TEST_HOST,
        port: srvPort(),
        username: "z",
        authMethod: "password",
        password: "wrong-password",
      },
    }),
  });
  const body1 = (await p1.json()) as { status: string; sessionId: string };
  expect(body1.status).toBe("fingerprint-required");
  const p2 = await fetch(`${base()}/api/connect/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: body1.sessionId, accept: true }),
  });
  expect(p2.status).toBe(401);
  expect(((await p2.json()) as { error: string }).error).toBe("AUTH_FAILED");

  // re-confirm the valid host key so later tests are simple
  const okSid = await connectFull({ authMethod: "password", password: TEST_PASSWORD });
  await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: okSid }),
  });
}, 20_000);

test("connect with an ed25519 key (no passphrase)", async () => {
  const keyContent = readFileSync(join(import.meta.dir, "fixtures", "id_ed25519"), "utf8");
  const sid = await connectFull({
    authMethod: "key",
    keyContent,
  });
  expect(sid).toBeTruthy();
  const res = await stack.manager.exec(sid, "echo via-key");
  expect(res.stdout.trim()).toBe("via-key");
  await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sid }),
  });
});

test("connect with an ed25519 key that has a passphrase — correct/incorrect", async () => {
  const keyContent = readFileSync(join(import.meta.dir, "fixtures", "id_ed25519_pass"), "utf8");
  // wrong passphrase → AUTH_FAILED
  const sshBad = new SshSession({
    host: TEST_HOST,
    port: srvPort(),
    username: "z",
    privateKey: keyContent,
    passphrase: "wrong-pass",
    verifyHostKey: () => "accept",
  });
  let badCode: string | null = null;
  try {
    await sshBad.connect();
  } catch (e) {
    badCode = isHemError(e) ? e.code : "OTHER";
  }
  expect(badCode).toBe("AUTH_FAILED");
  sshBad.close();

  // correct passphrase via the API (this server's key is known → straight to connected)
  const sid = await connectFull({ authMethod: "key", keyContent, passphrase: "test-pass" });
  const res = await stack.manager.exec(sid, "echo via-key-pass");
  expect(res.stdout.trim()).toBe("via-key-pass");
  await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sid }),
  });
});

test("exec: output streaming + timeout + health after a timeout", async () => {
  const ssh = new SshSession({
    host: TEST_HOST,
    port: srvPort(),
    username: "z",
    password: TEST_PASSWORD,
    verifyHostKey: () => "accept",
  });
  const outcome = await ssh.connect();
  expect(outcome.kind).toBe("connected");

  // real streaming: a few output lines
  const chunks: string[] = [];
  const res = await ssh.exec("for i in 1 2 3 4 5; do echo \"line$i\"; done", {
    onStdout: (c) => chunks.push(c),
  });
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("line5");
  expect(chunks.join("")).toContain("line1");

  // timeout: sleep 10 with an 800ms cap
  let timedOut = false;
  try {
    await ssh.exec("sleep 10", { timeoutMs: 800 });
  } catch (e) {
    timedOut = isHemError(e) && e.code === "EXEC_FAILED" && Boolean((e.detail as { timedOut?: boolean })?.timedOut);
  }
  expect(timedOut).toBe(true);

  // the connection is still healthy
  const alive = await ssh.exec("echo still-alive");
  expect(alive.code).toBe(0);
  expect(alive.stdout.trim()).toBe("still-alive");
  ssh.close();
});

test("host-key mismatch: server with a new key → 409 HOSTKEY_CHANGED → forget → reconnect", async () => {
  // the current server key was stored in the first test — restart the server with a new key "on the same port"
  const oldPort = srvPort();
  await ts.close();
  ts = await startTestServer({ port: oldPort }); // same port, new host key (fresh RSA every time)

  const r = await fetch(`${base()}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inline: {
        host: TEST_HOST,
        port: srvPort(),
        username: "z",
        authMethod: "password",
        password: TEST_PASSWORD,
      },
    }),
  });
  expect(r.status).toBe(409);
  const body = (await r.json()) as {
    error: string;
    message: string;
    detail: { stored: { sha256: string }; presented: { hash: string } };
  };
  expect(body.error).toBe("HOSTKEY_CHANGED");
  expect(body.message).toContain("کلید میزبان");
  expect(body.detail.stored.sha256).not.toBe(body.detail.presented.hash);

  // forget without confirm → NEED_CONFIRM
  const f1 = await fetch(`${base()}/api/known-hosts/forget`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST, port: srvPort() }),
  });
  expect(f1.status).toBe(400);
  expect(((await f1.json()) as { error: string }).error).toBe("NEED_CONFIRM");

  // forget with confirm → reconnect becomes possible (TOFU again)
  const f2 = await fetch(`${base()}/api/known-hosts/forget`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST, port: srvPort(), confirm: true }),
  });
  expect(f2.status).toBe(200);

  const sid = await connectFull({ authMethod: "password", password: TEST_PASSWORD });
  const res = await stack.manager.exec(sid, "echo after-forget");
  expect(res.stdout.trim()).toBe("after-forget");
  await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sid }),
  });
}, 20_000);

test("fingerprint rejection (accept:false) → declined and closed", async () => {
  // forget the key first so the park path is exercised
  await fetch(`${base()}/api/known-hosts/forget`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST, port: srvPort(), confirm: true }),
  });
  const r1 = await fetch(`${base()}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inline: { host: TEST_HOST, port: srvPort(), username: "z", authMethod: "password", password: TEST_PASSWORD },
    }),
  });
  const c1 = (await r1.json()) as { status: string; sessionId: string };
  expect(c1.status).toBe("fingerprint-required");
  const r2 = await fetch(`${base()}/api/connect/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: c1.sessionId, accept: false }),
  });
  const c2 = (await r2.json()) as { status: string };
  expect(c2.status).toBe("declined");
  const ls = (await (await fetch(`${base()}/api/sessions`)).json()) as { sessions: { id: string }[] };
  expect(ls.sessions.find((s) => s.id === c1.sessionId)).toBeUndefined();
  // the key must NOT be stored
  const kh = (await (await fetch(`${base()}/api/known-hosts`)).json()) as {
    knownHosts: Record<string, unknown>;
  };
  expect(kh.knownHosts[`${TEST_HOST}:${srvPort()}`]).toBeUndefined();
});

/** Full connect with inline — local helper */
async function connectFull(inline: Record<string, unknown>): Promise<string> {
  const r1 = await fetch(`${base()}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inline: {
        host: TEST_HOST,
        port: srvPort(),
        username: "z",
        ...inline,
      },
    }),
  });
  if (r1.status !== 200) {
    throw new Error(`connect HTTP ${r1.status}: ${await r1.text()}`);
  }
  const c1 = (await r1.json()) as { status: string; sessionId: string };
  if (c1.status === "connected") return c1.sessionId;
  const r2 = await fetch(`${base()}/api/connect/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: c1.sessionId, accept: true }),
  });
  const c2 = (await r2.json()) as { status: string; sessionId: string };
  if (c2.status !== "connected") throw new Error(`confirm: ${JSON.stringify(c2)}`);
  return c2.sessionId;
}
