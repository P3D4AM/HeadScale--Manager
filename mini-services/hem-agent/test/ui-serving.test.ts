// Static-UI serving and clear-error-page tests — regression for the v0.3.1 Windows bug:
// "running the EXE and opening the UI address showed the health JSON instead of the GUI".
//
// The v0.3.2 contract:
//   • ui/ present → GET / and SPA routes = 200 text/html with the real UI content
//                  (after the one-time ?token= exchange → 303 + cookie, the same route serves HTML)
//   • ui/ absent  → GET / = 503 text/html "clear Persian error page" — never the ambiguous JSON
//   • /api/health = always correct JSON (independent of the UI — not confused with serving it)

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
// case 1: ui/ present — really serving the UI
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

test("UI present: GET / (with the session cookie) → 200 text/html with the real UI content (not JSON)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  const body = await r.text();
  expect(body).toContain('lang="fa"');
  expect(body).toContain(UI_MARKER);
  expect(body).toContain("Headscale Easy Manager");
  // exactly against the bug: the ambiguous JSON is never in the UI response
  expect(body).not.toContain('"service":"hem-agent"');
});

test("UI present: one-time GET /?token= exchange → 303 + Set-Cookie; then GET / serves HTML on the same route (middleware order)", async () => {
  // a fresh app so the one-time budget stays independent
  const st = buildTestStack({ token: TOKEN, uiDir: makeUiDir() });
  const srv = await listenApp(st.app);
  try {
    const r1 = await fetch(`${srv.baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
    expect(r1.status).toBe(303);
    expect(r1.headers.get("set-cookie") ?? "").toContain("hem_token=");
    // the same GET / — now with the cookie — must serve the HTML UI (not the health JSON)
    const r2 = await fetch(`${srv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
    expect(r2.status).toBe(200);
    expect((r2.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
    expect(await r2.text()).toContain(UI_MARKER);
  } finally {
    st.dispose();
  }
});

test("UI present: SPA fallback → an unknown route also gets index.html (text/html + no-store)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/route/nashnakhte/xyz`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  expect(await r.text()).toContain(UI_MARKER);
  expect((r.headers.get("cache-control") ?? "").toLowerCase()).toContain("no-store");
});

test("UI present: a static asset with the right mime (css → text/css)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/style.css`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/css");
});

test("UI present: /api/health is still correct JSON (not confused with serving the UI)", async () => {
  const r = await fetch(`${okSrv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  const body = (await r.json()) as { ok: boolean; service: string; version: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
  expect(body.version).toBe(AGENT_VERSION);
});

// ---------------------------------------------------------------------------
// case 2: ui/ absent — the clear error page, never the ambiguous JSON (the heart of the v0.3.1 bug)
// ---------------------------------------------------------------------------
let missingStack: TestStack;
let missingSrv: ListeningServer;

beforeAll(async () => {
  const expected = path.join(tmpHome("hem-noui-"), "ui"); // does not exist
  missingStack = buildTestStack({ token: TOKEN, uiDir: path.join(tmpHome("hem-noui-"), "ui-nonexistent"), uiDirExpected: expected });
  missingSrv = await listenApp(missingStack.app);
});

afterAll(() => {
  missingStack.dispose();
});

test("UI absent: GET / → 503 text/html \"clear\" Persian error page — not the ambiguous JSON (bug regression)", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(503);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  const body = await r.text();
  expect(body).toContain('lang="fa"');
  expect(body).toContain("فایل‌های رابط کاربری پیدا نشد"); // the clear message
  // exactly against the bug: the UI response is never the ambiguous JSON
  expect(body).not.toContain('"service":"hem-agent"');
  expect(body).not.toContain('"ok":true');
});

test("UI absent: the error page states the \"expected path\" (recognizable for the user)", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  const body = await r.text();
  expect(body).toContain(path.join(path.sep, "ui").replace(/\\/g, path.sep)); // .../ui in the message
  expect(body).toContain("راه‌حل");
});

test("UI absent: an unknown route also gets the same error page (not a raw 404/JSON)", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/whatever/deep/path`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(503);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
});

test("UI absent but /api/health still gives correct JSON — service health is separate from the UI", async () => {
  const r = await fetch(`${missingSrv.baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  const body = (await r.json()) as { ok: boolean; service: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
});

test("UI absent: the one-time token exchange still works (303 + cookie; redirect to the clear error page)", async () => {
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
