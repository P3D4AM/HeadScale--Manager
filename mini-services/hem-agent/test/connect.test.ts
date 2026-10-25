// تست اتصال: رمز/کلید، TOFU دومرحله‌ای، مغایرت کلید میزبان (409)، exec/timeout، قطع
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
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: تست منطق کسب‌وکار در استثنای مستندِ توسعه (بدون احراز هویت)
  srv = await listenApp(stack.app);
}, 20_000);

afterAll(async () => {
  stack.dispose();
  await srv.close();
  await ts.close();
});

// پورت ۲۲۲۲ ممکن است توسط سرور دمو (bun run test/server.ts) اشغال باشد → پورت لحظه‌ای
const base = () => srv.baseUrl;
const srvPort = (): number => ts.port;

test("اتصال با رمز: fingerprint-required → confirm → connected", async () => {
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

  // تا تأیید نشود، نشست قابل استفاده نیست
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

  // در فهرست نشست‌ها
  const ls = (await (await fetch(`${base()}/api/sessions`)).json()) as { sessions: { id: string; status: string }[] };
  const mine = ls.sessions.find((s) => s.id === c1.sessionId);
  expect(mine?.status).toBe("connected");

  // exec واقعی echo hello از طریق نشست
  const res = await stack.manager.exec(c1.sessionId, "echo hello");
  expect(res.code).toBe(0);
  expect(res.stdout.trim()).toBe("hello");

  // قطع
  const dis = await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: c1.sessionId }),
  });
  expect(dis.status).toBe(200);
  const ls2 = (await (await fetch(`${base()}/api/sessions`)).json()) as { sessions: { id: string }[] };
  expect(ls2.sessions.find((s) => s.id === c1.sessionId)).toBeUndefined();
}, 20_000);

test("رمز نادرست → AUTH_FAILED (کلید میزبان همین سرور قبلاً شناخته شده)", async () => {
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
  // کلید میزبان شناخته‌شده است → مستقیم به userauth می‌رود و آنجا رد می‌شود
  expect(r1.status).toBe(401);
  const c1 = (await r1.json()) as { error: string };
  expect(c1.error).toBe("AUTH_FAILED");

  // با مسیر پارک هم آزمایش می‌کنیم: کلید را موقتاً فراموش کن → park → confirm → AUTH_FAILED
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

  // کلید میزبان معتبر را دوباره تأیید می‌کنیم تا تست‌های بعدی ساده باشند
  const okSid = await connectFull({ authMethod: "password", password: TEST_PASSWORD });
  await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: okSid }),
  });
}, 20_000);

test("اتصال با کلید ed25519 (بدون passphrase)", async () => {
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

test("اتصال با کلید ed25519 دارای passphrase درست/نادرست", async () => {
  const keyContent = readFileSync(join(import.meta.dir, "fixtures", "id_ed25519_pass"), "utf8");
  // passphrase نادرست → AUTH_FAILED
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

  // passphrase درست از طریق API (کلید همین سرور شناخته‌شده است → مستقیم connected)
  const sid = await connectFull({ authMethod: "key", keyContent, passphrase: "test-pass" });
  const res = await stack.manager.exec(sid, "echo via-key-pass");
  expect(res.stdout.trim()).toBe("via-key-pass");
  await fetch(`${base()}/api/disconnect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: sid }),
  });
});

test("exec: استریم خروجی + مهلت زمانی + سلامت بعد از timeout", async () => {
  const ssh = new SshSession({
    host: TEST_HOST,
    port: srvPort(),
    username: "z",
    password: TEST_PASSWORD,
    verifyHostKey: () => "accept",
  });
  const outcome = await ssh.connect();
  expect(outcome.kind).toBe("connected");

  // استریم واقعی: چند خط خروجی
  const chunks: string[] = [];
  const res = await ssh.exec("for i in 1 2 3 4 5; do echo \"line$i\"; done", {
    onStdout: (c) => chunks.push(c),
  });
  expect(res.code).toBe(0);
  expect(res.stdout).toContain("line5");
  expect(chunks.join("")).toContain("line1");

  // timeout: sleep 10 با مهلت ۸۰۰ms
  let timedOut = false;
  try {
    await ssh.exec("sleep 10", { timeoutMs: 800 });
  } catch (e) {
    timedOut = isHemError(e) && e.code === "EXEC_FAILED" && Boolean((e.detail as { timedOut?: boolean })?.timedOut);
  }
  expect(timedOut).toBe(true);

  // اتصال هنوز سالم است
  const alive = await ssh.exec("echo still-alive");
  expect(alive.code).toBe(0);
  expect(alive.stdout.trim()).toBe("still-alive");
  ssh.close();
});

test("مغایرت کلید میزبان: سرور با کلید جدید → 409 HOSTKEY_CHANGED → forget → اتصال مجدد", async () => {
  // کلید سرور فعلی در تست اول ذخیره شده است — سرور را با کلید جدید «روی همان پورت» ری‌استارت می‌کنیم
  const oldPort = srvPort();
  await ts.close();
  ts = await startTestServer({ port: oldPort }); // همان پورت، کلید میزبان جدید (هر بار RSA تازه)

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

  // forget بدون confirm → NEED_CONFIRM
  const f1 = await fetch(`${base()}/api/known-hosts/forget`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ host: TEST_HOST, port: srvPort() }),
  });
  expect(f1.status).toBe(400);
  expect(((await f1.json()) as { error: string }).error).toBe("NEED_CONFIRM");

  // forget با confirm → اتصال مجدد ممکن می‌شود (TOFU دوباره)
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

test("رد اثرانگشت (accept:false) → declined و بسته‌شدن", async () => {
  // ابتدا کلید را فراموش می‌کنیم تا مسیر پارک طی شود
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
  // کلید ذخیره نشده باید باشد
  const kh = (await (await fetch(`${base()}/api/known-hosts`)).json()) as {
    knownHosts: Record<string, unknown>;
  };
  expect(kh.knownHosts[`${TEST_HOST}:${srvPort()}`]).toBeUndefined();
});

/** اتصال کامل با inline — helper محلی */
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
