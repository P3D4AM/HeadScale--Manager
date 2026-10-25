// §5 recovery tests (v0.3.1) — the "real outcome" is verified, not just that a command ran.
//  • disconnect mid-operation: a real execCancellable cancel over real SSH +
//    a "cancelled" outcome and job events.
//  • retry after an error: a blocked command (console error) → a healthy system →
//    the next allowed command actually runs.

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
// 1) disconnect mid-operation — a real cancel on a live SSH channel
// ---------------------------------------------------------------------------
test("mid-op cancel: real execCancellable → cancel mid-run → honest \"cancelled\" outcome", async () => {
  const ctx = stack.manager.hsContext(sid);
  expect(ctx).toBeTruthy();

  // a long no-op command (3s) — straight from the SSH layer; like the install flow
  // which runs its script via execCancellable (the allowlist is a console-only feature).
  const { result, cancel } = ctx.ssh.execCancellable(
    "sleep 3 && echo FINISHED_AFTER_SLEEP",
    { timeoutMs: 20_000, onStdout: () => undefined, onStderr: () => undefined },
  );
  // cancel after 400ms — a disconnect in the middle of the operation
  await new Promise((r) => setTimeout(r, 400));
  cancel();

  // the two honest cancel paths in ssh.ts: (a) resolve with cancelled:true and
  // partial output; (b) a throw with HemError EXEC_FAILED + detail.cancelled. Both mean
  // "cancelled" — neither is "success" and the command must not have run to completion.
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
  expect(outcome).not.toBe("BAD-completed"); // a fully "run and succeeded" command would be fake
  if (outcome === "resolved-cancelled" && resolved) {
    expect(resolved.stdout).not.toContain("FINISHED_AFTER_SLEEP"); // truly cut off mid-run
  } else if (outcome === "thrown-cancelled" && thrown) {
    expect(thrown.code).toBe("EXEC_FAILED");
  }
});

test("mid-op cancel: a real job with job:* events — the final outcome is \"cancelled\", not success", async () => {
  const ctx = stack.manager.hsContext(sid);
  const jobs = stack.jobs;
  const events: string[] = [];
  const jobId = "job-recovery-cancel";
  jobs.register({ id: jobId, type: "recovery-test", sessionId: sid, startedAt: Date.now(), cancel: () => undefined });
  const streamer = jobs; // we don't get events via the public subscribe; we read from the JobManager itself

  // exact simulation of runInstallJob: streaming + cancel + jobDone(false)
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
  expect(rec?.ok).toBe(false); // never "ok"
  expect(rec?.summary).toContain("لغو");
  // a real cancel happened and the command did not run to the end
  expect(cancelledFlag || events.includes("resolved-cancelled") || events.includes("thrown-cancelled")).toBe(true);
  expect(completedFully).toBe(false);
  expect(events).not.toContain("exit:0");
});

// ---------------------------------------------------------------------------
// 2) retrying the operation after an error — the system stays healthy and the next operation is real
// ---------------------------------------------------------------------------
test("retry-after-error: a blocked command (error) → healthy system → the next allowed command actually runs", async () => {
  // (a) the error: a blocked free-form command — never executed
  const blocked = await post(`/api/s/${sid}/console`, { cmd: "rm -rf /" });
  expect([403, 400, 500]).toContain(blocked.status);
  expect(blocked.body?.error).toBe("COMMAND_BLOCKED");

  // (b) health after the error: the session is still connected and a real exec answers
  const ok1 = await post(`/api/s/${sid}/console`, { cmd: "df -h" });
  expect(ok1.status).toBe(200);
  expect(ok1.body?.ok).toBe(true);
  expect(ok1.body?.exitCode).toBe(0);
  expect(String(ok1.body?.stdout)).toContain("Filesystem");

  // (c) another error (a blocked preview) → the next run is still healthy
  const blocked2 = await post(`/api/s/${sid}/console/preview`, { cmd: "curl http://evil.example.com/x" });
  expect(blocked2.status).toBe(200);
  expect(blocked2.body?.allowed).toBe(false);

  const ok2 = await post(`/api/s/${sid}/console`, { cmd: "ss -tulpn" });
  expect(ok2.status).toBe(200);
  expect(ok2.body?.exitCode).toBe(0);
  expect(String(ok2.body?.stdout)).toMatch(/LISTEN|127\.0\.0\.1/);
});
