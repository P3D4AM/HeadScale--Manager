// hem-agent — نقطهٔ شروع
// express + socket.io روی 127.0.0.1:3005 (HEM_AGENT_HOST/HEM_AGENT_PORT)
// درخواست‌های دروازه با ?XTransformPort=3005 می‌رسند و express خودش آن را نادیده می‌گیرد.
//
// احراز هویت (v0.3.2 §2 — fail-closed):
//   • حالت token (پیش‌فرض اجرای واقعی): همهٔ /api (به‌جز health عمومیِ حداقلی)
//     و همهٔ WebSocketها به هدر X-HEM-Token یا کوکی hem_token نیاز دارند.
//   • حالت دسکتاپ (HEM_DESKTOP=1 یا --desktop): اگر HEM_AGENT_TOKEN تنظیم نشده
//     باشد، یک توکن تصادفی امن برای «همین اجرا» ساخته می‌شود؛ نشانی UI با
//     ?token= چاپ و مرورگر باز می‌شود؛ تبادل token→کوکی «یک‌بارمصرف» است
//     (v0.3.1 §4): پس از اولین استفاده، لینک قدیمی در تاریخچهٔ مرورگر دیگر
//     معتبر نیست؛ کوکی جلسه‌ای HttpOnly/SameSite=Strict روی سیستم کاربر
//     می‌نشیند و 303 نشانی را بدون token تمیز می‌کند. احراز هویت API فقط با
//     هدر X-HEM-Token یا همان کوکی است — token در query هیچ‌وقت معتبر نیست.
//   • حالت open (HEM_AGENT_AUTH=open — استثنای مستندِ توسعهٔ محلی):
//     بدون احراز هویت، فقط روی loopback؛ روی آدرس شبکه‌ای شروع نمی‌شود.
//   • بدون توکن و بدون open: سرویس با خطای روشن «شروع نمی‌شود» (exit غیرصفر).
//   • WebSocket هم مانند HTTP توکن‌سنجی می‌شود (events.ts) — هم‌ارز و سازگار.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Server as IOServer } from "socket.io";
import {
  agentHome,
  agentHost,
  agentPort,
  desktopMode,
  isLoopbackHost,
  resolveAuthPlan,
  type AuthPlan,
  AGENT_VERSION,
  installerRootStatus,
} from "./src/config";
import { programDir } from "./src/exepath";
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
// مجازی باندل اشاره می‌کند (/$bunfs روی پوزیکس، C:\$bunfs روی ویندوز)؛ پوشهٔ «کنار
// خود برنامه» (جایی که ui/ در بسته قرار دارد) باید از process.execPath گرفته شود.
// تشخیص در src/exepath.ts — عضویت «$bunfs» در مسیر، نه پیشوند مطلق پوزیکس
// (باگ ویندوز v0.3.1: startsWith("/$bunfs") روی C:\$bunfs رد می‌شد و UI هرگز
// سرو نمی‌شد؛ GET / به‌جای رابط، JSON مبهم می‌داد).
const exeDir = programDir(import.meta.dir);
const uiDir = path.join(exeDir, "ui");
const uiExists = fs.existsSync(uiDir);

// --- سیاست احراز هویت (v0.3.2 §2 — fail-closed) --------------------------
// قدیم: «نبودن توکن» یعنی سرویسِ بی‌دفاع روی همهٔ /api و WebSocket — اصلاح شد:
//   • توکن صریح یا (دسکتاپ) تولیدی → حالت token؛
//   • HEM_AGENT_AUTH=open صریح → استثنای مستندِ توسعهٔ محلی، فقط روی loopback؛
//   • هیچ‌کدام → «شروع نمی‌شود» با خطای فارسی روشن و exit غیرصفر.
// تولید توکن دسکتاپ همین‌جا انجام می‌شود (randomBytes(24) — امن و تصادفی).
const isDesktop = desktopMode();
const host = agentHost();
const auth = resolveAuthPlan({
  auth: process.env.HEM_AGENT_AUTH,
  token: process.env.HEM_AGENT_TOKEN,
  desktop: isDesktop,
});
if (!auth.ok) {
  console.error("[hem-agent] راه‌اندازی متوقف شد — پیکربندی احراز هویت معتبر نیست:");
  console.error(`[hem-agent] ${auth.code}`);
  console.error(auth.message);
  process.exit(1);
}
let plan: AuthPlan = auth.plan;
if (plan.tokenGenerated) {
  plan = { ...plan, token: randomBytes(24).toString("hex") };
}
const token: string | undefined = plan.token;

// حالت open فقط روی loopback — در غیر این صورت شروع نمی‌شود (خطای روشن):
// HEM_AGENT_HOST نباید بتواند سرویسِ بی‌احراز هویتی روی شبکه بگذارد.
if (plan.mode === "open" && !isLoopbackHost(host)) {
  console.error("[hem-agent] راه‌اندازی متوقف شد — حالت open (بدون احراز هویت) فقط روی loopback مجاز است:");
  console.error(`[hem-agent] HEM_AGENT_HOST="${host}" یک آدرس شبکه‌ای است؛ سرویس بی‌احراز هویت روی شبکه شروع نمی‌شود.`);
  console.error("[hem-agent] برای دسترسی شبکه‌ای، HEM_AGENT_TOKEN را تنظیم کنید (و HEM_AGENT_AUTH را حذف کنید).");
  process.exit(1);
}
// حالت token روی آدرس شبکه‌ای = انتخاب آگاهانه — هشدار صریح، شروع ادامه می‌یابد:
if (plan.mode === "token" && !isLoopbackHost(host)) {
  console.warn(
    `[hem-agent] ⚠ سرویس روی آدرس شبکه‌ای "${host}" بایند می‌شود — مطمئن شوید توکن قوی/تصادفی است و ترافیک از طریق پروکسی معتمد/HTTPS می‌گذرد.`,
  );
}

const app = createApp({
  manager,
  profiles,
  secrets,
  audit,
  redactor,
  jobs,
  token,
  authMode: plan.mode,
  // uiDir فقط وقتی واقعاً موجود است سرو می‌شود؛ مسیر «مورد انتظار» همیشه
  // پاس داده می‌شود تا صفحهٔ خطا/لاگ دقیق بگوید کجا گشسته‌ایم (نه JSON مبهم).
  uiDir: uiExists ? uiDir : undefined,
  uiDirExpected: uiDir,
  version: AGENT_VERSION,
  startedAt: Date.now(),
});

const port = agentPort();
const uiUrl = `http://127.0.0.1:${port}/${token ? `?token=${token}` : ""}`;

// صداقت راه‌اندازی (v0.3.1 §1) + خطای روشن نبودِ UI: اگر ui/ کنار برنامه نیست،
// هرگز سکوت نمی‌کنیم — لاگ صریح چاپ می‌شود و GET / صفحهٔ خطای فارسیِ روشن
// می‌دهد (api.ts)، نه JSON مبهم. (باگ ویندوز v0.3.1 دقیقاً همین‌جا بی‌صدا رد شد.)
if (!uiExists) {
  console.error(`[hem-agent] UI NOT FOUND — expected ui/ at: ${uiDir}`);
  console.error(
    "[hem-agent] ⚠ بدون پوشهٔ ui/ کنار برنامه، رابط کاربری سرو نمی‌شود؛ GET / صفحهٔ خطای روشن می‌دهد (نه برنامه). " +
      "بستهٔ رسمی ZIP را «کامل» استخراج کنید — hem-manager.exe و ui/ و installer/ باید کنار هم بمانند؛ " +
      "EXE را از داخل پیش‌نمایش ZIP اجرا نکنید.",
  );
}
const rootStatus = installerRootStatus();
if (rootStatus.ok) {
  console.log(`[hem-agent] installer: ok (${rootStatus.source}) → ${rootStatus.path}`);
} else {
  console.log(
    `[hem-agent] installer: NOT FOUND (source: ${rootStatus.source}) — expected: ${rootStatus.path}`,
  );
  console.log(
    "[hem-agent] ⚠ بدون installer/ کنار برنامه، ویزارد نصب با خطای روشن متوقف می‌شود (هرگز موفق/آماده اعلام نمی‌شود). بستهٔ ویندوزی رسمی این پوشه را دارد؛ HEM_PROJECT_ROOT هم قابل تنظیم است.",
  );
}

const server = app.listen(port, host, () => {
  console.log(`[hem-agent] listening on http://${host}:${port} (home: ${home})`);
  console.log(
    `[hem-agent] version ${AGENT_VERSION} | platform ${process.platform} | ui: ${uiExists ? `served (${uiDir})` : `MISSING (expected ${uiDir})`}${plan.desktop ? " | mode: desktop" : ""} | auth: ${plan.mode}${plan.tokenGenerated ? " (generated for this run)" : plan.mode === "token" ? " (explicit HEM_AGENT_TOKEN)" : " (no-auth, loopback dev only)"}`,
  );
  if (plan.mode === "open") {
    console.warn(
      "[hem-agent] ⚠ حالت open فعال است: /api و WebSocket «بدون احراز هویت» روی همین loopback در دسترس‌اند. این حالت فقط برای توسعهٔ محلی است؛ در اجرای واقعی HEM_AGENT_TOKEN را تنظیم کنید.",
    );
  }
  if (plan.desktop) {
    if (plan.tokenGenerated) {
      console.log("[hem-agent] token: generated for this run (set HEM_AGENT_TOKEN to pin it)");
      console.log("[hem-agent] این نشانی یک‌بارمصرف است — پس از اولین بازشدن، لینک قدیمی (تاریخچهٔ مرورگر) دیگر معتبر نیست.");
    }
    // نشانی همیشه چاپ می‌شود — حتی اگر بازکردن مرورگر شکست بخورد.
    // (تنها محلِ چاپِ توکن: کنسولِ خودِ کاربر روی سیستم خودش — کانال تحویلِ
    // بوت‌استرپ دسکتاپ؛ در لاگ حسابرسی/پاسخ‌های API هرگز ظاهر نمی‌شود.)
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
attachEvents(io, manager, jobs, token, plan.mode);

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
