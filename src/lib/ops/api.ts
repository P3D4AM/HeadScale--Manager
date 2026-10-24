/**
 * دسترسی خام به agent برای اندپوینت‌هایی که «نتیجهٔ صادقانه» را با ok:false و
 * HTTP 200 برمی‌گردانند (config/set، backup/verify، console exec).
 * agentFetch این پاسخ‌ها را خطا فرض می‌کند و payload صادقانه را گم می‌کند؛
 * اینجا فقط خطاهای «واقعی» HTTP (4xx/5xx) پرتاب می‌شوند.
 */

import { agentPath, AgentError, AgentUnreachableError } from '@/lib/agent'

export async function agentPostRaw<T>(path: string, data?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(agentPath(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data ?? {}),
    })
  } catch (err) {
    throw new AgentUnreachableError(err)
  }

  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { ok?: boolean; error?: string; message?: string; detail?: unknown })
    | null

  if (!res.ok) {
    // خطای واقعی HTTP (NEED_CONFIRM / NOT_AVAILABLE / …) — همانند agentFetch
    throw new AgentError(
      body?.error ?? `HTTP_${res.status}`,
      body?.message ?? `خطای HTTP ${res.status} در ارتباط با سرویس مدیریت.`,
      body?.detail,
      res.status
    )
  }
  if (body === null) {
    throw new AgentError(
      `HTTP_${res.status}`,
      `پاسخ نامعتبر از سرویس مدیریت (HTTP ${res.status}).`
    )
  }
  return body as T
}
