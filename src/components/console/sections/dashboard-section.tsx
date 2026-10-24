'use client'

/**
 * داشبورد — در حالت قطع: معرفی صادقانهٔ محصول + شروع سریع.
 * در حالت متصل: داده‌های واقعی سرور (probe، سلامت سه‌لایه، آمار، هشدارها).
 */

import {
  Activity,
  AlertTriangle,
  BookOpenCheck,
  Cpu,
  Fingerprint,
  Gauge,
  Globe,
  HardDrive,
  HeartPulse,
  KeyRound,
  Layers,
  MemoryStick,
  MonitorSmartphone,
  PlugZap,
  RefreshCw,
  Rocket,
  ServerCog,
  ShieldCheck,
  Terminal,
  Users,
  Workflow,
  CircleCheck,
  CircleX,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import { useConnectionStore } from '@/lib/connection-store'
import {
  useIsConnected,
  useRefreshSession,
  useSessionDataQuery,
} from '../use-agent'
import type {
  HealthResult,
  HsNode,
  HsPreAuthKey,
  HsUser,
  HsVersionResult,
  ProbeResult,
} from '@/lib/agent'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { ArchitectureDiagram } from '@/components/home/architecture-diagram'

export function DashboardSection() {
  const connected = useIsConnected()
  return connected ? <ConnectedDashboard /> : <DisconnectedDashboard />
}

// ---------------------------------------------------------------------------
// حالت قطع — معرفی محصول و شروع سریع
// ---------------------------------------------------------------------------

const QUICK_START = [
  {
    icon: PlugZap,
    title: '۱. اتصال',
    body: 'با مرکز اتصال، به‌صورت امن به VPS خود وصل شوید. در اولین اتصال، هویت سرور با اثرانگشت کلید میزبان تأیید می‌شود (TOFU) و رمز شما هرگز در مرورگر ذخیره نمی‌شود.',
    cta: 'رفتن به مرکز اتصال',
    hash: '#/connect',
  },
  {
    icon: Rocket,
    title: '۲. نصب یا بررسی',
    body: 'کاوش صادقانهٔ سرور (سیستم‌عامل، دیسک، systemd، دسترسی sudo و سرویس‌های موجود) و سپس ویزارد نصب ۱۷ گامی Headscale با پیش‌نمایش Dry-Run بدون هیچ تغییری.',
    cta: 'بخش نصب',
    hash: '#/install',
  },
  {
    icon: Users,
    title: '۳. مدیریت',
    body: 'مدیریت روزمره بدون خط فرمان: کاربران، دستگاه‌ها، کلیدهای عضویت، مسیرها و Exit Node، سیاست دسترسی و پشتیبان‌گیری — همه با نتیجهٔ واقعی.',
    cta: 'بخش کاربران',
    hash: '#/users',
  },
]

const FEATURES = [
  {
    icon: Fingerprint,
    title: 'اتصال امن دومرحله‌ای',
    body: 'تأیید صادقانهٔ اثرانگشت کلید میزبان در اولین اتصال و توقف خودکار با هشدار امنیتی در صورت تغییر کلید — همان استاندارد OpenSSH، بدون میان‌بر ناامن.',
  },
  {
    icon: Gauge,
    title: 'کاوش صادقانهٔ سرور',
    body: 'قبل از هر کاری، وضعیت واقعی سرور خوانده می‌شود: سیستم‌عامل، معماری، دیسک، حافظه، systemd، پورت‌های اشغال‌شده و سرویس‌های موجود — بدون حدس و فرض.',
  },
  {
    icon: HeartPulse,
    title: 'سلامت سه‌لایه',
    body: 'بررسی سلامت هم‌زمان از سه مسیر مستقل: وضعیت سرویس، پاسخ HTTP سلامت و دستور health خود headscale — اگر لایه‌ای جواب ندهد، همان‌جا صادقانه اعلام می‌شود.',
  },
  {
    icon: Terminal,
    title: 'مدیریت کامل نسخهٔ 0.29.5',
    body: 'کاربران، دستگاه‌ها، PreAuthKey و API Key، مسیرها (Subnet Router/Exit Node)، سیاست ACL و پیکربندی — دقیقاً با همان دستوراتی که خود headscale می‌پذیرد.',
  },
  {
    icon: ShieldCheck,
    title: 'عملیات مخرب با تأیید صریح',
    body: 'حذف کاربر/دستگاه، توقف سرویس، اعمال ACL و بازنویسی پیکربندی همیشه با دیالوگ تأیید و نام واقعی هدف انجام می‌شود و همهٔ عملیات در حسابرسی محلی ثبت می‌گردد.',
  },
  {
    icon: BookOpenCheck,
    title: '۱۴ فصل آموزش فارسی',
    body: 'از «VPN چیست؟» تا پروژهٔ عملی و دوربین‌های مداربسته — مبتدی‌پسند با مرز صادقانهٔ تشبیه و واقعیت، همراه با مرجع دستورات و عیب‌یابی ۱۴ خطای رایج.',
  },
]

function DisconnectedDashboard() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      {/* Hero */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center text-center"
      >
        <Badge
          variant="outline"
          className="mb-5 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <Activity className="size-3.5" />
          کنسول مدیریت — نسخهٔ 0.1.0
        </Badge>
        <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
          Headscale Easy Manager
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
          این برنامه از طریق SSH به سرور شما وصل می‌شود و Headscale را نصب و
          مدیریت می‌کند — بدون اینکه خودِ سرور شما را برای عموم باز کنید یا
          داده‌ای جعلی به شما نشان دهد.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={() => navigate('#/connect')}
            className="h-12 gap-2 rounded-xl bg-emerald-600 px-7 text-base font-bold text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:shadow-emerald-500/20 dark:hover:bg-emerald-400"
          >
            <PlugZap className="size-5" />
            اتصال به سرور
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate('#/learn')}
            className="h-12 gap-2 rounded-xl px-7 text-base font-bold"
          >
            <BookOpenCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
            مرکز آموزش
          </Button>
        </div>

        <p className="mt-4 text-xs leading-6 text-muted-foreground">
          سروری ندارید؟ در مرکز اتصال، «سرور آزمایشی داخلی» برای دیدن کل جریان
          (تأیید اثرانگشت تا مدیریت واقعی) آماده است.
        </p>
      </motion.section>

      {/* شروع سریع سه‌مرحله‌ای */}
      <section className="mt-14" aria-label="شروع سریع">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            سه قدم تا شبکهٔ خصوصی شما
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {QUICK_START.map((s, i) => {
            const Icon = s.icon
            return (
              <motion.div
                key={s.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.35, delay: i * 0.08 }}
              >
                <Card className="h-full bg-card/70 transition-all hover:border-emerald-500/40">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="inline-flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">{s.title}</h3>
                    <p className="flex-1 text-[13px] leading-6 text-muted-foreground">{s.body}</p>
                    <Button
                      variant="outline"
                      className="h-11 w-full gap-2 rounded-xl font-bold"
                      onClick={() => navigate(s.hash)}
                    >
                      {s.cta}
                      <span aria-hidden>←</span>
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </section>

      {/* معماری */}
      <section className="mt-14" aria-label="معماری شبکه">
        <div className="mb-5 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            معماری: VPS فقط هماهنگ‌کننده است
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            گوشی و لپ‌تاپ شما از هر جای دنیا به شبکهٔ بستهٔ دفتر وصل می‌شوند —
            بدون باز شدن هیچ پورتی
          </p>
        </div>
        <ArchitectureDiagram />
        <Card className="mt-6 border-amber-500/30 bg-amber-500/[0.05]">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
            <Layers className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm leading-7 text-foreground/90">
              <p className="font-bold text-foreground">
                تفاوت Control Plane و Data Plane — حقیقت مهم
              </p>
              <p className="mt-1.5">
                Headscale روی VPS شما فقط «هماهنگ‌کنندهٔ» شبکه است: معرفی
                دستگاه‌ها به هم، تأیید عضویت و تبادل کلیدها از اینجا می‌گذرد. اما{' '}
                <strong>ترافیک دادهٔ شما معمولاً مستقیماً بین دستگاه‌ها</strong>{' '}
                (رمزنگاری‌شده با WireGuard) جابه‌جا می‌شود و از VPS عبور نمی‌کند؛
                VPS شما پهنای‌باند شما را مصرف نمی‌کند و محتوای ترافیک‌تان را
                نمی‌بیند. اگر اتصال مستقیم ممکن نباشد، داده از سرور رلهٔ DERP
                (اختیاری و روی همان VPS خودتان) عبور می‌کند.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ویژگی‌ها */}
      <section aria-label="قابلیت‌ها" className="mt-14">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            چه کاری برای شما انجام می‌دهد؟
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            همهٔ قابلیت‌های زیر روی دادهٔ واقعی سرور شما کار می‌کنند — پشت هرکدام
            یک دستور واقعی SSH است.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
              >
                <Card className="group h-full border-border/80 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="inline-flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500/15 dark:text-emerald-400">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">{f.title}</h3>
                    <p className="text-[13px] leading-6 text-muted-foreground">{f.body}</p>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// حالت متصل — دادهٔ واقعی
// ---------------------------------------------------------------------------

function ConnectedDashboard() {
  const host = useConnectionStore((s) => s.host)
  const port = useConnectionStore((s) => s.port)
  const username = useConnectionStore((s) => s.username)
  const hsMode = useConnectionStore((s) => s.hsMode)
  const refreshAll = useRefreshSession()

  // کوئری‌های واقعی — فقط وقتی متصل هستیم فعال
  const probe = useSessionDataQuery<ProbeResult>(['probe'], 'probe', { staleTime: 60_000 })
  const health = useSessionDataQuery<HealthResult>(['health'], 'health', {
    staleTime: 30_000,
    refetchInterval: 90_000,
  })
  const users = useSessionDataQuery<HsUser[]>(['hs', 'users'], 'hs/users', { staleTime: 30_000 })
  const nodes = useSessionDataQuery<HsNode[]>(['hs', 'nodes'], 'hs/nodes', { staleTime: 30_000 })
  const keys = useSessionDataQuery<HsPreAuthKey[]>(['hs', 'preauthkeys'], 'hs/preauthkeys', {
    staleTime: 30_000,
  })
  const version = useSessionDataQuery<HsVersionResult>(['hs', 'version'], 'hs/version', {
    staleTime: 5 * 60_000,
  })

  const onlineNodes = (nodes.data ?? []).filter((n) => n.online === true).length
  const now = new Date()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      {/* سربرگ نشست */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black text-foreground sm:text-2xl">
            <span className="relative flex size-3">
              <span className="absolute inline-flex size-3 rounded-full bg-emerald-500" />
              <span className="absolute inline-flex size-3 animate-ping rounded-full bg-emerald-500 opacity-60" />
            </span>
            سرور شما
          </h1>
          <p className="mt-1.5 font-mono text-sm text-muted-foreground" dir="ltr">
            {username}@{host}:{port}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-xl font-bold"
          onClick={() => {
            refreshAll()
            toast.success('بازآوری همهٔ داده‌های سرور آغاز شد.')
          }}
        >
          <RefreshCw className={cn('size-4', probe.isFetching && 'animate-spin')} />
          بازآوری همه
        </Button>
      </div>

      {/* ردیف آمار */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="کاربران"
          value={users.data}
          loading={users.isLoading}
          error={users.error ? 'خطا' : null}
          icon={Users}
          onClick={() => navigate('#/users')}
        />
        <StatCard
          label="دستگاه‌ها"
          value={nodes.data}
          sub={nodes.data ? `${onlineNodes.toLocaleString('fa-IR')} آنلاین` : undefined}
          loading={nodes.isLoading}
          error={nodes.error ? 'خطا' : null}
          icon={MonitorSmartphone}
          onClick={() => navigate('#/nodes')}
        />
        <StatCard
          label="کلیدهای عضویت"
          value={keys.data}
          loading={keys.isLoading}
          error={keys.error ? 'خطا' : null}
          icon={KeyRound}
          onClick={() => navigate('#/keys')}
        />
        <StatCard
          label="نسخهٔ Headscale"
          value={version.data?.version ?? null}
          loading={version.isLoading}
          error={version.error ? 'خطا' : null}
          icon={ServerCog}
          onClick={() => navigate('#/server')}
        />
      </div>

      {/* سرور + سلامت */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ServerCard probe={probe.data} loading={probe.isLoading} error={probe.error} onRetry={() => void probe.refetch()} hsMode={hsMode} />
        <HealthCard health={health.data} loading={health.isLoading} error={health.error} onRetry={() => void health.refetch()} now={now} />
      </div>

      {/* هشدارهای کاوش */}
      {(probe.data?.warnings.length || probe.data?.blockers.length) ? (
        <ProbeAlertsCard warnings={probe.data?.warnings ?? []} blockers={probe.data?.blockers ?? []} />
      ) : null}

      {/* دسترسی سریع */}
      <section className="mt-8" aria-label="دسترسی سریع">
        <h2 className="mb-4 text-base font-black text-foreground">دسترسی سریع</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Users, label: 'مدیریت کاربران', hash: '#/users' },
            { icon: KeyRound, label: 'کلید جدید', hash: '#/keys' },
            { icon: Rocket, label: 'نصب / به‌روزرسانی', hash: '#/install' },
            { icon: ServerCog, label: 'سرور و لاگ', hash: '#/server' },
          ].map((a) => {
            const Icon = a.icon
            return (
              <Button
                key={a.hash}
                variant="outline"
                className="h-16 justify-start gap-3 rounded-xl text-sm font-bold"
                onClick={() => navigate(a.hash)}
              >
                <span className="inline-flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Icon className="size-4" />
                </span>
                {a.label}
              </Button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  sub,
  loading,
  error,
  icon: Icon,
  onClick,
}: {
  label: string
  value: Array<unknown> | string | null | undefined
  sub?: string
  loading: boolean
  error: string | null
  icon: React.ElementType
  onClick: () => void
}) {
  const display = Array.isArray(value)
    ? value.length.toLocaleString('fa-IR')
    : value
      ? String(value)
      : null
  return (
    <Card className="bg-card/70 transition-all hover:border-emerald-500/40">
      <CardContent className="p-4 sm:p-5">
        <button type="button" onClick={onClick} className="flex w-full items-center gap-3 text-start">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold text-muted-foreground">{label}</span>
            {loading ? (
              <Skeleton className="mt-1 h-7 w-14" />
            ) : error ? (
              <span className="mt-0.5 block text-lg font-black text-red-500">—</span>
            ) : (
              <span className="mt-0.5 block text-2xl font-black text-foreground">
                {display ?? '—'}
                {sub && <span className="ms-1.5 text-[11px] font-normal text-muted-foreground">{sub}</span>}
              </span>
            )}
          </span>
        </button>
      </CardContent>
    </Card>
  )
}

function ServerCard({
  probe,
  loading,
  error,
  onRetry,
  hsMode,
}: {
  probe: ProbeResult | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  hsMode: string | null
}) {
  return (
    <Card className="bg-card/70">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <Gauge className="size-5 text-emerald-600 dark:text-emerald-400" />
            مشخصات سرور
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground"
            onClick={onRetry}
            aria-label="کاوش مجدد سرور"
          >
            <RefreshCw className="size-3.5" />
            مجدد
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : error || !probe ? (
          <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              کاوش سرور ناموفق بود
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              {error instanceof Error ? error.message : 'خطای نامشخص.'} اگر اتصال
              قطع شده باشد، از قرص بالای صفحه دوباره وصل شوید.
            </p>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </div>
        ) : (
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="px-3 py-1.5">{probe.os.pretty}</Badge>
              <Badge variant="secondary" className="px-3 py-1.5">
                <Cpu className="size-3.5" />
                {probe.os.arch} · {probe.cpu.cores.toLocaleString('fa-IR')} هسته
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'px-3 py-1.5',
                  probe.systemd.available
                    ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/40 text-amber-700 dark:text-amber-300'
                )}
              >
                systemd: {probe.systemd.available ? 'موجود' : 'غیرموجود'}
              </Badge>
              <Badge variant="outline" className="px-3 py-1.5">
                sudo: {probe.sudo.mode === 'root' ? 'root' : probe.sudo.mode === 'nopasswd' ? 'بدون رمز' : probe.sudo.mode === 'password' ? 'با رمز' : 'ندارد'}
              </Badge>
            </div>

            <p className="font-mono text-[11px] leading-5 text-muted-foreground" dir="ltr">
              {probe.kernel}
            </p>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

            <div className="flex items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3 text-[12px]">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Globe className="size-4 text-emerald-600 dark:text-emerald-400" />
                IP عمومی سرور
              </span>
              <code className="font-mono text-foreground" dir="ltr">
                {probe.net.publicIp ?? 'نامشخص'}
              </code>
            </div>

            {hsMode && (
              <p className="text-[11px] leading-5 text-muted-foreground">
                حالت اجرای Headscale در این نشست:{' '}
                {hsMode === 'custom' ? 'باینری/پیکربندی دلخواه' : hsMode === 'system' ? 'نصب سیستمی (root)' : 'نصب سیستمی با sudo'}
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

function HealthCard({
  health,
  loading,
  error,
  onRetry,
  now,
}: {
  health: HealthResult | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  now: Date
}) {
  const layers = health
    ? [
        { key: 'service', label: 'سرویس (systemd/فرایند)', layer: health.layers.service },
        { key: 'http', label: 'پاسخ HTTP سلامت', layer: health.layers.http },
        { key: 'cli', label: 'دستور headscale health', layer: health.layers.cli },
      ]
    : []

  return (
    <Card className="bg-card/70">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <HeartPulse className="size-5 text-emerald-600 dark:text-emerald-400" />
            سلامت Headscale
          </h2>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5"
            onClick={onRetry}
            aria-label="بررسی مجدد سلامت"
          >
            <RefreshCw className="size-3.5" />
            بررسی مجدد
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error || !health ? (
          <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              بررسی سلامت ناموفق بود
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              {error instanceof Error ? error.message : 'خطای نامشخص.'}
            </p>
            <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={onRetry}>
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className={cn(
                'flex items-center gap-2 rounded-xl border p-3 text-sm font-bold',
                health.healthy
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
              )}
            >
              {health.healthy ? <CircleCheck className="size-5" /> : <CircleX className="size-5" />}
              {health.healthy ? 'هر سه لایه سالم است' : 'حداقل یک لایه مشکل دارد'}
            </div>
            {layers.map((l) => (
              <div
                key={l.key}
                className={cn(
                  'flex items-start gap-3 rounded-xl border p-3',
                  l.layer.ok ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'border-red-500/30 bg-red-500/[0.05]'
                )}
              >
                {l.layer.ok ? (
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                ) : (
                  <CircleX className="mt-0.5 size-4 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-foreground">{l.label}</p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[12px] leading-5 text-muted-foreground">
                    {l.layer.detail}
                    <span className="ms-1 opacity-60">({l.layer.via})</span>
                  </p>
                </div>
              </div>
            ))}
            <p className="text-[11px] leading-5 text-muted-foreground">
              آخرین بررسی: {now.toLocaleTimeString('fa-IR')} · آدرس سلامت:{' '}
              <code className="font-mono" dir="ltr">{health.healthUrl}</code>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProbeAlertsCard({ warnings, blockers }: { warnings: string[]; blockers: string[] }) {
  if (!warnings.length && !blockers.length) return null
  return (
    <Card className="mt-6 border-amber-500/30 bg-amber-500/[0.03]">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-black text-foreground">
          <AlertTriangle className="size-5 text-amber-500" />
          نکات کاوش سرور
        </h2>
        {blockers.length > 0 && (
          <div className="space-y-2 rounded-xl border border-red-500/30 bg-red-500/[0.05] p-4">
            <p className="text-[13px] font-bold text-red-700 dark:text-red-300">
              موانع (پیش از نصب باید حل شوند):
            </p>
            {blockers.map((b) => (
              <p key={b} className="flex gap-2 text-[12px] leading-6 text-foreground/90">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
                {b}
              </p>
            ))}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-4">
            <p className="text-[13px] font-bold text-amber-700 dark:text-amber-300">هشدارها:</p>
            {warnings.map((w) => (
              <p key={w} className="flex gap-2 text-[12px] leading-6 text-foreground/90">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                {w}
              </p>
            ))}
          </div>
        )}
        <Separator />
        <p className="text-[11px] leading-5 text-muted-foreground">
          این فهرست از خروجی واقعی دستورات روی سرور شما خوانده شده است و ممکن است
          برای سرور آزمایشی/محیط‌های خاص، مواردی صادقانه گزارش شود که روی VPS
          واقعی شما وجود ندارد.
        </p>
      </CardContent>
    </Card>
  )
}
