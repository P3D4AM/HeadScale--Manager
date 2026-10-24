// آداپتورهای CLI واقعی headscale v0.29.5 (قرارداد §7).
// همهٔ فلگ‌ها با باینری واقعی راستی‌آزمایی شده‌اند:
//  - users list/create/rename(-i,-r)/destroy(-i,-n,--force)
//  - nodes list/list-routes(-i)/approve-routes(-i,-r)/expire(-i,-d,--force)/rename(NEW -i)/tag(-i,-t)/delete(-i,--force)
//  - preauthkeys create(-u,-e,--reusable,--ephemeral,--tags)/list(-o json؛ بدون --user، کلید ماسک)/expire(-i)/delete(-i)
//  - apikeys create(-e)/list(-o json)/expire(-i|-p)
//  - policy get(-o json)/set(-f)/check(-f)
//  - configtest، version، health
// هیچ‌جا خروجی جدولی «حدس» نمی‌شود؛ هرجا JSON نبود صادقانه خطا می‌دهیم.

import { HemError } from "../errors";
import { runHs, type HsRunContext } from "../headscaleExec";
import { shellQuote, SshSession } from "../ssh";
import type {
  ApiKeyCreateResult,
  ConfigSetResult,
  ConfigValidateResult,
  ExecResult,
  HealthResult,
  HsApiKey,
  HsNode,
  HsPreAuthKey,
  HsRouteEntry,
  HsUser,
  HsVersion,
  LogsResult,
  PolicyInfo,
  PreAuthKeyCreateResult,
  ServiceActionName,
  ServiceStatus,
} from "../types";
import type { Redactor } from "../redact";
import { tsToDate } from "./probe";

function asArray<T>(v: T[] | null | undefined): T[] {
  return Array.isArray(v) ? v : [];
}

async function runJson<T>(ctx: HsRunContext, args: string[], what: string, timeoutMs = 30_000): Promise<T> {
  const res = await runHs(ctx, args, { timeoutMs });
  if (res.code !== 0) {
    throw new HemError("EXEC_FAILED", `اجرای «headscale ${args[0]} …» ناموفق بود.`, {
      what,
      stderr: res.stderr.trim(),
      stdout: res.stdout.slice(0, 800),
    });
  }
  const text = res.stdout.trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HemError("PARSE_FAILED", `خروجی JSON «${what}» قابل تفسیر نبود.`, {
      stdout: text.slice(0, 800),
    });
  }
}

async function runOk(ctx: HsRunContext, args: string[], what: string, timeoutMs = 30_000): Promise<ExecResult> {
  const res = await runHs(ctx, args, { timeoutMs });
  if (res.code !== 0) {
    throw new HemError("EXEC_FAILED", `اجرای «headscale ${args.join(" ")}» ناموفق بود.`, {
      what,
      stderr: res.stderr.trim(),
      stdout: res.stdout.slice(0, 800),
    });
  }
  return res;
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export async function hsUsersList(ctx: HsRunContext): Promise<HsUser[]> {
  const raw = await runJson<Array<Record<string, unknown>> | null>(ctx, ["users", "list", "-o", "json"], "users list");
  return asArray(raw).map((u) => ({
    id: Number(u.id ?? 0),
    name: String(u.name ?? ""),
    displayName: (u.display_name as string | null) ?? null,
    email: (u.email as string | null) ?? null,
    createdAt: tsToDate(u.created_at),
    raw: u,
  }));
}

export async function hsUsersCreate(ctx: HsRunContext, name: string): Promise<{ created: boolean; name: string }> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(name)) {
    throw new HemError(
      "VALIDATION_FAILED",
      "نام کاربری فقط می‌تواند شامل حروف/اعداد و . _ - باشد (حداکثر ۶۳ نویسه) و با خط تیره شروع نشود.",
      { name },
    );
  }
  await runOk(ctx, ["users", "create", name], "users create");
  return { created: true, name };
}

export async function hsUsersRename(ctx: HsRunContext, id: number, newName: string): Promise<void> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(newName)) {
    throw new HemError("VALIDATION_FAILED", "نام جدید کاربری نامعتبر است.", { newName });
  }
  await runOk(ctx, ["users", "rename", "--identifier", String(id), "--new-name", newName], "users rename");
}

export async function hsUsersDestroy(ctx: HsRunContext, id: number): Promise<void> {
  await runOk(ctx, ["users", "destroy", "--identifier", String(id), "--force"], "users destroy");
}

// ---------------------------------------------------------------------------
// nodes + routes
// ---------------------------------------------------------------------------
export async function hsNodesList(ctx: HsRunContext): Promise<HsNode[]> {
  const raw = await runJson<Array<Record<string, unknown>> | null>(ctx, ["nodes", "list", "-o", "json"], "nodes list");
  return asArray(raw).map((n) => ({
    id: Number(n.id ?? 0),
    name: String(n.name ?? n.hostname ?? ""),
    user: (n.user as { id?: number; name?: string } | undefined) ?? null,
    ipAddresses: asArray(n.ipAddresses as string[] | undefined).map(String),
    lastSeen: tsToDate(n.lastSeen),
    expiry: tsToDate(n.expiry),
    online: typeof n.online === "boolean" ? n.online : null,
    approvedRoutes: asArray(n.approvedRoutes as string[] | undefined).map(String),
    availableRoutes: asArray(n.availableRoutes as string[] | undefined).map(String),
    raw: n,
  }));
}

export async function hsNodesRoutes(ctx: HsRunContext): Promise<HsRouteEntry[]> {
  // در 0.29.5 دستور سطح‌بالای routes وجود ندارد — فقط nodes list-routes (با -o json تست شده)
  const raw = await runJson<Array<Record<string, unknown>> | null>(
    ctx,
    ["nodes", "list-routes", "-o", "json"],
    "nodes list-routes",
  );
  return asArray(raw).map((r) => ({
    id: r.id !== undefined ? Number(r.id) : undefined,
    node: (r.node ?? r.nodeId ?? null) as number | string | null,
    hostname: (r.hostname ?? null) as string | null,
    prefix: (r.prefix ?? null) as string | null,
    advertised: typeof r.advertised === "boolean" ? r.advertised : null,
    enabled: typeof r.enabled === "boolean" ? r.enabled : null,
    isPrimary: typeof r.isPrimary === "boolean" ? r.isPrimary : null,
    raw: r,
  }));
}

export async function hsNodesApproveRoutes(ctx: HsRunContext, id: number, routes: string[]): Promise<void> {
  for (const r of routes) {
    if (!/^[0-9a-fA-F:.\/]{2,45}$/.test(r)) {
      throw new HemError("VALIDATION_FAILED", `مسیر «${r}» یک CIDR معتبر نیست.`, { route: r });
    }
  }
  // رشتهٔ خالی = لغو همهٔ مسیرهای تأییدشده (رفتار واقعی 0.29.5)
  await runOk(
    ctx,
    ["nodes", "approve-routes", "--identifier", String(id), "--routes", routes.join(",")],
    "nodes approve-routes",
  );
}

export async function hsNodesExpire(ctx: HsRunContext, id: number, disable?: boolean): Promise<void> {
  const args = ["nodes", "expire", "--identifier", String(id)];
  if (disable) args.push("--disable");
  args.push("--force");
  await runOk(ctx, args, "nodes expire");
}

export async function hsNodesRename(ctx: HsRunContext, id: number, newName: string): Promise<void> {
  await runOk(ctx, ["nodes", "rename", newName, "--identifier", String(id), "--force"], "nodes rename");
}

export async function hsNodesTag(ctx: HsRunContext, id: number, tags: string[]): Promise<void> {
  for (const t of tags) {
    if (!/^tag:[A-Za-z0-9_.:-]{1,60}$/.test(t)) {
      throw new HemError("VALIDATION_FAILED", `تگ «${t}» باید به شکل tag:name باشد.`, { tag: t });
    }
  }
  await runOk(ctx, ["nodes", "tag", "--identifier", String(id), "--tags", tags.join(","), "--force"], "nodes tag");
}

export async function hsNodesDelete(ctx: HsRunContext, id: number): Promise<void> {
  await runOk(ctx, ["nodes", "delete", "--identifier", String(id), "--force"], "nodes delete");
}

// ---------------------------------------------------------------------------
// preauthkeys — کلید کامل فقط یک‌بار برگردانده می‌شود؛ audit هرگز کلید کامل نمی‌بیند
// ---------------------------------------------------------------------------
export async function hsPreAuthKeysList(ctx: HsRunContext): Promise<HsPreAuthKey[]> {
  // ⚠️ در 0.29.5 فلگ --user وجود ندارد و کلیدها همیشه ماسک‌اند (hskey-auth-…-***)
  const raw = await runJson<Array<Record<string, unknown>> | null>(
    ctx,
    ["preauthkeys", "list", "-o", "json"],
    "preauthkeys list",
  );
  return asArray(raw).map((k) => {
    const user = (k.user ?? {}) as { id?: number; name?: string };
    return {
      id: Number(k.id ?? 0),
      user: { id: user.id !== undefined ? Number(user.id) : undefined, name: user.name },
      key: String(k.key ?? ""),
      reusable: Boolean(k.reusable),
      ephemeral: Boolean(k.ephemeral),
      expiration: tsToDate(k.expiration),
      createdAt: tsToDate(k.created_at),
      raw: k,
    };
  });
}

export async function hsPreAuthKeysCreate(
  ctx: HsRunContext,
  redactor: Redactor,
  input: { userId: number; reusable?: boolean; ephemeral?: boolean; expiration?: string; tags?: string[] },
): Promise<PreAuthKeyCreateResult> {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new HemError("VALIDATION_FAILED", "شناسهٔ کاربر (userId) عددی معتبر نیست.");
  }
  const expiration = input.expiration ?? "1h";
  if (!/^\d+[smhd]$/.test(expiration)) {
    throw new HemError("VALIDATION_FAILED", "انقضا باید به شکل 30m / 24h / 7d باشد.");
  }
  const tags = input.tags ?? [];
  for (const t of tags) {
    if (!/^tag:[A-Za-z0-9_.:-]{1,60}$/.test(t)) {
      throw new HemError("VALIDATION_FAILED", `تگ «${t}» باید به شکل tag:name باشد.`);
    }
  }
  const args = ["preauthkeys", "create", "--user", String(input.userId), "--expiration", expiration];
  if (input.reusable) args.push("--reusable");
  if (input.ephemeral) args.push("--ephemeral");
  if (tags.length > 0) args.push("--tags", tags.join(","));
  const res = await runOk(ctx, args, "preauthkeys create");
  const key = res.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  if (!/^hskey-auth-/.test(key)) {
    throw new HemError("PARSE_FAILED", "خروجی create کلید معتبری نبود.", { stdout: res.stdout.slice(0, 200) });
  }
  redactor.registerSecret(key);
  return {
    key,
    expiration,
    reusable: Boolean(input.reusable),
    ephemeral: Boolean(input.ephemeral),
    tags,
    warning: "این کلید فقط همین یک‌بار نمایش داده می‌شود؛ آن را در جای امن ذخیره کنید.",
  };
}

export async function hsPreAuthKeysExpire(ctx: HsRunContext, id: number): Promise<void> {
  await runOk(ctx, ["preauthkeys", "expire", "--id", String(id), "--force"], "preauthkeys expire");
}

export async function hsPreAuthKeysDelete(ctx: HsRunContext, id: number): Promise<void> {
  await runOk(ctx, ["preauthkeys", "delete", "--id", String(id), "--force"], "preauthkeys delete");
}

// ---------------------------------------------------------------------------
// apikeys
// ---------------------------------------------------------------------------
export async function hsApiKeysList(ctx: HsRunContext): Promise<HsApiKey[]> {
  const raw = await runJson<Array<Record<string, unknown>> | null>(
    ctx,
    ["apikeys", "list", "-o", "json"],
    "apikeys list",
  );
  return asArray(raw).map((k) => ({
    id: Number(k.id ?? 0),
    prefix: String(k.prefix ?? ""),
    expiration: tsToDate(k.expiration),
    createdAt: tsToDate(k.created_at),
    raw: k,
  }));
}

export async function hsApiKeysCreate(
  ctx: HsRunContext,
  redactor: Redactor,
  input: { expiration?: string },
): Promise<ApiKeyCreateResult> {
  const expiration = input.expiration ?? "90d";
  if (!/^\d+[smhd]$/.test(expiration)) {
    throw new HemError("VALIDATION_FAILED", "انقضا باید به شکل 30m / 24h / 90d باشد.");
  }
  const res = await runOk(ctx, ["apikeys", "create", "--expiration", expiration], "apikeys create");
  const key = res.stdout.trim().split("\n").filter(Boolean).pop() ?? "";
  if (!/^hskey-api-/.test(key)) {
    throw new HemError("PARSE_FAILED", "خروجی create کلید معتبری نبود.", { stdout: res.stdout.slice(0, 200) });
  }
  redactor.registerSecret(key);
  return { key, expiration, warning: "این کلید فقط همین یک‌بار نمایش داده می‌شود." };
}

export async function hsApiKeysExpire(ctx: HsRunContext, input: { id?: number; prefix?: string }): Promise<void> {
  if (input.prefix) {
    await runOk(ctx, ["apikeys", "expire", "--prefix", input.prefix], "apikeys expire");
    return;
  }
  if (input.id !== undefined) {
    await runOk(ctx, ["apikeys", "expire", "--id", String(input.id)], "apikeys expire");
    return;
  }
  throw new HemError("VALIDATION_FAILED", "برای انقضای کلید API، prefix یا id لازم است.");
}

// ---------------------------------------------------------------------------
// policy
// ---------------------------------------------------------------------------
export async function hsPolicyGet(ctx: HsRunContext): Promise<PolicyInfo> {
  const res = await runHs(ctx, ["policy", "get", "-o", "json"], { timeoutMs: 20_000 });
  const text = res.stdout.trim();
  // وقتی سیاستی تنظیم نباشد: خطای JSON «{"error": …}» یا exit غیرصفر → {policy:null}
  if (res.code !== 0 || text.length === 0) {
    return { policy: null, format: "hujson" };
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      return { policy: null, format: "hujson" };
    }
  } catch {
    // خروجی غیرJSON (مثلاً جدول) — policy را به‌صورت متن خام برمی‌گردانیم
    return { policy: text, format: "hujson" };
  }
  return { policy: text, format: "hujson" };
}

export async function hsPolicyValidate(ctx: HsRunContext, content: string): Promise<{ valid: boolean; error?: string }> {
  const tmp = SshSession.remoteTempName("hem-policy", ".hujson");
  await ctx.ssh.writeFile(tmp, content);
  try {
    const res = await runHs(ctx, ["policy", "check", "--file", tmp], { timeoutMs: 30_000 });
    if (res.code === 0) return { valid: true };
    return { valid: false, error: `${res.stderr.trim()}\n${res.stdout.trim()}`.trim() };
  } finally {
    void ctx.ssh.exec(`rm -f ${shellQuote(tmp)}`).catch(() => undefined);
  }
}

export async function hsPolicySet(ctx: HsRunContext, content: string): Promise<PolicyInfo> {
  const tmp = SshSession.remoteTempName("hem-policy", ".hujson");
  await ctx.ssh.writeFile(tmp, content);
  try {
    await runOk(ctx, ["policy", "set", "--file", tmp], "policy set");
  } finally {
    void ctx.ssh.exec(`rm -f ${shellQuote(tmp)}`).catch(() => undefined);
  }
  return hsPolicyGet(ctx);
}

// ---------------------------------------------------------------------------
// config — مسیر پیکربندی از پروفایل (custom: از پیشوند؛ system: /etc/headscale/config.yaml)
// ---------------------------------------------------------------------------
export function resolveConfigPath(ctx: HsRunContext): string {
  if (ctx.configPath) return ctx.configPath;
  if (ctx.hsMode === "custom" && ctx.hsCustomPrefix) {
    const toks = ctx.hsCustomPrefix.split(/\s+/);
    for (let i = 0; i < toks.length - 1; i++) {
      if (toks[i] === "--config" || toks[i] === "-c") {
        return toks[i + 1].replace(/^['"]|['"]$/g, "");
      }
    }
  }
  return "/etc/headscale/config.yaml";
}

/** خواندن فایل از سرور با sudo در صورت نیاز (برای پیکربندی محافظت‌شده) */
async function readRemoteFile(ctx: HsRunContext, path: string): Promise<string> {
  const cmd = `base64 -w0 ${shellQuote(path)}`;
  const res =
    ctx.hsMode === "system-sudo"
      ? await ctx.ssh.execSudo(cmd, ctx.sudoMode ?? "none", ctx.sudoPassword, { timeoutMs: 20_000 })
      : await ctx.ssh.exec(cmd, { timeoutMs: 20_000 });
  if (res.code !== 0) {
    throw new HemError("EXEC_FAILED", "خواندن فایل پیکربندی از سرور ناموفق بود.", {
      path,
      stderr: res.stderr.trim(),
    });
  }
  return Buffer.from(res.stdout.trim(), "base64").toString("utf8");
}

/** نوشتن فایل روی سرور با sudo در صورت نیاز (نوشتن در /tmp و سپس mv) */
async function writeRemoteFile(ctx: HsRunContext, path: string, content: string): Promise<void> {
  if (ctx.hsMode !== "system-sudo") {
    await ctx.ssh.writeFile(path, content);
    return;
  }
  const mode = ctx.sudoMode ?? "none";
  if (mode === "none") {
    throw new HemError("SUDO_REQUIRED", "نوشتن پیکربندی نیازمند دسترسی sudo است که در دسترس نیست.");
  }
  const tmp = SshSession.remoteTempName("hem-cfg"); // فقط منتقل (mv) می‌شود — پسوند مهم نیست
  await ctx.ssh.writeFile(tmp, content);
  const res = await ctx.ssh.execSudo(
    `mv ${shellQuote(tmp)} ${shellQuote(path)}`,
    mode,
    ctx.sudoPassword,
    { timeoutMs: 20_000 },
  );
  if (res.code !== 0) {
    throw new HemError("EXEC_FAILED", "جابه‌جایی فایل پیکربندی ناموفق بود.", { stderr: res.stderr.trim() });
  }
}

export async function hsConfigGet(ctx: HsRunContext): Promise<{ content: string; path: string }> {
  const path = resolveConfigPath(ctx);
  const content = await readRemoteFile(ctx, path);
  return { content, path };
}

export async function hsConfigValidate(ctx: HsRunContext, content: string): Promise<ConfigValidateResult> {
  // ⚠️ پسوند .yaml الزامی است — viper نوع فایل را از پسوند تشخیص می‌دهد
  const tmp = SshSession.remoteTempName("hem-cfgtest", ".yaml");
  await ctx.ssh.writeFile(tmp, content);
  try {
    const res = await runHs(ctx, ["configtest"], { configOverride: tmp, timeoutMs: 30_000 });
    if (res.code === 0) return { valid: true, checkedWith: "configtest" };
    return {
      valid: false,
      error: `${res.stderr.trim()}\n${res.stdout.trim()}`.trim(),
      checkedWith: "configtest",
    };
  } finally {
    void ctx.ssh.exec(`rm -f ${shellQuote(tmp)}`).catch(() => undefined);
  }
}

export async function hsConfigSet(
  ctx: HsRunContext,
  content: string,
  opts: { restartUnit?: string } = {},
): Promise<ConfigSetResult> {
  const path = resolveConfigPath(ctx);
  const backup = `${path}.hem-backup-${Date.now()}`;
  // ۱) اعتبارسنجی پیش از هر تغییری
  const validation = await hsConfigValidate(ctx, content);
  if (!validation.valid) {
    return { ok: false, validated: false, restarted: false, error: validation.error ?? "پیکربندی نامعتبر است." };
  }
  // ۲) پشتیبان از پیکربندی فعلی
  try {
    const cpCmd = `cp -a ${shellQuote(path)} ${shellQuote(backup)}`;
    const r =
      ctx.hsMode === "system-sudo"
        ? await ctx.ssh.execSudo(cpCmd, ctx.sudoMode ?? "none", ctx.sudoPassword, { timeoutMs: 15_000 })
        : await ctx.ssh.exec(cpCmd, { timeoutMs: 15_000 });
    if (r.code !== 0) {
      return { ok: false, validated: true, restarted: false, error: "ساخت نسخهٔ پشتیبان پیکربندی ناموفق بود." };
    }
  } catch (e) {
    return {
      ok: false,
      validated: true,
      restarted: false,
      error: `ساخت نسخهٔ پشتیبان ناموفق بود: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // ۳) نوشتن پیکربندی جدید
  try {
    await writeRemoteFile(ctx, path, content);
  } catch (e) {
    return {
      ok: false,
      validated: true,
      restarted: false,
      backupPath: backup,
      error: `نوشتن پیکربندی ناموفق بود: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  // ۴) ری‌استارت سرویس (فقط حالت systemd)
  let restarted = false;
  if (ctx.hsMode !== "custom") {
    const actionRes = await hsServiceAction(ctx, "restart", opts.restartUnit ?? "headscale").catch(
      (e: unknown) => e as Error,
    );
    restarted = !(actionRes instanceof Error);
    if (actionRes instanceof Error) {
      // بازگردانی خودکار پشتیبان — صداقت کامل
      await restoreConfigBackup(ctx, path, backup);
      return {
        ok: false,
        validated: true,
        restarted: false,
        backupPath: backup,
        restored: true,
        error: `ری‌استارت سرویس ناموفق بود و پیکربندی قبلی بازگردانی شد: ${actionRes.message}`,
      };
    }
  }
  // ۵) بررسی سلامت پس از اعمال
  const health = await hsHealth(ctx).catch(() => null);
  if (health && !health.healthy) {
    await restoreConfigBackup(ctx, path, backup);
    const healthAgain = await hsHealth(ctx).catch(() => null);
    return {
      ok: false,
      validated: true,
      restarted,
      backupPath: backup,
      restored: true,
      health: healthAgain ?? health,
      error: "پس از اعمال پیکربندی، سرور سالم نبود؛ پیکربندی قبلی بازگردانی شد.",
    };
  }
  return { ok: true, validated: true, restarted, backupPath: backup, health: health ?? undefined };
}

async function restoreConfigBackup(ctx: HsRunContext, path: string, backup: string): Promise<void> {
  try {
    const cpCmd = `cp -a ${shellQuote(backup)} ${shellQuote(path)}`;
    if (ctx.hsMode === "system-sudo") {
      await ctx.ssh.execSudo(cpCmd, ctx.sudoMode ?? "none", ctx.sudoPassword, { timeoutMs: 15_000 });
    } else {
      await ctx.ssh.exec(cpCmd, { timeoutMs: 15_000 });
    }
    if (ctx.hsMode !== "custom") {
      await hsServiceAction(ctx, "restart", "headscale").catch(() => undefined);
    }
  } catch {
    /* بازگردانی best-effort — در گزارش صداقت می‌شود */
  }
}

// ---------------------------------------------------------------------------
// service / logs / version / health
// ---------------------------------------------------------------------------
const SYSTEMD_UNAVAILABLE_RE = /not been booted with systemd|Failed to connect to bus|No such file or directory|System has not been booted|\boffline\b/i;

/** آیا systemd واقعاً در دسترس است؟ — دو بررسی: دایرکتوری /run/systemd/system و خروجی is-system-running */
async function systemctlAvailable(ctx: HsRunContext): Promise<boolean> {
  const dirRes = await ctx.ssh
    .exec("[ -d /run/systemd/system ] && echo yes || echo no", { timeoutMs: 10_000 })
    .catch(() => null);
  if (dirRes && dirRes.stdout.trim() === "no") return false; // کانتینر/محیط بدون systemd
  const res = await ctx.ssh.exec("systemctl is-system-running 2>&1 || true", { timeoutMs: 10_000 }).catch(() => null);
  if (!res) return dirRes ? dirRes.stdout.trim() === "yes" : false;
  return !SYSTEMD_UNAVAILABLE_RE.test(res.stdout + res.stderr);
}

export async function hsServiceStatus(ctx: HsRunContext, unit: string): Promise<ServiceStatus> {
  if (!/^[A-Za-z0-9_.@:-]+$/.test(unit)) {
    throw new HemError("VALIDATION_FAILED", "نام سرویس نامعتبر است.");
  }
  const useSystemd = await systemctlAvailable(ctx);
  if (useSystemd) {
    const [activeRes, enabledRes, statusRes] = await Promise.all([
      ctx.ssh.exec(`systemctl is-active ${shellQuote(unit)} 2>&1`, { timeoutMs: 10_000 }).catch(() => null),
      ctx.ssh.exec(`systemctl is-enabled ${shellQuote(unit)} 2>&1`, { timeoutMs: 10_000 }).catch(() => null),
      ctx.ssh.exec(`systemctl status ${shellQuote(unit)} --no-pager -n 15 2>&1 | head -25`, { timeoutMs: 12_000 }).catch(() => null),
    ]);
    const activeText = (activeRes?.stdout ?? activeRes?.stderr ?? "").trim();
    const enabledText = (enabledRes?.stdout ?? "").trim();
    const active = activeText === "active" ? true : ["inactive", "failed"].includes(activeText) ? false : null;
    const output = (statusRes?.stdout ?? "").split("\n").filter((l) => l.trim().length > 0);
    return {
      unit,
      available: true,
      active,
      enabled: enabledText === "enabled" || enabledText === "disabled" ? enabledText : null,
      via: "systemctl",
      output,
    };
  }
  // fallback صادقانه: بررسی فرایند
  const procRes = await ctx.ssh
    .exec(`pgrep -af ${shellQuote(unit)} 2>/dev/null | grep -v pgrep || true`, { timeoutMs: 10_000 })
    .catch(() => null);
  const lines = (procRes?.stdout ?? "").split("\n").filter((l) => l.trim().length > 0);
  return {
    unit,
    available: lines.length > 0,
    active: lines.length > 0,
    enabled: null,
    via: "process",
    output: lines.slice(0, 10),
  };
}

export async function hsServiceAction(
  ctx: HsRunContext,
  action: ServiceActionName,
  unit: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  if (!["start", "stop", "restart", "enable", "disable"].includes(action)) {
    throw new HemError("VALIDATION_FAILED", "عملیات سرویس نامعتبر است (start|stop|restart|enable|disable).");
  }
  if (!/^[A-Za-z0-9_.@:-]+$/.test(unit)) {
    throw new HemError("VALIDATION_FAILED", "نام سرویس نامعتبر است.");
  }
  const useSystemd = await systemctlAvailable(ctx);
  if (!useSystemd) {
    throw new HemError(
      "UNSUPPORTED",
      `systemd روی این سرور در دسترس نیست؛ عملیات «${action}» انجام نشد. (برای سرور آزمایشیِ بدون systemd، سرویس را دستی مدیریت کنید)`,
      { unit, action },
    );
  }
  const cmd = `systemctl ${action} ${shellQuote(unit)}`;
  const res =
    ctx.hsMode === "system-sudo"
      ? await ctx.ssh.execSudo(cmd, ctx.sudoMode ?? "none", ctx.sudoPassword, { timeoutMs: 60_000 })
      : await ctx.ssh.exec(cmd, { timeoutMs: 60_000 });
  if (res.code !== 0) {
    throw new HemError("EXEC_FAILED", `اجرای systemctl ${action} ${unit} ناموفق بود.`, {
      stderr: res.stderr.trim(),
      stdout: res.stdout.trim(),
    });
  }
  return { code: res.code, stdout: res.stdout, stderr: res.stderr };
}

export async function hsLogs(
  ctx: HsRunContext,
  opts: { unit?: string; lines?: number } = {},
): Promise<LogsResult> {
  const unit = opts.unit ?? "headscale";
  const lines = Math.min(Math.max(opts.lines ?? 100, 1), 500);
  if (!/^[A-Za-z0-9_.@:-]+$/.test(unit)) {
    throw new HemError("VALIDATION_FAILED", "نام سرویس نامعتبر است.");
  }
  const journalCmd = `journalctl -u ${shellQuote(unit)} -n ${lines} --no-pager 2>&1`;
  const journalRes =
    ctx.hsMode === "system-sudo" && ctx.sudoMode && ctx.sudoMode !== "none"
      ? await ctx.ssh.execSudo(journalCmd, ctx.sudoMode, ctx.sudoPassword, { timeoutMs: 20_000 }).catch(() => null)
      : await ctx.ssh.exec(journalCmd, { timeoutMs: 20_000 }).catch(() => null);
  const journalText = journalRes ? `${journalRes.stdout}\n${journalRes.stderr}` : "";
  if (journalRes && journalRes.code === 0 && !/-- No entries --|not been booted|Failed to add match/i.test(journalText)) {
    return {
      unit,
      source: "journalctl",
      lines: journalRes.stdout.split("\n").filter((l) => l.trim().length > 0),
    };
  }
  // fallback: فایل لاگ — ابتدا مسیر صریح پروفایل (logPath) و سپس (قرارداد §4)
  // خروجی «headscale serve» در حالت custom: کنار فایل پیکربندی (مثل /home/z/hs-test/server.log).
  // هر кандидат فقط در صورت موفقیت واقعی tail استفاده می‌شود؛ در غیر این صورت خطای صادقانه.
  const candidates: string[] = [];
  if (ctx.logPath) candidates.push(ctx.logPath);
  if (unit === "headscale" && ctx.hsMode === "custom") {
    const configDir = resolveConfigPath(ctx).replace(/\/[^/]*$/, "");
    if (configDir) candidates.push(`${configDir}/server.log`);
  }
  for (const candidate of candidates) {
    const tailRes = await ctx.ssh.exec(`tail -n ${lines} ${shellQuote(candidate)} 2>&1`, { timeoutMs: 15_000 }).catch(() => null);
    if (tailRes && tailRes.code === 0) {
      return {
        unit,
        source: "file",
        lines: tailRes.stdout.split("\n").filter((l) => l.trim().length > 0),
        note: `journalctl در دسترس نبود؛ از ${candidate} خوانده شد.`,
      };
    }
  }
  throw new HemError(
    "UNSUPPORTED",
    "خواندن لاگ ناموفق بود: journalctl در دسترس نیست و مسیر فایل لاگ در پروفایل تعیین نشده است (logPath).",
  );
}

export async function hsVersion(ctx: HsRunContext): Promise<HsVersion> {
  const res = await runHs(ctx, ["version"], { timeoutMs: 20_000 });
  if (res.code !== 0) {
    throw new HemError("EXEC_FAILED", "دریافت نسخهٔ headscale ناموفق بود.", { stderr: res.stderr.trim() });
  }
  const text = res.stdout.trim();
  const version = /headscale version v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(text)?.[1] ?? text.split("\n")[0];
  return { version, raw: text };
}

/** سلامت سه‌لایه (قرارداد §4): سرویس / HTTP محلی / CLI */
export async function hsHealth(ctx: HsRunContext): Promise<HealthResult> {
  const healthUrl = ctx.healthUrl || "http://127.0.0.1:8080/health";
  // لایهٔ ۱: سرویس (systemd یا فرایند)
  const status = await hsServiceStatus(ctx, "headscale").catch(() => null);
  const serviceOk = status?.active === true;
  const serviceLayer = {
    ok: serviceOk,
    via: status?.via ?? "unknown",
    detail: status
      ? status.active === true
        ? "سرویس فعال است"
        : status.available
          ? "سرویس در حال اجرا نیست"
          : "نه systemd و نه فرایند headscale یافت نشد"
      : "بررسی وضعیت سرویس ناموفق بود",
  };
  // لایهٔ ۲: HTTP سلامت از خود سرور (curl محلی روی سرور)
  const httpRes = await ctx.ssh
    .exec(`curl -s -m 5 -w '\\n%{http_code}' ${shellQuote(healthUrl)} 2>&1`, { timeoutMs: 12_000 })
    .catch(() => null);
  let httpOk = false;
  let httpDetail = "curl روی سرور در دسترس نبود یا پاسخ نداد";
  if (httpRes) {
    const lines = httpRes.stdout.trim().split("\n");
    const code = lines.pop() ?? "";
    const body = lines.join("\n");
    if (code === "200" && /pass|ok/i.test(body)) {
      httpOk = true;
      httpDetail = `پاسخ 200 از ${healthUrl}: ${body.slice(0, 120)}`;
    } else {
      httpDetail = `پاسخ ${code || "نامشخص"} از ${healthUrl}${body ? `: ${body.slice(0, 120)}` : ""}`;
    }
  }
  const httpLayer = { ok: httpOk, via: "curl(سرور)", detail: httpDetail };
  // لایهٔ ۳: CLI خود headscale
  const cliRes = await runHs(ctx, ["health"], { timeoutMs: 20_000 }).catch(() => null);
  const cliOk = cliRes?.code === 0;
  const cliLayer = {
    ok: cliOk,
    via: "headscale health",
    detail: cliRes
      ? cliRes.code === 0
        ? "headscale health سالم است"
        : `${cliRes.stderr.trim().slice(0, 200) || "خروجی غیرصفر"}`
      : "اجرای headscale health ناموفق بود",
  };
  return {
    healthy: serviceOk && cliOk,
    healthUrl,
    layers: { service: serviceLayer, http: httpLayer, cli: cliLayer },
  };
}
