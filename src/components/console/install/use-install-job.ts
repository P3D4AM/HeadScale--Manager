'use client'

/**
 * هوک دنبال‌کردن job نصب — دو مسیر هم‌زمان و مکمل:
 *  ۱) socket.io اتاق job:<jobId> (رویدادهای فوری job:log / job:stage / job:done / job:error)
 *  ۲) REST fallback: GET /api/jobs/:id/log?since=N + GET /api/jobs/:id
 * هر دو مسور همیشه فعال‌اند: socket برای لحظه‌بودن، REST برای درستی (هر ~۲
 * ثانیه همگام می‌شود) — اگر سوکت قطع شود UI بدون وقفه با REST ادامه می‌یابد.
 * در پایان، کل لاگ یک‌بار به‌صورت مرجع از REST خوانده و جایگزین می‌شود.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { agentSocket } from '@/lib/agent'
import { fetchJob, fetchJobLog } from '@/lib/install/api'
import type {
  JobDoneEvent,
  JobErrorEvent,
  JobLogEntry,
  JobLogEvent,
  JobOutcome,
  JobStageEvent,
} from '@/lib/install/types'

export type JobPhase = 'idle' | 'running' | 'done' | 'error'

export interface InstallJobState {
  lines: JobLogEntry[]
  stage: { stage: number; total: number; title: string; risk?: string } | null
  phase: JobPhase
  /** نتیجهٔ نهایی (فقط بعد از done/error) */
  outcome: JobOutcome | null
  /** آیا همگام‌سازی زنده (سوکت) فعال است */
  live: boolean
  cancelling: boolean
  /** خطای شروع/دنبال‌کردن (شبکه، job گم‌شده و…) */
  failure: string | null
  requestCancel: () => void
}

export function useInstallJob({
  jobId,
  onDone,
}: {
  jobId: string | null
  onDone?: (outcome: JobOutcome) => void
}): InstallJobState {
  // مقدار اولیه از وضعیت لحظهٔ mount — بقیهٔ گذارها فقط از رویدادهای async
  const [lines, setLines] = useState<JobLogEntry[]>([])
  const [stage, setStage] = useState<InstallJobState['stage']>(null)
  const [phase, setPhase] = useState<JobPhase>(jobId ? 'running' : 'idle')
  const [outcome, setOutcome] = useState<JobOutcome | null>(null)
  const [live, setLive] = useState(() => {
    try {
      return agentSocket().connected
    } catch {
      return false
    }
  })
  const [cancelling, setCancelling] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  // مرجع‌های هم‌زمانی (تا effect فقط به jobId وابسته بماند)
  const linesRef = useRef<JobLogEntry[]>([])
  const restSinceRef = useRef(0)
  const finishedRef = useRef(false)

  const appendSocketLine = useCallback((line: string, stream: 'stdout' | 'stderr') => {
    linesRef.current = [...linesRef.current, { line, stream }]
    setLines(linesRef.current)
  }, [])

  const syncFromRest = useCallback(async (jid: string) => {
    const page = await fetchJobLog(jid, restSinceRef.current)
    if (page.logs.length > 0 || page.nextSince > restSinceRef.current) {
      const next = [...linesRef.current]
      // cursor روی آرایهٔ فعلی: مدخل‌های آمده از سوکت (بدون seq) با محتوا تطبیق
      // می‌شوند و مدخل‌های هم‌seq دوباره درج نمی‌شوند؛ مدخل جدید در «همان نقطه»
      // درج می‌شود تا ترتیب واقعی استریم حفظ شود (بدون مرتب‌سازی).
      let cursor = 0
      for (const l of page.logs) {
        let matched = false
        for (let i = cursor; i < next.length; i++) {
          const e = next[i]
          if (
            (e.seq === undefined && e.line === l.line && e.stream === l.stream) ||
            e.seq === l.seq
          ) {
            if (e.seq === undefined) next[i] = { ...e, seq: l.seq }
            cursor = i + 1
            matched = true
            break
          }
        }
        if (!matched) {
          next.splice(cursor, 0, { seq: l.seq, line: l.line, stream: l.stream })
          cursor += 1
        }
      }
      linesRef.current = next
      setLines(next)
    }
    restSinceRef.current = page.nextSince
    return page
  }, [])

  const finalize = useCallback(
    async (jid: string, partial: Omit<JobOutcome, 'logs' | 'jobId'>) => {
      if (finishedRef.current) return
      finishedRef.current = true
      // همگام‌سازی نهایی از REST «روی همان خطوط زنده» انجام می‌شود: بافر حلقه‌ای
      // agent فقط ۵۰۰ خط آخر را نگه می‌دارد؛ خطوطی که سوکت زنده رسانده هرگز
      // دور ریخته نمی‌شوند و گزارش نهایی کامل می‌ماند.
      try {
        restSinceRef.current = 0
        await syncFromRest(jid)
      } catch {
        /* نگه‌داشتن همان خطوط زنده */
      }
      const final: JobOutcome = {
        jobId: jid,
        ...partial,
        logs: linesRef.current,
      }
      setOutcome(final)
      setPhase(partial.ok ? 'done' : partial.cancelled ? 'done' : 'error')
      onDoneRef.current?.(final)
    },
    [syncFromRest]
  )

  useEffect(() => {
    if (!jobId) return
    // ریست مرجع‌ها برای job جدید (stateها با key=jobId در والد و مقدار اولیهٔ mount تازه می‌شوند)
    linesRef.current = []
    restSinceRef.current = 0
    finishedRef.current = false

    const jid = jobId
    const room = `job:${jid}`
    const socket = agentSocket()

    // ── رویدادهای سوکت ──
    const onLog = (evt: JobLogEvent) => {
      if (evt.jobId !== jid) return
      appendSocketLine(evt.line, evt.stream ?? 'stdout')
    }
    const onStage = (evt: JobStageEvent) => {
      if (evt.jobId !== jid) return
      setStage({ stage: evt.stage, total: evt.total, title: evt.title, risk: evt.risk })
    }
    const onDoneEvt = (evt: JobDoneEvent) => {
      if (evt.jobId !== jid) return
      // رویداد job:done پرچم «لغو» ندارد؛ رکورد مرجع REST آن را دارد. برای
      // گزارش صادقانهٔ لغو (نه «شکست»)، پیش از نهایی‌سازی از REST می‌خوانیم؛
      // اگر شبکه نپذیرفت، از متن خلاصه حدس صادقانه‌ای می‌زنیم.
      void (async () => {
        let cancelled = false
        try {
          const info = await fetchJob(jid)
          cancelled = Boolean(info?.cancelled)
        } catch {
          cancelled = evt.summary.includes('لغو شد')
        }
        await finalize(jid, {
          ok: evt.ok,
          exitCode: evt.exitCode,
          summary: evt.summary,
          finalState: evt.finalState ?? undefined,
          cancelled,
        })
      })()
    }
    const onErrorEvt = (evt: JobErrorEvent) => {
      if (evt.jobId !== jid) return
      void finalize(jid, {
        ok: false,
        exitCode: null,
        summary: evt.error,
        finalState: undefined,
        cancelled: false,
      })
    }
    const onSockConnect = () => setLive(true)
    const onSockDisconnect = () => setLive(false)

    socket.on('job:log', onLog)
    socket.on('job:stage', onStage)
    socket.on('job:done', onDoneEvt)
    socket.on('job:error', onErrorEvt)
    socket.on('connect', onSockConnect)
    socket.on('disconnect', onSockDisconnect)
    socket.emit('subscribe', room)

    // ── REST: همگام‌سازی اولیه + نظرسنجی دوره‌ای ──
    let timer: ReturnType<typeof setInterval> | null = null
    let stopped = false

    const tick = async () => {
      if (stopped || finishedRef.current) return
      try {
        await syncFromRest(jid)
        setFailure(null)
        const info = await fetchJob(jid)
        if (info && (info.status === 'done' || info.status === 'error') && !finishedRef.current) {
          const cancelled = Boolean(info.cancelled)
          await finalize(jid, {
            ok: Boolean(info.ok),
            exitCode: info.exitCode ?? null,
            summary: info.summary ?? '',
            finalState: info.finalState ?? undefined,
            cancelled,
          })
        }
      } catch (err) {
        // خطای موقت شبکه — فقط بار اول به‌عنوان خطای جدی ثبت می‌شود
        if (!finishedRef.current) {
          setFailure(err instanceof Error ? err.message : String(err))
        }
      }
    }

    void tick()
    timer = setInterval(() => void tick(), 2000)

    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      socket.off('job:log', onLog)
      socket.off('job:stage', onStage)
      socket.off('job:done', onDoneEvt)
      socket.off('job:error', onErrorEvt)
      socket.off('connect', onSockConnect)
      socket.off('disconnect', onSockDisconnect)
      try {
        socket.emit('unsubscribe', room)
      } catch {
        /* ignore */
      }
    }
  }, [jobId, appendSocketLine, syncFromRest, finalize])

  const requestCancel = useCallback(() => {
    if (!jobId || finishedRef.current) return
    setCancelling(true)
    try {
      agentSocket().emit(
        'job:cancel',
        { jobId },
        (ack?: { ok?: boolean }) => {
          if (ack && ack.ok === false) {
            setCancelling(false)
          }
        }
      )
    } catch {
      setCancelling(false)
    }
  }, [jobId])

  return { lines, stage, phase, outcome, live, cancelling, failure, requestCancel }
}
