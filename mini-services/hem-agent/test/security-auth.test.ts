// تست‌های امنیتی واقعی (v0.3.2 §2) — مستقل از پیاده‌سازی؛ «رفتار امنیتی مورد
// انتظار» را قفل می‌کنند. اگر این تست‌ها به دلیل نقص طراحی شکست بخورند، کد
// اصلاح می‌شود — هرگز خود تست‌ها حذف/تضعیف نمی‌شوند.
//
// پوشش سناریوهای الزامی:
//   ۱) درخواست API بدون توکن در حالتِ توکنِ فعال
//   ۲) درخواست API با توکن معتبر و نامعتبر
//   ۳) حالت توکنِ تنظیم‌نشده (قفل — هرگز «باز» نیست)
//   ۴) تلاش برای bind به آدرس غیر loopback بدون تنظیمات امنیتی
//   ۵) رفتار HTTP و WebSocket در «همهٔ» حالت‌های بالا (هم‌ارز و سازگار)
//   ۶) مسیرهای عمومی و Health Check (صریح و محدود)
//   ۷) توکن در Logها و پاسخ‌های غیرضروری افشا نمی‌شود
//
// سه لایهٔ مستقل:
//   A) سیاست خالص (resolveAuthPlan/isLoopbackHost — بدون I/O)
//   B) رفتار HTTP/WS از طریق createApp/attachEvents (مثل اجرای واقعی)
//   C) «فرایند واقعی»: spawn خودِ bun index.ts — رد شدنِ شروع، هشدار آدرس
//      شبکه‌ای، و اجرای کامل دسکتاپ با توکن تولیدی + عدم نشت در audit.log

import { afterAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { io } from "socket.io-client";
import { buildTestStack, listenApp, listenStackIo, type ListeningServer, type TestStack } from "./helpers";
import { isLoopbackHost, resolveAuthPlan } from "../src/config";

const TOKEN = "security-test-0123456789abcdef0123456789";
const WRONG = "wrong-token-value-000000";

// ---------------------------------------------------------------------------
// ابزارهای مشترک
// ---------------------------------------------------------------------------
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

// ===========================================================================
// A) سیاست خالص — resolveAuthPlan + isLoopbackHost
// ===========================================================================

test("A1 سیاست: بدون توکن و بدون صراحت → رد (AUTH_NOT_CONFIGURED) — هرگز «باز» نیست", () => {
  const r = resolveAuthPlan({ auth: undefined, token: undefined, desktop: false });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_NOT_CONFIGURED");
});

test("A2 سیاست: توکن صریح → حالت token، تولیدی نیست", () => {
  const r = resolveAuthPlan({ auth: undefined, token: TOKEN, desktop: false });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.token).toBe(TOKEN);
    expect(r.plan.tokenGenerated).toBe(false);
  }
});

test("A3 سیاست: دسکتاپ بدون توکن صریح → token تولیدی برای همین اجرا", () => {
  const r = resolveAuthPlan({ auth: undefined, token: undefined, desktop: true });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.tokenGenerated).toBe(true);
    expect(r.plan.token).toBeUndefined(); // خود index.ts مقدار تصادفی می‌سازد
  }
});

test("A4 سیاست: HEM_AGENT_AUTH=open + بدون توکن + غیر دسکتاپ → مجاز (استثنای مستند)", () => {
  const r = resolveAuthPlan({ auth: "open", token: undefined, desktop: false });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.plan.mode).toBe("open");
});

test("A5 سیاست: open + توکن → رد (ترکیب مبهم)", () => {
  const r = resolveAuthPlan({ auth: "open", token: TOKEN, desktop: false });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_OPEN_WITH_TOKEN");
});

test("A6 سیاست: open + دسکتاپ → رد (دسکتاپ همیشه توکن‌دار است)", () => {
  const r = resolveAuthPlan({ auth: "open", token: undefined, desktop: true });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_DESKTOP_REQUIRES_TOKEN");
});

test("A7 سیاست: HEM_AGENT_AUTH=token بدون توکن و بدون دسکتاپ → رد", () => {
  const r = resolveAuthPlan({ auth: "token", token: undefined, desktop: false });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe("AUTH_TOKEN_MISSING");
});

test("A8 سیاست: HEM_AGENT_AUTH=token + دسکتاپ → مجاز (توکن تولیدی)", () => {
  const r = resolveAuthPlan({ auth: "token", token: undefined, desktop: true });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.plan.mode).toBe("token");
    expect(r.plan.tokenGenerated).toBe(true);
  }
});

test("A9 سیاست: مقدار نامعتبر → رد با فهرست مقدارهای مجاز", () => {
  for (const bad of ["yes", "OPEN!", "public", "0"]) {
    const r = resolveAuthPlan({ auth: bad, token: undefined, desktop: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("AUTH_INVALID_POLICY");
      expect(r.message).toContain("token");
      expect(r.message).toContain("open");
    }
  }
});

test("A10 سیاست: مقدار case-insensitive است (OPEN/Token)", () => {
  expect(resolveAuthPlan({ auth: "OPEN", token: undefined, desktop: false }).ok).toBe(true);
  expect(resolveAuthPlan({ auth: " Token ", token: TOKEN, desktop: false }).ok).toBe(true);
});

test("A11 loopback: فقط 127.x/localhost/::1 — بقیه (0.0.0.0، 192.168.x، نام دامنه) نیستند", () => {
  expect(isLoopbackHost("127.0.0.1")).toBe(true);
  expect(isLoopbackHost("127.0.0.2")).toBe(true); // کل بلوک 127/8
  expect(isLoopbackHost("localhost")).toBe(true);
  expect(isLoopbackHost("LOCALHOST")).toBe(true);
  expect(isLoopbackHost("::1")).toBe(true);
  expect(isLoopbackHost("[::1]")).toBe(true);
  expect(isLoopbackHost("0.0.0.0")).toBe(false);
  expect(isLoopbackHost("192.168.1.10")).toBe(false);
  expect(isLoopbackHost("server.example.com")).toBe(false);
  expect(isLoopbackHost("")).toBe(false);
});

// ===========================================================================
// B) رفتار HTTP/WS — سه حالت، هم‌ارز و سازگار
// ===========================================================================

// --- حالت توکن فعال ---------------------------------------------------------
let tkStack: TestStack;
let tkSrv: ListeningServer;

test("B1 حالت توکن فعال: راه‌اندازی", async () => {
  tkStack = buildTestStack({ token: TOKEN });
  tkSrv = await listenApp(tkStack.app);
});

test("B1-۱ سناریو۱: API حساس بدون توکن → 401 (هیچ پاسخ مدیریتی نمی‌آید)", async () => {
  for (const p of ["/api/profiles", "/api/sessions", "/api/jobs"]) {
    const r = await fetch(`${tkSrv.baseUrl}${p}`);
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe("UNAUTHORIZED");
  }
});

test("B1-۲ سناریو۲: توکن معتبر → 200؛ توکن نادرست → 401 (هدر و کوکی یکسان)", async () => {
  const okH = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { "X-HEM-Token": TOKEN } });
  expect(okH.status).toBe(200);
  const okC = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(okC.status).toBe(200);
  const badH = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { "X-HEM-Token": WRONG } });
  expect(badH.status).toBe(401);
  const badC = await fetch(`${tkSrv.baseUrl}/api/profiles`, { headers: { Cookie: `hem_token=${WRONG}` } });
  expect(badC.status).toBe(401);
});

test("B1-۳ سناریو۶: health عمومیِ حداقلی — فقط GET /api/health؛ نه POST، نه مسیر مشابه", async () => {
  const pub = await fetch(`${tkSrv.baseUrl}/api/health`);
  expect(pub.status).toBe(200);
  const body = (await pub.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["ok", "service", "version"].sort());
  const post = await fetch(`${tkSrv.baseUrl}/api/health`, { method: "POST" });
  expect(post.status).toBe(401); // متد دیگر ≠ استثنای عمومی
  const lookalike = await fetch(`${tkSrv.baseUrl}/api/healthX`);
  expect(lookalike.status).toBe(401); // مسیر «کاملاً مشابه» هم عمومی نیست
  const deep = await fetch(`${tkSrv.baseUrl}/api/health/extra`);
  expect(deep.status).toBe(401);
});

// --- حالت قفل (توکن تنظیم‌نشده) ---------------------------------------------
let lkStack: TestStack;
let lkSrv: ListeningServer;

test("B2 حالت قفل (توکن تنظیم‌نشده): راه‌اندازی", async () => {
  lkStack = buildTestStack({}); // بدون توکن و بدون authMode → قفل
  lkSrv = await listenApp(lkStack.app);
});

test("B2-۱ سناریو۳: بدون توکن → APIها 503 AUTH_NOT_CONFIGURED — هرگز بدون احراز هویت باز نیست", async () => {
  for (const p of ["/api/profiles", "/api/sessions", "/api/jobs", "/api/backup"]) {
    const r = await fetch(`${lkSrv.baseUrl}${p}`);
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string; message: string };
    expect(body.error).toBe("AUTH_NOT_CONFIGURED");
    expect(body.message).toContain("HEM_AGENT_TOKEN");
    expect(body.message).toContain("HEM_AGENT_AUTH=open");
  }
});

test("B2-۲ سناریو۶: در حالت قفل هم health عمومیِ حداقلی کار می‌کند (پاسخ غیرحساس)", async () => {
  const r = await fetch(`${lkSrv.baseUrl}/api/health`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["ok", "service", "version"].sort());
});

// --- حالت open (استثنای مستندِ توسعهٔ محلی) ----------------------------------
let opStack: TestStack;
let opSrv: ListeningServer;

test("B3 حالت open: راه‌اندازی (استثنای مستند — در index.ts فقط loopback)", async () => {
  opStack = buildTestStack({ authMode: "open" });
  opSrv = await listenApp(opStack.app);
});

test("B3-۱ سناریو۵: open → API بدون احراز هویت در دسترس است (مستند و محدود به توسعهٔ محلی)", async () => {
  const r = await fetch(`${opSrv.baseUrl}/api/profiles`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("B3-۲ سناریو۶: health در حالت open پاسخ کامل می‌دهد (هم‌ارز HTTP: بدون احراز هویت)", async () => {
  const r = await fetch(`${opSrv.baseUrl}/api/health`);
  expect(r.status).toBe(200);
  const body = (await r.json()) as Record<string, unknown>;
  expect(body.uptimeSec).toBeDefined();
  expect(body.sessions).toBeDefined();
});

// --- WebSocket — هم‌ارزی با HTTP در هر سه حالت -------------------------------
const WS_GRACE_MS = 400;

function tryConnect(url: string, extraHeaders: Record<string, string>, timeoutMs = 4000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = io(url, { extraHeaders, reconnection: false, timeout: 2500 });
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (graceTimer) clearTimeout(graceTimer);
      try {
        client.disconnect();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };
    client.on("connect", () => {
      graceTimer = setTimeout(() => done(client.connected), WS_GRACE_MS);
    });
    client.on("connect_error", () => done(false));
    client.on("disconnect", () => {
      if (graceTimer) clearTimeout(graceTimer);
      done(false);
    });
    setTimeout(() => done(client.connected), timeoutMs).unref?.();
  });
}

/** مهلت محافظ برای بستن سرور — server.close() روی سوکت‌های keep-alive می‌مانَد (رفتار شناخته‌شدهٔ bun/undici) */
const cap = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

async function closeIoSrv(srv: { closeIo: () => Promise<void>; close: () => Promise<void> }): Promise<void> {
  await Promise.race([srv.closeIo().catch(() => undefined), cap(2500)]);
  await Promise.race([srv.close(), cap(2500)]);
}

test("B4-۱ سناریو۵ WS در حالت توکن: بدون توکن/نادرست → قطع؛ معتبر → متصل (هدر و کوکی مثل HTTP)", async () => {
  const srv = await listenStackIo(tkStack, { token: TOKEN });
  try {
    const ws = srv.baseUrl.replace(/^http/, "ws");
    expect(await tryConnect(ws, {})).toBe(false);
    expect(await tryConnect(ws, { "X-HEM-Token": WRONG })).toBe(false);
    expect(await tryConnect(ws, { "X-HEM-Token": TOKEN })).toBe(true);
    expect(await tryConnect(ws, { Cookie: `hem_token=${TOKEN}` })).toBe(true);
    expect(await tryConnect(ws, { Cookie: `hem_token=${WRONG}` })).toBe(false);
  } finally {
    await closeIoSrv(srv);
  }
});

test("B4-۲ سناریو۵ WS در حالت قفل (توکن تنظیم‌نشده): هر اتصالی بلافاصله قطع می‌شود", async () => {
  const srv = await listenStackIo(lkStack, {});
  try {
    const ws = srv.baseUrl.replace(/^http/, "ws");
    expect(await tryConnect(ws, {})).toBe(false);
    expect(await tryConnect(ws, { "X-HEM-Token": WRONG })).toBe(false);
  } finally {
    await closeIoSrv(srv);
  }
});

test("B4-۳ سناریو۵ WS در حالت open: اتصال‌ها باز هستند (هم‌ارزِ HTTP)", async () => {
  const srv = await listenStackIo(opStack, { authMode: "open" });
  try {
    const ws = srv.baseUrl.replace(/^http/, "ws");
    expect(await tryConnect(ws, {})).toBe(true);
  } finally {
    await closeIoSrv(srv);
  }
});

// ===========================================================================
// C) فرایند واقعی — spawn خودِ bun index.ts (رفتار شروع/بایند/دسکتاپ/نشت)
// ===========================================================================

const AGENT_DIR = import.meta.dir + "/..";

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

/** اجرای index.ts و انتظار برای خروج (سناریوهای «شروع نمی‌شود») */
function runExpectExit(env: Record<string, string>, expectCode: string, timeoutMs = 20_000): Promise<ProcResult> {
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
      if (!output.includes(expectCode)) {
        reject(new Error(`کد خطای مورد انتظار "${expectCode}" در خروجی نیست:\n${output}`));
        return;
      }
      resolve({ exitCode: code, output });
    });
  });
}

let serverChildren: ChildProcess[] = [];
function killServerChild(c: ChildProcess): void {
  if (c.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(c.pid), "/F", "/T"], { stdio: "ignore" });
    } else {
      c.kill("SIGTERM");
    }
  } catch {
    /* best-effort */
  }
}

test("C1 سناریو۳/۴: بدون توکن و بدون صراحت → فرایندِ واقعی با exit غیرصفر متوقف می‌شود", async () => {
  const r = await runExpectExit(
    cleanEnv({ HEM_AGENT_PORT: "31051", HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c1-")) }),
    "AUTH_NOT_CONFIGURED",
  );
  expect(r.exitCode).not.toBe(0);
  expect(r.output).toContain("شروع نمی‌شود");
});

test("C2 سناریو۴: bind غیر loopback بدون احراز هویت (open + 0.0.0.0) → شروع نمی‌شود", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31052",
      HEM_AGENT_AUTH: "open",
      HEM_AGENT_HOST: "0.0.0.0",
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c2-")),
    }),
    "loopback",
  );
  expect(r.exitCode).not.toBe(0);
  expect(r.output).toContain("راه‌اندازی متوقف شد");
});

test("C3 سناریو۴: bind غیر loopback بدون هیچ توکن/صراحت (فقط HEM_AGENT_HOST) → شروع نمی‌شود", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31053",
      HEM_AGENT_HOST: "0.0.0.0",
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c3-")),
    }),
    "AUTH_NOT_CONFIGURED",
  );
  expect(r.exitCode).not.toBe(0);
});

test("C4 پیکربندی متناقض: HEM_AGENT_AUTH=token بدون توکن → شروع نمی‌شود", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31054",
      HEM_AGENT_AUTH: "token",
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c4-")),
    }),
    "AUTH_TOKEN_MISSING",
  );
  expect(r.exitCode).not.toBe(0);
});

test("C5 پیکربندی متناقض: open + توکن → شروع نمی‌شود", async () => {
  const r = await runExpectExit(
    cleanEnv({
      HEM_AGENT_PORT: "31055",
      HEM_AGENT_AUTH: "open",
      HEM_AGENT_TOKEN: TOKEN,
      HEM_AGENT_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "hem-c5-")),
    }),
    "AUTH_OPEN_WITH_TOKEN",
  );
  expect(r.exitCode).not.toBe(0);
});

test("C6 سناریو۴: bind شبکه‌ای «با توکن» → شروع می‌شود + هشدار صریح (انتخاب آگاهانه)", async () => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-c6-"));
  const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts")], {
    env: cleanEnv({
      HEM_AGENT_PORT: String(port),
      HEM_AGENT_HOST: "0.0.0.0",
      HEM_AGENT_TOKEN: TOKEN,
      HEM_AGENT_HOME: home,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChildren.push(child);
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
    expect(output).toContain("آدرس شبکه‌ای"); // هشدار صریح
    expect(output).toContain(`listening on http://0.0.0.0:${port}`);
    // در شبکه هم: بدون توکن 401، با توکن 200
    const no = await fetch(`http://127.0.0.1:${port}/api/profiles`);
    expect(no.status).toBe(401);
    const yes = await fetch(`http://127.0.0.1:${port}/api/profiles`, { headers: { "X-HEM-Token": TOKEN } });
    expect(yes.status).toBe(200);
  } finally {
    killServerChild(child);
  }
}, 60_000);

test("C7 دسکتاپ واقعی: توکن تولیدی + قفل کامل + یک‌بارمصرف + «عدم نشت» در audit.log و پاسخ‌ها", async () => {
  const port = await freePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hem-c7-"));
  const child = spawn(process.execPath, [path.join(AGENT_DIR, "index.ts"), "--desktop"], {
    env: cleanEnv({ HEM_AGENT_PORT: String(port), HEM_AGENT_HOME: home }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverChildren.push(child);
  let output = "";
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  try {
    // بالا آمدن: health عمومی (بدون توکن) 200 JSON حداقلی
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

    // لاگ: حالت token با توکن تولیدی
    expect(output).toContain("auth: token");
    expect(output).toContain("generated for this run");

    // توکن فقط از خط «desktop UI:» قابل استخراج است (کانال تحویل بوت‌استرپ)
    const m = /desktop UI: http:\/\/127\.0\.0\.1:\d+\/\?token=([0-9a-f]{24,})/.exec(output);
    if (!m) throw new Error(`توکن دسکتاپ در لاگ پیدا نشد. خروجی:\n${output}`);
    const dtok = m[1]!;
    expect(dtok.length).toBeGreaterThanOrEqual(48); // randomBytes(24) → hex ۴۸ نویسه

    // بدون توکن → 401؛ با توکن تولیدی → 200 (API واقعی، نه فقط health)
    const no = await fetch(`http://127.0.0.1:${port}/api/profiles`);
    expect(no.status).toBe(401);
    const yes = await fetch(`http://127.0.0.1:${port}/api/profiles`, { headers: { "X-HEM-Token": dtok } });
    expect(yes.status).toBe(200);

    // تبادل یک‌بارمصرف + replay مرده (رفتار HTTP همان v0.3.1 §4)
    const b1 = await fetch(`http://127.0.0.1:${port}/?token=${dtok}`, { redirect: "manual" });
    expect(b1.status).toBe(303);
    expect(b1.headers.get("set-cookie") ?? "").toContain("HttpOnly");
    const b2 = await fetch(`http://127.0.0.1:${port}/?token=${dtok}`, { redirect: "manual" });
    expect(b2.headers.get("set-cookie")).toBeNull();

    // سناریو۷ — عدم نشت:
    // (الف) توکن «فقط» در خط desktop UI آمده است، نه در هیچ خط دیگری از لاگ:
    const linesWithToken = output.split("\n").filter((l) => l.includes(dtok));
    expect(linesWithToken.length).toBe(1);
    expect(linesWithToken[0]!.includes("desktop UI:")).toBe(true);
    // (ب) پاسخ‌های API هیچ‌وقت توکن را برنمی‌گردانند:
    const noBody = (await no.json()) as Record<string, unknown>;
    expect(JSON.stringify(noBody)).not.toContain(dtok);
    // (ج) audit.log بدون توکن است (اگر تاکنون رکوردی نوشته شده):
    const auditFile = path.join(home, "audit.log");
    if (fs.existsSync(auditFile)) {
      const auditText = fs.readFileSync(auditFile, "utf8");
      expect(auditText).not.toContain(dtok);
    }
  } finally {
    killServerChild(child);
  }
}, 60_000);

afterAll(() => {
  for (const c of serverChildren) killServerChild(c);
  tkStack?.dispose();
  lkStack?.dispose();
  opStack?.dispose();
});
