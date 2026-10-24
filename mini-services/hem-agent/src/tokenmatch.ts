// مقایسهٔ امن توکن (v0.3.1 §4) — timing-safe برای هدر X-HEM-Token و کوکی hem_token.
// طول متفاوت فوراً false می‌دهد (افشای طول تهدید عملی نیست؛ مقدار هرگز چاپ نمی‌شود).

import { timingSafeEqual } from "node:crypto";

/** آیا دو رشتهٔ توکن از نظر زمان-ثابت برابرند؟ (طول متفاوت → false) */
export function timingSafeTokenMatch(provided: string | undefined, expected: string | undefined): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  if (provided.length === 0 || expected.length === 0) return false;
  if (provided.length !== expected.length) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return timingSafeEqual(a, b);
}
