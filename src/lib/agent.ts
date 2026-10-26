'use client'

/**
 * ماژول یگانهٔ دسترسی به hem-agent (پورت 3005).
 *
 * قواعد محیط sandbox:
 *  - همهٔ درخواست‌ها «همان‌مبدأ» و نسبی‌اند؛ درخواست به agent با افزودن
 *    پارامتر query «XTransformPort» از دروازهٔ Caddy عبور می‌کند.
 *  - در حالت دسکتاپ (agent خودش UI را سرو می‌کند) همین کد بدون تغییر کار
 *    می‌کند — پارامتر اضافی بی‌ضرر است.
 *  - هرگز از آدرس مطلق http://localhost:3005 در fetch یا socket استفاده نکنید.
 */

import { io, type Socket } from 'socket.io-client'

export const AGENT_PORT = process.env.NEXT_PUBLIC_AGENT_PORT ?? '3005'

/** افزودن XTransformPort به مسیر (با حفظ queryهای موجود) */
export function agentPath(path: string): string {
  const hashIdx = path.indexOf('#')
  const hash = hashIdx >= 0 ? path.slice(hashIdx) : ''
  const base = hashIdx >= 0 ? path.slice(0, hashIdx) : path
  const qIdx = base.indexOf('?')
  const pathname = qIdx >= 0 ? base.slice(0, qIdx) : base
  const search = qIdx >= 0 ? base.slice(qIdx + 1) : ''
  const params = new URLSearchParams(search)
  params.set('XTransformPort', AGENT_PORT)
  return `${pathname}?${params.toString()}${hash}`
}

/** کد خطای تایپ‌شدهٔ agent (قرارداد §3.5) */
export type AgentErrorCode =
  | 'AUTH_FAILED'
  | 'CONNECT_TIMEOUT'
  | 'CONNECT_FAILED'
  | 'HOSTKEY_CHANGED'
  | 'FINGERPRINT_REQUIRED'
  | 'NOT_CONNECTED'
  | 'EXEC_FAILED'
  | 'PARSE_FAILED'
  | 'NEED_CONFIRM'
  | 'UNSUPPORTED'
  | 'SUDO_REQUIRED'
  | 'VALIDATION_FAILED'
  | 'COMMAND_BLOCKED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'NOT_IMPLEMENTED_YET'
  | 'INTERNAL'
  | (string & {})

export class AgentError extends Error {
  readonly code: AgentErrorCode
  readonly detail: unknown
  readonly status: number
  /**
   * بدنهٔ کامل JSON پاسخ خطا (اگر پاسخ JSON بود).
   * افزودنی ۶-ب: برخی اندپوینت‌ها (مثل install/validate) با HTTP 200 و
   * ok:false خروجی واقعی (output/plan) برمی‌گردانند؛ برای نمایش صادقانهٔ
   * همان خروجی لازم است. برای مصرف‌کننده‌های قبلی کاملاً اختیاری است.
   */
  readonly body?: unknown

  constructor(code: AgentErrorCode, message: string, detail?: unknown, status?: number, body?: unknown) {
    super(message)
    this.name = 'AgentError'
    this.code = code
    this.detail = detail
    this.status = status ?? 0
    this.body = body
  }
}

/** خطای شبکه/دسترسی به agent (دروازه پایین است، CORS و…) */
export class AgentUnreachableError extends AgentError {
  constructor(cause?: unknown) {
    super(
      'AGENT_UNREACHABLE',
      'ارتباط با سرویس مدیریت (hem-agent) برقرار نشد. اگر برنامه را به‌صورت دسکتاپ اجرا می‌کنید، مطمئن شوید سرویس در حال اجراست.',
      cause instanceof Error ? cause.message : undefined
    )
    this.name = 'AgentUnreachableError'
  }
}

interface AgentErrorBody {
  ok?: false
  error?: AgentErrorCode
  message?: string
  detail?: unknown
}

/**
 * fetch به agent — همهٔ فراخوانی‌های API برنامه باید از همین تابع بگذرند.
 * خطاها همیشه به‌صورت AgentError با پیام فارسی پرتاب می‌شوند.
 */
export async function agentFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(agentPath(path), {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch (err) {
    throw new AgentUnreachableError(err)
  }

  const body = (await res.json().catch(() => null)) as
    | (AgentErrorBody & Record<string, unknown>)
    | null

  if (!res.ok || body?.ok === false) {
    throw new AgentError(
      body?.error ?? `HTTP_${res.status}`,
      body?.message ?? `خطای HTTP ${res.status} در ارتباط با سرویس مدیریت.`,
      body?.detail,
      res.status,
      body
    )
  }
  return body as T
}

/** GET راحت‌تر برای queryهای react */
export function agentGet<T>(path: string): Promise<T> {
  return agentFetch<T>(path)
}

export function agentPost<T>(path: string, data?: unknown): Promise<T> {
  return agentFetch<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) })
}

export function agentPut<T>(path: string, data?: unknown): Promise<T> {
  return agentFetch<T>(path, { method: 'PUT', body: JSON.stringify(data ?? {}) })
}

export function agentDelete<T>(path: string): Promise<T> {
  return agentFetch<T>(path, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// socket.io — سینگلتون
// ---------------------------------------------------------------------------

let socketInstance: Socket | null = null

/**
 * سوکت یگانهٔ socket.io به agent.
 * مسیر همیشه «/» می‌ماند و پورت فقط از طریق XTransformPort منتقل می‌شود
 * (دروازهٔ Caddy بر اساس همین پارامتر query مسیر را به agent می‌برد).
 */
export function agentSocket(): Socket {
  if (!socketInstance) {
    socketInstance = io(`/?XTransformPort=${AGENT_PORT}`, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
      timeout: 15_000,
    })
  }
  return socketInstance
}

// ---------------------------------------------------------------------------
// انواع مشترک با agent (قرارداد AGENT-API.md §types) — فقط آنچه UI لازم دارد
// ---------------------------------------------------------------------------

export type AuthMethod = 'password' | 'key'
export type HsMode = 'system-sudo' | 'system' | 'custom'
export type SudoMode = 'root' | 'nopasswd' | 'password' | 'none'
export type SessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'fingerprint-required'
  | 'connected'
  | 'error'

export interface HostKeyFingerprint {
  algo: string
  hash: string
  base64Md5: string
}

export interface KnownHostEntry {
  algo: string
  sha256: string
  firstSeen: string
}

export interface HostKeyChangeDetail {
  stored: KnownHostEntry
  presented: HostKeyFingerprint
  host: string
  port: number
}

export interface Profile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  keyPath?: string
  hsMode: HsMode
  hsCustomPrefix?: string
  healthUrl?: string
  logPath?: string
  configPath?: string
  createdAt: string
  updatedAt: string
}

export interface ProfilesResponse {
  ok: true
  profiles: Profile[]
}

export interface KnownHostsResponse {
  ok: true
  knownHosts: Record<string, KnownHostEntry>
}

export interface SessionInfo {
  id: string
  status: SessionStatus
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  profileId?: string
  hsMode: HsMode
  sudoMode?: SudoMode
  createdAt: string
  connectedAt?: string
  fingerprint?: HostKeyFingerprint
  lastError?: string
}

export interface SessionsResponse {
  ok: true
  sessions: SessionInfo[]
}

export interface ConnectInlineInput {
  host: string
  port?: number
  username: string
  authMethod: AuthMethod
  password?: string
  keyPath?: string
  passphrase?: string
  hsMode?: HsMode
  hsCustomPrefix?: string
  healthUrl?: string
  logPath?: string
  configPath?: string
}

export interface ConnectResponse {
  status: 'fingerprint-required' | 'connected' | 'declined'
  sessionId: string
  fingerprint?: HostKeyFingerprint
  sudoMode?: SudoMode
  serverInfo?: { banner?: string; fingerprint?: HostKeyFingerprint }
  warning?: string
}

export interface ConnStatusEvent {
  sessionId: string
  status: 'connected' | 'disconnected' | 'error'
  detail?: string
}

export interface HealthLayer {
  ok: boolean
  via: string
  detail: string
}

export interface HealthResult {
  healthy: boolean
  healthUrl: string
  layers: {
    service: HealthLayer
    http: HealthLayer
    cli: HealthLayer
  }
}

export interface ProbeResult {
  os: { id: string; versionId: string; pretty: string; arch: string }
  kernel: string
  python3: { version: string | null; hasYaml: boolean }
  systemd: { available: boolean; initPid: number | null }
  disk: { rootGb: number; availGb: number }
  mem: { totalMb: number; availMb: number }
  cpu: { cores: number }
  net: { publicIp: string | null; isCgnat: boolean | null; addresses: string[] }
  ports: { proto: string; local: string; port: number | null; process: string | null }[]
  firewall: { ufw: 'active' | 'inactive' | 'not-installed'; otherRules: boolean }
  sudo: { mode: SudoMode }
  existing: {
    headscale: { installed: boolean; version: string | null; serviceActive: boolean | null }
    caddy: { installed: boolean; version: string | null; serviceActive: boolean | null }
    nginx: { installed: boolean; version: string | null; serviceActive: boolean | null }
  }
  headscaleConfigExists: boolean
  hemInstalled: { stateFile: boolean; hsctlOnPath: boolean }
  warnings: string[]
  blockers: string[]
  probedAt: string
}

export interface HsUser {
  id: number
  name: string
  displayName?: string | null
  email?: string | null
  createdAt?: string | null
}

export interface HsNode {
  id: number
  /** نام نمایشی — given_name سرور (همان که «تغییر نام» عوضش می‌کند)؛ در نبودش hostname */
  name: string
  /** نامی که خود دستگاه گزارش کرده (فیلد name سرور) — بعد از تغییر نام با name فرق می‌کند */
  hostname?: string
  user?: { id?: number; name?: string } | null
  ipAddresses?: string[]
  lastSeen?: string | null
  expiry?: string | null
  online?: boolean | null
  approvedRoutes?: string[]
  availableRoutes?: string[]
  /** دادهٔ خام JSON خط nodes list — فیلدهای اضافی (مثل tags) از همین‌جا */
  raw?: Record<string, unknown>
}

export interface HsPreAuthKey {
  id: number
  user: { id?: number; name?: string }
  key: string
  reusable: boolean
  ephemeral?: boolean
  expiration?: string | null
  createdAt?: string | null
}

export interface HsVersionResult {
  version: string
  raw: string
}

export interface AgentHealth {
  ok: true
  service: 'hem-agent'
  version: string
  uptimeSec: number
  platform: string
  sessions: number
}

/** پاسخ استاندارد {ok,data} */
export interface OkData<T> {
  ok: true
  data: T
}
