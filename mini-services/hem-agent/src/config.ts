import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { inCompiledBinary } from "./exepath";

/** نسخهٔ agent — هماهنگ با package.json (v0.3.2: رفع باگ UI ویندوزی) */
export const AGENT_VERSION = "0.3.2-beta.1"; // پیش‌انتشار توسعه (develop) — شاخهٔ پایدار: main

/** آدرس bind (پیش‌فرض loopback — دسترسی شبکه‌ای باید آگاهانه و با توکن باشد) */
export function agentHost(): string {
  return process.env.HEM_AGENT_HOST || "127.0.0.1";
}

/** آیا آدرس bind فقط loopback است؟ (127.x / localhost / ::1 — حالت open فقط اینجا مجاز است) */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (h === "localhost" || h === "::1" || h === "[::1]") return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/** پورت پیش‌فرض ۳۰۰۵ — از طریق دروازه با ?XTransformPort=3005 قابل دسترسی است */
export function agentPort(): number {
  const p = Number(process.env.HEM_AGENT_PORT || 3005);
  if (!Number.isInteger(p) || p <= 0 || p > 65535) return 3005;
  return p;
}

/** پوشهٔ خانهٔ agent — پروفایل‌ها، known_hosts، لاگ حسابرسی و اسرار (حالت توسعه) */
export function agentHome(): string {
  return process.env.HEM_AGENT_HOME || path.join(homedir(), ".hem-agent");
}

/** توکن اختیاری X-HEM-Token (حالت دسکتاپ) */
export function agentToken(): string | undefined {
  const t = process.env.HEM_AGENT_TOKEN;
  return t && t.length > 0 ? t : undefined;
}

// ---------------------------------------------------------------------------
// سیاست احراز هویت (v0.3.2 §2 — اصلاح امنیتی «عبور بدون توکن»)
//
// باگ: قبلاً اگر HEM_AGENT_TOKEN تنظیم نشده بود، middleware مربوط به /api
// درخواست را «بدون احراز هویت» عبور می‌داد و WebSocket هم بی‌دفاع بود؛ یعنی
// نبودن توکن یعنی سرویسِ باز — دقیقاً برعکسِ رفتار امن (fail-closed).
//
// مدل جدید — سه حالتِ صریح:
//   • token: همهٔ /api (به‌جز health عمومیِ حداقلی) و همهٔ WebSocketها به
//     هدر X-HEM-Token یا کوکی hem_token نیاز دارند (timing-safe).
//   • open:  استثنای «مستند و محدودِ» توسعهٔ محلی — فقط با تنظیم صریح
//     HEM_AGENT_AUTH=open و فقط روی آدرس loopback؛ در غیر این صورت
//     راه‌اندازی با خطای روشن متوقف می‌شود.
//   • حالت بدون توکن و بدون صراحت: سرویس «شروع نمی‌شود» (exit غیرصفر با
//     پیام فارسی قابل‌فهم). لایهٔ API هم دفاعی 503 AUTH_NOT_CONFIGURED
//     می‌دهد (defense-in-depth برای فراخوانی مستقیم createApp در تست‌ها).
//
// حالت دسکتاپ همیشه توکن‌دار است: توکن صریح، یا تولید تصادفیِ امنِ همان
// اجرا (randomBytes(24)) — هرگز حالت open.
// ---------------------------------------------------------------------------

export type AgentAuthMode = "token" | "open";

export interface AuthPlan {
  mode: AgentAuthMode;
  /** توکن فعال در حالت token (صریح یا تولیدشده برای همین اجرا) */
  token?: string;
  /** true = توکنِ تولیدشدهٔ همین اجرا (فقط دسکتاپ) */
  tokenGenerated: boolean;
  desktop: boolean;
}

export interface AuthPlanInput {
  /** مقدار HEM_AGENT_AUTH (اختیاری — خالی یعنی تنظیم نشده) */
  auth?: string;
  /** مقدار HEM_AGENT_TOKEN (اختیاری — خالی یعنی تنظیم نشده) */
  token?: string;
  desktop: boolean;
}

export type AuthPlanResult = { ok: true; plan: AuthPlan } | { ok: false; code: string; message: string };

/** اعتبارسنجی سیاست — تابع خالص و قابل تست؛ همهٔ ترکیب‌ها صریح و بی‌ابهام */
export function resolveAuthPlan(input: AuthPlanInput): AuthPlanResult {
  const auth = (input.auth ?? "").trim().toLowerCase();
  const token = input.token && input.token.length > 0 ? input.token : undefined;

  // مقدار نامعتبر HEM_AGENT_AUTH — هر چیزی به‌جز token/open رد می‌شود
  if (auth && auth !== "token" && auth !== "open") {
    return {
      ok: false,
      code: "AUTH_INVALID_POLICY",
      message:
        `مقدار HEM_AGENT_AUTH="${input.auth}" معتبر نیست. مقدارهای مجاز: token یا open ` +
        "(یا اصلاً تنظیم نکنید تا با HEM_AGENT_TOKEN کار کند).",
    };
  }

  if (auth === "open") {
    if (input.desktop) {
      return {
        ok: false,
        code: "AUTH_DESKTOP_REQUIRES_TOKEN",
        message:
          "حالت دسکتاپ همیشه با توکن کار می‌کند (صریح یا تولیدشده برای همین اجرا) و حالت open با آن سازگار نیست. " +
          "HEM_AGENT_AUTH را حذف کنید.",
      };
    }
    if (token) {
      return {
        ok: false,
        code: "AUTH_OPEN_WITH_TOKEN",
        message:
          "HEM_AGENT_AUTH=open با HEM_AGENT_TOKEN هم‌زمان تنظیم شده‌اند — ترکیب مبهم است. " +
          "برای احراز هویت، HEM_AGENT_AUTH را حذف کنید؛ برای توسعهٔ محلیِ بدون توکن، HEM_AGENT_TOKEN را حذف کنید.",
      };
    }
    return { ok: true, plan: { mode: "open", token: undefined, tokenGenerated: false, desktop: false } };
  }

  if (auth === "token" && !token && !input.desktop) {
    return {
      ok: false,
      code: "AUTH_TOKEN_MISSING",
      message:
        "HEM_AGENT_AUTH=token تنظیم شده اما HEM_AGENT_TOKEN خالی است. توکن را تنظیم کنید " +
        "یا HEM_AGENT_AUTH را حذف کنید.",
    };
  }

  // auth = "token" یا تنظیم‌نشده → سیاست token؛ توکن صریح یا (دسکتاپ) تولیدی
  if (token || input.desktop) {
    return { ok: true, plan: { mode: "token", token, tokenGenerated: !token && input.desktop, desktop: input.desktop } };
  }

  // هیچ توکنی نیست و صریحاً open هم نخواسته‌اند → شروع نمی‌کنیم (fail-closed)
  return {
    ok: false,
    code: "AUTH_NOT_CONFIGURED",
    message:
      "هیچ توکنی تنظیم نشده است؛ سرویس بدون احراز هویت شروع نمی‌شود.\n" +
      "  • برای اجرای واقعی: HEM_AGENT_TOKEN را با یک رمز تصادفی بلند تنظیم کنید.\n" +
      "  • فقط برای توسعهٔ محلی (loopback): HEM_AGENT_AUTH=open را صریح تنظیم کنید — " +
      "این حالت بدون احراز هویت و فقط روی 127.0.0.1 اجرا می‌شود.",
  };
}

/** مقدار HEM_AGENT_AUTH از محیط (بدون اعتبارسنجی — اعتبارسنجی در resolveAuthPlan) */
export function agentAuthPolicy(): string | undefined {
  const v = process.env.HEM_AGENT_AUTH;
  return v && v.trim().length > 0 ? v : undefined;
}

/**
 * حالت دسکتاپ/ویندوزی: HEM_DESKTOP=1 یا فلگ --desktop.
 * رفتار: اگر HEM_AGENT_TOKEN تنظیم نشده باشد، یک توکن تصادفی یک‌بارِ این اجرا
 * ساخته می‌شود، نشانی UI با ?token= چاپ می‌شود و مرورگر پیش‌فرض باز می‌شود
 * (index.ts). API توکن را از هدر X-HEM-Token «یا» کوکی hem_token می‌پذیرد
 * (api.ts) — تا UI بدون هیچ تغییری در حالت دسکتاپ کار کند.
 */
export function desktopMode(): boolean {
  return process.env.HEM_DESKTOP === "1" || process.argv.includes("--desktop");
}

// ---------------------------------------------------------------------------
// ریشهٔ مخزن پایتونِ نصب‌کننده (منبع واحد نصب) — زنجیرهٔ حل (v0.3.1 §1):
//   ۱) HEM_PROJECT_ROOT صریح (برای تست/CI) — هرچه تنظیم شده، همان؛
//   ۲) بستهٔ packaged: <پوشهٔ فایل اجرایی>/installer — exe ویندوزی و باینری
//      لینوکسی هر دو این چیدمان را از build-windows.sh می‌گیرند؛ در حالت
//      توسعهٔ با bun، process.execPath خودِ bun است و کنارش installer/ نیست
//      → طبیعتاً به مرحلهٔ بعد می‌افتد؛
//   ۳) checkout توسعه: نسبت به محل همین فایل منبع (سه پوشه بالاتر) — فقط
//      هنگام اجرا از سورس معقول است؛ در باینری کامپایل‌شده import.meta.dir
//      داخل فایل‌سیستم مجازی bun (/$bunfs) است و این کاندید رد می‌شود.
//   هیچ «مسیر پیش‌فرضِ توسعه‌دهنده»ای وجود ندارد. اگر هیچ کاندید معتبری نبود،
//   «انتظارِ packaged» برگردانده می‌شود تا خطای تماس‌گیرنده همان مسیر را
//   شامل باشد — توقف صادقانه، بدون fallback و بدون ادعای آماده بودن.
// ---------------------------------------------------------------------------

/** نام فایل مرجع — مخزنِ بدون install.sh معتبر نیست */
const INSTALL_MARKER = "install.sh";

/** پوشهٔ فایل اجرایی — در حالت توسعهٔ با bun، پوشهٔ خودِ باینری bun است */
function processExeDir(): string {
  return path.dirname(process.execPath);
}

/** true وقتی از داخل باینری کامپایل‌شده اجرا می‌شویم (fs مجازی bun — $bunfs در هر دو پلتفرم) */
function inCompiledBinaryRun(): boolean {
  return inCompiledBinary(import.meta.dir);
}

export type InstallerRootCandidateSource = "env" | "packaged" | "dev";

export interface InstallerRootCandidate {
  source: InstallerRootCandidateSource;
  path: string;
}

/**
 * فهرست مرتبِ کاندیدها به‌صورت «خالص» و قابل تست — ورودی‌های ساختگی می‌گیرد؛
 * مقدار undefined/خالی یعنی «آن کاندید اصلاً در نظر گرفته نشود».
 * ترتیب همیشه: env، سپس packaged، سپس dev.
 */
export function installerRootCandidates(
  explicit?: string,
  exeDir?: string,
  srcDir?: string,
): InstallerRootCandidate[] {
  const list: InstallerRootCandidate[] = [];
  const env = (explicit ?? "").trim();
  if (env) list.push({ source: "env", path: path.resolve(env) });
  if (exeDir) list.push({ source: "packaged", path: path.join(exeDir, "installer") });
  const devSrc = (srcDir ?? "").trim();
  // در باینری کامپایل‌شده، سورس داخل fs مجازی bun ($bunfs) است — کاندید توسعه
  // معنا ندارد. تشخیص عضویت «$bunfs» است، نه پیشوند پوزیکس (باگ ویندوزی v0.3.1:
  // C:\$bunfs\root با startsWith("/$bunfs") رد نمی‌شد و کاندید بی‌معنای dev می‌ساخت).
  if (devSrc && !inCompiledBinary(devSrc)) {
    list.push({ source: "dev", path: path.resolve(devSrc, "..", "..", "..", "headscale-easy-manager") });
  }
  return list;
}

export type InstallerRootSource = "env" | "packaged" | "dev" | "none";

export interface InstallerRootTry {
  source: InstallerRootCandidateSource;
  path: string;
  exists: boolean;
}

export interface InstallerRootSkipped {
  source: InstallerRootCandidateSource;
  reason: string;
}

export interface InstallerRootStatus {
  ok: boolean;
  /** مسیر انتخاب‌شده؛ در حالت ناکام = «انتظارِ packaged» (برای پیام خطا) */
  path: string;
  source: InstallerRootSource;
  /** همهٔ کاندیدهای بررسی‌شده با نتیجهٔ وجود install.sh */
  tried: InstallerRootTry[];
  /** کاندیدهایی که اصلاً بررسی نشدند و چرا (امروز فقط dev در باینری کامپایل‌شده) */
  skipped: InstallerRootSkipped[];
}

/**
 * حل‌کنندهٔ قابل تست: نخستین کاندیدی که install.sh دارد برنده است؛ اگر هیچ‌کدام
 * نبود، ok=false و path = همان «انتظارِ packaged» (یا آخرین کاندید) است.
 */
export function resolveInstallerRoot(
  candidates: InstallerRootCandidate[],
  skipped: InstallerRootSkipped[] = [],
): InstallerRootStatus {
  const tried: InstallerRootTry[] = [];
  let chosen: InstallerRootTry | null = null;
  for (const c of candidates) {
    const exists = fs.existsSync(path.join(c.path, INSTALL_MARKER));
    const t: InstallerRootTry = { source: c.source, path: c.path, exists };
    tried.push(t);
    if (chosen === null && exists) chosen = t;
  }
  const packagedPath = candidates.find((c) => c.source === "packaged")?.path;
  const fallback = packagedPath ?? tried[tried.length - 1]?.path ?? "";
  if (chosen) return { ok: true, path: chosen.path, source: chosen.source, tried, skipped };
  return { ok: false, path: fallback, source: "none", tried, skipped };
}

/** وضعیت واقعیِ همین اجرا — برای پیام‌های خطای غنی و UX. */
export function installerRootStatus(): InstallerRootStatus {
  const skipped: InstallerRootSkipped[] = [];
  if (inCompiledBinaryRun()) {
    skipped.push({
      source: "dev",
      reason: "در باینری کامپایل‌شده، سورس داخل فایل‌سیستم مجازی bun ($bunfs) است",
    });
  }
  return resolveInstallerRoot(
    installerRootCandidates(process.env.HEM_PROJECT_ROOT, processExeDir(), import.meta.dir),
    skipped,
  );
}

/**
 * ریشهٔ مخزن پایتونِ نصب‌کننده (منبع واحد نصب) — برای prepare/تاربال.
 * رفتار: مسیر معتبرِ حل‌شده؛ اگر هیچ کاندید معتبری نبود، «انتظارِ packaged».
 */
export function projectRoot(): string {
  return installerRootStatus().path;
}

/**
 * پیام فارسیِ غنی برای «مخزن نصب‌کننده پیدا نشد» — همهٔ مسیرهای بررسی‌شده
 * با نتیجهٔ وجودشان فهرست می‌شوند؛ توقف صادقانه، هیچ ادعای آماده/موفق نیست.
 */
export function installerRootErrorMessage(status: InstallerRootStatus): string {
  const envT = status.tried.find((t) => t.source === "env");
  const pkgT = status.tried.find((t) => t.source === "packaged");
  const devT = status.tried.find((t) => t.source === "dev");
  const devSkipped = status.skipped.find((s) => s.source === "dev");
  const note = (t?: InstallerRootTry): string => (t ? `${t.path}${t.exists ? "" : " — install.sh نیست"}` : "");
  const lines: string[] = [
    "مخزن نصب‌کننده پیدا نشد — ویزارد نصب متوقف می‌شود (هرگز «آماده» اعلام نمی‌شود).",
    "مسیرهای بررسی‌شده:",
    `  ۱) HEM_PROJECT_ROOT: ${envT ? note(envT) : "تنظیم نشده"}`,
    `  ۲) کنار فایل اجرایی: ${pkgT ? note(pkgT) : "در دسترس نیست"}`,
    `  ۳) checkout توسعه: ${devT ? note(devT) : (devSkipped?.reason ?? "در دسترس نیست")}`,
    "راه‌حل: بستهٔ ویندوزی باید پوشهٔ installer/ را کنار hem-manager.exe داشته باشد (build-windows.sh آن را می‌سازد)؛ یا HEM_PROJECT_ROOT را صریح تنظیم کنید.",
    `مسیر مورد انتظار بسته (packaged): ${status.path}`,
  ];
  return lines.join("\n");
}
