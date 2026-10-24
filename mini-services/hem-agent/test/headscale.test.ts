// تست آداپتورهای headscale روی باینری واقعی v0.29.5 از طریق سرور SSH آزمایشی (shim)
import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import { buildTestStack, connectAndConfirm, ensureHeadscaleHealthy, listenApp, type ListeningServer, type TestStack } from "./helpers";
import type { HsApiKey, HsPreAuthKey, HsUser } from "../src/types";

let ts: TestServerHandle;
let stack: TestStack;
let srv: ListeningServer;
let sid: string;
const hsPrefix = "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml";
const srvPort = (): number => ts.port;

beforeAll(async () => {
  ensureHeadscaleHealthy();
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack();
  srv = await listenApp(stack.app);
  sid = await connectAndConfirm(srv.baseUrl, {
    host: TEST_HOST,
    port: srvPort(),
    username: "z",
    authMethod: "password",
    password: TEST_PASSWORD,
    hsMode: "custom",
    hsCustomPrefix: hsPrefix,
    configPath: "/home/z/hs-test/config.yaml",
    healthUrl: "http://127.0.0.1:8080/health",
    logPath: "/home/z/hs-test/server.log",
  });
}, 30_000);

afterAll(async () => {
  stack.dispose();
  await srv.close();
  await ts.close();
});

const get = async (path: string): Promise<{ status: number; body: unknown }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`);
  return { status: res.status, body: await res.json() };
};
const post = async (path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("users list — آرایهٔ JSON واقعی", async () => {
  const { status, body } = await get("/hs/users");
  expect(status).toBe(200);
  const users = (body as { ok: boolean; data: HsUser[] }).data;
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBeGreaterThan(0);
  expect(users[0].id).toBe(1);
  expect(users[0].name).toBeTruthy();
});

test("users create → destroy (با confirm) — چرخهٔ واقعی", async () => {
  const name = `agent-test-${Date.now()}`;
  const created = await post("/hs/users", { name });
  expect(created.status).toBe(200);
  expect((created.body as { ok: boolean }).ok).toBe(true);

  const users = ((await get("/hs/users")).body as { data: HsUser[] }).data;
  const mine = users.find((u) => u.name === name);
  expect(mine).toBeDefined();
  const id = mine!.id;

  // بدون confirm → NEED_CONFIRM با نام واقعی هدف
  const denied = await post("/hs/users/destroy", { id });
  expect(denied.status).toBe(400);
  const deniedBody = denied.body as { error: string; message: string };
  expect(deniedBody.error).toBe("NEED_CONFIRM");
  expect(deniedBody.message).toContain(name);

  // با confirm → حذف واقعی
  const done = await post("/hs/users/destroy", { id, confirm: true });
  expect(done.status).toBe(200);
  const users2 = ((await get("/hs/users")).body as { data: HsUser[] }).data;
  expect(users2.find((u) => u.name === name)).toBeUndefined();
});

test("preauthkeys: ساخت با کلید کامل یک‌بار + list ماسک‌شده", async () => {
  const before = ((await get("/hs/preauthkeys")).body as { data: HsPreAuthKey[] }).data;
  const beforeIds = new Set(before.map((k) => k.id));

  const created = await post("/hs/preauthkeys", { userId: 1, reusable: true, expiration: "1h" });
  expect(created.status).toBe(200);
  const keyData = (created.body as { data: { key: string; warning: string } }).data;
  expect(keyData.key).toMatch(/^hskey-auth-/);
  expect(keyData.warning).toContain("یک‌بار");

  const after = ((await get("/hs/preauthkeys")).body as { data: HsPreAuthKey[] }).data;
  expect(after.length).toBe(before.length + 1);
  // همهٔ کلیدهای list ماسک‌اند
  for (const k of after) {
    expect(k.key).toContain("***");
  }
  const newKey = after.find((k) => !beforeIds.has(k.id));
  expect(newKey).toBeDefined();
  expect(newKey!.user.id).toBe(1);
  expect(newKey!.reusable).toBe(true);

  // پاک‌سازی واقعی: انقضای کلید ساخته‌شده
  const expired = await post("/hs/preauthkeys/expire", { id: newKey!.id });
  expect(expired.status).toBe(200);

  // audit هرگز کلید کامل را ندیده است
  const auditText = readFileSync(`${stack.home}/audit.log`, "utf8");
  expect(auditText).not.toContain(keyData.key);
  // سرِ کلید ماسک‌شده ممکن است شامل خط تیره باشد (مثل hskey-auth-Dhh4--***) — الگو باید [A-Za-z0-9_-] بپذیرد
  expect(auditText).toMatch(/hskey-auth-[A-Za-z0-9_-]{0,5}-\*\*\*/);
});

test("policy get → {policy:null} وقتی سیاستی تنظیم نشده", async () => {
  const { status, body } = await get("/hs/policy");
  expect(status).toBe(200);
  expect((body as { data: { policy: string | null } }).data.policy).toBeNull();
});

test("apikeys: ساخت (کلید کامل یک‌بار) + list ماسک + انقضا با prefix", async () => {
  const created = await post("/hs/apikeys", { expiration: "1h" });
  expect(created.status).toBe(200);
  const keyData = (created.body as { data: { key: string } }).data;
  expect(keyData.key).toMatch(/^hskey-api-/);

  const list = ((await get("/hs/apikeys")).body as { data: HsApiKey[] }).data;
  expect(list.length).toBeGreaterThan(0);
  const newest = list.reduce((a, b) => (a.id > b.id ? a : b));
  expect(newest.prefix).toContain("***");
  // prefix واقعی از فرم ماسک‌شده: hskey-api-XXXXX-***
  const prefix = newest.prefix.replace(/-\*+$/, "");
  expect(prefix).toMatch(/^hskey-api-/);

  const expired = await post("/hs/apikeys/expire", { prefix });
  expect(expired.status).toBe(200);

  // audit: کلید کامل هرگز ثبت نشده
  const auditText = readFileSync(`${stack.home}/audit.log`, "utf8");
  expect(auditText).not.toContain(keyData.key);
});

test("config validate: پیکربندی معتبر و نامعتبر (configtest واقعی)", async () => {
  const realConfig = readFileSync("/home/z/hs-test/config.yaml", "utf8");

  const valid = await post("/hs/config/validate", { content: realConfig });
  expect(valid.status).toBe(200);
  expect((valid.body as { data: { valid: boolean } }).data.valid).toBe(true);

  const invalid = await post("/hs/config/validate", { content: realConfig + "\n:::garbage: [unclosed\n" });
  expect(invalid.status).toBe(200);
  const invalidBody = (invalid.body as { data: { valid: boolean; error?: string } }).data;
  expect(invalidBody.valid).toBe(false);
  expect(typeof invalidBody.error).toBe("string");
});

test("config get: خواندن پیکربندی واقعی سرور", async () => {
  const { status, body } = await get("/hs/config");
  expect(status).toBe(200);
  const data = (body as { data: { content: string; path: string } }).data;
  expect(data.path).toBe("/home/z/hs-test/config.yaml");
  expect(data.content).toContain("server_url");
});

test("version: تجزیهٔ نسخهٔ واقعی", async () => {
  const { status, body } = await get("/hs/version");
  expect(status).toBe(200);
  expect((body as { data: { version: string } }).data.version).toBe("0.29.5");
});

test("nodes: list و routes — آرایه (حتی وقتی CLI null می‌دهد)", async () => {
  const nodes = ((await get("/hs/nodes")).body as { data: unknown[] }).data;
  expect(Array.isArray(nodes)).toBe(true);
  const routes = ((await get("/hs/nodes/routes")).body as { data: unknown[] }).data;
  expect(Array.isArray(routes)).toBe(true);
});

test("health سه‌لایه: honest — سرویس (فرایند) + HTTP + CLI", async () => {
  const { status, body } = await get("/health");
  expect(status).toBe(200);
  const data = (body as { ok: boolean; data: { healthy: boolean; layers: Record<string, { ok: boolean; via: string }> } }).data;
  expect(data.layers.service.via).toBe("process");
  expect(data.layers.http.ok).toBe(true); // سرور واقعی بالا است
  expect(data.layers.cli.ok).toBe(true);
  expect(data.healthy).toBe(true);
});

test("service status headscale: fallback فرایند (systemd نیست)", async () => {
  const { status, body } = await get("/service/headscale/status");
  expect(status).toBe(200);
  const data = (body as { data: { unit: string; via: string; active: boolean | null } }).data;
  expect(data.unit).toBe("headscale");
  expect(data.via).toBe("process");
  expect(data.active).toBe(true);
});

test("logs: fallback فایل لاگ سرور آزمایشی", async () => {
  const { status, body } = await get("/logs?unit=headscale&lines=20");
  expect(status).toBe(200);
  const data = (body as { data: { source: string; lines: string[] } }).data;
  expect(["journalctl", "file"]).toContain(data.source);
  expect(Array.isArray(data.lines)).toBe(true);
});

test("audit endpoint: رکوردهای اخیر (پاک‌سازی‌شده)", async () => {
  const res = await fetch(`${srv.baseUrl}/api/audit?limit=50`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { entries: { action: string }[] };
  expect(body.entries.length).toBeGreaterThan(0);
});
