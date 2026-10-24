import { homedir } from "node:os";
import * as path from "node:path";

/** نسخهٔ agent — هماهنگ با package.json (v0.3.0: بستهٔ ویندوزی + فصل ۱۵) */
export const AGENT_VERSION = "0.3.0";

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

/** ریشهٔ مخزن پایتونِ نصب‌کننده (منبع واحد نصب) — برای prepare/تاربال */
export function projectRoot(): string {
  return process.env.HEM_PROJECT_ROOT || "/home/z/my-project/headscale-easy-manager";
}
