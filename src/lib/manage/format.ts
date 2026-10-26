/**
 * قالب‌بندی مشترک بخش‌های مدیریت — تاریخ فارسی، وضعیت دستگاه/کلید، انقضاها.
 * همهٔ توابع خالص‌اند و هیچ داده‌ای جعل نمی‌کنند؛ فقط همان چیزی را نشان
 * می‌دهند که headscale واقعاً برگردانده است.
 */

/** آیا تاریخ «زمان صفر» است؟ (سال ۱ میلادی = انقضای تنظیم‌نشده در پروتوباف) */
function isZeroTime(d: Date): boolean {
  return d.getFullYear() <= 1
}

/**
 * تبدیل مقدار تاریخ خام headscale به ISO — پشتیبانی از:
 *  - رشتهٔ ISO/CSS (خروجی نرمال‌شدهٔ agent)
 *  - تایم‌استمپ پروتوباف {seconds, nanos} (کلیدهای snake_case در دادهٔ خام
 *    «nodes list -o json» نسخهٔ 0.29.5 — راستی‌آزمایی‌شده روی سرور واقعی)
 */
export function protoTsToIso(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : value
  }
  if (typeof value === 'object') {
    const obj = value as { seconds?: unknown; nanos?: unknown }
    const sec = Number(obj.seconds)
    if (Number.isFinite(sec) && sec > 0) {
      const nanos = Number(obj.nanos ?? 0)
      const d = new Date(sec * 1000 + Math.floor(nanos / 1_000_000))
      return Number.isNaN(d.getTime()) ? null : d.toISOString()
    }
  }
  return null
}

/** تاریخ و ساعت ISO به شکل فارسی خوانا (تقویم fa-IR) */
export function formatDateTimeFa(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || isZeroTime(d)) return '—'
  return d.toLocaleString('fa-IR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** فقط تاریخ (بدون ساعت) */
export function formatDateFa(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || isZeroTime(d)) return '—'
  return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' })
}

/** فاصلهٔ زمانی نسبی فارسی: «۳ دقیقه پیش» / «۲ روز پیش» */
export function relativeTimeFa(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime()) || isZeroTime(d)) return '—'
  const neg = d.getTime() - now.getTime()
  const absSec = Math.abs(neg) / 1000
  const past = neg < 0
  const fa = (n: number) => Math.round(n).toLocaleString('fa-IR')
  let text: string
  if (absSec < 60) text = `${fa(absSec)} ثانیه`
  else if (absSec < 3600) text = `${fa(absSec / 60)} دقیقه`
  else if (absSec < 86_400) text = `${fa(absSec / 3600)} ساعت`
  else if (absSec < 2_592_000) text = `${fa(absSec / 86_400)} روز`
  else text = `${fa(absSec / 2_592_000)} ماه`
  return past ? `${text} پیش` : `تا ${text} دیگر`
}

/** آیا تاریخ (انقضا) گذشته است؟ — null یعنی بی‌انتها/نامشخص */
export function isPast(iso: string | null | undefined, now: Date = new Date()): boolean {
  if (!iso) return false
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.getTime() < now.getTime()
}

// ---------------------------------------------------------------------------
// وضعیت دستگاه
// ---------------------------------------------------------------------------

export type NodeStatus = 'online' | 'offline' | 'expired'

export interface NodeStatusInfo {
  status: NodeStatus
  label: string
  /** کلاس‌های Badge */
  className: string
}

/**
 * وضعیت واقعی دستگاه از دادهٔ headscale:
 *  - expired: انقضای کلید گذشته (raw.expired یا expiry در گذشته)
 *  - online: فیلد online سرور (نرمال‌شده یا raw — کلید هر دو یکسان است)
 *  - offline: بقیهٔ حالات
 *
 * نکتهٔ 0.29.5: خروجی JSON با کلیدهای snake_case است (raw.last_seen،
 * raw.ip_addresses)؛ فیلدهای نرمال‌شدهٔ agent برای این‌ها خالی می‌مانند، پس
 * از دادهٔ خام هم به‌عنوان پشتیبان استفاده می‌کنیم.
 */
export function nodeStatus(
  node: { online?: boolean | null; lastSeen?: string | null; expiry?: string | null; raw?: Record<string, unknown> },
  now: Date = new Date()
): NodeStatusInfo {
  const raw = node.raw ?? {}
  const expiredRaw = raw['expired'] === true
  const expiryIso = node.expiry ?? protoTsToIso(raw['expiry'])
  const zeroTime = expiryIso ? new Date(expiryIso).getFullYear() <= 1 : false
  const expiredByTime = isPast(expiryIso, now) && !zeroTime
  if (expiredRaw || expiredByTime) {
    return {
      status: 'expired',
      label: 'منقضی',
      className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    }
  }
  const onlineRaw = raw['online']
  if (node.online === true || onlineRaw === true) {
    return {
      status: 'online',
      label: 'آنلاین',
      className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    }
  }
  return {
    status: 'offline',
    label: 'آفلاین',
    className: 'border-border bg-muted text-muted-foreground',
  }
}

/** آدرس‌های IP دستگاه — نرمال‌شدهٔ agent یا raw.ip_addresses (0.29.5 واقعی) */
export function nodeIps(node: { ipAddresses?: string[]; raw?: Record<string, unknown> }): string[] {
  const direct = node.ipAddresses ?? []
  if (direct.length > 0) return direct
  const rawIps = node.raw?.['ip_addresses'] ?? node.raw?.['ipAddresses']
  return Array.isArray(rawIps) ? rawIps.map(String) : []
}

/** آخرین اتصال دستگاه — نرمال‌شدهٔ agent یا raw.last_seen (تایم‌استمپ پروتوباف) */
export function nodeLastSeen(node: { lastSeen?: string | null; raw?: Record<string, unknown> }): string | null {
  if (node.lastSeen) return node.lastSeen
  return protoTsToIso(node.raw?.['last_seen'] ?? node.raw?.['lastSeen'])
}

/** برچسب‌های (tags) دستگاه از دادهٔ خام headscale — فقط اگر واقعاً موجود باشد */
export function nodeTags(raw: Record<string, unknown> | undefined): string[] {
  if (!raw) return []
  const out = new Set<string>()
  // 'tags' — همان فیلدی که «nodes tag» واقعی 0.29.5 بعد از موفقیت می‌نویسد
  // (با باینری واقعی راستی‌آزمایی شد)؛ بقیه برای سازگاری با شکل‌های قدیمی/آینده.
  for (const field of ['tags', 'forcedTags', 'forced_tags', 'validTags', 'valid_tags', 'givenTags', 'given_tags']) {
    const v = raw[field]
    if (Array.isArray(v)) {
      for (const t of v) if (typeof t === 'string' && t) out.add(t)
    }
  }
  return [...out].sort()
}

// ---------------------------------------------------------------------------
// انقضای کلیدها
// ---------------------------------------------------------------------------

export const EXPIRATION_PRESETS: { value: string; label: string }[] = [
  { value: '1h', label: '۱ ساعت (1h)' },
  { value: '24h', label: '۲۴ ساعت (24h)' },
  { value: '7d', label: '۷ روز (7d)' },
  { value: '30d', label: '۳۰ روز (30d)' },
]

export const APIKEY_EXPIRATION_PRESETS: { value: string; label: string }[] = [
  { value: '1d', label: '۱ روز (1d)' },
  { value: '7d', label: '۷ روز (7d)' },
  { value: '30d', label: '۳۰ روز (30d)' },
  { value: '90d', label: '۹۰ روز (90d)' },
]

/** الگوی واقعی که agent/headscale می‌پذیرد: مثل 30m / 24h / 7d / 90d */
export const EXPIRATION_PATTERN = /^\d+[smhd]$/

export const EXPIRATION_CUSTOM_HELP =
  'قالب مورد پذیرش headscale: عدد + یکای s (ثانیه)، m (دقیقه)، h (ساعت) یا d (روز) — مثال: 45m یا 14d'

/** اعتبارسنجی برچسب — همان regex واقعی agent: tag:name */
export const TAG_PATTERN = /^tag:[A-Za-z0-9_.:-]{1,60}$/

export const TAG_SYNTAX_HELP = 'هر برچسب باید به شکل tag:name باشد (مثال: tag:office) — با ویرگول جدا کنید.'

// ---------------------------------------------------------------------------
// مسیرها (CIDR)
// ---------------------------------------------------------------------------

/**
 * اعتبارسنجی CIDR — IPv4 (مثل 192.168.1.0/24) یا IPv6 (مثل fd00::/8).
 * طول پیشوند هم از نظر محدوده بررسی می‌شود (خطای «no '/'» و پارس سرور
 * واقعی 0.29.5 با همین قیدها جلوی گرفته می‌شود).
 */
export function isValidCidr(value: string): boolean {
  const m = /^(.+?)\/(\d{1,3})$/.exec(value.trim())
  if (!m) return false
  const addr = m[1]
  const len = Number(m[2])
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(addr)
  if (v4) {
    if (len > 32) return false
    return v4.slice(1).every((octet) => {
      const n = Number(octet)
      return Number.isInteger(n) && n >= 0 && n <= 255
    })
  }
  // IPv6 — حداقل یک «:»، نویسه‌های مجاز، و حداکثر یک «::»
  if (!/^[0-9a-fA-F:]+$/.test(addr) || !addr.includes(':')) return false
  const doubleColon = addr.match(/::/g)
  if (doubleColon && doubleColon.length > 1) return false
  return len <= 128
}

export const CIDR_SYNTAX_HELP =
  'هر مسیر باید یک CIDR کامل باشد: آدرس شبکه + / طول پیشوند (مثال: 192.168.1.0/24) — با ویرگول جدا کنید.'

/** نام کاربر — همان regex واقعی agent */
export const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/

export const USERNAME_SYNTAX_HELP =
  'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد و نویسه‌های . _ - باشد (حداکثر ۶۳ نویسه) و نباید با خط تیره یا نقطه شروع شود.'
