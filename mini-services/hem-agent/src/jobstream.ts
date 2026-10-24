// تجزیهٔ خروجی گام‌به‌گام hsctl (و نصب‌کننده) برای رویدادهای job (قرارداد §5).
// الگو بر اساس خروجی «واقعی» StepRunner (src/hem/core/runner.py) نوشته شده است:
//   [~] گام N/total — عنوان            ← شروع گام
//   [✓] گام N/total — عنوان — نتیجه     ← موفق
//   [!] گام N/total — عنوان — نتیجه     ← نیاز به اقدام
//   [✗] گام N/total — عنوان — نتیجه     ← ناموفق
// (اعداد ASCII هستند؛ آیکن‌ها ممکن است در tty رنگی باشند → ANSI-strip قبل از تجزیه.)

import type { JobManager } from "./events";
import type { ParsedInstallStep } from "./types";

const ANSI_RE = /\x1b\[[0-9;]*m/g;

// عنوان گام‌های پرخطر — هم‌ارز ریسک‌های flow.py / cli.py (نصب: packages/headscale/
// configure/dns_https/firewall/start؛ ارتقا: توقف/نصب). بقیه safe در نظر گرفته می‌شوند.
const RISKY_TITLES = new Set([
  "نصب بسته‌های پایه",
  "دانلود و نصب headscale",
  "تولید و اعتبارسنجی پیکربندی",
  "تنظیم پروکسی Caddy و HTTPS",
  "تنظیم فایروال (اول SSH)",
  "فعال‌سازی سرویس",
  "توقف سرویس",
  "دانلود و نصب نسخه جدید",
]);

const STEP_LINE_RE = /^\[([~✓!✗])\]\s*گام\s+(\d+)\/(\d+)\s*—\s*(.+)$/;

/** تجزیهٔ یک خط خروجی به گام — null یعنی خط گام نیست */
export function parseStepLine(rawLine: string): ParsedInstallStep | null {
  const line = rawLine.replace(ANSI_RE, "");
  const m = STEP_LINE_RE.exec(line);
  if (!m) return null;
  const icon = m[1];
  const stage = Number(m[2]);
  const total = Number(m[3]);
  let title = m[4];
  let detail: string | undefined;
  if (icon !== "~") {
    // خط پایان: «عنوان — نتیجه» (عنوان‌های واقعی هرگز «—» ندارند → اولین وقوع)
    const idx = title.indexOf(" — ");
    if (idx >= 0) {
      detail = title.slice(idx + 3);
      title = title.slice(0, idx);
    }
  }
  const status: ParsedInstallStep["status"] =
    icon === "~" ? "running" : icon === "✓" ? "ok" : icon === "!" ? "needs_action" : "failed";
  return {
    stage,
    total,
    title,
    status,
    detail,
    risk: RISKY_TITLES.has(title) ? "risky" : "safe",
  };
}

// وضعیت‌های نهایی نصب (اصلاح ۴.۴ — برچسب‌های قراردادی 5-b) و پیام‌های ارتقا
// (اصلاح ۴.۷). رشته‌ها عیناً از src/hem/i18n.py هستند.
const FINAL_STATE_MARKERS: Array<{ label: string; state: string }> = [
  { label: "نصب انجام شد و صحت آن تأیید شد.", state: "verified" },
  { label: "نصب کاملاً موفق است.", state: "full_success" },
  { label: "DNS یا گواهی TLS هنوز آماده نیست.", state: "pending_verification" },
  { label: "نصب انجام شد اما سرویس آماده نیست.", state: "service_not_ready" },
  { label: "بخشی از عملیات شکست خورده است.", state: "partial_failure" },
];

const UPDATE_STATE_MARKERS: Array<{ label: string; state: string }> = [
  { label: "کامل شد و سرویس سالم است.", state: "rolled_back" }, // بازگشت به نسخهٔ قبلی (…) کامل شد…
  { label: "بازگشت به نسخهٔ قبلی هم ناموفق بود!", state: "rollback_failed" },
  { label: "به‌روزرسانی ناموفق بود", state: "failed" },
];

/** تشخیص وضعیت نهایی از کل خروجی — null یعنی برچسبی نبود */
export function detectFinalState(output: string): string | null {
  const lines = output.split("\n");
  // اول برچسب‌های نصب (اولویت با آخرین خطوط معنادار)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].replace(ANSI_RE, "");
    for (const m of FINAL_STATE_MARKERS) {
      if (l.includes(m.label)) return m.state;
    }
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].replace(ANSI_RE, "");
    for (const m of UPDATE_STATE_MARKERS) {
      if (l.includes(m.label)) return m.state;
    }
    if (/ارتقا به headscale [\d.]+ کامل شد/.test(l)) return "updated";
  }
  if (output.includes("شبیه‌سازی کامل نصب تا انتها انجام شد")) return "dry_run_complete";
  return null;
}

/** تقسیم‌کنندهٔ جریان به خطوط کامل (flush برای خط بی‌انتهای آخر) */
export class LineBuffer {
  private buf = "";
  constructor(private readonly onLine: (line: string) => void) {}
  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "");
      this.buf = this.buf.slice(i + 1);
      this.onLine(line);
    }
  }
  flush(): void {
    if (this.buf.length > 0) {
      this.onLine(this.buf.replace(/\r$/, ""));
      this.buf = "";
    }
  }
}

export interface JobStreamer {
  onStdout: (chunk: string) => void;
  onStderr: (chunk: string) => void;
  flush: () => void;
  /** گام‌های تجزیه‌شده تا این لحظه */
  steps: () => ParsedInstallStep[];
}

/**
 * پل جریان خروجی فرمان → رویدادهای job:
 *  هر خط → job:log؛ شروع هر گام ([~]) → job:stage؛ پایان هر گام → job:progress.
 */
export function createJobStreamer(jobs: JobManager, jobId: string): JobStreamer {
  const steps: ParsedInstallStep[] = [];
  const handle = (line: string, stream: "stdout" | "stderr"): void => {
    jobs.jobLog(jobId, line, stream);
    const st = parseStepLine(line);
    if (!st) return;
    steps.push(st);
    if (st.status === "running") {
      jobs.jobStage(jobId, st.stage, st.total, st.title, st.risk);
    } else {
      jobs.jobStage(jobId, st.stage, st.total, st.title, st.risk);
      const pct = st.total > 0 ? Math.round((st.stage / st.total) * 100) : 0;
      jobs.jobProgress(jobId, pct);
    }
  };
  const out = new LineBuffer((l) => handle(l, "stdout"));
  const err = new LineBuffer((l) => handle(l, "stderr"));
  return {
    onStdout: (c) => out.push(c),
    onStderr: (c) => err.push(c),
    flush: () => {
      out.flush();
      err.flush();
    },
    steps: () => [...steps],
  };
}
