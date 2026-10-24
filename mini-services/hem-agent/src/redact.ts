// ابزار پاک‌سازی (redaction) — هیچ رمز/کلید کاملی هرگز در لاگ/audit نوشته نمی‌شود.
// الگوهای عمومی + اسرار ثبت‌شدهٔ صریح (رمز، passphrase، محتوای کلید خصوصی).

const PRIVATE_KEY_RE =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

// hskey-auth-XXXXXXXXXXXXXXXXXXXXXX-YYYY…  →  hskey-auth-XXXXX-***
const HSKEY_RE = /\bhskey-(auth|api)-([A-Za-z0-9_-]{0,5})[A-Za-z0-9_-]*-?[A-Za-z0-9_-]*\b/g;

// فرم از قبل ماسک‌شده (hskey-auth-XXX-***) — برای پایداری (idempotent) بودن پاک‌سازی
const HSKEY_MASKED_RE = /\bhskey-(auth|api)-[A-Za-z0-9_-]{0,5}-\*\*\*/g;
const MASK_PLACEHOLDER = "\u0000HEM-MASKED-";

// password=… / passphrase: … / token: … → مقدار ماسک می‌شود
const SECRET_ASSIGN_RE =
  /\b(password|passphrase|secret|token|api[_-]?key)\s*([:=])\s*\S+/gi;

/** آستانهٔ طول برای پذیرش یک رشته به‌عنوان «راز» (رشته‌های خیلی کوتاه ماسک نشوند) */
const MIN_SECRET_LEN = 6;

export function maskHsKey(fullKey: string): string {
  const m = /^hskey-(auth|api)-([A-Za-z0-9_-]{0,5})/.exec(fullKey);
  if (!m) return "***";
  return `hskey-${m[1]}-${m[2]}-***`;
}

export class Redactor {
  private secrets = new Set<string>();

  /** ثبت یک راز صریح (رمز، passphrase، کلید خصوصی، کلید کامل) برای ماسک کردن در لاگ‌ها */
  registerSecret(value?: string | null): void {
    if (typeof value !== "string") return;
    const v = value.trim();
    if (v.length < MIN_SECRET_LEN) return;
    this.secrets.add(v);
  }

  /** پاک‌سازی یک رشتهٔ متنی */
  redactText(input: string): string {
    let out = input.replace(PRIVATE_KEY_RE, "<PRIVATE-KEY-REDACTED>");
    // ۱) فرم‌های از قبل ماسک‌شده کنار گذاشته می‌شوند تا دوباره ماسک نشوند (خروجی تمیز و پایدار)
    const masked: string[] = [];
    out = out.replace(HSKEY_MASKED_RE, (m) => {
      masked.push(m);
      return `${MASK_PLACEHOLDER}${masked.length - 1}\u0000`;
    });
    out = out.replace(HSKEY_RE, (_m, kind: string, head: string) => `hskey-${kind}-${head}-***`);
    out = out.replace(new RegExp(`${MASK_PLACEHOLDER}(\\d+)\u0000`, "g"), (_m, i: string) => masked[Number(i)] ?? "");
    out = out.replace(SECRET_ASSIGN_RE, "$1$2***");
    for (const sec of this.secrets) {
      if (out.includes(sec)) out = out.split(sec).join("••••");
    }
    return out;
  }

  /** پاک‌سازی عمیق یک مقدار (شیء/آرایه/رشته) — بدون تغییر ساختار */
  redactValue<T>(value: T): T {
    if (typeof value === "string") return this.redactText(value) as unknown as T;
    if (Array.isArray(value)) return value.map((v) => this.redactValue(v)) as unknown as T;
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redactValue(v);
      }
      return out as unknown as T;
    }
    return value;
  }
}

/** پاک‌سازی سریع بدون ثبت راز (برای رشته‌های بی‌خطری که الگوی عمومی دارند) */
export function redactString(s: string): string {
  return new Redactor().redactText(s);
}
