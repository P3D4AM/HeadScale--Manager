'use client'

/**
 * مرکز اتصال — قلب برنامه.
 * همهٔ عملیات واقعی است: CRUD پروفایل‌ها، اتصال inline/پروفایلی،
 * جریان دومرحله‌ای تأیید اثرانگشت (TOFU)، هشدار مغایرت کلید میزبان
 * با فراموشی نوع‌شده، و کارت نشست فعال.
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  BadgeCheck,
  Copy,
  Fingerprint,
  FlaskConical,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  Unplug,
  User,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import {
  AgentError,
  agentDelete,
  agentGet,
  agentPost,
  agentPut,
  type AgentHealth,
  type ConnectInlineInput,
  type ConnectResponse,
  type HostKeyChangeDetail,
  type HostKeyFingerprint,
  type HsMode,
  type Profile,
  type ProfilesResponse,
} from '@/lib/agent'
import { useConnectionStore } from '@/lib/connection-store'
import { AGENT_QUERY_PREFIX, useDisconnect } from '../use-agent'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CodeBlock } from '@/components/home/code-block'

// ---------------------------------------------------------------------------
// فرم مشترک پروفایل/اتصال سریع
// ---------------------------------------------------------------------------

type AuthMethod = 'password' | 'key'

interface QuickForm {
  name: string
  host: string
  port: string
  username: string
  authMethod: AuthMethod
  password: string
  keyPath: string
  passphrase: string
  hsMode: HsMode
  hsCustomPrefix: string
  saveSecret: boolean
}

const EMPTY_FORM: QuickForm = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authMethod: 'password',
  password: '',
  keyPath: '',
  passphrase: '',
  hsMode: 'system-sudo',
  hsCustomPrefix: '',
  saveSecret: false,
}

const HS_MODE_LABELS: Record<HsMode, string> = {
  'system-sudo': 'نصب سیستمی با sudo (پیش‌فرض VPS)',
  system: 'نصب سیستمی (ورود مستقیم root)',
  custom: 'باینری/پیکربندی دلخواه (تست و توسعه)',
}

const DEMO_FORM: QuickForm = {
  ...EMPTY_FORM,
  name: 'سرور آزمایشی داخلی',
  host: '127.0.0.1',
  port: '2222',
  username: 'z',
  password: 'hemtest-pass',
  hsMode: 'custom',
  hsCustomPrefix: '/tmp/hs-bin/headscale --config /home/z/hs-test/config.yaml',
}

function inlineOf(f: QuickForm): ConnectInlineInput {
  return {
    host: f.host.trim(),
    port: Number.parseInt(f.port, 10) || 22,
    username: f.username.trim(),
    authMethod: f.authMethod,
    ...(f.authMethod === 'password'
      ? { password: f.password }
      : {
          keyPath: f.keyPath.trim(),
          ...(f.passphrase ? { passphrase: f.passphrase } : {}),
        }),
    hsMode: f.hsMode,
    ...(f.hsMode === 'custom' && f.hsCustomPrefix.trim()
      ? { hsCustomPrefix: f.hsCustomPrefix.trim() }
      : {}),
  }
}

/** فرم مشترک فیلدها — در کارت اتصال سریع و دیالوگ ویرایش پروفایل استفاده می‌شود */
function ConnectionFields({
  value,
  onChange,
  showName,
  showSaveSecret,
}: {
  value: QuickForm
  onChange: (patch: Partial<QuickForm>) => void
  showName: boolean
  showSaveSecret: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {showName && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cf-name">نام پروفایل</Label>
          <Input
            id="cf-name"
            className="h-11"
            placeholder="مثلاً: سرور دفتر"
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
          <p className="text-[11px] leading-5 text-muted-foreground">
            فقط برای نمایش در فهرست پروفایل‌ها — اختیاری.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="cf-host">آدرس سرور (IP یا دامنه) *</Label>
        <Input
          id="cf-host"
          className="h-11"
          dir="ltr"
          placeholder="203.0.113.10"
          value={value.host}
          onChange={(e) => onChange({ host: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cf-port">پورت SSH</Label>
        <Input
          id="cf-port"
          className="h-11"
          dir="ltr"
          inputMode="numeric"
          placeholder="22"
          value={value.port}
          onChange={(e) => onChange({ port: e.target.value.replace(/[^0-9]/g, '') })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cf-username">نام کاربری SSH *</Label>
        <Input
          id="cf-username"
          className="h-11"
          dir="ltr"
          placeholder="root یا ubuntu یا …"
          value={value.username}
          onChange={(e) => onChange({ username: e.target.value })}
        />
        <p className="text-[11px] leading-5 text-muted-foreground">
          برای نصب و مدیریت، کاربر باید دسترسی sudo (یا root) داشته باشد.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>روش احراز هویت</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange({ authMethod: 'password' })}
            aria-pressed={value.authMethod === 'password'}
            className={cn(
              'inline-flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
              value.authMethod === 'password'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            <Lock className="size-4" />
            رمز عبور
          </button>
          <button
            type="button"
            onClick={() => onChange({ authMethod: 'key' })}
            aria-pressed={value.authMethod === 'key'}
            className={cn(
              'inline-flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
              value.authMethod === 'key'
                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            <KeyRound className="size-4" />
            کلید SSH
          </button>
        </div>
      </div>

      {value.authMethod === 'password' ? (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cf-password">رمز عبور</Label>
          <Input
            id="cf-password"
            className="h-11"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            placeholder="••••••••"
            value={value.password}
            onChange={(e) => onChange({ password: e.target.value })}
          />
          {showSaveSecret ? (
            <p className="text-[11px] leading-5 text-muted-foreground">
              ذخیرهٔ رمز فقط با فعال‌کردن گزینهٔ «ذخیرهٔ امن» در پایین فرم انجام
              می‌شود؛ در غیر این صورت رمز فقط تا پایان همین اتصال در حافظه می‌ماند.
            </p>
          ) : (
            <p className="text-[11px] leading-5 text-muted-foreground">
              این رمز در مرورگر ذخیره نمی‌شود و فقط برای همین اتصال ارسال می‌شود.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cf-keypath">مسیر فایل کلید خصوصی</Label>
            <Input
              id="cf-keypath"
              className="h-11"
              dir="ltr"
              placeholder="C:\\Users\\you\\.ssh\\id_ed25519"
              value={value.keyPath}
              onChange={(e) => onChange({ keyPath: e.target.value })}
            />
            <p className="text-[11px] leading-5 text-muted-foreground">
              این مسیر باید روی «همان ماشینی که برنامهٔ مدیریت در آن اجرا می‌شود»
              موجود باشد (نه روی سرور).
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="cf-passphrase">passphrase کلید (اختیاری)</Label>
            <Input
              id="cf-passphrase"
              className="h-11"
              type="password"
              autoComplete="new-password"
              dir="ltr"
              placeholder="اگر کلید رمز دارد"
              value={value.passphrase}
              onChange={(e) => onChange({ passphrase: e.target.value })}
            />
          </div>
        </>
      )}

      <div className="space-y-1.5 sm:col-span-2">
        <Label>حالت اجرای Headscale روی سرور</Label>
        <Select value={value.hsMode} onValueChange={(v) => onChange({ hsMode: v as HsMode })}>
          <SelectTrigger className="h-11 w-full" aria-label="حالت اجرای Headscale">
            <SelectValue />
          </SelectTrigger>
          <SelectContent dir="rtl">
            {(Object.keys(HS_MODE_LABELS) as HsMode[]).map((m) => (
              <SelectItem key={m} value={m}>
                {HS_MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] leading-5 text-muted-foreground">
          اگر سرور را با نصب‌کنندهٔ همین برنامه نصب کرده‌اید، حالت پیش‌فرض درست
          است. حالت «دلخواه» برای سرورهای تستی/دست‌ساز است.
        </p>
      </div>

      {value.hsMode === 'custom' && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cf-prefix">پیشوند فرمان اجرای headscale</Label>
          <Input
            id="cf-prefix"
            className="h-11"
            dir="ltr"
            placeholder="/usr/local/bin/headscale --config /etc/headscale/config.yaml"
            value={value.hsCustomPrefix}
            onChange={(e) => onChange({ hsCustomPrefix: e.target.value })}
          />
          <p className="text-[11px] leading-5 text-muted-foreground">
            برنامه همهٔ دستورات headscale را با این پیشوند روی سرور اجرا می‌کند.
          </p>
        </div>
      )}

      {showSaveSecret && (
        <div className="sm:col-span-2 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3.5">
          <Checkbox
            id="cf-savesecret"
            className="mt-0.5"
            checked={value.saveSecret}
            onCheckedChange={(c) => onChange({ saveSecret: c === true })}
          />
          <div className="space-y-1">
            <Label htmlFor="cf-savesecret" className="cursor-pointer text-[13px] font-bold">
              ذخیرهٔ امن رمز در سرویس مدیریت
            </Label>
            <p className="text-[11px] leading-5 text-muted-foreground">
              رمز به‌صورت امن در مخزن اسرار همان ماشینی که برنامه در آن اجرا می‌شود
              ذخیره می‌شود (در ویندوز: Credential Manager). پیش‌فرض خاموش است —
              رمز فقط تا پایان اتصال در حافظه باقی می‌ماند.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// کارت اثرانگشت (TOFU)
// ---------------------------------------------------------------------------

function FingerprintRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3">
      <span className="text-[11px] font-bold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <code className="custom-scrollbar flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-foreground" dir="ltr">
          {value}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 shrink-0"
          aria-label={`کپی ${label}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => toast.success(`${label} کپی شد.`))
          }}
        >
          <Copy className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

function FingerprintDialog({
  fingerprint,
  host,
  busy,
  onAccept,
  onDecline,
}: {
  fingerprint: HostKeyFingerprint
  host: string
  busy: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  return (
    <Dialog open>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Fingerprint className="size-5 text-amber-500" />
            تأیید کلید میزبان سرور
          </DialogTitle>
          <DialogDescription className=" leading-7">
            اولین بار است به <span className="font-mono" dir="ltr">{host}</span> وصل
            می‌شوید. برنامه تا وقتی شما هویت سرور را تأیید نکنید، متصل نمی‌شود
            (سیاست TOFU — اعتماد در اولین استفاده).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] text-foreground/90">
            <Terminal className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className=" leading-7">
              اثرانگشت زیر را با مدیر سرور خود تطبیق دهید. اگر به کنسول خودِ سرور
              دسترسی دارید، این دستور را در سرور اجرا کنید و مطابقت را ببینید:
            </p>
          </div>
          <CodeBlock
            code="ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub"
            language="bash"
            title="روی خودِ سرور اجرا کنید"
            terminal
          />
          <FingerprintRow label="SHA256 (پیشنهادی برای تطبیق)" value={fingerprint.hash} />
          <FingerprintRow label="MD5 (فرمت قدیمی)" value={fingerprint.base64Md5} />
          <p className="rounded-lg border border-border/70 bg-muted/30 p-3 text-[12px] leading-6 text-muted-foreground">
            با زدن «تأیید و اتصال» این اثرانگشت ذخیره می‌شود و در اتصال‌های بعدی
            خودکار بررسی می‌شود؛ اگر روزی تغییر کند، اتصال با هشدار امنیتی متوقف
            خواهد شد. نوع کلید: <span className="font-mono" dir="ltr">{fingerprint.algo}</span>
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            onClick={onAccept}
            disabled={busy}
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            تأیید و اتصال
          </Button>
          <Button variant="outline" onClick={onDecline} disabled={busy} className="h-11 rounded-xl px-5">
            لغو
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// هشدار مغایرت کلید میزبان (409)
// ---------------------------------------------------------------------------

function HostKeyChangeCard({ detail, onForget }: { detail: HostKeyChangeDetail; onForget: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const match = typed.trim() === detail.host

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Card className="border-2 border-red-500/60 bg-red-500/[0.05]">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-red-500/15 text-red-600 dark:text-red-400">
              <ShieldAlert className="size-6" />
            </div>
            <div>
              <h2 className="text-lg font-black text-red-700 dark:text-red-300">
                هشدار امنیتی: کلید میزبان سرور تغییر کرده است!
              </h2>
              <p className="mt-1 text-[13px] leading-6 text-foreground/90">
                اثرانگشتی که این سرور الان ارائه می‌دهد با مقداری که قبلاً ذخیره و
                تأیید شده بود <strong>مغایرت</strong> دارد. اتصال بلافاصله قطع شد.
                این اتفاق دو معنای ممکن دارد:
              </p>
            </div>
          </div>

          <ul className="space-y-1.5 rounded-xl border border-border/70 bg-muted/30 p-4 text-[13px] leading-6">
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <span>
                سرور reinstall شده یا کلید SSH آن تعویض شده (بی‌خطر — پس از
                راستی‌آزمایی می‌توانید کلید جدید را تأیید کنید).
              </span>
            </li>
            <li className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-red-500" aria-hidden />
              <span>
                <strong className="text-red-600 dark:text-red-400">
                  حملهٔ مردِ میانی (MITM)
                </strong>{' '}
                — کسی تلاش می‌کند خودش را به‌جای سرور شما جا بزند. در این حالت
                هرگز کلید قدیمی را پاک نکنید و از راه امنی با مدیر سرور تماس
                بگیرید.
              </span>
            </li>
          </ul>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="size-3.5" />
                کلید ذخیره‌شدهٔ قبلی
              </p>
              <p className="text-[10px] text-muted-foreground">
                اولین دیدار: {new Date(detail.stored.firstSeen).toLocaleString('fa-IR')}
              </p>
              <code className="mt-1 block break-all font-mono text-xs" dir="ltr">{detail.stored.sha256}</code>
            </div>
            <div className="rounded-xl border border-red-500/30 bg-red-500/[0.04] p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-red-700 dark:text-red-300">
                <AlertTriangle className="size-3.5" />
                کلیدی که الان ارائه شد
              </p>
              <p className="text-[10px] text-muted-foreground">نوع: {detail.presented.algo}</p>
              <code className="mt-1 block break-all font-mono text-xs" dir="ltr">{detail.presented.hash}</code>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <p className="text-[13px] font-bold text-foreground">
              فراموشی کلید میزبان و تأیید مجدد
            </p>
            <p className="text-[12px] leading-6 text-muted-foreground">
              فقط اگر <strong>مطمئن</strong> هستید سرور reinstall/تعویض کلید شده
              است، آدرس سرور را عیناً تایپ کنید تا کلید قدیمی حذف و اتصال مجدد با
              اثرانگشت جدید (و تأیید دوبارهٔ شما) انجام شود:
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                className="h-11 flex-1"
                dir="ltr"
                placeholder={detail.host}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="تایپ آدرس سرور برای تأیید فراموشی کلید"
              />
              <Button
                variant="destructive"
                className="h-11 gap-2 rounded-xl font-bold"
                disabled={!match || busy}
                onClick={() => {
                  setBusy(true)
                  onForget()
                }}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                فراموشی کلید و اتصال مجدد
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// سکشن اصلی
// ---------------------------------------------------------------------------

export function ConnectSection() {
  const status = useConnectionStore((s) => s.status)
  const sessionId = useConnectionStore((s) => s.sessionId)
  const host = useConnectionStore((s) => s.host)
  const port = useConnectionStore((s) => s.port)
  const username = useConnectionStore((s) => s.username)
  const hsMode = useConnectionStore((s) => s.hsMode)
  const sudoMode = useConnectionStore((s) => s.sudoMode)
  const connectedAt = useConnectionStore((s) => s.connectedAt)
  const fingerprint = useConnectionStore((s) => s.fingerprint)
  const lastError = useConnectionStore((s) => s.lastError)
  const hostKeyChange = useConnectionStore((s) => s.hostKeyChange)
  const socketAlive = useConnectionStore((s) => s.socketAlive)

  const [form, setForm] = useState<QuickForm>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [sessionDisconnectOpen, setSessionDisconnectOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Profile | null>(null)
  const [secretTarget, setSecretTarget] = useState<Profile | null>(null)
  const [secretValue, setSecretValue] = useState('')
  const [secretSave, setSecretSave] = useState(false)

  const qc = useQueryClient()
  const disconnect = useDisconnect()

  const connected = status === 'connected'
  const connecting = status === 'connecting'

  // فهرست پروفایل‌ها — همیشه زنده از agent
  const profilesQuery = useQuery({
    queryKey: [AGENT_QUERY_PREFIX, 'profiles'],
    queryFn: async () => {
      const res = await agentGet<ProfilesResponse>('/api/profiles')
      return res.profiles
    },
  })
  const profiles = profilesQuery.data ?? []

  const patchForm = (patch: Partial<QuickForm>) => setForm((f) => ({ ...f, ...patch }))

  // ---------------------------------------------------------------- اتصال
  const handleConnectResponse = (res: ConnectResponse) => {
    useConnectionStore.getState().handleConnectResponse(res)
    if (res.status === 'connected') {
      const h = useConnectionStore.getState().host ?? 'سرور'
      toast.success('اتصال برقرار شد.', {
        description: `نشست SSH به ${h} ساخته شد.`,
      })
    } else if (res.status === 'fingerprint-required') {
      toast.info('تأیید کلید میزبان لازم است.', {
        description: 'پنجرهٔ تأیید اثرانگشت را ببینید.',
      })
    }
  }

  const handleConnectError = (err: unknown) => {
    if (err instanceof AgentError) {
      if (err.code === 'HOSTKEY_CHANGED' && err.detail) {
        useConnectionStore.getState().setHostKeyChange(
          err.detail as HostKeyChangeDetail,
          err.message
        )
        toast.error('مغایرت کلید میزبان — اتصال متوقف شد.')
        return
      }
      useConnectionStore.getState().setError(err.code, err.message)
      toast.error(err.message, {
        description: ERR_HELP[err.code] ?? undefined,
      })
      return
    }
    const msg = err instanceof Error ? err.message : 'خطای نامشخص در اتصال.'
    useConnectionStore.getState().setError('INTERNAL', msg)
    toast.error(msg)
  }

  const connectInlineValues = async (inline: ConnectInlineInput) => {
    setBusy(true)
    useConnectionStore.getState().beginConnect(inline)
    try {
      const res = await agentPost<ConnectResponse>('/api/connect', { inline })
      handleConnectResponse(res)
    } catch (err) {
      handleConnectError(err)
    } finally {
      setBusy(false)
    }
  }

  const connectQuick = async () => {
    if (!form.host.trim() || !form.username.trim()) {
      toast.warning('آدرس سرور و نام کاربری الزامی است.')
      return
    }
    if (form.authMethod === 'password' && !form.password) {
      toast.warning('رمز عبور را وارد کنید (یا روش کلید SSH را انتخاب کنید).')
      return
    }
    if (form.authMethod === 'key' && !form.keyPath.trim()) {
      toast.warning('مسیر فایل کلید خصوصی را وارد کنید.')
      return
    }
    await connectInlineValues(inlineOf(form))
  }

  const connectProfile = async (p: Profile) => {
    if (connected) {
      toast.warning('ابتدا اتصال فعلی را قطع کنید.', {
        description: 'هر بار یک نشست فعال در این رابط پشتیبانی می‌شود.',
      })
      return
    }
    setBusy(true)
    // نمای بدون راز — فقط برای نمایش در حین connecting
    const display: ConnectInlineInput = {
      host: p.host,
      port: p.port,
      username: p.username,
      authMethod: p.authMethod,
      hsMode: p.hsMode,
      ...(p.hsMode === 'custom' && p.hsCustomPrefix ? { hsCustomPrefix: p.hsCustomPrefix } : {}),
    }
    useConnectionStore.getState().beginConnect(display, p.id)
    try {
      const res = await agentPost<ConnectResponse>('/api/connect', { profileId: p.id })
      handleConnectResponse(res)
    } catch (err) {
      if (
        err instanceof AgentError &&
        err.code === 'VALIDATION_FAILED' &&
        err.message.includes('ذخیره نشده')
      ) {
        useConnectionStore.getState().markDisconnected()
        setSecretTarget(p)
        setSecretValue('')
        setSecretSave(false)
        toast.info(`رمز/کلمهٔ عبور پروفایل «${p.name}» ذخیره نشده است.`, {
          description: 'برای این اتصال مقدار را وارد کنید.',
        })
      } else {
        handleConnectError(err)
      }
    } finally {
      setBusy(false)
    }
  }

  const connectWithSecret = async () => {
    if (!secretTarget) return
    const p = secretTarget
    setSecretTarget(null)
    const inline: ConnectInlineInput = {
      host: p.host,
      port: p.port,
      username: p.username,
      authMethod: p.authMethod,
      ...(p.authMethod === 'password'
        ? { password: secretValue }
        : { keyPath: p.keyPath ?? '', ...(secretValue ? { passphrase: secretValue } : {}) }),
      hsMode: p.hsMode,
      ...(p.hsMode === 'custom' && p.hsCustomPrefix ? { hsCustomPrefix: p.hsCustomPrefix } : {}),
    }
    // اگر کاربر خواست، راز در agent ذخیره می‌شود (ذخیرهٔ امن)
    if (secretSave && secretValue) {
      try {
        await agentPut(`/api/profiles/${p.id}`, { secret: secretValue, saveSecret: true })
        toast.success('رمز به‌صورت امن در سرویس مدیریت ذخیره شد.')
      } catch (err) {
        toast.warning('ذخیرهٔ رمز ناموفق بود — ادامه با رمز موقتی.', {
          description: err instanceof Error ? err.message : undefined,
        })
      }
    }
    setSecretValue('')
    await connectInlineValues(inline)
  }

  // ------------------------------------------------------------ TOFU
  const confirmFingerprint = async (accept: boolean) => {
    if (!sessionId) return
    setConfirmBusy(true)
    try {
      const res = await agentPost<ConnectResponse>('/api/connect/confirm', {
        sessionId,
        accept,
      })
      if (accept && res.status === 'connected') {
        handleConnectResponse(res)
      } else {
        useConnectionStore.getState().markDisconnected()
        toast.info('اتصال لغو شد.')
      }
    } catch (err) {
      handleConnectError(err)
    } finally {
      setConfirmBusy(false)
    }
  }

  // ------------------------------------------------- فراموشی کلید میزبان
  const forgetAndReconnect = async () => {
    if (!hostKeyChange) return
    try {
      await agentPost('/api/known-hosts/forget', {
        host: hostKeyChange.host,
        port: hostKeyChange.port,
        confirm: true,
      })
      toast.success('کلید قدیمی فراموش شد — در حال اتصال مجدد…')
      useConnectionStore.getState().clearHostKeyChange()
      // تلاش مجدد با همان درخواست قبلی
      const st = useConnectionStore.getState()
      const pid = st.profileId
      if (pid) {
        const p = profiles.find((x) => x.id === pid)
        if (p) {
          await connectProfile(p)
          return
        }
      }
      if (st.lastInline) {
        await connectInlineValues(st.lastInline)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فراموشی کلید میزبان ناموفق بود.')
    }
  }

  // -------------------------------------------------------- ذخیره پروفایل
  const saveQuickProfile = async () => {
    if (!form.name.trim()) {
      toast.warning('برای ذخیرهٔ پروفایل، ابتدا نامی برای آن بنویسید.')
      return
    }
    if (!form.host.trim() || !form.username.trim()) {
      toast.warning('آدرس سرور و نام کاربری الزامی است.')
      return
    }
    if (form.authMethod === 'key' && !form.keyPath.trim()) {
      toast.warning('برای پروفایل کلید SSH، مسیر فایل کلید لازم است.')
      return
    }
    setBusy(true)
    try {
      // اصل امنیتی: رمز فقط با فعال‌بودن «ذخیرهٔ امن» به سرویس مدیریت فرستاده
      // می‌شود؛ در غیر این صورت پروفایل بدون راز ذخیره می‌شود و اتصال از
      // طریق همان پروفایل، رمز را از کاربر می‌پرسد.
      const secret = form.saveSecret
        ? form.authMethod === 'password'
          ? form.password
          : form.passphrase
        : ''
      await agentPost('/api/profiles', {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number.parseInt(form.port, 10) || 22,
        username: form.username.trim(),
        authMethod: form.authMethod,
        ...(form.authMethod === 'key' ? { keyPath: form.keyPath.trim() } : {}),
        hsMode: form.hsMode,
        ...(form.hsMode === 'custom' && form.hsCustomPrefix.trim()
          ? { hsCustomPrefix: form.hsCustomPrefix.trim() }
          : {}),
        ...(secret ? { secret, saveSecret: true } : {}),
      })
      toast.success(`پروفایل «${form.name.trim()}» ذخیره شد.`)
      patchForm({ name: '' })
      await qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX, 'profiles'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ذخیرهٔ پروفایل ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  const deleteProfile = async (p: Profile) => {
    setBusy(true)
    try {
      await agentDelete(`/api/profiles/${p.id}`)
      toast.success(`پروفایل «${p.name}» حذف شد.`)
      if (useConnectionStore.getState().activeProfileId === p.id) {
        useConnectionStore.getState().setActiveProfileId(null)
      }
      await qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX, 'profiles'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'حذف پروفایل ناموفق بود.')
    } finally {
      setBusy(false)
      setDeleteTarget(null)
    }
  }

  const connectedAtLabel = useMemo(() => {
    if (!connectedAt) return null
    try {
      return new Date(connectedAt).toLocaleString('fa-IR')
    } catch {
      return connectedAt
    }
  }, [connectedAt])

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* سربرگ */}
      <div className="mb-8">
        <Badge
          variant="outline"
          className="mb-3 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <Plug className="size-3.5" />
          مرکز اتصال
        </Badge>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          اتصال امن به سرور شما
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          این برنامه از طریق SSH به سرور شما وصل می‌شود و Headscale را روی آن نصب
          و مدیریت می‌کند. رمزها هرگز در مرورگر ذخیره نمی‌شوند و در اولین اتصال،
          هویت سرور با اثرانگشت کلید میزبان تأیید می‌شود.
        </p>
      </div>

      {/* هشدار مغایرت کلید میزبان */}
      {hostKeyChange && (
        <div className="mb-6">
          <HostKeyChangeCard detail={hostKeyChange} onForget={() => void forgetAndReconnect()} />
        </div>
      )}

      {/* خطای اتصال */}
      {status === 'error' && lastError && !hostKeyChange && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <Card className="border-red-500/40 bg-red-500/[0.04]">
            <CardContent className="flex flex-col gap-2 p-5">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-5 shrink-0 text-red-500" />
                <p className="font-bold text-red-700 dark:text-red-300">
                  اتصال ناموفق بود
                  <span className="ms-2 rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-[11px]" dir="ltr">
                    {lastError.code}
                  </span>
                </p>
              </div>
              <p className="text-[13px] leading-6 text-foreground/90">{lastError.message}</p>
              {ERR_HELP[lastError.code] && (
                <p className="rounded-lg border border-border/70 bg-muted/40 p-3 text-[12px] leading-6 text-muted-foreground">
                  💡 {ERR_HELP[lastError.code]}
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* نشست فعال */}
      {connected && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <Card className="border-emerald-500/40 bg-emerald-500/[0.05]">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="relative inline-flex size-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <PlugZap className="size-6" />
                    {socketAlive && (
                      <span className="absolute -end-1 -top-1 flex size-3.5">
                        <span className="absolute inline-flex size-3.5 animate-ping rounded-full bg-emerald-400 opacity-60" />
                        <span className="relative inline-flex size-3.5 rounded-full border-2 border-background bg-emerald-500" />
                      </span>
                    )}
                  </div>
                  <div>
                    <h2 className="text-base font-black text-foreground">
                      نشست فعال {socketAlive ? '· پایش زنده روشن' : ''}
                    </h2>
                    <p className="mt-0.5 font-mono text-[13px] text-muted-foreground" dir="ltr">
                      {username}@{host}:{port}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="h-11 gap-2 rounded-xl border-red-500/40 font-bold text-red-600 hover:bg-red-500/10 hover:text-red-500 dark:text-red-400"
                  onClick={() => setSessionDisconnectOpen(true)}
                >
                  <Unplug className="size-4" />
                  قطع اتصال
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                  حالت Headscale: {HS_MODE_LABELS[hsMode ?? 'system-sudo']}
                </Badge>
                <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                  sudo: {SUDO_LABELS[sudoMode ?? 'none']}
                </Badge>
                {connectedAtLabel && (
                  <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
                    از {connectedAtLabel}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {QUICK_LINKS.map((l) => (
                  <Button
                    key={l.hash}
                    variant="outline"
                    className="h-11 gap-2 rounded-xl"
                    onClick={() => navigate(l.hash)}
                  >
                    <l.icon className="size-4 text-emerald-600 dark:text-emerald-400" />
                    {l.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <div className={cn('grid gap-6 lg:grid-cols-[1fr_320px]', connected && 'opacity-95')}>
        {/* اتصال سریع */}
        <Card>
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-black text-foreground">
                <Plug className="size-5 text-emerald-600 dark:text-emerald-400" />
                اتصال سریع
              </h2>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-muted-foreground"
                onClick={() => setForm(EMPTY_FORM)}
              >
                <RefreshCw className="size-3.5" />
                پاک‌کردن
              </Button>
            </div>

            {connected && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-[12px] leading-6 text-amber-700 dark:text-amber-300">
                برای اتصال جدید ابتدا نشست فعلی را قطع کنید.
              </p>
            )}

            <ConnectionFields value={form} onChange={patchForm} showName showSaveSecret />

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="h-12 flex-1 gap-2 rounded-xl bg-emerald-600 text-base font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
                disabled={busy || connecting || connected}
                onClick={() => void connectQuick()}
              >
                {busy || connecting ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <PlugZap className="size-5" />
                )}
                اتصال
              </Button>
              <Button
                variant="outline"
                className="h-12 gap-2 rounded-xl px-5 font-bold"
                disabled={busy}
                onClick={() => void saveQuickProfile()}
              >
                <Plus className="size-4" />
                ذخیرهٔ پروفایل
              </Button>
            </div>
            <p className="text-[11px] leading-5 text-muted-foreground">
              با «ذخیرهٔ پروفایل» تنظیمات برای دفعات بعد نگه داشته می‌شود؛ گزینهٔ
              «ذخیرهٔ امن» رمز را هم در مخزن اسرار سرویس مدیریت (نه مرورگر)
              نگه می‌دارد.
            </p>
          </CardContent>
        </Card>

        {/* سرور آزمایشی */}
        <div className="space-y-6">
          <Card className="border-emerald-500/30 bg-gradient-to-b from-emerald-500/[0.07] to-transparent">
            <CardContent className="space-y-3 p-5">
              <div className="flex items-center gap-2">
                <FlaskConical className="size-5 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-black text-foreground">سرور آزمایشی داخلی</h2>
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" variant="secondary">
                  آموزشی
                </Badge>
              </div>
              <p className="font-mono text-[13px] text-muted-foreground" dir="ltr">
                127.0.0.1:2222 · z
              </p>
              <p className="text-[12px] leading-6 text-muted-foreground">
                سرور SSH آزمایشی همین محیط با headscale واقعی — برای یادگیری جریان
                اتصال و تأیید اثرانگشت، بدون دست‌زدن به سرور واقعی شما.
              </p>
              <Button
                variant="outline"
                className="h-11 w-full gap-2 rounded-xl font-bold"
                onClick={() => {
                  setForm(DEMO_FORM)
                  toast.info('فرم با سرور آزمایشی پر شد.', {
                    description: 'دکمهٔ «اتصال» را بزنید تا جریان تأیید اثرانگشت را ببینید.',
                  })
                }}
              >
                <FlaskConical className="size-4" />
                پرکردن فرم با این سرور
              </Button>
            </CardContent>
          </Card>

          {/* وضعیت agent */}
          <AgentHealthCard />
        </div>
      </div>

      {/* پروفایل‌ها */}
      <section className="mt-10" aria-label="پروفایل‌های ذخیره‌شده">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <User className="size-5 text-emerald-600 dark:text-emerald-400" />
            پروفایل‌های ذخیره‌شده
            {profiles.length > 0 && (
              <Badge variant="secondary" className="px-2">
                {profiles.length.toLocaleString('fa-IR')}
              </Badge>
            )}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 gap-1.5 text-muted-foreground"
            onClick={() => void profilesQuery.refetch()}
            aria-label="بازآوری فهرست پروفایل‌ها"
          >
            <RefreshCw className={cn('size-3.5', profilesQuery.isFetching && 'animate-spin')} />
            بازآوری
          </Button>
        </div>

        {profilesQuery.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        ) : profilesQuery.isError ? (
          <Card className="border-red-500/40">
            <CardContent className="flex flex-col items-start gap-3 p-5">
              <p className="text-sm font-bold text-red-600 dark:text-red-400">
                دریافت فهرست پروفایل‌ها از سرویس مدیریت ناموفق بود.
              </p>
              <p className="text-[12px] leading-6 text-muted-foreground">
                {profilesQuery.error instanceof Error
                  ? profilesQuery.error.message
                  : 'خطای نامشخص.'}
              </p>
              <Button variant="outline" className="h-11 gap-2 rounded-xl" onClick={() => void profilesQuery.refetch()}>
                <RefreshCw className="size-4" />
                تلاش مجدد
              </Button>
            </CardContent>
          </Card>
        ) : profiles.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              <User className="size-8 text-muted-foreground/60" />
              <p className="text-sm font-bold text-foreground">هنوز پروفایلی ذخیره نشده است</p>
              <p className="max-w-md text-[12px] leading-6 text-muted-foreground">
                فرم «اتصال سریع» را پر کنید و «ذخیرهٔ پروفایل» را بزنید تا
                تنظیمات سرورتان برای دفعات بعد این‌جا ذخیره شود.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {profiles.map((p) => (
              <ProfileCard
                key={p.id}
                profile={p}
                busy={busy}
                disabled={connected || connecting}
                onConnect={() => void connectProfile(p)}
                onEdit={() => setEditTarget(p)}
                onDelete={() => setDeleteTarget(p)}
              />
            ))}
          </div>
        )}
      </section>

      {/* تأیید قطع اتصال از کارت نشست */}
      <AlertDialog open={sessionDisconnectOpen} onOpenChange={setSessionDisconnectOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="size-5 text-red-500" />
              قطع اتصال از سرور؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              نشست SSH فعلی با{' '}
              <span className="font-mono" dir="ltr">
                {username}@{host}
              </span>{' '}
              بسته می‌شود. سرور و سرویس Headscale شما دست‌نخورده باقی می‌ماند و هر
              وقت بخواهید می‌توانید دوباره وصل شوید.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={(e) => {
                e.preventDefault()
                setSessionDisconnectOpen(false)
                void disconnect().then(() => toast.success('اتصال قطع شد.'))
              }}
            >
              <Unplug className="size-4" />
              بله، قطع کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* دیالوگ تأیید اثرانگشت */}
      {status === 'fingerprint-required' && fingerprint && host && (
        <FingerprintDialog
          fingerprint={fingerprint}
          host={`${host}:${port ?? 22}`}
          busy={confirmBusy}
          onAccept={() => void confirmFingerprint(true)}
          onDecline={() => void confirmFingerprint(false)}
        />
      )}

      {/* دیالوگ رمز پروفایل بدون راز ذخیره‌شده */}
      <Dialog open={secretTarget !== null} onOpenChange={(o) => !o && setSecretTarget(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-amber-500" />
              {secretTarget?.authMethod === 'key' ? 'passphrase کلید' : 'رمز عبور'} پروفایل
              «{secretTarget?.name}»
            </DialogTitle>
            <DialogDescription className="leading-7">
              این پروفایل راز ذخیره‌شده ندارد. برای همین اتصال{' '}
              {secretTarget?.authMethod === 'key' ? 'passphrase کلید' : 'رمز عبور'} را وارد
              کنید. مقدار در مرورگر ذخیره نمی‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              className="h-11"
              dir="ltr"
              autoComplete="new-password"
              placeholder={secretTarget?.authMethod === 'key' ? 'passphrase' : '••••••••'}
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              aria-label="مقدار راز"
            />
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
              <Checkbox
                id="secret-save"
                className="mt-0.5"
                checked={secretSave}
                onCheckedChange={(c) => setSecretSave(c === true)}
              />
              <label htmlFor="secret-save" className="cursor-pointer text-[12px] leading-6 text-muted-foreground">
                ذخیرهٔ امن در سرویس مدیریت (مخزن اسرار همان ماشین — پیش‌فرض خاموش)
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button
              className="h-11 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950"
              disabled={!secretValue}
              onClick={() => void connectWithSecret()}
            >
              <PlugZap className="size-4" />
              اتصال
            </Button>
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setSecretTarget(null)}>
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ ویرایش پروفایل */}
      <EditProfileDialog
        profile={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={async () => {
          await qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX, 'profiles'] })
        }}
      />

      {/* تأیید حذف پروفایل */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5 text-red-500" />
              حذف پروفایل «{deleteTarget?.name}»؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              تنظیمات اتصال به{' '}
              <span className="font-mono" dir="ltr">
                {deleteTarget?.host}:{deleteTarget?.port}
              </span>{' '}
              و راز ذخیره‌شدهٔ آن (در صورت وجود) حذف می‌شود. این عمل روی خودِ سرور
              اثری ندارد و با «ذخیرهٔ پروفایل» دوباره قابل ساخت است.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-500"
              onClick={(e) => {
                e.preventDefault()
                if (deleteTarget) void deleteProfile(deleteTarget)
              }}
            >
              حذف کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// کارت پروفایل
// ---------------------------------------------------------------------------

function ProfileCard({
  profile,
  busy,
  disabled,
  onConnect,
  onEdit,
  onDelete,
}: {
  profile: Profile
  busy: boolean
  disabled: boolean
  onConnect: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card className="group bg-card/70 transition-all hover:border-emerald-500/40">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-foreground">{profile.name}</h3>
            <p className="mt-1 truncate font-mono text-[12px] text-muted-foreground" dir="ltr">
              {profile.username}@{profile.host}:{profile.port}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'shrink-0 gap-1 px-2 py-1 text-[11px]',
              profile.authMethod === 'key'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            )}
          >
            {profile.authMethod === 'key' ? <KeyRound className="size-3" /> : <Lock className="size-3" />}
            {profile.authMethod === 'key' ? 'کلید' : 'رمز'}
          </Badge>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {HS_MODE_LABELS[profile.hsMode]}
          {profile.hsMode === 'custom' && profile.hsCustomPrefix ? (
            <span className="mt-1 block truncate font-mono text-[10px] opacity-70" dir="ltr">
              {profile.hsCustomPrefix}
            </span>
          ) : null}
        </p>
        <div className="flex gap-2 pt-1">
          <Button
            className="h-11 flex-1 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            disabled={busy || disabled}
            onClick={onConnect}
          >
            <PlugZap className="size-4" />
            اتصال
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0"
            aria-label={`ویرایش پروفایل ${profile.name}`}
            onClick={onEdit}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-11 shrink-0 text-muted-foreground hover:border-red-500/40 hover:text-red-500"
            aria-label={`حذف پروفایل ${profile.name}`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ویرایش پروفایل
// ---------------------------------------------------------------------------

function EditProfileDialog({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState<QuickForm>(EMPTY_FORM)
  const [removeSecret, setRemoveSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  // هنگام باز شدن دیالوگ، فرم با مقادیر پروفایل پر می‌شود
  if (profile && loadedFor !== profile.id) {
    setLoadedFor(profile.id)
    setForm({
      name: profile.name,
      host: profile.host,
      port: String(profile.port),
      username: profile.username,
      authMethod: profile.authMethod,
      password: '',
      keyPath: profile.keyPath ?? '',
      passphrase: '',
      hsMode: profile.hsMode,
      hsCustomPrefix: profile.hsCustomPrefix ?? '',
      saveSecret: false,
    })
    setRemoveSecret(false)
  }
  // بستن دیالوگ → ریست
  if (!profile && loadedFor !== null) {
    setLoadedFor(null)
  }

  const patch = (p: Partial<QuickForm>) => setForm((f) => ({ ...f, ...p }))

  const save = async () => {
    if (!profile) return
    if (!form.name.trim() || !form.host.trim() || !form.username.trim()) {
      toast.warning('نام، آدرس سرور و نام کاربری الزامی است.')
      return
    }
    setBusy(true)
    try {
      // مثل ساخت پروفایل: رمز جدید فقط با «ذخیرهٔ امن» فرستاده می‌شود؛
      // بدون آن، راز فعلی دست‌نخورده می‌ماند و اتصال در صورت نیاز می‌پرسد.
      const newSecret = form.saveSecret
        ? form.authMethod === 'password'
          ? form.password
          : form.passphrase
        : ''
      await agentPut(`/api/profiles/${profile.id}`, {
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number.parseInt(form.port, 10) || 22,
        username: form.username.trim(),
        authMethod: form.authMethod,
        ...(form.authMethod === 'key' ? { keyPath: form.keyPath.trim() } : {}),
        hsMode: form.hsMode,
        ...(form.hsMode === 'custom' && form.hsCustomPrefix.trim()
          ? { hsCustomPrefix: form.hsCustomPrefix.trim() }
          : {}),
        ...(removeSecret
          ? { secret: '' }
          : newSecret
            ? { secret: newSecret, saveSecret: true }
            : {}),
      })
      toast.success(`پروفایل «${form.name.trim()}» به‌روزرسانی شد.`)
      await onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'به‌روزرسانی پروفایل ناموفق بود.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={profile !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-h-[85vh] max-w-2xl overflow-y-auto custom-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-5 text-emerald-600 dark:text-emerald-400" />
            ویرایش پروفایل «{profile?.name}»
          </DialogTitle>
          <DialogDescription>
            فیلد رمز خالی بماند یعنی راز فعلی (در صورت ذخیره) دست‌نخورده می‌ماند.
          </DialogDescription>
        </DialogHeader>
        <ConnectionFields value={form} onChange={patch} showName showSaveSecret />
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-3">
          <Checkbox
            id="remove-secret"
            className="mt-0.5"
            checked={removeSecret}
            onCheckedChange={(c) => setRemoveSecret(c === true)}
          />
          <label htmlFor="remove-secret" className="cursor-pointer text-[12px] leading-6 text-muted-foreground">
            حذف راز ذخیره‌شده از سرویس مدیریت (اتصال بعدی دوباره رمز می‌خواهد)
          </label>
        </div>
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            className="h-11 gap-2 rounded-xl bg-emerald-600 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />}
            ذخیرهٔ تغییرات
          </Button>
          <Button variant="outline" className="h-11 rounded-xl" onClick={onClose}>
            انصراف
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// سلامت سرویس مدیریت (agent)
// ---------------------------------------------------------------------------

function AgentHealthCard() {
  const q = useQuery({
    queryKey: [AGENT_QUERY_PREFIX, 'health'],
    queryFn: () => agentGet<AgentHealth>('/api/health'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  return (
    <Card className="border-border/70 bg-card/50">
      <CardContent className="space-y-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-black text-foreground">سرویس مدیریت (hem-agent)</h2>
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5 px-2 py-1 text-[11px]',
              q.isError
                ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
            )}
          >
            {q.isError ? 'در دسترس نیست' : 'فعال'}
          </Badge>
        </div>
        {q.data ? (
          <p className="text-[12px] leading-6 text-muted-foreground">
            نسخهٔ {q.data.version} · پلتفرم {q.data.platform} ·{' '}
            {q.data.sessions.toLocaleString('fa-IR')} نشست فعال
          </p>
        ) : (
          <p className="text-[12px] text-muted-foreground">
            {q.isLoading ? 'در حال بررسی…' : 'وضعیت در دسترس نیست.'}
          </p>
        )}
        <p className="text-[11px] leading-5 text-muted-foreground">
          همین سرویس روی سیستم شما اجرا می‌شود و دستورات را از طریق SSH به سرور
          می‌برد.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ثابت‌های راهنما
// ---------------------------------------------------------------------------

const ERR_HELP: Record<string, string> = {
  AUTH_FAILED:
    'رمز/کلید رد شد. رمز را دوباره وارد کنید؛ اگر با کلید وصل می‌شوید مطمئن شوید مسیر فایل درست است و کلید به سرور اضافه شده.',
  CONNECT_TIMEOUT:
    'سرور در مهلت ۱۵ ثانیه پاسخ نداد — آدرس و پورت، فایروال سرور و در دسترس بودن سرویس SSH را بررسی کنید.',
  CONNECT_FAILED:
    'اتصال شبکه‌ای برقرار نشد. آدرس/پورت، DNS و اینترنت ماشین خود را بررسی کنید.',
  VALIDATION_FAILED: 'ورودی‌های فرم را کامل و درست پر کنید (آدرس، نام کاربری، رمز/کلید).',
  AGENT_UNREACHABLE:
    'سرویس مدیریت محلی (hem-agent) پاسخ نمی‌دهد. اگر برنامهٔ دسکتاپ را بسته‌اید، دوباره اجرایش کنید.',
}

const SUDO_LABELS: Record<string, string> = {
  root: 'دسترسی root',
  nopasswd: 'sudo بدون رمز',
  password: 'sudo با رمز',
  none: 'بدون sudo',
}

const QUICK_LINKS: { hash: string; label: string; icon: React.ElementType }[] = [
  { hash: '#/', label: 'داشبورد', icon: PlugZap },
  { hash: '#/users', label: 'مدیریت کاربران', icon: User },
  { hash: '#/keys', label: 'کلیدها', icon: KeyRound },
  { hash: '#/install', label: 'نصب Headscale', icon: Terminal },
]
