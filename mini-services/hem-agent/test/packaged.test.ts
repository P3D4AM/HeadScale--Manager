// "Packaged layout" regression tests — the heart of the v0.3.1 Windows bug:
//
//   "Running HeadscaleEasyManager v0.3.1 on Windows and opening the Desktop UI
//    address showed this JSON instead of the GUI: {"ok":true,"service":"hem-agent",…}"
//
// This test recreates those conditions "for real":
//   1) a standalone binary is built with bun build --compile (the same method as the
//      Windows EXE) — so import.meta.dir is really inside the $bunfs virtual fs;
//   2) the official package layout is staged next to it: ui/ (and installer/) next
//      to the binary;
//   3) the binary is run and it is proven that:
//        • GET /?token= → 303 + a session Set-Cookie (one-time exchange)
//        • GET / (with the cookie) → 200 "text/html" with the real UI content — not the ambiguous JSON
//        • GET /api/health → 200 correct JSON (not confused with serving the UI)
//        • run log: ui: served (…) with the path next to the binary
//
// On Linux the $bunfs path is POSIX and on Windows C:\$bunfs — the Windows
// path-detection scenario is separately locked in test/exepath.test.ts; here the
// "real behavior of the packaged binary" is proven on the host it runs on.
// It is portable (CI tests run it too; on Windows CI the Windows EXE itself is
// compiled and executed).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

const AGENT_DIR = path.join(import.meta.dir, "..");
const OUTER_DIR = path.join(AGENT_DIR, "..", "..");
const TOKEN = "packaged-test-0123456789abcdef0123456789";

/** The compiled binary of this test run */
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

/** Packaged layout: ui/ next to the binary — the real built UI if present, otherwise the fixture */
function stageUi(stage: string): void {
  const ui = path.join(stage, "ui");
  fs.mkdirSync(ui, { recursive: true });
  const realUi = path.join(OUTER_DIR, "out", "index.html"); // the root next build output
  if (fs.existsSync(realUi)) {
    fs.cpSync(path.join(OUTER_DIR, "out"), ui, { recursive: true });
  } else {
    fs.writeFileSync(path.join(ui, "index.html"), FIXTURE_HTML);
  }
  // installer/ next to the binary too, like the official package (packaged contract)
  fs.mkdirSync(path.join(stage, "installer"), { recursive: true });
  fs.writeFileSync(path.join(stage, "installer", "install.sh"), "#!/bin/sh\n# stub packaged layout\n");
}

beforeAll(async () => {
  // 1) real compile of the standalone binary (the same method as the Windows EXE in build-windows.sh)
  stageDir = fs.mkdtempSync(path.join(os.tmpdir(), "hem-packaged-"));
  const outBase = path.join(stageDir, "hem-manager-test");
  execFileSync(
    process.execPath, // under bun test this is bun itself
    ["build", "--compile", path.join(AGENT_DIR, "index.ts"), "--outfile", outBase],
    { cwd: AGENT_DIR, stdio: ["ignore", "pipe", "pipe"] },
  );
  exePath = [outBase, `${outBase}.exe`].find((p) => fs.existsSync(p));
  if (!exePath) throw new Error("compiled binary was not produced (bun build --compile)");
  if (process.platform !== "win32") fs.chmodSync(exePath, 0o755);

  // 2) the official package layout: ui/ and installer/ next to the binary
  stageUi(stageDir);
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "hem-packaged-home-"));

  // 3) actually run the binary
  port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(exePath, [], {
    env: {
      ...process.env,
      HEM_AGENT_PORT: String(port),
      HEM_AGENT_TOKEN: TOKEN, // explicit token — no desktop mode (no browser opening)
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

  // 4) wait for startup — v0.3.2: /api/health is the minimal public one (200 JSON);
  // sensitive routes like /api/profiles must give 401 (alive + gated)
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`packaged binary died (exit=${child.exitCode}). Log:\n${stdoutAll}`);
    try {
      const r = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200) {
        const b = (await r.json()) as { ok?: boolean; service?: string };
        if (b.ok === true && b.service === "hem-agent") break;
      }
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server did not come up within 60s. Log:\n${stdoutAll}`);
    await new Promise((res) => setTimeout(res, 300));
  }
}, 240_000); // compiling the binary takes a while

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
    /* tried */
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
// proofs — the packaged EXE + ui/ next to it
// ---------------------------------------------------------------------------

test("compiled binary: sees the ui/ next to itself — the \"ui: served\" log with the stage path (not $bunfs)", async () => {
  await new Promise((res) => setTimeout(res, 200));
  expect(stdoutAll).toContain("ui: served");
  expect(stdoutAll).toContain(path.join(stageDir, "ui"));
  expect(stdoutAll).not.toContain("ui: MISSING");
  // bug regression: the virtual-fs path is never accepted as the ui location
  expect(stdoutAll).not.toContain("$bunfs");
}, 30_000);

test("compiled binary: GET /?token= → 303 + session Set-Cookie (no Max-Age)", async () => {
  const r = await fetch(`${baseUrl}/?token=${encodeURIComponent(TOKEN)}`, { redirect: "manual" });
  expect(r.status).toBe(303);
  const sc = r.headers.get("set-cookie") ?? "";
  expect(sc).toContain(`hem_token=${TOKEN}`);
  expect(sc).toContain("HttpOnly");
  expect(sc).not.toContain("Max-Age");
  expect(r.headers.get("location")).toBe("/");
}, 30_000);

test("compiled binary: GET / (with the cookie) → 200 text/html with the real UI content — not the health JSON (bug regression)", async () => {
  const r = await fetch(`${baseUrl}/`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  const body = await r.text();
  expect(body).toContain('lang="fa"');
  expect(body).toContain("Headscale Easy Manager");
  // exactly against the reported bug: the ambiguous JSON never comes back instead of the UI
  expect(body).not.toContain('"service":"hem-agent"');
  expect((r.headers.get("cache-control") ?? "").toLowerCase()).toContain("no-store");
}, 30_000);

test("compiled binary: an unknown SPA route also gets index.html (fallback)", async () => {
  const r = await fetch(`${baseUrl}/whatever/spa/route`, { headers: { Cookie: `hem_token=${TOKEN}` } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("text/html");
  expect(await r.text()).toContain('lang="fa"');
}, 30_000);

test("compiled binary: GET /api/health is still correct JSON — independent of the UI; minimal public without a token, full with one", async () => {
  // without a token: the minimal public response (only non-sensitive fields)
  const r0 = await fetch(`${baseUrl}/api/health`);
  expect(r0.status).toBe(200);
  const body0 = (await r0.json()) as Record<string, unknown>;
  expect(body0.ok).toBe(true);
  expect(body0.service).toBe("hem-agent");
  expect(Object.keys(body0).sort()).toEqual(["ok", "service", "version"].sort());
  // with a token: the full response
  const r = await fetch(`${baseUrl}/api/health`, { headers: { "X-HEM-Token": TOKEN } });
  expect(r.status).toBe(200);
  expect((r.headers.get("content-type") ?? "").toLowerCase()).toContain("application/json");
  const body = (await r.json()) as { ok: boolean; service: string; version: string };
  expect(body.ok).toBe(true);
  expect(body.service).toBe("hem-agent");
  expect(body.version).toMatch(/^0\.\d+\.\d+(-[\w.]+)?$/);
}, 30_000);

test("compiled binary: clean shutdown (SIGTERM → exit code zero)", async () => {
  killChild();
  expect(await waitExited(10_000)).toBe(true);
}, 30_000);
