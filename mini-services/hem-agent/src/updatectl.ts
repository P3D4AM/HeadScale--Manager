// ارتقا (قرارداد §4) — check از نسخهٔ واقعی سرور + پین پروژه؛ execute با hsctl واقعی
// به‌صورت job استریمی با تجزیهٔ گام‌ها و وضعیت نهایی آگاه از rollback (خروجی صادقانهٔ 5-b).

import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { HemError } from "./errors";
import type { AuditLogger } from "./audit";
import type { JobManager } from "./events";
import type { SessionManager } from "./sessions";
import { projectRoot } from "./config";
import { hsctlCommand, hsctlNotAvailable, resolveHsctl } from "./hsctl";
import { hsVersion } from "./remote/headscale";
import { isCancelError, jobErrorMessage, streamSudoCommand } from "./jobrun";
import type { UpdateCheckResult } from "./types";

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

// نسخهٔ پین‌شدهٔ headscale — از constants.py مخزن (منبع واحد) در اولین فراخوانی
// خوانده می‌شود؛ اگر فایل نبود، مقدار پین زیر (هم‌گام با PINNED_HS_VERSION = "0.29.5").
let cachedPin: string | null = null;
export function pinnedHsVersion(): string {
  if (cachedPin) return cachedPin;
  try {
    const src = fs.readFileSync(path.join(projectRoot(), "src/hem/constants.py"), "utf8");
    const m = /PINNED_HS_VERSION\s*=\s*"([^"]+)"/.exec(src);
    if (m) {
      cachedPin = m[1];
      return cachedPin;
    }
  } catch {
    /* مخزن در دسترس نیست — پین محلی */
  }
  cachedPin = "0.29.5"; // PINNED_HS_VERSION مخزن — در صورت تغییر، اینجا هم به‌روز شود
  return cachedPin;
}

export function createUpdateRouter(deps: MaintenanceDeps): Router {
  const r = Router({ mergeParams: true });
  const sid = (req: Request): string => paramOf(req.params.sid);

  // GET /api/s/:sid/update/check — نسخهٔ فعلی (سرور واقعی) در برابر پین پروژه
  r.get(
    "/check",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sid(req));
      const latest = pinnedHsVersion();
      let current: string | null = null;
      let note: string | undefined;
      try {
        current = (await hsVersion(ctx)).version;
      } catch {
        note = "نسخهٔ headscale روی سرور قابل خواندن نبود (نصب نشده یا CLI پاسخ نمی‌دهد).";
      }
      const result: UpdateCheckResult = {
        current,
        latest,
        upToDate: current === latest,
        note,
      };
      res.json({ ok: true, data: result });
    }),
  );

  // POST /api/s/:sid/update/execute {version?, confirm:true} — job استریمی واقعی
  r.post(
    "/execute",
    wrap(async (req, res) => {
      const sid_ = sid(req);
      const ctx = deps.manager.hsContext(sid_);
      const { version, confirm } = req.body ?? {};
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          "ارتقای headscale با توقف موقت سرویس و نصب بستهٔ جدید همراه است (در شکست، بازگشت خودکار انجام می‌شود) — «confirm: true» بفرستید.",
        );
      }
      if (version !== undefined && version !== null && String(version).trim() !== "") {
        if (!/^\d+\.\d+\.\d+$/.test(String(version).trim())) {
          throw new HemError("VALIDATION_FAILED", "نسخهٔ هدف باید به قالب X.Y.Z باشد (مثل 0.30.0).");
        }
      }
      const inv = await resolveHsctl(ctx.ssh, ctx.hsctlPath);
      if (!inv) throw hsctlNotAvailable();
      const targetVersion = version !== undefined && version !== null && String(version).trim() !== "" ? String(version).trim() : null;
      const args = ["update", "--yes", ...(targetVersion ? ["--version", targetVersion] : [])];
      const jobId = `job-${randomUUID().slice(0, 8)}`;
      let cancelFn: () => void = () => undefined;
      deps.jobs.register({
        id: jobId,
        type: "update-execute",
        sessionId: sid_,
        startedAt: Date.now(),
        cancel: () => cancelFn(),
      });
      res.json({ ok: true, jobId, target: targetVersion ?? "آخرین نسخهٔ پایدار" });
      void streamSudoCommand({
        jobs: deps.jobs,
        jobId,
        ctx,
        command: hsctlCommand(inv, args),
        introLines: [
          `شروع ارتقای headscale${targetVersion ? ` به نسخهٔ ${targetVersion}` : ""} (hsctl update) …`,
          "پیش از هر تغییری، پشتیبان کامل و بستهٔ بازگشت آماده می‌شود.",
        ],
        timeoutMs: 30 * 60 * 1000,
        setCancel: (fn) => (cancelFn = fn),
        summarize: (code, steps) => {
          if (code === 0) return `ارتقا با موفقیت کامل شد (کد خروج ۰).`;
          const failed = steps.find((st) => st.status === "failed" || st.status === "needs_action");
          return `ارتقا ناتمام ماند (کد خروج ${code})${failed ? ` — گام: ${failed.title}` : ""}. وضعیت سرور را با hsctl doctor بررسی کنید.`;
        },
      })
        .then((result) => {
          // وضعیت نهایی آگاه از rollback: updated / rolled_back / rollback_failed / failed
          deps.jobs.jobDone(jobId, result.ok, result.exitCode, result.summary, result.finalState);
          deps.audit.log({
            sessionId: sid_,
            action: "update_execute",
            target: targetVersion ?? "latest",
            ok: result.ok,
            error: result.ok ? undefined : `${result.summary}${result.finalState ? ` [${result.finalState}]` : ""}`,
          });
        })
        .catch((e: unknown) => {
          const msg = isCancelError(e) ? "ارتقا به درخواست کاربر لغو شد." : jobErrorMessage(e);
          if (isCancelError(e)) {
            deps.jobs.jobDone(jobId, false, null, msg);
          } else {
            deps.jobs.jobError(jobId, msg);
          }
          deps.audit.log({ sessionId: sid_, action: "update_execute", target: targetVersion ?? "latest", ok: false, error: msg });
        });
    }),
  );

  return r;
}
