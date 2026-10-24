import type { ErrorCode } from "./types";

/** پیام‌های فارسی پیش‌فرض برای کدهای خطا */
export const FA_MESSAGES: Record<ErrorCode, string> = {
  AUTH_FAILED: "احراز هویت ناموفق بود — رمز عبور یا کلید خصوصی نامعتبر است.",
  CONNECT_TIMEOUT: "اتصال به سرور در زمان مجاز برقرار نشد.",
  CONNECT_FAILED: "اتصال به سرور برقرار نشد.",
  HOSTKEY_CHANGED:
    "⚠️ هشدار امنیتی: کلید میزبان سرور تغییر کرده است! پیش از ادامه، علت این تغییر را بررسی کنید. برای نادیده گرفتن، ابتدا کلید ذخیره‌شده را فراموش کنید.",
  FINGERPRINT_REQUIRED:
    "ابتدا اثرانگشت کلید میزبان سرور را بررسی و تأیید کنید (TOFU).",
  NOT_CONNECTED: "نشست SSH متصل نیست یا یافت نشد.",
  EXEC_FAILED: "اجرای دستور روی سرور ناموفق بود.",
  PARSE_FAILED: "خروجی سرور قابل تفسیر نبود.",
  NEED_CONFIRM:
    "این عملیات مخرب است و نیازمند تأیید صریح است: در بدنهٔ درخواست «confirm: true» بفرستید.",
  UNSUPPORTED: "این قابلیت روی این سرور/حالت پشتیبانی نمی‌شود.",
  SUDO_REQUIRED:
    "برای این عملیات دسترسی sudo لازم است اما در دسترس نیست (رمز یا sudo بدون رمز).",
  VALIDATION_FAILED: "ورودی درخواست نامعتبر است.",
  COMMAND_BLOCKED: "این دستور مجاز نیست (سیاست allowlist کنسول).",
  UNAUTHORIZED: "توکن X-HEM-Token موجود یا معتبر نیست.",
  FORBIDDEN: "دسترسی مجاز نیست.",
  NOT_FOUND: "مورد درخواستی یافت نشد.",
  NOT_IMPLEMENTED_YET: "این بخش هنوز پیاده‌سازی نشده است.",
  NOT_AVAILABLE: "hsctl روی سرور نصب نیست — پس از نصب اولیه در دسترس است.",
  INTERNAL: "خطای داخلی agent رخ داد.",
};

/** نگاشت کد خطا به وضعیت HTTP */
export function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "AUTH_FAILED":
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NEED_CONFIRM":
    case "VALIDATION_FAILED":
    case "COMMAND_BLOCKED":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "UNSUPPORTED":
    case "NOT_IMPLEMENTED_YET":
      return 501;
    case "NOT_AVAILABLE":
      return 503;
    case "HOSTKEY_CHANGED":
    case "NOT_CONNECTED":
      return 409;
    case "CONNECT_TIMEOUT":
      return 504;
    case "CONNECT_FAILED":
      return 502;
    case "FINGERPRINT_REQUIRED":
      return 409;
    case "EXEC_FAILED":
    case "PARSE_FAILED":
    case "INTERNAL":
    default:
      return 500;
  }
}

/** خطای تایپ‌شدهٔ agent — همه‌جا فقط همین پرتاب می‌شود */
export class HemError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly detail?: unknown;

  constructor(code: ErrorCode, messageFa?: string, detail?: unknown) {
    super(messageFa ?? FA_MESSAGES[code]);
    this.name = "HemError";
    this.code = code;
    this.httpStatus = statusForCode(code);
    this.detail = detail;
  }
}

export function isHemError(e: unknown): e is HemError {
  return e instanceof HemError;
}
