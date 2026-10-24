// کنسول (قرارداد §9) — بدون شل آزاد؛ الزام امنیتی محصول.
//  - پیش‌نمایش: موتور allowlist (src/allowlist.ts) تصمیم می‌گیرد و رشتهٔ دقیق را می‌سازد
//  - اجرا: فقط رشتهٔ بازساخته‌شده از argv اعتبارسنجی‌شده (هرگز رشتهٔ خام کاربر اجرا نمی‌شود)
//  - stream:true → اجرا به‌صورت job با رویدادهای زندهٔ job:*
//  - هر دستور اجراشده (و هر تلاش مسدودشده) در audit ثبت می‌شود (پاک‌سازی‌شده)

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { HemError } from "./errors";
import type { AuditLogger } from "./audit";
import type { JobManager } from "./events";
import type { SessionManager } from "./sessions";
import { checkCommand } from "./allowlist";
import { createJobStreamer } from "./jobstream";
import { buildHsArgv } from "./headscaleExec";
import { buildSudoInvocation } from "./sudo";
import { shellQuote } from "./ssh";

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: (e: unknown) => void): void => {
    fn(req, res).catch(next);
  };

function paramOf(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export interface ConsoleDeps {
  manager: SessionManager;
  audit: AuditLogger;
  jobs: JobManager;
}

export function createConsoleRouter(deps: ConsoleDeps): Router {
  const r = Router({ mergeParams: true });
  const sid = (req: Request): string => paramOf(req.params.sid);

  /**
   * بررسی allowlist با زمینهٔ میزبان پروفایل (محدودهٔ curl) + ساخت «برنامهٔ اجرای واقعی».
   * ریشهٔ headscale بر اساس حالت پروفایل بازسازی می‌شود (§7): در حالت custom با
   * prefix واقعی باینری/پیکربندی و در حالت system-sudo با پوشش sudo — پیش‌نمایش
   * همان فرمان واقعی را نشان می‌دهد. اجزای کاربر عیناً از argv اعتبارسنجی‌شدهٔ
   * allowlist می‌آیند و رشتهٔ نهایی فقط با shellQuote ساخته می‌شود (الزام §۹:
   * هیچ الحاق رشتهٔ خام کاربر وجود ندارد).
   */
  const plan = async (
    req: Request,
    cmd: string,
  ): Promise<{
    ctx: ReturnType<SessionManager["hsContext"]>;
    result: ReturnType<typeof checkCommand>;
    exec: { cmd: string; stdin?: string };
  }> => {
    const sid_ = sid(req);
    const ctx = deps.manager.hsContext(sid_); // نشست باید متصل باشد
    const host = deps.manager.get(sid_)?.host;
    const result = checkCommand(cmd, { host });
    if (!result.allowed || result.argv[0] !== "headscale" || ctx.hsMode === "system") {
      return { ctx, result, exec: { cmd: result.exactCommand } };
    }
    const realArgv = buildHsArgv(ctx, result.argv.slice(1));
    let execCmd = realArgv.map(shellQuote).join(" ");
    let stdin: string | undefined;
    if (ctx.hsMode === "system-sudo") {
      let mode = ctx.sudoMode;
      if (!mode && ctx.refreshSudo) mode = await ctx.refreshSudo();
      const inv = buildSudoInvocation(execCmd, mode ?? "none", ctx.sudoPassword);
      execCmd = inv.cmd;
      stdin = inv.stdin;
    }
    return {
      ctx,
      result: { ...result, exactCommand: execCmd },
      exec: { cmd: execCmd, stdin },
    };
  };

  // POST /api/s/:sid/console/preview — بدون اجرا
  r.post(
    "/preview",
    wrap(async (req, res) => {
      const { cmd } = req.body ?? {};
      if (typeof cmd !== "string" || cmd.trim().length === 0) {
        throw new HemError("VALIDATION_FAILED", "cmd (رشته) الزامی است.");
      }
      const { result } = await plan(req, cmd);
      res.json({
        ok: true,
        allowed: result.allowed,
        exactCommand: result.exactCommand,
        reason: result.reason,
      });
    }),
  );

  // POST /api/s/:sid/console — اجرا (allowlist-enforced)
  r.post(
    "/",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const { cmd, stream } = req.body ?? {};
      if (typeof cmd !== "string" || cmd.trim().length === 0) {
        throw new HemError("VALIDATION_FAILED", "cmd (رشته) الزامی است.");
      }
      const { ctx, result, exec } = await plan(req, cmd);
      if (!result.allowed) {
        // هرگز اجرا نمی‌شود — حتی تلاش هم در audit ثبت می‌شود
        deps.audit.log({
          sessionId: sid_,
          action: "console_blocked",
          target: cmd,
          ok: false,
          error: result.reason,
        });
        throw new HemError("COMMAND_BLOCKED", result.reason, { argv: result.argv });
      }

      if (stream === true) {
        const jobId = `job-${randomUUID().slice(0, 8)}`;
        let cancelFn: () => void = () => undefined;
        deps.jobs.register({
          id: jobId,
          type: "console-stream",
          sessionId: sid_,
          startedAt: Date.now(),
          cancel: () => cancelFn(),
        });
        res.json({ ok: true, jobId, exactCommand: result.exactCommand });
        void (async () => {
          const jobs = deps.jobs;
          try {
            jobs.jobLog(jobId, `$ ${result.exactCommand}`);
            const streamer = createJobStreamer(jobs, jobId);
            const { result: r2, cancel } = ctx.ssh.execCancellable(exec.cmd, {
              timeoutMs: 120_000,
              stdin: exec.stdin,
              onStdout: streamer.onStdout,
              onStderr: streamer.onStderr,
            });
            cancelFn = cancel;
            const run = await r2;
            streamer.flush();
            jobs.jobDone(
              jobId,
              run.code === 0,
              run.code,
              run.code === 0 ? "دستور با موفقیت اجرا شد." : `دستور با کد خروج ${run.code} تمام شد.`,
            );
            deps.audit.log({
              sessionId: sid_,
              action: "console_exec_stream",
              target: result.exactCommand,
              ok: run.code === 0,
            });
          } catch (e) {
            const he = e instanceof HemError ? e : null;
            const detail = he?.detail as { cancelled?: boolean } | undefined;
            if (detail?.cancelled) {
              jobs.jobDone(jobId, false, null, "اجرای دستور به درخواست کاربر لغو شد.");
            } else {
              const msg = he ? he.message : String((e as Error)?.message ?? e);
              jobs.jobLog(jobId, `✗ ${msg}`, "stderr");
              jobs.jobError(jobId, msg);
            }
            deps.audit.log({
              sessionId: sid_,
              action: "console_exec_stream",
              target: result.exactCommand,
              ok: false,
            });
          }
        })();
        return;
      }

      const run = await ctx.ssh.exec(exec.cmd, { timeoutMs: 60_000, stdin: exec.stdin });
      deps.audit.log({
        sessionId: sid_,
        action: "console_exec",
        target: result.exactCommand,
        ok: run.code === 0,
        error: run.code === 0 ? undefined : `exit ${run.code}`,
      });
      res.json({ ok: run.code === 0, exitCode: run.code, stdout: run.stdout, stderr: run.stderr });
    }),
  );

  return r;
}
