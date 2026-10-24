// hem-agent — نقطهٔ شروع
// express + socket.io روی 127.0.0.1:3005 (HEM_AGENT_HOST/HEM_AGENT_PORT)
// درخواست‌های دروازه با ?XTransformPort=3005 می‌رسند و express خودش آن را نادیده می‌گیرد.
//
// حالت دسکتاپ (HEM_DESKTOP=1 یا --desktop — برنامهٔ ویندوزی):
//   • اگر HEM_AGENT_TOKEN تنظیم نشده باشد، یک توکن تصادفی برای «همین اجرا» ساخته می‌شود.
//   • نشانی UI با ?token= چاپ می‌شود و مرورگر پیش‌فرض باز می‌شود (شکست بازکردن
//     غیرمهم است — نشانی همیشه چاپ می‌شود).
//   • API توکن را از هدر X-HEM-Token «یا» کوکی hem_token می‌پذیرد؛ بازکردن
//     /?token=… کوکی را روی سیستم کاربر می‌گذارد (api.ts).

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Server as IOServer } from "socket.io";
import { agentHome, agentHost, agentPort, agentToken, desktopMode, AGENT_VERSION } from "./src/config";
import { createApp } from "./src/api";
import { attachEvents, JobManager } from "./src/events";
import { SessionManager } from "./src/sessions";
import { ProfileStore } from "./src/profiles";
import { SecretStore } from "./src/secrets";
import { AuditLogger } from "./src/audit";
import { Redactor } from "./src/redact";

const home = agentHome();
fs.mkdirSync(home, { recursive: true });

const redactor = new Redactor();
const audit = new AuditLogger(home, redactor);
const secrets = new SecretStore(home);
const profiles = new ProfileStore(home);
const jobs = new JobManager();
const manager = new SessionManager({ home, profiles, secrets, audit, redactor });

// در باینری کامپایل‌شده (exe ویندوزی / باینری لینوکسی)، import.meta.dir به فایل‌سیستم
// مجازی باندل اشاره می‌کند (/$bunfs/root)؛ پوشهٔ «کنار خود برنامه» (جایی که ui/
// در بسته قرار دارد) باید از process.execPath گرفته شود.
const exeDir = import.meta.dir.startsWith("/$bunfs") ? path.dirname(process.execPath) : import.meta.dir;
const uiDir = path.join(exeDir, "ui");

// --- توکن: صریح از محیط، یا (فقط در حالت دسکتاپ) تصادفی برای این اجرا
const isDesktop = desktopMode();
let token = agentToken();
let tokenGenerated = false;
if (isDesktop && !token) {
  token = randomBytes(24).toString("hex");
  tokenGenerated = true;
}

const app = createApp({
  manager,
  profiles,
  secrets,
  audit,
  redactor,
  jobs,
  token,
  uiDir: fs.existsSync(uiDir) ? uiDir : undefined,
  version: AGENT_VERSION,
  startedAt: Date.now(),
});

const host = agentHost();
const port = agentPort();
const uiUrl = `http://127.0.0.1:${port}/${token ? `?token=${token}` : ""}`;
const server = app.listen(port, host, () => {
  console.log(`[hem-agent] listening on http://${host}:${port} (home: ${home})`);
  console.log(
    `[hem-agent] version ${AGENT_VERSION} | platform ${process.platform} | ui: ${fs.existsSync(uiDir) ? "served" : "none"}${isDesktop ? " | mode: desktop" : ""}`,
  );
  if (isDesktop) {
    if (tokenGenerated) console.log("[hem-agent] token: generated for this run (set HEM_AGENT_TOKEN to pin it)");
    // نشانی همیشه چاپ می‌شود — حتی اگر بازکردن مرورگر شکست بخورد
    console.log(`[hem-agent] desktop UI: ${uiUrl}`);
    openDefaultBrowser(uiUrl);
  }
});

/** بازکردن مرورگر پیش‌فرض — بهترین تلاش؛ شکست غیرمهم (نشانی قبلاً چاپ شده است) */
function openDefaultBrowser(url: string): void {
  try {
    let child;
    if (process.platform === "win32") {
      child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    } else if (process.platform === "darwin") {
      child = spawn("open", [url], { detached: true, stdio: "ignore" });
    } else {
      child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    }
    child.on("error", (err: Error) => {
      console.log(`[hem-agent] (مرورگر باز نشد — نشانی بالا را دستی در مرورگر باز کنید: ${err.message})`);
    });
    child.unref();
  } catch (err) {
    console.log(`[hem-agent] (مرورگر باز نشد — نشانی بالا را دستی در مرورگر باز کنید: ${String(err)})`);
  }
}

const io = new IOServer(server, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // curl / same-origin
      if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return cb(null, true);
      return cb(new Error("origin not allowed"), false);
    },
  },
});
attachEvents(io, manager, jobs);

function shutdown(signal: string): void {
  console.log(`[hem-agent] ${signal} received — closing sessions…`);
  try {
    manager.dispose();
  } catch {
    /* ignore */
  }
  io.close(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
