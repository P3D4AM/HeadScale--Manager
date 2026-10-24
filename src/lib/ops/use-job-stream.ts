'use client'

/**
 * هوک استریم job عملیاتی (پشتیبان‌گیری/بازیابی/ارتقا) — قرارداد §5.
 *
 * دو مسیر مکمل و بدون تکرار خط:
 *  - socket.io (اتاق job:<id>): رویدادهای stage/done/error «بی‌درنگ» + تحریک
 *    fetch بلافاصله پس از هر خط جدید (job:log).
 *  - REST (GET /api/jobs/:id و /api/jobs/:id/log?since=0): منبع یگانهٔ خطوط —
 *    به‌صورت دوره‌ای هم poll می‌شود تا اگر سوکت قطع بود هم چیزی از دست نرود
 *    (بافر حلقه‌ای ۵۰۰ خطی + نگه‌داری ۱۰ دقیقه‌ای رکورد در agent، Task 5-d).
 *
 * خطوط هرگز از دو منبع «چسبانده» نمی‌شوند — همیشه از REST خوانده و جایگزین
 * می‌شوند تا تکرار خط وجود نداشته باشد.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { agentGet, agentSocket, AgentError } from '@/lib/agent'
import type { JobInfo, JobLogLine } from './types'

export interface JobStageState {
  stage: number
  total: number
  title: string
  risk?: string
}

export interface JobDoneState {
  ok: boolean
  exitCode: number | null
  summary: string
  finalState?: string
}

export interface JobStreamState {
  /** آخرین خطوط لاگ (حداکثر ۵۰۰ خط بافر agent) */
  lines: JobLogLine[]
  stage: JobStageState | null
  done: JobDoneState | null
  error: string | null
  /** بخشی از ابتدای لاگ (بیش از ۵۰۰ خط) دیگر در بافر نیست */
  truncated: boolean
  /** تا وقتی done/error ندیده‌ایم و رکورد running است */
  running: boolean
}

export interface JobStreamHandle {
  state: JobStreamState
  /** لغو از طریق socket (job:cancel) — تنها مسیر لغو در قرارداد */
  cancel: () => void
}

const EMPTY: JobStreamState = {
  lines: [],
  stage: null,
  done: null,
  error: null,
  truncated: false,
  running: false,
}

export function useJobStream(jobId: string | null): JobStreamHandle {
  const [state, setState] = useState<JobStreamState>(EMPTY)

  // مرجع‌های داخل effect (بدون بازگشایی effect به ازای هر رندر)
  const linesRef = useRef<JobLogLine[]>([])
  const finishedRef = useRef(false)
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastFetchAtRef = useRef(0)

  const cancel = useCallback(() => {
    if (!jobId) return
    agentSocket().emit(
      'job:cancel',
      { jobId },
      (ack: unknown) => {
        const ok = Boolean((ack as { ok?: boolean } | null)?.ok)
        if (!ok) {
          import('sonner')
            .then(({ toast }) =>
              toast.error('لغو عملیات ممکن نشد.', {
                description: 'عملیات یا تمام شده است یا دیگر در agent فعال نیست.',
              })
            )
            .catch(() => undefined)
        }
      }
    )
  }, [jobId])

  useEffect(() => {
    if (!jobId) {
      setState(EMPTY)
      return
    }

    linesRef.current = []
    finishedRef.current = false
    lastFetchAtRef.current = 0
    setState({ ...EMPTY, running: true })

    const socket = agentSocket()
    const room = `job:${jobId}`

    const applyPage = (page: {
      logs: JobLogLine[]
      nextSince: number
      truncated: boolean
    }) => {
      linesRef.current = page.logs
      setState((s) => ({ ...s, lines: page.logs, truncated: page.truncated }))
    }

    /** خواندن کامل خطوط + وضعیت job از REST (منبع یگانهٔ خطوط) */
    const fetchAll = async (force = false) => {
      const now = Date.now()
      if (!force && now - lastFetchAtRef.current < 250) return
      lastFetchAtRef.current = now
      try {
        const page = await agentGet<{
          ok: true
          jobId: string
          logs: JobLogLine[]
          nextSince: number
          truncated: boolean
        }>(`/api/jobs/${jobId}/log?since=0`)
        applyPage(page)
      } catch {
        /* رکورد ممکن است هنوز در حال ثبت باشد — poll بعدی دوباره تلاش می‌کند */
      }
      try {
        const res = await agentGet<{ ok: true; job: JobInfo }>(`/api/jobs/${jobId}`)
        const job = res.job
        if (job.status === 'done' && !finishedRef.current) {
          finishedRef.current = true
          setState((s) => ({
            ...s,
            running: false,
            done: {
              ok: job.ok === true,
              exitCode: job.exitCode ?? null,
              summary: job.summary ?? '',
              finalState: job.finalState,
            },
          }))
        } else if (job.status === 'error' && !finishedRef.current) {
          finishedRef.current = true
          setState((s) => ({
            ...s,
            running: false,
            error: job.summary ?? 'عملیات با خطا پایان یافت.',
          }))
        }
      } catch (e) {
        // 404 — رکورد job منقضی/ناشناخته؛ اگر هنوز خطی ندیده‌ایم صادقانه اعلام می‌کنیم
        if (
          !finishedRef.current &&
          e instanceof AgentError &&
          (e.code === 'NOT_FOUND' || e.status === 404)
        ) {
          finishedRef.current = true
          setState((s) => ({
            ...s,
            running: false,
            error:
              'رکورد این عملیات در agent یافت نشد (یا بیش از ۱۰ دقیقه از پایانش گذشته است).',
          }))
        }
      }
    }

    /** fetch با فاصلهٔ حداقلی — پس از هر رویداد زندهٔ job:log */
    const scheduleFetch = () => {
      if (fetchTimerRef.current) return
      fetchTimerRef.current = setTimeout(() => {
        fetchTimerRef.current = null
        void fetchAll(true)
      }, 220)
    }

    const onLog = (evt: { jobId?: string }) => {
      if (evt?.jobId !== jobId || finishedRef.current) return
      scheduleFetch()
    }
    const onStage = (evt: {
      jobId?: string
      stage: number
      total: number
      title: string
      risk?: string
    }) => {
      if (evt?.jobId !== jobId) return
      setState((s) => ({
        ...s,
        stage: { stage: evt.stage, total: evt.total, title: evt.title, risk: evt.risk },
      }))
    }
    const onDone = (evt: {
      jobId?: string
      ok: boolean
      exitCode: number | null
      summary: string
      finalState?: string
    }) => {
      if (evt?.jobId !== jobId || finishedRef.current) return
      finishedRef.current = true
      setState((s) => ({
        ...s,
        running: false,
        done: {
          ok: evt.ok,
          exitCode: evt.exitCode,
          summary: evt.summary,
          finalState: evt.finalState,
        },
      }))
      void fetchAll(true)
    }
    const onError = (evt: { jobId?: string; error: string }) => {
      if (evt?.jobId !== jobId || finishedRef.current) return
      finishedRef.current = true
      setState((s) => ({ ...s, running: false, error: evt.error }))
      void fetchAll(true)
    }

    // عضویت در اتاق job + رویدادها (سوکت ممکن است لحظه‌ای قطع باشد — poll پوشش می‌دهد)
    socket.emit('subscribe', room)
    socket.on('job:log', onLog)
    socket.on('job:stage', onStage)
    socket.on('job:done', onDone)
    socket.on('job:error', onError)

    void fetchAll(true)

    const poll = setInterval(() => {
      if (!finishedRef.current) void fetchAll(true)
    }, 1500)

    return () => {
      clearInterval(poll)
      if (fetchTimerRef.current) {
        clearTimeout(fetchTimerRef.current)
        fetchTimerRef.current = null
      }
      socket.off('job:log', onLog)
      socket.off('job:stage', onStage)
      socket.off('job:done', onDone)
      socket.off('job:error', onError)
      try {
        socket.emit('unsubscribe', room)
      } catch {
        /* ignore */
      }
    }
  }, [jobId])

  return { state, cancel }
}
