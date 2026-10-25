// تست پشتیبان/بازیابی/ارتقا (§4 — Task 5-d):
//  • روی سرور تست hsctl نیست → هر ۵ endpoint باید صادقانهٔ NOT_AVAILABLE بدهد
//    (این قابلیت‌ها «پس از نصب اولیه» معنا دارند — رفتار درست همین است)
//  • اعتبارسنجی مسیر فایل پشتیبان (بدون traversal/متکار)
//  • confirm مفقود → NEED_CONFIRM
//  • update/check واقعی (نسخهٔ سرور از shim + پین پروژه)
import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import {
  buildTestStack,
  connectAndConfirm,
  ensureHeadscaleHealthy,
  listenApp,
  type ListeningServer,
  type TestStack,
} from "./helpers";
import { normalizeBackupFile, parseBackupList, parseBackupVerify } from "../src/backupctl";
import { pinnedHsVersion } from "../src/updatectl";

let ts: TestServerHandle;
let stack: TestStack;
let srv: ListeningServer;
let sid: string;
const hsPrefix = "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml";

beforeAll(async () => {
  ensureHeadscaleHealthy();
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: تست منطق کسب‌وکار در استثنای مستندِ توسعه (بدون احراز هویت)
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

const get = async (path: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`);
  return { status: res.status, body: await res.json() };
};
const post = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

// --- واحد: اعتبارسنجی مسیر و پارسرها ---
test("normalizeBackupFile: فقط basename یا مسیر امن زیر /var/backups/hem", () => {
  expect(normalizeBackupFile("hem-backup-2025.tar.gz")).toBe("/var/backups/hem/hem-backup-2025.tar.gz");
  expect(normalizeBackupFile("/var/backups/hem/a/b.tar.gz")).toBe("/var/backups/hem/a/b.tar.gz");
  expect(() => normalizeBackupFile("../../etc/passwd")).toThrow();
  expect(() => normalizeBackupFile("/var/backups/hem/../../etc/passwd")).toThrow();
  expect(() => normalizeBackupFile("/etc/passwd")).toThrow();
  expect(() => normalizeBackupFile("evil;rm.tar.gz")).toThrow();
  expect(() => normalizeBackupFile("a$b.tar.gz")).toThrow();
  expect(() => normalizeBackupFile("")).toThrow();
});

test("parseBackupList / parseBackupVerify: تجزیهٔ خروجی واقعی hsctl", () => {
  const listOut = [
    "پشتیبان‌ها در /var/backups/hem:",
    "نام فایل          حجم",
    "──────────────────────",
    "hem-backup-20251024-101010.tar.gz  12.3 MB",
    "other.tar.gz  0.5 MB",
  ].join("\n");
  const entries = parseBackupList(listOut);
  expect(entries).toHaveLength(2);
  expect(entries[0]).toEqual({ name: "hem-backup-20251024-101010.tar.gz", sizeMb: 12.3 });

  expect(parseBackupVerify("✓ پشتیبان معتبر است: آرشیو، چک‌سام و manifest همگی سالم‌اند.")).toEqual({ ok: true, issues: [] });
  const bad = "✗ پشتیبان قابل اعتماد نیست:\n  - فایل «etc/headscale/config.yaml» با manifest نمی‌خواند.\n  - عضو symlink خطرناک است.";
  const parsed = parseBackupVerify(bad);
  expect(parsed.ok).toBe(false);
  expect(parsed.issues).toHaveLength(2);
  expect(parsed.issues[0]).toContain("config.yaml");
});

test("pinnedHsVersion: پین پروژه (منبع واحد constants.py)", () => {
  expect(pinnedHsVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pinnedHsVersion()).toBe("0.29.5");
});

// --- یکپارچه: hsctl نیست → NOT_AVAILABLE صادقانه ---
test("backup/list: hsctl نیست → 503 NOT_AVAILABLE صادقانه", async () => {
  const { status, body } = await get("/backup/list");
  expect(status).toBe(503);
  expect(body.ok).toBe(false);
  expect(body.error).toBe("NOT_AVAILABLE");
  expect(body.message).toContain("hsctl");
});

test("backup/create: hsctl نیست → 503 NOT_AVAILABLE (job شروع نمی‌شود)", async () => {
  const { status, body } = await post("/backup/create", {});
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("backup/verify: فایل با قالب معتبر اما hsctl نیست → 503 NOT_AVAILABLE", async () => {
  const { status, body } = await post("/backup/verify", { file: "hem-backup-20251024.tar.gz" });
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("backup/verify: مسیر traversal → 400 VALIDATION_FAILED (قبل از هر چیز)", async () => {
  const { status, body } = await post("/backup/verify", { file: "../../etc/passwd" });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("restore: بدون confirm → NEED_CONFIRM با نام فایل", async () => {
  const { status, body } = await post("/restore", { file: "hem-backup-20251024.tar.gz" });
  expect(status).toBe(400);
  expect(body.error).toBe("NEED_CONFIRM");
  expect(body.message).toContain("hem-backup-20251024.tar.gz");
});

test("restore: مسیر مطلق خارج از /var/backups/hem → 400", async () => {
  const { status, body } = await post("/restore", { file: "/tmp/evil.tar.gz", confirm: true });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("restore: confirm مفقود حتی با مسیر traversal → خطای مسیر (اعتبارسنجی اول)", async () => {
  const { status, body } = await post("/restore", { file: "a/../b.tar.gz" });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("restore: قالب معتبر + confirm اما hsctl نیست → 503 NOT_AVAILABLE", async () => {
  const { status, body } = await post("/restore", { file: "hem-backup-20251024.tar.gz", confirm: true });
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("update/execute: بدون confirm → NEED_CONFIRM", async () => {
  const { status, body } = await post("/update/execute", { version: "0.30.0" });
  expect(status).toBe(400);
  expect(body.error).toBe("NEED_CONFIRM");
});

test("update/execute: نسخهٔ نامعتبر → 400 VALIDATION_FAILED", async () => {
  const { status, body } = await post("/update/execute", { version: "latest!", confirm: true });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("update/execute: confirm + قالب معتبر اما hsctl نیست → 503 NOT_AVAILABLE", async () => {
  const { status, body } = await post("/update/execute", { version: "0.30.0", confirm: true });
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("update/check: نسخهٔ واقعی سرور (shim) در برابر پین پروژه", async () => {
  const { status, body } = await get("/update/check");
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.data.current).toBe("0.29.5");
  expect(body.data.latest).toBe("0.29.5");
  expect(body.data.upToDate).toBe(true);
});
