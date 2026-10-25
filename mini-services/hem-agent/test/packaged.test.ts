// تست regression «چیدمان packaged» — قلب باگ ویندوزی v0.3.1:
//
//   «اجرای HeadscaleEasyManager v0.3.1 روی Windows و بازکردن آدرس Desktop UI
//    به‌جای رابط گرافیکی این JSON را نمایش می‌داد: {"ok":true,"service":"hem-agent",…}»
//
// این تست همان شرایط را «واقعاً» بازسازی می‌کند:
//   ۱) باینری مستقل با bun build --compile ساخته می‌شود (همان روش EXE ویندوزی) —
//      یعنی import.meta.dir واقعاً داخل fs مجازی $bunfs است؛
//   ۲) چیدمان بستهٔ رسمی کنارش چیده می‌شود: ui/ (و installer/) کنار باینری؛
//   ۳) باینری اجرا می‌شود و اثبات می‌شود:
//        • GET /?token= → 303 + Set-Cookie جلسه‌ای (تبادل یک‌بارمصرف)
//        • GET / (با کوکی) → 200 «text/html» با محتوای واقعی UI — نه JSON مبهم
//        • GET /api/health → 200 JSON صحیح (با سروِ UI اشتباه نمی‌شود)
//        • لاگ اجرا: ui: served (…) با مسیر کنار باینری
//
// روی لینوکس مسیر $bunfs پوزیکس است و روی ویندوز C:\$bunfs — سناریوی
// ویندوزیِ تشخیص مسیر جداگانه در test/exepath.test.ts قفل شده است؛ اینجا
// «رفتار واقعی باینری بسته‌بندی‌شده» روی میزبان اجرا اثبات می‌شود.
// portable است (تست‌های CI هم آن را اجرا می‌کنند؛ روی ویندوزِ CI خودِ EXE
// ویندوزی کامپایل و اجرا می‌شود).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const AGENT_DIR = path.join(import.meta.dir, "..");
const OUTER_DIR = path.join(AGENT_DIR, "..", "..");
const TOKEN = "packaged-test-0123456789abcdef0123456789";

/** باینری کامپایل‌شدهٔ این اجرای تست */
let stageDir = "";
let exePath = "";
let homeDir = "";
let child: ChildProcess | null = null;
let stdoutAll = "";
let port = 0;
let baseUrl = "";

const FIXTURE_HTML = `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/><title>Headscale Easy Manager — تست بستهٔ ویندوزی</title></head><body><div id="root">HEM-PACKAGED-UI-MARKER رابط واقعی</div></body></html>`;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

/** چیدمان packaged: ui/ کنار باینری — UI واقعی build اگر موجود باشد، وگرنه fixture */
function stageUi(stage: string): void {
  const ui = path.join(stage, "ui");
  fs.mkdirSync(ui, { recursive: true });
  const realUi = path.join(OUTER_DIR, "out", "index.html"); // خروجی next build ریشه
  if (fs.existsSync(realUi)) {
    fs.cpSync(path.join(OUTER_DIR, "out"), ui, { recursive: true });
  } else {
    fs.writeFileSync(path.join(ui, "index.html"), FIXTURE_HTML);
  }
  // installer/ هم مثل بستهٔ رسمی کنار باینری (قرارداد packaged)
  fs.mkdirSync(path.join(stage, "installer"), { recursive: true });
  fs.writeFileSync(path.join(stage, "installer", "install.sh"), "#!/bin/sh\n# stub packaged layout\n");
}

beforeAll(async () => {
  // ۱) کامپایل واقعی باینری مستقل (همان روش ساخت EXE ویندوزی در build-windows.sh)
  stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "hem-packaged-"));
  const outBase = path.join(stageDir, "hem-manager-test");
  execFileSync(
    process.execPath, // زیر bun test این خودِ bun است
    ["build", "--compile", path.join(AGENT_DIR, "index.ts"), "--outfile", outBase],
    { cwd: AGENT_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  exePath = [outBase, `${outBase}.exe`].find((p) => fs.existsSync(p));
  if (!exePath) throw new Error("باینری کامپایل‌شده ساخته نشد (bun build --compile)");
  if (process.platform !== "win32") fs.chmodSync(exePath, 0o755);

  // ۲) چیدمان بستهٔ رسمی: ui/ و installer/ کنار باینری
  stageUi(stageDir);
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "hem-packaged-home-"));

  // ۳) اجرای واقعی باینری
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(exePath, [], {
    env: {
      ...process.env,
      HEM_AGENT_PORT: String(port),
      HEM_AGENT_TOKEN: TOKEN, // توکن صریح — بدون حالت دسکتاپ (بدون بازشدن مرورگر)
      HEM_AGENT_HOME: homeDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (d: Buffer) => {
    stdoutAll += d.toString();
  });
  child.stderr?.on("data", (d: Buffer) => {
    stdoutAll += d.toString();
  });

  // ۴) منتظر بالا آمدن — v0.3.2: /api/health عمومیِ حداقلی است (200 JSON)؛
  // مسیرهای حساس مثل /api/profiles باید 401 بدهند (زنده + گیت‌دار)
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`باینری بسته‌پذیر مرد (exit=${child.exitCode}). لاگ:\n${stdoutAll}`);
    try {
      const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) {
        const b = (await r.json()) as { ok?: boolean; service?: string };
        if (b.ok === true && b.service === "hem-agent") break;
      }
    } catch {
      /* هنوز بالا نیامده */
    }
    if (Date.now() > deadline) throw new Error(`سرو در ۶۰ ثانیه بالا نیامد. لاگ:\n${stdoutAll}`);
    await new Promise((res) => setTimeout(res, 300));
  }
}, 240_000); // کامپایل باینری زمان‌بر است

afterAll(() => {
  killChild();
});

function killChild(): void {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/F", "/T"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* تلاش شد */
  }
}

async function waitExited(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (child && child.exitCode === null && Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, 150));
  }
  return child?.exitCode !== null;
}

// ---------------------------------------------------------------------------
// اثبات‌ها — EXE بسته‌بندی‌شده + ui/ کنارش
// ---------------------------------------------------------------------------

test("باینری کامپایل‌شده: ui/ کنار خودش را می‌بیند — لاگ «ui: served» با مسیر stage (نه $bunfs)", async () => {
  await new Promise((res) => setTimeout(res, 200));
  expect(stdoutAll).toContain("ui: served");
  expect(stdoutAll).toContain(path.join(stageDir, "ui"));
  expect(stdoutAll).not.toContain("ui: MISSING");
  // رجression باگ: مسیر fs مجازی هرگز به‌عنوان محل ui پذیرفته نمی‌شود
  expect(stdoutAll).not.toContain("$bunfs");
}, 30_000);

test("باینری کامپایل‌شده: GET /?token= → 303 + Set-Cookie جلسه‌ای (بدون Max-Age)", async () => {
  const r = await fetch(`${baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).toBe(303);
  const sc = r.headers.get("set-cookie") ?? "";
  expect(sc).toContain(`hem_token=${TOKEN}`);
  expect(sc).toContain("HttpOnly");
  expect(sc).not.toContain("Max-Age");
  expect(r.headers.get("location")).toBe("/");
}, 30_000);

test("باینری کامپایل‌شده: GET / (با کوکی) → 200 text/html با محتوای واقعی UI — نه JSON سلامت (regression باگ)", async () => {
  const r = await fetch(`${baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  const body = await r.text();
  expect(body).toContain('lang="fa"');
  expect(body).toContain("Headscale Easy Manager");
  // دقیقاً ضدِ باگ گزارش‌شده: JSON مبهم به‌جای UI هرگز برنمی‌گردد
  expect(body).not.toContain('"service":"hem-agent"');
  expect((r.headers.get("cache-control") ?? "").toLowerCase()).toContain("no-store");
}, 30_000);

test("باینری کامپایل‌شده: مسیر SPA ناشناخته هم index.html می‌گیرد (fallback)", async () => {
  const r = await fetch(`${baseUrl}/whatever/spa/route`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  expect(await r.text()).toContain('lang="fa"');
}, 30_000);

test("باینری کامپایل‌شده: GET /api/health همچنان JSON صحیح — مستقل از UI؛ عمومیِ حداقلی بدون توکن، کامل با توکن", async () => {
  // بدون توکن: پاسخ عمومیِ حداقلی (فقط فیلدهای غیرحساس)
  const r0 = await fetch(`${baseUrl}/api/health`);
  expect(r0.status).toBe(200);
  const body0 = (await r0.json()) as Record<string, unknown>;
  expect(body0.ok).toBe(true);
  expect(body0.service).toBe("hem-agent");
  expect(Object.keys(body0).sort()).toEqual(["ok", "service", "version"].sort());
  // با توکن: پاسخ کامل
  const r = await fetch(`${baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  const body = (await r.json()) as { ok: boolean; service: string; version: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
  expect(body.version).toMatch(/^0\.\d+\.\d+(-[\w.]+)?$/);
}, 30_000);

test("باینری کامپایل‌شده: خاتمهٔ تمیز (SIGTERM → خروج صفر)", async () => {
  killChild();
  expect(await waitExited(10_000)).toBe(true);
}, 30_000);
