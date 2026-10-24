'use client'

/**
 * #/users — مدیریت کاربران Headscale (فقط دادهٔ واقعی).
 * کاربر در Headscale = «حساب عضویت» که دستگاه‌ها زیر آن ثبت می‌شوند و
 * کلیدهای اتصال برای آن ساخته می‌شوند. حذف کاربر، دستگاه‌های او را هم
 * حذف می‌کند (رفتار واقعی headscale؛ مستند فصل ۸).
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BookOpenCheck,
  Info,
  Loader2,
  MoreHorizontal,
  PencilLine,
  RefreshCw,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { AgentError } from '@/lib/agent'
import type { HsUser } from '@/lib/agent'
import { navigate } from '@/lib/nav'
import { AGENT_QUERY_PREFIX, useSessionDataQuery, useSessionId } from '../use-agent'
import { formatDateTimeFa, USERNAME_PATTERN, USERNAME_SYNTAX_HELP } from '@/lib/manage/format'
import { hsUserCreate, hsUserDestroy, hsUserRename, agentErrText } from '@/lib/manage/api'
import { SectionShell } from '../manage/section-shell'
import { EmptyState, ErrorState, TableSkeleton } from '../manage/data-state'
import { TypedConfirmDialog } from '../manage/typed-confirm-dialog'
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

export function UsersSection() {
  return (
    <SectionShell
      icon={Users}
      title="مدیریت کاربران"
      description="کاربران Headscale حساب‌های عضویت شبکهٔ شما هستند؛ هر دستگاه حین ثبت‌نام زیر یک کاربر می‌نشیند و کلیدهای اتصال هم برای کاربر ساخته می‌شوند."
    >
      <UsersManager />
    </SectionShell>
  )
}

function UsersManager() {
  const sid = useSessionId()
  const qc = useQueryClient()
  const users = useSessionDataQuery<HsUser[]>(['hs', 'users'], 'hs/users', { staleTime: 30_000 })

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])

  // ── حالت‌های دیالوگ ──
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<HsUser | null>(null)
  const [destroyTarget, setDestroyTarget] = useState<HsUser | null>(null)

  // ── ساخت ──
  const [newName, setNewName] = useState('')
  const nameValid = USERNAME_PATTERN.test(newName)
  const createMut = useMutation({
    mutationFn: async () => {
      if (!sid) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد؛ ابتدا متصل شوید.')
      return hsUserCreate(sid, newName.trim())
    },
    onSuccess: (res) => {
      toast.success(`کاربر «${res.data.name}» روی سرور ساخته شد.`)
      setCreateOpen(false)
      setNewName('')
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── تغییر نام ──
  const [renameValue, setRenameValue] = useState('')
  const renameValid = USERNAME_PATTERN.test(renameValue)
  const renameMut = useMutation({
    mutationFn: async () => {
      if (!sid || !renameTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsUserRename(sid, renameTarget.id, renameValue.trim())
    },
    onSuccess: (res) => {
      toast.success(`نام کاربر #${res.data.id.toLocaleString('fa-IR')} به «${res.data.newName}» تغییر کرد.`)
      setRenameTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  // ── حذف ──
  const destroyMut = useMutation({
    mutationFn: async () => {
      if (!sid || !destroyTarget) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد.')
      return hsUserDestroy(sid, destroyTarget.id)
    },
    onSuccess: (res) => {
      toast.success(
        `کاربر «${res.data.name ?? '؟'}» از سرور حذف شد؛ دستگاه‌های ثبت‌شدهٔ او نیز حذف شدند.`
      )
      setDestroyTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  function openRename(u: HsUser) {
    setRenameTarget(u)
    setRenameValue(u.name)
  }

  const list = useMemo(() => users.data ?? [], [users.data])

  return (
    <div className="space-y-5">
      {/* سربرگ عملیات */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-6 text-muted-foreground">
          {users.isLoading
            ? 'در حال خواندن فهرست کاربران از سرور…'
            : list.length > 0
              ? `${list.length.toLocaleString('fa-IR')} کاربر روی سرور شما ثبت شده است.`
              : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="h-11 gap-2 rounded-xl font-bold"
            onClick={() => {
              void users.refetch()
              toast.success('بازآوری فهرست کاربران…')
            }}
          >
            <RefreshCw className={users.isFetching ? 'size-4 animate-spin' : 'size-4'} />
            بازآوری
          </Button>
          <Button
            onClick={() => setCreateOpen(true)}
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <UserPlus className="size-4" />
            کاربر جدید
          </Button>
        </div>
      </div>

      {/* جدول / حالت‌ها */}
      {users.isLoading ? (
        <TableSkeleton cols={4} rows={Math.min(Math.max(list.length, 3), 8)} />
      ) : users.error ? (
        <ErrorState
          title="خواندن فهرست کاربران از سرور ناموفق بود"
          error={users.error}
          onRetry={() => void users.refetch()}
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="هنوز هیچ کاربری روی این سرور ساخته نشده است"
          body={
            <>
              کاربر در Headscale مثل «حساب عضویت» است: برای هر نفر (مثلاً خودتان،
              همکار یا دفتر) یک کاربر می‌سازید، بعد برای او <strong>کلید اتصال</strong>{' '}
              می‌سازید تا گوشی/لپ‌تاپش با همان کلید به شبکهٔ خصوصی شما بپیوندد.
              <br />
              قدم اول همین‌جاست: با دکمهٔ «کاربر جدید» اولین کاربر را بسازید —
              نام انگلیسی کوتاه (مثل <code dir="ltr" className="font-mono">ali</code>)
              بهترین انتخاب است.
            </>
          }
          actions={
            <>
              <Button
                onClick={() => setCreateOpen(true)}
                className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              >
                <UserPlus className="size-5" />
                ساخت اولین کاربر
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('#/learn/5')}
                className="h-12 gap-2 rounded-xl px-6 font-bold"
              >
                <BookOpenCheck className="size-5" />
                آموزش اتصال دستگاه‌ها (فصل ۵)
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
                    <TableHead className="text-start">نام کاربر</TableHead>
                    <TableHead className="text-start">تاریخ ساخت</TableHead>
                    <TableHead className="w-20 text-start">عملیات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-mono text-muted-foreground" dir="ltr">
                        {u.id}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-foreground" dir="ltr">
                            {u.name}
                          </span>
                          {u.displayName ? (
                            <Badge variant="secondary" className="text-[11px]">
                              {u.displayName}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        {formatDateTimeFa(u.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 rounded-xl"
                              aria-label={`عملیات کاربر ${u.name}`}
                            >
                              <MoreHorizontal className="size-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              className="min-h-11 gap-2"
                              onSelect={() => openRename(u)}
                            >
                              <PencilLine className="size-4" />
                              تغییر نام
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="min-h-11 gap-2 text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                              onSelect={() => setDestroyTarget(u)}
                            >
                              <Trash2 className="size-4" />
                              حذف کاربر…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* راهنمای غیرمتخصص‌ها */}
      <Card className="border-border/70 bg-muted/30">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
          <Info className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="text-[13px] leading-7 text-foreground/90">
            <p className="font-bold text-foreground">«کاربر» در Headscale چیست؟</p>
            <p className="mt-1.5">
              کاربر اینجا <strong>حساب شبکهٔ خصوصی</strong> است، نه کاربر سرور: نه
              رمز ورود دارد و نه به سرور شما دسترسی می‌گیرد. فقط برچسبی است که
              دستگاه‌ها (گوشی، لپ‌تاپ، سرور دفتر) زیرش گروه می‌شوند و در سیاست
              دسترسی (ACL) با آن اشاره می‌شوند. با یک کاربر هم می‌شود شروع کرد —
              هر زمان خواستید کاربر دیگری بسازید.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* دیالوگ ساخت */}
      <Dialog open={createOpen} onOpenChange={(o) => (createMut.isPending ? undefined : setCreateOpen(o))}>
        <DialogContent className="max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle>ساخت کاربر جدید</DialogTitle>
            <DialogDescription className="text-start leading-7">
              این کاربر روی همان سروری ساخته می‌شود که به آن وصل هستید. بعد از
              ساخت، می‌توانید برای او کلید اتصال بسازید.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-user-name" className="text-[13px] font-bold">
              نام کاربر
            </Label>
            <Input
              id="new-user-name"
              dir="ltr"
              className="h-11 rounded-xl font-mono text-start"
              placeholder="مثلاً ali"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && nameValid && !createMut.isPending) createMut.mutate()
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={createMut.isPending}
            />
            <p className="text-[11px] leading-6 text-muted-foreground">{USERNAME_SYNTAX_HELP}</p>
            {newName.length > 0 && !nameValid ? (
              <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                این نام را headscale نمی‌پذیرد — قالب بالا را بررسی کنید.
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-start">
            <Button
              className="h-11 min-w-28 gap-2 rounded-xl font-bold"
              disabled={!nameValid || createMut.isPending}
              onClick={() => createMut.mutate()}
            >
              {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
              ساخت کاربر
            </Button>
            <Button
              variant="outline"
              className="h-11 min-w-24 rounded-xl font-bold"
              disabled={createMut.isPending}
              onClick={() => setCreateOpen(false)}
            >
              انصراف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ تغییر نام */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(o) => (renameMut.isPending || !o ? setRenameTarget(null) : undefined)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader className="text-start">
            <DialogTitle>تغییر نام کاربر</DialogTitle>
            <DialogDescription asChild>
              <div className="text-start leading-7">
                نام فعلی:{' '}
                <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">
                  {renameTarget?.name}
                </code>{' '}
                (شناسه {renameTarget?.id.toLocaleString('fa-IR') ?? '—'}). نام جدید
                را وارد کنید — دستگاه‌ها و کلیدهای این کاربر دست‌نخورده می‌مانند.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-user-name" className="text-[13px] font-bold">
              نام جدید
            </Label>
            <Input
              id="rename-user-name"
              dir="ltr"
              className="h-11 rounded-xl font-mono text-start"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValid && !renameMut.isPending) renameMut.mutate()
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={renameMut.isPending}
            />
            {renameValue.length > 0 && !renameValid ? (
              <p className="text-[12px] font-bold text-red-600 dark:text-red-400">
                این نام را headscale نمی‌پذیرد — {USERNAME_SYNTAX_HELP}
              </p>
            ) : null}
          </div>
          <DialogFooter className="flex-row gap-2 sm:justify-start">
            <Button
              className="h-11 min-w-28 gap-2 rounded-xl font-bold"
              disabled={!renameValid || renameMut.isPending}
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

      {/* دیالوگ حذف با تأیید تایپی */}
      <TypedConfirmDialog
        open={destroyTarget !== null}
        onOpenChange={(o) => (destroyMut.isPending ? undefined : o ? undefined : setDestroyTarget(null))}
        title="حذف کاربر از سرور"
        typedName={destroyTarget?.name ?? ''}
        targetLabel={
          <>
            قرار است کاربر{' '}
            <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px] text-foreground">
              {destroyTarget?.name}
            </code>{' '}
            با شناسهٔ {destroyTarget?.id.toLocaleString('fa-IR') ?? '—'} حذف شود. این
            عمل <strong>قابل بازگشت نیست</strong>.
          </>
        }
        warning={
          <>
            حذف کاربر در headscale، <strong>همهٔ دستگاه‌های ثبت‌شدهٔ زیر این کاربر
            را هم حذف می‌کند</strong> — یعنی آن دستگاه‌ها از شبکهٔ خصوصی خارج
            می‌شوند و برای بازگشت باید دوباره با کلید اتصال عضو شوند. اگر فقط
            می‌خواهید دسترسی یک نفر را قطع کنید، به‌جای حذف کاربر، کلیدهایش را
            باطل کنید یا در سیاست دسترسی محدودش کنید.
          </>
        }
        confirmLabel="بله، این کاربر را حذف کن"
        onConfirm={() => destroyMut.mutate()}
        pending={destroyMut.isPending}
      />
    </div>
  )
}
