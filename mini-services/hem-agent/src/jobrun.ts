// Shared runner for streaming sudo commands in jobs (install/backup/restore/update).
//  - sudo only via allowed paths: root / sudo -n / sudo -S with password from stdin (none mode → honest SUDO_REQUIRED)
//  - Line-by-line output → job:log / job:stage / job:progress (step parsing in jobstream.ts)

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
  /** Full command without sudo (already quoted) */
  command: string;
  /** Initial log lines before execution */
  introLines?: string[];
  timeoutMs?: number;
  /** Receive the cancel function (to wire into JobManager.register) */
  setCancel?: (fn: () => void) => void;
  /** Build the final summary (default: based on exit code) */
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

/** Convert a job error to a message string (for audit) */
export function jobErrorMessage(e: unknown): string {
  if (e instanceof HemError) return e.message;
  return String((e as Error)?.message ?? e);
}

/** Whether an exec failure was a cancellation (after job:cancel) */
export function isCancelError(e: unknown): boolean {
  return e instanceof HemError && (e.detail as { cancelled?: boolean } | undefined)?.cancelled === true;
}
