// startuplog — لاگ تشخیصیِ راه‌اندازی (v0.3.2-beta.2 — «بسته‌شدن سریع EXE»).
//
// چرا: تا این نسخه، اگر راه‌اندازی شکست می‌خورد (پیکربندی احراز هویت، اشغال
// بودن پورت، نبود ui/، خطای فایل‌سیستم، …) تنها خروجیِ لحظه‌ایِ کنسول نوشته
// می‌شد و با بسته‌شدن پنجره، شاهدیه از بین می‌رفت. این لاگ فایل‌محور است:
//
//   • مسیرِ مشخص و پایدار: <home>/logs/hem-agent.log
//     (ویندوز: %USERPROFILE%\.hem-agent\logs\hem-agent.log — قابل تنظیم با HEM_AGENT_HOME)
//   • هر رکورد یک خط JSON است: ts / level / phase / event / code? / detail? / stack?
//   • «زمان، مرحلهٔ راه‌اندازی، نوع خطا و Stack Trace» — خواستهٔ مستقیم گزارش باگ.
//   • چرخش حجم: سقف ۲۵۶KB — نسخهٔ قبلی به hem-agent.log.1 منتقل می‌شود (یک نسل).
//   • هر رشته از Redactor می‌گذرد (token=***، password=***، کلید خصوصی، …).
//     توکن دسکتاپ و نشانی بوت‌استرپ (?token=…) «هیچ‌وقت» به این فایل نوشته
//     نمی‌شوند — تنها کانال تحویل بوت‌استرپ، همان خط کنسول است (index.ts).
//   • شکستِ خودِ لاگ هرگز برنامه را نمی‌کشد (best-effort، try/catch).
//
// این ماژول «قابل تست» است: createStartupLog(homeDir, redactor) و ابزار
// readEntries برای تست‌ها.

import * as fs from "node:fs";
import * as path from "node:path";
import { Redactor } from "./redact";

const MAX_BYTES = 256 * 1024;
const GENERATION_SUFFIX = ".1";

export interface StartupEventExtra {
  code?: string;
  detail?: string;
  stack?: string;
}

export interface StartupLog {
  /** مسیر کامل فایل لاگ — در پیام‌های خطا به کاربر هم چاپ می‌شود */
  readonly logPath: string;
  /** رخداد عادی راه‌اندازی (level=info) */
  event(phase: string, event: string, extra?: StartupEventExtra): void;
  /** رخداد هشدار (level=warn) */
  warn(phase: string, event: string, extra?: StartupEventExtra): void;
  /** خطای مهلک — level=error؛ شناسهٔ خطا + پیام + Stack Trace اگر باشد */
  fatal(code: string, message: string, err?: unknown): void;
  /** آیا تاکنون خطای مهلکی ثبت شده؟ (برای تصمیم خروج در index.ts) */
  hasFatal(): boolean;
}

export interface StartupLogEntry {
  ts: string;
  level: "info" | "warn" | "error";
  phase: string;
  event: string;
  code?: string;
  detail?: string;
  stack?: string;
}

function stackOf(err: unknown): string | undefined {
  if (err instanceof Error && typeof err.stack === "string" && err.stack.length > 0) {
    return err.stack;
  }
  return undefined;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** ساخت لاگ تشخیصی برای «همین اجرا» — homeDir معمولاً agentHome() است */
export function createStartupLog(homeDir: string, redactor: Redactor): StartupLog {
  const logsDir = path.join(homeDir, "logs");
  const logPath = path.join(logsDir, "hem-agent.log");
  let fatalCount = 0;

  const safe = (s: string): string => redactor.redactText(s);

  const rotateIfNeeded = (): void => {
    try {
      if (!fs.existsSync(logPath)) return;
      const size = fs.statSync(logPath).size;
      if (size < MAX_BYTES) return;
      const old = `${logPath}${GENERATION_SUFFIX}`;
      try {
        if (fs.existsSync(old)) fs.rmSync(old);
      } catch {
        /* نگه‌داشتن نسل قبلی مهم نیست */
      }
      fs.renameSync(logPath, old);
    } catch {
      /* چرخش نبود؟ همان فایل ادامه می‌یابد — مهم نیست */
    }
  };

  const append = (entry: StartupLogEntry): void => {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      rotateIfNeeded();
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* لاگِ لاگ نمی‌نویسیم — best-effort */
    }
  };

  const make = (level: StartupLogEntry["level"]) => (phase: string, event: string, extra?: StartupEventExtra): void => {
    const entry: StartupLogEntry = {
      ts: new Date().toISOString(),
      level,
      phase: safe(phase),
      event: safe(event),
    };
    if (extra?.code !== undefined) entry.code = safe(extra.code);
    if (extra?.detail !== undefined) entry.detail = safe(extra.detail);
    if (extra?.stack !== undefined) entry.stack = safe(extra.stack);
    append(entry);
  };

  return {
    logPath,
    event: make("info"),
    warn: make("warn"),
    fatal(code: string, message: string, err?: unknown): void {
      fatalCount++;
      const stack = stackOf(err);
      append({
        ts: new Date().toISOString(),
        level: "error",
        phase: "fatal",
        event: "startup-failed",
        code: safe(code),
        detail: safe(message),
        ...(stack ? { stack: safe(stack) } : {}),
      });
      // اگر خود خطا message متفاوتی دارد، آن هم داخل detail می‌آید (بدون مقدار حساس).
      if (err !== undefined) {
        const em = safe(messageOf(err));
        if (em && !safe(message).includes(em)) {
          append({
            ts: new Date().toISOString(),
            level: "error",
            phase: "fatal",
            event: "error-message",
            detail: em,
          });
        }
      }
    },
    hasFatal(): boolean {
      return fatalCount > 0;
    },
  };
}

/** خواندن رکوردها برای تست‌ها — خطوط خراب نادیده گرفته می‌شوند */
export function readStartupEntries(logPath: string): StartupLogEntry[] {
  const out: StartupLogEntry[] = [];
  try {
    const text = fs.readFileSync(logPath, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t) as StartupLogEntry);
      } catch {
        /* خط ناقص */
      }
    }
  } catch {
    /* فایل نیست */
  }
  return out;
}
