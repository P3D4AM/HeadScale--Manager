'use client'

/**
 * سکشن سرور و لاگ (#/server) — وضعیت سرویس‌ها، پورت‌های باز، منابع، لاگ زنده و فایروال.
 *
 * صداقت محیط‌ها:
 *  - systemd روی بعضی سرورها (مثل سرور آزمایشی) در دسترس نیست؛ agent به‌صورت
 *    صادقانه از فرایند (pgrep) می‌خواند و «via: process» برمی‌گرداند — این
 *    fallback با برچسب کهربایی نمایش داده می‌شود، نه پنهان.
 *  - journalctl در دسترس نبود → agent از فایل لاگ پروفایل (logPath) tail
 *    می‌کند و منبع «file» + یادداشت برمی‌گرداند؛ اگر آن هم نبود، خطای صادقانه.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  CircleCheck,
  CircleX,
  Cpu,
  Gauge,
  HardDrive,
  ListRestart,
  MemoryStick,
  Network,
  Play,
  Power,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Square,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useIsConnected, useSessionDataQuery, useSessionId } from '../use-agent'
import { AgentError, agentPost } from '@/lib/agent'
import type {
  DiskResult,
  LogsResult,
  PortsResult,
  ServiceActionResult,
  ServiceStatus,
  SystemInfoResult,
} from '@/lib/ops/types'
import type { ProbeResult } from '@/lib/agent'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { MonoBlock } from '../ops/mono-block'
import { ConfirmDialog } from '../ops/confirm-dialog'
import { DisconnectedGuide } from '../ops/disconnected-guide'

export function ServerSection() {
  const connected = useIsConnected()
  if (!connected) {
    return (
      <DisconnectedGuide
        title="سرور و لاگ"
        needText="وضعیت سرویس‌ها، پورت‌های باز، منابع و لاگ‌ها مستقیماً از سرور شما خوانده می‌شود؛ ابتدا از مرکز اتصال وصل شوید."
      />
    )
  }
  return <ServerBody />
}

function ServerBody() {
  const sid = useSessionId()

  // کوئری‌های واقعی
  const hsStatus = useSessionDataQuery<ServiceStatus>(
    ['service', 'headscale'],
    'service/headscale/status',
    { staleTime: 15_000 }
  )
  const caddyStatus = useSessionDataQuery<ServiceStatus>(
    ['service', 'caddy'],
    'service/caddy/status',
    { staleTime: 15_000 }
  )
  const ports = useSessionDataQuery<PortsResult>(['system', 'ports'], 'system/ports', {
    staleTime: 15_000,
  })
  const disk = useSessionDataQuery<DiskResult>(['system', 'disk'], 'system/disk', {
    staleTime: 30_000,
  })
  const info = useSessionDataQuery<SystemInfoResult>(['system', 'info'], 'system/info', {
    staleTime: 30_000,
  })
  const probe = useSessionDataQuery<ProbeResult>(['probe'], 'probe', { staleTime: 60_000 })

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6"
      >
        <h1 className="flex items-center gap-2 text-xl font-black text-foreground sm:text-2xl">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <ServerCog className="size-5" />
          </span>
          سرور و لاگ
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          وضعیت واقعی سرویس‌ها (systemd با fallback صادقانه)، پورت‌های باز از{' '}
          <code className="font-mono" dir="ltr">ss -tulpn</code>، منابع و لاگ زنده.
        </p>
      </motion.div>

      {/* سرویس‌ها */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ServiceCard
          title="سرویس headscale"
          unit="headscale"
          status={hsStatus.data}
          loading={hsStatus.isLoading}
          error={hsStatus.error}
          onRetry={() => void hsStatus.refetch()}
        />
        <ServiceCard
          title="سرویس Caddy (پروکسی معکوس)"
          unit="caddy"
          status={caddyStatus.data}
          loading={caddyStatus.isLoading}
          error={caddyStatus.error}
          onRetry={() => void caddyStatus.refetch()}
        />
      </div>

      {/* پورت‌ها + منابع */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PortsCard
          ports={ports.data?.ports ?? null}
          loading={ports.isLoading}
          error={ports.error}
          onRetry={() => void ports.refetch()}
        />
        <ResourcesCard
          disk={disk.data ?? null}
          info={info.data ?? null}
          probe={probe.data ?? null}
          loading={disk.isLoading || info.isLoading}
          error={disk.error ?? info.error ?? null}
          onRetry={() => {
            void disk.refetch()
            void info.refetch()
          }}
        />
      </div>

      {/* لاگ‌ها */}
      <div className="mt-6">
        <LogsCard />
      </div>

      {/* فایروال */}
      <div className="mt-6">
        <FirewallCard probe={probe.data ?? null} loading={probe.isLoading} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// کارت سرویس — وضعیت + عملیات start/restart/enable/disable/stop(تأیید تایپی)
// ---------------------------------------------------------------------------

function ServiceCard({
  title,
  unit,
  status,
  loading,
  error,
  onRetry,
}: {
  title: string
  unit: string
  status: ServiceStatus | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
}) {
  const sid = useSessionId()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [stopOpen, setStopOpen] = useState(false)
  const [lastResult, setLastResult] = useState<
    { action: string; ok: boolean; text: string } | null
  >(null)

  const runAction = async (action: string, confirm = false) => {
    if (!sid) return
    setPending(action)
    try {
      const res = await agentPost<{ ok: true; data: ServiceActionResult }>(
        `/api/s/${sid}/hs/service/${action}`,
        { unit, ...(confirm ? { confirm: true } : {}) }
      )
      const text = (res.data.stdout + (res.data.stderr ? `\n${res.data.stderr}` : '')).trim()
      setLastResult({ action, ok: true, text: text || 'دستور بدون خروجی اجرا شد (کد خروج ۰).' })
      toast.success(`عملیات «${ACTION_LABELS[action]}» روی ${unit} انجام شد.`)
      void queryClient.invalidateQueries({ queryKey: ['agent', 's', sid, 'service'] })
    } catch (e) {
      const msg = e instanceof AgentError ? e.message : 'خطای نامشخص.'
      setLastResult({ action, ok: false, text: msg })
      toast.error(`عملیات «${ACTION_LABELS[action]}» انجام نشد.`, { description: msg })
    } finally {
      setPending(null)
    }
  }

  const activeBadge = status?.active
  const viaProcess = status?.via === 'process'

  return (
    <Card className="bg-card/70 min-w-0">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <Activity className="size-5 text-emerald-600 dark:text-emerald-400" />
            {title}
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onRetry}
            aria-label={`بررسی مجدد وضعیت ${unit}`}
          >
            <RefreshCw className="size-3.5" />
            بررسی مجدد
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        ) : error || !status ? (
          <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              خواندن وضعیت سرویس ناموفق بود
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              {error instanceof AgentError ? error.message : 'خطای نامشخص.'}
            </p>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* وضعیت */}
            <div className="flex flex-wrap items-center gap-2">
              {activeBadge === true && (
                <Badge className="gap-1.5 border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300" variant="outline">
                  <CircleCheck className="size-3.5" />
                  در حال اجرا
                </Badge>
              )}
              {activeBadge === false && (
                <Badge className="gap-1.5 border-red-500/40 bg-red-500/10 px-3 py-1.5 text-red-700 dark:text-red-300" variant="outline">
                  <CircleX className="size-3.5" />
                  {status.available ? 'متوقف' : 'یافت نشد'}
                </Badge>
              )}
              {activeBadge === null && (
                <Badge variant="outline" className="px-3 py-1.5 text-muted-foreground">
                  وضعیت نامشخص
                </Badge>
              )}
              {status.enabled && (
                <Badge variant="outline" className="px-3 py-1.5">
                  خودراه‌انداز: {status.enabled === 'enabled' ? 'فعال' : 'غیرفعال'}
                </Badge>
              )}
              <Badge variant="outline" className="px-3 py-1.5 font-mono" dir="ltr">
                via: {status.via}
              </Badge>
            </div>

            {/* fallback صادقانهٔ فرایند به‌جای systemd */}
            {viaProcess && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[12px] leading-6 text-amber-700 dark:text-amber-300">
                systemd روی این سرور در دسترس نیست؛ وضعیت به‌صورت صادقانه از فرایند
                (pgrep) خوانده شد. عملیات start/stop/restart/enable/disable به
                systemd نیاز دارند و در این محیط انجام نمی‌شوند.
              </p>
            )}

            {/* خروجی واقعی وضعیت */}
            {status.output.length > 0 && (
              <MonoBlock maxHeightClass="max-h-40" aria-label={`خروجی وضعیت ${unit}`}>
                {status.output.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {l}
                  </div>
                ))}
              </MonoBlock>
            )}

            {/* عملیات */}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['start', 'راه‌اندازی', Play, false],
                  ['restart', 'راه‌اندازی مجدد', ListRestart, false],
                  ['enable', 'فعال‌سازی خودراه‌انداز', Power, false],
                  ['disable', 'غیرفعال‌سازی خودراه‌انداز', Power, false],
                ] as const
              ).map(([action, label, Icon]) => (
                <Button
                  key={action}
                  variant="outline"
                  className="h-11 gap-2 rounded-xl text-[13px] font-bold"
                  disabled={pending !== null}
                  onClick={() => void runAction(action)}
                >
                  {pending === action ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                  {label}
                </Button>
              ))}
              <Button
                variant="outline"
                className="h-11 gap-2 rounded-xl border-red-500/40 text-[13px] font-bold text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                disabled={pending !== null}
                onClick={() => setStopOpen(true)}
              >
                {pending === 'stop' ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <Square className="size-4" />
                )}
                توقف
              </Button>
            </div>

            {/* نتیجهٔ آخرین عملیات — صادقانه */}
            {lastResult && (
              <div
                className={cn(
                  'space-y-1.5 rounded-xl border p-3',
                  lastResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                    : 'border-red-500/30 bg-red-500/[0.05]'
                )}
              >
                <p
                  className={cn(
                    'text-[12px] font-bold',
                    lastResult.ok
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-red-700 dark:text-red-300'
                  )}
                >
                  نتیجهٔ «{ACTION_LABELS[lastResult.action]}»:
                </p>
                {lastResult.text && (
                  <p className="text-[11px] leading-5 text-muted-foreground">{lastResult.text}</p>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* تأیید تایپی توقف */}
      <ConfirmDialog
        open={stopOpen}
        onOpenChange={(o) => !pending && setStopOpen(o)}
        title={`توقف سرویس ${unit}`}
        confirmLabel="توقف قطعی سرویس"
        typedMatch={unit}
        typedLabel={`برای تأیید توقف، نام سرویس («${unit}») را عیناً تایپ کنید:`}
        busy={pending === 'stop'}
        onConfirm={() => {
          setStopOpen(false)
          void runAction('stop', true)
        }}
        description={
          <p>
            توقف {unit === 'headscale' ? 'headscale' : 'Caddy'} باعث قطع موقت سرویس
            می‌شود
            {unit === 'headscale'
              ? ' و اتصال همهٔ دستگاه‌های شبکه شما تا راه‌اندازی مجدد برقرار نمی‌شود'
              : ' و دسترسی HTTPS به سرور تا راه‌اندازی مجدد قطع می‌شود'}
            . مطمئنید؟
          </p>
        }
      />
    </Card>
  )
}

const ACTION_LABELS: Record<string, string> = {
  start: 'راه‌اندازی',
  stop: 'توقف',
  restart: 'راه‌اندازی مجدد',
  enable: 'فعال‌سازی خودراه‌انداز',
  disable: 'غیرفعال‌سازی خودراه‌انداز',
}

// ---------------------------------------------------------------------------
// پورت‌های باز — جدول واقعی ss -tulpn
// ---------------------------------------------------------------------------

function PortsCard({
  ports,
  loading,
  error,
  onRetry,
}: {
  ports: { proto: string; local: string; port: number | null; process: string | null }[] | null
  loading: boolean
  error: unknown
  onRetry: () => void
}) {
  return (
    <Card className="bg-card/70 min-w-0">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <Network className="size-5 text-emerald-600 dark:text-emerald-400" />
            پورت‌های باز سرور
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onRetry}
            aria-label="بررسی مجدد پورت‌ها"
          >
            <RefreshCw className="size-3.5" />
            مجدد
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error || !ports ? (
          <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              خواندن پورت‌ها ناموفق بود
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              {error instanceof AgentError ? error.message : 'خطای نامشخص.'}
            </p>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </div>
        ) : ports.length === 0 ? (
          <p className="rounded-xl border bg-muted/30 p-4 text-[13px] leading-6 text-muted-foreground">
            ss هیچ سوکت شنیداری گزارش نکرد — وضعیت غیرمعمولی است؛ با کنسول
            پیشرفته می‌توانید خودتان <code className="font-mono" dir="ltr">ss -tulpn</code>{' '}
            را اجرا کنید.
          </p>
        ) : (
          <div className="custom-scrollbar max-h-80 overflow-y-auto rounded-xl border">
            <Table>
              <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                <TableRow>
                  <TableHead className="text-start">پروتکل</TableHead>
                  <TableHead className="text-start">آدرس محلی</TableHead>
                  <TableHead className="text-start">پورت</TableHead>
                  <TableHead className="text-start">فرایند</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ports.map((p, i) => (
                  <TableRow key={`${p.proto}-${p.local}-${i}`}>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono" dir="ltr">
                        {p.proto}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-[12px]" dir="ltr">
                      {p.local}
                    </TableCell>
                    <TableCell className="font-mono text-[12px]" dir="ltr">
                      {p.port ?? '—'}
                    </TableCell>
                    <TableCell className="font-mono text-[12px]" dir="ltr">
                      {p.process ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// منابع — df واقعی + میله‌ها از probe + اطلاعات سیستم
// ---------------------------------------------------------------------------

function ResourcesCard({
  disk,
  info,
  probe,
  loading,
  error,
  onRetry,
}: {
  disk: DiskResult | null
  info: SystemInfoResult | null
  probe: ProbeResult | null
  loading: boolean
  error: unknown
  onRetry: () => void
}) {
  return (
    <Card className="bg-card/70 min-w-0">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <HardDrive className="size-5 text-emerald-600 dark:text-emerald-400" />
            دیسک و منابع
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onRetry}
            aria-label="بررسی مجدد منابع"
          >
            <RefreshCw className="size-3.5" />
            مجدد
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error && !disk && !info ? (
          <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              خواندن منابع ناموفق بود
            </p>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {info?.hostname && (
              <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 p-3 text-[12px]">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Gauge className="size-4 text-emerald-600 dark:text-emerald-400" />
                  نام میزبان
                </span>
                <code className="font-mono text-foreground" dir="ltr">
                  {info.hostname}
                </code>
              </div>
            )}

            {/* میله‌های منبع از probe واقعی */}
            {probe && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ResourceBar
                  icon={HardDrive}
                  label="دیسک ریشه"
                  used={probe.disk.rootGb - probe.disk.availGb}
                  total={probe.disk.rootGb}
                  unit="GB"
                />
                <ResourceBar
                  icon={MemoryStick}
                  label="حافظه"
                  used={probe.mem.totalMb - probe.mem.availMb}
                  total={probe.mem.totalMb}
                  unit="MB"
                />
              </div>
            )}
            {probe && (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Cpu className="size-4 text-emerald-600 dark:text-emerald-400" />
                {probe.cpu.cores.toLocaleString('fa-IR')} هستهٔ CPU · هسته:{' '}
                <code className="font-mono" dir="ltr">{probe.kernel}</code>
              </p>
            )}
            {info?.uptime && (
              <p className="text-[12px] text-muted-foreground">
                زمان روشن بودن:{' '}
                <code className="font-mono" dir="ltr">
                  {info.uptime}
                </code>
              </p>
            )}
            {info?.loadavg && (
              <p className="text-[12px] text-muted-foreground">
                بار سیستم:{' '}
                <code className="font-mono" dir="ltr">
                  {info.loadavg}
                </code>
              </p>
            )}

            {/* df -h خام */}
            {disk?.raw ? (
              <MonoBlock maxHeightClass="max-h-40" aria-label="خروجی df -h">
                {disk.raw.split('\n').map((l, i) => (
                  <div key={i} className="whitespace-pre">
                    {l}
                  </div>
                ))}
              </MonoBlock>
            ) : (
              <p className="text-[12px] leading-6 text-muted-foreground">
                خروجی <code className="font-mono" dir="ltr">df -h</code> در دسترس نیست.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ResourceBar({
  icon: Icon,
  label,
  used,
  total,
  unit,
}: {
  icon: React.ElementType
  label: string
  used: number
  total: number
  unit: string
}) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const danger = pct >= 90
  const warn = pct >= 75 && !danger
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12px]">
        <span className="flex items-center gap-1.5 font-bold text-foreground">
          <Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
          {label}
        </span>
        <span className="font-mono text-muted-foreground" dir="ltr">
          {used.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} /{' '}
          {total.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} {unit}
        </span>
      </div>
      <Progress
        value={pct}
        className={cn('h-2', danger && '[&>div]:bg-red-500', warn && '[&>div]:bg-amber-500')}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// لاگ‌ها — انتخاب سرویس/تعداد خط + خودکار ۳۰ثانیه + منبع صادقانه
// ---------------------------------------------------------------------------

const LOG_LINES_OPTIONS = [50, 100, 200, 500]

function LogsCard() {
  const [unit, setUnit] = useState<'headscale' | 'caddy'>('headscale')
  const [lines, setLines] = useState(100)
  const [autoRefresh, setAutoRefresh] = useState(false)

  const logs = useSessionDataQuery<LogsResult>(
    ['logs', unit, lines],
    `logs?unit=${unit}&lines=${lines}`,
    { staleTime: 0, refetchInterval: autoRefresh ? 30_000 : false }
  )

  return (
    <Card className="bg-card/70">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <Terminal className="size-5 text-emerald-600 dark:text-emerald-400" />
            لاگ سرویس
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {/* انتخاب سرویس */}
            <Select
              value={unit}
              onValueChange={(v) => setUnit(v as 'headscale' | 'caddy')}
            >
              <SelectTrigger className="h-11 w-[150px] rounded-xl font-mono" aria-label="انتخاب سرویس">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="headscale">headscale</SelectItem>
                <SelectItem value="caddy">caddy</SelectItem>
              </SelectContent>
            </Select>
            {/* تعداد خط */}
            <Select
              value={String(lines)}
              onValueChange={(v) => setLines(Number.parseInt(v, 10))}
            >
              <SelectTrigger className="h-11 w-[120px] rounded-xl" aria-label="تعداد خط لاگ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LINES_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n.toLocaleString('fa-IR')} خط
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="h-11 gap-2 rounded-xl font-bold"
              onClick={() => void logs.refetch()}
              disabled={logs.isFetching}
            >
              <RefreshCw className={cn('size-4', logs.isFetching && 'animate-spin')} />
              بازآوری
            </Button>
            <div className="flex h-11 items-center gap-2 rounded-xl border px-3">
              <Switch
                id="logs-auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="بازآوری خودکار هر ۳۰ ثانیه"
              />
              <Label
                htmlFor="logs-auto-refresh"
                className="cursor-pointer text-[12px] font-bold text-foreground"
              >
                خودکار (۳۰ثانیه)
              </Label>
            </div>
          </div>
        </div>

        {logs.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-11/12" />
            <Skeleton className="h-8 w-4/5" />
          </div>
        ) : logs.error ? (
          <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              خواندن لاگ ممکن نشد
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              {logs.error instanceof AgentError
                ? logs.error.message
                : 'خطای نامشخص.'}{' '}
              در نصب‌های واقعی (سرور با systemd)، لاگ از{' '}
              <code className="font-mono" dir="ltr">journalctl -u {unit}</code> خوانده
              می‌شود؛ اگر journalctl در دسترس نباشد و مسیر فایل لاگ در پروفایل
              (logPath) تعیین شده باشد، آخرین خطوط همان فایل نمایش داده می‌شود.
            </p>
            <Button
              variant="outline"
              className="h-11 gap-2 rounded-xl"
              onClick={() => void logs.refetch()}
            >
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </div>
        ) : logs.data ? (
          <div className="space-y-2">
            {/* برچسب منبع — صادقانه */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className={cn(
                  'px-3 py-1',
                  logs.data.source === 'journalctl'
                    ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/40 text-amber-700 dark:text-amber-300'
                )}
              >
                منبع: {logs.data.source === 'journalctl' ? 'journalctl' : 'فایل لاگ'}
              </Badge>
              <Badge variant="outline" className="px-3 py-1 font-mono" dir="ltr">
                {unit} · {logs.data.lines.length} lines
              </Badge>
            </div>
            {logs.data.note && (
              <p className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3 text-[12px] leading-6 text-amber-700 dark:text-amber-300">
                {logs.data.note}
              </p>
            )}
            {logs.data.lines.length === 0 ? (
              <p className="rounded-xl border bg-muted/30 p-4 text-[13px] leading-6 text-muted-foreground">
                لاگی برای این سرویس ثبت نشده است (خروجی خالی بود).
              </p>
            ) : (
              <MonoBlock maxHeightClass="max-h-96" aria-label={`لاگ ${unit}`}>
                {logs.data.lines.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {l}
                  </div>
                ))}
              </MonoBlock>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// فایروال — فقط‌خواندنی از کاوش
// ---------------------------------------------------------------------------

function FirewallCard({ probe, loading }: { probe: ProbeResult | null; loading: boolean }) {
  const ufw = probe?.firewall.ufw
  return (
    <Card className="bg-card/70">
      <CardContent className="space-y-3 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-black text-foreground">
          <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
          فایروال (UFW)
        </h2>
        {loading ? (
          <Skeleton className="h-10 w-2/3" />
        ) : !probe ? (
          <p className="text-[13px] leading-6 text-muted-foreground">
            وضعیت فایروال در کاوش سرور خوانده نشد؛ از داشبورد «کاوش مجدد» کنید.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {ufw === 'active' && (
                <Badge className="border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-300" variant="outline">
                  <CircleCheck className="size-3.5" />
                  فعال
                </Badge>
              )}
              {ufw === 'inactive' && (
                <Badge className="border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-amber-700 dark:text-amber-300" variant="outline">
                  <CircleX className="size-3.5" />
                  غیرفعال
                </Badge>
              )}
              {ufw === 'not-installed' && (
                <Badge variant="outline" className="px-3 py-1.5 text-muted-foreground">
                  نصب نشده
                </Badge>
              )}
              {probe.firewall.otherRules && (
                <Badge variant="outline" className="px-3 py-1.5">
                  قواعد غیر-UFW موجود است
                </Badge>
              )}
            </div>
            <p className="text-[12px] leading-6 text-muted-foreground">
              این بخش فقط‌خواندنی است: تغییر قواعد فایروال به‌صورت کنترل‌شده از
              طریق ویزارد نصب (ساخت قواعد لازم + بازگشت خودکار) یا اجرای{' '}
              <code className="font-mono" dir="ltr">ufw status</code> در کنسول
              پیشرفته انجام می‌شود تا سرور شما هرگز پشت فایروال قفل نشود.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
