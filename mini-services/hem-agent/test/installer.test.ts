// تست جریان نصب (قرارداد §8) — prepare/validate/execute/state روی سرور SSH آزمایشی واقعی.
// مخزن پایتون واقعی (HEM_PROJECT_ROOT) بارگذاری می‌شود و dry-run واقعی install.sh اجرا
// می‌شود — هیچ خروجی جعلی در کار نیست. اجرای واقعی نصب روی سرور تست (بدون sudo)
// باید صادقانه با SUDO_REQUIRED شکست بخورد؛ این «رفتار درست» است.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";
import { startTestServer, TEST_HOST, TEST_PASSWORD, type TestServerHandle } from "./server";
import {
  buildTestStack,
  connectAndConfirm,
  ensureHeadscaleHealthy,
  listenStackIo,
  type TestStack,
} from "./helpers";
import { PLAN_INPUTS, renderAnswersConf, validateSettings } from "../src/installer";
import { detectFinalState, parseStepLine } from "../src/jobstream";

const PROJECT_ROOT = process.env.HEM_PROJECT_ROOT || "/home/z/my-project/headscale-easy-manager";
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
  // noShim: سرور هدف «تمیز» است (headscale روی PATH نیست) — جریان نصب تازهٔ ۱۷ گامی
  ts = await startTestServer({ port: 0, noShim: true });
  stack = buildTestStack();
  srv = await listenStackIo(stack);
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
  // پاک‌سازی واقعی دایرکتوری‌های موقت روی «سرور» ( همان ماشین در محیط تست)
  try {
    await stack.manager.exec(sid, "rm -rf /tmp/hem-install-*");
  } catch {
    /* نشست شاید بسته باشد */
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
// هم‌گامی اسکیما با منبع واحد (examples/hem-install.conf.example)
// ---------------------------------------------------------------------------
test("اسکیمای ورودی‌های نصب دقیقاً با کلیدهای فایل نمونهٔ Canonical هم‌گام است", () => {
  const example = readFileSync(`${PROJECT_ROOT}/examples/hem-install.conf.example`, "utf8");
  const exampleKeys = new Set(
    example
      .split("\n")
      .map((l) => /^([a-z_]+):/.exec(l)?.[1])
      .filter((k): k is string => Boolean(k)),
  );
  const schemaKeys = new Set(PLAN_INPUTS.map((f) => f.key));
  expect([...schemaKeys].sort()).toEqual([...exampleKeys].sort());
  // چند کلید حیاتی با enum/برچسب
  const caddy = PLAN_INPUTS.find((f) => f.key === "caddy_mode")!;
  expect(caddy.enum).toEqual(["install", "reuse", "skip"]);
  expect(PLAN_INPUTS.find((f) => f.key === "domain")!.required).toBe(true);
});

test("validateSettings: caddy_mode نامعتبر → خطای فارسی با مقادیر مجاز", () => {
  const errors = validateSettings({ ...VALID_SETTINGS, caddy_mode: "install_new" as never });
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.join(" ")).toContain("install/reuse/skip");
});

test("validateSettings: تنظیمات معتبر بدون خطا", () => {
  expect(validateSettings(VALID_SETTINGS)).toEqual([]);
});

test("renderAnswersConf: قالب کلیدها عیناً مطابق فایل نمونهٔ Canonical", () => {
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

test("parseStepLine: خطوط واقعی خروجی StepRunner (شروع/موفق/شکست)", () => {
  const running = parseStepLine("[~] گام 1/17 — خوش‌آمد و معرفی");
  expect(running).toMatchObject({ stage: 1, total: 17, status: "running", risk: "safe" });
  const ok = parseStepLine("[✓] گام 4/17 — بررسی منابع شبکه (IP عمومی و CGNAT) — IP عمومی: 8.212.10.159");
  expect(ok).toMatchObject({ stage: 4, total: 17, status: "ok" });
  expect(ok!.detail).toContain("IP عمومی");
  const failed = parseStepLine("[✗] گام 8/17 — نمایش برنامه تغییرات و تأیید — در حالت غیرتعاملی، اجرای برنامهٔ تغییرات نیازمند --yes صریح است");
  expect(failed).toMatchObject({ stage: 8, status: "failed" });
  expect(parseStepLine("جمع‌بندی: 17 گام موفق")).toBeNull();
  // گام پرخطر
  const risky = parseStepLine("[~] گام 13/17 — تنظیم فایروال (اول SSH)");
  expect(risky!.risk).toBe("risky");
});

test("detectFinalState: برچسب‌های قراردادی 5-b", () => {
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

// ---------------------------------------------------------------------------
// prepare — بارگذاری واقعی مخزن
// ---------------------------------------------------------------------------
let preparedDir = "";

test(
  "prepare: تاربال مخزن واقعی ساخته/بارگذاری/استخراج می‌شود",
  async () => {
    const { status, body } = await post("/install/prepare", {});
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.remoteDir).toMatch(/^\/tmp\/hem-install-\d+$/);
    expect(body.sizeBytes).toBeGreaterThan(100_000); // مخزن واقعی ~۲۰۰KB
    expect(Array.isArray(body.planInputsSchema)).toBe(true);
    expect(body.planInputsSchema.length).toBe(13);
    preparedDir = body.remoteDir;

    // استخراج واقعاً انجام شده: install.sh و hsctl و src موجودند
    const check = await stack.manager.exec(sid, `test -f ${preparedDir}/install.sh && test -f ${preparedDir}/hsctl && test -d ${preparedDir}/src/hem`);
    expect(check.code).toBe(0);
    const tarball = await stack.manager.exec(sid, `test -s ${preparedDir}/repo.tar.gz`);
    expect(tarball.code).toBe(0);
  },
  60_000,
);

// ---------------------------------------------------------------------------
// validate — dry-run واقعی
// ---------------------------------------------------------------------------
test(
  "validate: تنظیمات معتبر → dry-run واقعی با exitCode 0 و ≥۱۰ گام تجزیه‌شده",
  async () => {
    const { status, body } = await post("/install/validate", { settings: VALID_SETTINGS, remoteDir: preparedDir });
    expect(status).toBe(200);
    expect(body.exitCode).toBe(0);
    expect(body.ok).toBe(true);
    expect(body.plan.length).toBeGreaterThanOrEqual(10);
    expect(body.plan[0].stage).toBe(1);
    expect(body.finalState).toBe("dry_run_complete");
    // خروجی واقعی نصب‌کننده (نه ساختگی): نشانگرهای واقعی برنامه‌ریزی
    expect(body.output).toContain("گام 1/17");
    expect(body.output).toContain("هیچ تغییری واقعاً اعمال نمی‌شود");
  },
  240_000,
);

test("validate: بدون remoteDir → 400 راهنما", async () => {
  const { status, body } = await post("/install/validate", { settings: VALID_SETTINGS });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
  expect(body.message).toContain("prepare");
});

test("validate: caddy_mode نامعتبر → 400 با خطای فارسی (بدون اجرای ریموت)", async () => {
  const { status, body } = await post("/install/validate", {
    settings: { ...VALID_SETTINGS, caddy_mode: "install_new" as never },
    remoteDir: preparedDir,
  });
  expect(status).toBe(400);
  expect(body.error).toBe("VALIDATION_FAILED");
  expect(body.message).toContain("install/reuse/skip");
});

// ---------------------------------------------------------------------------
// execute — job صادقانه
// ---------------------------------------------------------------------------
test("execute بدون confirm → NEED_CONFIRM", async () => {
  const { status, body } = await post("/install/execute", { settings: VALID_SETTINGS, remoteDir: preparedDir });
  expect(status).toBe(400);
  expect(body.error).toBe("NEED_CONFIRM");
});

test(
  "execute روی سرور بدون sudo → شکست صادقانهٔ SUDO_REQUIRED با رویدادهای job (socket.io + REST fallback)",
  async () => {
    // کلاینت socket.io «قبل» از اجرا وصل است؛ اتاق job را بعد از گرفتن jobId جدا می‌کند —
    // پنجرهٔ طبیعی: prepare خودکار (~۱ثانیه آپلود) قبل از اولین رویدادهای نصب.
    const client: Socket = io(srv.baseUrl, { transports: ["websocket"] });
    await new Promise<void>((res) => (client.connected ? res() : client.once("connect", () => res())));

    const { status, body } = await post("/install/execute", { settings: VALID_SETTINGS, confirm: true });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.jobId).toBe("string");
    const jobId = body.jobId as string;
    client.emit("subscribe", `job:${jobId}`);

    const done = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("job:done در ۹۰ ثانیه نرسید")), 90_000);
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

    // سرور تست sudo ندارد → نصب واقعی باید صادقانه SUDO_REQUIRED شکست بخورد (ادعای موفقیت ممنوع)
    expect(done.ok).toBe(false);
    expect(String(done.summary)).toContain("SUDO_REQUIRED");

    // REST fallback (اتصال دیرهنگام): همهٔ خطوط بافرشده حتی پس از پایان job
    const logPage = (await (await fetch(`${srv.baseUrl}/api/jobs/${jobId}/log?since=0`)).json()) as any;
    expect(logPage.ok).toBe(true);
    expect(logPage.logs.length).toBeGreaterThanOrEqual(3);
    const joined = logPage.logs.map((l: any) => l.line).join("\n");
    expect(joined).toContain("prepare"); // بارگذاری خودکار مخزن اتفاق افتاد
    expect(joined).toContain("sudo"); // پیام صادقانهٔ SUDO_REQUIRED

    // وضعیت job پس از پایان
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
test("state: بدون نصب → exists:false صادقانه", async () => {
  expect(existsSync("/etc/hem/state.json")).toBe(false); // پیش‌شرط محیط تست
  const { status, body } = await get("/install/state");
  expect(status).toBe(200);
  expect(body.ok).toBe(true);
  expect(body.exists).toBe(false);
});
