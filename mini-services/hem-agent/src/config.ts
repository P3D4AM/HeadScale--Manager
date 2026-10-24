import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

/** نسخهٔ agent — هماهنگ با package.json (v0.3.1: اصلاحات پیش از انتشار) */
export const AGENT_VERSION = "0.3.1";

/** آدرس bind (فقط 127.0.0.1 در حالت عادی) */
export function agentHost(): string {
  return process.env.HEM_AGENT_HOST || "127.0.0.1";
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

/** true وقتی از داخل باینری کامپایل‌شده اجرا می‌شویم (fs مجازی bun) */
function inCompiledBinary(): boolean {
  return import.meta.dir.startsWith("/$bunfs");
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
  // در باینری کامپایل‌شده، سورس داخل $bunfs است — کاندید توسعه معنا ندارد.
  if (devSrc && !devSrc.startsWith("/$bunfs")) {
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
  if (inCompiledBinary()) {
    skipped.push({
      source: "dev",
      reason: "در باینری کامپایل‌شده، سورس داخل فایل‌سیستم مجازی bun (/$bunfs) است",
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
