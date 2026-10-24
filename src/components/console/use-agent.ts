'use client'

/**
 * هوک‌های مشترک دسترسی به داده‌های agent (react-query + connection store).
 */

import { useCallback } from 'react'
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import {
  agentGet,
  agentPost,
  type OkData,
} from '@/lib/agent'
import { expectDisconnect, useConnectionStore } from '@/lib/connection-store'

/** کلیدهای کوئری همهٔ داده‌های agent با این پیشوند شروع می‌شوند */
export const AGENT_QUERY_PREFIX = 'agent'

/** شناسهٔ نشست فعال (برای کلیدهای کوئری) */
export function useSessionId(): string | null {
  return useConnectionStore((s) => (s.status === 'connected' ? s.sessionId : null))
}

/** آیا نشست فعال داریم؟ */
export function useIsConnected(): boolean {
  return useConnectionStore((s) => s.status === 'connected')
}

/**
 * کوئری عمومی به agent. path === null → کوئری غیرفعال (مثلاً قبل از اتصال).
 */
export function useAgentQuery<T>(
  key: unknown[],
  path: string | null,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>
) {
  return useQuery<T>({
    ...options,
    queryKey: [AGENT_QUERY_PREFIX, ...key],
    queryFn: () => agentGet<T>(path as string),
    enabled: (options?.enabled ?? true) && path !== null,
  })
}

/** کوئری scoped به نشست فعال: /api/s/:sid/<path> */
export function useSessionQuery<T>(
  subKeys: unknown[],
  sessionPath: string,
  options?: Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>
) {
  const sid = useSessionId()
  const path = sid ? `/api/s/${sid}/${sessionPath.replace(/^\//, '')}` : null
  return useAgentQuery<T>(['s', sid, ...subKeys], path, options)
}

/** پاسخ استاندارد {ok,data} را باز می‌کند */
export function useSessionDataQuery<T>(
  subKeys: unknown[],
  sessionPath: string,
  options?: Omit<UseQueryOptions<OkData<T>>, 'queryKey' | 'queryFn'>
) {
  const q = useSessionQuery<OkData<T>>(subKeys, sessionPath, options)
  return { ...q, data: q.data?.data }
}

/** قطع اتصال + پاک‌کردن کش‌های agent */
export function useDisconnect(): () => Promise<void> {
  const qc = useQueryClient()
  return useCallback(async () => {
    const sid = useConnectionStore.getState().sessionId
    if (sid) expectDisconnect(sid)
    try {
      if (sid) {
        await agentPost('/api/disconnect', { sessionId: sid })
      }
    } catch {
      // حتی در خطا، وضعیت محلی را همگام می‌کنیم
    }
    useConnectionStore.getState().markDisconnected()
    qc.removeQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])
}

/** بازآوری همهٔ داده‌های نشست فعلی */
export function useRefreshSession(): () => void {
  const qc = useQueryClient()
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])
}
