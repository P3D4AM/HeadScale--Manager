// exepath — تشخیص محیط اجرا و «پوشهٔ کنار برنامه» — واحد مشترک index.ts و config.ts.
//
// باگ v0.3.1 (ویندوز): نشانگر فایل‌سیستم مجازی باندل bun در باینری کامپایل‌شده
// روی هر دو پلتفرم «$bunfs» است، اما فقط روی پوزیکس پیشوند مطلق «/» دارد:
//   لینوکس:  /$bunfs/root/…
//   ویندوز:  C:\$bunfs\root\…   (حرف درایو + بک‌اسلش)
// بررسی قدیمیِ startsWith("/$bunfs") روی ویندوز false می‌شد ← exeDir به fs مجازی
// اشاره می‌کرد ← ui/ پیدا نمی‌شد ← GET / به‌جای UI، JSON مبهم سلامت می‌داد.
// راه‌حل: membership («شامل $bunfs بودن») به‌جای پیشوند مطلق پوزیکس.

import * as path from "node:path";

/** نشانگر fs مجازی باندل bun در باینری کامپایل‌شده — رشتهٔ ثابت bun روی هر دو پلتفرم */
const BUNFS_MARKER = "$bunfs";

/**
 * true وقتی مسیر سورسِ فعلی داخل فایل‌سیستم مجازی bun است — یعنی از داخل
 * باینری کامپایل‌شده (exe ویندوزی / باینری لینوکسی) اجرا می‌شویم.
 * خالص و قابل تست: مسیر را می‌گیرد، محیط واقعی را نمی‌خواند.
 */
export function inCompiledBinary(importMetaDir: string): boolean {
  return importMetaDir.includes(BUNFS_MARKER);
}

/**
 * «پوشهٔ کنار فایل اجرایی برنامه» — جایی که ui/ و installer/ بستهٔ رسمی قرار دارند:
 *   • باینری کامپایل‌شده: dirname(process.execPath) — مسیر «واقعی» خود فایل اجرایی؛
 *     در باینری کامپایل‌شده import.meta.dir به fs مجازی bun اشاره می‌کند و ui/
 *     هرگز آنجا نیست (ui/ کنار exe بسته‌بندی می‌شود، نه داخل آن).
 *   • حالت توسعه با bun: همان پوشهٔ سورس (index.ts) — process.execPath خودِ bun
 *     است و کنارش چیزی از این برنامه نیست.
 *
 * dirname باید با سبک مسیرِ execPath هم‌خوان باشد (ویندوز: بک‌اسلش/حرف درایو؛
 * پوزیکس: اسلش) — تشخیص از خود رشته، تا در تست‌ها روی هر میزبان قابل شبیه‌سازی
 * باشد و در اجرای واقعی با path پیش‌فرض پلتفرم یکی باشد.
 */
export function programDir(importMetaDir: string, execPath: string = process.execPath): string {
  if (!inCompiledBinary(importMetaDir)) return importMetaDir;
  const dirname = execPath.includes("\\") ? path.win32.dirname : path.dirname;
  return dirname(execPath);
}
