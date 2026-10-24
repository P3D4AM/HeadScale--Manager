'use client'

/**
 * سکشن کنسول پیشرفته (#/console) — اجرای دستورهای «مجاز» روی سرور.
 *
 * الزام امنیتی محصول (قرارداد §9): شل آزاد نداریم.
 *  - پیش‌نمایش زنده (debounced) از agent می‌پرسد: این دستور مجاز است؟ دقیقاً
 *    چه دستوری اجرا خواهد شد؟ (exactCommand) یا چرا مسدود است (reason فارسی).
 *  - اجرا فقط از argv اعتبارسنجی‌شدهٔ allowlist (هرگز رشتهٔ خام کاربر).
 *  - تلاش مسدودشده هرگز اجرا نمی‌شود اما در حسابرسی agent ثبت می‌گردد.
 *  - تاریخچهٔ ۵۰ دستور آخر فقط در localStorage «مرورگر خود کاربر».
 *  - دستورهای سریع فقط «در ورودی درج می‌شوند» — هرگز خودکار اجرا نمی‌شوند.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  History,
  Play,
  ShieldCheck,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useIsConnected, useSessionId } from '../use-agent'
import { AgentError } from '@/lib/agent'
import { agentPost } from '@/lib/agent'
import { agentPostRaw } from '@/lib/ops/api'
import type { ConsolePreviewResult, ConsoleRunResult } from '@/lib/ops/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MonoBlock } from '../ops/mono-block'
import { DisconnectedGuide } from '../ops/disconnected-guide'

const HISTORY_KEY = 'hem-console-history'
const HISTORY_MAX = 50

const QUICK_COMMANDS: { label: string; cmd: string }[] = [
  { label: 'فهرست کاربران (JSON)', cmd: 'headscale users list -o json' },
  { label: 'فهرست دستگاه‌ها', cmd: 'headscale nodes list' },
  { label: 'وضعیت hsctl', cmd: 'hsctl status' },
  { label: 'بررسی سلامت محلی', cmd: 'curl -s -m 5 http://127.0.0.1:8080/health' },
  { label: 'فضای دیسک', cmd: 'df -h' },
  { label: 'پورت‌های باز', cmd: 'ss -tulpn' },
]

const ALLOWED_ROOTS = [
  'headscale (همهٔ زیرفرمان‌ها)',
  'hsctl (همهٔ زیرفرمان‌ها)',
  'systemctl status / is-active / is-enabled',
  'journalctl -u <unit> [-n N]',
  'curl -s -m <ثانیه> <url> (فقط میزبان سرور خودتان/localhost)',
  'ufw status',
  'df -h',
  'ss -tulpn',
]

export function ConsoleSection() {
  const connected = useIsConnected()
  if (!connected) {
    return (
      <DisconnectedGuide
        title="کنسول پیشرفته"
        needText="این کنسول دستورهای مجاز را از طریق SSH روی سرور شما اجرا می‌کند؛ ابتدا از مرکز اتصال وصل شوید."
      />
    )
  }
  return <ConsoleBody />
}

function ConsoleBody() {
  const sid = useSessionId()
  const [cmd, setCmd] = useState('')
  const [preview, setPreview] = useState<ConsolePreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<
    { cmd: string; res: ConsoleRunResult } | null
  >(null)
  const [history, setHistory] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // تاریخچه فقط سمت کلاینت (پس از mount تا mismatch پیش نیاید)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) setHistory(JSON.parse(raw) as string[])
    } catch {
      /* localStorage غیرفعال است */
    }
  }, [])

  // پیش‌نمایش زندهٔ debounced — همان چیزی که agent «اجرا خواهد کرد»
  useEffect(() => {
    const trimmed = cmd.trim()
    if (!sid || trimmed.length === 0) {
      setPreview(null)
      return
    }
    const timer = setTimeout(() => {
      setPreviewing(true)
      agentPost<ConsolePreviewResult>(`/api/s/${sid}/console/preview`, { cmd: trimmed })
        .then((res) => setPreview(res))
        .catch(() => setPreview(null)) // خطا/قطعی: پیش‌نمایش کهنه نشان نده
        .finally(() => setPreviewing(false))
    }, 450)
    return () => clearTimeout(timer)
  }, [cmd, sid])

  const pushHistory = useCallback((c: string) => {
    setHistory((prev) => {
      const next = [c, ...prev.filter((x) => x !== c)].slice(0, HISTORY_MAX)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const execute = useCallback(async () => {
    const trimmed = cmd.trim()
    if (!sid || trimmed.length === 0 || running) return
    setRunning(true)
    try {
      const res = await agentPostRaw<ConsoleRunResult>(`/api/s/${sid}/console`, {
        cmd: trimmed,
      })
      setResult({ cmd: preview?.exactCommand || trimmed, res })
      pushHistory(trimmed)
      if (res.exitCode === 0) {
        toast.success('دستور با موفقیت اجرا شد.')
      } else {
        toast.error(`دستور با کد خروج ${res.exitCode} تمام شد.`)
      }
    } catch (e) {
      if (e instanceof AgentError && e.code === 'COMMAND_BLOCKED') {
        toast.error('این دستور مجاز نیست.', { description: e.message })
        // دلیل واقعی مسدودی را در جعبهٔ پیش‌نمایش هم نشان بده
        setPreview({ ok: true, allowed: false, exactCommand: '', reason: e.message })
      } else {
        toast.error('اجرای دستور ممکن نشد.', {
          description: e instanceof AgentError ? e.message : 'خطای نامشخص.',
        })
      }
    } finally {
      setRunning(false)
    }
  }, [cmd, sid, running, preview, pushHistory])

  const insertQuick = (c: string) => {
    setCmd(c)
    inputRef.current?.focus()
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6"
      >
        <h1 className="flex items-center gap-2 text-xl font-black text-foreground sm:text-2xl">
          <span className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <SquareTerminal className="size-5" />
          </span>
          کنسول پیشرفته
        </h1>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          اجرای دستورهای مجاز روی سرور — با پیش‌نمایش دقیق پیش از اجرا.
        </p>
      </motion.div>

      {/* کارت امنیت */}
      <Card className="mb-6 border-emerald-500/25 bg-emerald-500/[0.03]">
        <CardContent className="space-y-3 p-5 sm:p-6">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
            این کنسول یک شل آزاد نیست — و این یک ویژگی امنیتی است
          </p>
          <p className="text-[13px] leading-7 text-foreground/90">
            هر دستور ابتدا با «فهرست سفید امن» در سرویس مدیریت بررسی می‌شود؛
            رشتهٔ خام شما هرگز مستقیم اجرا نمی‌شود — دستور از بخش‌های
            اعتبارسنجی‌شده بازسازی و همان نسخه اجرا می‌شود. کاراکترهای متکار پوسته
            (مانند <code className="font-mono" dir="ltr">; &amp; | $ &gt; &lt;</code>)
            و برنامه‌های خارج از فهرست مجاز رد می‌شوند.
          </p>
          <div className="rounded-xl border bg-muted/30 p-3">
            <p className="mb-2 text-[12px] font-bold text-foreground">
              برنامه‌های مجاز (فهرست سفید):
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {ALLOWED_ROOTS.map((r) => (
                <li
                  key={r}
                  className="flex items-start gap-2 text-[12px] leading-6 text-muted-foreground"
                >
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500"
                    aria-hidden
                  />
                  <code className="font-mono" dir="ltr">{r}</code>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">
            همهٔ اجراها — و حتی تلاش‌های مسدودشده — در حسابرسی محلی سرویس مدیریت
            (با پاک‌سازی خودکار داده‌های حساس) ثبت می‌شوند.
          </p>
        </CardContent>
      </Card>

      {/* ورودی دستور */}
      <Card className="bg-card/70">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <label
            htmlFor="console-input"
            className="flex items-center gap-2 text-sm font-black text-foreground"
          >
            <Play className="size-4 text-emerald-600 dark:text-emerald-400" />
            دستور
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="console-input"
              ref={inputRef}
              dir="ltr"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void execute()
                }
              }}
              placeholder="مثلاً: headscale users list -o json"
              className="custom-scrollbar h-12 flex-1 rounded-xl border bg-background px-4 font-mono text-[13px] text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={running}
            />
            <Button
              className="h-12 shrink-0 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 disabled:opacity-50 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              onClick={() => void execute()}
              disabled={running || cmd.trim().length === 0}
            >
              {running ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              ) : (
                <Play className="size-4" />
              )}
              اجرا
            </Button>
          </div>

          {/* پیش‌نمایش زنده */}
          {previewing && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Skeleton className="h-4 w-40" />
              در حال بررسی دستور با فهرست سفید agent…
            </div>
          )}
          {!previewing && preview && preview.allowed && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] p-3">
              <p className="text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
                مجاز است — دستور دقیقی که اجرا خواهد شد:
              </p>
              <code
                className="mt-1.5 block break-all font-mono text-[13px] font-bold text-emerald-800 dark:text-emerald-200"
                dir="ltr"
              >
                $ {preview.exactCommand}
              </code>
            </div>
          )}
          {!previewing && preview && !preview.allowed && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/[0.07] p-3">
              <p className="text-[12px] font-bold text-red-700 dark:text-red-300">
                این دستور اجرا نخواهد شد — دلیل:
              </p>
              <p className="mt-1 text-[13px] leading-6 text-red-700 dark:text-red-300">
                {preview.reason}
              </p>
            </div>
          )}

          {/* دستورهای سریع — فقط درج در ورودی، هرگز اجرا نیست */}
          <div>
            <p className="mb-2 text-[12px] font-bold text-muted-foreground">
              دستورهای سریع (کلیک فقط در ورودی می‌نویسد؛ اجرا با دکمهٔ «اجرا»):
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_COMMANDS.map((q) => (
                <button
                  key={q.cmd}
                  type="button"
                  onClick={() => insertQuick(q.cmd)}
                  className="h-11 rounded-xl border bg-muted/40 px-3 text-[12px] font-bold text-foreground transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                  title={q.cmd}
                >
                  {q.label}
                  <code className="ms-2 hidden font-mono text-[11px] text-muted-foreground sm:inline" dir="ltr">
                    {q.cmd.length > 28 ? `${q.cmd.slice(0, 28)}…` : q.cmd}
                  </code>
                </button>
              ))}
            </div>
          </div>

          {/* خروجی */}
          {result && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-bold text-muted-foreground">خروجی:</p>
                <div className="flex items-center gap-2">
                  {result.res.exitCode === 0 ? (
                    <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" variant="outline">
                      ✓ موفق
                    </Badge>
                  ) : (
                    <Badge className="gap-1 border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" variant="outline">
                      ✗ ناموفق
                    </Badge>
                  )}
                  <Badge variant="secondary" className="font-mono" dir="ltr">
                    exit {result.res.exitCode}
                  </Badge>
                </div>
              </div>
              <MonoBlock maxHeightClass="max-h-96" aria-label="خروجی اجرای دستور">
                <div className="text-emerald-400">$ {result.cmd}</div>
                {result.res.stdout && (
                  <div className="whitespace-pre-wrap break-all text-slate-200">
                    {result.res.stdout}
                  </div>
                )}
                {result.res.stderr && (
                  <div className="whitespace-pre-wrap break-all text-red-400">
                    {result.res.stderr}
                  </div>
                )}
                {!result.res.stdout && !result.res.stderr && (
                  <div className="text-slate-400">(بدون خروجی)</div>
                )}
              </MonoBlock>
            </div>
          )}
        </CardContent>
      </Card>

      {/* تاریخچه */}
      {history.length > 0 && (
        <Card className="mt-6 bg-card/70">
          <CardContent className="space-y-3 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
                <History className="size-4 text-emerald-600 dark:text-emerald-400" />
                تاریخچه ({history.length.toLocaleString('fa-IR')} دستور — فقط در مرورگر شما)
              </h2>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-muted-foreground"
                onClick={() => {
                  setHistory([])
                  try {
                    localStorage.removeItem(HISTORY_KEY)
                  } catch {
                    /* ignore */
                  }
                  toast.success('تاریخچهٔ دستورها پاک شد.')
                }}
              >
                <Trash2 className="size-3.5" />
                پاک‌کردن
              </Button>
            </div>
            <div className="custom-scrollbar max-h-56 space-y-1.5 overflow-y-auto pl-1">
              {history.map((h, i) => (
                <button
                  key={`${h}-${i}`}
                  type="button"
                  onClick={() => insertQuick(h)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-start font-mono text-[12px] text-foreground transition-colors',
                    'hover:border-emerald-500/40 hover:bg-emerald-500/10 focus:outline-none focus:ring-2 focus:ring-emerald-500/50'
                  )}
                  dir="ltr"
                  title="کلیک برای استفادهٔ مجدد"
                >
                  <History className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{h}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
