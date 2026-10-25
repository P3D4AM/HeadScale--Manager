// startuplog — diagnostic startup log (v0.3.2-beta.2 — the EXE closes instantly bug).
//
// Why: until this version, when startup failed (auth config, port already in use,
// missing ui/, filesystem error, …) only momentary console output was written and
// the evidence vanished with the window closing. This log is file-based:
//
//   • A well-known, stable path: <home>/logs/hem-agent.log
//     (Windows: %USERPROFILE%\.hem-agent\logs\hem-agent.log — configurable via HEM_AGENT_HOME)
//   • Each record is one JSON line: ts / level / phase / event / code? / detail? / stack?
//   • Time, startup phase, error type and stack trace — the direct ask of the bug report.
//   • Size rotation: 256KB cap — the previous generation moves to hem-agent.log.1 (one generation).
//   • Every string goes through the Redactor (token=***, password=***, private key, …).
//     The desktop token and the bootstrap URL (?token=…) are never written to this
//     file — bootstrap delivery happens only via the console line (index.ts).
//   • A failure of the log itself never kills the program (best-effort, try/catch).
//
// This module is testable: createStartupLog(homeDir, redactor) plus the
// readEntries helper for tests.

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
  /** Full log file path — also printed in user-facing error messages */
  readonly logPath: string;
  /** Normal startup event (level=info) */
  event(phase: string, event: string, extra?: StartupEventExtra): void;
  /** Warning event (level=warn) */
  warn(phase: string, event: string, extra?: StartupEventExtra): void;
  /** Fatal error — level=error; error code + message + stack trace if any */
  fatal(code: string, message: string, err?: unknown): void;
  /** Has any fatal error been logged? (for the exit decision in index.ts) */
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

/** Create a diagnostic log for this run — homeDir is usually agentHome() */
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
        /* keeping the previous generation is not critical */
      }
      fs.renameSync(logPath, old);
    } catch {
      /* no rotation? the same file continues — not critical */
    }
  };

  const append = (entry: StartupLogEntry): void => {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      rotateIfNeeded();
      fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      /* no logging about logging — best-effort */
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
      // If the underlying error has a different message, it is also recorded in detail (no sensitive values).
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

/** Read records for tests — corrupt lines are skipped */
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
        /* incomplete line */
      }
    }
  } catch {
    /* no file */
  }
  return out;
}
