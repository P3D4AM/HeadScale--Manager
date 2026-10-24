'use client'

/**
 * سکشن پیکربندی (#/config) — ویرایش واقعی config.yaml سرور.
 *
 * جریان امن (مطابق قرارداد §4):
 *  ۱) خواندن پیکربندی فعلی از سرور (hs/config)
 *  ۲) اعتبارسنجی محتوای ویرایش‌شده روی خود سرور (hs/config/validate → configtest
 *     واقعی با فایل موقت) — نمایش خطای واقعی خط‌به‌خط
 *  ۳) اعمال (hs/config/set با confirm) — agent پشتیبان می‌گیرد، می‌نویسد،
 *     اعتبارسنجی می‌کند، سرویس را ری‌استارت می‌کند و سلامت را دوباره بررسی
 *     می‌کند؛ در صورت شکست پیکربندی قبلی را بازگردانی می‌کند. نتیجهٔ صادقانهٔ
 *     همین زنجیره نمایش داده می‌شود (نه «موفق» فرضی).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  BookOpenCheck,
  CircleCheck,
  CircleX,
  FileCode2,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import { useIsConnected, useSessionDataQuery, useSessionId } from '../use-agent'
import { AgentError } from '@/lib/agent'
import { agentPost } from '@/lib/agent'
import { agentPostRaw } from '@/lib/ops/api'
import type { ConfigInfo, ConfigSetResult, ConfigValidateResult } from '@/lib/ops/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MonoBlock } from '../ops/mono-block'
import { ConfirmDialog } from '../ops/confirm-dialog'
import { DisconnectedGuide } from '../ops/disconnected-guide'

export function ConfigSection() {
  const connected = useIsConnected()
  if (!connected) {
    return (
      <DisconnectedGuide
        title="پیکربندی Headscale"
        needText="برای دیدن و ویرایش پیکربندی، ابتدا باید از مرکز اتصال به سرور خود متصل شوید؛ فایل config.yaml مستقیماً از سرور خوانده می‌شود."
      />
    )
  }
  return <ConfigBody />
}

function ConfigBody() {
  const sid = useSessionId()
  const queryClient = useQueryClient()

  const configQuery = useSessionDataQuery<ConfigInfo>(['config'], 'hs/config', {
    staleTime: 0,
    retry: 1,
  })
  const original = configQuery.data?.content ?? null

  // ── وضعیت ویرایش ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState('')
  const [validateResult, setValidateResult] = useState<ConfigValidateResult | null>(null)
  const [validatedBuffer, setValidatedBuffer] = useState<string | null>(null)
  const [validating, setValidating] = useState(false)
  const [applyOpen, setApplyOpen] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyResult, setApplyResult] = useState<ConfigSetResult | null>(null)
  /** محتوایی که آخرین اعمال موفق روی سرور نوشته شده — برای نگه‌داشتن کارت نتیجه پس از refetch */
  const appliedContentRef = useRef<string | null>(null)

  const current = editing ? buffer : (original ?? '')
  const dirty = editing && original !== null && buffer !== original

  // با تغییر محتوای سرور (بارگذاری مجدد/اعمال)، اعتبارسنجی قدیمی بی‌اعتبار می‌شود.
  // کارت نتیجهٔ اعمال فقط وقتی پاک می‌شود که محتوای سرور با چیزی که خودمان اعمال
  // کرده بودیم فرق داشته باشد (تغییر از بیرون) — وگرنه پس از refetch هم دیده می‌ماند.
  useEffect(() => {
    setValidateResult(null)
    setValidatedBuffer(null)
    if (
      appliedContentRef.current !== null &&
      original !== null &&
      original !== appliedContentRef.current
    ) {
      appliedContentRef.current = null
      setApplyResult(null)
    }
  }, [original])

  const startEdit = () => {
    if (original === null) return
    setBuffer(original)
    setValidateResult(null)
    setValidatedBuffer(null)
    setApplyResult(null)
    setEditing(true)
  }

  const discardEdit = () => {
    setEditing(false)
    setValidateResult(null)
    setValidatedBuffer(null)
    setApplyResult(null)
  }

  const doValidate = async () => {
    if (!sid || editing === false) return
    setValidating(true)
    try {
      const res = await agentPost<{ ok: true; data: ConfigValidateResult }>(
        `/api/s/${sid}/hs/config/validate`,
        { content: buffer }
      )
      setValidateResult(res.data)
      setValidatedBuffer(buffer)
      if (res.data.valid) {
        toast.success('پیکربندی ویرایش‌شده معتبر است.', {
          description: 'بررسی با configtest واقعی روی سرور انجام شد.',
        })
      } else {
        toast.error('پیکربندی نامعتبر است.', {
          description: 'جزئیات خطا از خود headscale نمایش داده شد.',
        })
      }
    } catch (e) {
      toast.error('اعتبارسنجی انجام نشد.', {
        description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
      })
    } finally {
      setValidating(false)
    }
  }

  const doApply = async () => {
    if (!sid) return
    setApplying(true)
    try {
      const body = await agentPostRaw<{ ok: boolean; data: ConfigSetResult }>(
        `/api/s/${sid}/hs/config/set`,
        { content: buffer, confirm: true }
      )
      setApplyResult(body.data)
      if (body.data.ok) {
        toast.success('پیکربندی جدید با موفقیت اعمال شد.')
        appliedContentRef.current = buffer
        setEditing(false)
        setValidateResult(null)
        setValidatedBuffer(null)
        void queryClient.invalidateQueries({ queryKey: ['agent'] })
      } else {
        toast.error('اعمال پیکربندی ناتمام ماند.', {
          description: body.data.restored
            ? 'پیکربندی قبلی به‌صورت خودکار بازگردانی شد.'
            : 'گزارش دقیق در کارت نتیجه نمایش داده شد.',
        })
        // وضعیت واقعی سرور را دوباره بخوان (در شکست، agent پیکربندی قبلی را بازگردانده)
        void queryClient.invalidateQueries({ queryKey: ['agent'] })
      }
    } catch (e) {
      toast.error('اعمال پیکربندی انجام نشد.', {
        description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
      })
    } finally {
      setApplying(false)
      setApplyOpen(false)
    }
  }

  // «اعمال» فقط وقتی باز است که محتوای جاری همان محتوایی باشد که configtest آن
  // را تأیید کرده (تغییر بعد از اعتبارسنجی → دوباره اعتبارسنجی لازم است)
  const validatedOk =
    validateResult?.valid === true && validatedBuffer !== null && validatedBuffer === buffer

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      {/* سربرگ */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6"
      >
        <h1 className="flex items-center gap-2 text-xl font-black text-foreground sm:text-2xl">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <FileCode2 className="size-5" />
          </span>
          پیکربندی Headscale
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          فایل <code className="font-mono" dir="ltr">config.yaml</code> سرور شما —
          همهٔ اعتبارسنجی‌ها با configtest واقعی روی خود سرور انجام می‌شود.
        </p>
      </motion.div>

      {/* هشدار غیرمتخصص‌ها */}
      <Card className="mb-6 border-amber-500/30 bg-amber-500/[0.04]">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:p-5">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-[13px] leading-7 text-foreground/90">
            <p className="font-bold text-foreground">پیش از هر تغییری این را بخوانید</p>
            <p className="mt-1">
              تغییر اشتباه پیکربندی می‌تواند سرویس را از دسترس خارج کند. پیش از
              اعمال، همیشه از دکمهٔ{' '}
              <span className="font-bold">«اعتبارسنجی»</span> استفاده کنید؛ اعمال
              تغییرات با پشتیبان‌گیری خودکار و بازگردانی در صورت شکست انجام
              می‌شود، اما بهترین خط دفاع، اعتبارسنجی پیش از اعمال است.
            </p>
            <Button
              variant="link"
              className="mt-1 h-9 gap-1.5 px-0 font-bold text-emerald-700 dark:text-emerald-400"
              onClick={() => navigate('#/learn/8')}
            >
              <BookOpenCheck className="size-4" />
              آموزش کامل در فصل هشتم (مدیریت روزمره)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* بدنهٔ اصلی */}
      {configQuery.isLoading ? (
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-[420px] w-full" />
          </CardContent>
        </Card>
      ) : configQuery.error || original === null ? (
        <Card className="border-red-500/30 bg-red-500/[0.04]">
          <CardContent className="space-y-3 p-5">
            <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
              <CircleX className="size-4" />
              خواندن پیکربندی از سرور ناموفق بود
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              {configQuery.error instanceof AgentError
                ? configQuery.error.message
                : configQuery.error instanceof Error
                  ? configQuery.error.message
                  : 'خطای نامشخص.'}
            </p>
            <Button
              variant="outline"
              className="h-11 gap-2 rounded-xl"
              onClick={() => void configQuery.refetch()}
            >
              <RefreshCw className="size-4" />
              تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/70">
          <CardContent className="space-y-4 p-4 sm:p-6">
            {/* مسیر فایل + حالت */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="font-mono" dir="ltr">
                  {configQuery.data?.path}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    editing
                      ? 'border-amber-500/40 text-amber-700 dark:text-amber-300'
                      : 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  }
                >
                  {editing ? 'حالت ویرایش' : 'نمایش (فقط‌خواندنی)'}
                </Badge>
                {editing && dirty && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                    تغییرات ذخیره‌نشده
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editing ? (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 gap-2 rounded-xl font-bold"
                      onClick={discardEdit}
                      disabled={applying}
                    >
                      <RotateCcw className="size-4" />
                      صرف‌نظر از تغییرات
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 gap-2 rounded-xl font-bold"
                      onClick={() => void doValidate()}
                      disabled={validating || applying}
                    >
                      {validating ? (
                        <RefreshCw className="size-4 animate-spin" />
                      ) : (
                        <Play className="size-4" />
                      )}
                      اعتبارسنجی
                    </Button>
                    <Button
                      className="h-11 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                      disabled={!dirty || !validatedOk || applying}
                      title={
                        !dirty
                          ? 'هیچ تغییری برای اعمال نیست'
                          : !validatedOk
                            ? 'ابتدا محتوای فعلی را اعتبارسنجی کنید'
                            : undefined
                      }
                      onClick={() => setApplyOpen(true)}
                    >
                      <Save className="size-4" />
                      اعمال تغییرات
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      className="h-11 gap-2 rounded-xl font-bold"
                      onClick={() => void configQuery.refetch()}
                      disabled={configQuery.isFetching}
                    >
                      <RefreshCw
                        className={cn('size-4', configQuery.isFetching && 'animate-spin')}
                      />
                      بارگذاری مجدد
                    </Button>
                    <Button
                      className="h-11 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                      onClick={startEdit}
                    >
                      <Pencil className="size-4" />
                      ویرایش
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* ویرایشگر با شمارهٔ خط */}
            <ConfigEditor
              value={current}
              readOnly={!editing}
              onChange={(v) => setBuffer(v)}
            />

            {/* نتیجهٔ اعتبارسنجی — واقعی */}
            {validateResult && (
              <div
                className={cn(
                  'space-y-2 rounded-xl border p-4',
                  validateResult.valid
                    ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                    : 'border-red-500/40 bg-red-500/[0.06]'
                )}
              >
                <p
                  className={cn(
                    'flex items-center gap-2 text-sm font-bold',
                    validateResult.valid
                      ? 'text-emerald-700 dark:text-emerald-300'
                      : 'text-red-700 dark:text-red-300'
                  )}
                >
                  {validateResult.valid ? (
                    <CircleCheck className="size-4" />
                  ) : (
                    <CircleX className="size-4" />
                  )}
                  {validateResult.valid
                    ? 'پیکربندی معتبر است'
                    : 'پیکربندی نامعتبر است — خطای واقعی configtest:'}
                </p>
                {validateResult.valid ? (
                  <p className="text-[12px] leading-6 text-muted-foreground">
                    بررسی با دستور{' '}
                    <code className="font-mono" dir="ltr">
                      headscale configtest
                    </code>{' '}
                    روی خود سرور (فایل موقت) انجام شد؛ می‌توانید تغییرات را اعمال
                    کنید.
                  </p>
                ) : (
                  <MonoBlock maxHeightClass="max-h-60" aria-label="خطای اعتبارسنجی">
                    {(validateResult.error ?? 'خطای نامشخص')
                      .split('\n')
                      .filter((l) => l.trim().length > 0)
                      .map((l, i) => (
                        <div key={i} className="whitespace-pre-wrap break-all text-red-400">
                          {l}
                        </div>
                      ))}
                  </MonoBlock>
                )}
              </div>
            )}

            {/* راهنمای بلوکه‌شدن اعمال */}
            {editing && dirty && !validatedOk && (
              <p className="text-[12px] leading-6 text-amber-700 dark:text-amber-300">
                دکمهٔ «اعمال تغییرات» تا وقتی محتوای فعلی ویرایشگر با موفقیت
                اعتبارسنجی نشود، غیرفعال می‌ماند — این محافظ عمدی است.
              </p>
            )}

            {/* نتیجهٔ اعمال — صادقانه */}
            {applyResult && <ApplyResultCard result={applyResult} />}
          </CardContent>
        </Card>
      )}

      {/* دیالوگ تأیید اعمال */}
      <ConfirmDialog
        open={applyOpen}
        onOpenChange={(o) => !applying && setApplyOpen(o)}
        title="اعمال پیکربندی جدید روی سرور"
        confirmLabel="بله، اعمال کن"
        busy={applying}
        onConfirm={() => void doApply()}
        description={
          <div className="space-y-2">
            <p>
              پیش از اعمال، از نسخهٔ فعلی پیکربندی روی سرور پشتیبان گرفته می‌شود؛
              سپس پیکربندی جدید نوشته و سرویس راه‌اندازی مجدد می‌شود و سلامت آن
              دوباره بررسی می‌شود.
            </p>
            <p className="font-bold text-foreground">
              اگر سرویس با پیکربندی جدید سالم بالا نیاید، پیکربندی قبلی{' '}
              به‌صورت خودکار بازگردانی می‌شود.
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              در این لحظه چند ثانیه وقفهٔ کوتاه در اتصال دستگاه‌ها طبیعی است.
            </p>
          </div>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ویرایشگر پیکربندی — LTR mono با شمارهٔ خط همگام
// ---------------------------------------------------------------------------

function ConfigEditor({
  value,
  readOnly,
  onChange,
}: {
  value: string
  readOnly: boolean
  onChange: (v: string) => void
}) {
  const gutterRef = useRef<HTMLDivElement>(null)
  const lineCount = useMemo(() => value.split('\n').length, [value])

  return (
    <div
      dir="ltr"
      className="flex max-h-[30rem] overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950 focus-within:ring-2 focus-within:ring-emerald-500/50"
    >
      <div
        ref={gutterRef}
        aria-hidden
        className="custom-scrollbar w-12 shrink-0 select-none overflow-hidden border-e border-slate-800 bg-slate-900/60 py-3 text-right font-mono text-[12px] leading-6 text-slate-500"
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="pe-2">
            {i + 1}
          </div>
        ))}
      </div>
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop
        }}
        spellCheck={false}
        aria-label="محتوای پیکربندی (ویرایشگر چپ‌به‌راست)"
        className={cn(
          'custom-scrollbar h-[30rem] flex-1 resize-none border-0 bg-transparent p-3 font-mono text-[12px] leading-6 text-slate-200 focus:outline-none',
          readOnly && 'cursor-default text-slate-300'
        )}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// کارت نتیجهٔ اعمال — زنجیرهٔ واقعی agent را صادقانه روایت می‌کند
// ---------------------------------------------------------------------------

function ApplyResultCard({ result }: { result: ConfigSetResult }) {
  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-4',
        result.ok
          ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
          : 'border-red-500/40 bg-red-500/[0.06]'
      )}
    >
      <p
        className={cn(
          'flex flex-wrap items-center gap-2 text-sm font-bold',
          result.ok
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-red-700 dark:text-red-300'
        )}
      >
        {result.ok ? <CircleCheck className="size-4" /> : <CircleX className="size-4" />}
        {result.ok
          ? 'پیکربندی جدید اعمال شد'
          : result.validated
            ? 'اعمال پیکربندی ناتمام ماند'
            : 'پیکربندی از ابتدا نامعتبر بود و چیزی نوشته نشد'}
        {result.restored && (
          <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" variant="outline">
            بازگردانی خودکار انجام شد
          </Badge>
        )}
      </p>

      {result.backupPath && (
        <p className="text-[12px] leading-6 text-muted-foreground">
          پشتیبان نسخهٔ قبلی:{' '}
          <code className="font-mono text-foreground" dir="ltr">
            {result.backupPath}
          </code>
        </p>
      )}

      {!result.ok && result.error && (
        <MonoBlock maxHeightClass="max-h-40" aria-label="خطای اعمال پیکربندی">
          <div className="whitespace-pre-wrap break-all text-red-400">{result.error}</div>
        </MonoBlock>
      )}

      {!result.ok && result.restored && (
        <p className="text-[12px] leading-6 text-amber-700 dark:text-amber-300">
          agent پس از شکست، پیکربندی قبلی را از پشتیبان بازگرداند و دوباره سلامت
          را بررسی کرد — وضعیت فعلی سرور همان پیکربندی قبلی است.
        </p>
      )}

      {result.health && (
        <div className="space-y-1.5">
          <p className="text-[12px] font-bold text-foreground">
            بررسی سلامت پس از اعمال:{' '}
            <span
              className={
                result.health.healthy
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-red-700 dark:text-red-300'
              }
            >
              {result.health.healthy ? 'سالم' : 'ناسالم'}
            </span>
          </p>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {(
              [
                ['سرویس', result.health.layers.service],
                ['HTTP سلامت', result.health.layers.http],
                ['CLI', result.health.layers.cli],
              ] as const
            ).map(([label, layer]) => (
              <p
                key={label}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px]',
                  layer.ok
                    ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'border-red-500/30 text-red-700 dark:text-red-300'
                )}
              >
                {layer.ok ? (
                  <CircleCheck className="size-3.5 shrink-0" />
                ) : (
                  <CircleX className="size-3.5 shrink-0" />
                )}
                {label} ({layer.via})
              </p>
            ))}
          </div>
        </div>
      )}

      {!result.restarted && (
        <p className="text-[11px] leading-6 text-muted-foreground">
          {result.ok
            ? 'در حالت اجرای دلخواه (custom)، سرویس systemd مدیریت نمی‌شود؛ ری‌استارت انجام نشد و سلامت از سه مسیر بررسی شد.'
            : 'ری‌استارت سرویس انجام نشد (یا حالت custom است یا عملیات قبل از ری‌استارت متوقف شد).'}
        </p>
      )}
    </div>
  )
}
