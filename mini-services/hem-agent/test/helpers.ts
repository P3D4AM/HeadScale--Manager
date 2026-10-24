// ابزارهای مشترک تست‌ها — هر تست home موقت خودش را دارد تا فایل‌های واقعی آلوده نشوند.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { Express } from "express";
import { createApp } from "../src/api";
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

export function buildTestStack(): TestStack {
  const home = tmpHome();
  const redactor = new Redactor();
  const audit = new AuditLogger(home, redactor);
  const secrets = new SecretStore(home);
  const profiles = new ProfileStore(home);
  const jobs = new JobManager();
  const manager = new SessionManager({ home, profiles, secrets, audit, redactor });
  const app = createApp({
    manager,
    profiles,
    secrets,
    audit,
    redactor,
    jobs,
    token: undefined,
    uiDir: path.join(home, "ui-nonexistent"),
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

/** سرور HTTP + socket.io وصل به همان پورت (برای تست‌های رویداد job) */
export async function listenStackIo(stack: TestStack): Promise<ListeningServer & { closeIo: () => Promise<void> }> {
  const { Server: IOServer } = await import("socket.io");
  const { attachEvents } = await import("../src/events");
  return new Promise((resolve) => {
    const server = stack.app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const io = new IOServer(server, { cors: { origin: "*" } });
      attachEvents(io, stack.manager, stack.jobs);
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((res) => {
            // اول socket.io (کلاینت‌ها) بسته می‌شود، بعد HTTP؛ با مهلت محافظ تا تست هنگ نکند
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

/** اتصال کامل (fingerprint + confirm) از طریق API — برمی‌گرداند sessionId */
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

/** اطمینان از سلامت سرور headscale واقعی — در صورت مرگ، ری‌استارت */
export function ensureHeadscaleHealthy(): void {
  try {
    execFileSync("curl", ["-s", "-m", "3", "http://127.0.0.1:8080/health"], { encoding: "utf8" });
  } catch {
    // ری‌استارت سرور آزمایشی (setsid — بدون وابستگی به شل والد)
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
      /* تلاش شد */
    }
    // چند ثانیه مهلت برای بالا آمدن
    for (let i = 0; i < 30; i++) {
      try {
        const out = execFileSync("curl", ["-s", "-m", "2", "http://127.0.0.1:8080/health"], {
          encoding: "utf8",
        });
        if (out.includes("pass")) return;
      } catch {
        /* دوباره تلاش */
      }
      execFileSync("sleep", ["0.5"]);
    }
    throw new Error("سرور headscale آزمایشی بالا نیامد");
  }
}
