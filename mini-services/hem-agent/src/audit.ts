// JSONL audit log — every string written to the log goes through redact().

import * as fs from "node:fs";
import * as path from "node:path";
import type { AuditEntry } from "./types";
import { Redactor } from "./redact";

export class AuditLogger {
  private file: string;
  private redactor: Redactor;

  constructor(home: string, redactor: Redactor) {
    fs.mkdirSync(home, { recursive: true });
    this.file = path.join(home, "audit.log");
    this.redactor = redactor;
  }

  /** Append one record — strings are always sanitized */
  log(entry: Omit<AuditEntry, "ts"> & { ts?: string }): void {
    const record: AuditEntry = {
      ts: entry.ts ?? new Date().toISOString(),
      sessionId: entry.sessionId,
      action: this.redactor.redactText(entry.action),
      target: entry.target !== undefined ? this.redactor.redactText(entry.target) : undefined,
      ok: entry.ok,
      error: entry.error !== undefined ? this.redactor.redactText(entry.error) : undefined,
    };
    fs.appendFileSync(this.file, JSON.stringify(record) + "\n");
  }

  /** Read the last n records (oldest→newest order) */
  tail(limit = 100): AuditEntry[] {
    try {
      const text = fs.readFileSync(this.file, "utf8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      return lines.slice(-limit).map((l) => {
        try {
          return JSON.parse(l) as AuditEntry;
        } catch {
          return { ts: new Date().toISOString(), action: "audit-unparsable", ok: false, error: "bad-line" };
        }
      });
    } catch {
      return [];
    }
  }
}
