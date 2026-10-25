// Console tests (spec §9) — the real allowlist; real headscale runs via the shim;
// a blocked command is never executed (side effects are verified).
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

const post = async (path: string, body: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test("preview: allowed command → allowed + exact string (in custom mode = the profile's real prefix)", async () => {
  const { status, body } = await post("/console/preview", { cmd: "headscale users list -o json" });
  expect(status).toBe(200);
  expect(body.allowed).toBe(true);
  // the real command that will run: the custom-mode prefix + the user's arguments
  expect(body.exactCommand).toBe(`${hsPrefix} users list -o json`);
  expect(body.reason).toBeUndefined();
});

test("preview: blocked command → Persian reason", async () => {
  const { status, body } = await post("/console/preview", { cmd: "ufw allow 22/tcp" });
  expect(status).toBe(200);
  expect(body.allowed).toBe(false);
  expect(body.exactCommand).toBe("");
  expect(body.reason).toContain("ufw");
});

test("real execution: headscale users list -o json (the real binary via the shim)", async () => {
  const { status, body } = await post("/console", { cmd: "headscale users list -o json" });
  expect(status).toBe(200);
  expect(body.exitCode).toBe(0);
  const users = JSON.parse(body.stdout);
  expect(Array.isArray(users)).toBe(true);
  expect(users.length).toBeGreaterThan(0);
  expect(users[0].name).toBeTruthy();
});

test("blocked command → 400 COMMAND_BLOCKED with no execution at all (zero side effects)", async () => {
  const marker = `/tmp/hem-console-pwned-${Date.now()}`;
  const { status, body } = await post("/console", { cmd: `headscale users list; touch ${marker}` });
  expect(status).toBe(400);
  expect(body.error).toBe("COMMAND_BLOCKED");
  expect(body.message).toBeTruthy(); // Persian reason
  // nothing was executed — the marker file was not created
  expect(existsSync(marker)).toBe(false);
});

test("curl to a disallowed host → COMMAND_BLOCKED", async () => {
  const { status, body } = await post("/console", { cmd: "curl -s -m 5 http://evil.example.com/x" });
  expect(status).toBe(400);
  expect(body.error).toBe("COMMAND_BLOCKED");
});

test("allowed curl to the local health → real execution", async () => {
  const { status, body } = await post("/console", { cmd: "curl -s -m 5 http://127.0.0.1:8080/health" });
  expect(status).toBe(200);
  expect(body.exitCode).toBe(0);
  expect(body.stdout).toContain("pass");
});

test("audit: the executed command is recorded in the audit log", async () => {
  const res = await fetch(`${srv.baseUrl}/api/audit?limit=50`);
  const body = (await res.json()) as { entries: { action: string; target?: string }[] };
  const exec = body.entries.filter((e) => e.action === "console_exec");
  expect(exec.length).toBeGreaterThan(0);
  expect(exec.some((e) => (e.target ?? "").includes("users list"))).toBe(true);
});
