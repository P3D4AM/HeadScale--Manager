// اجرای مشترکِ فرمان‌های sudo استریمی برای jobها (نصب/پشتیبان/بازیابی/ارتقا).
//  - sudo فقط از مسیرهای مجاز: root / sudo -n / sudo -S با رمز از stdin (حالت none → SUDO_REQUIRED صادقانه)
//  - خروجی خط‌به‌خط → job:log / job:stage / job:progress (تجزیهٔ گام‌ها در jobstream.ts)

import { HemError } from "./errors";
import type { JobManager } from "./events";
import type { SessionManager } from "./sessions";
import { buildSudoInvocation } from "./sudo";
import { createJobStreamer, detectFinalState } from "./jobstream";
import type { ExecResult, ParsedInstallStep } from "./types";

type HsCtx = ReturnType<SessionManager["hsContext"]>;

export interface StreamSudoParams {
  jobs: JobManager;
  jobId: string;
  ctx: HsCtx;
  /** فرمان کامل بدون sudo (خودش quote شده) */
  command: string;
  /** خطوط اولیهٔ لاگ قبل از اجرا */
  introLines?: string[];
  timeoutMs?: number;
  /** دریافت تابع لغو (برای wire کردن به JobManager.register) */
  setCancel?: (fn: () => void) => void;
  /** ساخت خلاصهٔ نهایی (پیش‌فرض: بر اساس کد خروج) */
  summarize?: (code: number | null, steps: ParsedInstallStep[]) => string;
}

export interface StreamSudoResult {
  ok: boolean;
  exitCode: number | null;
  finalState?: string;
  summary: string;
  steps: ParsedInstallStep[];
}

export async function streamSudoCommand(params: StreamSudoParams): Promise<StreamSudoResult> {
  const { jobs, jobId, ctx } = params;
  const log = (line: string, stream: "stdout" | "stderr" = "stdout"): void =>
    jobs.jobLog(jobId, line, stream);
  for (const l of params.introLines ?? []) log(l);

  const sudoMode = ctx.sudoMode ?? (await ctx.refreshSudo().catch(() => "none" as const));
  const invocation = buildSudoInvocation(params.command, sudoMode, ctx.sudoPassword);
  log(`اجرای فرمان با دسترسی sudo (حالت: ${sudoMode}) …`);

  const streamer = createJobStreamer(jobs, jobId);
  const { result, cancel } = ctx.ssh.execCancellable(invocation.cmd, {
    timeoutMs: params.timeoutMs ?? 20 * 60 * 1000,
    stdin: invocation.stdin,
    onStdout: streamer.onStdout,
    onStderr: streamer.onStderr,
  });
  params.setCancel?.(cancel);
  const r: ExecResult = await result.catch((e: unknown) => {
    streamer.flush();
    throw e;
  });
  streamer.flush();

  const finalState = detectFinalState(r.stdout + "\n" + r.stderr) ?? undefined;
  const steps = streamer.steps();
  const summary = params.summarize
    ? params.summarize(r.code, steps)
    : r.code === 0
      ? `فرمان با موفقیت اجرا شد${finalState ? ` (وضعیت: ${finalState})` : ""}.`
      : `فرمان با کد خروج ${r.code} تمام شد.`;
  return { ok: r.code === 0, exitCode: r.code, finalState, summary, steps };
}

/** خروجی خطای job به رشتهٔ پیام (برای audit) */
export function jobErrorMessage(e: unknown): string {
  if (e instanceof HemError) return e.message;
  return String((e as Error)?.message ?? e);
}

/** جزئیات لغو بودن exec (پس از job:cancel) */
export function isCancelError(e: unknown): boolean {
  return e instanceof HemError && (e.detail as { cancelled?: boolean } | undefined)?.cancelled === true;
}
