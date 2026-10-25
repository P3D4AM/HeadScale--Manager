// socket.io (contract §5) — rooms sid:<id> and job:<id>
// Server→client events: conn:status, job:log, job:stage, job:progress, job:done, job:error
// Client→server: job:cancel (close channel + SIGINT), subscribe/unsubscribe
//
// Task 5-d — job reliability:
//  • Every job has a ring buffer of the last 500 log lines; a client that connects
//    "after the job started" gets all lines via the REST fallback
//    (GET /api/jobs/:id/log?since=…) and receives only the subsequent lines live via socket.io.
//  • A job record is kept up to 10 minutes after completion (then swept).

import type { Server as IOServer, Socket } from "socket.io";
import type { SessionManager } from "./sessions";
import type { JobInfo, JobLogLine, JobLogPage } from "./types";
import type { AgentAuthMode } from "./config";
import { timingSafeTokenMatch } from "./tokenmatch";

/** What SessionManager needs from a logger (real implementation: src/audit.ts) */
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
  /** Stop the running stream (channel.close + INT signal in execCancellable) */
  cancel: () => void;
}

const ROOM_RE = /^(sid|job):[A-Za-z0-9_-]+$/;

/** Max log lines kept in each job's ring buffer */
const JOB_LOG_RING = 500;
/** Keep finished job records up to 10 minutes for the REST fallback */
const JOB_RETENTION_MS = 10 * 60 * 1000;
/** Max job records in memory (oldest finished gets evicted) */
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

  /** Attach io (called by attachEvents) */
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

  /** Cancel a job — the open channel is closed (SIGINT + close) and the job itself reports the result honestly */
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

  /** Mark finished — the record is kept for the REST fallback (not deleted immediately) */
  finish(id: string): void {
    const job = this.jobs.get(id);
    if (job && job.status === "running") {
      job.status = "done";
      job.finishedAt = Date.now();
    }
  }

  /** Full job status (for GET /api/jobs/:id) */
  getStatus(id: string): JobInfo | undefined {
    const job = this.jobs.get(id);
    return job ? this.info(job) : undefined;
  }

  /** Buffered log page (for GET /api/jobs/:id/log?since=N) */
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

  /** Drop expired finished records + cap the total count */
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

  // ---- Event emitters to room job:<id> ----
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

/**
 * Full event wiring: rooms + conn:status + job:cancel
 *  v0.3.1 §4 + v0.3.2 §2: WebSocket auth is "equivalent" to HTTP —
 *   • token mode: a connection without a valid X-HEM-Token header / hem_token cookie is
 *     dropped immediately; no sensitive event (job and conn events) reaches an unauthenticated client.
 *   • open mode (documented local-dev exception — loopback): connections are accepted;
 *     index.ts allows this mode only on 127.0.0.1.
 *   • No token and no open: "locked" — every connection is dropped immediately
 *     (fail-closed; the WS equivalent of HTTP 503 AUTH_NOT_CONFIGURED).
 * HTTP and WS token comparison is identical (timing-safe, same header/cookie) — parity is mandatory.
 */
export function attachEvents(
  io: IOServer,
  manager: SessionManager,
  jobs: JobManager,
  token?: string,
  authMode?: AgentAuthMode,
): void {
  jobs.attach(io);

  manager.onStatus = (sessionId, status, detail) => {
    io.to(`sid:${sessionId}`).emit("conn:status", { sessionId, status, detail });
  };

  io.on("connection", (socket: Socket) => {
    if (authMode === "open") {
      // Documented local-dev exception — index.ts allows it on loopback only
    } else if (token && handshakeTokenMatches(socket, token)) {
      // Valid token — connection allowed
    } else {
      // No/invalid token (token mode) or "locked" (no token and no open):
      // dropped without any event/data. The token value is never printed.
      console.log(
        `[hem-agent] ws rejected (${token ? "no/invalid token" : "auth not configured"}) from ${socket.handshake.address ?? "unknown"}`,
      );
      socket.disconnect(true);
      return;
    }
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

/** socket.io handshake token: X-HEM-Token header or hem_token cookie (v0.3.1 §4) */
function handshakeTokenMatches(socket: Socket, expected: string): boolean {
  const h = socket.handshake.headers;
  const header = h["x-hem-token"];
  const headerVal = Array.isArray(header) ? header[0] : header;
  if (typeof headerVal === "string" && headerVal.length > 0) {
    return timingSafeTokenMatch(headerVal, expected);
  }
  const cookie = h.cookie;
  if (typeof cookie === "string") {
    const m = /(?:^|;\s*)hem_token=([^;\s]+)/.exec(cookie);
    if (m && m[1]) return timingSafeTokenMatch(m[1], expected);
  }
  return false;
}
