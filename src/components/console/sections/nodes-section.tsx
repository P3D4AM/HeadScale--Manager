'use client'

/**
 * #/nodes — مدیریت دستگاه‌های متصل به شبکهٔ Headscale (فقط دادهٔ واقعی).
 * وضعیت هر دستگاه از آخرین Seen و انقضای واقعی سرور محاسبه می‌شود؛
 * عملیات منقضی‌کردن/حذف با تأیید صریح و نام واقعی دستگاه انجام می‌شود.
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookOpenCheck, KeyRound, Loader2, MonitorSmartphone, MoreHorizontal, PencilLine, RefreshCw, Tags, TimerOff, Timer, Trash2 } from 'lucide-react'
import { AgentError } from '@/lib/agent'
import type { HsNode } from '@/lib/agent'
import { navigate } from '@/lib/nav'
import { AGENT_QUERY_PREFIX, useSessionDataQuery, useSessionId } from '../use-agent'
import {
  formatDateTimeFa,
  nodeIps,
  nodeLastSeen,
  nodeStatus,
  nodeTags,
  relativeTimeFa,
  TAG_PATTERN,
  TAG_SYNTAX_HELP,
} from '@/lib/manage/format'
import {
  agentErrText,
  hsNodeDelete,
  hsNodeExpire,
  hsNodeRename,
  hsNodeTag,
  nodeUserName,
} from '@/lib/manage/api'
import { SectionShell } from '../manage/section-shell'
import { EmptyState, ErrorState, TableSkeleton } from '../manage/data-state'
import { ConfirmActionDialog, TypedConfirmDialog } from '../manage/typed-confirm-dialog'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function NodesSection() {
  return (
    <SectionShell
      icon={MonitorSmartphone}
      title="مدیریت دستگاه‌ها"
      description="هر گوشی، لپ‌تاپ یا سروری که با کلید اتصال به شبکهٔ شما بپیوندد، اینجا با وضعیت واقعی‌اش (آنلاین/آفلاین/منقضی) فهرست می‌شود."
    >
      <NodesManager />
    </SectionShell>
  )
}

function NodesManager() {
  const sid = useSessionId()
  const qc = useQueryClient()
  const nodes = useSessionDataQuery<HsNode[]>(['hs', 'nodes'], 'hs/nodes', {
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])

  // ── حالت‌های دیالوگ ──
  const [renameTarget, setRenameTarget] = useState<HsNode | null>(null)
  const [tagTarget, setTagTarget] = useState<HsNode | null>(null)
  const [expireTarget, setExpireTarget] = useState<HsNode | null>(null)
  const [expireDisableTarget, setExpireDisableTarget] = useState<HsNode | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HsNode | null>(null)

  // ── تغییر نام ──
  const [renameValue, setRenameValue] = useState('')
  const renameMut = useMutation({
    mutationFn: async () => {
      if (!sid || !renameTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsNodeRename(sid, renameTarget.id, renameValue.trim())
    },
    onSuccess: (res) => {
      toast.success(`نام دستگاه #${res.data.id.toLocaleString('fa-IR')} به «${res.data.newName}» تغییر کرد.`)
      setRenameTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── برچسب‌ها ──
  const [tagValue, setTagValue] = useState('')
  const tagList = useMemo(
    () =>
      tagValue
        .split(/[,،]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [tagValue]
  )
  const tagsValid = tagList.every((t) => TAG_PATTERN.test(t))
  // سرور واقعی 0.29.5 اجازه نمی‌دهد همهٔ برچسب‌های یک دستگاه هم‌زمان پاک شوند
  // («cannot remove all tags» — با باینری واقعی تست شد)؛ فهرست خالی معنا ندارد.
  const tagsSubmittable = tagList.length > 0 && tagsValid
  const tagMut = useMutation({
    mutationFn: async () => {
      if (!sid || !tagTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsNodeTag(sid, tagTarget.id, tagList)
    },
    onSuccess: (res) => {
      toast.success(
        `برچسب‌های دستگاه #${res.data.id.toLocaleString('fa-IR')} به «${res.data.tags.join('، ')}» تنظیم شد.`
      )
      setTagTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── منقضی‌کردن (نیاز به احراز هویت مجدد) ──
  const expireMut = useMutation({
    mutationFn: async () => {
      if (!sid || !expireTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsNodeExpire(sid, expireTarget.id)
    },
    onSuccess: (res) => {
      toast.success(
        `کلید دستگاه «${expireTarget?.name ?? res.data.id}» منقضی شد — دستگاه برای ادامه باید دوباره احراز هویت (عضویت) کند.`
      )
      setExpireTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── غیرفعال‌کردن انقضا (هرگز منقضی نمی‌شود) ──
  const expireDisableMut = useMutation({
    mutationFn: async () => {
      if (!sid || !expireDisableTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsNodeExpire(sid, expireDisableTarget.id, true)
    },
    onSuccess: () => {
      toast.success(
        `انقضای کلید دستگاه «${expireDisableTarget?.name ?? '؟'}» غیرفعال شد — این دستگاه دیگر خودکار منقضی نمی‌شود.`
      )
      setExpireDisableTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── حذف ──
  const deleteMut = useMutation({
    mutationFn: async () => {
      if (!sid || !deleteTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsNodeDelete(sid, deleteTarget.id)
    },
    onSuccess: (res) => {
      toast.success(`دستگاه «${res.data.name ?? '؟'}» از سرور حذف شد.`)
      setDeleteTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  const list = useMemo(() => nodes.data ?? [], [nodes.data])
  const onlineCount = list.filter((n) => n.online === true).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-6 text-muted-foreground">
          {nodes.isLoading
            ? 'در حال خواندن فهرست دستگاه‌ها از سرور…'
            : list.length > 0
              ? `${list.length.toLocaleString('fa-IR')} دستگاه ثبت شده · ${onlineCount.toLocaleString('fa-IR')} آنلاین`
              : null}
        </p>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-xl font-bold"
          onClick={() => {
            void nodes.refetch()
            toast.success('بازآوری فهرست دستگاه‌ها…')
          }}
        >
          <RefreshCw className={nodes.isFetching ? 'size-4 animate-spin' : 'size-4'} />
          بازآوری
        </Button>
      </div>

      {nodes.isLoading ? (
        <TableSkeleton cols={7} rows={4} />
      ) : nodes.error ? (
        <ErrorState
          title="خواندن فهرست دستگاه‌ها از سرور ناموفق بود"
          error={nodes.error}
          onRetry={() => void nodes.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<MonitorSmartphone className="size-7" />}
          title="هنوز هیچ دستگاهی به این سرور متصل نشده است"
          body={
            <>
              دستگاه (گوشی/لپ‌تاپ/سرور) با نصب کلاینت Tailscale و اجرای دستور
              اتصال به سرور شما عضو می‌شود — اما برای عضویت، ابتدا یک{' '}
              <strong>کلید اتصال (PreAuthKey)</strong> لازم است.
              <br />
              راهنمای گام‌به‌گام عضوکردن هر نوع دستگاه در فصل ۵ آموزش آمده است.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => navigate('#/keys')}
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
                راهنمای اتصال (فصل ۵)
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
                    <TableHead className="w-16 text-start">شناسه</TableHead>
                    <TableHead className="text-start">نام دستگاه</TableHead>
                    <TableHead className="text-start">کاربر</TableHead>
                    <TableHead className="text-start">آدرس‌های IP</TableHead>
                    <TableHead className="text-start">وضعیت</TableHead>
                    <TableHead className="text-start">برچسب‌ها</TableHead>
                    <TableHead className="text-start">آخرین اتصال</TableHead>
                    <TableHead className="w-20 text-start">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((n) => {
                    const status = nodeStatus(n)
                    const tags = nodeTags(n.raw)
                    return (
                      <TableRow key={n.id}>
                        <TableCell className="font-mono text-muted-foreground" dir="ltr">
                          {n.id}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-bold text-foreground" dir="ltr">
                              {n.name || '—'}
                            </span>
                            {n.hostname && n.hostname !== n.name ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    className="cursor-help text-[10px] text-muted-foreground"
                                    dir="ltr"
                                  >
                                    hostname: {n.hostname}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent dir="rtl" className="max-w-72 text-[12px]">
                                  «{n.hostname}» نامی است که خود دستگاه هنگام عضویت گزارش
                                  کرده و از پنل قابل تغییر نیست؛ نام اصلی نمایشی (که با
                                  «تغییر نام» عوض می‌شود) {n.name} است — همین که درشت نمایش
                                  داده می‌شود.
                                </TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-[13px]">{nodeUserName(n)}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1" dir="ltr">
                            {nodeIps(n).length === 0 ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              nodeIps(n).map((ip) => (
                                <code key={ip} className="font-mono text-[11px] text-muted-foreground">
                                  {ip}
                                </code>
                              ))
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`px-2.5 py-1 text-[11px] font-bold ${status.className}`}>
                            {status.status === 'online' ? '●' : status.status === 'offline' ? '○' : '⚠'} {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {tags.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {tags.map((t) => (
                                <Badge key={t} variant="secondary" className="font-mono text-[10px]" dir="ltr">
                                  {t}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-help text-[12px] text-muted-foreground underline decoration-dotted underline-offset-4">
                                {relativeTimeFa(nodeLastSeen(n))}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent dir="rtl" className="text-[12px]">
                              {formatDateTimeFa(nodeLastSeen(n))}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-11 rounded-xl"
                                aria-label={`عملیات دستگاه ${n.name}`}
                              >
                                <MoreHorizontal className="size-5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60">
                              <DropdownMenuItem
                                className="min-h-11 gap-2"
                                onSelect={() => {
                                  setRenameTarget(n)
                                  setRenameValue(n.name)
                                }}
                              >
                                <PencilLine className="size-4" />
                                تغییر نام
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="min-h-11 gap-2"
                                onSelect={() => {
                                  setTagTarget(n)
                                  setTagValue(tags.join(', '))
                                }}
                              >
                                <Tags className="size-4" />
                                تنظیم برچسب‌ها…
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => setExpireTarget(n)}>
                                <Timer className="size-4" />
                                منقضی‌کردن (خروج و عضویت مجدد)
                              </DropdownMenuItem>
                              <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => setExpireDisableTarget(n)}>
                                <TimerOff className="size-4" />
                                غیرفعال‌کردن انقضای کلید
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="min-h-11 gap-2 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                                onSelect={() => setDeleteTarget(n)}
                              >
                                <Trash2 className="size-4" />
                                حذف دستگاه…
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* دیالوگ تغییر نام دستگاه */}
      <Dialog open={renameTarget !== null} onOpenChange={(o) => (renameMut.isPending || !o ? setRenameTarget(null) : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle>تغییر نام دستگاه</DialogTitle>
            <DialogDescription asChild>
              <div className="text-start leading-7">
                نام فعلی:{' '}
                <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
                  {renameTarget?.name}
                </code>{' '}
                (شناسهٔ {renameTarget?.id.toLocaleString('fa-IR') ?? '—'}). نام فقط
                نمایشی است؛ اتصال و آدرس IP دستگاه تغییری نمی‌کند. (نامِ hostname که
                خود دستگاه گزارش می‌کند دست‌نخورده می‌ماند.)
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-node-name" className="text-[13px] font-bold">
              نام جدید
            </Label>
            <Input
              id="rename-node-name"
              dir="ltr"
              className="h-11 rounded-xl font-mono text-start"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim().length > 0 && !renameMut.isPending) renameMut.mutate()
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={renameMut.isPending}
            />
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-start">
            <Button
              className="h-11 min-w-28 gap-2 rounded-xl font-bold"
              disabled={renameValue.trim().length === 0 || renameMut.isPending}
              onClick={() => renameMut.mutate()}
            >
              {renameMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <PencilLine className="size-4" />}
              ذخیرهٔ نام
            </Button>
            <Button
              variant="outline"
              className="h-11 min-w-24 rounded-xl font-bold"
              disabled={renameMut.isPending}
              onClick={() => setRenameTarget(null)}
            >
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ برچسب‌ها */}
      <Dialog open={tagTarget !== null} onOpenChange={(o) => (tagMut.isPending || !o ? setTagTarget(null) : undefined)}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle>تنظیم برچسب‌های دستگاه</DialogTitle>
            <DialogDescription className="text-start leading-7">
              برچسب‌ها (مثل <code dir="ltr" className="font-mono">tag:office</code>) در
              سیاست دسترسی (ACL) استفاده می‌شوند — مثلاً «همهٔ دستگاه‌های با
              برچسم office به سرور دفتر دسترسی داشته باشند». فهرست وارد‌شده
              جایگزین برچسب‌های فعلی دستگاه می‌شود.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="node-tags" className="text-[13px] font-bold">
              برچسب‌ها (با ویرگول جدا کنید)
            </Label>
            <Input
              id="node-tags"
              dir="ltr"
              className="h-11 rounded-xl font-mono text-start"
              placeholder="tag:office, tag:cctv"
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={tagMut.isPending}
            />
            <p className="text-[11px] leading-6 text-muted-foreground">
              {TAG_SYNTAX_HELP}{' '}نکتهٔ واقعی: سرور فقط برچسب‌هایی را می‌پذیرد که
              ابتدا در سیاست دسترسی (بخش tagOwners) تعریف شده باشند؛ اگر خطای
              «برچسب مجاز نیست» گرفتید، اول آن را در سیاست اضافه کنید (فصل ۸).
            </p>
            {tagList.length > 0 && !tagsValid ? (
              <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                حداقل یک برچسب قالب «tag:name» را رعایت نمی‌کند.
              </p>
            ) : null}
            {tagList.length === 0 ? (
              <p className="text-[12px] leading-6 text-amber-700 dark:text-amber-300">
                سرور اجازه نمی‌دهد همهٔ برچسب‌های یک دستگاه هم‌زمان پاک شود — برای
                حذف یک برچسب، فهرست را بدون آن بنویسید و ذخیره کنید؛ خالی‌گذاشتن
                فهرست ارسال نمی‌شود.
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-start">
            <Button
              className="h-11 min-w-28 gap-2 rounded-xl font-bold"
              disabled={!tagsSubmittable || tagMut.isPending}
              onClick={() => tagMut.mutate()}
            >
              {tagMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Tags className="size-4" />}
              ذخیرهٔ برچسب‌ها
            </Button>
            <Button
              variant="outline"
              className="h-11 min-w-24 rounded-xl font-bold"
              disabled={tagMut.isPending}
              onClick={() => setTagTarget(null)}
            >
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* تأیید منقضی‌کردن */}
      <ConfirmActionDialog
        open={expireTarget !== null}
        onOpenChange={(o) => (expireMut.isPending ? undefined : o ? undefined : setExpireTarget(null))}
        title="منقضی‌کردن کلید این دستگاه"
        description={
          <>
            کلید دستگاه{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
              {expireTarget?.name}
            </code>{' '}
            باطل می‌شود و اتصالش قطع می‌گردد. دستگاه از فهرست حذف نمی‌شود؛ برای
            بازگشت باید روی خود دستگاه دوباره دستور اتصال را بزند و با یک کلید
            اتصال (PreAuthKey) تازه عضو شود. این روش برای وقتی است که مطمئنید
            دستگاه از دست رفته یا باید اجباراً احراز هویت مجدد شود.
          </>
        }
        confirmLabel="بله، منقضی کن"
        tone="warning"
        onConfirm={() => expireMut.mutate()}
        pending={expireMut.isPending}
      />

      {/* تأیید غیرفعال‌کردن انقضا */}
      <ConfirmActionDialog
        open={expireDisableTarget !== null}
        onOpenChange={(o) => (expireDisableMut.isPending ? undefined : o ? undefined : setExpireDisableTarget(null))}
        title="غیرفعال‌کردن انقضای کلید این دستگاه"
        description={
          <>
            از این پس کلید دستگاه{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
              {expireDisableTarget?.name}
            </code>{' '}
            هرگز منقضی نمی‌شود و عضویتش دائمی است (معادل{' '}
            <code dir="ltr" className="font-mono text-[12px]">nodes expire --disable</code>
            ). برای دستگاه‌های همیشه‌روشن مثل سرور دفتر و دوربین‌ها مناسب است.
          </>
        }
        confirmLabel="بله، انقضا را غیرفعال کن"
        tone="warning"
        onConfirm={() => expireDisableMut.mutate()}
        pending={expireDisableMut.isPending}
      />

      {/* حذف با تأیید تایپی */}
      <TypedConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => (deleteMut.isPending ? undefined : o ? undefined : setDeleteTarget(null))}
        title="حذف دستگاه از سرور"
        typedName={deleteTarget?.name ?? ''}
        targetLabel={
          <>
            قرار است دستگاه{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
              {deleteTarget?.name}
            </code>{' '}
            (شناسهٔ {deleteTarget?.id.toLocaleString('fa-IR') ?? '—'}، کاربر{' '}
            {deleteTarget ? nodeUserName(deleteTarget) : '—'}) حذف شود.
          </>
        }
        warning={
          <>
            حذف دستگاه یعنی عضویتش از شبکهٔ خصوصی به‌طور کامل پاک می‌شود؛ برای
            بازگشت باید از روی خود دستگاه دوباره عضو شود. اگر فقط می‌خواهید
            موقتاً دسترسی را قطع کنید، «منقضی‌کردن» کافی است و تاریخچهٔ دستگاه
            می‌ماند.
          </>
        }
        confirmLabel="بله، این دستگاه را حذف کن"
        onConfirm={() => deleteMut.mutate()}
        pending={deleteMut.isPending}
      />
    </div>
  )
}
