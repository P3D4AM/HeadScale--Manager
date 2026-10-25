// تست‌های سروِ UI استاتیک و صفحهٔ خطای روشن — regression باگ ویندوزی v0.3.1:
// «اجرای EXE و بازکردن نشانی UI به‌جای رابط گرافیکی، JSON سلامت نشان می‌داد».
//
// قرارداد v0.3.2:
//   • ui/ موجود  → GET / و مسیرهای SPA = 200 text/html با محتوای واقعی UI
//                  (پس از تبادل یک‌بارمصرف ?token= → 303 + کوکی، همان مسیر HTML می‌دهد)
//   • ui/ غایب   → GET / = 503 text/html «صفحهٔ خطای روشن فارسی» — هرگز JSON مبهم
//   • /api/health = همیشه JSON صحیح (مستقل از UI — با سرو اصلی اشتباه نشود)

import { afterAll, beforeAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildTestStack, listenApp, tmpHome, type ListeningServer, type TestStack } from "./helpers";
import { AGENT_VERSION } from "../src/config";

const TOKEN = "ui-serving-test-0123456789abcdef0123456789";

const UI_MARKER = "HEM-UI-REGRESSION-MARKER";
const FIXTURE_HTML = `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/><title>Headscale Easy Manager — تست</title></head><body><div id="root">${UI_MARKER} سلام دنیا</div></body></html>`;

function makeUiDir(): string {
  const dir = path.join(tmpHome("hem-ui-"), "ui");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), FIXTURE_HTML);
  fs.writeFileSync(path.join(dir, "style.css"), "body{direction:rtl}");
  return dir;
}

// ---------------------------------------------------------------------------
// حالت ۱: ui/ موجود — سرو واقعی UI
// ---------------------------------------------------------------------------
let okStack: TestStack;
let okSrv: ListeningServer;

beforeAll(async () => {
  okStack = buildTestStack({ token: TOKEN, uiDir: makeUiDir() });
  okSrv = await listenApp(okStack.app);
});

afterAll(() => {
  okStack.dispose();
});

test("UI موجود: GET / (با کوکی جلسه‌ای) → 200 text/html با محتوای واقعی UI (نه JSON)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  const body = await r.text();
  expect(body).toContain('lang="fa"');
  expect(body).toContain(UI_MARKER);
  expect(body).toContain("Headscale Easy Manager");
  // دقیقاً ضدِ باگ: JSON مبهم هرگز در پاسخ UI نیست
  expect(body).not.toContain('"service":"hem-agent"');
});

test("UI موجود: تبادل یک‌بارمصرف GET /?token= → 303 + Set-Cookie؛ سپس GET / همان مسیر HTML می‌دهد (ترتیب middleware)", async () => {
  // اپ تازه تا بودجهٔ یک‌بارمصرف مستقل باشد
  const st = buildTestStack({ token: TOKEN, uiDir: makeUiDir() });
  const srv = await listenApp(st.app);
  try {
    const r1 = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
    expect(r1.status).toBe(303);
    expect(r1.headers.get("set-cookie") ?? "").toContain("hem_token=");
    // همان GET / — این بار با کوکی — باید رابط HTML بدهد (نه JSON سلامت)
    const r2 = await fetch(`${srv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
    expect(r2.status).toBe(200);
    expect((r2.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
    expect(await r2.text()).toContain(UI_MARKER);
  } finally {
    st.dispose();
  }
});

test("UI موجود: fallback SPA → مسیر ناشناخته هم index.html می‌گیرد (text/html + no-store)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/route/nashnakhte/xyz`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  expect(await r.text()).toContain(UI_MARKER);
  expect((r.headers.get("cache-control") ?? "").toLowerCase()).toContain("no-store");
});

test("UI موجود: asset استاتیک با mime درست (css → text/css)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/style.css`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/css");
});

test("UI موجود: /api/health همچنان JSON صحیح است (با سرو UI اشتباه نمی‌شود)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  const body = (await r.json()) as { ok: boolean; service: string; version: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
  expect(body.version).toBe(AGENT_VERSION);
});

// ---------------------------------------------------------------------------
// حالت ۲: ui/ غایب — صفحهٔ خطای روشن، هرگز JSON مبهم (قلب باگ v0.3.1)
// ---------------------------------------------------------------------------
let missingStack: TestStack;
let missingSrv: ListeningServer;

beforeAll(async () => {
  const expected = path.join(tmpHome("hem-noui-"), "ui"); // وجود ندارد
  missingStack = buildTestStack({ token: TOKEN, uiDir: path.join(tmpHome("hem-noui-"), "ui-nonexistent"), uiDirExpected: expected });
  missingSrv = await listenApp(missingStack.app);
});

afterAll(() => {
  missingStack.dispose();
});

test("UI غایب: GET / → 503 text/html صفحهٔ خطای «روشن» فارسی — نه JSON مبهم (regression باگ)", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(503);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  const body = await r.text();
  expect(body).toContain('lang="fa"');
  expect(body).toContain("فایل‌های رابط کاربری پیدا نشد"); // پیام روشن
  // دقیقاً ضدِ باگ: پاسخ UI هرگز JSON مبهم نیست
  expect(body).not.toContain('"service":"hem-agent"');
  expect(body).not.toContain('"ok":true');
});

test("UI غایب: صفحهٔ خطا «مسیر مورد انتظار» را می‌گوید (قابل تشخیص برای کاربر)", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  const body = await r.text();
  expect(body).toContain(path.join(path.sep, "ui").replace(/\\/g, path.sep)); // .../ui در پیام
  expect(body).toContain("راه‌حل");
});

test("UI غایب: مسیر ناشناخته هم همان صفحهٔ خطا را می‌گیرد (نه 404 خام/JSON)", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/whatever/deep/path`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(503);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
});

test("UI غایب اما /api/health همچنان JSON صحیح می‌دهد — سلامت سرو با UI جداست", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  const body = (await r.json()) as { ok: boolean; service: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
});

test("UI غایب: تبادل یک‌بارمصرف توکن همچنان کار می‌کند (303 + کوکی؛ ریدایرکت به صفحهٔ خطای روشن)", async () => {
  const st = buildTestStack({ token: TOKEN, uiDirExpected: path.join(tmpHome("hem-noui2-"), "ui") });
  const srv = await listenApp(st.app);
  try {
    const r = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
    expect(r.status).toBe(303);
    expect(r.headers.get("set-cookie") ?? "").toContain("hem_token=");
    const r2 = await fetch(`${srv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` }, redirect: "manual" });
    expect(r2.status).toBe(503);
    expect((r2.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  } finally {
    st.dispose();
  }
});
