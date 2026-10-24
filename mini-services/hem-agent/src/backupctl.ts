// پشتیبان‌گیری / راستی‌آزمایی / بازیابی (قرارداد §4) — از طریق hsctl واقعی روی سرور.
// اگر hsctl روی سرور نباشد → NOT_AVAILABLE صادقانه (این قابلیت‌ها پس از نصب اولیه‌اند).

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { HemError } from "./errors";
import type { AuditLogger } from "./audit";
import type { JobManager } from "./events";
import type { SessionManager } from "./sessions";
import { buildSudoInvocation } from "./sudo";
import { hsctlCommand, hsctlNotAvailable, resolveHsctl } from "./hsctl";
import { isCancelError, jobErrorMessage, streamSudoCommand } from "./jobrun";
import type { BackupEntry } from "./types";

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: (e: unknown) => void): void => {
    fn(req, res).catch(next);
  };

function paramOf(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export interface MaintenanceDeps {
  manager: SessionManager;
  audit: AuditLogger;
  jobs: JobManager;
}

// --- اعتبارسنجی مسیر فایل پشتیبان (بدون متکار/پیمایش مسیر — فقط زیر /var/backups/hem) ---
const BACKUP_BASE = "/var/backups/hem";
const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeBackupFile(file: unknown): string {
  if (typeof file !== "string" || file.trim().length === 0) {
    throw new HemError("VALIDATION_FAILED", "نام فایل پشتیبان الزامی است.");
  }
  const f = file.trim();
  const segments = f.split("/");
  // هیچ قطعه‌ای نمی‌تواند «..» یا «.» باشد (traversal ممنوع)
  if (segments.some((seg) => seg === ".." || seg === ".")) {
    throw new HemError("VALIDATION_FAILED", "مسیر فایل پشتیبان نمی‌تواند شامل «..» باشد.");
  }
  if (f.startsWith("/")) {
    if (!f.startsWith(`${BACKUP_BASE}/`)) {
      throw new HemError("VALIDATION_FAILED", `مسیر مطلق فایل پشتیبان فقط زیر «${BACKUP_BASE}» مجاز است.`);
    }
    const rest = f.slice(BACKUP_BASE.length + 1).split("/");
    if (rest.some((seg) => !SEGMENT_RE.test(seg))) {
      throw new HemError("VALIDATION_FAILED", "نام فایل پشتیبان شامل کاراکترهای مجاز (حرف/رقم/نقطه/خط تیره) نیست.");
    }
    return f;
  }
  if (!SEGMENT_RE.test(f)) {
    throw new HemError("VALIDATION_FAILED", "نام فایل پشتیبان شامل کاراکترهای مجاز (حرف/رقم/نقطه/خط تیره) نیست.");
  }
  return `${BACKUP_BASE}/${f}`;
}

// --- تجزیهٔ خروجی «hsctl backup list» (print_table: نام  حجم) ---
export function parseBackupList(output: string): BackupEntry[] {
  const entries: BackupEntry[] = [];
  for (const line of output.split("\n")) {
    const m = /^(\S+)\s+([\d.]+)\s*MB\s*$/.exec(line.trim());
    if (m) entries.push({ name: m[1], sizeMb: Number(m[2]) });
  }
  return entries;
}

// --- تجزیهٔ خروجی «hsctl backup verify» (per-file از 5-b) ---
export function parseBackupVerify(output: string): { ok: boolean; issues: string[] } {
  if (output.includes("پشتیبان معتبر است")) return { ok: true, issues: [] };
  const issues: string[] = [];
  for (const line of output.split("\n")) {
    const m = /^\s*-\s+(.+)$/.exec(line);
    if (m && m[1].trim().length > 0) issues.push(m[1].trim());
  }
  return { ok: false, issues };
}

export function createBackupRouter(deps: MaintenanceDeps): Router {
  const r = Router({ mergeParams: true });
  const sid = (req: Request): string => paramOf(req.params.sid);

  // GET /api/s/:sid/backup/list
  r.get(
    "/list",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const ctx = deps.manager.hsContext(sid_);
      const inv = await resolveHsctl(ctx.ssh, ctx.hsctlPath);
      if (!inv) throw hsctlNotAvailable();
      const run = await ctx.ssh.exec(hsctlCommand(inv, ["backup", "list"]), { timeoutMs: 30_000 });
      if (run.code !== 0) {
        throw new HemError("EXEC_FAILED", "دریافت فهرست پشتیبان‌ها از سرور ناموفق بود.", {
          exitCode: run.code,
          stderr: run.stderr.trim(),
        });
      }
      const backups = parseBackupList(run.stdout);
      deps.audit.log({ sessionId: sid_, action: "backup_list", target: `${backups.length} مورد`, ok: true });
      res.json({ ok: true, backups, dir: BACKUP_BASE, raw: run.stdout });
    }),
  );

  // POST /api/s/:sid/backup/create — job استریمی واقعی
  r.post(
    "/create",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const ctx = deps.manager.hsContext(sid_);
      const inv = await resolveHsctl(ctx.ssh, ctx.hsctlPath);
      if (!inv) throw hsctlNotAvailable();
      const jobId = `job-${randomUUID().slice(0, 8)}`;
      let cancelFn: () => void = () => undefined;
      deps.jobs.register({
        id: jobId,
        type: "backup-create",
        sessionId: sid_,
        startedAt: Date.now(),
        cancel: () => cancelFn(),
      });
      res.json({ ok: true, jobId });
      void streamSudoCommand({
        jobs: deps.jobs,
        jobId,
        ctx,
        command: hsctlCommand(inv, ["backup", "create"]),
        introLines: ["شروع پشتیبان‌گیری کامل (hsctl backup create) …"],
        timeoutMs: 10 * 60 * 1000,
        setCancel: (fn) => (cancelFn = fn),
      })
        .then((result) => {
          deps.jobs.jobDone(jobId, result.ok, result.exitCode, result.summary, result.finalState);
          deps.audit.log({
            sessionId: sid_,
            action: "backup_create",
            ok: result.ok,
            error: result.ok ? undefined : result.summary,
          });
        })
        .catch((e: unknown) => {
          const msg = isCancelError(e) ? "پشتیبان‌گیری به درخواست کاربر لغو شد." : jobErrorMessage(e);
          if (isCancelError(e)) {
            deps.jobs.jobDone(jobId, false, null, msg);
          } else {
            deps.jobs.jobError(jobId, msg);
          }
          deps.audit.log({ sessionId: sid_, action: "backup_create", ok: false, error: msg });
        });
    }),
  );

  // POST /api/s/:sid/backup/verify {file}
  r.post(
    "/verify",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const ctx = deps.manager.hsContext(sid_);
      const file = normalizeBackupFile((req.body ?? {}).file);
      const inv = await resolveHsctl(ctx.ssh, ctx.hsctlPath);
      if (!inv) throw hsctlNotAvailable();
      // verify خواندن آرشیو است؛ با sudo اجرا می‌شود چون /var/backups/hem ملک root است
      const sudoMode = ctx.sudoMode ?? (await ctx.refreshSudo().catch(() => "none" as const));
      const invocation = buildSudoInvocation(hsctlCommand(inv, ["backup", "verify", file]), sudoMode, ctx.sudoPassword);
      const run = await ctx.ssh.exec(invocation.cmd, { timeoutMs: 5 * 60_000, stdin: invocation.stdin });
      const parsed = parseBackupVerify(run.stdout + "\n" + run.stderr);
      deps.audit.log({
        sessionId: sid_,
        action: "backup_verify",
        target: file,
        ok: parsed.ok,
        error: parsed.ok ? undefined : `${parsed.issues.length} ایراد`,
      });
      res.json({
        ok: parsed.ok,
        exitCode: run.code,
        file,
        issues: parsed.issues,
        output: run.stdout,
        stderr: run.stderr,
      });
    }),
  );

  return r;
}

// POST /api/s/:sid/restore {file, confirm:true} — job استریمی واقعی
export function createRestoreRouter(deps: MaintenanceDeps): Router {
  const r = Router({ mergeParams: true });
  const sid = (req: Request): string => paramOf(req.params.sid);

  r.post(
    "/restore",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const ctx = deps.manager.hsContext(sid_);
      const { file, confirm } = req.body ?? {};
      const normalized = normalizeBackupFile(file);
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          `بازیابی از «${normalized}» پیکربندی/داده‌های فعلی سرور را بازمی‌گرداند — برای تأیید، همان نام فایل را با «confirm: true» بفرستید.`,
          { file: normalized },
        );
      }
      const inv = await resolveHsctl(ctx.ssh, ctx.hsctlPath);
      if (!inv) throw hsctlNotAvailable();
      const jobId = `job-${randomUUID().slice(0, 8)}`;
      let cancelFn: () => void = () => undefined;
      deps.jobs.register({
        id: jobId,
        type: "restore",
        sessionId: sid_,
        startedAt: Date.now(),
        cancel: () => cancelFn(),
      });
      res.json({ ok: true, jobId, file: normalized });
      void streamSudoCommand({
        jobs: deps.jobs,
        jobId,
        ctx,
        command: hsctlCommand(inv, ["restore", normalized, "--yes"]),
        introLines: [`شروع بازیابی از ${normalized} (hsctl restore) …`, "پیش از بازیابی، وضعیت فعلی توسط hsctl پشتیبان گرفته می‌شود."],
        timeoutMs: 15 * 60 * 1000,
        setCancel: (fn) => (cancelFn = fn),
      })
        .then((result) => {
          deps.jobs.jobDone(jobId, result.ok, result.exitCode, result.summary, result.finalState);
          deps.audit.log({
            sessionId: sid_,
            action: "restore",
            target: normalized,
            ok: result.ok,
            error: result.ok ? undefined : result.summary,
          });
        })
        .catch((e: unknown) => {
          const msg = isCancelError(e) ? "بازیابی به درخواست کاربر لغو شد." : jobErrorMessage(e);
          if (isCancelError(e)) {
            deps.jobs.jobDone(jobId, false, null, msg);
          } else {
            deps.jobs.jobError(jobId, msg);
          }
          deps.audit.log({ sessionId: sid_, action: "restore", target: normalized, ok: false, error: msg });
        });
    }),
  );

  return r;
}
