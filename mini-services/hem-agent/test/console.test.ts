// تست کنسول (قرارداد §9) — allowlist واقعی؛ اجرای واقعی headscale از طریق shim؛
// دستور مسدود هرگز اجرا نمی‌شود (اثر جانبی بررسی می‌شود).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import {
  buildTestStack,
  connectAndConfirm,
  ensureHeadscaleHealthy,
  listenApp,
  type ListeningServer,
  type TestStack,
} from "./helpers";

let ts: TestServerHandle;
let stack: TestStack;
let srv: ListeningServer;
let sid: string;
const hsPrefix = "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml";

beforeAll(async () => {
  ensureHeadscaleHealthy();
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack();
  srv = await listenApp(stack.app);
  sid = await connectAndConfirm(srv.baseUrl, {
    host: TEST_HOST,
    port: ts.port,
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

const post = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("preview: دستور مجاز → allowed + رشتهٔ دقیق (در حالت custom = prefix واقعی پروفایل)", async () => {
  const { status, body } = await post("/console/preview", { cmd: "headscale users list -o json" });
  expect(status).toBe(200);
  expect(body.allowed).toBe(true);
  // فرمان واقعی که اجرا خواهد شد: prefix حالت custom + آرگومان‌های کاربر
  expect(body.exactCommand).toBe(`${hsPrefix} users list -o json`);
  expect(body.reason).toBeUndefined();
});

test("preview: دستور مسدود → دلیل فارسی", async () => {
  const { status, body } = await post("/console/preview", { cmd: "ufw allow 22/tcp" });
  expect(status).toBe(200);
  expect(body.allowed).toBe(false);
  expect(body.exactCommand).toBe("");
  expect(body.reason).toContain("ufw");
});

test("اجرای واقعی: headscale users list -o json (باینری واقعی از طریق shim)", async () => {
  const { status, body } = await post("/console", { cmd: "headscale users list -o json" });
  expect(status).toBe(200);
  expect(body.exitCode).toBe(0);
  const users = JSON.parse(body.stdout);
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBeGreaterThan(0);
  expect(users[0].name).toBeTruthy();
});

test("دستور مسدود → 400 COMMAND_BLOCKED بدون هیچ اجرا (اثر جانبی صفر)", async () => {
  const marker = `/tmp/hem-console-pwned-${Date.now()}`;
  const { status, body } = await post("/console", { cmd: `headscale users list; touch ${marker}` });
  expect(status).toBe(400);
  expect(body.error).toBe("COMMAND_BLOCKED");
  expect(body.message).toBeTruthy(); // دلیل فارسی
  // هیچ اجرایی رخ نداده — فایل مارکر ساخته نشده است
  expect(existsSync(marker)).toBe(false);
});

test("curl به میزبان غیرمجاز → COMMAND_BLOCKED", async () => {
  const { status, body } = await post("/console", { cmd: "curl -s -m 5 http://evil.example.com/x" });
  expect(status).toBe(400);
  expect(body.error).toBe("COMMAND_BLOCKED");
});

test("curl مجاز به health محلی → اجرای واقعی", async () => {
  const { status, body } = await post("/console", { cmd: "curl -s -m 5 http://127.0.0.1:8080/health" });
  expect(status).toBe(200);
  expect(body.exitCode).toBe(0);
  expect(body.stdout).toContain("pass");
});

test("audit: دستور اجراشده در حسابرسی ثبت شده است", async () => {
  const res = await fetch(`${srv.baseUrl}/api/audit?limit=50`);
  const body = (await res.json()) as { entries: { action: string; target?: string }[] };
  const exec = body.entries.filter((e) => e.action === "console_exec");
  expect(exec.length).toBeGreaterThan(0);
  expect(exec.some((e) => (e.target ?? "").includes("users list"))).toBe(true);
});
