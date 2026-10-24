'use client'

/**
 * مرحلهٔ ۴ — اجرا: دنبال‌کردن زندهٔ job نصب (socket.io + REST fallback).
 * POST execute توسط والد (روی دکمهٔ رضایت‌دار مرحلهٔ ۳) انجام می‌شود تا در
 * حالت StrictMode هیچ‌گاه job دوبار شروع نشود؛ این مرحله jobId را دنبال می‌کند.
 */

import { useState } from 'react'
import {
  Ban,
  Loader2,
  Radio,
  RefreshCcwDot,
  ShieldAlert,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { LiveTerminal } from './live-terminal'
import { useInstallJob } from './use-install-job'
import type { JobOutcome } from '@/lib/install/types'

export function StageExecute({
  jobId,
  onDone,
  hostLabel,
}: {
  jobId: string
  onDone: (outcome: JobOutcome) => void
  hostLabel: string
}) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const job = useInstallJob({ jobId, onDone })

  const stagePct =
    job.stage && job.stage.total > 0 ? Math.min(100, (job.stage.stage / job.stage.total) * 100) : 0

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
      aria-label="مرحلهٔ ۴ — اجرای نصب"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-foreground">اجرا روی {hostLabel}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            خروجی زندهٔ هر گام از سرور می‌آید؛ تغییرات واقعی همین حالا اعمال
            می‌شود.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            className={cn(
              'gap-1.5 rounded-full px-3 py-1 font-mono text-[11px]',
              job.live
                ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300'
            )}
          >
            {job.live ? (
              <>
                <Radio className="size-3 animate-pulse" aria-hidden />
                زنده
              </>
            ) : (
              <>
                <RefreshCcwDot className="size-3" aria-hidden />
                همگام‌سازی دوره‌ای
              </>
            )}
          </Badge>
          <Badge variant="secondary" className="rounded-full px-3 py-1 font-mono text-[11px]">
            {jobId}
          </Badge>
        </div>
      </div>

      {/* پیشرفت گام‌ها */}
      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-black text-foreground">
              {job.phase === 'running' ? (
                <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
              )}
              {job.stage
                ? `گام ${job.stage.stage.toLocaleString('fa-IR')} از ${job.stage.total.toLocaleString('fa-IR')} — ${job.stage.title}`
                : job.phase === 'running'
                  ? 'در حال آماده‌سازی و شروع نصب‌کننده…'
                  : 'پایان اجرا'}
            </p>
            {job.stage?.risk === 'risky' && (
              <Badge variant="outline" className="rounded-full border-amber-500/50 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                گام حساس
              </Badge>
            )}
          </div>
          <Progress
            value={stagePct}
            className="h-2.5"
            aria-label={`پیشرفت نصب — گام ${job.stage?.stage ?? 0} از ${job.stage?.total ?? 17}`}
          />
          {job.failure && (
            <p className="text-[12px] leading-6 text-amber-700 dark:text-amber-300">
              همگام‌سازی REST موقتاً با خطا مواجه است: {job.failure} — تلاش ادامه
              دارد.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ترمینال زنده */}
      <LiveTerminal lines={job.lines} maxHeight="max-h-[460px]" />

      {/* لغو */}
      {job.phase === 'running' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] leading-6 text-muted-foreground">
            لغو، نصب‌کننده را در همان لحظه متوقف می‌کند (SIGINT). اگر وسط گام
            حساس باشد، سرور ممکن است در وضعیت نیمه‌نصب بماند — نصب‌کننده در
            اجرای بعدی از همین نقطه گزارش صادقانه می‌دهد.
          </p>
          <Button
            variant="outline"
            className="h-11 shrink-0 gap-2 rounded-xl border-red-500/40 font-bold text-red-700 hover:bg-red-500/10 dark:text-red-300"
            onClick={() => setConfirmCancel(true)}
            disabled={job.cancelling}
          >
            {job.cancelling ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                در حال ارسال لغو…
              </>
            ) : (
              <>
                <Ban className="size-4" />
                لغو نصب
              </>
            )}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right sm:text-right">
            <AlertDialogTitle>لغو نصب روی سرور؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-7">
              دستور لغو به همان لحظهٔ اجرا روی سرور می‌رسد (سیگنال توقف به
              نصب‌کننده). اگر لغو در میانهٔ گام حساس (نصب بسته/پیکربندی/فایروال)
              اتفاق بیفتد، سرور ممکن است نیمه‌نصب بماند. نتیجهٔ لغو صادقانه به
              شما گزارش می‌شود.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="h-11 rounded-xl font-bold">ادامهٔ نصب</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 gap-2 rounded-xl bg-red-600 font-bold text-white hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400"
              onClick={() => {
                setConfirmCancel(false)
                job.requestCancel()
                toast.info('دستور لغو ارسال شد — منتظر تأیید سرور…')
              }}
            >
              <Ban className="size-4" />
              بله، لغو کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.section>
  )
}
