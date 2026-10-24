// socket.io (قرارداد §5) — اتاق‌های sid:<id> و job:<id>
// رویدادهای سرور→کلاینت: conn:status, job:log, job:stage, job:progress, job:done, job:error
// کلاینت→سرور: job:cancel (بستن کانال + SIGINT)، subscribe/unsubscribe
//
// Task 5-d — قابلیت اطمینان job:
//  • هر job بافر حلقه‌ای از آخرین ۵۰۰ خط لاگ دارد؛ کلاینتی که «بعد از شروع job»
//    متصل می‌شود از طریق REST fallback (GET /api/jobs/:id/log?since=…) همهٔ خطوط
//    را می‌گیرد و از طریق socket.io فقط خطوط بعدی را زنده دریافت می‌کند.
//  • رکورد job تا ۱۰ دقیقه پس از پایان نگه داشته می‌شود (سپس sweep می‌شود).

import type { Server as IOServer, Socket } from "socket.io";
import type { SessionManager } from "./sessions";
import type { JobInfo, JobLogLine, JobLogPage } from "./types";

/** آنچه SessionManager از لاگر لازم دارد (پیاده‌سازی واقعی: src/audit.ts) */
export interface AuditLoggerLike {
  log(entry: {
    sessionId?: string;
    action: string;
    target?: string;
    ok: boolean;
    error?: string;
  }): void;
}

export interface RunningJob {
  id: string;
  type: string;
  sessionId: string;
  startedAt: number;
  cancelled: boolean;
  /** بستن استریم در حال اجرا (channel.close + سیگنال INT در execCancellable) */
  cancel: () => void;
}

const ROOM_RE = /^(sid|job):[A-Za-z0-9_-]+$/;

/** حداکثر خطوط لاگ نگه‌داشته‌شده در بافر حلقه‌ای هر job */
const JOB_LOG_RING = 500;
/** نگه‌داشتن رکورد jobهای تمام‌شده تا ۱۰ دقیقه برای REST fallback */
const JOB_RETENTION_MS = 10 * 60 * 1000;
/** حداکثر تعداد رکورد job در حافظه (قدیمی‌ترین تمام‌شده حذف می‌شود) */
const JOB_MAX_RECORDS = 200;

interface JobRecord extends RunningJob {
  status: "running" | "done" | "error";
  ok?: boolean;
  exitCode?: number | null;
  summary?: string;
  finalState?: string;
  finishedAt?: number;
  logs: JobLogLine[];
  logSeq: number;
  logDropped: number;
}

export class JobManager {
  private jobs = new Map<string, JobRecord>();
  private io: IOServer | null = null;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  /** اتصال io (توسط attachEvents) */
  attach(io: IOServer): void {
    this.io = io;
    if (!this.sweeper) {
      this.sweeper = setInterval(() => this.sweep(), 30_000);
      this.sweeper.unref?.();
    }
  }

  register(job: Omit<RunningJob, "cancelled">): JobInfo {
    this.jobs.set(job.id, {
      ...job,
      cancelled: false,
      status: "running",
      logs: [],
      logSeq: 0,
      logDropped: 0,
    });
    this.evictOldFinished();
    return this.info(this.jobs.get(job.id)!)!;
  }

  get(id: string): RunningJob | undefined {
    return this.jobs.get(id);
  }

  list(): JobInfo[] {
    return [...this.jobs.values()].map((j) => this.info(j)!);
  }

  /** لغو job — کانال باز بسته می‌شود (SIGINT + close) و job خودش نتیجه را صادقانه اعلام می‌کند */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.cancelled) return false;
    job.cancelled = true;
    try {
      job.cancel();
    } catch {
      /* best-effort */
    }
    return true;
  }

  /** علامت‌گذاری پایان — رکورد برای REST fallback نگه داشته می‌شود (نه حذف فوری) */
  finish(id: string): void {
    const job = this.jobs.get(id);
    if (job && job.status === "running") {
      job.status = "done";
      job.finishedAt = Date.now();
    }
  }

  /** وضعیت کامل job (برای GET /api/jobs/:id) */
  getStatus(id: string): JobInfo | undefined {
    const job = this.jobs.get(id);
    return job ? this.info(job) : undefined;
  }

  /** صفحهٔ لاگ بافرشده (برای GET /api/jobs/:id/log?since=N) */
  getLog(id: string, since = 0): JobLogPage | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    const logs = job.logs.filter((l) => l.seq > since);
    return {
      logs,
      nextSince: job.logSeq,
      truncated: job.logDropped > 0 && since < job.logDropped,
    };
  }

  /** حذف رکوردهای تمام‌شدهٔ منقضی + محدودکردن تعداد کل */
  private sweep(): void {
    const now = Date.now();
    for (const [id, job] of [...this.jobs.entries()]) {
      if (job.status !== "running" && job.finishedAt && now - job.finishedAt > JOB_RETENTION_MS) {
        this.jobs.delete(id);
      }
    }
    this.evictOldFinished();
  }

  private evictOldFinished(): void {
    if (this.jobs.size <= JOB_MAX_RECORDS) return;
    const finished = [...this.jobs.values()]
      .filter((j) => j.status !== "running")
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    const excess = this.jobs.size - JOB_MAX_RECORDS;
    for (let i = 0; i < Math.min(excess, finished.length); i++) {
      this.jobs.delete(finished[i].id);
    }
  }

  private info(j: JobRecord): JobInfo {
    return {
      id: j.id,
      type: j.type,
      sessionId: j.sessionId,
      startedAt: new Date(j.startedAt).toISOString(),
      cancelled: j.cancelled,
      status: j.status,
      ok: j.ok,
      exitCode: j.exitCode,
      summary: j.summary,
      finalState: j.finalState,
      finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : undefined,
      logCount: j.logSeq,
    };
  }

  // ---- فرستنده‌های رویداد به اتاق job:<id> ----
  jobLog(jobId: string, line: string, stream: "stdout" | "stderr" = "stdout"): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.logSeq += 1;
      job.logs.push({ seq: job.logSeq, line, stream });
      if (job.logs.length > JOB_LOG_RING) {
        const drop = job.logs.length - JOB_LOG_RING;
        job.logs.splice(0, drop);
        job.logDropped += drop;
      }
    }
    this.io?.to(`job:${jobId}`).emit("job:log", { jobId, line, stream });
  }
  jobStage(jobId: string, stage: number, total: number, title: string, risk?: string): void {
    this.io?.to(`job:${jobId}`).emit("job:stage", { jobId, stage, total, title, risk });
  }
  jobProgress(jobId: string, pct: number): void {
    this.io?.to(`job:${jobId}`).emit("job:progress", { jobId, pct });
  }
  jobDone(
    jobId: string,
    ok: boolean,
    exitCode: number | null,
    summary: string,
    finalState?: string,
  ): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "done";
      job.ok = ok;
      job.exitCode = exitCode;
      job.summary = summary;
      job.finalState = finalState;
      job.finishedAt = Date.now();
    }
    this.io?.to(`job:${jobId}`).emit("job:done", { jobId, ok, exitCode, summary, finalState });
  }
  jobError(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "error";
      job.summary = error;
      job.finishedAt = Date.now();
    }
    this.io?.to(`job:${jobId}`).emit("job:error", { jobId, error });
  }
}

/** سیم‌کشی کامل رویدادها: اتاق‌ها + conn:status + job:cancel */
export function attachEvents(io: IOServer, manager: SessionManager, jobs: JobManager): void {
  jobs.attach(io);

  manager.onStatus = (sessionId, status, detail) => {
    io.to(`sid:${sessionId}`).emit("conn:status", { sessionId, status, detail });
  };

  io.on("connection", (socket: Socket) => {
    socket.on("subscribe", (room: unknown) => {
      if (typeof room === "string" && ROOM_RE.test(room)) socket.join(room);
    });
    socket.on("unsubscribe", (room: unknown) => {
      if (typeof room === "string" && ROOM_RE.test(room)) socket.leave(room);
    });
    socket.on("job:cancel", (payload: unknown, ack?: (r: unknown) => void) => {
      const jobId = (payload as { jobId?: unknown } | null)?.jobId;
      const ok = typeof jobId === "string" ? jobs.cancel(jobId) : false;
      if (typeof ack === "function") ack({ ok });
    });
  });
}
