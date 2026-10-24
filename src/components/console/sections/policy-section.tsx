'use client'

/**
 * #/policy — سیاست دسترسی (ACL) شبکه.
 * سیاست فعلی از سرور خوانده می‌شود (null یعنی تنظیم‌نشده — حالت خالی صادقانه)،
 * قبل از اعمال با «policy check» واقعی اعتبارسنجی می‌شود و اعمال نهایی با
 * تأیید صریح انجام می‌گردد.
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BookOpenCheck,
  CircleCheck,
  CircleX,
  FileCode2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Info,
} from 'lucide-react'
import { AgentError } from '@/lib/agent'
import { navigate } from '@/lib/nav'
import { AGENT_QUERY_PREFIX, useSessionDataQuery, useSessionId } from '../use-agent'
import {
  agentErrDetail,
  agentErrText,
  hsPolicySet,
  hsPolicyValidate,
  type PolicyInfo,
  type PolicyValidateResult,
} from '@/lib/manage/api'
import { SectionShell } from '../manage/section-shell'
import { ErrorState } from '../manage/data-state'
import { ConfirmActionDialog } from '../manage/typed-confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * قالب حداقلی HuJSON — روی باینری واقعی headscale 0.29.5 با
 * «policy check» راستی‌آزمایی شده (معتبر). نام کاربر را قبل از اعمال
 * با نام واقعی خود عوض کنید.
 */
const POLICY_TEMPLATE = `// سیاست دسترسی شبکهٔ خصوصی شما — قالب HuJSON (کامنت مجاز است)
// راهنما: فصل ۸ آموزش + مستندات رسمی headscale
{
  "groups": {
    // کاربران این گروه به کل شبکه دسترسی دارند
    // ⚠ نام را با نام واقعی کاربر Headscale خود عوض کنید
    "group:admin": ["ali@example.com"]
  },
  "acls": [
    // مدیر: دسترسی به همهٔ دستگاه‌ها و همهٔ پورت‌ها
    { "action": "accept", "src": ["group:admin"], "dst": ["*:*"] }
  ]
}
`

export function PolicySection() {
  return (
    <SectionShell
      icon={ShieldCheck}
      title="سیاست دسترسی (ACL)"
      description="قواعد اینکه کدام کاربر/دستگاه به کدام دستگاه و پورت دسترسی دارد. پیش‌فرض (بدون سیاست) همه‌چیز برای همه باز است؛ با تنظیم سیاست، فقط قواعد نوشته‌شده مجاز می‌شوند."
    >
      <PolicyManager />
    </SectionShell>
  )
}

function PolicyManager() {
  const sid = useSessionId()
  const qc = useQueryClient()
  const policy = useSessionDataQuery<PolicyInfo>(['hs', 'policy'], 'hs/policy', { staleTime: 30_000 })

  const serverPolicy = policy.data?.policy ?? null
  const hasPolicy = typeof serverPolicy === 'string' && serverPolicy.trim().length > 0

  // متن ویرایشگر — الگوی پیش‌نویس مشتق‌شده: null یعنی «همان متن سرور».
  // (بدون effect؛ با تغییر دادهٔ سرور هم متن پایه به‌روز می‌ماند)
  const [draft, setDraft] = useState<string | null>(null)
  const content = draft ?? (hasPolicy ? (serverPolicy as string) : '')
  const setContent = setDraft

  const [validateResult, setValidateResult] = useState<PolicyValidateResult | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  /** خطای واقعی آخرین اعمال — پیام agent + خروجی خام سرور برای نمایش صادقانه */
  const [applyError, setApplyError] = useState<{ message: string; detail: string | null } | null>(null)

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])

  const dirty = hasPolicy ? content !== serverPolicy : content.trim().length > 0

  // ── اعتبارسنجی واقعی روی سرور ──
  const validateMut = useMutation({
    mutationFn: async () => {
      if (!sid) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد؛ ابتدا متصل شوید.')
      return hsPolicyValidate(sid, content)
    },
    onSuccess: (res) => {
      setValidateResult(res.data)
      if (res.data.valid) toast.success('سیاست روی سرور معتبر شناخته شد — آمادهٔ اعمال است.')
      else toast.error('سیاست معتبر نیست — پیام خطای سرور را ببینید.')
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── اعمال با تأیید ──
  const applyMut = useMutation({
    mutationFn: async () => {
      if (!sid) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsPolicySet(sid, content)
    },
    onSuccess: (res) => {
      setApplyError(null)
      toast.success('سیاست جدید روی سرور اعمال شد و بلافاصله معتبر است.')
      setApplyOpen(false)
      setValidateResult(null)
      // متن تأییدشدهٔ سرور (re-get واقعی) را در ویرایشگر می‌گذاریم
      const applied = res.data.policy
      setDraft(typeof applied === 'string' ? applied : content)
      invalidate()
    },
    onError: (err) => {
      // خطای واقعی سرور را صادقانه نگه می‌داریم تا در پنل زیر دکمه‌ها دیده شود
      setApplyError({ message: agentErrText(err), detail: agentErrDetail(err) })
      setApplyOpen(false)
      toast.error(agentErrText(err))
    },
  })

  const lineCount = useMemo(() => content.split('\n').length, [content])

  return (
    <div className="space-y-5">
      {/* توضیح ACL برای غیرمتخصص‌ها */}
      <Card className="border-border/70 bg-muted/30">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
          <Info className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1.5 text-[13px] leading-7 text-foreground/90">
            <p className="font-bold text-foreground">سیاست دسترسی (ACL) به زبان ساده</p>
            <p>
              ACL مثل «تابلوی مجوزهای ساختمان» است: مشخص می‌کند چه کسی به کدام
              درِ کدام اتاق (دستگاه و پورت) دسترسی دارد. تا وقتی سیاستی تنظیم
              نکنید، <strong>همهٔ اعضای شبکه به هم دسترسی کامل دارند</strong>؛
              همین که اولین سیاست را اعمال کنید، فقط مجوزهای نوشته‌شده معتبر
              می‌شوند — پس با دقت شروع کنید و همیشه اول «اعتبارسنجی» بزنید.
            </p>
            <p className="text-muted-foreground">
              آموزش کامل نوشتن قواعد: فصل ۶ (شبکهٔ دفتر) و فصل ۸ (مدیریت
              روزمره).
            </p>
          </div>
        </CardContent>
      </Card>

      {policy.isLoading ? (
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            <div className="h-5 w-1/3 animate-pulse rounded bg-muted/60" />
            <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
          </CardContent>
        </Card>
      ) : policy.error ? (
        <ErrorState
          title="خواندن سیاست فعلی از سرور ناموفق بود"
          error={policy.error}
          onRetry={() => void policy.refetch()}
        />
      ) : !hasPolicy && content.trim().length === 0 ? (
        /* حالت خالی صادقانه — هنوز سیاستی تنظیم نشده */
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center sm:p-10">
            <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <FileCode2 className="size-7" />
            </span>
            <h2 className="text-base font-black text-foreground sm:text-lg">
              هنوز هیچ سیاستی روی این سرور تنظیم نشده است
            </h2>
            <p className="max-w-2xl text-[13px] leading-7 text-muted-foreground">
              این یعنی الان <strong>همهٔ دستگاه‌های شبکهٔ شما به هم دسترسی کامل
              دارند</strong>. برای شروع، می‌توانید قالب حداقلی زیر را در ویرایشگر
              بگذارید، نام کاربر را با نام واقعی‌تان عوض کنید، اعتبارسنجی کنید و
              بعد اعمال کنید. تا وقتی اعمال نکنید، چیزی روی سرور تغییر نمی‌کند.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => {
                  setContent(POLICY_TEMPLATE)
                  setValidateResult(null)
                  toast.success('قالب نمونه در ویرایشگر قرار گرفت — نام کاربر را عوض کنید.')
                }}
                className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              >
                <Sparkles className="size-5" />
                درج قالب نمونهٔ معتبر
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('#/learn/8')}
                className="h-12 gap-2 rounded-xl px-6 font-bold"
              >
                <BookOpenCheck className="size-5" />
                فصل ۸ — مدیریت روزمره
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/70">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex items-center gap-2 text-base font-black text-foreground">
                  <FileCode2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                  {hasPolicy ? 'سیاست فعلی سرور' : 'ویرایشگر سیاست'}
                </h2>
                <Badge variant="secondary" className="font-mono text-[10px]" dir="ltr">
                  {policy.data?.format ?? 'hujson'}
                </Badge>
                {hasPolicy ? null : (
                  <Badge variant="outline" className="border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    سرور: تنظیم‌نشده
                  </Badge>
                )}
                {dirty ? (
                  <Badge variant="outline" className="border-amber-500/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                    ویرایش‌شده — هنوز اعمال نشده
                  </Badge>
                ) : hasPolicy ? (
                  <Badge variant="outline" className="border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    یکسان با سرور
                  </Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!hasPolicy && content.trim().length === 0 ? (
                  <Button
                    variant="outline"
                    className="h-11 gap-2 rounded-xl font-bold"
                    onClick={() => {
                      setContent(POLICY_TEMPLATE)
                      setValidateResult(null)
                    }}
                  >
                    <Sparkles className="size-4" />
                    درج قالب نمونه
                  </Button>
                ) : null}
                {hasPolicy || content.trim().length > 0 ? (
                  <Button
                    variant="outline"
                    className="h-11 gap-2 rounded-xl font-bold"
                    disabled={policy.isFetching}
                    onClick={() => {
                      setContent(hasPolicy ? (serverPolicy as string) : '')
                      setValidateResult(null)
                      toast.success('متن ویرایشگر به نسخهٔ سرور برگشت.')
                    }}
                  >
                    <RotateCcw className="size-4" />
                    بازگرداندن متن سرور
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="h-11 gap-2 rounded-xl font-bold"
                  onClick={() => {
                    void policy.refetch()
                    toast.success('بازخوانی سیاست از سرور…')
                  }}
                >
                  <RefreshCw className={policy.isFetching ? 'size-4 animate-spin' : 'size-4'} />
                  بازآوری
                </Button>
              </div>
            </div>

            {/* ویرایشگر LTR mono */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="policy-editor" className="text-[13px] font-bold">
                  محتوای سیاست (HuJSON — کامنت‌ها مجازند)
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  {lineCount.toLocaleString('fa-IR')} خط
                </span>
              </div>
              <Textarea
                id="policy-editor"
                dir="ltr"
                spellCheck={false}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setValidateResult(null)
                }}
                className="min-h-72 resize-y rounded-xl bg-muted/40 p-4 font-mono text-[13px] leading-6 text-start"
                placeholder='// سیاست را اینجا بنویسید یا قالب نمونه را درج کنید…'
              />
              <p className="text-[11px] leading-6 text-muted-foreground">
                نکتهٔ امنیتی: قبل از «اعمال»، دکمهٔ «اعتبارسنجی» را بزنید — همان
                بررسی روی خود سرور انجام می‌شود و اگر خطا باشد، متن اعمال
                نمی‌شود.
              </p>
            </div>

            {/* نتیجهٔ اعتبارسنجی واقعی */}
            {validateResult ? (
              validateResult.valid ? (
                <div className="flex items-start gap-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.06] p-4 text-[13px] leading-7 text-emerald-800 dark:text-emerald-200">
                  <CircleCheck className="mt-1 size-4 shrink-0" />
                  <div>
                    <p className="font-bold">سرور این سیاست را معتبر شناخت.</p>
                    <p className="text-emerald-700/90 dark:text-emerald-300/90">
                      حالا می‌توانید با خیال راحت «اعمال سیاست» را بزنید.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/[0.05] p-4">
                  <p className="flex items-center gap-2 text-[13px] font-bold text-red-600 dark:text-red-400">
                    <CircleX className="size-4" />
                    سرور این سیاست را نامعتبر اعلام کرد:
                  </p>
                  <pre
                    dir="ltr"
                    className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-mono text-[12px] leading-5 text-foreground"
                  >
                    {validateResult.error || 'خطای نامشخص'}
                  </pre>
                </div>
              )
            ) : null}

            {/* اکشن‌ها */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-11 gap-2 rounded-xl font-bold"
                disabled={content.trim().length === 0 || validateMut.isPending}
                onClick={() => validateMut.mutate()}
              >
                {validateMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                اعتبارسنجی روی سرور
              </Button>
              <Button
                className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                disabled={content.trim().length === 0 || applyMut.isPending}
                onClick={() => {
                  setApplyError(null)
                  setApplyOpen(true)
                }}
              >
                {applyMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                اعمال سیاست
              </Button>
            </div>

            {/* خطای واقعی آخرین اعمال — خروجی خام سرور، بدون سانسور */}
            {applyError ? (
              <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/[0.05] p-4">
                <p className="flex items-center gap-2 text-[13px] font-bold text-red-600 dark:text-red-400">
                  <CircleX className="size-4" />
                  اعمال سیاست روی سرور ناموفق بود:
                </p>
                <p className="text-[13px] leading-7 text-muted-foreground">{applyError.message}</p>
                {applyError.detail ? (
                  <pre
                    dir="ltr"
                    className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-3 font-mono text-[12px] leading-5 text-foreground"
                  >
                    {applyError.detail}
                  </pre>
                ) : null}
                {applyError.detail?.includes("modes other than 'database'") ||
                applyError.message.includes("modes other than 'database'") ? (
                  <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[12px] leading-6 text-amber-800 dark:text-amber-200">
                    علت واقعی (تأییدشده روی سرور): headscale شما در حالت «خواندن سیاست از فایل»
                    اجرا می‌شود (policy.mode: file) و اجازهٔ ذخیرهٔ سیاست از این صفحه را نمی‌دهد.
                    برای فعال‌شدن ویرایش، در بخش «پیکربندی» مقدار{' '}
                    <code dir="ltr" className="font-mono">policy.mode</code> را به{' '}
                    <code dir="ltr" className="font-mono">database</code> تغییر دهید و سرویس را
                    ری‌استارت کنید؛ پس از آن این صفحه سیاست را مستقیم روی سرور ذخیره می‌کند.
                    راهنمای کامل: فصل ۸ آموزش.
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* تأیید اعمال */}
      <ConfirmActionDialog
        open={applyOpen}
        onOpenChange={(o) => (applyMut.isPending ? undefined : o ? undefined : setApplyOpen(false))}
        title="اعمال سیاست ACL جدید"
        description={
          <div className="space-y-3">
            <p>
              این متن جایگزین سیاست فعلی سرور می‌شود و{' '}
              <strong>از همان لحظه روی کل شبکهٔ شما معتبر است</strong> — اگر
              قاعده‌ای را جا بیندازید، دسترسی‌ها همان‌جا قطع می‌شوند.
            </p>
            {validateResult?.valid ? (
              <p className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-300">
                <CircleCheck className="size-4" />
                این متن همین الان روی سرور اعتبارسنجی شده و معتبر است.
              </p>
            ) : (
              <p className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-300">
                <CircleX className="size-4" />
                این متن هنوز روی سرور اعتبارسنجی نشده — پیشنهاد می‌کنیم قبل از
                تأیید، «اعتبارسنجی روی سرور» را بزنید.
              </p>
            )}
            <p>
              {hasPolicy ? (
                <>
                  نسخهٔ فعلی سرور{' '}
                  {(serverPolicy ?? '').length.toLocaleString('fa-IR')} نویسه است؛
                  پیش از اعمال، آن را از دکمهٔ «بازگرداندن متن سرور» یا ویرایشگر
                  کپی و جای امنی ذخیره کنید تا در صورت پشیمانی قابل بازگردانی
                  باشد.
                </>
              ) : (
                <>
                  سرور شما فعلاً سیاستی ندارد (همه‌چیز باز است). با این اعمال،
                  اولین سیاست فعال می‌شود.
                </>
              )}
            </p>
          </div>
        }
        confirmLabel="بله، سیاست را اعمال کن"
        tone="warning"
        onConfirm={() => applyMut.mutate()}
        pending={applyMut.isPending}
      />
    </div>
  )
}
