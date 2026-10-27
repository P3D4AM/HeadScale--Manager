'use client'

/**
 * مرحلهٔ ۵ — نتیجهٔ صادقانه: بنر وضعیت نهایی واقعی job (از finalState یا
 * نتیجهٔ خام)، گام‌های بعدی، لاگ کامل و دانلود گزارش (Blob سمت کلاینت).
 */

import {
  BookOpenCheck,
  CircleCheck,
  CircleX,
  Download,
  Gauge,
  KeyRound,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { LiveTerminal } from './live-terminal'
import type { InstallSettings, JobOutcome } from '@/lib/install/types'

type ResultKind = 'success' | 'pending' | 'partial' | 'failed' | 'cancelled' | 'sudo'

interface ResultMeta {
  kind: ResultKind
  title: string
  body: string
}

export function classifyOutcome(outcome: JobOutcome): ResultMeta {
  const sudo = outcome.summary.startsWith('SUDO_REQUIRED')
  if (outcome.cancelled) {
    return {
      kind: 'cancelled',
      title: 'اجرا به درخواست شما لغو شد',
      body: 'نصب‌کننده روی سرور متوقف شد. سرور ممکن است در وضعیت نیمه‌نصب باشد — پیش از اجرای دوباره، خروجی کامل را بررسی کنید.',
    }
  }
  if (sudo) {
    return {
      kind: 'sudo',
      title: 'نصب واقعی اجرا نشد — دسترسی مدیر (sudo) در دسترس نیست',
      body: 'نصب Headscale نیازمند دسترسی root/sudo است و روی این سرور در دسترس نیست (SUDO_REQUIRED). همهٔ مراحل قبل از اجرا — از جمله Dry-Run کامل — به‌صورت واقعی روی همین سرور راستی‌آزمایی شد؛ روی یک VPS واقعی با کاربر دارای sudo، همین برنامه بدون تغییر اجرا می‌شود. اگر سرور واقعی شماست: با کاربر دارای sudo وصل شوید، مرحلهٔ ۱ را دوباره بررسی کنید و اجرا را تکرار کنید.',
    }
  }
  // وضعیت نهایی واقعی نصب‌کننده ملاک دسته‌بندی است، نه فقط پرچم ok —
  // hsctl برای pending_verification و service_not_ready «کد خروج ۴» برمی‌گرداند
  // (قرارداد FACTS §10)؛ این دو یعنی نصب انجام شده و فقط تأیید بیرونی/سرویس
  // در انتظار است — نه اینکه نصب شکست خورده باشد (اصلاح تسک ۲۶).
  switch (outcome.finalState) {
    case 'verified':
      return {
        kind: 'success',
        title: 'نصب انجام شد و صحت آن تأیید شد',
        body: 'نصب‌کننده هر سه بررسی سلامت (سرویس، HTTPS و CLI) را با موفقیت پشت سر گذاشت. شبکهٔ شما آماده است.',
      }
    case 'full_success':
      return {
        kind: 'success',
        title: 'نصب کاملاً موفق بود',
        body: 'همهٔ گام‌ها با موفقیت تمام شد و سرویس روی سرور فعال است.',
      }
    case 'pending_verification':
      return {
        kind: 'pending',
        title: 'نصب انجام شد؛ در انتظار تأیید DNS/گواهی',
        body: 'همهٔ گام‌های نصب اجرا شد و سرویس فعال است؛ فقط تأیید بیرونی (DNS یا گواهی TLS) در پایان نصب پاسخ نداد. اگر نصب تازه است، صدور گواهی Let\u2019s Encrypt معمولاً چند دقیقه طول می‌کشد — چند دقیقه بعد سلامت سه‌لایه را از داشبورد بررسی کنید یا روی سرور hsctl doctor را اجرا کنید.',
      }
    case 'service_not_ready':
      return {
        kind: 'pending',
        title: 'نصب انجام شد اما سرویس هنوز آماده نیست',
        body: 'نصب کامل شده ولی سرویس در پایانِ نصب بالا نیامد. لاگ کامل و بخش «سرور و لاگ» را ببینید؛ روی سرور دستور hsctl doctor علت دقیق را می‌گوید.',
      }
    case 'partial_failure':
      return {
        kind: 'partial',
        title: 'بخشی از عملیات نصب شکست خورد',
        body: 'نصب ناتمام ماند اما همهٔ جزئیات ثبت شده است. خروجی کامل را ببینید و روی سرور دستور hsctl doctor را اجرا کنید.',
      }
    default:
      if (outcome.ok) {
        return {
          kind: 'success',
          title: 'نصب با موفقیت تمام شد',
          body: outcome.summary || 'کد خروج ۰ — نصب‌کننده بدون خطا تمام شد.',
        }
      }
      return {
        kind: 'failed',
        title: 'نصب ناتمام ماند',
        body:
          outcome.summary ||
          `نصب با کد خروج ${outcome.exitCode ?? '—'} متوقف شد. خروجی کامل و آخرین گام‌های لاگ را ببینید.`,
      }
  }
}

const KIND_STYLE: Record<ResultKind, { border: string; iconBg: string; badge: string; icon: typeof CircleCheck }> = {
  success: {
    border: 'border-emerald-500/50 bg-emerald-500/[0.06]',
    iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    icon: ShieldCheck,
  },
  pending: {
    border: 'border-amber-500/50 bg-amber-500/[0.05]',
    iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    icon: TriangleAlert,
  },
  partial: {
    border: 'border-orange-500/50 bg-orange-500/[0.05]',
    iconBg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    badge: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
    icon: TriangleAlert,
  },
  failed: {
    border: 'border-red-500/50 bg-red-500/[0.05]',
    iconBg: 'bg-red-500/15 text-red-600 dark:text-red-400',
    badge: 'bg-red-500/15 text-red-700 dark:text-red-300',
    icon: CircleX,
  },
  cancelled: {
    border: 'border-border bg-card',
    iconBg: 'bg-muted text-muted-foreground',
    badge: 'bg-muted text-muted-foreground',
    icon: RotateCcw,
  },
  sudo: {
    border: 'border-amber-500/50 bg-amber-500/[0.05]',
    iconBg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    icon: ShieldAlert,
  },
}

export function StageResult({
  outcome,
  settings,
  hostLabel,
  onRestart,
}: {
  outcome: JobOutcome
  settings: InstallSettings | null
  hostLabel: string
  onRestart: () => void
}) {
  const meta = classifyOutcome(outcome)
  const style = KIND_STYLE[meta.kind]
  const Icon = style.icon
  const successish = meta.kind === 'success' || meta.kind === 'pending'

  const downloadReport = () => {
    const lines: string[] = []
    lines.push('گزارش نصب — Headscale Easy Manager')
    lines.push('='.repeat(48))
    lines.push(`تاریخ گزارش: ${new Date().toLocaleString('fa-IR')}`)
    lines.push(`سرور: ${hostLabel}`)
    lines.push(`شناسهٔ job: ${outcome.jobId}`)
    lines.push(`نتیجه: ${outcome.ok ? 'موفق' : 'ناموفق'}`)
    lines.push(`کد خروج: ${outcome.exitCode ?? '—'}`)
    lines.push(`وضعیت نهایی: ${outcome.finalState ?? '—'}`)
    lines.push(`خلاصه: ${outcome.summary}`)
    if (settings) {
      lines.push('')
      lines.push('— تنظیمات نصب —')
      for (const [k, v] of Object.entries(settings)) {
        lines.push(`  ${k}: ${JSON.stringify(v)}`)
      }
    }
    lines.push('')
    lines.push('— خروجی کامل —')
    for (const l of outcome.logs) {
      lines.push(`[${l.stream === 'stderr' ? 'خطا' : 'خروجی'}] ${l.line}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    a.href = url
    a.download = `hem-install-report-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('گزارش نصب دانلود شد.')
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
      aria-label="مرحلهٔ ۵ — نتیجه"
    >
      {/* بنر نتیجه */}
      <Card className={cn('border', style.border)}>
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className={cn('inline-flex size-12 shrink-0 items-center justify-center rounded-2xl', style.iconBg)}>
              <Icon className="size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-foreground">{meta.title}</h2>
                <Badge className={cn('rounded-full px-2.5 text-[11px] hover:opacity-90', style.badge)}>
                  {outcome.finalState
                    ? outcome.finalState
                    : meta.kind === 'sudo'
                      ? 'SUDO_REQUIRED'
                      : meta.kind === 'cancelled'
                        ? 'cancelled'
                        : outcome.ok
                          ? 'success'
                          : 'failed'}
                </Badge>
              </div>
              <p className="mt-1.5 text-[13px] leading-7 text-foreground/90">{meta.body}</p>
              <p className="mt-2 break-words font-mono text-[12px] leading-6 text-muted-foreground" dir="auto">
                {outcome.summary}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* گام‌های بعدی */}
      {successish ? (
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-foreground">
              <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              قدم‌های بعدی شما
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <NextStepCard
                icon={KeyRound}
                title="ساخت کلید اتصال"
                body="برای عضوکردن گوشی/لپ‌تاپ، یک PreAuthKey بسازید."
                action="رفتن به کلیدها"
                onClick={() => navigate('#/keys')}
              />
              <NextStepCard
                icon={BookOpenCheck}
                title="اتصال دستگاه‌ها"
                body="فصل ۵ دورهٔ آموزش: نصب Tailscale روی دستگاه‌ها و اتصال به شبکه."
                action="فصل ۵ آموزش"
                onClick={() => navigate('#/learn/5')}
              />
              <NextStepCard
                icon={Gauge}
                title="بررسی سلامت"
                body="وضعیت سه‌لایهٔ سرویس (systemd / HTTPS / CLI) را در داشبورد ببینید."
                action="رفتن به داشبورد"
                onClick={() => navigate('#/')}
              />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-foreground">
              <ShieldAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
              راهنمای ادامهٔ کار
            </h3>
            <ul className="space-y-2 text-[13px] leading-7 text-foreground/90">
              <li className="flex items-start gap-2">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                خروجی کامل را در پایین همین صفحه ببینید — آخرین خطوط معمولاً علت
                توقف را با پیام فارسی توضیح می‌دهند.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                روی سرور دستور{' '}
                <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  hsctl doctor
                </code>{' '}
                علت دقیق و راه‌حل هر گام را گزارش می‌کند.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                برای تلاش مجدد، ویزارد را از مرحلهٔ تنظیمات شروع کنید؛ پیش‌نویس
                شما حفظ شده است.
              </li>
            </ul>
          </CardContent>
        </Card>
      )}

      {/* لاگ کامل */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-black text-foreground">
            خروجی کامل اجرا ({outcome.logs.length.toLocaleString('fa-IR')} خط)
          </h3>
          <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={downloadReport}>
            <Download className="size-4" />
            دانلود گزارش
          </Button>
        </div>
        <LiveTerminal lines={outcome.logs} ariaLabel="خروجی کامل نصب" maxHeight="max-h-[520px]" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={onRestart}>
          <RotateCcw className="size-4" />
          شروع دوبارهٔ ویزارد
        </Button>
      </div>
    </motion.section>
  )
}

function NextStepCard({
  icon: Icon,
  title,
  body,
  action,
  onClick,
}: {
  icon: typeof KeyRound
  title: string
  body: string
  action: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[44px] flex-col items-start gap-2 rounded-xl border border-border/70 bg-card/60 p-4 text-right transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-md"
    >
      <span className="inline-flex size-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500/15 dark:text-emerald-400">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="text-sm font-black text-foreground">{title}</span>
      <span className="text-[12px] leading-6 text-muted-foreground">{body}</span>
      <span className="mt-auto inline-flex min-h-[36px] items-center gap-1.5 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
        {action}
        <span aria-hidden>←</span>
      </span>
    </button>
  )
}
