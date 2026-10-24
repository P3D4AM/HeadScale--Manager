'use client'

/**
 * #/keys — کلیدهای اتصال (PreAuthKey) و کلیدهای API.
 * کلید کامل فقط یک‌بار (لحظهٔ ساخت) از سرور می‌آید و در کارت امن نمایش
 * داده می‌شود؛ هرگز لاگ نمی‌شود و بعد از بستن دیگر در دسترس نیست.
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Ban,
  BookOpenCheck,
  KeyRound,
  Loader2,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { AgentError } from '@/lib/agent'
import type { HsPreAuthKey, HsUser } from '@/lib/agent'
import { navigate } from '@/lib/nav'
import { AGENT_QUERY_PREFIX, useSessionDataQuery, useSessionId } from '../use-agent'
import {
  APIKEY_EXPIRATION_PRESETS,
  EXPIRATION_CUSTOM_HELP,
  EXPIRATION_PATTERN,
  EXPIRATION_PRESETS,
  formatDateTimeFa,
  isPast,
  TAG_PATTERN,
  TAG_SYNTAX_HELP,
} from '@/lib/manage/format'
import {
  agentErrText,
  hsApiKeyCreate,
  hsApiKeyExpire,
  hsPreAuthKeyCreate,
  hsPreAuthKeyDelete,
  hsPreAuthKeyExpire,
  keyUserName,
  type ApiKeyCreateResult,
  type HsApiKey,
  type PreAuthKeyCreateResult,
} from '@/lib/manage/api'
import { SectionShell } from '../manage/section-shell'
import { EmptyState, ErrorState, TableSkeleton } from '../manage/data-state'
import { ConfirmActionDialog } from '../manage/typed-confirm-dialog'
import { KeyRevealCard } from '../manage/key-reveal-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export function KeysSection() {
  return (
    <SectionShell
      icon={KeyRound}
      title="کلیدهای احراز هویت"
      description="کلید اتصال (PreAuthKey) برای عضوکردن دستگاه‌ها به شبکه است و کلید API برای دسترسی برنامه‌ها به سرور — کلید کامل هر کدام فقط یک‌بار، همان لحظهٔ ساخت نمایش داده می‌شود."
    >
      <KeysManager />
    </SectionShell>
  )
}

function KeysManager() {
  return (
    <Tabs defaultValue="preauth" className="w-full">
      <TabsList className="h-12 w-full max-w-xl rounded-xl p-1">
        <TabsTrigger value="preauth" className="min-h-10 flex-1 gap-2 rounded-lg text-[13px] font-bold">
          <MonitorSmartphone className="size-4" />
          کلیدهای اتصال (PreAuth)
        </TabsTrigger>
        <TabsTrigger value="api" className="min-h-10 flex-1 gap-2 rounded-lg text-[13px] font-bold">
          <ShieldCheck className="size-4" />
          کلیدهای API
        </TabsTrigger>
      </TabsList>
      <TabsContent value="preauth" className="mt-5">
        <PreAuthKeysTab />
      </TabsContent>
      <TabsContent value="api" className="mt-5">
        <ApiKeysTab />
      </TabsContent>
    </Tabs>
  )
}

// ---------------------------------------------------------------------------
// تب کلیدهای اتصال
// ---------------------------------------------------------------------------

function PreAuthKeysTab() {
  const sid = useSessionId()
  const qc = useQueryClient()
  const keys = useSessionDataQuery<HsPreAuthKey[]>(['hs', 'preauthkeys'], 'hs/preauthkeys', {
    staleTime: 30_000,
  })
  const users = useSessionDataQuery<HsUser[]>(['hs', 'users'], 'hs/users', { staleTime: 60_000 })

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])

  const [createOpen, setCreateOpen] = useState(false)
  const [expireTarget, setExpireTarget] = useState<HsPreAuthKey | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HsPreAuthKey | null>(null)

  // ── فرم ساخت ──
  const [userId, setUserId] = useState<string>('')
  const [expiration, setExpiration] = useState<string>('24h')
  const [customExpiration, setCustomExpiration] = useState('')
  const [reusable, setReusable] = useState(false)
  const [ephemeral, setEphemeral] = useState(false)
  const [tagsInput, setTagsInput] = useState('')

  const usersList = useMemo(() => users.data ?? [], [users.data])
  const selectedUser = usersList.find((u) => String(u.id) === userId)
  const tags = useMemo(
    () =>
      tagsInput
        .split(/[,،]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [tagsInput]
  )
  const tagsValid = tags.every((t) => TAG_PATTERN.test(t))
  const isCustom = expiration === 'custom'
  const customValid = EXPIRATION_PATTERN.test(customExpiration.trim())
  const formValid = !!selectedUser && tagsValid && (!isCustom || customValid)

  // ── نتیجهٔ ساخت: کلید کامل فقط یک‌بار ──
  const [createdKey, setCreatedKey] = useState<PreAuthKeyCreateResult | null>(null)

  const createMut = useMutation({
    mutationFn: async () => {
      if (!sid) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد؛ ابتدا متصل شوید.')
      return hsPreAuthKeyCreate(sid, {
        userId: Number(userId),
        reusable,
        ephemeral,
        expiration: isCustom ? customExpiration.trim() : expiration,
        tags,
      })
    },
    onSuccess: (res) => {
      // ⚠️ کلید فقط در state برای نمایش یک‌باره می‌ماند؛ لاگ/توست نمی‌شود.
      setCreatedKey(res.data)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  const expireMut = useMutation({
    mutationFn: async () => {
      if (!sid || !expireTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsPreAuthKeyExpire(sid, expireTarget.id)
    },
    onSuccess: () => {
      toast.success(`کلید #${expireTarget?.id.toLocaleString('fa-IR')} باطل شد — دیگر قابل استفاده نیست.`)
      setExpireTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!sid || !deleteTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsPreAuthKeyDelete(sid, deleteTarget.id)
    },
    onSuccess: () => {
      toast.success(`کلید #${deleteTarget?.id.toLocaleString('fa-IR')} از فهرست سرور حذف شد.`)
      setDeleteTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  function closeCreate() {
    setCreateOpen(false)
    setCreatedKey(null)
    setTagsInput('')
  }

  const list = useMemo(() => keys.data ?? [], [keys.data])
  const now = new Date()

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-6 text-muted-foreground">
          {keys.isLoading
            ? 'در حال خواندن کلیدهای اتصال از سرور…'
            : list.length > 0
              ? `${list.length.toLocaleString('fa-IR')} کلید اتصال روی سرور موجود است (مقادیر ماسک‌شده).`
              : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-11 gap-2 rounded-xl font-bold"
            onClick={() => {
              void keys.refetch()
              toast.success('بازآوری فهرست کلیدها…')
            }}
          >
            <RefreshCw className={keys.isFetching ? 'size-4 animate-spin' : 'size-4'} />
            بازآوری
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <Plus className="size-4" />
            کلید اتصال جدید
          </Button>
        </div>
      </div>

      {keys.isLoading ? (
        <TableSkeleton cols={6} rows={4} />
      ) : keys.error ? (
        <ErrorState
          title="خواندن کلیدهای اتصال از سرور ناموفق بود"
          error={keys.error}
          onRetry={() => void keys.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone className="size-7" />}
          title="هنوز کلید اتصالی ساخته نشده است"
          body={
            <>
              کلید اتصال (PreAuthKey) مثل «بلیت عضویت یک‌بارمصرف» است: آن را می‌سازید،
              به دستگاه موردنظر می‌دهید و دستگاه هنگام اتصال به سرور، همین کلید را
              به‌جای تأیید دستی وارد می‌کند. برای عضوکردن اولین گوشی/لپ‌تاپ، از
              دکمهٔ روبه‌رو یک کلید بسازید.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => setCreateOpen(true)}
                className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              >
                <KeyRound className="size-5" />
                ساخت کلید اتصال
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('#/learn/5')}
                className="h-12 gap-2 rounded-xl px-6 font-bold"
              >
                <BookOpenCheck className="size-5" />
                آموزش عضوکردن دستگاه (فصل ۵)
              </Button>
            </>
          }
        />
      ) : (
        <Card className="bg-card/70 py-0">
          <CardContent className="p-0">
            <div className="custom-scrollbar max-h-96 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-14 text-start">شناسه</TableHead>
                    <TableHead className="text-start">کاربر</TableHead>
                    <TableHead className="text-start">نوع / وضعیت</TableHead>
                    <TableHead className="text-start">انقضا</TableHead>
                    <TableHead className="text-start">تاریخ ساخت</TableHead>
                    <TableHead className="text-start">کلید</TableHead>
                    <TableHead className="w-28 text-start">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((k) => {
                    const expired = isPast(k.expiration ?? null, now)
                    return (
                      <TableRow key={k.id}>
                        <TableCell className="font-mono text-muted-foreground" dir="ltr">
                          {k.id}
                        </TableCell>
                        <TableCell className="text-[13px] font-bold">{keyUserName(k.user)}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {k.reusable ? (
                              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                قابل استفادهٔ مجدد
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="px-2 py-0.5 text-[10px] text-muted-foreground">
                                یک‌بارمصرف
                              </Badge>
                            )}
                            {k.ephemeral ? (
                              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                                موقت (ephemeral)
                              </Badge>
                            ) : null}
                            {expired ? (
                              <Badge variant="outline" className="border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                                منقضی‌شده
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          <span className={expired ? 'font-bold text-red-600 dark:text-red-400' : ''}>
                            {formatDateTimeFa(k.expiration)}
                          </span>
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {formatDateTimeFa(k.createdAt)}
                        </TableCell>
                        <TableCell>
                          <code dir="ltr" className="select-all font-mono text-[11px] text-muted-foreground">
                            {k.key}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 rounded-xl text-amber-600 hover:text-amber-500 dark:text-amber-400"
                              aria-label={`ابطال کلید ${k.id}`}
                              title="ابطال (دیگر قابل استفاده نباشد)"
                              disabled={expired}
                              onClick={() => setExpireTarget(k)}
                            >
                              <Ban className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 rounded-xl text-red-600 hover:text-red-500 dark:text-red-400"
                              aria-label={`حذف کلید ${k.id}`}
                              title="حذف از فهرست"
                              onClick={() => setDeleteTarget(k)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* دیالوگ ساخت کلید اتصال + نمایش امن نتیجه */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          // هنگام نمایش کلید کامل، بستن با کلیک بیرون ممنوع است (کلید گم می‌شود)
          if (createdKey) return
          if (!createMut.isPending) setCreateOpen(o)
        }}
      >
        <DialogContent className="max-w-xl">
          {createdKey ? (
            <>
              <DialogHeader className="text-start">
                <DialogTitle>کلید اتصال ساخته شد</DialogTitle>
                <DialogDescription className="text-start leading-7">
                  کلید زیر برای کاربر{' '}
                  <strong>{keyUserName({ name: selectedUser?.name })}</strong> ساخته
                  شد{' '}
                  {createdKey.tags.length > 0
                    ? `با برچسب‌های ${createdKey.tags.join('، ')}`
                    : ''}
                  . هنگام اتصال دستگاه، این کلید را وارد کنید یا در انتهای دستور
                  اتصال بیاورید (راهنمای کامل: فصل ۵ آموزش).
                </DialogDescription>
              </DialogHeader>
              <KeyRevealCard label="کلید اتصال (PreAuthKey)" value={createdKey.key} />
              <DialogFooter className="flex-row sm:justify-start">
                <Button className="h-11 min-w-40 gap-2 rounded-xl font-bold" onClick={closeCreate}>
                  بستم؛ کلید را در جای امن ذخیره کردم
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader className="text-start">
                <DialogTitle>ساخت کلید اتصال جدید</DialogTitle>
                <DialogDescription className="text-start leading-7">
                  کلید اتصال مثل «بلیت عضویت» است: دستگاه هنگام ثبت‌نام آن را وارد
                  می‌کند و بدون تأیید دستی وارد شبکه می‌شود.
                </DialogDescription>
              </DialogHeader>

              {usersList.length === 0 ? (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4 text-[13px] leading-7 text-amber-800 dark:text-amber-200">
                  برای ساخت کلید اتصال، اول باید حداقل یک کاربر وجود داشته باشد —
                  فعلاً هیچ کاربری روی سرور نیست. از بخش «کاربران» یک کاربر بسازید.
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      className="h-11 gap-2 rounded-xl font-bold"
                      onClick={() => {
                        closeCreate()
                        navigate('#/users')
                      }}
                    >
                      رفتن به بخش کاربران
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* کاربر */}
                  <div className="space-y-2">
                    <Label className="text-[13px] font-bold">برای کدام کاربر؟</Label>
                    <Select value={userId} onValueChange={setUserId}>
                      <SelectTrigger className="h-11 w-full rounded-xl text-start" aria-label="انتخاب کاربر">
                        <SelectValue placeholder="یک کاربر انتخاب کنید" />
                      </SelectTrigger>
                      <SelectContent>
                        {usersList.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)} className="min-h-11">
                            <span dir="ltr" className="font-mono">
                              {u.name}
                            </span>
                            <span className="ms-2 text-muted-foreground">#{u.id.toLocaleString('fa-IR')}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* انقضا */}
                  <div className="space-y-2">
                    <Label className="text-[13px] font-bold">انقضای کلید</Label>
                    <Select value={expiration} onValueChange={setExpiration}>
                      <SelectTrigger className="h-11 w-full rounded-xl text-start" aria-label="انقضای کلید">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EXPIRATION_PRESETS.map((p) => (
                          <SelectItem key={p.value} value={p.value} className="min-h-11">
                            {p.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom" className="min-h-11">
                          سفارشی…
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {isCustom ? (
                      <div className="space-y-1.5">
                        <Input
                          dir="ltr"
                          className="h-11 rounded-xl font-mono text-start"
                          placeholder="مثلاً 45m یا 14d"
                          value={customExpiration}
                          onChange={(e) => setCustomExpiration(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <p className="text-[11px] leading-6 text-muted-foreground">{EXPIRATION_CUSTOM_HELP}</p>
                        {customExpiration.length > 0 && !customValid ? (
                          <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                            قالب انقضا معتبر نیست.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {/* گزینه‌ها */}
                  <div className="space-y-3 rounded-xl border bg-muted/30 p-3.5">
                    <label className="flex cursor-pointer items-start justify-between gap-3" htmlFor="sw-reusable">
                      <span className="text-[13px] leading-6">
                        <strong>قابل استفادهٔ مجدد (reusable)</strong>
                        <br />
                        <span className="text-muted-foreground">
                          بدون این گزینه، کلید فقط برای عضوکردن یک دستگاه کار می‌کند و
                          بعد از اولین استفاده صرف می‌شود. با فعال‌کردنش می‌توانید
                          با همان کلید چند دستگاه عضو کنید.
                        </span>
                      </span>
                      <Switch id="sw-reusable" checked={reusable} onCheckedChange={setReusable} className="mt-1" />
                    </label>
                    <label className="flex cursor-pointer items-start justify-between gap-3" htmlFor="sw-ephemeral">
                      <span className="text-[13px] leading-6">
                        <strong>دستگاه موقت (ephemeral)</strong>
                        <br />
                        <span className="text-muted-foreground">
                          مناسب دستگاه‌هایی که بعداً خودکار حذف می‌شوند (مثل کانتینرهای
                          آزمایشی): با قطع‌شدن اتصال، دستگاه بعد از مدتی از فهرست
                          سرور پاک می‌شود.
                        </span>
                      </span>
                      <Switch id="sw-ephemeral" checked={ephemeral} onCheckedChange={setEphemeral} className="mt-1" />
                    </label>
                  </div>

                  {/* برچسب‌ها */}
                  <div className="space-y-2">
                    <Label htmlFor="key-tags" className="text-[13px] font-bold">
                      برچسب‌های خودکار (اختیاری)
                    </Label>
                    <Input
                      id="key-tags"
                      dir="ltr"
                      className="h-11 rounded-xl font-mono text-start"
                      placeholder="tag:office, tag:cctv"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={createMut.isPending}
                    />
                    <p className="text-[11px] leading-6 text-muted-foreground">
                      {TAG_SYNTAX_HELP} دستگاهی که با این کلید عضو شود، این برچسب‌ها را می‌گیرد.
                    </p>
                    {tags.length > 0 && !tagsValid ? (
                      <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                        حداقل یک برچسب قالب «tag:name» را رعایت نمی‌کند.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}

              <DialogFooter className="flex-row gap-2 sm:justify-start">
                <Button
                  className="h-11 min-w-32 gap-2 rounded-xl font-bold"
                  disabled={!formValid || usersList.length === 0 || createMut.isPending}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  ساخت کلید
                </Button>
                <Button
                  variant="outline"
                  className="h-11 min-w-24 rounded-xl font-bold"
                  disabled={createMut.isPending}
                  onClick={closeCreate}
                >
                  انصراف
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* تأیید ابطال */}
      <ConfirmActionDialog
        open={expireTarget !== null}
        onOpenChange={(o) => (expireMut.isPending ? undefined : o ? undefined : setExpireTarget(null))}
        title="ابطال کلید اتصال"
        description={
          <>
            کلید{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
              {expireTarget?.key}
            </code>{' '}
            (شناسهٔ {expireTarget?.id.toLocaleString('fa-IR') ?? '—'}، کاربر{' '}
            {expireTarget ? keyUserName(expireTarget.user) : '—'}) باطل می‌شود؛ دستگاهی
            که هنوز عضو نشده، دیگر نمی‌تواند با این کلید وارد شود. دستگاه‌هایی که
            قبلاً عضو شده‌اند، متأثر نمی‌شوند.
          </>
        }
        confirmLabel="بله، باطل کن"
        tone="warning"
        onConfirm={() => expireMut.mutate()}
        pending={expireMut.isPending}
      />

      {/* تأیید حذف */}
      <ConfirmActionDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => (deleteMut.isPending ? undefined : o ? undefined : setDeleteTarget(null))}
        title="حذف کلید از فهرست سرور"
        description={
          <>
            کلید{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
              {deleteTarget?.key}
            </code>{' '}
            (شناسهٔ {deleteTarget?.id.toLocaleString('fa-IR') ?? '—'}) از پایگاه‌دادهٔ
            سرور حذف می‌شود. اگر هنوز استفاده نشده، دیگر قابل استفاده نخواهد بود.
          </>
        }
        confirmLabel="بله، حذف کن"
        tone="destructive"
        onConfirm={() => deleteMut.mutate()}
        pending={deleteMut.isPending}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// تب کلیدهای API
// ---------------------------------------------------------------------------

function ApiKeysTab() {
  const sid = useSessionId()
  const qc = useQueryClient()
  const keys = useSessionDataQuery<HsApiKey[]>(['hs', 'apikeys'], 'hs/apikeys', { staleTime: 30_000 })

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])

  const [createOpen, setCreateOpen] = useState(false)
  const [expireTarget, setExpireTarget] = useState<HsApiKey | null>(null)

  const [expiration, setExpiration] = useState('90d')
  const [customExpiration, setCustomExpiration] = useState('')
  const isCustom = expiration === 'custom'
  const customValid = EXPIRATION_PATTERN.test(customExpiration.trim())
  const formValid = !isCustom || customValid

  const [createdKey, setCreatedKey] = useState<ApiKeyCreateResult | null>(null)

  const createMut = useMutation({
    mutationFn: async () => {
      if (!sid) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد؛ ابتدا متصل شوید.')
      return hsApiKeyCreate(sid, isCustom ? customExpiration.trim() : expiration)
    },
    onSuccess: (res) => {
      setCreatedKey(res.data)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  const expireMut = useMutation({
    mutationFn: async () => {
      if (!sid || !expireTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsApiKeyExpire(sid, expireTarget.prefix.replace(/\*+$/, '').trim())
    },
    onSuccess: () => {
      toast.success('کلید API باطل شد — برنامه‌هایی که با آن وصل بودند قطع می‌شوند.')
      setExpireTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  function closeCreate() {
    setCreateOpen(false)
    setCreatedKey(null)
  }

  const list = useMemo(() => keys.data ?? [], [keys.data])
  const now = new Date()

  return (
    <div className="space-y-5">
      <Card className="border-border/70 bg-muted/30">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="text-[13px] leading-7 text-foreground/90">
            <p className="font-bold text-foreground">کلید API چه فرقی دارد؟</p>
            <p className="mt-1.5">
              کلید API برای <strong>برنامه‌ها و اسکریپت‌ها</strong> است (مثلاً اتوماسیون
              یا داشبورد دیگر) تا بدون SSH با API سرور headscale کار کنند — نه برای
              عضوکردن دستگاه. اگر فقط می‌خواهید گوشی/لپ‌تاپی را عضو کنید، از تب
              «کلیدهای اتصال» استفاده کنید.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-6 text-muted-foreground">
          {keys.isLoading
            ? 'در حال خواندن کلیدهای API از سرور…'
            : list.length > 0
              ? `${list.length.toLocaleString('fa-IR')} کلید API روی سرور موجود است (پیشوندهای ماسک‌شده).`
              : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-11 gap-2 rounded-xl font-bold"
            onClick={() => {
              void keys.refetch()
              toast.success('بازآوری فهرست کلیدهای API…')
            }}
          >
            <RefreshCw className={keys.isFetching ? 'size-4 animate-spin' : 'size-4'} />
            بازآوری
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <Plus className="size-4" />
            کلید API جدید
          </Button>
        </div>
      </div>

      {keys.isLoading ? (
        <TableSkeleton cols={4} rows={3} />
      ) : keys.error ? (
        <ErrorState
          title="خواندن کلیدهای API از سرور ناموفق بود"
          error={keys.error}
          onRetry={() => void keys.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck className="size-7" />}
          title="هنوز کلید API‌ای ساخته نشده است"
          body={
            <>
              کلید API فقط وقتی لازم است که بخواهید یک برنامه/اسکریپت به‌جای شما با
              سرور headscale صحبت کند. برای مدیریت روزمره با همین کنسول، به کلید API
              نیازی ندارید.
            </>
          }
          actions={
            <Button
              onClick={() => setCreateOpen(true)}
              className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
            >
              <ShieldCheck className="size-5" />
              ساخت کلید API
            </Button>
          }
        />
      ) : (
        <Card className="bg-card/70 py-0">
          <CardContent className="p-0">
            <div className="custom-scrollbar max-h-96 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/95 backdrop-blur">
                  <TableRow>
                    <TableHead className="w-14 text-start">شناسه</TableHead>
                    <TableHead className="text-start">پیشوند کلید</TableHead>
                    <TableHead className="text-start">انقضا</TableHead>
                    <TableHead className="text-start">تاریخ ساخت</TableHead>
                    <TableHead className="w-24 text-start">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((k) => {
                    const expired = isPast(k.expiration ?? null, now)
                    return (
                      <TableRow key={k.id}>
                        <TableCell className="font-mono text-muted-foreground" dir="ltr">
                          {k.id}
                        </TableCell>
                        <TableCell>
                          <code dir="ltr" className="select-all font-mono text-[12px]">
                            {k.prefix}
                          </code>
                        </TableCell>
                        <TableCell className="text-[12px]">
                          <span
                            className={
                              expired ? 'font-bold text-red-600 dark:text-red-400' : 'text-muted-foreground'
                            }
                          >
                            {formatDateTimeFa(k.expiration)}
                            {expired ? ' (منقضی‌شده)' : ''}
                          </span>
                        </TableCell>
                        <TableCell className="text-[12px] text-muted-foreground">
                          {formatDateTimeFa(k.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 rounded-xl text-red-600 hover:text-red-500 dark:text-red-400"
                            aria-label={`ابطال کلید API ${k.prefix}`}
                            title="ابطال کلید"
                            disabled={expired}
                            onClick={() => setExpireTarget(k)}
                          >
                            <Ban className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ساخت کلید API */}
      <Dialog
        open={createOpen}
        onOpenChange={(o) => {
          if (createdKey) return
          if (!createMut.isPending) setCreateOpen(o)
        }}
      >
        <DialogContent className="max-w-xl">
          {createdKey ? (
            <>
              <DialogHeader className="text-start">
                <DialogTitle>کلید API ساخته شد</DialogTitle>
                <DialogDescription className="text-start leading-7">
                  این کلید را در برنامه/اسکریپت خود به‌عنوان Bearer Token استفاده
                  کنید. سرور فقط پیشوند آن را به‌خاطر می‌سپارد و بازیابی کاملش
                  ممکن نیست.
                </DialogDescription>
              </DialogHeader>
              <KeyRevealCard label="کلید API" value={createdKey.key} />
              <DialogFooter className="flex-row sm:justify-start">
                <Button className="h-11 min-w-40 gap-2 rounded-xl font-bold" onClick={closeCreate}>
                  بستم؛ کلید را در جای امن ذخیره کردم
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader className="text-start">
                <DialogTitle>ساخت کلید API جدید</DialogTitle>
                <DialogDescription className="text-start leading-7">
                  برای دسترسی برنامه‌ها به API سرور headscale شما. اجازهٔ آن
                  هم‌تراز دسترسی مدیریت است — فقط برای ابزارهای مطمئن بسازید.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label className="text-[13px] font-bold">انقضای کلید</Label>
                <Select value={expiration} onValueChange={setExpiration}>
                  <SelectTrigger className="h-11 w-full rounded-xl text-start" aria-label="انقضای کلید API">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APIKEY_EXPIRATION_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value} className="min-h-11">
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom" className="min-h-11">
                      سفارشی…
                    </SelectItem>
                  </SelectContent>
                </Select>
                {isCustom ? (
                  <div className="space-y-1.5">
                    <Input
                      dir="ltr"
                      className="h-11 rounded-xl font-mono text-start"
                      placeholder="مثلاً 45d"
                      value={customExpiration}
                      onChange={(e) => setCustomExpiration(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <p className="text-[11px] leading-6 text-muted-foreground">{EXPIRATION_CUSTOM_HELP}</p>
                    {customExpiration.length > 0 && !customValid ? (
                      <p className="text-[12px] font-bold text-red-600 dark:text-red-400">قالب انقضا معتبر نیست.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <DialogFooter className="flex-row gap-2 sm:justify-start">
                <Button
                  className="h-11 min-w-32 gap-2 rounded-xl font-bold"
                  disabled={!formValid || createMut.isPending}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  ساخت کلید API
                </Button>
                <Button
                  variant="outline"
                  className="h-11 min-w-24 rounded-xl font-bold"
                  disabled={createMut.isPending}
                  onClick={closeCreate}
                >
                  انصراف
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* تأیید ابطال کلید API روی prefix واقعی */}
      <ConfirmActionDialog
        open={expireTarget !== null}
        onOpenChange={(o) => (expireMut.isPending ? undefined : o ? undefined : setExpireTarget(null))}
        title="ابطال کلید API"
        description={
          <>
            کلید API با پیشوند{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
              {expireTarget?.prefix}
            </code>{' '}
            باطل می‌شود و هر برنامه‌ای که با آن کار می‌کند از لحظهٔ بعد خطای
            احراز هویت می‌گیرد. این کار قابل بازگشت نیست؛ در صورت نیاز باید کلید
            جدید بسازید.
          </>
        }
        confirmLabel="بله، باطل کن"
        tone="destructive"
        onConfirm={() => expireMut.mutate()}
        pending={expireMut.isPending}
      />
    </div>
  )
}
