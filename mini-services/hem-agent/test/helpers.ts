// Shared test utilities — each test gets its own temp home so real files stay untouched.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Express } from "express";
import { createApp } from "../src/api";
import type { AgentAuthMode } from "../src/config";
import { AuditLogger } from "../src/audit";
import { JobManager } from "../src/events";
import { ProfileStore } from "../src/profiles";
import { Redactor } from "../src/redact";
import { SecretStore } from "../src/secrets";
import { SessionManager } from "../src/sessions";
import { AGENT_VERSION } from "../src/config";

export function tmpHome(prefix = "hem-agent-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export interface TestStack {
  home: string;
  redactor: Redactor;
  audit: AuditLogger;
  secrets: SecretStore;
  profiles: ProfileStore;
  manager: SessionManager;
  jobs: JobManager;
  app: Express;
  dispose: () => void;
}

export interface BuildStackOpts {
  /** Optional X-HEM-Token — for auth tests (v0.3.1 §4) */
  token?: string;
  /** Explicit auth policy (v0.3.2 §2): "open" = local-dev exception; undefined = inferred from token */
  authMode?: AgentAuthMode;
  /** Real UI dir (must exist to be served) — default: a non-existent path */
  uiDir?: string;
  /** Expected UI path for the error page (v0.3.2) — default: same as uiDir */
  uiDirExpected?: string;
}

export function buildTestStack(opts: BuildStackOpts = {}): TestStack {
  const home = tmpHome();
  const redactor = new Redactor();
  const audit = new AuditLogger(home, redactor);
  const secrets = new SecretStore(home);
  const profiles = new ProfileStore(home);
  const jobs = new JobManager();
  const manager = new SessionManager({ home, profiles, secrets, audit, redactor });
  const uiDir = opts.uiDir ?? path.join(home, "ui-nonexistent");
  const app = createApp({
    manager,
    profiles,
    secrets,
    audit,
    redactor,
    jobs,
    token: opts.token,
    authMode: opts.authMode,
    uiDir,
    uiDirExpected: opts.uiDirExpected ?? uiDir,
    version: AGENT_VERSION,
    startedAt: Date.now(),
  });
  return {
    home,
    redactor,
    audit,
    secrets,
    profiles,
    manager,
    jobs,
    app,
    dispose: () => manager.dispose(),
  };
}

export interface ListeningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function listenApp(app: Express): Promise<ListeningServer> {
  return new Promise<ListeningServer>((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            server.close(() => res());
          }),
      });
    });
  });
}

/** HTTP + socket.io server attached to the same port (for job-event tests)
 *  optional token → WS auth like the desktop case (v0.3.1 §4);
 *  authMode (v0.3.2 §2): "open" = local-dev exception, undefined = inferred from token */
export async function listenStackIo(
  stack: TestStack,
  opts: { token?: string; authMode?: AgentAuthMode } = {},
): Promise<ListeningServer & { closeIo: () => Promise<void> }> {
  const { Server: IOServer } = await import("socket.io");
  const { attachEvents } = await import("../src/events");
  return new Promise((resolve) => {
    const server = stack.app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const io = new IOServer(server, { cors: { origin: "*" } });
      attachEvents(io, stack.manager, stack.jobs, opts.token, opts.authMode);
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            // close socket.io (clients) first, then HTTP; with a safety timeout so the test never hangs
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                res();
              }
            };
            io.close(() => {
              server.close(() => finish());
              setTimeout(finish, 2_000).unref?.();
            });
            setTimeout(() => {
              try {
                server.close(() => finish());
              } catch {
                finish();
              }
            }, 5_000).unref?.();
          }),
        closeIo: () => new Promise<void>((res) => io.close(() => res())),
      });
    });
  });
}

export async function json<T = unknown>(res: ResponseLike): Promise<T> {
  return (await res.json()) as T;
}

export interface ResponseLike {
  json: () => Promise<unknown>;
}

/** Full connect (fingerprint + confirm) via the API — returns the sessionId */
export async function connectAndConfirm(
  baseUrl: string,
  inline: Record<string, unknown>,
): Promise<string> {
  const r1 = await fetch(`${baseUrl}/api/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inline }),
  });
  const c1 = (await r1.json()) as { status: string; sessionId: string };
  if (c1.status === "connected") return c1.sessionId;
  if (c1.status !== "fingerprint-required") {
    throw new Error(`connect failed: ${JSON.stringify(c1)}`);
  }
  const r2 = await fetch(`${baseUrl}/api/connect/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: c1.sessionId, accept: true }),
  });
  const c2 = (await r2.json()) as { status: string; sessionId: string };
  if (c2.status !== "connected") {
    throw new Error(`confirm failed: ${JSON.stringify(c2)}`);
  }
  return c2.sessionId;
}

/** Ensure the real headscale server is healthy — restart it if it died */
export function ensureHeadscaleHealthy(): void {
  try {
    execFileSync("curl", ["-s", "-m", "3", "http://127.0.0.1:8080/health"], { encoding: "utf8" });
  } catch {
    // restart the test server (setsid — no dependency on the parent shell)
    try {
      execFileSync(
        "bash",
        [
          "-c",
          "(setsid /tmp/hs-bin/headscale serve --config /home/z/hs-test/config.yaml >> /home/z/hs-test/server.log 2>&1 < /dev/null &)",
        ],
        { timeout: 5_000 },
      );
    } catch {
      /* tried */
    }
    // give it a few seconds to come up
    for (let i = 0; i < 30; i++) {
      try {
        const out = execFileSync("curl", ["-s", "-m", "2", "http://127.0.0.1:8080/health"], {
          encoding: "utf8",
        });
        if (out.includes("pass")) return;
      } catch {
        /* retry */
      }
      execFileSync("sleep", ["0.5"]);
    }
    throw new Error("test headscale server did not come up");
  }
}
