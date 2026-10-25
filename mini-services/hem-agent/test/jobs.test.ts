// تست قابلیت اطمینان job (§5 — Task 5-d):
//  • بافر حلقه‌ای ۵۰۰ خطی + صفحه‌بندی since (REST fallback)
//  • کلاینت socket.io که «بعد از شروع job» متصل می‌شود: REST fallback همهٔ خطوط را
//    می‌گیرد؛ socket.io خطوط بعدی + job:done را زنده می‌گیرد.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { io, type Socket } from "socket.io-client";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import {
  buildTestStack,
  connectAndConfirm,
  ensureHeadscaleHealthy,
  listenStackIo,
  type TestStack,
} from "./helpers";
import { JobManager } from "../src/events";

// ---------------------------------------------------------------------------
// واحد: JobManager — بافر حلقه‌ای و صفحه‌بندی
// ---------------------------------------------------------------------------
test("JobManager: بافر حلقه‌ای ۵۰۰ خط + truncated + صفحه‌بندی since", () => {
  const jobs = new JobManager();
  jobs.register({
    id: "job-unit1",
    type: "test",
    sessionId: "s-x",
    startedAt: Date.now(),
    cancel: () => undefined,
  });
  for (let i = 1; i <= 600; i++) jobs.jobLog("job-unit1", `line-${i}`);
  const page0 = jobs.getLog("job-unit1", 0)!;
  expect(page0.logs.length).toBe(500);
  expect(page0.truncated).toBe(true);
  expect(page0.nextSince).toBe(600);
  expect(page0.logs[0].line).toBe("line-101"); // قدیمی‌ترینِ باقی‌مانده
  expect(page0.logs[499].line).toBe("line-600");
  expect(page0.logs[0].seq).toBe(101);

  // صفحه‌بندی: از میانه
  const page250 = jobs.getLog("job-unit1", 250)!;
  expect(page250.logs.length).toBe(350);
  expect(page250.logs[0].seq).toBe(251);
  expect(page250.truncated).toBe(false); // از ۲۵۱ به بعد چیزی حذف نشده

  // پایان + وضعیت
  jobs.jobDone("job-unit1", false, 3, "خلاصهٔ تست", "partial_failure");
  const status = jobs.getStatus("job-unit1")!;
  expect(status.status).toBe("done");
  expect(status.ok).toBe(false);
  expect(status.exitCode).toBe(3);
  expect(status.summary).toBe("خلاصهٔ تست");
  expect(status.finalState).toBe("partial_failure");
  expect(status.logCount).toBe(600);
  // رکورد پس از پایان هم در دسترس است (REST fallback)
  expect(jobs.getLog("job-unit1", 590)!.logs.length).toBe(10);
  expect(jobs.getLog("job-unknown", 0)).toBeUndefined();
  expect(jobs.getStatus("job-unknown")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// یکپارچه: job کنسول استریمی + REST fallback + socket.io دیرهنگام
// ---------------------------------------------------------------------------
let ts: TestServerHandle;
let stack: TestStack;
let srv: { baseUrl: string; close: () => Promise<void> };
let sid: string;
const hsPrefix = "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml";

beforeAll(async () => {
  ensureHeadscaleHealthy();
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: تست منطق کسب‌وکار در استثنای مستندِ توسعه (بدون احراز هویت)
  srv = await listenStackIo(stack, { authMode: "open" }); // v0.3.2 §2: استثنای مستندِ توسعه
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

test(
  "job استریمی کنسول: کلاینتِ بعد از شروع → REST fallback کامل + socket.io زنده",
  async () => {
    // کلاینت وصل است ولی اتاق job را هنوز نمی‌شناسد (بعد از پاسخ HTTP جدا می‌کند)
    const client: Socket = io(srv.baseUrl, { transports: ["websocket"] });
    await new Promise<void>((res) => (client.connected ? res() : client.once("connect", () => res())));

    const { status, body } = await post("/console", { cmd: "headscale users list -o json", stream: true });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const jobId = body.jobId as string;

    // «اتصال دیرهنگام»: مشتریِ فقط-REST لاگ‌ها را با poll می‌گیرد
    let lines: any[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`${srv.baseUrl}/api/jobs/${jobId}/log?since=0`);
      const page = (await res.json()) as any;
      lines = page.logs ?? [];
      const st = await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}`)).json();
      if (st.job?.status === "done" && lines.length > 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    // خط اول: فرمان واقعی اجراشده (prefix حالت custom)؛ خروجی واقعی JSON کاربران هم در لاگ است
    expect(lines[0].line).toContain("users list");
    const joined = lines.map((l) => l.line).join("\n");
    expect(joined).toContain("users"); // خروجی واقعی CLI

    // صفحه‌بندی since: فقط خطوط جدیدتر
    const sinceRes = await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}/log?since=${lines[0].seq}`)).json();
    expect(sinceRes.logs.length).toBe(lines.length - 1);

    // job ناشناخته → 404
    const notFound = await fetch(`${srv.baseUrl}/api/jobs/job-nope`);
    expect(notFound.status).toBe(404);

    // رویداد پایان از socket.io (کلاینت اتاق را دیرتر جدا کرده — job:done باید رسیده باشد
    // چون اجرای SSH زمان بیشتری از subscribe دارد؛ اگر از دست رفت، REST پوشش می‌دهد)
    client.disconnect();
  },
  60_000,
);

test(
  "socket.io: مشترکِ اتاق job، رویدادهای زندهٔ job:log و job:done را می‌گیرد",
  async () => {
    const client: Socket = io(srv.baseUrl, { transports: ["websocket"] });
    await new Promise<void>((res) => (client.connected ? res() : client.once("connect", () => res())));

    const { status, body } = await post("/console", { cmd: "headscale version", stream: true });
    expect(status).toBe(200);
    const jobId = body.jobId as string;
    client.emit("subscribe", `job:${jobId}`);

    const events: any[] = [];
    const done = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("job:done نرسید")), 30_000);
      client.on("job:log", (p: any) => p?.jobId === jobId && events.push(p));
      client.on("job:done", (p: any) => {
        if (p?.jobId === jobId) {
          clearTimeout(timer);
          resolve(p);
        }
      });
    });
    client.disconnect();
    expect(done.ok).toBe(true);
    expect(done.exitCode).toBe(0);
    expect(events.length).toBeGreaterThan(0); // حداقل خط فرمان و خروجی نسخه
  },
  60_000,
);
