/**
 * تایپ‌های مشترک بخش‌های عملیاتی سرور (۶-د) — مطابق قرارداد AGENT-API.md §§4,5,9,10
 * و پیاده‌سازی واقعی hem-agent (src/api.ts، backupctl.ts، updatectl.ts، console.ts).
 * این تایپ‌ها فقط «آنچه UI لازم دارد» را مدل می‌کنند؛ هیچ دادهٔ فرضی ندارند.
 */

import type { HealthResult } from '@/lib/agent'

// ---------------------------------------------------------------------------
// پیکربندی (hs/config*)
// ---------------------------------------------------------------------------

/** GET hs/config → {ok,data} */
export interface ConfigInfo {
  content: string
  path: string
}

/** POST hs/config/validate → {ok,data} */
export interface ConfigValidateResult {
  valid: boolean
  error?: string
  checkedWith: string
}

/** POST hs/config/set → {ok: <نتیجهٔ واقعی>, data} — honest؛ ok:false یعنی خطا + بازگردانی */
export interface ConfigSetResult {
  ok: boolean
  backupPath?: string
  validated: boolean
  restarted: boolean
  health?: HealthResult
  restored?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// سرویس / سیستم / لاگ
// ---------------------------------------------------------------------------

/** GET service/:unit/status → {ok,data} */
export interface ServiceStatus {
  unit: string
  available: boolean
  active: boolean | null
  enabled: 'enabled' | 'disabled' | null
  via: 'systemctl' | 'process'
  output: string[]
}

/** GET logs?unit=&lines= → {ok,data} */
export interface LogsResult {
  unit: string
  source: 'journalctl' | 'file'
  lines: string[]
  note?: string
}

/** GET system/ports → {ok,data} */
export interface SsPort {
  proto: string
  local: string
  port: number | null
  process: string | null
}

export interface PortsResult {
  ports: SsPort[]
  raw: string
}

/** GET system/disk → {ok,data} */
export interface DiskResult {
  raw: string
  code: number | null
}

/** GET system/info → {ok,data} */
export interface SystemInfoResult {
  osRelease: string
  hostname: string
  uptime: string
  loadavg: string
}

/** POST hs/service/:action → {ok,data} */
export interface ServiceActionResult {
  unit: string
  action: string
  code: number
  stdout: string
  stderr: string
}

// ---------------------------------------------------------------------------
// پشتیبان / بازیابی / ارتقا
// ---------------------------------------------------------------------------

/** GET backup/list → پاسخ سطح-بالا (بدون data) */
export interface BackupListResponse {
  ok: true
  backups: { name: string; sizeMb: number }[]
  dir: string
  raw: string
}

/** POST backup/verify → پاسخ سطح-بالا */
export interface BackupVerifyResponse {
  ok: boolean
  exitCode: number
  file: string
  issues: string[]
  output: string
  stderr: string
}

/** POST backup/create | restore | update/execute → jobId */
export interface JobStartResponse {
  ok: true
  jobId: string
  file?: string
  target?: string
}

/** GET update/check → {ok,data} */
export interface UpdateCheckResult {
  current: string | null
  latest: string
  upToDate: boolean
  note?: string
}

// ---------------------------------------------------------------------------
// کنسول (§9)
// ---------------------------------------------------------------------------

/** POST console/preview */
export interface ConsolePreviewResult {
  ok: true
  allowed: boolean
  exactCommand: string
  reason?: string
}

/** POST console (بدون stream) */
export interface ConsoleRunResult {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
}

// ---------------------------------------------------------------------------
// Job (socket.io room job:<id> + REST fallback)
// ---------------------------------------------------------------------------

/** GET /api/jobs/:id → {ok,job} */
export interface JobInfo {
  id: string
  type: string
  sessionId: string
  startedAt: string
  cancelled: boolean
  status?: 'running' | 'done' | 'error'
  ok?: boolean
  exitCode?: number | null
  summary?: string
  finalState?: string
  finishedAt?: string
  logCount?: number
}

export interface JobLogLine {
  seq: number
  line: string
  stream: 'stdout' | 'stderr'
}

/** GET /api/jobs/:id/log?since= → {ok,jobId,logs,nextSince,truncated} */
export interface JobLogPage {
  jobId: string
  logs: JobLogLine[]
  nextSince: number
  truncated: boolean
}

/** رویدادهای socket.io اتاق job:<id> */
export interface JobLogEvent {
  jobId: string
  line: string
  seq?: number
  stream?: 'stdout' | 'stderr'
}

export interface JobStageEvent {
  jobId: string
  stage: number
  total: number
  title: string
  risk?: string
}

export interface JobDoneEvent {
  jobId: string
  ok: boolean
  exitCode: number | null
  summary: string
  finalState?: string
}

/** وضعیت نهایی ارتقا (خروجی صادقانهٔ 5-b — پارس jobstream) */
export const UPDATE_FINAL_STATE_LABELS: Record<string, string> = {
  updated: 'ارتقا کامل شد',
  rolled_back: 'ارتقا شکست خورد و به نسخهٔ قبلی بازگشت داده شد',
  rollback_failed: 'ارتقا و بازگشت هر دو شکست خوردند — سرور را با hsctl doctor بررسی کنید',
  failed: 'ارتقا ناتمام ماند',
}
