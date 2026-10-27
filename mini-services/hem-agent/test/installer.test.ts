// Install-flow tests (spec §8) — prepare/validate/execute/state against a real SSH test server.
// The real Python repo (from the v0.3.1 §1 resolution chain: HEM_PROJECT_ROOT → installer/
// next to the executable → dev checkout) is uploaded and a real install.sh dry-run runs —
// no fake output involved. A real install on the test server (no sudo) must honestly
// fail with SUDO_REQUIRED; that IS the "correct behavior".
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { io, type Socket } from "socket.io-client";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import {
  buildTestStack,
  connectAndConfirm,
  ensureHeadscaleHealthy,
  listenStackIo,
  type TestStack,
} from "./helpers";
import { PLAN_INPUTS, installJobSummary, renderAnswersConf, validateSettings } from "../src/installer";
import { detectFinalState, parseStepLine } from "../src/jobstream";
import {
  installerRootCandidates,
  installerRootErrorMessage,
  installerRootStatus,
  projectRoot,
  resolveInstallerRoot,
} from "../src/config";

// v0.3.1 §1: no developer default — it comes from the resolution chain (env → packaged → dev).
const PROJECT_ROOT = projectRoot();
const hsPrefix = "/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml";

let ts: TestServerHandle;
let stack: TestStack;
let srv: { baseUrl: string; close: () => Promise<void> };
let sid: string;

const VALID_SETTINGS = {
  domain: "headscale.example.com",
  acme_email: "",
  headscale_version: "0.29.5",
  first_user: "admin",
  magic_dns_base: "ts.example.com",
  dns_nameservers: ["1.1.1.1", "8.8.8.8"],
  caddy_mode: "install" as const,
  embedded_derp: true,
  firewall: true,
  ssh_port: "",
  cameras: [],
};

beforeAll(async () => {
  ensureHeadscaleHealthy();
  // noShim: the target server is "clean" (headscale not on PATH) — the 17-step fresh-install flow
  ts = await startTestServer({ port: 0, noShim: true });
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
  // real cleanup of the temp directories on the "server" (the same machine in the test environment)
  try {
    await stack.manager.exec(sid, "rm -rf /tmp/hem-install-*");
  } catch {
    /* the session may already be closed */
  }
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
const get = async (path: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${srv.baseUrl}/api/s/${sid}${path}`);
  return { status: res.status, body: await res.json() };
};

// ---------------------------------------------------------------------------
// Schema sync with the single source (examples/hem-install.conf.example)
// ---------------------------------------------------------------------------
test("the install-inputs schema is exactly in sync with the Canonical example file's keys", () => {
  const example = readFileSync(`${PROJECT_ROOT}/examples/hem-install.conf.example`, "utf8");
  const exampleKeys = new Set(
    example
      .split("\n")
      .map((l) => /^([a-z_]+):/.exec(l)?.[1])
      .filter((k): k is string => Boolean(k)),
  );
  const schemaKeys = new Set(PLAN_INPUTS.map((f) => f.key));
  expect([...schemaKeys].sort()).toEqual([...exampleKeys].sort());
  // a few critical keys with enum/label
  const caddy = PLAN_INPUTS.find((f) => f.key === "caddy_mode")!;
  expect(caddy.enum).toEqual(["install", "reuse", "skip"]);
  expect(PLAN_INPUTS.find((f) => f.key === "domain")!.required).toBe(true);
});

test("validateSettings: invalid caddy_mode → Persian error listing the allowed values", () => {
  const errors = validateSettings({ ...VALID_SETTINGS, caddy_mode: "install_new" as never });
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.join(" ")).toContain("install/reuse/skip");
});

test("validateSettings: valid settings produce no errors", () => {
  expect(validateSettings(VALID_SETTINGS)).toEqual([]);
});

test("renderAnswersConf: the key format exactly matches the Canonical example file", () => {
  const conf = renderAnswersConf(VALID_SETTINGS);
  expect(conf).toContain("non_interactive: true");
  expect(conf).toContain("install_dir: /opt/headscale-easy-manager");
  expect(conf).toContain("domain: headscale.example.com");
  expect(conf).toContain('headscale_version: "0.29.5"');
  expect(conf).toContain("caddy_mode: install");
  expect(conf).toContain("embedded_derp: true");
  expect(conf).toContain("firewall: true");
  expect(conf).toContain('ssh_port: ""');
  expect(conf).toContain("cameras: []");
  expect(conf).toContain("  - 1.1.1.1");
});

test("parseStepLine: real StepRunner output lines (start/ok/failed)", () => {
  const running = parseStepLine("[~] گام 1/17 — خوش‌آمد و معرفی");
  expect(running).toMatchObject({ stage: 1, total: 17, status: "running", risk: "safe" });
  const ok = parseStepLine("[✓] گام 4/17 — بررسی منابع شبکه (IP عمومی و CGNAT) — IP عمومی: 8.212.10.159");
  expect(ok).toMatchObject({ stage: 4, total: 17, status: "ok" });
  expect(ok!.detail).toContain("IP عمومی");
  const failed = parseStepLine("[✗] گام 8/17 — نمایش برنامه تغییرات و تأیید — در حالت غیرتعاملی، اجرای برنامهٔ تغییرات نیازمند --yes صریح است");
  expect(failed).toMatchObject({ stage: 8, status: "failed" });
  expect(parseStepLine("جمع‌بندی: 17 گام موفق")).toBeNull();
  // a risky step
  const risky = parseStepLine("[~] گام 13/17 — تنظیم فایروال (اول SSH)");
  expect(risky!.risk).toBe("risky");
});

test("detectFinalState: the contractual 5-b labels", () => {
  expect(detectFinalState("✅ نصب انجام شد و صحت آن تأیید شد.")).toBe("verified");
  expect(detectFinalState("✅ نصب کاملاً موفق است.")).toBe("full_success");
  expect(detectFinalState("⚠ DNS یا گواهی TLS هنوز آماده نیست.")).toBe("pending_verification");
  expect(detectFinalState("⚠ نصب انجام شد اما سرویس آماده نیست.")).toBe("service_not_ready");
  expect(detectFinalState("✗ بخشی از عملیات شکست خورده است.")).toBe("partial_failure");
  expect(detectFinalState("✓ [dry-run] شبیه‌سازی کامل نصب تا انتها انجام شد — حالت آزمایشی (dry-run)")).toBe("dry_run_complete");
  expect(detectFinalState("✓ ارتقا به headscale 0.30.0 کامل شد.")).toBe("updated");
  expect(detectFinalState("بازگشت به نسخهٔ قبلی (0.29.5) کامل شد و سرویس سالم است.")).toBe("rolled_back");
  expect(detectFinalState("✗ بازگشت به نسخهٔ قبلی هم ناموفق بود!")).toBe("rollback_failed");
  expect(detectFinalState("چیزی مطابقت ندارد")).toBeNull();
});

// Task 26 — exit 4 must not be flattened to "install incomplete": the summary
// describes what the REAL hsctl exit code means (finalState comes verbatim from
// detectFinalState over the real installer output).
test("installJobSummary: exit 4 + pending_verification is a completed install, not an incomplete one", () => {
  const s = installJobSummary(4, "pending_verification");
  expect(s).toContain("نصب انجام شد");
  expect(s).toContain("همهٔ گام‌های نصب موفق بودند");
  expect(s).toContain("کد خروج ۴");
  expect(s).toContain("تأیید بیرونی");
  expect(s).toContain("hsctl doctor");
  // the misleading old text is exactly what the user reported — it must be gone
  expect(s).not.toContain("نصب ناتمام ماند");
});

test("installJobSummary: exit 4 + service_not_ready names the service problem and the fix command", () => {
  const s = installJobSummary(4, "service_not_ready");
  expect(s).toContain("سرویس در پایان نصب آماده نبود");
  expect(s).toContain("کد خروج ۴");
  expect(s).toContain("systemctl status headscale");
  expect(s).toContain("hsctl doctor");
  expect(s).not.toContain("نصب ناتمام ماند");
});

test("installJobSummary: real failures keep the honest incomplete text with the failing step", () => {
  const s = installJobSummary(1, "partial_failure", "فعال‌سازی سرویس");
  expect(s).toContain("نصب ناتمام ماند (کد خروج 1)");
  expect(s).toContain("آخرین گام مشکل‌دار: فعال‌سازی سرویس");
  expect(s).toContain("hsctl doctor");
  // without a parsed step it still tells the exit code honestly
  expect(installJobSummary(2, undefined)).toContain("نصب ناتمام ماند (کد خروج 2)");
});

test("installJobSummary: exit 0 keeps the success text with the final state", () => {
  const s = installJobSummary(0, "full_success");
  expect(s).toContain("نصب با کد خروج ۰ تمام شد");
  expect(s).toContain("full_success");
  expect(s).not.toContain("نصب ناتمام ماند");
});

// ---------------------------------------------------------------------------
// prepare — real repo upload
// ---------------------------------------------------------------------------
let preparedDir = "";

test(
  "prepare: the real repo tarball is built/uploaded/extracted",
  async () => {
    const { status, body } = await post("/install/prepare", {});
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.remoteDir).toMatch(/^\/tmp\/hem-install-\d+$/);
    expect(body.sizeBytes).toBeGreaterThan(100_000); // the real repo is ~200KB
    expect(Array.isArray(body.planInputsSchema)).toBe(true);
    expect(body.planInputsSchema.length).toBe(13);
    preparedDir = body.remoteDir;

    // the extraction really happened: install.sh, hsctl and src exist
    const check = await stack.manager.exec(sid, `test -f ${preparedDir}/install.sh && test -f ${preparedDir}/hsctl && test -d ${preparedDir}/src/hem`);
    expect(check.code).toBe(0);
    const tarball = await stack.manager.exec(sid, `test -s ${preparedDir}/repo.tar.gz`);
    expect(tarball.code).toBe(0);
  },
  60_000,
);

// ---------------------------------------------------------------------------
// validate — a real dry-run
// ---------------------------------------------------------------------------
test(
  "validate: valid settings → a real dry-run with exitCode 0 and ≥10 parsed steps",
  async () => {
    const { status, body } = await post("/install/validate", { settings: VALID_SETTINGS, remoteDir: preparedDir });
    expect(status).toBe(200);
    expect(body.exitCode).toBe(0);
    expect(body.ok).toBe(true);
    expect(body.plan.length).toBeGreaterThanOrEqual(10);
    expect(body.plan[0].stage).toBe(1);
    expect(body.finalState).toBe("dry_run_complete");
    // real installer output (not synthetic): real planning markers
    expect(body.output).toContain("گام 1/17");
    expect(body.output).toContain("هیچ تغییری واقعاً اعمال نمی‌شود");
  },
  240_000,
);

test("validate: no remoteDir → 400 with guidance", async () => {
  const { status, body } = await post("/install/validate", { settings: VALID_SETTINGS });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
  expect(body.message).toContain("prepare");
});

test("validate: invalid caddy_mode → 400 with a Persian error (no remote execution)", async () => {
  const { status, body } = await post("/install/validate", {
    settings: { ...VALID_SETTINGS, caddy_mode: "install_new" as never },
    remoteDir: preparedDir,
  });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
  expect(body.message).toContain("install/reuse/skip");
});

// ---------------------------------------------------------------------------
// execute — an honest job
// ---------------------------------------------------------------------------
test("execute without confirm → NEED_CONFIRM", async () => {
  const { status, body } = await post("/install/execute", { settings: VALID_SETTINGS, remoteDir: preparedDir });
  expect(status).toBe(400);
  expect(body.error).toBe("NEED_CONFIRM");
});

test(
  "execute on a server without sudo → honest SUDO_REQUIRED failure with job events (socket.io + REST fallback)",
  async () => {
    // the socket.io client connects "before" execution; it joins the job room after getting jobId —
    // natural window: the automatic prepare (~1s upload) runs before the first install events.
    const client: Socket = io(srv.baseUrl, { transports: ["websocket"] });
    await new Promise<void>((res) => (client.connected ? res() : client.once("connect", () => res())));

    const { status, body } = await post("/install/execute", { settings: VALID_SETTINGS, confirm: true });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.jobId).toBe("string");
    const jobId = body.jobId as string;
    client.emit("subscribe", `job:${jobId}`);

    const done = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("job:done did not arrive within 90s")), 90_000);
      client.on("job:done", (payload: any) => {
        if (payload?.jobId === jobId) {
          clearTimeout(timer);
          resolve(payload);
        }
      });
      client.on("job:error", (payload: any) => {
        if (payload?.jobId === jobId) {
          clearTimeout(timer);
          reject(new Error(`job:error: ${payload.error}`));
        }
      });
    });
    client.disconnect();

    // the test server has no sudo → the real install must honestly fail with SUDO_REQUIRED (claiming success is forbidden)
    expect(done.ok).toBe(false);
    expect(String(done.summary)).toContain("SUDO_REQUIRED");

    // REST fallback (late connection): every buffered line even after the job has ended
    const logPage = (await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}/log?since=0`)).json()) as any;
    expect(logPage.ok).toBe(true);
    expect(logPage.logs.length).toBeGreaterThanOrEqual(3);
    const joined = logPage.logs.map((l: any) => l.line).join("\n");
    expect(joined).toContain("prepare"); // the automatic repo upload happened
    expect(joined).toContain("sudo"); // the honest SUDO_REQUIRED message

    // the job status after completion
    const jobStatus = (await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}`)).json()) as any;
    expect(jobStatus.ok).toBe(true);
    expect(jobStatus.job.status).toBe("done");
    expect(jobStatus.job.ok).toBe(false);
    expect(jobStatus.job.type).toBe("install-execute");
  },
  120_000,
);

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
test("state: no install → honest exists:false", async () => {
  expect(existsSync("/etc/hem/state.json")).toBe(false); // test-environment precondition
  const { status, body } = await get("/install/state");
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.exists).toBe(false);
});

// ---------------------------------------------------------------------------
// v0.3.1 §1 — installer-root resolution chain (pure; independent of the sandbox checkout)
// ---------------------------------------------------------------------------
const FORBIDDEN_DEV_DEFAULT = "/home/z/my-project/headscale-easy-manager";

/** Temp folder with an install.sh — a "valid" env candidate */
function mkValidRoot(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "hem-valid-root-"));
  writeFileSync(path.join(d, "install.sh"), "#!/bin/bash\n# نشان تست\n");
  return d;
}

/** Fake exe folder with installer/ next to it — a valid packaged candidate */
function mkValidExeDir(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), "hem-valid-exe-"));
  mkdirSync(path.join(d, "installer"), { recursive: true });
  writeFileSync(path.join(d, "installer", "install.sh"), "#!/bin/bash\n# نشان تست\n");
  return d;
}

/** Fake checkout: <base>/a/b/src + the repo at <base>/headscale-easy-manager */
function mkValidSrcDir(): { src: string; repo: string } {
  const base = mkdtempSync(path.join(os.tmpdir(), "hem-valid-src-"));
  const src = path.join(base, "a", "b", "src");
  mkdirSync(src, { recursive: true });
  const repo = path.join(base, "headscale-easy-manager");
  mkdirSync(repo);
  writeFileSync(path.join(repo, "install.sh"), "#!/bin/bash\n# نشان تست\n");
  return { src, repo };
}

test("§1: with clean inputs, no candidate is the forbidden dev-default path", () => {
  const created: string[] = [];
  try {
    const exe = mkdtempSync(path.join(os.tmpdir(), "hem-clean-exe-"));
    created.push(exe);
    const base = mkdtempSync(path.join(os.tmpdir(), "hem-clean-src-"));
    created.push(base);
    const src = path.join(base, "a", "b", "src");
    mkdirSync(src, { recursive: true });

    const cands = installerRootCandidates(undefined, exe, src);
    expect(cands.map((c) => c.source)).toEqual(["packaged", "dev"]);
    for (const c of cands) {
      // if someone brings back the hardcoded default, this goes red here:
      expect(c.path).not.toBe(FORBIDDEN_DEV_DEFAULT);
      expect(c.path.startsWith("/home/z/")).toBe(false);
    }
    // empty/whitespace-only env creates no env candidate
    expect(installerRootCandidates("", exe, src).some((c) => c.source === "env")).toBe(false);
    expect(installerRootCandidates("   ", exe, src).some((c) => c.source === "env")).toBe(false);
  } finally {
    for (const d of created) rmSync(d, { recursive: true, force: true });
  }
});

test("§1: chain priority — env > packaged > dev; the first candidate with an install.sh wins", () => {
  const created: string[] = [];
  try {
    const env = mkValidRoot();
    created.push(env);
    const exe = mkValidExeDir();
    created.push(exe);
    const { src, repo } = mkValidSrcDir();
    created.push(repo);

    // all three valid → env (explicit) wins
    expect(resolveInstallerRoot(installerRootCandidates(env, exe, src))).toMatchObject({
      ok: true,
      source: "env",
      path: path.resolve(env),
    });
    // without env → packaged (next to the executable)
    expect(resolveInstallerRoot(installerRootCandidates(undefined, exe, src))).toMatchObject({
      ok: true,
      source: "packaged",
      path: path.join(exe, "installer"),
    });
    // invalid env (no install.sh) → honestly recorded in tried and skipped to packaged
    const envBad = mkdtempSync(path.join(os.tmpdir(), "hem-bad-env-"));
    created.push(envBad);
    const st = resolveInstallerRoot(installerRootCandidates(envBad, exe, src));
    expect(st.source).toBe("packaged");
    expect(st.tried[0]).toMatchObject({ source: "env", exists: false });
    // only dev valid → dev wins
    const exeBad = mkdtempSync(path.join(os.tmpdir(), "hem-bad-exe-"));
    created.push(exeBad);
    expect(resolveInstallerRoot(installerRootCandidates(undefined, exeBad, src)).source).toBe("dev");
  } finally {
    for (const d of created) rmSync(d, { recursive: true, force: true });
  }
});

test("§1: no valid candidate → source:none and projectRoot is the \"packaged expectation\"", () => {
  const created: string[] = [];
  try {
    const envBad = mkdtempSync(path.join(os.tmpdir(), "hem-none-env-"));
    created.push(envBad);
    const exeDir = mkdtempSync(path.join(os.tmpdir(), "hem-none-exe-"));
    created.push(exeDir);
    const srcBase = mkdtempSync(path.join(os.tmpdir(), "hem-none-src-"));
    created.push(srcBase);
    const src = path.join(srcBase, "a", "b", "src");
    mkdirSync(src, { recursive: true });

    const st = resolveInstallerRoot(installerRootCandidates(envBad, exeDir, src));
    expect(st.ok).toBe(false);
    expect(st.source).toBe("none");
    expect(st.tried.map((t) => t.source)).toEqual(["env", "packaged", "dev"]);
    expect(st.tried.every((t) => t.exists === false)).toBe(true);
    expect(st.tried.map((t) => t.path)).toEqual([
      path.resolve(envBad),
      path.join(exeDir, "installer"),
      path.resolve(src, "..", "..", "..", "headscale-easy-manager"),
    ]);
    // the "packaged expectation" — the caller gets a clear error with this very path
    expect(st.path).toBe(path.join(exeDir, "installer"));
  } finally {
    for (const d of created) rmSync(d, { recursive: true, force: true });
  }
});

test("§1: in a compiled binary (/$bunfs) there is no dev candidate and the message says why", () => {
  const cands = installerRootCandidates(undefined, "/opt/fake-exe", "/$bunfs/root/mini-services/hem-agent/src");
  expect(cands.map((c) => c.source)).toEqual(["packaged"]);
  expect(cands[0].path).toBe("/opt/fake-exe/installer");

  const msg = installerRootErrorMessage(
    resolveInstallerRoot(cands, [{ source: "dev", reason: "دلیل تست: باینری کامپایل‌شده" }]),
  );
  expect(msg).toContain("تنظیم نشده"); // env not set
  expect(msg).toContain("دلیل تست: باینری کامپایل‌شده"); // the reason dev was rejected
  expect(msg).toContain("/opt/fake-exe/installer");
});

test("§1: the \"repo not found\" message lists every path with its result and offers a solution", () => {
  const created: string[] = [];
  try {
    const envBad = mkdtempSync(path.join(os.tmpdir(), "hem-msg-env-"));
    created.push(envBad);
    const exeDir = mkdtempSync(path.join(os.tmpdir(), "hem-msg-exe-"));
    created.push(exeDir);
    const srcBase = mkdtempSync(path.join(os.tmpdir(), "hem-msg-src-"));
    created.push(srcBase);
    const src = path.join(srcBase, "a", "b", "src");
    mkdirSync(src, { recursive: true });

    const st = resolveInstallerRoot(installerRootCandidates(envBad, exeDir, src));
    const msg = installerRootErrorMessage(st);
    expect(msg).toContain("ویزارد نصب متوقف می‌شود");
    expect(msg).toContain("هرگز «آماده» اعلام نمی‌شود");
    expect(msg).toContain("HEM_PROJECT_ROOT");
    expect(msg).toContain(path.resolve(envBad));
    expect(msg).toContain(path.join(exeDir, "installer"));
    expect(msg).toContain("install.sh نیست");
    expect(msg).toContain("build-windows.sh");
    expect(msg).toContain("مسیر مورد انتظار بسته");
  } finally {
    for (const d of created) rmSync(d, { recursive: true, force: true });
  }
});

test("§1 (existing checkout): the real chain finds the repo in this very run and projectRoot is valid", () => {
  const st = installerRootStatus();
  expect(st.ok).toBe(true);
  expect(st.source).not.toBe("none");
  expect(existsSync(path.join(st.path, "install.sh"))).toBe(true);
  expect(projectRoot()).toBe(st.path);
});
