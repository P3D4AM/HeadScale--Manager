'use client'

/**
 * #/routes — مسیرها (Subnet Router) و Exit Node.
 * داده‌ها از «nodes list-routes» واقعی می‌آیند؛ تأیید/لغو هر مسیر با
 * approve-routes همان دستگاه انجام می‌شود (آرایهٔ کامل جایگزین می‌شود).
 * هیچ ردیف نمایشی وجود ندارد — اگر دستگاهی مسیر اعلام نکرده، صادقانه
 * خالی است.
 */

import { useCallback, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BookOpenCheck, Globe2, Info, Loader2, Network, RefreshCw, Route as RouteIcon, XCircle } from 'lucide-react'
import { AgentError } from '@/lib/agent'
import { navigate } from '@/lib/nav'
import { AGENT_QUERY_PREFIX, useSessionDataQuery, useSessionId } from '../use-agent'
import {
  agentErrText,
  approvedPrefixes,
  groupRoutesByNode,
  hsNodeApproveRoutes,
  isExitNodePrefix,
  type HsRouteEntry,
} from '@/lib/manage/api'
import { SectionShell } from '../manage/section-shell'
import { EmptyState, ErrorState } from '../manage/data-state'
import { ConfirmActionDialog } from '../manage/typed-confirm-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'

export function RoutesSection() {
  return (
    <SectionShell
      icon={RouteIcon}
      title="مسیرها و Exit Node"
      description="وقتی دستگاهی مسیر (مثل رنج شبکهٔ دفتر یا 0.0.0.0/0 برای Exit Node) اعلام کند، اینجا باید تأییدش کنید تا بقیهٔ دستگاه‌ها بتوانند از آن استفاده کنند."
    >
      <RoutesManager />
    </SectionShell>
  )
}

function RoutesManager() {
  const sid = useSessionId()
  const qc = useQueryClient()
  const routes = useSessionDataQuery<HsRouteEntry[]>(['hs', 'routes'], 'hs/nodes/routes', {
    staleTime: 30_000,
  })

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: [AGENT_QUERY_PREFIX] })
  }, [qc])

  const [revokeAllTarget, setRevokeAllTarget] = useState<{ key: string; hostname: string; nodeId: number | null; prefixes: string[] } | null>(null)

  // تأیید/لغو یک مسیر — آرایهٔ کامل مسیرهای تأییدشدهٔ همان دستگاه فرستاده می‌شود
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const toggleMut = useMutation({
    mutationFn: async (input: { nodeId: number; prefix: string; approve: boolean; currentApproved: string[] }) => {
      if (!sid) throw new AgentError('NOT_CONNECTED', 'نشست فعالی وجود ندارد؛ ابتدا متصل شوید.')
      const next = input.approve
        ? [...new Set([...input.currentApproved, input.prefix])]
        : input.currentApproved.filter((p) => p !== input.prefix)
      return hsNodeApproveRoutes(sid, input.nodeId, next)
    },
    onSuccess: (_res, input) => {
      toast.success(
        input.approve
          ? `مسیر ${input.prefix} تأیید شد — دستگاه‌های دیگر (با پذیرش مسیرها) می‌توانند از آن استفاده کنند.`
          : `تأیید مسیر ${input.prefix} لغو شد.`
      )
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
    onSettled: () => setPendingKey(null),
  })

  const revokeAllMut = useMutation({
    mutationFn: async () => {
      if (!sid || !revokeAllTarget || revokeAllTarget.nodeId === null) {
        throw new AgentError('NOT_CONNECTED', 'شناسهٔ دستگاه در دسترس نیست.')
      }
      return hsNodeApproveRoutes(sid, revokeAllTarget.nodeId, [])
    },
    onSuccess: () => {
      toast.success(`همهٔ مسیرهای «${revokeAllTarget?.hostname}» لغو شد.`)
      setRevokeAllTarget(null)
      invalidate()
    },
    onError: (err) => toast.error(agentErrText(err)),
  })

  const groups = useMemo(() => groupRoutesByNode(routes.data), [routes.data])
  const hasExitRoute = useMemo(
    () => groups.some((g) => g.routes.some((r) => isExitNodePrefix(r.prefix))),
    [groups]
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-6 text-muted-foreground">
          {routes.isLoading
            ? 'در حال خواندن مسیرهای اعلام‌شده از سرور…'
            : groups.length > 0
              ? `${groups.length.toLocaleString('fa-IR')} دستگاه مسیر اعلام کرده است.`
              : null}
        </p>
        <Button
          variant="outline"
          className="h-11 gap-2 rounded-xl font-bold"
          onClick={() => {
            void routes.refetch()
            toast.success('بازآوری فهرست مسیرها…')
          }}
        >
          <RefreshCw className={routes.isFetching ? 'size-4 animate-spin' : 'size-4'} />
          بازآوری
        </Button>
      </div>

      {routes.isLoading ? (
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
            ))}
          </CardContent>
        </Card>
      ) : routes.error ? (
        <ErrorState
          title="خواندن مسیرها از سرور ناموفق بود"
          error={routes.error}
          onRetry={() => void routes.refetch()}
        />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Network className="size-7" />}
          title="هنوز هیچ دستگاهی مسیری اعلام نکرده است"
          body={
            <>
              «مسیر» یعنی یک دستگاه، دسترسی به یک رنج شبکه (مثل{' '}
              <code dir="ltr" className="font-mono">192.168.1.0/24</code> شبکهٔ دفتر)
              را برای بقیهٔ اعضای VPN فراهم کند (Subnet Router)، یا با{' '}
              <code dir="ltr" className="font-mono">0.0.0.0/0</code> نقش Exit Node
              بگیرد. دستگاه باید موقع اتصال این مسیرها را «اعلام» کند تا اینجا
              برای تأیید نمایش داده شوند — راهنمای کامل در فصل ۶ (شبکهٔ دفتر) و
              فصل ۷ (Exit Node) آموزش.
            </>
          }
          actions={
            <>
              <Button
                variant="outline"
                onClick={() => navigate('#/learn/6')}
                className="h-12 gap-2 rounded-xl px-6 font-bold"
              >
                <BookOpenCheck className="size-5" />
                فصل ۶ — دسترسی به شبکهٔ دفتر
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('#/learn/7')}
                className="h-12 gap-2 rounded-xl px-6 font-bold"
              >
                <BookOpenCheck className="size-5" />
                فصل ۷ — Exit Node
              </Button>
            </>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const currentApproved = approvedPrefixes(g)
            return (
              <Card key={g.key} className="bg-card/70 py-0">
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex size-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <Network className="size-4" />
                      </span>
                      <div>
                        <p className="text-[14px] font-black text-foreground" dir="ltr">
                          {g.hostname}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.nodeId !== null ? `دستگاه #${g.nodeId.toLocaleString('fa-IR')}` : 'دستگاه'} ·{' '}
                          {g.routes.length.toLocaleString('fa-IR')} مسیر اعلام‌شده
                        </p>
                      </div>
                    </div>
                    {currentApproved.length > 0 ? (
                      <Button
                        variant="outline"
                        className="h-11 gap-2 rounded-xl font-bold text-red-600 hover:text-red-500 dark:text-red-400"
                        onClick={() =>
                          setRevokeAllTarget({
                            key: g.key,
                            hostname: g.hostname,
                            nodeId: g.nodeId,
                            prefixes: currentApproved,
                          })
                        }
                      >
                        <XCircle className="size-4" />
                        لغو همهٔ مسیرهای این دستگاه
                      </Button>
                    ) : null}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-start">پیشوند مسیر</TableHead>
                          <TableHead className="text-start">اعلام‌شده</TableHead>
                          <TableHead className="text-start">تأییدشده (فعال)</TableHead>
                          <TableHead className="text-start">نقش</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {g.routes.map((r) => {
                          const rowKey = `${g.key}:${r.prefix}`
                          const prefix = r.prefix
                          const exit = isExitNodePrefix(prefix)
                          const approved = r.enabled
                          return (
                            <TableRow key={rowKey}>
                              <TableCell>
                                <code dir="ltr" className="font-mono text-[13px] font-bold text-foreground">
                                  {prefix}
                                </code>
                              </TableCell>
                              <TableCell>
                                {r.advertised ? (
                                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                                    بله
                                  </Badge>
                                ) : (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Badge variant="outline" className="cursor-help border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                        دیگر اعلام نمی‌شود
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent dir="rtl" className="max-w-64 text-[12px] leading-6">
                                      دستگاه این مسیر را قبلاً اعلام کرده بود و هنوز تأیید آن روی سرور فعال است؛
                                      اگر می‌خواهید کامل پاک شود، تأییدش را خاموش کنید.
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Switch
                                    checked={approved}
                                    disabled={
                                      g.nodeId === null ||
                                      (pendingKey === rowKey && toggleMut.isPending)
                                    }
                                    aria-label={`تأیید مسیر ${prefix} روی دستگاه ${g.hostname}`}
                                    onCheckedChange={(checked) => {
                                      if (g.nodeId === null) return
                                      setPendingKey(rowKey)
                                      toggleMut.mutate({
                                        nodeId: g.nodeId,
                                        prefix,
                                        approve: checked,
                                        currentApproved,
                                      })
                                    }}
                                  />
                                  {pendingKey === rowKey && toggleMut.isPending ? (
                                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                                  ) : approved ? (
                                    <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                                      تأییدشده و فعال
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground">تأیید نشده</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {exit ? (
                                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                      Exit Node
                                    </Badge>
                                  ) : null}
                                  {r.isPrimary === true ? (
                                    <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                                      مسیر اصلی (Primary)
                                    </Badge>
                                  ) : null}
                                  {!exit && r.isPrimary !== true ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : null}
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
            )
          })}
        </div>
      )}

      {/* توضیح Exit Node برای غیرمتخصص‌ها */}
      <Card className="border-border/70 bg-muted/30">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
          <Globe2 className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="space-y-2 text-[13px] leading-7 text-foreground/90">
            <p className="font-bold text-foreground">Exit Node چیست و 0.0.0.0/0 یعنی چه؟</p>
            <p>
              وقتی مسیر <code dir="ltr" className="font-mono">0.0.0.0/0</code> (و{' '}
              <code dir="ltr" className="font-mono">::/0</code> برای IPv6) تأیید شود،
              آن دستگاه نقش <strong>Exit Node</strong> می‌گیرد: هر دستگاهی که در
              تنظیمات خودش «استفاده از Exit Node» را روشن کند،{' '}
              <strong>تمام ترافیک اینترنتش</strong> (نه فقط شبکهٔ داخلی) از همان
              سرور عبور می‌کند — مثل وقتی همهٔ اینترنت از دفتر یا خانه‌تان رد
              می‌شود.
            </p>
            <p>
              برای این کار: (۱) روی دستگاه همیشه‌روشن، هنگام اتصال{' '}
              <code dir="ltr" className="font-mono">--advertise-routes=0.0.0.0/0,::/0</code>{' '}
              را بدهید (فصل ۷)، (۲) همان مسیرها اینجا ظاهر می‌شوند و{' '}
              <strong>تأییدشان کنید</strong>
              {hasExitRoute
                ? ' — همین حالا مسیر Exit Node در فهرست بالا موجود است.'
                : ' — فعلاً هیچ دستگاهی چنین مسیری اعلام نکرده است.'}{' '}
              (۳) روی گوشی/لپ‌تاپ مصرف‌کننده، گزینهٔ Exit Node را از فهرست
              دستگاه‌های Tailscale انتخاب کنید.
            </p>
            <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
              <Info className="mt-1 size-3.5 shrink-0" />
              دو نکتهٔ واقعی: (الف) در headscale، تأیید هر کدام از{' '}
              <code dir="ltr" className="font-mono">0.0.0.0/0</code> یا{' '}
              <code dir="ltr" className="font-mono">::/0</code> معمولاً دیگری را هم
              هم‌زمان فعال می‌کند (جفت Exit Node). (ب) برخلاف Subnet Router، ترافیک
              Exit Node از سرور شما عبور می‌کند و پهنای‌باند VPS را مصرف می‌کند؛ اگر
              فقط به شبکهٔ دفتر نیاز دارید، مسیر رنج دفتر (فصل ۶) کافی و سبک‌تر است.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* تأیید لغو همهٔ مسیرهای یک دستگاه */}
      <ConfirmActionDialog
        open={revokeAllTarget !== null}
        onOpenChange={(o) => (revokeAllMut.isPending ? undefined : o ? undefined : setRevokeAllTarget(null))}
        title="لغو همهٔ مسیرهای این دستگاه"
        description={
          <>
            تأیید همهٔ این مسیرهای دستگاه{' '}
            <strong dir="ltr">{revokeAllTarget?.hostname}</strong> لغو می‌شود:{' '}
            <span dir="ltr" className="font-mono text-[12px]">
              {revokeAllTarget?.prefixes.join('، ')}
            </span>
            . دستگاه‌هایی که از این مسیرها استفاده می‌کردند دسترسی‌شان قطع می‌شود
            تا دوباره تأییدشان کنید.
          </>
        }
        confirmLabel="بله، همه را لغو کن"
        tone="destructive"
        onConfirm={() => revokeAllMut.mutate()}
        pending={revokeAllMut.isPending}
      />
    </div>
  )
}
