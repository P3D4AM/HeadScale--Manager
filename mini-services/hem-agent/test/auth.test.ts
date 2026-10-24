// تست‌های امنیتی §۴ (v0.3.1) — مثبت و منفی.
// «وجود کد احراز هویت» کافی نیست: رفتار واقعی HTTP و WebSocket بررسی می‌شود —
// بدون توکن معتبر، هیچ عملیات مدیریتی/رویداد حساسی در دسترس نیست.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { io } from "socket.io-client";
import { buildTestStack, listenApp, listenStackIo, type ListeningServer, type TestStack } from "./helpers";

const TOKEN = "auth-test-0123456789abcdef0123456789abcdef"; // 40 نویسه — شبیه توکن دسکتاپ

let stack: TestStack;
let srv: ListeningServer;

beforeAll(async () => {
  stack = buildTestStack({ token: TOKEN });
  srv = await listenApp(stack.app);
});

// همهٔ پاک‌سازی‌ها در یک afterAll — ترتیب: اول WS، بعد استک، بعد HTTP

// ---------------------------------------------------------------------------
// HTTP — احراز هویت API فقط با هدر X-HEM-Token یا کوکی hem_token
// ---------------------------------------------------------------------------
test("HTTP: بدون توکن → 401 (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`);
  expect(r.status).toBe(401);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe("UNAUTHORIZED");
});

test("HTTP: توکن نادرست در هدر → 401 (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { "X-HEM-Token": "wrong-token-value-000000" } });
  expect(r.status).toBe(401);
});

test("HTTP: token در query هیچ‌وقت احراز هویت API نیست → 401 و بدون Set-Cookie (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health?token=${encodeURIComponent(TOKEN)}`);
  expect(r.status).toBe(401);
  expect(r.headers.get("set-cookie")).toBeNull(); // هیچ کوکی‌ای ساخته نمی‌شود
});

test("HTTP: هدر X-HEM-Token معتبر → 200 (مثبت)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  const body = (await r.json()) as { ok: boolean };
  expect(body.ok).toBe(true);
});

test("HTTP: کوکی hem_token معتبر (بدون هدر) → 200 (مثبت)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
});

test("HTTP: کوکی hem_token نادرست → 401 (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health`, { headers: { Cookie: "hem_token=wrong-token-value-000000" } });
  expect(r.status).toBe(401);
});

test("HTTP Origin: مبدأ غیرلوکال در عملیات نوشتاری → 403 (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "https://evil.example.com" },
    body: JSON.stringify({ inline: { host: "127.0.0.1", port: 2222 } }),
  });
  expect(r.status).toBe(403);
  const body = (await r.json()) as { error: string };
  expect(body.error).toBe("FORBIDDEN");
});

test("HTTP Origin: مبدأ localhost مجاز است و به لایه بعدی می‌رسد (مثبت)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: "http://localhost:3000", "X-HEM-Token": TOKEN },
    body: JSON.stringify({ inline: { host: "127.0.0.1", port: 2222 } }),
  });
  // 400 = اعتبارسنجی ورودی (بدون پورت/کاربر) — یعنی از Origin و توکن گذشته است
  expect(r.status).toBe(400);
  expect(r.status).not.toBe(403);
  expect(r.status).not.toBe(401);
});

// ---------------------------------------------------------------------------
// تبادل یک‌بارمصرف ?token= → کوکی جلسه‌ای (نشت توکن در URL/تاریخچه/لاگ)
// ---------------------------------------------------------------------------
test("Bootstrap: اولین GET /?token=معتبر → 303 + Set-Cookie جلسه‌ای HttpOnly/SameSite=Strict و بدون Max-Age (مثبت)", async () => {
  const r = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).toBe(303);
  const sc = r.headers.get("set-cookie") ?? "";
  expect(sc).toContain(`hem_token=${TOKEN}`);
  expect(sc).toContain("HttpOnly");
  expect(sc).toContain("SameSite=Strict");
  expect(sc).not.toContain("Max-Age"); // کوکی جلسه‌ای — با بستن مرورگر می‌میرد
  // نشانی بدون token و با حفظ پارامترهای دیگر (مثل XTransformPort)
  expect(r.headers.get("location")).toBe("/");
});

test("Bootstrap: 303 پارامترهای دیگر کوئری (XTransformPort) را حفظ می‌کند و فقط token را حذف می‌کند (مثبت)", async () => {
  // bootstrap یک‌بارمصرف است — این تست با «اپ/سرور تازهٔ خودش» انجام می‌شود تا
  // مستقل از ترتیب اجرای تست‌های قبلی باشد.
  const st = buildTestStack({ token: TOKEN });
  const sv = await listenApp(st.app);
  try {
    const r = await fetch(
      `${sv.baseUrl}/ui/route?token=${encodeURIComponent(TOKEN)}&XTransformPort=3005&foo=bar`,
      { redirect: "manual" },
    );
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/ui/route?XTransformPort=3005&foo=bar");
  } finally {
    st.dispose();
    await sv.close();
  }
});

test("Bootstrap: «دومین» GET با همان لینک (بازیابی از تاریخچهٔ مرورگر) → هیچ کوکی‌ای ساخته نمی‌شود (منفی — یک‌بارمصرف)", async () => {
  const r = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).not.toBe(303);
  expect(r.headers.get("set-cookie")).toBeNull();
});

test("Bootstrap: token نادرست هیچ‌وقت کوکی نمی‌سازد (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/?token=wrong-token-value-000000`, { redirect: "manual" });
  expect(r.status).not.toBe(303);
  expect(r.headers.get("set-cookie")).toBeNull();
});

test("Bootstrap: مسیرهای /api هرگز تبادل نمی‌کنند — token در query فقط روی UI معتبر است (منفی)", async () => {
  const r = await fetch(`${srv.baseUrl}/api/health?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).toBe(401); // نه 303، نه کوکی — مثل قبل
  expect(r.headers.get("set-cookie")).toBeNull();
});

// ---------------------------------------------------------------------------
// WebSocket — اتصال بدون توکن معتبر هیچ رویداد حساسی نمی‌گیرد
// ---------------------------------------------------------------------------
let ioSrv: ListeningServer & { closeIo: () => Promise<void> };

test("WS: راه‌اندازی سرور با توکن", async () => {
  ioSrv = await listenStackIo(stack, { token: TOKEN });
  expect(ioSrv.baseUrl).toBeTruthy();
});

function wsUrl(path = "/"): string {
  return `${ioSrv.baseUrl.replace(/^http/, "ws")}${path}`;
}

/** اتصال socket.io با مهلت — resolve(true) فقط اگر «مدتِ معقولی» متصل بماند؛
 *  قطعِ بلافاصلهٔ پس از connect (ریجکت سمت سرور) → false. مسابقهٔ رخداد
 *  connect/disconnect در سطح میلی‌ثانیه با مهلت کوتاه (grace) حل می‌شود. */
const WS_GRACE_MS = 400;

function tryConnect(extraHeaders: Record<string, string>, timeoutMs = 4000): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const client = io(wsUrl(), { extraHeaders, reconnection: false, timeout: 2500 });
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
      // هنوز «مثبت» نیست — اگر سرور بلافاصله قطع کند (ریجکت)، disconnect می‌آید
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

test("WS: بدون توکن → اتصال قطع می‌شود (منفی)", async () => {
  const ok = await tryConnect({});
  expect(ok).toBe(false);
});

test("WS: توکن نادرست در هدر → قطع می‌شود (منفی)", async () => {
  const ok = await tryConnect({ "X-HEM-Token": "wrong-token-value-000000" });
  expect(ok).toBe(false);
});

test("WS: هدر X-HEM-Token معتبر → متصل می‌شود و دستورات کار می‌کنند (مثبت)", async () => {
  const ok = await tryConnect({ "X-HEM-Token": TOKEN });
  expect(ok).toBe(true);
});

test("WS: کوکی hem_token معتبر (بدون هدر) → متصل می‌شود (مثبت)", async () => {
  const ok = await tryConnect({ Cookie: `hem_token=${TOKEN}` });
  expect(ok).toBe(true);
});

test("WS: کلاینت معتبر می‌تواند رویداد بفرستد (job:cancel با ack — مسیر مجاز)", async () => {
  const ackResult = await new Promise<unknown>((resolve) => {
    const client = io(wsUrl(), {
      extraHeaders: { "X-HEM-Token": TOKEN },
      reconnection: false,
      timeout: 2000,
    });
    client.on("connect", () => {
      client.emit("job:cancel", { jobId: "job-nonexistent" }, (r: unknown) => {
        client.disconnect();
        resolve(r);
      });
    });
    client.on("connect_error", () => resolve(null));
    setTimeout(() => resolve(null), 3000).unref?.();
  });
  expect(ackResult).toEqual({ ok: false }); // job وجود ندارد — اما «اجازهٔ فرستادن» دارد
});

afterAll(async () => {
  // پاک‌سازی با مهلت محافظ (الگوی helpers.close): server.close() روی سوکت‌های
  // keep-aliveِ fetch می‌مانَد (رفتار شناخته‌شدهٔ bun/undici) — بدون این مهلت،
  // afterAll تا حداقل ۱۲۰ثانیه معلق می‌شود. ترتیب: WS، استک، HTTP.
  const cap = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));
  if (ioSrv) await Promise.race([ioSrv.closeIo().catch(() => undefined), cap(2500)]);
  stack.dispose();
  await Promise.race([srv.close(), cap(2500)]);
});
