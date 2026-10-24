'use client'

/**
 * تایپ‌های دامنهٔ نصب — آینهٔ دقیق قرارداد واقعی hem-agent (§8 + job §5).
 * شکل فیلدها از پاسخ «واقعی» اندپوینت‌ها گرفته شده، نه از حدس:
 *  - POST /api/s/:sid/install/prepare → {ok, remoteDir, sizeBytes, planInputsSchema}
 *  - POST /api/s/:sid/install/validate → {ok, exitCode, output, stderr, plan, finalState?}
 *  - POST /api/s/:sid/install/execute → {ok, jobId}
 *  - GET  /api/s/:sid/install/state  → {ok, exists, state?, parseError?}
 *  - GET  /api/jobs/:id              → {ok, job:{…JobInfo}}
 *  - GET  /api/jobs/:id/log?since=N  → {ok, jobId, logs, nextSince, truncated}
 */

/** یک فیلد از planInputsSchema (۱۳ فیلد با برچسب فارسی) */
export interface InstallPlanField {
  key: string
  label: string
  /** string | boolean | number | string[] | enum | object[] */
  type: string
  required?: boolean
  default?: unknown
  /** مقادیر مجاز enum (کلید واقعی پاسخ) */
  enum?: string[]
  /** نام مستعار دفاعی — اگر agent روزی options بفرستد */
  options?: string[]
  /** متن راهنمای فارسی (کلید واقعی پاسخ) */
  hint?: string
  /** نام مستعار دفاعی برای hint */
  help?: string
  /** فیلد اجرایی که agent خودش مقدار می‌دهد (مثل non_interactive) */
  agentManaged?: boolean
}

/** دوربین/NVR — هم‌ارز src/hem/cameras/registry.py (to_dict) */
export interface CameraDevice {
  name: string
  host: string
  http_port?: number
  rtsp_port?: number
  brand?: string
  notes?: string
}

/** تنظیمات نصب (answers) — کلیدها عیناً هم‌ارز examples/hem-install.conf.example */
export interface InstallSettings {
  install_dir?: string
  domain?: string
  acme_email?: string
  headscale_version?: string
  first_user?: string
  magic_dns_base?: string
  dns_nameservers?: string[]
  caddy_mode?: 'install' | 'reuse' | 'skip'
  embedded_derp?: boolean
  firewall?: boolean
  ssh_port?: number | ''
  cameras?: CameraDevice[]
}

/** پاسخ POST install/prepare */
export interface InstallPrepareResponse {
  ok: true
  remoteDir: string
  sizeBytes: number
  planInputsSchema: InstallPlanField[]
}

/** یک گام تجزیه‌شده از خروجی نصب‌کننده (jobstream.ts واقعی) */
export interface PlanStep {
  stage: number
  total: number
  title: string
  status: 'running' | 'ok' | 'needs_action' | 'failed'
  detail?: string
  risk?: 'safe' | 'risky'
}

/** پاسخ POST install/validate (dry-run واقعی) — ok:false یعنی کد خروج غیرصفر */
export interface InstallValidateResponse {
  ok: boolean
  exitCode: number
  output: string
  stderr?: string
  plan: PlanStep[]
  finalState?: string | null
}

/** پاسخ GET install/state */
export interface InstallStateResponse {
  ok: true
  exists: boolean
  state?: unknown
  parseError?: string
}

/** یک خط لاگ job (رویداد socket دنباله ندارد؛ REST همیشه seq دارد) */
export interface JobLogEntry {
  seq?: number
  line: string
  stream: 'stdout' | 'stderr'
}

/** وضعیت job از GET /api/jobs/:id */
export interface AgentJobInfo {
  id: string
  type: string
  sessionId: string
  startedAt: string
  cancelled: boolean
  status?: 'running' | 'done' | 'error'
  ok?: boolean
  exitCode?: number | null
  summary?: string
  finalState?: string | null
  finishedAt?: string
  logCount?: number
}

/** صفحهٔ لاگ job از GET /api/jobs/:id/log?since= */
export interface JobLogPage {
  ok: true
  jobId: string
  logs: { seq: number; line: string; stream: 'stdout' | 'stderr' }[]
  nextSince: number
  truncated: boolean
}

/** پاسخ POST install/execute */
export interface InstallExecuteResponse {
  ok: true
  jobId: string
}

/** نتیجهٔ نهایی job برای مرحلهٔ ۵ ویزارد */
export interface JobOutcome {
  jobId: string
  ok: boolean
  exitCode: number | null
  summary: string
  finalState?: string | null
  cancelled: boolean
  logs: JobLogEntry[]
}

/** رویدادهای socket.io اتاق job:<id> (عیناً از src/events.ts) */
export interface JobLogEvent {
  jobId: string
  line: string
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
  finalState?: string | null
}

export interface JobErrorEvent {
  jobId: string
  error: string
}

/** وضعیت‌های نهایی نصب (برچسب‌های قراردادی 5-b + حالت‌های صادقانهٔ agent) */
export type InstallFinalState =
  | 'verified'
  | 'full_success'
  | 'pending_verification'
  | 'service_not_ready'
  | 'partial_failure'
  | 'dry_run_complete'
  | 'failed'
  | 'cancelled'
  | 'sudo_required'
  | string
