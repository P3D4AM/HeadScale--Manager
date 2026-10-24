'use client'

/**
 * مرحلهٔ ۱ — بررسی سرور: کاوش واقعی (probe) + وضعیت نصب موجود (install/state).
 * حکم صادقانهٔ آمادگی: آمادهٔ نصب | دارای هشدار | غیرقابل نصب (موانع).
 * با وجود موانع، مسیر صریح «آزمایش/آموزش» برای دیدن Dry-Run باز است —
 * بدون پنهان‌کردن هیچ مانعی.
 */

import { useState } from 'react'
import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Cpu,
  Fingerprint,
  HardDrive,
  Info,
  MemoryStick,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSessionDataQuery, useSessionQuery } from '../use-agent'
import type { ProbeResult } from '@/lib/agent'
import type { InstallStateResponse } from '@/lib/install/types'
import { sudoModeLabel } from '@/lib/install/api'

export type ReadinessVerdict = 'ready' | 'warn' | 'blocked'

function verdictOf(probe: ProbeResult | undefined): ReadinessVerdict {
  if (!probe) return 'warn'
  if (probe.blockers.length > 0) return 'blocked'
  if (probe.warnings.length > 0) return 'warn'
  return 'ready'
}

export function StageProbe({
  probeQuery,
  onProceed,
}: {
  probeQuery: ReturnType<typeof useSessionDataQuery<ProbeResult>>
  onProceed: (acknowledgedBlockers: boolean) => void
}) {
  // وضعیت نصب موجود (state.json) — جدا از probe
  const stateQuery = useSessionQuery<InstallStateResponse>(['install', 'state'], 'install/state', {
    staleTime: 60_000,
  })

  const [ackBlocked, setAckBlocked] = useState(false)
  const probe = probeQuery.data
  const verdict = verdictOf(probe)
  const state = stateQuery.data

  const recheck = () => {
    void probeQuery.refetch()
    void stateQuery.refetch()
    toast.info('بررسی مجدد سرور آغاز شد…')
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
      aria-label="مرحلهٔ ۱ — بررسی سرور"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-foreground">بررسی سرور شما</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            با دستورهای واقعی روی سرور بررسی می‌کنیم: سیستم‌عامل، منابع، دسترسی
            sudo، سرویس‌های موجود و موانع نصب.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-xl font-bold"
          onClick={recheck}
          disabled={probeQuery.isFetching}
        >
          <RefreshCw className={cn('size-4', probeQuery.isFetching && 'animate-spin')} />
          بررسی مجدد
        </Button>
      </div>

      {/* بارگذاری */}
      {probeQuery.isLoading && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <RefreshCw className="size-4 animate-spin" />
              در حال اجرای کاوش واقعی روی سرور… (چند ثانیه)
            </div>
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* خطا */}
      {probeQuery.isError && !probeQuery.isLoading && (
        <Alert variant="destructive">
          <CircleX className="size-4" />
          <AlertTitle className="font-bold">کاوش سرور ناموفق بود</AlertTitle>
          <AlertDescription className="leading-6">
            {probeQuery.error instanceof Error
              ? probeQuery.error.message
              : 'خطای نامشخص در ارتباط با سرور.'}
            <div className="mt-3">
              <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={() => void probeQuery.refetch()}>
                <RefreshCw className="size-4" />
                تلاش مجدد
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {probe && (
        <>
          {/* کارت سرور */}
          <ServerSpecCard probe={probe} />

          {/* سرویس‌های موجود */}
          <ExistingServicesCard probe={probe} />

          {/* نصب موجود HEM */}
          {state?.exists && (
            <Alert className="border-amber-500/40 bg-amber-500/[0.05]">
              <PackageCheck className="size-4 text-amber-600 dark:text-amber-400" />
              <AlertTitle className="text-sm font-bold">
                روی این سرور نصبِ Headscale Easy Manager موجود است
              </AlertTitle>
              <AlertDescription className="text-[13px] leading-6">
                فایل وضعیت نصب (<code dir="ltr" className="font-mono text-[11px]">/etc/hem/state.json</code>) پیدا
                شد. برای مدیریت نصب موجود از داشبورد استفاده کنید؛ اجرای دوبارهٔ
                ویزارد نصبِ تازه، به‌صورت «مدیریت نصب موجود» رفتار می‌کند.
              </AlertDescription>
            </Alert>
          )}

          {/* حکم آمادگی */}
          <VerdictCard
            verdict={verdict}
            warnings={probe.warnings}
            blockers={probe.blockers}
            ackBlocked={ackBlocked}
            onAckBlocked={() => setAckBlocked(true)}
            onProceed={() => onProceed(ackBlocked || verdict !== 'blocked')}
          />
        </>
      )}
    </motion.section>
  )
}

// ---------------------------------------------------------------- کارت‌ها

function SpecTile({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Cpu
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-bold text-foreground" title={value}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </div>
  )
}

export function ServerSpecCard({ probe }: { probe: ProbeResult }) {
  const diskPct = probe.disk.rootGb > 0 ? Math.min(100, ((probe.disk.rootGb - probe.disk.availGb) / probe.disk.rootGb) * 100) : 0
  const memPct = probe.mem.totalMb > 0 ? Math.min(100, ((probe.mem.totalMb - probe.mem.availMb) / probe.mem.totalMb) * 100) : 0
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SpecTile
            icon={TerminalSquare}
            label="سیستم‌عامل"
            value={probe.os.pretty}
            sub={`معماری ${probe.os.arch} • هستهٔ ${probe.kernel.split('.')[0]}`}
          />
          <SpecTile
            icon={Cpu}
            label="پردازنده"
            value={`${probe.cpu.cores.toLocaleString('fa-IR')} هسته`}
            sub={`پایتون ${probe.python3.version ?? '—'}`}
          />
          <SpecTile
            icon={Fingerprint}
            label="دسترسی sudo"
            value={sudoModeLabel(probe.sudo.mode)}
            sub={probe.sudo.mode === 'none' ? 'برای نصب واقعی لازم است' : 'برای نصب کافی است'}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border/70 bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 font-bold text-foreground">
                <HardDrive className="size-3.5 text-muted-foreground" aria-hidden />
                دیسک ریشه
              </span>
              <span className="font-mono text-muted-foreground" dir="ltr">
                {probe.disk.availGb.toFixed(1)} / {probe.disk.rootGb.toFixed(1)} GB
              </span>
            </div>
            <Progress value={diskPct} className="h-2" aria-label="مصرف دیسک" />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              حداقل لازم برای نصب: ۱۰ گیگابایت فضای آزاد
            </p>
          </div>
          <div className="rounded-xl border border-border/70 bg-card/60 p-3">
            <div className="mb-2 flex items-center justify-between text-[12px]">
              <span className="flex items-center gap-1.5 font-bold text-foreground">
                <MemoryStick className="size-3.5 text-muted-foreground" aria-hidden />
                حافظه
              </span>
              <span className="font-mono text-muted-foreground" dir="ltr">
                {(probe.mem.availMb / 1024).toFixed(1)} / {(probe.mem.totalMb / 1024).toFixed(1)} GB
              </span>
            </div>
            <Progress value={memPct} className="h-2" aria-label="مصرف حافظه" />
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              systemd: {probe.systemd.available ? 'موجود' : 'در دسترس نیست (وضعیت از روی فرایندها)'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function ServiceBadge({
  name,
  meta,
}: {
  name: string
  meta: { installed: boolean; version: string | null; serviceActive: boolean | null }
}) {
  return (
    <div
      className={cn(
        'flex min-h-[44px] items-center justify-between gap-2 rounded-xl border px-3 py-2.5',
        meta.installed
          ? meta.serviceActive
            ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
            : 'border-amber-500/40 bg-amber-500/[0.05]'
          : 'border-border/70 bg-card/50'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-foreground">{name}</span>
        {meta.version && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            {meta.version}
          </Badge>
        )}
      </div>
      <span
        className={cn(
          'text-[12px] font-bold',
          meta.installed
            ? meta.serviceActive
              ? 'text-emerald-700 dark:text-emerald-300'
              : 'text-amber-700 dark:text-amber-300'
            : 'text-muted-foreground'
        )}
      >
        {meta.installed
          ? meta.serviceActive
            ? 'نصب‌شده و فعال'
            : 'نصب‌شده (غیرفعال)'
          : 'نصب‌نشده'}
      </span>
    </div>
  )
}

function ExistingServicesCard({ probe }: { probe: ProbeResult }) {
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-foreground">
          <PackageCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
          سرویس‌های موجود روی سرور
        </h3>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <ServiceBadge name="Headscale" meta={probe.existing.headscale} />
          <ServiceBadge name="Caddy" meta={probe.existing.caddy} />
          <ServiceBadge name="Nginx" meta={probe.existing.nginx} />
        </div>
        {probe.headscaleConfigExists && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.05] p-3 text-[12px] leading-6 text-amber-800 dark:text-amber-200">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            فایل پیکربندی Headscale روی سرور موجود است — نصب‌کننده به‌صورت
            «مدیریت نصب موجود» با آن برخورد می‌کند.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function VerdictCard({
  verdict,
  warnings,
  blockers,
  ackBlocked,
  onAckBlocked,
  onProceed,
}: {
  verdict: ReadinessVerdict
  warnings: string[]
  blockers: string[]
  ackBlocked: boolean
  onAckBlocked: () => void
  onProceed: () => void
}) {
  const cfg =
    verdict === 'ready'
      ? {
          icon: ShieldCheck,
          cls: 'border-emerald-500/50 bg-emerald-500/[0.06]',
          iconCls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
          title: 'سرور آمادهٔ نصب است',
          body: 'هیچ مانعی یافت نشد. می‌توانید تنظیمات نصب را شروع کنید.',
        }
      : verdict === 'warn'
        ? {
            icon: AlertTriangle,
            cls: 'border-amber-500/50 bg-amber-500/[0.05]',
            iconCls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
            title: 'سرور دارای هشدار است (قابل نصب)',
            body: 'نصب ممکن است، اما این هشدارها را بخوانید:',
          }
        : {
            icon: ShieldAlert,
            cls: 'border-red-500/50 bg-red-500/[0.05]',
            iconCls: 'bg-red-500/15 text-red-600 dark:text-red-400',
            title: 'این سرور برای نصب واقعی واجد شرایط نیست',
            body: 'کاوش واقعی سرور این موانع را یافت:',
          }
  const Icon = cfg.icon

  return (
    <Card className={cn('border', cfg.cls)}>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className={cn('inline-flex size-11 shrink-0 items-center justify-center rounded-xl', cfg.iconCls)}>
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black text-foreground">{cfg.title}</h3>
            <p className="mt-0.5 text-[13px] leading-6 text-muted-foreground">{cfg.body}</p>
          </div>
        </div>

        {verdict === 'warn' && warnings.length > 0 && (
          <ul className="space-y-1.5">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-500/[0.07] p-2.5 text-[13px] leading-6 text-amber-900 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}

        {verdict === 'blocked' && (
          <>
            <ul className="space-y-1.5">
              {blockers.map((b, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-red-500/[0.07] p-2.5 text-[13px] leading-6 text-red-900 dark:text-red-200">
                  <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {b}
                </li>
              ))}
            </ul>
            <p className="text-[13px] leading-6 text-muted-foreground">
              برای نصب واقعی، ابتدا موانع بالا را روی سرور برطرف کنید (مثلاً فضای
              دیسک آزاد کنید یا با کاربری دارای sudo وصل شوید) و دوباره «بررسی
              مجدد» بزنید.
            </p>
            {!ackBlocked ? (
              <div className="flex flex-col gap-2 border-t border-red-500/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-6 text-muted-foreground">
                  می‌خواهید مراحل را به‌هرحال ببینید؟ Dry-Run هیچ چیزی روی سرور
                  تغییر نمی‌دهد؛ نصب واقعی صادقانه در همین‌جا متوقف خواهد شد.
                </p>
                <Button
                  variant="outline"
                  className="h-11 shrink-0 gap-2 rounded-xl border-red-500/40 font-bold text-red-700 hover:bg-red-500/10 dark:text-red-300"
                  onClick={onAckBlocked}
                >
                  <Info className="size-4" />
                  ادامه فقط برای Dry-Run
                </Button>
              </div>
            ) : (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-3 text-[13px] leading-6 text-amber-900 dark:text-amber-200">
                شما موانع را دیده‌اید و صرفاً برای آزمایش/آموزش ادامه می‌دهید.
                اجرای واقعی روی این سرور انجام نخواهد شد مگر دسترسی‌ها فراهم شود.
              </p>
            )}
          </>
        )}

        <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
          <Button
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            disabled={verdict === 'blocked' && !ackBlocked}
            onClick={onProceed}
          >
            <CircleCheck className="size-4" />
            {verdict === 'blocked' && !ackBlocked ? 'ابتدا موانع را برطرف کنید' : 'ادامه به تنظیمات نصب'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
