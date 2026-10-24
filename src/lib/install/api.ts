'use client'

/**
 * لایهٔ API مخصوص جریان نصب — همهٔ فراخوانی‌ها از agentFetch/agentGet
 * (src/lib/agent.ts) می‌گذرند تا درخواست از دروازهٔ Caddy با
 * ?XTransformPort=3005 عبور کند.
 */

import {
  agentGet,
  agentPost,
  AgentError,
  type SudoMode,
} from '@/lib/agent'
import type {
  AgentJobInfo,
  InstallExecuteResponse,
  InstallPrepareResponse,
  InstallSettings,
  InstallStateResponse,
  InstallValidateResponse,
  JobLogPage,
} from './types'

/** POST /api/s/:sid/install/prepare — بارگذاری مخزن نصب روی سرور (چند ثانیه) */
export function prepareInstall(sid: string): Promise<InstallPrepareResponse> {
  return agentPost<InstallPrepareResponse>(`/api/s/${sid}/install/prepare`, {})
}

export interface ValidateOutcome {
  /** نتیجهٔ موفق dry-run (exitCode 0) */
  success?: InstallValidateResponse
  /** dry-run اجرا شد ولی نصب‌کننده با کد غیرصفر متوقف شد */
  failed?: InstallValidateResponse
  /** خطای اعتبارسنجی agent (400) — پیام‌های فارسی در errors */
  invalid?: { message: string; errors: string[] }
  /** خطای شبکه/اتصال */
  error?: AgentError
}

/**
 * POST /api/s/:sid/install/validate — اجرای واقعی dry-run روی سرور.
 * نکتهٔ مهم قرارداد: پاسخ HTTP 200 با ok:false یعنی dry-run «اجرا شد» ولی
 * کد خروج غیرصفر بوده؛ agentFetch در این حالت AgentError پرتاب می‌کند که
 * بدنهٔ کامل (output/plan) در err.body موجود است (افزودهٔ ۶-ب در agent.ts).
 */
export async function validateInstall(
  sid: string,
  settings: InstallSettings,
  remoteDir: string
): Promise<ValidateOutcome> {
  try {
    const res = await agentPost<InstallValidateResponse>(
      `/api/s/${sid}/install/validate`,
      { remoteDir, settings }
    )
    return { success: res }
  } catch (err) {
    if (err instanceof AgentError) {
      if (err.code === 'VALIDATION_FAILED') {
        const errors = Array.isArray((err.detail as { errors?: unknown })?.errors)
          ? ((err.detail as { errors: string[] }).errors as string[])
          : [err.message]
        return { invalid: { message: err.message, errors } }
      }
      // ok:false با HTTP 200 → بدنهٔ واقعی validate در err.body
      const body = err.body as Partial<InstallValidateResponse> | undefined
      if (body && typeof body.exitCode === 'number' && typeof body.output === 'string') {
        return {
          failed: {
            ok: false,
            exitCode: body.exitCode,
            output: body.output,
            stderr: body.stderr,
            plan: Array.isArray(body.plan) ? body.plan : [],
            finalState: body.finalState ?? undefined,
          },
        }
      }
      return { error: err }
    }
    return { error: err instanceof AgentError ? err : new AgentError('INTERNAL', String(err)) }
  }
}

/** POST /api/s/:sid/install/execute — شروع نصب واقعی به‌صورت job async */
export function executeInstall(
  sid: string,
  settings: InstallSettings,
  remoteDir: string | undefined
): Promise<InstallExecuteResponse> {
  return agentPost<InstallExecuteResponse>(`/api/s/${sid}/install/execute`, {
    settings,
    confirm: true,
    ...(remoteDir ? { remoteDir } : {}),
  })
}

/** GET /api/s/:sid/install/state — state.json سرور (یا exists:false صادقانه) */
export function fetchInstallState(sid: string): Promise<InstallStateResponse> {
  return agentGet<InstallStateResponse>(`/api/s/${sid}/install/state`)
}

/** GET /api/jobs/:id — وضعیت job (REST fallback) */
export async function fetchJob(jobId: string): Promise<AgentJobInfo | null> {
  const res = await agentGet<{ ok: true; job: AgentJobInfo }>(`/api/jobs/${jobId}`)
  return res.job ?? null
}

/** GET /api/jobs/:id/log?since=N — صفحهٔ لاگ بافرشده (REST fallback) */
export async function fetchJobLog(
  jobId: string,
  since: number
): Promise<JobLogPage> {
  return agentGet<JobLogPage>(`/api/jobs/${jobId}/log?since=${since}`)
}

/** راهنمای فارسی حالت sudo برای توضیح صادقانهٔ SUDO_REQUIRED */
export function sudoModeLabel(mode: SudoMode | null | undefined): string {
  switch (mode) {
    case 'root':
      return 'کاربر root'
    case 'nopasswd':
      return 'sudo بدون رمز (NOPASSWD)'
    case 'password':
      return 'sudo با رمز'
    case 'none':
      return 'بدون دسترسی sudo'
    default:
      return 'نامشخص'
  }
}
