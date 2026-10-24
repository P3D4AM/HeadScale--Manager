'use client'

/**
 * مرحلهٔ ۳ — پیش‌نمایش و اعتبارسنجی: اجرای «واقعی» Dry-Run روی سرور
 * (bash install.sh --dry-run …) و نمایش برنامهٔ تجزیه‌شدهٔ گام‌ها.
 * رضایت صریح قبل از باز شدن دکمهٔ اجرا لازم است.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  FileCode2,
  Flame,
  Loader2,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { validateInstall, type ValidateOutcome } from '@/lib/install/api'
import { sanitizeSettingsForSend } from '@/lib/install/validation'
import type { InstallSettings, PlanStep } from '@/lib/install/types'
import { AgentError } from '@/lib/agent'

/** گام نهایی هر شماره (running + نتیجه → فقط نتیجه) */
export function collapsePlan(plan: PlanStep[]): PlanStep[] {
  const byStage = new Map<number, PlanStep>()
  for (const s of plan) {
    const prev = byStage.get(s.stage)
    if (!prev || prev.status === 'running') byStage.set(s.stage, s)
  }
  return [...byStage.values()].sort((a, b) => a.stage - b.stage)
}

const CADDY_FA: Record<string, string> = {
  install: 'نصب Caddy جدید + گواهی HTTPS خودکار (Let’s Encrypt)',
  reuse: 'استفاده از Caddy موجود روی سرور',
  skip: 'بدون پروکسی معکوس (فقط تست — بدون HTTPS)',
}

export function StageValidate({
  sessionId,
  settings,
  remoteDir,
  onValidated,
  onExecute,
  onBackToSettings,
}: {
  sessionId: string
  settings: InstallSettings
  remoteDir: string
  /** گزارش نتیجه به والد برای گارد مرحلهٔ ۴ */
  onValidated: (ok: boolean, response: ValidateOutcome['success'] | null) => void
  onExecute: () => void
  onBackToSettings: () => void
}) {
  const [outcome, setOutcome] = useState<ValidateOutcome | null>(null)
  const [running, setRunning] = useState(true)
  const [consent, setConsent] = useState(false)
  const runSeq = useRef(0)
  // اجرای خودکار فقط یک‌بار در هر mount (مقاوم در برابر اجرای دوبارهٔ افکت)
  const startedRef = useRef(false)
  // مرجع پایدار برای callback والد (تا هویت inline-arrow والد اجرای مجدد نخواهد)
  const onValidatedRef = useRef(onValidated)
  useEffect(() => {
    onValidatedRef.current = onValidated
  }, [onValidated])

  const run = useCallback(async () => {
    const seq = ++runSeq.current
    setRunning(true)
    setOutcome(null)
    setConsent(false)
    try {
      const res = await validateInstall(
        sessionId,
        sanitizeSettingsForSend(settings),
        remoteDir
      )
      if (seq !== runSeq.current) return
      setOutcome(res)
      onValidatedRef.current(Boolean(res.success), res.success ?? null)
      if (res.success) {
        const steps = collapsePlan(res.success.plan)
        const warns = steps.filter((s) => s.status === 'needs_action').length
        toast.success(`Dry-Run کامل شد — ${steps.length.toLocaleString('fa-IR')} گام بررسی شد.`, {
          description: warns > 0 ? `${warns.toLocaleString('fa-IR')} گام نیازمند توجه است.` : 'بدون خطا.',
        })
      } else if (res.failed) {
        toast.error(`Dry-Run با کد خروج ${res.failed.exitCode} متوقف شد.`)
      } else if (res.invalid) {
        toast.error('تنظیمات توسط سرور رد شد.', { description: res.invalid.message })
      } else if (res.error) {
        toast.error('اجرای Dry-Run ناموفق بود.', { description: res.error.message })
      }
    } catch (err) {
      if (seq !== runSeq.current) return
      const msg = err instanceof AgentError ? err.message : 'خطای نامشخص'
      setOutcome({ error: err instanceof AgentError ? err : new AgentError('INTERNAL', msg) })
      onValidatedRef.current(false, null)
      toast.error('اجرای Dry-Run ناموفق بود.', { description: msg })
    } finally {
      if (seq === runSeq.current) setRunning(false)
    }
  }, [sessionId, settings, remoteDir])

  // اجرای خودکار هنگام ورود به مرحله (فقط یک‌بار در هر mount)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void run()
  }, [])

  const success = outcome?.success ?? null
  const failed = outcome?.failed ?? null
  const steps = useMemo(() => collapsePlan(success?.plan ?? []), [success])

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-5"
      aria-label="مرحلهٔ ۳ — پیش‌نمایش و اعتبارسنجی"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-foreground">پیش‌نمایش و اعتبارسنجی (Dry-Run)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            برنامهٔ کامل نصب «بدون هیچ تغییری» روی سرور اجرا می‌شود تا مطمئن شویم
            همه‌چیز درست است. (بررسی‌های شبکه ممکن است چند ثانیه طول بکشد)
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="h-11 gap-2 rounded-xl font-bold"
            onClick={onBackToSettings}
            disabled={running}
          >
            <ArrowRight className="size-4" />
            بازگشت به تنظیمات
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-2 rounded-xl font-bold"
            onClick={() => void run()}
            disabled={running}
          >
            <RefreshCw className={cn('size-4', running && 'animate-spin')} />
            اجرای مجدد Dry-Run
          </Button>
        </div>
      </div>

      {/* در حال اجرا */}
      {running && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-3 text-sm font-bold text-foreground">
              <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
              در حال اجرای Dry-Run واقعی روی سرور…
            </div>
            <div className="space-y-2.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-6 rounded-full" />
                  <Skeleton className="h-4" style={{ width: `${45 + ((i * 13) % 45)}%` }} />
                </div>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">
              نصب‌کننده روی سرور شما اجرا می‌شود: بررسی DNS، IP عمومی، منابع و
              ساخت برنامهٔ گام‌ها — بدون اعمال هیچ تغییری.
            </p>
          </CardContent>
        </Card>
      )}

      {/* خطای اعتبارسنجی agent */}
      {!running && outcome?.invalid && (
        <Alert variant="destructive">
          <CircleX className="size-4" />
          <AlertTitle className="font-bold">سرور این تنظیمات را نپذیرفت</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-inside list-disc space-y-1 leading-7">
              {outcome.invalid.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
            <div className="mt-3">
              <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={onBackToSettings}>
                <ArrowRight className="size-4" />
                اصلاح تنظیمات
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* خطای شبکه */}
      {!running && outcome?.error && (
        <Alert variant="destructive">
          <CircleX className="size-4" />
          <AlertTitle className="font-bold">اجرای Dry-Run ناموفق بود</AlertTitle>
          <AlertDescription className="leading-6">
            {outcome.error.message}
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={() => void run()}>
                <RefreshCw className="size-4" />
                تلاش مجدد
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* dry-run اجرا شد ولی شکست خورد (کد خروج غیرصفر) */}
      {!running && failed && (
        <Card className="border-destructive/50">
          <CardContent className="space-y-4 p-5">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400">
                <ShieldAlert className="size-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-base font-black text-foreground">
                  Dry-Run با کد خروج {failed.exitCode} متوقف شد
                </h3>
                <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                  نصب‌کنندهٔ واقعی روی سرور اجرا شد و در میانهٔ کار متوقف شد. خروجی
                  خام را بخوانید — معمولاً مشکل از تنظیمات (دامنه/DNS) یا منابع
                  سرور است. اجرای واقعی تا زمان رفع این مشکل ممکن نیست.
                </p>
              </div>
            </div>
            <RawOutput output={failed.output + (failed.stderr ? `\n${failed.stderr}` : '')} />
            <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={onBackToSettings}>
              <ArrowRight className="size-4" />
              بازگشت به تنظیمات
            </Button>
          </CardContent>
        </Card>
      )}

      {/* موفق */}
      {!running && success && (
        <>
          <Alert className="border-emerald-500/40 bg-emerald-500/[0.05]">
            <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
            <AlertTitle className="font-bold">
              Dry-Run با موفقیت کامل شد (کد خروج ۰)
            </AlertTitle>
            <AlertDescription className="text-[13px] leading-6">
              برنامهٔ زیر عیناً همان چیزی است که در اجرای واقعی روی سرور شما
              اعمال می‌شود.
              {success.finalState === 'dry_run_complete' && ' — شبیه‌سازی کامل نصب تا انتها انجام شد.'}
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 lg:grid-cols-5">
            {/* برنامهٔ گام‌ها */}
            <Card className="lg:col-span-3">
              <CardContent className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-sm font-black text-foreground">
                    <FileCode2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                    برنامهٔ گام‌ها
                  </h3>
                  <PlanSummary steps={steps} />
                </div>
                <ol className="space-y-1.5">
                  {steps.map((s) => (
                    <StepRow key={s.stage} step={s} />
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* خلاصهٔ تغییرات */}
            <div className="space-y-4 lg:col-span-2">
              <ChangesSummary settings={settings} steps={steps} />
              <RiskCard steps={steps} />
            </div>
          </div>

          {/* خروجی خام */}
          <RawOutputCollapsible output={success.output + (success.stderr ? `\n${success.stderr}` : '')} />

          {/* رضایت + اجرا */}
          <Card className="border-amber-500/40 bg-amber-500/[0.03]">
            <CardContent className="space-y-4 p-5">
              <label
                htmlFor="install-consent"
                className="flex min-h-[44px] cursor-pointer items-start gap-3 text-[13px] font-bold leading-7 text-foreground"
              >
                <Checkbox
                  id="install-consent"
                  checked={consent}
                  onCheckedChange={(v) => setConsent(v === true)}
                  className="mt-1 size-5 data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 dark:data-[state=checked]:border-emerald-500 dark:data-[state=checked]:bg-emerald-500"
                />
                <span>
                  برنامهٔ بالا را بررسی کردم و اجرای آن را تأیید می‌کنم — این
                  تغییرات روی سرور اعمال می‌شود
                </span>
              </label>
              <div className="flex flex-col gap-2 border-t border-amber-500/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[12px] leading-6 text-muted-foreground">
                  پس از شروع، خروجی زندهٔ هر گام را می‌بینید و تا لحظهٔ پایانی
                  امکان لغو ایمن دارید.
                </p>
                <Button
                  className="h-12 gap-2 rounded-xl bg-red-600 px-6 text-base font-black text-white hover:bg-red-500 dark:bg-red-500 dark:hover:bg-red-400"
                  disabled={!consent}
                  onClick={onExecute}
                >
                  <PlayCircle className="size-5" />
                  شروع اجرای نصب
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </motion.section>
  )
}

// ---------------------------------------------------------------- اجزا

function PlanSummary({ steps }: { steps: PlanStep[] }) {
  const ok = steps.filter((s) => s.status === 'ok').length
  const warn = steps.filter((s) => s.status === 'needs_action').length
  const bad = steps.filter((s) => s.status === 'failed').length
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <Badge className="rounded-full bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300">
        {ok.toLocaleString('fa-IR')} ✓ موفق
      </Badge>
      {warn > 0 && (
        <Badge className="rounded-full bg-amber-500/15 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300">
          {warn.toLocaleString('fa-IR')} ⚠ نیازمند توجه
        </Badge>
      )}
      {bad > 0 && (
        <Badge className="rounded-full bg-red-500/15 text-red-700 hover:bg-red-500/15 dark:text-red-300">
          {bad.toLocaleString('fa-IR')} ✗ ناموفق
        </Badge>
      )}
      <span className="text-muted-foreground">از {steps.length.toLocaleString('fa-IR')} گام</span>
    </div>
  )
}

function StepRow({ step }: { step: PlanStep }) {
  const icon =
    step.status === 'ok' ? (
      <CircleCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
    ) : step.status === 'needs_action' ? (
      <CircleAlert className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />
    ) : step.status === 'failed' ? (
      <CircleX className="size-5 text-red-600 dark:text-red-400" aria-hidden />
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
    )
  return (
    <li
      className={cn(
        'flex min-h-[44px] items-start gap-3 rounded-lg border px-3 py-2',
        step.risk === 'risky'
          ? step.status === 'needs_action'
            ? 'border-amber-500/50 bg-amber-500/[0.07]'
            : 'border-amber-500/30 bg-amber-500/[0.04]'
          : 'border-border/60 bg-card/50'
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-6 text-foreground">
          <span className="text-muted-foreground">
            گام {step.stage.toLocaleString('fa-IR')} از {step.total.toLocaleString('fa-IR')} —
          </span>{' '}
          {step.title}
          {step.risk === 'risky' && (
            <Badge variant="outline" className="ms-2 rounded-full border-amber-500/50 bg-amber-500/10 px-2 py-0 text-[10px] text-amber-700 dark:text-amber-300">
              حساس
            </Badge>
          )}
        </p>
        {step.detail && (
          <p className="mt-0.5 break-words text-[12px] leading-6 text-muted-foreground">
            {step.detail}
          </p>
        )}
      </div>
    </li>
  )
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-0">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 text-left text-[12px] font-bold leading-6 text-foreground">
        {value}
      </span>
    </div>
  )
}

function ChangesSummary({
  settings,
  steps,
}: {
  settings: InstallSettings
  steps: PlanStep[]
}) {
  // قواعد فایروال از خروجی «واقعی» Dry-Run (جزئیات گام فایروال)
  const fwStep = steps.find((s) => s.title.includes('فایروال') && s.detail?.includes('قواعد'))
  const fwRules = fwStep?.detail
    ?.split('قواعد:')[1]
    ?.split(/[،,]/)
    .map((x) => x.trim())
    .filter(Boolean)

  const hsVer = (settings.headscale_version ?? '').trim() || 'نسخهٔ پین‌شدهٔ پروژه (0.29.5)'

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="mb-2 text-sm font-black text-foreground">خلاصهٔ تغییرات</h3>
        <div>
          <SummaryRow
            label="نصب Headscale"
            value={<span dir="ltr" className="font-mono">{hsVer}</span>}
          />
          <SummaryRow label="پروکسی/HTTPS" value={CADDY_FA[settings.caddy_mode ?? 'install']} />
          <SummaryRow
            label="مسیر ابزار روی سرور"
            value={<span dir="ltr" className="font-mono break-all">{settings.install_dir}</span>}
          />
          <SummaryRow
            label="فایل وضعیت نصب"
            value={<span dir="ltr" className="font-mono">/etc/hem/state.json</span>}
          />
          <SummaryRow
            label="اولین کاربر شبکه"
            value={<span dir="ltr" className="font-mono">{settings.first_user}</span>}
          />
          <SummaryRow
            label="دامنهٔ MagicDNS"
            value={<span dir="ltr" className="font-mono">{settings.magic_dns_base}</span>}
          />
          <SummaryRow
            label="فایروال (UFW)"
            value={
              settings.firewall === false ? (
                'تغییری داده نمی‌شود (خاموش)'
              ) : fwRules && fwRules.length > 0 ? (
                <span dir="ltr" className="font-mono">{fwRules.join('  ·  ')}</span>
              ) : (
                <span dir="ltr" className="font-mono">SSH · 80/tcp · 443/tcp · 3478/udp</span>
              )
            }
          />
        </div>
        <p className="mt-3 rounded-lg bg-muted/40 p-2.5 text-[11px] leading-5 text-muted-foreground">
          فهرست کامل بسته‌ها و دستورها در خروجی خام Dry-Run (پایین همین صفحه) آمده
          است — چیزی از قلم نیفتد.
        </p>
      </CardContent>
    </Card>
  )
}

function RiskCard({ steps }: { steps: PlanStep[] }) {
  const risky = steps.filter((s) => s.risk === 'risky')
  return (
    <Card className="border-amber-500/40 bg-amber-500/[0.04]">
      <CardContent className="p-5">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-foreground">
          <Flame className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          گام‌های حساس ({risky.length.toLocaleString('fa-IR')})
        </h3>
        <ul className="space-y-1.5">
          {risky.map((s) => (
            <li key={s.stage} className="flex min-h-[32px] items-center gap-2 text-[12px] leading-6 text-foreground/90">
              <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              {s.title}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
          این گام‌ها بسته‌ها نصب می‌کنند، پیکربندی می‌نویسند، فایروال را تنظیم و
          سرویس را فعال می‌کنند — تغییرات ماندگارند و پیش از اجرای واقعی،
          پشتیبان‌گیری از وضعیت فعلی انجام می‌شود.
        </p>
      </CardContent>
    </Card>
  )
}

export function RawOutput({ output }: { output: string }) {
  return (
    <div
      dir="ltr"
      role="log"
      aria-label="خروجی خام نصب‌کننده"
      className="hem-terminal-scroll max-h-[360px] overflow-y-auto rounded-xl border border-slate-700/60 bg-slate-950 p-4 font-mono text-[12px] leading-6 text-slate-200"
    >
      <pre className="whitespace-pre-wrap break-words">{output || '—'}</pre>
    </div>
  )
}

function RawOutputCollapsible({ output }: { output: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card>
        <CardContent className="p-0">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-5 py-3 text-sm font-bold text-foreground transition-colors hover:bg-muted/40"
              aria-expanded={open}
            >
              <span className="flex items-center gap-2">
                <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
                خروجی کامل Dry-Run (خام — LTR)
              </span>
              <Badge variant="secondary" className="font-mono text-[10px]">
                {output.split('\n').length.toLocaleString('en-US')} lines
              </Badge>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <RawOutput output={output} />
            </div>
          </CollapsibleContent>
        </CardContent>
      </Card>
    </Collapsible>
  )
}
