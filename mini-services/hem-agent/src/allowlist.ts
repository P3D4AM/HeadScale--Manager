// allowlist کنسول (قرارداد §9) — بدون شل آزاد، الزام امنیتی محصول.
//  - توکنایز شل‌مانند (کوت/دابل‌کوت)؛ «نرمال‌سازی» رخ می‌دهد و رشتهٔ نهایی از argv اعتبارسنجی‌شده ساخته می‌شود
//  - هیچ کاراکتر متکار شل مجاز نیست: ; & | $ > < ` ( ) و بک‌اسلش
//  - ریشه‌های مجاز: headscale, hsctl, systemctl (فقط status/is-active), journalctl -u <unit> [-n N],
//    curl -s -m <t> <url> (میزبان: پروفایل/localhost/127.0.0.1), ufw status*, df -h, ss -tulpn
//  - خروجی preview: رشتهٔ argv دقیقی که اجرا می‌شود

import type { AllowlistContext, AllowlistResult } from "./types";
import { shellQuote } from "./ssh";

/** کاراکترهای ممنوع در ورودی خام */
const FORBIDDEN_CHARS = /[;&|$><`()\\\n\r]/;

/**
 * توکنایزر شل‌مانند: کوت‌شن '…' و "…" را پشتیبانی می‌کند؛ ورودی از قبل فاقد متکارهاست.
 * خروجی null یعنی کوت باز مانده (نامعتبر).
 */
export function tokenize(input: string): string[] | null {
  const tokens: string[] = [];
  let cur = "";
  let has = false;
  let i = 0;
  while (i < input.length) {
    const c = input[i];
    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      let closed = false;
      while (i < input.length) {
        if (input[i] === quote) {
          closed = true;
          i++;
          break;
        }
        cur += input[i++];
      }
      if (!closed) return null;
      has = true;
      continue;
    }
    if (c === " " || c === "\t") {
      if (has) {
        tokens.push(cur);
        cur = "";
        has = false;
      }
      i++;
      continue;
    }
    cur += c;
    i++;
    has = true;
  }
  if (has) tokens.push(cur);
  return tokens;
}

const UNIT_NAME_RE = /^[A-Za-z0-9_.@:-]+$/;
const WORD_RE = /^[a-z]+$/;
const NUM_RE = /^\d+$/;
const ROUTE_RE = /^[0-9a-fA-F:.\/]+$/;

function isAllowedHost(hostname: string, ctx: AllowlistContext): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return true;
  if (ctx.host && h === ctx.host.toLowerCase()) return true;
  return false;
}

function parseUrlHost(url: string): { scheme: string; hostname: string } | null {
  try {
    const u = new URL(url);
    return { scheme: u.protocol.replace(":", ""), hostname: u.hostname };
  } catch {
    return null;
  }
}

function deny(reason: string, argv: string[]): AllowlistResult {
  return { allowed: false, reason, exactCommand: "", argv };
}

/** بررسی یک دستور کنسول در برابر allowlist و ساخت رشتهٔ دقیق اجرا */
export function checkCommand(rawCmd: string, ctx: AllowlistContext = {}): AllowlistResult {
  const raw = typeof rawCmd === "string" ? rawCmd.trim() : "";
  if (raw.length === 0) {
    return deny("دستور خالی است.", []);
  }
  if (raw.length > 2000) {
    return deny("دستور بیش از حد بلند است.", []);
  }
  if (FORBIDDEN_CHARS.test(raw)) {
    return deny(
      "کاراکترهای پوسته (؛ & | $ > < ` ( ) \\) در کنسول مجاز نیستند — دستور باید یک فرمان ساده باشد.",
      [],
    );
  }
  const argv = tokenize(raw);
  if (!argv || argv.length === 0) {
    return deny("دستور قابل تجزیه نبود (کوت باز؟).", []);
  }

  const [prog, ...rest] = argv;

  const ok = (allowedArgv: string[] = argv): AllowlistResult => ({
    allowed: true,
    exactCommand: allowedArgv.map(shellQuote).join(" "),
    argv: allowedArgv,
  });

  switch (prog) {
    case "headscale":
      // ریشهٔ headscale مجاز است؛ آرگومان‌ها به CLI رسمی می‌روند (عملیات مخرب در لایهٔ API نیازمند confirm هستند)
      if (rest.length === 0) return deny("زیرفرمان headscale الزامی است.", argv);
      return ok();

    case "hsctl":
      if (rest.length === 0) return deny("زیرفرمان hsctl الزامی است.", argv);
      return ok();

    case "systemctl": {
      const [sub, unit] = rest;
      if (sub !== "status" && sub !== "is-active" && sub !== "is-enabled") {
        return deny("systemctl فقط با زیرفرمان‌های status / is-active / is-enabled مجاز است.", argv);
      }
      if (unit === undefined || !UNIT_NAME_RE.test(unit)) {
        return deny("نام سرویس نامعتبر است.", argv);
      }
      return ok();
    }

    case "journalctl": {
      if (rest[0] !== "-u" || rest[1] === undefined || !UNIT_NAME_RE.test(rest[1])) {
        return deny("قالب مجاز: journalctl -u <unit> [-n N] [--no-pager]", argv);
      }
      const maybe = rest.slice(2).filter((t) => t !== "--no-pager");
      if (maybe.length === 0) return ok();
      if (maybe.length === 2 && maybe[0] === "-n" && NUM_RE.test(maybe[1]) && Number(maybe[1]) <= 1000) {
        return ok();
      }
      return deny("قالب مجاز: journalctl -u <unit> [-n N] [--no-pager]", argv);
    }

    case "curl": {
      // curl -s -m <t> <url> — طرح http/https و میزبان مجاز
      const flags: string[] = [];
      let url = "";
      for (let i = 0; i < rest.length; i++) {
        const t = rest[i];
        if (t === "-s" || t === "--silent") {
          flags.push("s");
        } else if (t === "-m" || t === "--max-time") {
          const v = rest[++i];
          if (v === undefined || !NUM_RE.test(v) || Number(v) > 30) {
            return deny("مهلت curl (-m) باید عددی حداکثر ۳۰ ثانیه باشد.", argv);
          }
          flags.push("m");
        } else if (t.startsWith("-")) {
          return deny(`سوئیچ curl مجاز نیست: ${t} (فقط -s و -m)`, argv);
        } else {
          if (url !== "") return deny("فقط یک URL مجاز است.", argv);
          url = t;
        }
      }
      if (!flags.includes("s") || !flags.includes("m")) {
        return deny("curl فقط به شکل «curl -s -m <ثانیه> <url>» مجاز است.", argv);
      }
      const parsed = parseUrlHost(url);
      if (!parsed || (parsed.scheme !== "http" && parsed.scheme !== "https")) {
        return deny("URL باید http یا https باشد.", argv);
      }
      if (!isAllowedHost(parsed.hostname, ctx)) {
        return deny("میزبان URL مجاز نیست — فقط میزبان پروفایل، localhost و 127.0.0.1.", argv);
      }
      return ok();
    }

    case "ufw": {
      const [sub, ...extra] = rest;
      if (sub !== "status") {
        return deny("ufw فقط با status مجاز است.", argv);
      }
      for (const t of extra) {
        if (!WORD_RE.test(t)) return deny("آرگومان ufw status نامعتبر است.", argv);
      }
      return ok();
    }

    case "df": {
      if (rest.length === 1 && rest[0] === "-h") return ok();
      return deny("قالب مجاز: df -h", argv);
    }

    case "ss": {
      if (rest.length === 1 && rest[0] === "-tulpn") return ok();
      return deny("قالب مجاز: ss -tulpn", argv);
    }

    default:
      return deny(`برنامهٔ «${prog}» در allowlist کنسول نیست.`, argv);
  }
}

/** پیش‌نمایش — برای POST /api/s/:sid/console/preview */
export function previewCommand(rawCmd: string, ctx: AllowlistContext = {}): AllowlistResult {
  return checkCommand(rawCmd, ctx);
}

/** اعتبارسنجی مسیر/CIDR برای آرگومان‌های مسیر (استفادهٔ داخلی آداپتورها) */
export function isValidRoute(r: string): boolean {
  return ROUTE_RE.test(r) && r.length <= 45;
}
