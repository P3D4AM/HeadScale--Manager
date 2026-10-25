// تست‌های رگرسیون «بسته‌شدن سریع EXE» (v0.3.2-beta.2) — دو ریشه:
//
//   ریشهٔ الف) اجرای «خالی» بستهٔ ویندوزی (دابل‌کلیک، بدون هیچ متغیر) هرگز
//   به حالت دسکتاپ نگاشت نمی‌شد → سیاست fail-closed بدرستی exit≠0 می‌داد
//   → پنجره فوراً بسته می‌شد. اصلاح: قاعدهٔ «بستهٔ ویندوزی» در resolveDesktopMode
//   (src/config.ts): باینری کامپایل‌شده روی win32 «بدون هیچ توکن/صراحت» =
//   دسکتاپ با توکن تولیدیِ همان اجرا.
//
//   ریشهٔ ب) هر شکست راه‌اندازی فقط به کنسولِ لحظه‌ای می‌رفت — شاهدی باقی
//   نمی‌ماند (و اگر پورت اشغال بود، کلاً unhandled می‌مرد). اصلاح: لاگ
//   تشخیصی فایل‌محور (src/startuplog.ts) + هندلر خطای listen (EADDRINUSE)
//   در index.ts.
//
// لایه‌ها:
//   A) سیاست خالص — resolveDesktopMode/resolveAuthPlan بدون I/O (قفل ریشهٔ الف)
//   B) فرایند واقعی (روی میزبانِ لینوکسی — قفل ریشهٔ ب و رفتار fail-closed):
//      اجرای خالی → exit≠0 + پیام + لاگ فایل؛ اشغال پورت → EADDRINUSE + لاگ؛
//      اجرای موفق دسکتاپ → لاگ فایل «بدون توکن».
//   مسیر «قاعدهٔ بستهٔ ویندوزی» (خودِ win32+compiled) فقط روی ویندوز واقعی/
//   CI ویندوزی اجرا می‌شود — اینجا با تست‌های خالصِ لایهٔ A پوشش داده شده
//   و صادقانه در همان تست‌ها یادداشت شده است.

import { afterAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { createStartupLog, readStartupEntries } from "../src/startuplog";
import { Redactor } from "../src/redact";
import { resolveAuthPlan, resolveDesktopMode } from "../src/config";

const AGENT_DIR = import.meta.dir + "/..";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** محیط تمیز برای فرایند: متغیرهای HEM_* والد حذف می‌شوند تا تست‌ها مستقل باشند */
function cleanEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("HEM_")) continue;
    if (typeof v === "string") env[k] = v;
  }
  return { ...env, ...overrides };
}

interface ProcResult {
  exitCode: number | null;
  output: string;
}

function runExpectExit(env: Record<string, string>, expectInOutput: string[], timeoutMs = 20_000): Promise<ProcResult> {
  return new Promise<ProcResult>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts")], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`فرایند در ${timeoutMs}ms خارج نشد. خروجی:\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === null) {
        reject(new Error("فرایند با سیگنال کشته شد"));
        return;
      }
      for (const needle of expectInOutput) {
        if (!output.includes(needle)) {
          reject(new Error(`«${needle}» در خروجی نیست:\n${output}`));
          return;
        }
      }
      resolve({ exitCode: code, output });
    });
  });
}

function killServerChild(c: ChildProcess): void {
  if (c.exitCode !== null) return;
  try {
    c.kill("SIGTERM");
  } catch {
    /* best-effort */
  }
}

// ===========================================================================
// A) سیاست خالص — قاعدهٔ «بستهٔ ویندوزی» (قفل ریشهٔ الف؛ بدون I/O)
//    یادداشت صادقانه: خودِ مسیر win32+compiled فقط روی ویندوز واقعی/CI ویندوزی
//    «اجرا» می‌شود؛ منطقش همین‌جا با ورودی ساختگی قفل شده است.
// ===========================================================================

test("A1 قاعدهٔ بستهٔ ویندوزی: win32 + compiled + بدون توکن/صراحت → دسکتاپ", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: {}, argv: [] }),
  ).toBe(true);
});

test("A2 صراحت کاربر برنده است: همان اجرا + HEM_AGENT_TOKEN → دسکتاپ خودکار خاموش (سرویس)", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_TOKEN: "t" }, argv: [] }),
  ).toBe(false);
});

test("A3 صراحت کاربر برنده است: همان اجرا + HEM_AGENT_AUTH → دسکتاپ خودکار خاموش", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_AUTH: "open" }, argv: [] }),
  ).toBe(false);
});

test("A4 لینوکس: باینری کامپایل‌شده + اجرای خالی → دسکتاپ خودکار نیست (قفل fail-closed می‌ماند)", () => {
  expect(
    resolveDesktopMode({ platform: "linux", compiledBinary: true, env: {}, argv: [] }),
  ).toBe(false);
});

test("A5 اجرای توسعه (bun، نه باینری): win32 + خالی → دسکتاپ خودکار نیست", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: false, env: {}, argv: [] }),
  ).toBe(false);
});

test("A6 صریحِ قدیمی: HEM_DESKTOP=1 روی هر پلتفرم → دسکتاپ", () => {
  expect(resolveDesktopMode({ platform: "linux", compiledBinary: false, env: { HEM_DESKTOP: "1" }, argv: [] })).toBe(true);
});

test("A7 صریحِ قدیمی: --desktop → دسکتاپ", () => {
  expect(resolveDesktopMode({ platform: "linux", compiledBinary: true, env: {}, argv: ["bun", "index.ts", "--desktop"] })).toBe(true);
});

test("A8 مقدارهای خالی/فاصله‌ای توکن یا صراحت حساب نمی‌شوند (قاعدهٔ خودکار می‌گیرد)", () => {
  expect(
    resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_TOKEN: "  ", HEM_AGENT_AUTH: "" }, argv: [] }),
  ).toBe(true);
});

test("A9 ترکیب با سیاست احراز هویت: دسکتاپِ بستهٔ ویندوزی بدون توکن → token تولیدی (نه AUTH_NOT_CONFIGURED)", () => {
  const desktop = resolveDesktopMode({ platform: "win32", compiledBinary: true, env: {}, argv: [] });
  expect(desktop).toBe(true);
  const r = resolveAuthPlan({ auth: undefined, token: undefined, desktop });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.tokenGenerated).toBe(true);
  }
});

test("A10 ترکیب: HEM_AGENT_AUTH=open روی بستهٔ ویندوزی → دسکتاپ خودکار خاموش + حالت open (انتخاب کاربر محترم)", () => {
  const desktop = resolveDesktopMode({ platform: "win32", compiledBinary: true, env: { HEM_AGENT_AUTH: "open" }, argv: [] });
  expect(desktop).toBe(false);
  const r = resolveAuthPlan({ auth: "open", token: undefined, desktop });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.plan.mode).toBe("open");
});

// ===========================================================================
// B) فرایند واقعی — ریشهٔ ب: شکست‌ها شاهدِ فایل‌محور دارند
//    (روی میزبان لینوکسی؛ این تست‌ها سیستمعامل-مستقل‌اند)
// ===========================================================================

test("B1 اجرای خالی: exit≠0 + پیام فارسی + «لاگ فایل» با رکورد fatal (شاهد از بین نمی‌رود)", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b1-"));
  const port = await freePort();
  const r = await runExpectExit(
    cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_HOME: home }),
    ["AUTH_NOT_CONFIGURED", "شروع نمی‌شود", "logs/hem-agent.log"],
  );
  expect(r.exitCode).not.toBe(0);
  expect(r.exitCode).not.toBe(null);
  // لاگ فایل: مسیر مشخص + رکوردهای JSONL با ts/phase/code
  const logPath = path.join(home, "logs", "hem-agent.log");
  expect(fs.existsSync(logPath)).toBe(true);
  const entries = readStartupEntries(logPath);
  expect(entries.length).toBeGreaterThan(0);
  const fatal = entries.find((e) => e.phase === "fatal");
  expect(fatal).toBeDefined();
  expect(fatal?.code).toBe("AUTH_NOT_CONFIGURED");
  expect(typeof fatal?.ts).toBe("string");
  expect(fatal?.ts.length).toBeGreaterThan(10);
  const begin = entries.find((e) => e.phase === "startup" && e.event === "begin");
  expect(begin).toBeDefined();
}, 30_000);

test("B2 پورت اشغال (دو نمونه): نمونهٔ دوم EADDRINUSE + پیام فارسی + لاگ فایل — نه unhandled crash", async () => {
  const port = await freePort();
  const home1 = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b2a-"));
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b2b-"));
  const child1 = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts")], {
    env: cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_TOKEN: "b2-token-0123456789abcdef", HEM_AGENT_HOME: home1 }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out1 = "";
  child1.stdout?.on("data", (d: Buffer) => (out1 += d.toString()));
  child1.stderr?.on("data", (d: Buffer) => (out1 += d.toString()));
  try {
    // نمونهٔ ۱ باید واقعاً listen کند پیش از نمونهٔ ۲
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child1.exitCode !== null) throw new Error(`نمونهٔ ۱ مرد (exit=${child1.exitCode}). خروجی:\n${out1}`);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (r.status === 200) break;
      } catch {
        /* هنوز بالا نیامده */
      }
      if (Date.now() > deadline) throw new Error(`نمونهٔ ۱ در ۳۰ ثانیه بالا نیامد. خروجی:\n${out1}`);
      await new Promise((res) => setTimeout(res, 300));
    }

    // نمونهٔ ۲: همان پورت — باید صادقانه EADDRINUSE بدهد (نه crash بی‌شاهد)
    const r2 = await runExpectExit(
      cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_TOKEN: "b2-token-0123456789abcdef", HEM_AGENT_HOME: home2 }),
      ["EADDRINUSE", "گوش‌دادن", "logs/hem-agent.log"],
    );
    expect(r2.exitCode).not.toBe(0);
    expect(r2.output).toContain("HEM_AGENT_PORT");
    const log2 = path.join(home2, "logs", "hem-agent.log");
    expect(fs.existsSync(log2)).toBe(true);
    const entries2 = readStartupEntries(log2);
    const fatal2 = entries2.find((e) => e.phase === "fatal");
    expect(fatal2?.code).toBe("EADDRINUSE");
    expect(typeof fatal2?.stack === "string" || fatal2?.detail).toBeTruthy();
  } finally {
    killServerChild(child1);
  }
}, 60_000);

test("B3 اجرای موفق دسکتاپ: لاگ فایل نوشته می‌شود ولی «توکن» هرگز در آن نیست", async () => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b3-"));
  const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts"), "--desktop"], {
    env: cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_HOME: home }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  try {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`فرایند مرد (exit=${child.exitCode}). خروجی:\n${output}`);
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
        if (r.status === 200) break;
      } catch {
        /* هنوز بالا نیامده */
      }
      if (Date.now() > deadline) throw new Error(`سرو در ۳۰ ثانیه بالا نیامد. خروجی:\n${output}`);
      await new Promise((res) => setTimeout(res, 300));
    }

    // توکن فقط از خط «desktop UI:» (کنسول) قابل استخراج است
    const m = /desktop UI: http:\/\/127\.0\.0\.1:\d+\/\?token=([0-9a-f]{24,})/.exec(output);
    if (!m) throw new Error(`توکن دسکتاپ در خروجی نیست:\n${output}`);
    const dtok = m[1]!;

    // لاگ فایل: موجود + رخدادهای راه‌اندازی — و «بدون هیچ توکن»
    const logPath = path.join(home, "logs", "hem-agent.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const logText = fs.readFileSync(logPath, "utf8");
    expect(logText).not.toContain(dtok);
    expect(/[0-9a-f]{48}/.test(logText)).toBe(false); // هیچ توکن ۲۴بایتیِ هگز در فایل نیست
    const entries = readStartupEntries(logPath);
    expect(entries.some((e) => e.phase === "startup" && e.event === "begin")).toBe(true);
    expect(entries.some((e) => e.phase === "auth" && e.event === "resolved" && e.code === "token")).toBe(true);
    expect(entries.some((e) => e.phase === "listen" && e.event === "ok")).toBe(true);
  } finally {
    killServerChild(child);
  }
}, 60_000);

test("B4 واحد startuplog: redaction (token=***) و چرخش حجم", () => {
  // از createStartupLog مستقیم — بدون spawn
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-b4-"));
  const redactor = new Redactor();
  const slog = createStartupLog(home, redactor);
  slog.event("startup", "begin", { detail: "x" });
  slog.fatal("TEST_CODE", "خطا با نشانی http://127.0.0.1:1/?token=abcdef0123456789 در پیام", new Error("boom"));
  expect(slog.hasFatal()).toBe(true);
  const entries = readStartupEntries(slog.logPath);
  const fatal = entries.find((e) => e.phase === "fatal" && e.code === "TEST_CODE");
  expect(fatal).toBeDefined();
  expect(fatal?.detail).toContain("token=***"); // مقدار توکن در لاگ ماسک می‌شود
  expect(fatal?.detail).not.toContain("abcdef0123456789");
  expect(typeof fatal?.stack === "string").toBe(true);
  expect(fatal?.stack).toContain("boom");
  // چرخش حجم: از سقف ۲۵۶KB که بگذرد، فایل فعلی به *.log.1 منتقل و فایل تازه شروع می‌شود
  const big = "x".repeat(4096);
  for (let i = 0; i < 80; i++) slog.event("rotation", "fill", { detail: big });
  const size = fs.statSync(slog.logPath).size;
  expect(size).toBeLessThan(256 * 1024 + 64 * 1024); // فایلِ جوان
  expect(fs.existsSync(`${slog.logPath}.1`)).toBe(true); // نسل قبل باقی مانده
});

afterAll(() => {
  /* nothing long-running: children killed in finally blocks */
});
