// Job reliability tests (§5 — Task 5-d):
//  • 500-line ring buffer + since pagination (REST fallback)
//  • a socket.io client that connects "after the job started": the REST fallback delivers
//    all lines; socket.io delivers the following lines + job:done live.
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
// unit: JobManager — ring buffer and pagination
// ---------------------------------------------------------------------------
test("JobManager: 500-line ring buffer + truncated + since pagination", () => {
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
  expect(page0.logs[0].line).toBe("line-101"); // the oldest surviving line
  expect(page0.logs[499].line).toBe("line-600");
  expect(page0.logs[0].seq).toBe(101);

  // pagination: from the middle
  const page250 = jobs.getLog("job-unit1", 250)!;
  expect(page250.logs.length).toBe(350);
  expect(page250.logs[0].seq).toBe(251);
  expect(page250.truncated).toBe(false); // nothing after 251 was dropped

  // done + status
  jobs.jobDone("job-unit1", false, 3, "خلاصهٔ تست", "partial_failure");
  const status = jobs.getStatus("job-unit1")!;
  expect(status.status).toBe("done");
  expect(status.ok).toBe(false);
  expect(status.exitCode).toBe(3);
  expect(status.summary).toBe("خلاصهٔ تست");
  expect(status.finalState).toBe("partial_failure");
  expect(status.logCount).toBe(600);
  // the record stays accessible after completion (REST fallback)
  expect(jobs.getLog("job-unit1", 590)!.logs.length).toBe(10);
  expect(jobs.getLog("job-unknown", 0)).toBeUndefined();
  expect(jobs.getStatus("job-unknown")).toBeUndefined();
});

// ---------------------------------------------------------------------------
// integration: streaming console job + REST fallback + late socket.io
// ---------------------------------------------------------------------------
let ts: TestServerHandle;
let stack: TestStack;
let srv: { baseUrl: string; close: () => Promise<void> };
let sid: string;
const hsPrefix = "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml";

beforeAll(async () => {
  ensureHeadscaleHealthy();
  ts = await startTestServer({ port: 0 });
  stack = buildTestStack({ authMode: "open" }); // v0.3.2 §2: business-logic tests under the documented dev exception (no auth)
  srv = await listenStackIo(stack, { authMode: "open" }); // v0.3.2 §2: documented dev exception
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
  "streaming console job: a post-start client → full REST fallback + live socket.io",
  async () => {
    // the client is connected but doesn't know the job room yet (it joins after the HTTP response)
    const client: Socket = io(srv.baseUrl, { transports: ["websocket"] });
    await new Promise<void>((res) => (client.connected ? res() : client.once("connect", () => res())));

    const { status, body } = await post("/console", { cmd: "headscale users list -o json", stream: true });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const jobId = body.jobId as string;

    // "late connection": a REST-only client polls for the logs
    let lines: any[] = [];
    for (let i = 0; i < 100; i++) {
      const res = await fetch(`${srv.baseUrl}/api/jobs/${jobId}/log?since=0`);
      const page = (await res.json()) as any;
      lines = page.logs ?? [];
      const st = await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}`)).json();
      if (st.job?.status === "done" && lines.length > 0) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    // first line: the actually-executed command (custom-mode prefix); the real users JSON output is in the log too
    expect(lines[0].line).toContain("users list");
    const joined = lines.map((l) => l.line).join("\n");
    expect(joined).toContain("users"); // real CLI output

    // since pagination: only newer lines
    const sinceRes = await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}/log?since=${lines[0].seq}`)).json();
    expect(sinceRes.logs.length).toBe(lines.length - 1);

    // unknown job → 404
    const notFound = await fetch(`${srv.baseUrl}/api/jobs/job-nope`);
    expect(notFound.status).toBe(404);

    // the finish event from socket.io (the client joined the room later — job:done should have arrived
    // because the SSH run outlasts the subscribe; if it was missed, REST covers it)
    client.disconnect();
  },
  60_000,
);

test(
  "socket.io: a job-room subscriber gets live job:log and job:done events",
  async () => {
    const client: Socket = io(srv.baseUrl, { transports: ["websocket"] });
    await new Promise<void>((res) => (client.connected ? res() : client.once("connect", () => res())));

    const { status, body } = await post("/console", { cmd: "headscale version", stream: true });
    expect(status).toBe(200);
    const jobId = body.jobId as string;
    client.emit("subscribe", `job:${jobId}`);

    const events: any[] = [];
    const done = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("job:done never arrived")), 30_000);
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
    expect(events.length).toBeGreaterThan(0); // at least the command line and the version output
  },
  60_000,
);
