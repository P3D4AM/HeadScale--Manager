// Backup/restore/upgrade tests (§4 — Task 5-d):
//  • hsctl is not on the test server → all 5 endpoints must honestly return NOT_AVAILABLE
//    (these features only make sense "after the initial install" — that IS the correct behavior)
//  • backup file path validation (no traversal/metacharacters)
//  • missing confirm → NEED_CONFIRM
//  • a real update/check (server version from the shim + the project pin)
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
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: business-logic tests under the documented dev exception (no auth)
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

// --- unit: path validation and parsers ---
test("normalizeBackupFile: only a basename or a safe path under /var/backups/hem", () => {
  expect(normalizeBackupFile("hem-backup-2025.tar.gz")).toBe("/var/backups/hem/hem-backup-2025.tar.gz");
  expect(normalizeBackupFile("/var/backups/hem/a/b.tar.gz")).toBe("/var/backups/hem/a/b.tar.gz");
  expect(() => normalizeBackupFile("../../etc/passwd")).toThrow();
  expect(() => normalizeBackupFile("/var/backups/hem/../../etc/passwd")).toThrow();
  expect(() => normalizeBackupFile("/etc/passwd")).toThrow();
  expect(() => normalizeBackupFile("evil;rm.tar.gz")).toThrow();
  expect(() => normalizeBackupFile("a$b.tar.gz")).toThrow();
  expect(() => normalizeBackupFile("")).toThrow();
});

test("parseBackupList / parseBackupVerify: parse real hsctl output", () => {
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

test("pinnedHsVersion: the project pin (single source constants.py)", () => {
  expect(pinnedHsVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  expect(pinnedHsVersion()).toBe("0.29.5");
});

// --- integration: no hsctl → honest NOT_AVAILABLE ---
test("backup/list: no hsctl → honest 503 NOT_AVAILABLE", async () => {
  const { status, body } = await get("/backup/list");
  expect(status).toBe(503);
  expect(body.ok).toBe(false);
  expect(body.error).toBe("NOT_AVAILABLE");
  expect(body.message).toContain("hsctl");
});

test("backup/create: no hsctl → 503 NOT_AVAILABLE (no job is started)", async () => {
  const { status, body } = await post("/backup/create", {});
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("backup/verify: valid-format file but no hsctl → 503 NOT_AVAILABLE", async () => {
  const { status, body } = await post("/backup/verify", { file: "hem-backup-20251024.tar.gz" });
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("backup/verify: traversal path → 400 VALIDATION_FAILED (before anything else)", async () => {
  const { status, body } = await post("/backup/verify", { file: "../../etc/passwd" });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("restore: no confirm → NEED_CONFIRM with the file name", async () => {
  const { status, body } = await post("/restore", { file: "hem-backup-20251024.tar.gz" });
  expect(status).toBe(400);
  expect(body.error).toBe("NEED_CONFIRM");
  expect(body.message).toContain("hem-backup-20251024.tar.gz");
});

test("restore: absolute path outside /var/backups/hem → 400", async () => {
  const { status, body } = await post("/restore", { file: "/tmp/evil.tar.gz", confirm: true });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("restore: missing confirm even with a traversal path → path error (validation first)", async () => {
  const { status, body } = await post("/restore", { file: "a/../b.tar.gz" });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("restore: valid format + confirm but no hsctl → 503 NOT_AVAILABLE", async () => {
  const { status, body } = await post("/restore", { file: "hem-backup-20251024.tar.gz", confirm: true });
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("update/execute: no confirm → NEED_CONFIRM", async () => {
  const { status, body } = await post("/update/execute", { version: "0.30.0" });
  expect(status).toBe(400);
  expect(body.error).toBe("NEED_CONFIRM");
});

test("update/execute: invalid version → 400 VALIDATION_FAILED", async () => {
  const { status, body } = await post("/update/execute", { version: "latest!", confirm: true });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
});

test("update/execute: confirm + valid format but no hsctl → 503 NOT_AVAILABLE", async () => {
  const { status, body } = await post("/update/execute", { version: "0.30.0", confirm: true });
  expect(status).toBe(503);
  expect(body.error).toBe("NOT_AVAILABLE");
});

test("update/check: the server's real version (shim) vs the project pin", async () => {
  const { status, body } = await get("/update/check");
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.data.current).toBe("0.29.5");
  expect(body.data.latest).toBe("0.29.5");
  expect(body.data.upToDate).toBe(true);
});
