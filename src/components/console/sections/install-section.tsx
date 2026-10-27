'use client'

/**
 * سکشن نصب (#/install) — ویزارد واقعی ۵ مرحله‌ای:
 *   ۱ بررسی سرور (probe + install/state واقعی)
 *   ۲ تنظیمات نصب (فرم از planInputsSchema واقعی + پیش‌نویس localStorage)
 *   ۳ پیش‌نمایش و اعتبارسنجی (Dry-Run واقعی + رضایت صریح)
 *   ۴ اجرا (job زنده روی socket.io + fallback REST)
 *   ۵ نتیجه (finalState صادقانه + دانلود گزارش)
 *
 * مرحله در پارامتر ?stage= آدرس نگهداری می‌شود (برای اشتراک‌گذاری/رفرش)؛
 * مسیریابی اصلی برنامه (hash-based) دست‌نخورده مانده است.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CloudUpload, PlugZap, Rocket, Trash2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import { useConnectionStore } from '@/lib/connection-store'
import { useIsConnected, useSessionDataQuery, useSessionId } from '../use-agent'
import { AgentError, type ProbeResult } from '@/lib/agent'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { InstallStepper } from '../install/stepper'
import { StageProbe } from '../install/stage-probe'
import { SettingsForm } from '../install/settings-form'
import { StageValidate } from '../install/stage-validate'
import { StageExecute } from '../install/stage-execute'
import { StageResult } from '../install/stage-result'
import {
  clearInstallDraft,
  defaultsFromSchema,
  loadInstallDraft,
  mergeDraftOverDefaults,
  saveInstallDraft,
} from '@/lib/install/settings'
import { sanitizeSettingsForSend, validateInstallSettings } from '@/lib/install/validation'
import {
  clearStageFromUrl,
  normalizeStage,
  readStageFromUrl,
  writeStageToUrl,
  type InstallStage,
} from '@/lib/install/stage-url'
import { executeInstall, prepareInstall } from '@/lib/install/api'
import type {
  InstallPlanField,
  InstallSettings,
  JobOutcome,
} from '@/lib/install/types'

// ---------------------------------------------------------------------------
// وضعیت prepare (بارگذاری مخزن نصب روی سرور)
// ---------------------------------------------------------------------------

interface PrepareState {
  status: 'idle' | 'loading' | 'error' | 'done'
  remoteDir?: string
  sizeBytes?: number
  schema?: InstallPlanField[]
  error?: string
}

export function InstallSection() {
  const connected = useIsConnected()

  if (!connected) {
    return <NotConnectedInstall />
  }
  return <InstallWizard />
}

// ---------------------------------------------------------------------------
// حالت قطع — راهنمای صادقانه
// ---------------------------------------------------------------------------

function NotConnectedInstall() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <Card className="border-dashed border-amber-500/40 bg-amber-500/[0.03]">
        <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Rocket className="size-7" />
            </div>
            <div>
              <Badge variant="outline" className="mb-2 gap-1.5 rounded-full border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                <PlugZap className="size-3" />
                اتصال لازم است
              </Badge>
              <h1 className="text-xl font-black text-foreground sm:text-2xl">
                نصب و راه‌اندازی Headscale
              </h1>
            </div>
          </div>
          <p className="text-sm leading-7 text-foreground/90">
            ویزارد نصب از طریق SSH روی «سرور شما» اجرا می‌شود: ابتدا سرور را
            واقعی بررسی می‌کنیم، بعد مخزن نصب را آپلود می‌کنیم، تنظیمات را
            می‌پرسیم، برنامهٔ کامل را با Dry-Run (بدون هیچ تغییری) نشان می‌دهیم
            و در نهایت — فقط با تأیید صریح شما — نصب واقعی را با خروجی زنده
            اجرا می‌کنیم.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={() => navigate('#/connect')}
              className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            >
              <PlugZap className="size-4" />
              رفتن به مرکز اتصال
            </Button>
            <Button variant="outline" onClick={() => navigate('#/')} className="h-11 gap-2 rounded-xl px-5 font-bold">
              بازگشت به داشبورد
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ویزارد
// ---------------------------------------------------------------------------

function InstallWizard() {
  const sessionId = useSessionId()
  const host = useConnectionStore((s) => s.host)
  const port = useConnectionStore((s) => s.port)
  const username = useConnectionStore((s) => s.username)
  const hostLabel = `${username}@${host}:${port}`

  // ── مرحله (state + URL) ──
  const [stage, setStageState] = useState<InstallStage>(() => readStageFromUrl())
  const [maxReached, setMaxReached] = useState<InstallStage>(() => readStageFromUrl())
  const setStage = useCallback((next: InstallStage) => {
    const n = normalizeStage(next)
    setStageState(n)
    setMaxReached((m) => (n > m ? n : m))
    writeStageToUrl(n)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  useEffect(() => {
    // پاک‌کردن پارامتر مرحله هنگام ترک بخش
    return () => clearStageFromUrl()
  }, [])

  // ── probe مشترک با داشبورد (کلید یکسان → کش مشترک) ──
  const probeQuery = useSessionDataQuery<ProbeResult>(['probe'], 'probe', { staleTime: 60_000 })

  // ── prepare ──
  const [prepare, setPrepare] = useState<PrepareState>({ status: 'idle' })
  const prepareSessionRef = useRef<string | null>(null)
  // گارد هم‌زمانی: اگر افکت به هر دلیلی دوبار اجرا شود، آپلود دوم شروع نمی‌شود
  const prepareBusyRef = useRef(false)

  const runPrepare = useCallback(
    async (sid: string) => {
      if (prepareBusyRef.current) return
      prepareBusyRef.current = true
      prepareSessionRef.current = sid
      setPrepare({ status: 'loading' })
      try {
        const res = await prepareInstall(sid)
        setPrepare({
          status: 'done',
          remoteDir: res.remoteDir,
          sizeBytes: res.sizeBytes,
          schema: res.planInputsSchema,
        })
        toast.success('مخزن نصب روی سرور آماده شد.', {
          description: `${res.remoteDir} (${Math.round(res.sizeBytes / 1024).toLocaleString('fa-IR')} کیلوبایت)`,
        })
      } catch (err) {
        setPrepare({
          status: 'error',
          error: err instanceof AgentError ? err.message : 'خطای نامشخص در بارگذاری مخزن نصب.',
        })
        toast.error('بارگذاری مخزن نصب ناموفق بود.', {
          description: err instanceof AgentError ? err.message : undefined,
        })
      } finally {
        prepareBusyRef.current = false
      }
    },
    []
  )

  // اجرای خودکار prepare هنگام ورود به مرحلهٔ ۲+ (یک‌بار برای هر نشست)
  useEffect(() => {
    if (!sessionId) return
    if (stage < 2) return
    if (prepare.status === 'done' && prepareSessionRef.current === sessionId) return
    if (prepare.status === 'loading') return
    void runPrepare(sessionId)
  }, [sessionId, stage, prepare.status, runPrepare])

  // ── تنظیمات + پیش‌نویس ──
  const [settings, setSettings] = useState<InstallSettings | null>(null)
  const [draftInfo, setDraftInfo] = useState<{ savedAt: string } | null>(null)
  const settingsInitedRef = useRef(false)

  // مقداردهی اولیهٔ تنظیمات از اسکیمای واقعی + پیش‌نویس
  useEffect(() => {
    if (settingsInitedRef.current || !prepare.schema) return
    settingsInitedRef.current = true
    const defaults = defaultsFromSchema(prepare.schema)
    const draft = loadInstallDraft()
    if (draft) {
      setSettings(mergeDraftOverDefaults(defaults, draft.settings))
      setDraftInfo({ savedAt: draft.savedAt })
    } else {
      setSettings(defaults)
    }
  }, [prepare.schema])

  // ذخیرهٔ خودکار پیش‌نویس
  useEffect(() => {
    if (!settings) return
    saveInstallDraft(settings)
  }, [settings])

  const validation = useMemo(
    () => (settings ? validateInstallSettings(settings) : null),
    [settings]
  )
  const settingsValid =
    validation !== null &&
    Object.keys(validation.fieldErrors).length === 0 &&
    Object.keys(validation.cameraErrors).length === 0 &&
    validation.general.length === 0

  const onChangeSettings = (next: InstallSettings) => setSettings(next)
  const resetDefaults = () => {
    if (!prepare.schema) return
    setSettings(defaultsFromSchema(prepare.schema))
  }
  const discardDraft = () => {
    clearInstallDraft()
    setDraftInfo(null)
    if (prepare.schema) setSettings(defaultsFromSchema(prepare.schema))
    toast.info('پیش‌نویس پاک شد و پیش‌فرض‌ها بارگذاری شد.')
  }

  // ── اجرا ──
  const [jobId, setJobId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<JobOutcome | null>(null)
  const [executing, setExecuting] = useState(false)

  const startExecution = async () => {
    if (!sessionId || !settings) return
    const clean = sanitizeSettingsForSend(settings)
    setExecuting(true)
    try {
      const res = await executeInstall(sessionId, clean, prepare.remoteDir)
      setJobId(res.jobId)
      setOutcome(null)
      setStage(4)
      toast.success('اجرای نصب شروع شد — خروجی زنده در حال دریافت…', {
        description: `شناسهٔ job: ${res.jobId}`,
      })
    } catch (err) {
      toast.error('شروع اجرای نصب ناموفق بود.', {
        description: err instanceof AgentError ? err.message : undefined,
      })
    } finally {
      setExecuting(false)
    }
  }

  const onJobDone = useCallback(
    (result: JobOutcome) => {
      setOutcome(result)
      setStage(5)
      if (result.ok) {
        toast.success('نصب تمام شد.', { description: result.summary })
      } else if (result.cancelled) {
        toast.info('اجرا لغو شد.', { description: result.summary })
      } else if (
        result.finalState === 'pending_verification' ||
        result.finalState === 'service_not_ready'
      ) {
        // کد خروج ۴ یعنی نصب انجام شده و تأیید بیرونی/سرویس در انتظار است —
        // نه شکست نصب (اصلاح تسک ۲۶؛ قرارداد FACTS §10).
        toast.warning('نصب انجام شد؛ در انتظار تأیید نهایی.', {
          description: result.summary,
        })
      } else {
        toast.error('نصب ناتمام ماند.', { description: result.summary })
      }
    },
    [setStage]
  )

  const restart = () => {
    setJobId(null)
    setOutcome(null)
    setStage(1)
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      {/* سربرگ */}
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2.5 text-xl font-black text-foreground sm:text-2xl">
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Rocket className="size-5" aria-hidden />
              </span>
              نصب و راه‌اندازی Headscale
            </h1>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              ویزارد ۵ مرحله‌ای — همهٔ بررسی‌ها و اجراها واقعی و از طریق SSH روی
              سرور شما انجام می‌شوند؛ هیچ دادهٔ نمایشی وجود ندارد.
            </p>
          </div>
          <p className="font-mono text-sm text-muted-foreground" dir="ltr">
            {hostLabel}
          </p>
        </div>
      </header>

      {/* استپر */}
      <InstallStepper current={stage} maxReached={maxReached} onGo={(s) => setStage(s)} />

      <div className="mt-8">
        {/* ── مرحلهٔ ۱: بررسی سرور ── */}
        {stage === 1 && (
          <StageProbe
            probeQuery={probeQuery}
            onProceed={() => setStage(2)}
          />
        )}

        {/* ── مرحلهٔ ۲: تنظیمات ── */}
        {stage === 2 && (
          <section className="space-y-5" aria-label="مرحلهٔ ۲ — تنظیمات نصب">
            <PrepareBanner prepare={prepare} onRetry={() => sessionId && void runPrepare(sessionId)} />

            {draftInfo && (
              <Alert className="border-border/70">
                <Trash2 className="size-4 text-muted-foreground" />
                <AlertTitle className="text-sm font-bold">پیش‌نویس بازیابی شد</AlertTitle>
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-[13px] leading-6">
                  <span>
                    تنظیمات ذخیره‌شدهٔ{' '}
                    {new Date(draftInfo.savedAt).toLocaleString('fa-IR')} بازیابی شد (فقط در
                    همین مرورگر ذخیره می‌شود).
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 gap-1.5 rounded-lg text-xs font-bold"
                    onClick={discardDraft}
                  >
                    <Trash2 className="size-3.5" />
                    پاک‌کردن پیش‌نویس
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <SettingsForm
              schema={prepare.schema ?? null}
              settings={settings}
              validation={validation}
              loading={prepare.status === 'loading'}
              onChange={onChangeSettings}
              onResetDefaults={resetDefaults}
            />

            <div className="flex flex-col gap-2 border-t border-border/60 pt-4 sm:flex-row sm:justify-end">
              <Button
                className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 text-base font-black text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                disabled={!settingsValid || prepare.status !== 'done'}
                onClick={() => {
                  if (!validation) return
                  const firstErr = Object.keys(validation.fieldErrors)[0]
                  if (firstErr) {
                    const el = document.querySelector(`[data-field="${firstErr}"]`)
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    toast.error('ابتدا خطاهای فرم را برطرف کنید.', {
                      description: validation.fieldErrors[firstErr],
                    })
                    return
                  }
                  setStage(3)
                }}
              >
                ادامه به پیش‌نمایش (Dry-Run)
              </Button>
            </div>
          </section>
        )}

        {/* ── مرحلهٔ ۳: پیش‌نمایش ── */}
        {stage === 3 &&
          (sessionId && settings && prepare.status === 'done' && prepare.remoteDir ? (
            <StageValidate
              sessionId={sessionId}
              settings={settings}
              remoteDir={prepare.remoteDir}
              onValidated={() => {
                /* نتیجهٔ Dry-Run داخل خود مرحلهٔ ۳ نمایش داده می‌شود؛ اجرا فقط از همان مرحله شروع می‌شود */
              }}
              onExecute={() => void startExecution()}
              onBackToSettings={() => setStage(2)}
            />
          ) : (
            <StageGuard
              title="ابتدا تنظیمات را کامل کنید"
              body="برای پیش‌نمایش Dry-Run باید مخزن نصب روی سرور آماده و تنظیمات معتبر باشد. از مرحلهٔ ۲ شروع کنید."
              onBack={() => setStage(2)}
            />
          ))}

        {/* ── مرحلهٔ ۴: اجرا ── */}
        {stage === 4 &&
          (jobId ? (
            <StageExecute key={jobId} jobId={jobId} onDone={onJobDone} hostLabel={hostLabel} />
          ) : (
            <StageGuard
              title="اجرایی در جریان نیست"
              body={`برای اجرای نصب، ابتدا در مرحلهٔ ۳ برنامهٔ Dry-Run را ببینید و با رضایت صریح «شروع اجرای نصب» را بزنید.${executing ? ' — در حال شروع…' : ''}`}
              onBack={() => setStage(3)}
            />
          ))}

        {/* ── مرحلهٔ ۵: نتیجه ── */}
        {stage === 5 &&
          (outcome ? (
            <StageResult
              outcome={outcome}
              settings={settings}
              hostLabel={hostLabel}
              onRestart={restart}
            />
          ) : (
            <StageGuard
              title="نتیجه‌ای برای نمایش نیست"
              body="برای دیدن نتیجهٔ نصب، ابتدا اجرا را در مرحلهٔ ۴ کامل کنید."
              onBack={() => setStage(1)}
            />
          ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// اجزای کمکی
// ---------------------------------------------------------------------------

function PrepareBanner({
  prepare,
  onRetry,
}: {
  prepare: PrepareState
  onRetry: () => void
}) {
  if (prepare.status === 'done') {
    return (
      <Alert className="border-emerald-500/30 bg-emerald-500/[0.05]">
        <CloudUpload className="size-4 text-emerald-600 dark:text-emerald-400" />
        <AlertTitle className="text-sm font-bold">مخزن نصب روی سرور آماده است</AlertTitle>
        <AlertDescription className="text-[13px] leading-6">
          بستهٔ نصب‌کننده ({Math.round((prepare.sizeBytes ?? 0) / 1024).toLocaleString('fa-IR')}{' '}
          کیلوبایت) در{' '}
          <span dir="ltr" className="font-mono text-[12px]">
            {prepare.remoteDir}
          </span>{' '}
          استخراج شد. فرم زیر از پاسخ واقعی همین مخزن ساخته شده است.
        </AlertDescription>
      </Alert>
    )
  }
  if (prepare.status === 'loading') {
    return (
      <Alert className="border-emerald-500/30 bg-emerald-500/[0.04]">
        <CloudUpload className="size-4 animate-pulse text-emerald-600 dark:text-emerald-400" />
        <AlertTitle className="text-sm font-bold">
          در حال بسته‌بندی و بارگذاری مخزن نصب روی سرور…
        </AlertTitle>
        <AlertDescription className="text-[13px] leading-6">
          حدود ۲۲۰ کیلوبایت از طریق SSH آپلود و روی سرور استخراج می‌شود — چند
          ثانیه طول می‌کشد. فرم پس از آماده‌شدن ظاهر می‌شود.
        </AlertDescription>
      </Alert>
    )
  }
  if (prepare.status === 'error') {
    return (
      <Alert variant="destructive">
        <TriangleAlert className="size-4" />
        <AlertTitle className="font-bold">بارگذاری مخزن نصب ناموفق بود</AlertTitle>
        <AlertDescription className="leading-6">
          {prepare.error}
          <div className="mt-3">
            <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={onRetry}>
              تلاش مجدد بارگذاری
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

function StageGuard({
  title,
  body,
  onBack,
}: {
  title: string
  body: string
  onBack: () => void
}) {
  return (
    <Card className={cn('border-dashed border-amber-500/40 bg-amber-500/[0.03]')}>
      <CardContent className="flex flex-col items-start gap-4 p-6">
        <span className="inline-flex size-11 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <TriangleAlert className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-base font-black text-foreground">{title}</h2>
          <p className="mt-1 text-[13px] leading-7 text-muted-foreground">{body}</p>
        </div>
        <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={onBack}>
          بازگشت
        </Button>
      </CardContent>
    </Card>
  )
}
