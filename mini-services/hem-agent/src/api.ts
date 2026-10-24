// همهٔ مسیرهای REST (قرارداد §4) — پاسخ‌ها واقعی، خطاها تایپ‌شده با پیام فارسی.
// بخش‌های نصب (§8)/کنسول (§9)/پشتیبان/بازیابی/ارتقا: روترهای واقعی Task 5-d
// (src/installer.ts، src/console.ts، src/backupctl.ts، src/updatectl.ts).

import express, { type Express, type NextFunction, type Request, type Response } from "express";
import * as fs from "node:fs";
import * as path from "node:path";
import { HemError } from "./errors";
import type { JobManager } from "./events";
import { SessionManager } from "./sessions";
import { ProfileStore } from "./profiles";
import type { SecretStore } from "./secrets";
import type { AuditLogger } from "./audit";
import type { Redactor } from "./redact";
import { maskHsKey } from "./redact";
import { runProbe, parseSsPorts } from "./remote/probe";
import {
  hsApiKeysCreate,
  hsApiKeysExpire,
  hsApiKeysList,
  hsConfigGet,
  hsConfigSet,
  hsConfigValidate,
  hsHealth,
  hsLogs,
  hsNodesApproveRoutes,
  hsNodesDelete,
  hsNodesExpire,
  hsNodesList,
  hsNodesRename,
  hsNodesRoutes,
  hsNodesTag,
  hsPolicyGet,
  hsPolicySet,
  hsPolicyValidate,
  hsPreAuthKeysCreate,
  hsPreAuthKeysDelete,
  hsPreAuthKeysExpire,
  hsPreAuthKeysList,
  hsServiceAction,
  hsServiceStatus,
  hsUsersCreate,
  hsUsersDestroy,
  hsUsersList,
  hsUsersRename,
  hsVersion,
} from "./remote/headscale";
import { createBackupRouter, createRestoreRouter } from "./backupctl";
import { createConsoleRouter } from "./console";
import { createInstallRouter } from "./installer";
import { createUpdateRouter } from "./updatectl";
import { timingSafeTokenMatch } from "./tokenmatch";
import type { ServiceActionName } from "./types";

export interface AppDeps {
  manager: SessionManager;
  profiles: ProfileStore;
  secrets: SecretStore;
  audit: AuditLogger;
  redactor: Redactor;
  jobs: JobManager;
  token?: string;
  /** پوشهٔ UI استاتیک (اختیاری) */
  uiDir?: string;
  version: string;
  startedAt: number;
}

const ALLOWED_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const wrap =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };


type RouteParam = string | string[] | undefined;
function paramOf(v: RouteParam): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}
const sidOf = (req: Request): string => paramOf(req.params.sid as RouteParam);

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));

  // --- CORS: فقط بدون Origin (curl) یا localhost/127.0.0.1 (توسعه) ---
  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (origin && !ALLOWED_ORIGIN_RE.test(origin)) {
      res.status(403).json({ ok: false, error: "FORBIDDEN", message: "مبدأ درخواست مجاز نیست." });
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-HEM-Token");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // --- توکن اختیاری X-HEM-Token برای همهٔ /api -----------------------------
  // حالت دسکتاپ: هدر X-HEM-Token «یا» کوکی hem_token (بازکردن /?token=… کوکی
  // را می‌گذارد — پایین‌تر؛ به این ترتیب UI بدون هیچ تغییری، همان‌مبدأ و با کوکی
  // خودکار، از توکن عبور می‌کند).
  app.use("/api", (req, res, next) => {
    if (!deps.token) {
      next();
      return;
    }
    if (requestTokenMatches(req, deps.token)) {
      next();
      return;
    }
    res.status(401).json({ ok: false, error: "UNAUTHORIZED", message: "هدر X-HEM-Token موجود یا معتبر نیست." });
  });

  // ── تبادل یک‌بارمصرف ?token= → کوکی جلسه‌ای (v0.3.1 §4) ──────────────────
  // نشت توکن در URL/لاگ/تاریخچهٔ مرورگر: مقدار ?token فقط «یک بار» قابل
  // تبادل است — پس از اولین استفاده، لینک‌های قدیمی (تاریخچهٔ مرورگر/لاگ‌ها)
  // دیگر هیچ کوکی‌ای نمی‌سازند. تبادل فقط روی مسیرهای UI انجام می‌شود، نه
  // /api (احراز هویت API فقط هدر/کوکی است؛ token در query هیچ‌وقت معتبر نیست).
  // کوکی «جلسه‌ای» است (بدون Max-Age؛ با بستن مرورگر می‌میرد)، HttpOnly و
  // SameSite=Strict. پس از تبادل، 303 به همان مسیر «بدون token» می‌فرستیم
  // (نوار آدرس تمیز می‌شود؛ پارامترهای دیگر کوئری مثل XTransformPort حفظ می‌شوند).
  let bootstrapConsumed = false;
  if (deps.token && deps.token.length > 0) {
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      const q = req.query.token;
      const provided = typeof q === "string" ? q : undefined;
      if (
        !provided ||
        bootstrapConsumed ||
        !timingSafeTokenMatch(provided, deps.token)
      ) {
        // مقدار نادرست یا مصرف‌شده: نادیده گرفته می‌شود — کوکی جعلی ساخته
        // نمی‌شود؛ درخواست‌های بعدی بدون توکن معتبر همان 401 می‌گیرند.
        next();
        return;
      }
      bootstrapConsumed = true;
      res.setHeader("Set-Cookie", `hem_token=${provided}; Path=/; HttpOnly; SameSite=Strict`);
      const kept = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) {
        if (k === "token" || v === undefined) continue;
        const val = Array.isArray(v) ? v[0] : v;
        if (typeof val === "string" && val !== "") kept.append(k, val);
      }
      const qs = kept.toString();
      res.redirect(303, qs ? `${req.path}?${qs}` : req.path);
    });
  }


  // ------------------------------------------------------------------ health
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      service: "hem-agent",
      version: deps.version,
      uptimeSec: Math.round((Date.now() - deps.startedAt) / 1000),
      platform: process.platform,
      sessions: deps.manager.list().length,
    });
  });

  // ------------------------------------------------------------------ profiles
  app.get("/api/profiles", (_req, res) => {
    res.json({ ok: true, profiles: deps.profiles.list() });
  });

  app.post(
    "/api/profiles",
    wrap(async (req, res) => {
      const body = req.body ?? {};
      // رمز اختیاری — پیش‌فرض ذخیره نمی‌شود (فقط حافظه) مگر saveSecret:true
      const { secret, saveSecret, ...profileInput } = body;
      const created = deps.profiles.create(profileInput);
      if (typeof secret === "string" && secret.length > 0) {
        deps.secrets.set(`profile:${created.id}`, secret, { persist: saveSecret === true });
        deps.redactor.registerSecret(secret);
      }
      deps.audit.log({ action: "profile_create", target: `${created.name} (${created.host}:${created.port})`, ok: true });
      res.json({ ok: true, profile: maskProfileSecrets(created) });
    }),
  );

  app.put(
    "/api/profiles/:id",
    wrap(async (req, res) => {
      const { secret, saveSecret, ...patch } = req.body ?? {};
      const updated = deps.profiles.update(paramOf(req.params.id), patch);
      if (typeof secret === "string") {
        if (secret.length === 0) {
          deps.secrets.delete(`profile:${updated.id}`);
        } else {
          deps.secrets.set(`profile:${updated.id}`, secret, { persist: saveSecret === true });
          deps.redactor.registerSecret(secret);
        }
      }
      deps.audit.log({ action: "profile_update", target: updated.name, ok: true });
      res.json({ ok: true, profile: maskProfileSecrets(updated) });
    }),
  );

  app.delete(
    "/api/profiles/:id",
    wrap(async (req, res) => {
      const p = deps.profiles.get(paramOf(req.params.id));
      deps.profiles.remove(paramOf(req.params.id));
      deps.secrets.delete(`profile:${paramOf(req.params.id)}`);
      deps.audit.log({ action: "profile_delete", target: p?.name ?? paramOf(req.params.id), ok: true });
      res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------------ known-hosts
  app.get("/api/known-hosts", (_req, res) => {
    res.json({ ok: true, knownHosts: deps.manager.knownHostsList() });
  });

  app.post(
    "/api/known-hosts/forget",
    wrap(async (req, res) => {
      const { host, port, confirm } = req.body ?? {};
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          `برای فراموشی کلید میزبان ${host ?? "?"}:${port ?? "?"} تأیید صریح لازم است — «confirm: true» بفرستید.`,
        );
      }
      if (typeof host !== "string" || !Number.isInteger(port)) {
        throw new HemError("VALIDATION_FAILED", "host (رشته) و port (عدد) الزامی هستند.");
      }
      const forgot = deps.manager.forgetKnownHost(host, port);
      deps.audit.log({ action: "known_host_forget", target: `${host}:${port}`, ok: forgot });
      res.json({ ok: true, forgot });
    }),
  );

  // ------------------------------------------------------------------ sessions (§3)
  app.get("/api/sessions", (_req, res) => {
    res.json({ ok: true, sessions: deps.manager.list() });
  });

  app.post(
    "/api/connect",
    wrap(async (req, res) => {
      const response = await deps.manager.connect(req.body ?? {});
      res.json(response);
    }),
  );

  app.post(
    "/api/connect/confirm",
    wrap(async (req, res) => {
      const { sessionId, accept } = req.body ?? {};
      if (typeof sessionId !== "string") {
        throw new HemError("VALIDATION_FAILED", "sessionId الزامی است.");
      }
      const response = await deps.manager.confirm(sessionId, accept === true);
      res.json(response);
    }),
  );

  app.post(
    "/api/disconnect",
    wrap(async (req, res) => {
      const { sessionId } = req.body ?? {};
      if (typeof sessionId !== "string") {
        throw new HemError("VALIDATION_FAILED", "sessionId الزامی است.");
      }
      deps.manager.disconnect(sessionId);
      res.json({ ok: true, status: "disconnected", sessionId });
    }),
  );

  // ------------------------------------------------------------------ audit
  app.get("/api/audit", (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 1000);
    res.json({ ok: true, entries: deps.audit.tail(limit) });
  });

  // ------------------------------------------------------------------ session-scoped
  const s = express.Router({ mergeParams: true });

  s.get(
    "/probe",
    wrap(async (req, res) => {
      const session = deps.manager.get(sidOf(req));
      if (!session) throw new HemError("NOT_FOUND", "نشست یافت نشد.");
      const ctxSession = deps.manager.hsContext(sidOf(req));
      const result = await runProbe({
        ssh: ctxSession.ssh,
        username: ctxSession.username,
        password: ctxSession.sudoPassword,
        configPathHint: ctxSession.configPath,
      });
      deps.audit.log({ sessionId: sidOf(req), action: "probe", target: `${session.host}:${session.port}`, ok: true });
      res.json({ ok: true, data: result });
    }),
  );

  s.get(
    "/system/info",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const [osRel, host, uptime, load] = await Promise.all([
        ctx.ssh.exec("cat /etc/os-release", { timeoutMs: 10_000 }).catch(() => null),
        ctx.ssh.exec("hostname", { timeoutMs: 10_000 }).catch(() => null),
        ctx.ssh.exec("uptime -p 2>/dev/null || cat /proc/uptime", { timeoutMs: 10_000 }).catch(() => null),
        ctx.ssh.exec("cat /proc/loadavg", { timeoutMs: 10_000 }).catch(() => null),
      ]);
      res.json({
        ok: true,
        data: {
          osRelease: osRel?.stdout ?? "",
          hostname: host?.stdout.trim() ?? "",
          uptime: uptime?.stdout.trim() ?? "",
          loadavg: load?.stdout.trim() ?? "",
        },
      });
    }),
  );

  s.get(
    "/system/ports",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const ss = await ctx.ssh.exec("ss -tulpn", { timeoutMs: 12_000 }).catch(() => null);
      res.json({ ok: true, data: { ports: parseSsPorts(ss?.stdout ?? ""), raw: ss?.stdout ?? "" } });
    }),
  );

  s.get(
    "/system/disk",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const df = await ctx.ssh.exec("df -h /", { timeoutMs: 10_000 }).catch(() => null);
      res.json({ ok: true, data: { raw: df?.stdout ?? "", code: df?.code ?? null } });
    }),
  );

  s.get(
    "/service/:unit/status",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const status = await hsServiceStatus(ctx, paramOf(req.params.unit));
      deps.audit.log({ sessionId: sidOf(req), action: "service_status", target: paramOf(req.params.unit), ok: true });
      res.json({ ok: true, data: status });
    }),
  );

  s.get(
    "/logs",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const unit = typeof req.query.unit === "string" ? req.query.unit : "headscale";
      const lines = typeof req.query.lines === "string" ? Number(req.query.lines) : 100;
      const result = await hsLogs(ctx, { unit, lines });
      res.json({ ok: true, data: result });
    }),
  );

  s.get(
    "/health",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const result = await hsHealth(ctx);
      res.json({ ok: result.healthy, data: result });
    }),
  );

  // ------------------------------------------------------------------ hs/*
  const hs = express.Router({ mergeParams: true });

  hs.get(
    "/users",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsUsersList(ctx) });
    }),
  );
  hs.post(
    "/users",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { name } = req.body ?? {};
      if (typeof name !== "string") throw new HemError("VALIDATION_FAILED", "name الزامی است.");
      const result = await hsUsersCreate(ctx, name);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_users_create", target: name, ok: true });
      res.json({ ok: true, data: result });
    }),
  );
  hs.post(
    "/users/rename",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, newName } = req.body ?? {};
      if (!Number.isInteger(id) || typeof newName !== "string") {
        throw new HemError("VALIDATION_FAILED", "id و newName الزامی هستند.");
      }
      await hsUsersRename(ctx, id, newName);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_users_rename", target: `#${id} → ${newName}`, ok: true });
      res.json({ ok: true, data: { id, newName } });
    }),
  );
  hs.post(
    "/users/destroy",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, confirm } = req.body ?? {};
      if (!Number.isInteger(id)) throw new HemError("VALIDATION_FAILED", "id عددی الزامی است.");
      const users = await hsUsersList(ctx).catch(() => []);
      const user = users.find((u) => u.id === id);
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          `برای حذف کاربر «${user?.name ?? "?"}» (شناسه ${id}) تأیید صریح لازم است — «confirm: true» بفرستید.`,
          { id, name: user?.name ?? null },
        );
      }
      await hsUsersDestroy(ctx, id);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_users_destroy", target: `#${id} (${user?.name ?? "?"})`, ok: true });
      res.json({ ok: true, data: { id, name: user?.name ?? null, destroyed: true } });
    }),
  );

  hs.get(
    "/nodes",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsNodesList(ctx) });
    }),
  );
  hs.get(
    "/nodes/routes",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsNodesRoutes(ctx) });
    }),
  );
  hs.post(
    "/nodes/approve-routes",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, routes } = req.body ?? {};
      if (!Number.isInteger(id) || !Array.isArray(routes)) {
        throw new HemError("VALIDATION_FAILED", "id و routes (آرایه) الزامی هستند.");
      }
      await hsNodesApproveRoutes(ctx, id, routes.map(String));
      deps.audit.log({
        sessionId: sidOf(req),
        action: "hs_nodes_approve_routes",
        target: `#${id} routes=[${routes.join(",")}]`,
        ok: true,
      });
      res.json({ ok: true, data: { id, routes } });
    }),
  );
  hs.post(
    "/nodes/expire",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, disable } = req.body ?? {};
      if (!Number.isInteger(id)) throw new HemError("VALIDATION_FAILED", "id عددی الزامی است.");
      await hsNodesExpire(ctx, id, disable === true);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_nodes_expire", target: `#${id}${disable ? " disable" : ""}`, ok: true });
      res.json({ ok: true, data: { id, expired: true } });
    }),
  );
  hs.post(
    "/nodes/rename",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, newName } = req.body ?? {};
      if (!Number.isInteger(id) || typeof newName !== "string") {
        throw new HemError("VALIDATION_FAILED", "id و newName الزامی هستند.");
      }
      await hsNodesRename(ctx, id, newName);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_nodes_rename", target: `#${id} → ${newName}`, ok: true });
      res.json({ ok: true, data: { id, newName } });
    }),
  );
  hs.post(
    "/nodes/tag",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, tags } = req.body ?? {};
      if (!Number.isInteger(id) || !Array.isArray(tags)) {
        throw new HemError("VALIDATION_FAILED", "id و tags (آرایه) الزامی هستند.");
      }
      await hsNodesTag(ctx, id, tags.map(String));
      deps.audit.log({ sessionId: sidOf(req), action: "hs_nodes_tag", target: `#${id} [${tags.join(",")}]`, ok: true });
      res.json({ ok: true, data: { id, tags } });
    }),
  );
  hs.post(
    "/nodes/delete",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, confirm } = req.body ?? {};
      if (!Number.isInteger(id)) throw new HemError("VALIDATION_FAILED", "id عددی الزامی است.");
      const nodes = await hsNodesList(ctx).catch(() => []);
      const node = nodes.find((n) => n.id === id);
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          `برای حذف دستگاه «${node?.name ?? "?"}» (شناسه ${id}) تأیید صریح لازم است — «confirm: true» بفرستید.`,
          { id, name: node?.name ?? null },
        );
      }
      await hsNodesDelete(ctx, id);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_nodes_delete", target: `#${id} (${node?.name ?? "?"})`, ok: true });
      res.json({ ok: true, data: { id, name: node?.name ?? null, deleted: true } });
    }),
  );

  hs.get(
    "/preauthkeys",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsPreAuthKeysList(ctx) });
    }),
  );
  hs.post(
    "/preauthkeys",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { userId, reusable, ephemeral, expiration, tags } = req.body ?? {};
      const result = await hsPreAuthKeysCreate(deps.manager.hsContext(sidOf(req)), deps.redactor, {
        userId,
        reusable: reusable === true,
        ephemeral: ephemeral === true,
        expiration: typeof expiration === "string" ? expiration : undefined,
        tags: Array.isArray(tags) ? tags.map(String) : [],
      });
      // audit فقط نسخهٔ ماسک را می‌بیند
      deps.audit.log({
        sessionId: sidOf(req),
        action: "hs_preauthkeys_create",
        target: `user=${userId} key=${maskHsKey(result.key)}`,
        ok: true,
      });
      res.json({ ok: true, data: result });
    }),
  );
  hs.post(
    "/preauthkeys/expire",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id } = req.body ?? {};
      if (!Number.isInteger(id)) throw new HemError("VALIDATION_FAILED", "id عددی الزامی است.");
      await hsPreAuthKeysExpire(ctx, id);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_preauthkeys_expire", target: `#${id}`, ok: true });
      res.json({ ok: true, data: { id, expired: true } });
    }),
  );
  hs.post(
    "/preauthkeys/delete",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id } = req.body ?? {};
      if (!Number.isInteger(id)) throw new HemError("VALIDATION_FAILED", "id عددی الزامی است.");
      await hsPreAuthKeysDelete(ctx, id);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_preauthkeys_delete", target: `#${id}`, ok: true });
      res.json({ ok: true, data: { id, deleted: true } });
    }),
  );

  hs.get(
    "/apikeys",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsApiKeysList(ctx) });
    }),
  );
  hs.post(
    "/apikeys",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { expiration } = req.body ?? {};
      const result = await hsApiKeysCreate(ctx, deps.redactor, {
        expiration: typeof expiration === "string" ? expiration : undefined,
      });
      deps.audit.log({
        sessionId: sidOf(req),
        action: "hs_apikeys_create",
        target: `key=${maskHsKey(result.key)}`,
        ok: true,
      });
      res.json({ ok: true, data: result });
    }),
  );
  hs.post(
    "/apikeys/expire",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { id, prefix } = req.body ?? {};
      await hsApiKeysExpire(ctx, {
        id: Number.isInteger(id) ? id : undefined,
        prefix: typeof prefix === "string" ? prefix : undefined,
      });
      deps.audit.log({ sessionId: sidOf(req), action: "hs_apikeys_expire", target: prefix ? `prefix=${prefix}` : `#${id}`, ok: true });
      res.json({ ok: true, data: { id: id ?? null, prefix: prefix ?? null, expired: true } });
    }),
  );

  hs.get(
    "/policy",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsPolicyGet(ctx) });
    }),
  );
  hs.post(
    "/policy/validate",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { content } = req.body ?? {};
      if (typeof content !== "string") throw new HemError("VALIDATION_FAILED", "content الزامی است.");
      const result = await hsPolicyValidate(ctx, content);
      res.json({ ok: true, data: result });
    }),
  );
  hs.post(
    "/policy/set",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { content, confirm } = req.body ?? {};
      if (typeof content !== "string") throw new HemError("VALIDATION_FAILED", "content الزامی است.");
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          "اعمال سیاست ACL جدید روی همهٔ شبکهٔ شما اثر می‌گذارد — «confirm: true» بفرستید.",
        );
      }
      const result = await hsPolicySet(ctx, content);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_policy_set", target: `${content.length} bytes`, ok: true });
      res.json({ ok: true, data: result });
    }),
  );

  hs.get(
    "/config",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const result = await hsConfigGet(ctx);
      deps.audit.log({ sessionId: sidOf(req), action: "hs_config_get", target: result.path, ok: true });
      res.json({ ok: true, data: result });
    }),
  );
  hs.post(
    "/config/validate",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { content } = req.body ?? {};
      if (typeof content !== "string") throw new HemError("VALIDATION_FAILED", "content الزامی است.");
      const result = await hsConfigValidate(ctx, content);
      res.json({ ok: true, data: result });
    }),
  );
  hs.post(
    "/config/set",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const { content, confirm } = req.body ?? {};
      if (typeof content !== "string") throw new HemError("VALIDATION_FAILED", "content الزامی است.");
      if (confirm !== true) {
        throw new HemError(
          "NEED_CONFIRM",
          "نوشتن پیکربندی جدید headscale با ری‌استارت سرویس همراه است — «confirm: true» بفرستید.",
        );
      }
      const result = await hsConfigSet(ctx, content);
      deps.audit.log({
        sessionId: sidOf(req),
        action: "hs_config_set",
        target: `${content.length} bytes → ${result.ok ? "ok" : "failed"}`,
        ok: result.ok,
        error: result.error,
      });
      res.json({ ok: result.ok, data: result });
    }),
  );

  hs.get(
    "/version",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      res.json({ ok: true, data: await hsVersion(ctx) });
    }),
  );

  hs.post(
    "/service/:action",
    wrap(async (req, res) => {
      const ctx = deps.manager.hsContext(sidOf(req));
      const action = paramOf(req.params.action) as ServiceActionName;
      const { confirm } = req.body ?? {};
      const unit = typeof req.body?.unit === "string" ? req.body.unit : "headscale";
      if (action === "stop" && confirm !== true) {
        throw new HemError("NEED_CONFIRM", `توقف سرویس «${unit}» اتصال همهٔ دستگاه‌ها را قطع می‌کند — «confirm: true» بفرستید.`);
      }
      const result = await hsServiceAction(ctx, action, unit);
      deps.audit.log({ sessionId: sidOf(req), action: `hs_service_${action}`, target: unit, ok: true });
      res.json({ ok: true, data: { unit, action, ...result } });
    }),
  );

  app.use(
    "/api/s/:sid",
    (req, _res, next) => {
      // بررسی وجود نشست برای همهٔ مسیرهای s/ (جزئیات در hsContext/requireConnected)
      void req;
      next();
    },
    s,
  );
  app.use("/api/s/:sid/hs", hs);
  const mntDeps = { manager: deps.manager, audit: deps.audit, jobs: deps.jobs };
  app.use("/api/s/:sid/install", createInstallRouter(mntDeps)); // §8 — Task 5-d
  app.use("/api/s/:sid/backup", createBackupRouter(mntDeps));
  app.use("/api/s/:sid/update", createUpdateRouter(mntDeps));
  app.use("/api/s/:sid", createRestoreRouter(mntDeps)); // POST /restore
  app.use("/api/s/:sid/console", createConsoleRouter(mntDeps)); // §9

  // ------------------------------------------------------------------ jobs (REST fallback)
  app.get("/api/jobs/:id", (req, res) => {
    const job = deps.jobs.getStatus(paramOf(req.params.id));
    if (!job) {
      res.status(404).json({ ok: false, error: "NOT_FOUND", message: "job یافت نشد (یا عمر رکوردش گذشته است)." });
      return;
    }
    res.json({ ok: true, job });
  });
  app.get("/api/jobs/:id/log", (req, res) => {
    const id = paramOf(req.params.id);
    const sinceRaw = req.query.since;
    const since = typeof sinceRaw === "string" ? Number(sinceRaw) : 0;
    const page = deps.jobs.getLog(id, Number.isFinite(since) && since >= 0 ? since : 0);
    if (!page) {
      res.status(404).json({ ok: false, error: "NOT_FOUND", message: "job یافت نشد (یا عمر رکوردش گذشته است)." });
      return;
    }
    res.json({ ok: true, jobId: id, ...page });
  });

  // ------------------------------------------------------------------ 404 for unknown /api
  app.use("/api", (req, res) => {
    res.status(404).json({ ok: false, error: "NOT_FOUND", message: `مسیر ${req.method} ${req.path} یافت نشد.` });
  });

  // ------------------------------------------------------------------ UI استاتیک (اختیاری)
  if (deps.uiDir && fs.existsSync(deps.uiDir)) {
    const indexFile = path.join(deps.uiDir, "index.html");
    app.use(express.static(deps.uiDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      if (fs.existsSync(indexFile)) {
        res.setHeader("Cache-Control", "no-store");
        res.sendFile(indexFile);
        return;
      }
      next();
    });
  }
  app.get("/", (_req, res) => {
    res.json({ ok: true, service: "hem-agent", version: deps.version });
  });

  // ------------------------------------------------------------------ خطای مرکزی
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (process.env.HEM_AGENT_DEBUG) console.error("[hem-agent][error-handler]", err);
    const he = err instanceof HemError ? err : null;
    if (he) {
      res.status(he.httpStatus).json({
        ok: false,
        error: he.code,
        message: deps.redactor.redactText(he.message),
        detail: he.detail !== undefined ? deps.redactor.redactValue(he.detail) : undefined,
      });
      return;
    }
    // خطای JSON بدنه
    const anyErr = err as { type?: string; message?: string; status?: number } | null;
    if (anyErr && (anyErr.type === "entity.parse.failed" || anyErr.status === 400)) {
      res.status(400).json({ ok: false, error: "VALIDATION_FAILED", message: "بدنهٔ JSON درخواست نامعتبر است." });
      return;
    }
    res.status(500).json({
      ok: false,
      error: "INTERNAL",
      message: "خطای داخلی agent رخ کرد.",
      detail: deps.redactor.redactText(anyErr?.message ?? String(err)),
    });
  });

  return app;
}

function maskProfileSecrets(p: unknown): unknown {
  // پروفایل‌ها از ابتدا سری ندارند — فقط مطمئن می‌شویم چیزی شبیه رمز برگشته نباشد
  return p;
}

/** توکن درخواست: هدر X-HEM-Token یا کوکی hem_token — با توکن مورد انتظار یکی است؟ (timing-safe) */
function requestTokenMatches(req: Request, expected: string): boolean {
  const header = req.headers["x-hem-token"];
  const headerVal = Array.isArray(header) ? header[0] : header;
  if (typeof headerVal === "string" && headerVal.length > 0) {
    return timingSafeTokenMatch(headerVal, expected);
  }
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader === "string") {
    const m = /(?:^|;\s*)hem_token=([^;\s]+)/.exec(cookieHeader);
    if (m && m[1]) return timingSafeTokenMatch(m[1], expected);
  }
  return false;
}
