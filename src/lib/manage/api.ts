/**
 * انواع و عملیات REST بخش‌های مدیریت (کاربران/دستگاه‌ها/کلیدها/مسیرها/سیاست).
 *
 * شکل پاسخ‌ها عیناً از hem-agent واقعی (mini-services/hem-agent/src/api.ts)
 * و باینری headscale v0.29.5 راستی‌آزمایی شده است — هیچ فیلدی حدس زده نشده.
 * همهٔ فراخوانی‌ها از agentFetch می‌گذرند (XTransformPort خودکار اضافه می‌شود).
 */

import { AgentError, agentPost } from '@/lib/agent'
import type { HsNode, HsUser } from '@/lib/agent'

// ---------------------------------------------------------------------------
// انواع پاسخ‌ها
// ---------------------------------------------------------------------------

/** یک مسیر از nodes list-routes واقعی 0.29.5 */
export interface HsRouteEntry {
  id?: number
  /** شناسهٔ دستگاه (node یا nodeId) */
  node: number | string | null
  hostname: string | null
  prefix: string | null
  advertised: boolean | null
  /** همان Approved — تأییدشده روی سرور */
  enabled: boolean | null
  isPrimary: boolean | null
  raw?: Record<string, unknown>
}

/** یک ردیف مسیر در جدول UI (پیشوند + وضعیت‌های واقعی) */
export interface RouteRow {
  prefix: string
  /** دستگاه این پیشوند را اعلام کرده است (available) */
  advertised: boolean
  /** سرور این پیشوند را تأیید کرده است (approved) */
  enabled: boolean
  /** مسیر اصلی HA — فقط اگر سرور گزارش کرده باشد (در 0.29.5 JSON نیست) */
  isPrimary: boolean | null
}

/** گروه مسیرهای یک دستگاه */
export interface RouteGroup {
  key: string
  nodeId: number | null
  hostname: string
  routes: RouteRow[]
}

/** کلید API — prefix همیشه ماسک (hskey-api-…-***) */
export interface HsApiKey {
  id: number
  prefix: string
  expiration: string | null
  createdAt: string | null
  raw?: Record<string, unknown>
}

/** پاسخ GET policy — policy===null یعنی هنوز سیاستی تنظیم نشده */
export interface PolicyInfo {
  policy: string | null
  format: 'hujson' | 'json'
}

export interface PolicyValidateResult {
  valid: boolean
  error?: string
}

/** پاسخ ساخت PreAuthKey — کلید کامل فقط همین یک‌بار */
export interface PreAuthKeyCreateResult {
  key: string
  expiration: string
  reusable: boolean
  ephemeral: boolean
  tags: string[]
  warning: string
}

/** پاسخ ساخت API Key — کلید کامل فقط همین یک‌بار */
export interface ApiKeyCreateResult {
  key: string
  expiration: string
  warning: string
}

export interface UserDestroyResult {
  id: number
  name: string | null
  destroyed: boolean
}

export interface NodeDeleteResult {
  id: number
  name: string | null
  deleted: boolean
}

// ---------------------------------------------------------------------------
// عملیات (همهٔ آدرس‌ها نسبت به نشست فعال)
// ---------------------------------------------------------------------------

/** پیشوند مسیر API مدیریت headscale برای یک نشست */
export function hsPath(sid: string, sub: string): string {
  return `/api/s/${sid}/hs/${sub.replace(/^\//, '')}`
}

// ── کاربران ────────────────────────────────────────────────────────────────

export function hsUserCreate(sid: string, name: string) {
  return agentPost<OkData<{ created: boolean; name: string }>>(hsPath(sid, 'users'), { name })
}

export function hsUserRename(sid: string, id: number, newName: string) {
  return agentPost<OkData<{ id: number; newName: string }>>(hsPath(sid, 'users/rename'), { id, newName })
}

export function hsUserDestroy(sid: string, id: number) {
  return agentPost<OkData<UserDestroyResult>>(hsPath(sid, 'users/destroy'), { id, confirm: true })
}

// ── دستگاه‌ها ───────────────────────────────────────────────────────────────

export function hsNodeExpire(sid: string, id: number, disable?: boolean) {
  return agentPost<OkData<{ id: number; expired: boolean }>>(hsPath(sid, 'nodes/expire'), {
    id,
    ...(disable === true ? { disable: true } : {}),
  })
}

export function hsNodeRename(sid: string, id: number, newName: string) {
  return agentPost<OkData<{ id: number; newName: string }>>(hsPath(sid, 'nodes/rename'), { id, newName })
}

export function hsNodeTag(sid: string, id: number, tags: string[]) {
  return agentPost<OkData<{ id: number; tags: string[] }>>(hsPath(sid, 'nodes/tag'), { id, tags })
}

export function hsNodeDelete(sid: string, id: number) {
  return agentPost<OkData<NodeDeleteResult>>(hsPath(sid, 'nodes/delete'), { id, confirm: true })
}

export function hsNodeApproveRoutes(sid: string, id: number, routes: string[]) {
  return agentPost<OkData<{ id: number; routes: string[] }>>(hsPath(sid, 'nodes/approve-routes'), {
    id,
    routes,
  })
}

// ── کلیدهای اتصال (PreAuth) ────────────────────────────────────────────────

export interface PreAuthKeyInput {
  userId: number
  reusable?: boolean
  ephemeral?: boolean
  expiration?: string
  tags?: string[]
}

export function hsPreAuthKeyCreate(sid: string, input: PreAuthKeyInput) {
  return agentPost<OkData<PreAuthKeyCreateResult>>(hsPath(sid, 'preauthkeys'), input)
}

export function hsPreAuthKeyExpire(sid: string, id: number) {
  return agentPost<OkData<{ id: number; expired: boolean }>>(hsPath(sid, 'preauthkeys/expire'), { id })
}

export function hsPreAuthKeyDelete(sid: string, id: number) {
  return agentPost<OkData<{ id: number; deleted: boolean }>>(hsPath(sid, 'preauthkeys/delete'), { id })
}

// ── کلیدهای API ─────────────────────────────────────────────────────────────

export function hsApiKeyCreate(sid: string, expiration?: string) {
  return agentPost<OkData<ApiKeyCreateResult>>(hsPath(sid, 'apikeys'), { expiration })
}

export function hsApiKeyExpire(sid: string, prefix: string) {
  return agentPost<OkData<{ id: number | null; prefix: string | null; expired: boolean }>>(
    hsPath(sid, 'apikeys/expire'),
    { prefix }
  )
}

// ── سیاست دسترسی ────────────────────────────────────────────────────────────

export function hsPolicyValidate(sid: string, content: string) {
  return agentPost<OkData<PolicyValidateResult>>(hsPath(sid, 'policy/validate'), { content })
}

export function hsPolicySet(sid: string, content: string) {
  return agentPost<OkData<PolicyInfo>>(hsPath(sid, 'policy/set'), { content, confirm: true })
}

// ---------------------------------------------------------------------------
// کمکی‌ها
// ---------------------------------------------------------------------------

/**
 * متن خطای agent برای توست — پیام فارسی + خروجی خام واقعی (stderr) اگر
 * عملیات روی سرور شکست خورده باشد؛ صادقانه و بدون سانسور.
 * خطاهای شناخته‌شدهٔ headscale (راستی‌آزمایی‌شده با باینری واقعی 0.29.5)
 * پیش از نمایش، به توضیح فارسیِ قابل‌فهم ترجمه می‌شوند.
 */
export function agentErrText(err: unknown): string {
  if (err instanceof AgentError) {
    const detail = err.detail as { stderr?: unknown; stdout?: unknown } | undefined
    const stderr = typeof detail?.stderr === 'string' ? detail.stderr.trim() : ''
    const translated = translateHsError(stderr)
    if (translated) return translated
    if (stderr) return `${err.message} — خروجی سرور: ${stderr}`
  }
  return err instanceof Error ? err.message : 'خطای نامشخص.'
}

/**
 * ترجمهٔ خطاهای شناخته‌شدهٔ سرور به توضیح فارسیِ ریشه‌یابی‌شده.
 * متن‌های داخل شرط‌ها عین خروجی واقعی headscale v0.29.5 هستند
 * (با باینری واقعی تست شدند — نه حدس).
 */
export function translateHsError(stderr: string): string | null {
  if (!stderr) return null
  // nodes tag: تگ در سیاست دسترسی (tagOwners) تعریف نشده
  if (stderr.includes('requested tags') && stderr.includes('not permitted')) {
    return 'سرور این برچسب را نپذیرفت: در headscale هر برچسب باید ابتدا در سیاست دسترسی (بخش tagOwners) تعریف شود. ابتدا از بخش «سیاست ACL» برچسب را به tagOwners اضافه کنید (فصل ۸ آموزش) و دوباره امتحان کنید.'
  }
  // nodes tag: پاک‌کردن همهٔ تگ‌ها
  if (stderr.includes('cannot remove all tags')) {
    return 'سرور اجازه نمی‌دهد همهٔ برچسب‌های یک دستگاه هم‌زمان برداشته شود (دستگاهِ برچسب‌دار باید حداقل یک برچسب داشته باشد). اگر برچسب خاصی را نمی‌خواهید، فقط همان را از فهرست حذف کنید و بقیه را نگه دارید.'
  }
  // approve-routes: CIDR بی‌نقص نبودن
  if (stderr.includes('parsing route') || stderr.includes('no \'/\'')) {
    return 'قالب مسیر پذیرفته نشد — مسیر باید یک CIDR کامل باشد، یعنی آدرس شبکه + طول پیشوند (مثال درست: 192.168.1.0/24؛ غلط: 192.168.1.5 یا 192.168.1.0).'
  }
  return null
}

/** stderr خام خطای agent (برای نمایش در بلوک LTR) — اگر وجود نداشته باشد null */
export function agentErrDetail(err: unknown): string | null {
  if (err instanceof AgentError) {
    const detail = err.detail as { stderr?: unknown; stdout?: unknown } | undefined
    const parts = [
      typeof detail?.stderr === 'string' ? detail.stderr.trim() : '',
      typeof detail?.stdout === 'string' ? detail.stdout.trim() : '',
    ].filter(Boolean)
    return parts.length > 0 ? parts.join('\n') : null
  }
  return null
}

/** پاسخ استاندارد {ok,data} — بدون import دایره‌ای از agent.ts */
export interface OkData<T> {
  ok: true
  data: T
}

/**
 * نام نمایشی کاربر یک دستگاه — فقط از دادهٔ واقعی: user.name (اگر سرور
 * فرستاده باشد) وگرنه کاربر ناشناس.
 */
export function nodeUserName(node: HsNode): string {
  const name = node.user?.name
  return typeof name === 'string' && name.length > 0 ? name : '—'
}

/** نام نمایشی کاربر در جدول کلیدها */
export function keyUserName(user: { id?: number; name?: string } | undefined): string {
  const name = user?.name
  return typeof name === 'string' && name.length > 0 ? name : `#${user?.id ?? '?'}`
}

/** پیداکردن نام کاربر از فهرست واقعی بر اساس id */
export function userNameById(users: HsUser[] | undefined, id: number | undefined): string | undefined {
  if (id === undefined || !users) return undefined
  return users.find((u) => u.id === id)?.name
}

/**
 * گروه‌بندی مسیرها بر اساس دستگاه — برای «لغو همهٔ مسیرهای این دستگاه».
 *
 * ⚠️ شکل واقعی «nodes list-routes -o json» در 0.29.5 (راستی‌آزمایی‌شده با
 * باینری واقعی): خروجی آرایه‌ای از «دستگاه‌ها»ست، نه ردیف‌های per-route — یعنی
 * id همان شناسهٔ دستگاه است و مسیرها در raw.available_routes / raw.approved_routes
 * (کلیدهای snake_case) می‌آیند؛ فیلدهای نرمال‌شدهٔ hostname/prefix/enabled همگی
 * null هستند. حالت per-route (فیلدهای مستقیم) هم برای سازگاری آینده پشتیبانی
 * می‌شود.
 *
 * نکتهٔ مهم (تست واقعی): دستگاهی که فقط «مسیر تأییدشده» دارد (مثلاً مسیری که
 * مدیر از پنل اضافه کرده) ممکن است اصلاً کلید available_routes را نداشته باشد
 * — چنین ردیفی هم باید به‌عنوان گروهِ همان دستگاه خوانده شود، وگرنه مسیرهای
 * تأییدشده‌اش به‌کل از جدول می‌افتند.
 */
export function groupRoutesByNode(routes: HsRouteEntry[] | undefined): RouteGroup[] {
  const map = new Map<string, RouteGroup>()
  for (const r of routes ?? []) {
    const raw = r.raw ?? {}
    const rawAvailable = raw['available_routes'] ?? raw['availableRoutes']
    const rawApproved = raw['approved_routes'] ?? raw['approvedRoutes']

    // ── حالت 0.29.5: هر ردیف یک دستگاه است (available یا approved هر دو ممکن
    //    است غایب باشند؛ حضورِ هر کدام برای شناسایی حالت کافی است) ──
    if (Array.isArray(rawAvailable) || Array.isArray(rawApproved)) {
      const nodeId = typeof r.id === 'number' && Number.isFinite(r.id) ? r.id : null
      const available = Array.isArray(rawAvailable) ? rawAvailable.map(String) : []
      const approved = Array.isArray(rawApproved) ? rawApproved.map(String) : []
      // نام نمایشی: given_name (نامی که «تغییر نام» عوضش می‌کند) اولویت دارد
      const hostname =
        String(raw['given_name'] ?? raw['givenName'] ?? raw['name'] ?? r.hostname ?? '') ||
        (r.node !== null ? String(r.node) : '') ||
        'ناشناس'
      const key = nodeId !== null ? `id:${nodeId}` : `h:${hostname}`
      // اجتماع مسیرهای اعلام‌شده و مسیرهای همچنان تأییدشده (مسیر تأییدشده‌ای که
      // دستگاه دیگر اعلامش نمی‌کند هم دیده می‌شود تا بتوان تأییدش را لغو کرد)
      const union = [...new Set([...available, ...approved])].sort()
      const group: RouteGroup = {
        key,
        nodeId,
        hostname,
        routes: union.map((prefix) => ({
          prefix,
          advertised: available.includes(prefix),
          enabled: approved.includes(prefix),
          isPrimary: null,
        })),
      }
      map.set(key, group)
      continue
    }

    // ── حالت per-route (سازگاری با شکل‌های دیگر/آینده) ──
    const nodeId =
      typeof r.node === 'number'
        ? r.node
        : typeof r.id === 'number' && Number.isFinite(r.id)
          ? r.id
          : null
    const hostname = r.hostname ?? (r.node !== null ? String(r.node) : 'ناشناس')
    const key = nodeId !== null ? `id:${nodeId}` : `h:${hostname}`
    const prefix = typeof r.prefix === 'string' ? r.prefix : null
    if (!prefix) continue
    let g = map.get(key)
    if (!g) {
      g = { key, nodeId, hostname, routes: [] }
      map.set(key, g)
    }
    // در حالت per-route هر ردیف یک مسیر است؛ دوباری‌ها ادغام می‌شوند
    if (!g.routes.some((row) => row.prefix === prefix)) {
      g.routes.push({
        prefix,
        advertised: r.advertised === true,
        enabled: r.enabled === true,
        isPrimary: r.isPrimary,
      })
    }
  }
  return [...map.values()].sort((a, b) => a.hostname.localeCompare(b.hostname))
}

/** پیشوندهای یک گروه که الان روی سرور تأیید شده‌اند (enabled===true) */
export function approvedPrefixes(group: { routes: RouteRow[] }): string[] {
  return group.routes.filter((r) => r.enabled && r.prefix).map((r) => r.prefix)
}

/** آیا این پیشوند یک Exit Node است؟ (0.0.0.0/0 یا ::/0) */
export function isExitNodePrefix(prefix: string): boolean {
  return prefix === '0.0.0.0/0' || prefix === '::/0'
}
