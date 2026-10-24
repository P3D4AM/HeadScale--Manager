'use client'

/**
 * پنل پیشرفت زندهٔ یک job agent (پشتیبان‌گیری/بازیابی/ارتقا).
 * خطوط از useJobStream (سوکت + REST fallback) می‌آید — هیچ خط ساختگی نیست.
 */

import { useEffect, useRef } from 'react'
import {
  Ban,
  CircleCheck,
  CircleX,
  Loader2,
  Radio,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useJobStream } from '@/lib/ops/use-job-stream'
import { JobLogLines, MonoBlock } from './mono-block'

const FINAL_STATE_LABELS: Record<string, string> = {
  updated: 'نتیجهٔ نهایی: ارتقا کامل شد',
  rolled_back: 'نتیجهٔ نهایی: ارتقا شکست خورد و نسخهٔ قبلی بازگردانی شد',
  rollback_failed: 'نتیجهٔ نهایی: ارتقا و بازگشت هر دو شکست خوردند',
  failed: 'نتیجهٔ نهایی: ناتمام',
}

export function JobLivePanel({
  jobId,
  title,
  onFinished,
}: {
  jobId: string
  title: string
  /** فراخوانی یک‌باره پس از پایان (done یا error) */
  onFinished?: (ok: boolean) => void
}) {
  const { state, cancel } = useJobStream(jobId)
  const preRef = useRef<HTMLPreElement>(null)
  const finishedNotified = useRef(false)

  // اسکرول خودکار به انتهای لاگ (مگر کاربر خودش بالا اسکرول کرده باشد)
  useEffect(() => {
    const el = preRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [state.lines])

  useEffect(() => {
    if (!state.running && !finishedNotified.current) {
      finishedNotified.current = true
      onFinished?.(state.done?.ok === true && !state.error)
    }
  }, [state.running, state.done, state.error, onFinished])

  const stagePct =
    state.stage && state.stage.total > 0
      ? Math.min(100, Math.round((state.stage.stage / state.stage.total) * 100))
      : null

  return (
    <Card
      className={cn(
        'border-border/80 bg-card/70',
        state.done && state.done.ok && 'border-emerald-500/40',
        state.done && !state.done.ok && 'border-red-500/40',
        state.error && 'border-red-500/40'
      )}
    >
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* سربرگ */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
            {state.running ? (
              <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Radio className="size-4 text-muted-foreground" />
            )}
            {title}
          </h3>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground" dir="ltr">
              {jobId}
            </code>
            {state.running && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 rounded-lg border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                onClick={cancel}
              >
                <Ban className="size-3.5" />
                لغو عملیات
              </Button>
            )}
          </div>
        </div>

        {/* گام جاری */}
        {state.stage && (
          <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="font-bold text-foreground">
                گام {state.stage.stage.toLocaleString('fa-IR')} از{' '}
                {state.stage.total.toLocaleString('fa-IR')}:
                <span className="ms-1 font-normal">{state.stage.title}</span>
              </span>
              {stagePct !== null && (
                <span className="font-mono text-muted-foreground" dir="ltr">
                  {stagePct}%
                </span>
              )}
            </div>
            <Progress value={stagePct ?? undefined} className="h-2" />
            {state.stage.risk && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                {state.stage.risk}
              </Badge>
            )}
          </div>
        )}

        {/* خروجی زنده */}
        <MonoBlock ref={preRef} maxHeightClass="max-h-80" aria-label="خروجی زندهٔ عملیات">
          <JobLogLines lines={state.lines} />
        </MonoBlock>

        {state.truncated && (
          <p className="text-[11px] leading-5 text-amber-600 dark:text-amber-400">
            خروجی بیش از ۵۰۰ خط بوده و ابتدای آن دیگر در بافر agent نیست — آخرین ۵۰۰
            خط نشان داده می‌شود.
          </p>
        )}

        {/* نتیجهٔ صادقانه */}
        {state.done && (
          <div
            className={cn(
              'space-y-1.5 rounded-xl border p-3 text-[13px] leading-6',
              state.done.ok
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
            )}
          >
            <p className="flex items-center gap-2 font-bold">
              {state.done.ok ? (
                <CircleCheck className="size-4" />
              ) : (
                <CircleX className="size-4" />
              )}
              {state.done.ok ? 'عملیات با موفقیت پایان یافت.' : 'عملیات ناتمام ماند.'}
              {state.done.exitCode !== null && (
                <Badge variant="secondary" className="font-mono" dir="ltr">
                  exit {state.done.exitCode}
                </Badge>
              )}
            </p>
            {state.done.summary && <p>{state.done.summary}</p>}
            {state.done.finalState && FINAL_STATE_LABELS[state.done.finalState] && (
              <p className="font-bold">{FINAL_STATE_LABELS[state.done.finalState]}</p>
            )}
          </div>
        )}

        {state.error && (
          <div className="space-y-1.5 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[13px] leading-6 text-red-700 dark:text-red-300">
            <p className="flex items-center gap-2 font-bold">
              <CircleX className="size-4" />
              عملیات با خطا پایان یافت.
            </p>
            <p>{state.error}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
