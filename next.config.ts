import type { NextConfig } from "next";

/**
 * پیکربندی بیلد — اصلاح ایراد ۴.۱۰ ممیزی (AUDIT-2025-10 §1):
 *
 * - `output: "export"`: این محصول یک صفحهٔ hash-routed است که به‌صورت static
 *   export ساخته و داخل بستهٔ ویندوز (hem-agent) embed می‌شود؛ سرور Node در
 *   کار نیست (هر دادهٔ زنده از طریق درخواست‌های مرورگر به hem-agent با
 *   XTransformPort می‌آید، نه از Route Handlerهای Next).
 * - `typescript.ignoreBuildErrors` حذف شد: بیلد باید تایپ‌ها را واقعاً بررسی
 *   کند (پیش‌تر خطاهای واقعی پنهان می‌شد). گیت‌های واقعی: `bunx tsc --noEmit`
 *   و `bun run lint` — هر دو بخش الزامی scripts/release.sh هستند.
 * - `eslint.ignoreDuringBuilds` هرگز فعال نیست؛ lint واقعی با `bun run lint`
 *   اجرا می‌شود (Next 16 در زمان build اصلاً lint اجرا نمی‌کند).
 * - next/image استفاده نمی‌شود (فونت با <link> ساده از layout بار می‌شود)؛
 *   اگر در آینده اضافه شد، `images: { unoptimized: true }` لازم است.
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: false,
};

export default nextConfig;
