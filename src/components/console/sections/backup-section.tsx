'use client'

/**
 * سکشن پشتیبان و ارتقا (#/backup) — دو تب:
 *  ۱) پشتیبان‌گیری و بازیابی: فهرست واقعی /var/backups/hem (hsctl backup list)؛
 *     راستی‌آزمایی per-file (hsctl backup verify)؛ بازیابی با تأیید تایپی نام
 *     فایل (hsctl restore — پیش از بازیابی، وضعیت فعلی با .pre-restore پشتیبان
 *     گرفته می‌شود)؛ ساخت پشتیبان جدید با خروجی زندهٔ job.
 *  ۲) به‌روزرسانی: مقایسهٔ نسخهٔ واقعی سرور با نسخهٔ پین‌شدهٔ پروژه
 *     (update/check) و ارتقای استریمی با گام‌ها و بازگشت خودکار (hsctl update).
 *
 * صداقت: پشتیبان/بازیابی/ارتقا به hsctl روی سرور نیاز دارند — اگر نصب
 * نباشد، agent خطای 503 NOT_AVAILABLE می‌دهد و این صفحه به‌جای دادهٔ جعلی،
 * کارت توضیح صادقانه نمایش می‌دهد.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpCircle,
  CircleCheck,
  CircleX,
  CloudUpload,
  DatabaseBackup,
  FileArchive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import { useIsConnected, useSessionDataQuery, useSessionQuery, useSessionId } from '../use-agent'
import { AgentError } from '@/lib/agent'
import { agentPost } from '@/lib/agent'
import { agentPostRaw } from '@/lib/ops/api'
import type {
  BackupListResponse,
  BackupVerifyResponse,
  JobStartResponse,
  UpdateCheckResult,
} from '@/lib/ops/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { JobLivePanel } from '../ops/job-live-panel'
import { DisconnectedGuide } from '../ops/disconnected-guide'

export function BackupSection() {
  const connected = useIsConnected()
  if (!connected) {
    return (
      <DisconnectedGuide
        title="پشتیبان، بازیابی و ارتقا"
        needText="پشتیبان‌گیری، بازیابی و ارتقا مستقیماً روی سرور شما و از طریق hsctl اجرا می‌شود؛ ابتدا از مرکز اتصال وصل شوید."
      />
    )
  }
  return <BackupBody />
}

function BackupBody() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6"
      >
        <h1 className="flex items-center gap-2 text-xl font-black text-foreground sm:text-2xl">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <CloudUpload className="size-5" />
          </span>
          پشتیبان و ارتقا
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          پشتیبان کامل (پیکربندی + دیتابیس + بلاک Caddy)، راستی‌آزمایی هش هر فایل،
          بازیابی ایمن و ارتقای Headscale با بازگشت خودکار.
        </p>
      </motion.div>

      <Tabs defaultValue="backup">
        <TabsList className="h-12 w-full max-w-md rounded-xl p-1">
          <TabsTrigger value="backup" className="h-full gap-2 rounded-lg text-[13px] font-bold">
            <DatabaseBackup className="size-4" />
            پشتیبان‌گیری و بازیابی
          </TabsTrigger>
          <TabsTrigger value="update" className="h-full gap-2 rounded-lg text-[13px] font-bold">
            <ArrowUpCircle className="size-4" />
            به‌روزرسانی
          </TabsTrigger>
        </TabsList>
        <TabsContent value="backup" className="mt-6">
          <BackupTab />
        </TabsContent>
        <TabsContent value="update" className="mt-6">
          <UpdateTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// کارت «پس از نصب» — 503 NOT_AVAILABLE صادقانهٔ agent
// ---------------------------------------------------------------------------

function NotAvailableCard({ message }: { message?: string }) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.04]">
      <CardContent className="space-y-3 p-5 sm:p-6">
        <p className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-300">
          <ShieldCheck className="size-5" />
          این قابلیت پس از نصب اولیه فعال می‌شود
        </p>
        <p className="text-[13px] leading-7 text-foreground/90">
          پشتیبان‌گیری، بازیابی و ارتقا با <span className="font-bold">hsctl</span>{' '}
          انجام می‌شوند — ابزار مدیریتی همین برنامه که{' '}
          <span className="font-bold">
            توسط ویزارد نصب روی سرور شما نصب می‌شود
          </span>
          . روی این سرور، hsctl هنوز نصب نیست؛ پس از تکمیل نصب، همین صفحه به‌صورت
          خودکار فعال می‌شود.
        </p>
        {message && (
          <p className="rounded-xl border bg-muted/40 p-3 text-[12px] leading-6 text-muted-foreground">
            پیام دقیق سرویس: {message}
          </p>
        )}
        <Button
          className="h-11 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          onClick={() => navigate('#/install')}
        >
          <Sparkles className="size-4" />
          رفتن به ویزارد نصب
        </Button>
      </CardContent>
    </Card>
  )
}

function isNotAvailable(e: unknown): boolean {
  return e instanceof AgentError && (e.code === 'NOT_AVAILABLE' || e.status === 503)
}

// ---------------------------------------------------------------------------
// تب پشتیبان
// ---------------------------------------------------------------------------

function BackupTab() {
  const sid = useSessionId()
  const queryClient = useQueryClient()

  const list = useSessionQuery<BackupListResponse>(['backup', 'list'], 'backup/list', {
    retry: false,
    staleTime: 0,
  })

  const [verifyResult, setVerifyResult] = useState<{
    file: string
    res: BackupVerifyResponse
  } | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [restoreJob, setRestoreJob] = useState<{ jobId: string; file: string } | null>(null)
  const [createJob, setCreateJob] = useState<string | null>(null)
  const [naMessage, setNaMessage] = useState<string | null>(null)

  const refreshList = () =>
    void queryClient.invalidateQueries({ queryKey: ['agent', 's', sid, 'backup'] })

  const doVerify = async (file: string) => {
    if (!sid) return
    setVerifying(true)
    try {
      const res = await agentPostRaw<BackupVerifyResponse>(
        `/api/s/${sid}/backup/verify`,
        { file }
      )
      setVerifyResult({ file, res })
      if (res.ok) {
        toast.success(`پشتیبان «${file}» سالم است.`)
      } else {
        toast.error(`پشتیبان «${file}» ایراد دارد.`, {
          description: `${res.issues.length.toLocaleString('fa-IR')} ایراد گزارش شد.`,
        })
      }
    } catch (e) {
      if (isNotAvailable(e)) {
        setNaMessage(e instanceof AgentError ? e.message : null)
      } else {
        toast.error('راستی‌آزمایی انجام نشد.', {
          description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
        })
      }
    } finally {
      setVerifying(false)
    }
  }

  const doCreate = async () => {
    if (!sid) return
    try {
      const res = await agentPost<JobStartResponse>(`/api/s/${sid}/backup/create`, {})
      setCreateJob(res.jobId)
      toast.success('پشتیبان‌گیری آغاز شد — خروجی زنده نمایش داده می‌شود.')
    } catch (e) {
      if (isNotAvailable(e)) {
        setNaMessage(e instanceof AgentError ? e.message : null)
      } else {
        toast.error('شروع پشتیبان‌گیری ممکن نشد.', {
          description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
        })
      }
    }
  }

  const doRestore = async (file: string) => {
    if (!sid) return
    try {
      const res = await agentPost<JobStartResponse>(`/api/s/${sid}/restore`, {
        file,
        confirm: true,
      })
      setRestoreJob({ jobId: res.jobId, file })
      toast.success(`بازیابی از «${file}» آغاز شد.`)
    } catch (e) {
      if (isNotAvailable(e)) {
        setNaMessage(e instanceof AgentError ? e.message : null)
      } else {
        toast.error('شروع بازیابی ممکن نشد.', {
          description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
        })
      }
    } finally {
      setRestoreTarget(null)
    }
  }

  // اگر هر عملیاتی 503 NOT_AVAILABLE گرفت، کل تب به کارت توضیح می‌رود
  const listNa = list.error ? isNotAvailable(list.error) : false
  if (listNa || naMessage) {
    return (
      <NotAvailableCard
        message={
          naMessage ??
          (list.error instanceof AgentError ? list.error.message : undefined)
        }
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* ساخت پشتیبان جدید */}
      <Card className="bg-card/70">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="flex items-center gap-2 text-base font-black text-foreground">
              <DatabaseBackup className="size-5 text-emerald-600 dark:text-emerald-400" />
              پشتیبان‌گیری کامل
            </h2>
            <p className="mt-1.5 max-w-2xl text-[12px] leading-6 text-muted-foreground">
              پشتیبان شامل پیکربندی، دیتابیس (کاربران/دستگاه‌ها/کلیدها)، کلیدهای
              سرور و بلاک Caddy است؛ با هش SHA-256 و فایل manifest — در{' '}
              <code className="font-mono" dir="ltr">/var/backups/hem</code> ذخیره
              می‌شود.
            </p>
          </div>
          <Button
            className="h-12 shrink-0 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            disabled={createJob !== null || verifying}
            onClick={() => void doCreate()}
          >
            <DatabaseBackup className="size-4" />
            ساخت پشتیبان جدید
          </Button>
        </CardContent>
      </Card>

      {/* job زندهٔ ساخت پشتیبان */}
      {createJob && (
        <JobLivePanel
          jobId={createJob}
          title="پشتیبان‌گیری زنده (hsctl backup create)"
          onFinished={() => {
            refreshList()
            setTimeout(() => setCreateJob(null), 4000)
          }}
        />
      )}

      {/* فهرست پشتیبان‌ها */}
      <Card className="bg-card/70">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-black text-foreground">
              <FileArchive className="size-5 text-emerald-600 dark:text-emerald-400" />
              پشتیبان‌های موجود
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => void list.refetch()}
              disabled={list.isFetching}
              aria-label="بازآوری فهرست پشتیبان‌ها"
            >
              <RefreshCw className={cn('size-3.5', list.isFetching && 'animate-spin')} />
              بازآوری
            </Button>
          </div>

          {list.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : list.error ? (
            <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
                <CircleX className="size-4" />
                خواندن فهرست پشتیبان‌ها ناموفق بود
              </p>
              <p className="text-[12px] leading-6 text-muted-foreground">
                {list.error instanceof AgentError ? list.error.message : 'خطای نامشخص.'}
              </p>
              <Button
                variant="outline"
                className="h-11 gap-2 rounded-xl"
                onClick={() => void list.refetch()}
              >
                <RefreshCw className="size-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : !list.data || list.data.backups.length === 0 ? (
            <p className="rounded-xl border bg-muted/30 p-4 text-[13px] leading-6 text-muted-foreground">
              هنوز هیچ پشتیبانی ثبت نشده است. با دکمهٔ «ساخت پشتیبان جدید»، اولین
              پشتیبان کامل را بگیرید (نیازمند نصب hsctl از ویزارد نصب).
            </p>
          ) : (
            <div className="custom-scrollbar max-h-96 overflow-y-auto rounded-xl border">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead className="text-start">فایل پشتیبان</TableHead>
                    <TableHead className="text-start">حجم</TableHead>
                    <TableHead className="text-start">تاریخ ساخت</TableHead>
                    <TableHead className="text-start">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.backups.map((b) => {
                    const date = backupDate(b.name)
                    return (
                      <TableRow key={b.name}>
                        <TableCell className="font-mono text-[12px]" dir="ltr">
                          {b.name}
                        </TableCell>
                        <TableCell className="font-mono text-[12px]" dir="ltr">
                          {b.sizeMb.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} MB
                        </TableCell>
                        <TableCell className="text-[12px]">
                          {date ? (
                            date.toLocaleString('fa-IR')
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 gap-1.5 rounded-lg text-[12px] font-bold"
                              disabled={verifying}
                              onClick={() => void doVerify(b.name)}
                            >
                              {verifying ? (
                                <RefreshCw className="size-3.5 animate-spin" />
                              ) : (
                                <ShieldCheck className="size-3.5" />
                              )}
                              راستی‌آزمایی
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 gap-1.5 rounded-lg border-amber-500/40 text-[12px] font-bold text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-300"
                              disabled={restoreJob !== null}
                              onClick={() => setRestoreTarget(b.name)}
                            >
                              <RotateCcw className="size-3.5" />
                              بازیابی
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {/* نتیجهٔ راستی‌آزمایی — per-file واقعی */}
          {verifyResult && (
            <div
              className={cn(
                'space-y-3 rounded-xl border p-4',
                verifyResult.res.ok
                  ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                  : 'border-red-500/40 bg-red-500/[0.06]'
              )}
            >
              <p
                className={cn(
                  'flex flex-wrap items-center gap-2 text-sm font-bold',
                  verifyResult.res.ok
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-red-700 dark:text-red-300'
                )}
              >
                {verifyResult.res.ok ? (
                  <CircleCheck className="size-4" />
                ) : (
                  <CircleX className="size-4" />
                )}
                راستی‌آزمایی «{verifyResult.file}»:
                {verifyResult.res.ok ? ' سالم است' : ' ایراد دارد'}
                <Badge variant="secondary" className="font-mono" dir="ltr">
                  exit {verifyResult.res.exitCode}
                </Badge>
              </p>
              {verifyResult.res.ok ? (
                <p className="text-[12px] leading-6 text-muted-foreground">
                  هش SHA-256 همهٔ فایل‌های داخل آرشیو با manifest مطابقت داشت و
                  ساختار آرشیو سالم است.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] font-bold text-foreground">
                    ایرادهای گزارش‌شده ({verifyResult.res.issues.length.toLocaleString('fa-IR')} مورد):
                  </p>
                  <ul className="space-y-1.5">
                    {verifyResult.res.issues.map((issue, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-[12px] leading-6 text-foreground/90"
                      >
                        <span className="mt-2 size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
                        {issue}
                      </li>
                    ))}
                  </ul>
                  {(verifyResult.res.output || verifyResult.res.stderr) && (
                    <MonoBlock maxHeightClass="max-h-40" aria-label="خروجی راستی‌آزمایی">
                      <div className="whitespace-pre-wrap break-all">
                        {verifyResult.res.output}
                      </div>
                      {verifyResult.res.stderr && (
                        <div className="whitespace-pre-wrap break-all text-red-400">
                          {verifyResult.res.stderr}
                        </div>
                      )}
                    </MonoBlock>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* job زندهٔ بازیابی */}
      {restoreJob && (
        <JobLivePanel
          jobId={restoreJob.jobId}
          title={`بازیابی زنده از «${restoreJob.file}» (hsctl restore)`}
          onFinished={() => {
            refreshList()
            setTimeout(() => setRestoreJob(null), 6000)
          }}
        />
      )}

      {/* دیالوگ تأیید تایپی بازیابی */}
      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(o) => !o && setRestoreTarget(null)}
        title="بازیابی از پشتیبان"
        confirmLabel="بازیابی کن"
        typedMatch={restoreTarget ?? undefined}
        typedLabel="برای تأیید، نام فایل پشتیبان را عیناً تایپ کنید:"
        onConfirm={() => restoreTarget && void doRestore(restoreTarget)}
        description={
          <div className="space-y-2">
            <p>
              محتوای پشتیبان{' '}
              <code className="font-mono text-foreground" dir="ltr">
                {restoreTarget}
              </code>{' '}
              جایگزین وضعیت فعلی سرور (پیکربندی + دیتابیس + کلیدها) می‌شود.
            </p>
            <p className="font-bold text-foreground">
              پیش از بازیابی، از وضعیت فعلی سرور به‌صورت خودکار پشتیبان گرفته
              می‌شود (با پسوند .pre-restore) تا در صورت نیاز قابل بازگشت باشد.
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              در طول بازیابی، سرویس موقتاً در دسترس نخواهد بود.
            </p>
          </div>
        }
      />
    </div>
  )
}

/** استخراج تاریخ از الگوی نام hsctl: hem-backup-YYYYMMDD-HHMMSS.tar.gz */
function backupDate(name: string): Date | null {
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(name)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  )
  return Number.isNaN(date.getTime()) ? null : date
}

// ---------------------------------------------------------------------------
// تب به‌روزرسانی
// ---------------------------------------------------------------------------

function UpdateTab() {
  const sid = useSessionId()
  const queryClient = useQueryClient()

  const check = useSessionDataQuery<UpdateCheckResult>(['update', 'check'], 'update/check', {
    staleTime: 0,
  })

  const [targetVersion, setTargetVersion] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [updateJob, setUpdateJob] = useState<{ jobId: string; target: string } | null>(null)
  const [naMessage, setNaMessage] = useState<string | null>(null)

  const doExecute = async () => {
    if (!sid) return
    try {
      const version = targetVersion.trim()
      const res = await agentPost<JobStartResponse>(
        `/api/s/${sid}/update/execute`,
        { confirm: true, ...(version ? { version } : {}) }
      )
      setUpdateJob({ jobId: res.jobId, target: res.target ?? version })
      toast.success('ارتقا آغاز شد — گام‌ها به‌صورت زنده نمایش داده می‌شوند.')
    } catch (e) {
      if (isNotAvailable(e)) {
        setNaMessage(e instanceof AgentError ? e.message : null)
      } else {
        toast.error('شروع ارتقا ممکن نشد.', {
          description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
        })
      }
    } finally {
      setConfirmOpen(false)
    }
  }

  if (naMessage) {
    return <NotAvailableCard message={naMessage} />
  }

  return (
    <div className="space-y-6">
      {/* مقایسهٔ نسخه‌ها — واقعی */}
      <Card className="bg-card/70">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-black text-foreground">
              <ArrowUpCircle className="size-5 text-emerald-600 dark:text-emerald-400" />
              وضعیت نسخهٔ Headscale
            </h2>
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5"
              onClick={() => void check.refetch()}
              disabled={check.isFetching}
              aria-label="بررسی به‌روزرسانی"
            >
              <RefreshCw className={cn('size-3.5', check.isFetching && 'animate-spin')} />
              بررسی به‌روزرسانی
            </Button>
          </div>

          {check.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : check.error ? (
            <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
                <CircleX className="size-4" />
                بررسی نسخه ناموفق بود
              </p>
              <p className="text-[12px] leading-6 text-muted-foreground">
                {check.error instanceof AgentError ? check.error.message : 'خطای نامشخص.'}
              </p>
              <Button
                variant="outline"
                className="h-11 gap-2 rounded-xl"
                onClick={() => void check.refetch()}
              >
                <RefreshCw className="size-4" />
                تلاش مجدد
              </Button>
            </div>
          ) : check.data ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div
                  className={cn(
                    'rounded-xl border p-4',
                    check.data.current
                      ? 'border-emerald-500/30 bg-emerald-500/[0.05]'
                      : 'border-amber-500/30 bg-amber-500/[0.05]'
                  )}
                >
                  <p className="text-[12px] font-bold text-muted-foreground">
                    نسخهٔ فعلی سرور شما
                  </p>
                  <p className="mt-1 font-mono text-2xl font-black text-foreground" dir="ltr">
                    {check.data.current ?? 'نامشخص'}
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-4">
                  <p className="text-[12px] font-bold text-muted-foreground">
                    آخرین نسخهٔ پایدار تأییدشدهٔ پروژه
                  </p>
                  <p className="mt-1 font-mono text-2xl font-black text-foreground" dir="ltr">
                    {check.data.latest}
                  </p>
                </div>
              </div>

              {check.data.upToDate ? (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                  <CircleCheck className="size-5" />
                  به‌روز هستید — نسخهٔ سرور شما همان آخرین نسخهٔ پایدار است.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm font-bold text-amber-700 dark:text-amber-300">
                  <ArrowUpCircle className="size-5" />
                  نسخهٔ جدیدی موجود است — ارتقا با پشتیبان کامل و بازگشت خودکار
                  انجام می‌شود.
                </div>
              )}

              {check.data.note && (
                <p className="text-[12px] leading-6 text-muted-foreground">{check.data.note}</p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ارتقا */}
      {check.data && !check.data.upToDate && (
        <Card className="bg-card/70">
          <CardContent className="space-y-4 p-5 sm:p-6">
            <h2 className="text-base font-black text-foreground">ارتقا به نسخهٔ جدید</h2>
            <div className="space-y-1.5">
              <Label htmlFor="update-target" className="text-[13px] font-bold">
                نسخهٔ هدف (اختیاری — خالی = آخرین نسخهٔ پایدار)
              </Label>
              <Input
                id="update-target"
                dir="ltr"
                className="h-11 max-w-xs font-mono"
                placeholder="مثلاً 0.30.0"
                value={targetVersion}
                onChange={(e) => setTargetVersion(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <Button
              className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              disabled={updateJob !== null}
              onClick={() => setConfirmOpen(true)}
            >
              <ArrowUpCircle className="size-5" />
              شروع ارتقا
            </Button>
          </CardContent>
        </Card>
      )}

      {/* job زندهٔ ارتقا با گام‌ها */}
      {updateJob && (
        <JobLivePanel
          jobId={updateJob.jobId}
          title={`ارتقای زندهٔ headscale (${updateJob.target})`}
          onFinished={() => {
            void queryClient.invalidateQueries({ queryKey: ['agent'] })
            setTimeout(() => setUpdateJob(null), 8000)
          }}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(o) => !o && setConfirmOpen(o)}
        title="ارتقای Headscale"
        confirmLabel="بله، ارتقا بده"
        danger={false}
        onConfirm={() => void doExecute()}
        description={
          <div className="space-y-2">
            <p>
              پیش از هر تغییری،{' '}
              <span className="font-bold">پشتیبان کامل از وضعیت فعلی</span> گرفته
              می‌شود و بستهٔ بازگشت آماده می‌گردد.
            </p>
            <p className="font-bold text-foreground">
              در صورت شکست ارتقا، بازگشت خودکار به نسخهٔ قبلی انجام می‌شود.
            </p>
            <p className="text-amber-700 dark:text-amber-300">
              در طول ارتقا، سرویس چند دقیقه در دسترس نخواهد بود؛ فرایند قابل لغو
              است اما لغو وسط کار ممکن است نیازمند بررسی با hsctl doctor باشد.
            </p>
          </div>
        }
      />
    </div>
  )
}
