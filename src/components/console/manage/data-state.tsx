'use client'

/**
 * حالت‌های مشترک داده برای بخش‌های مدیریت:
 * اسکلت جدول، خطا با تلاش مجدد، و حالت خالی صادقانه با قدم بعدی واقعی.
 */

import type { ReactNode } from 'react'
import { CircleX, RefreshCw } from 'lucide-react'
import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** اسکلت بارگذاری جدول (cols ستون، rows ردیف) */
export function TableSkeleton({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}>
                <Skeleton className="h-4 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r} className="hover:bg-transparent">
              {Array.from({ length: cols }).map((_, c) => (
                <TableCell key={c}>
                  <Skeleton className="h-5 w-full max-w-28" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** کارت خطا با دکمهٔ تلاش مجدد — پیام واقعی AgentError فارسی */
export function ErrorState({ title, error, onRetry }: { title: string; error: unknown; onRetry: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-red-500/30 bg-red-500/[0.04] p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-bold text-red-600 dark:text-red-400">
        <CircleX className="size-4" />
        {title}
      </p>
      <p className="break-words text-[13px] leading-7 text-muted-foreground">
        {error instanceof Error ? error.message : 'خطای نامشخص.'}
      </p>
      <Button variant="outline" className="h-11 gap-2 rounded-xl font-bold" onClick={onRetry}>
        <RefreshCw className="size-4" />
        تلاش مجدد
      </Button>
    </div>
  )
}

/**
 * حالت خالی صادقانه — توضیح می‌دهد وضعیت فعلی چیست و قدم بعدی واقعی چیست.
 * actions: دکمه‌های قدم بعدی (مثل ساخت کاربر یا رفتن به آموزش).
 */
export function EmptyState({
  icon,
  title,
  body,
  actions,
}: {
  icon: ReactNode
  title: string
  body: ReactNode
  actions?: ReactNode
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center sm:p-10">
          <span className="inline-flex size-14 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            {icon}
          </span>
          <h2 className="text-base font-black text-foreground sm:text-lg">{title}</h2>
          <p className="max-w-xl text-[13px] leading-7 text-muted-foreground">{body}</p>
          {actions ? <div className="mt-1 flex flex-col gap-2 sm:flex-row">{actions}</div> : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}
