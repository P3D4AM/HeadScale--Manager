'use client'

/**
 * پوستهٔ مشترک بخش‌های مدیریت: سربرگ + دروازهٔ اتصال.
 * هر سکشن ready باید در حالت قطع، راهنمای صادقانهٔ «اول اتصال» نشان دهد
 * (الگوی داشبورد/جای‌نگه‌دار ۶-الف).
 */

import type { ComponentType, ReactNode } from 'react'
import { motion } from 'framer-motion'
import { PlugZap } from 'lucide-react'
import { navigate } from '@/lib/nav'
import { useConnectionStore } from '@/lib/connection-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function SectionShell({
  icon: Icon,
  title,
  description,
  actions,
  children,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  /** دکمه‌های سربرگ (مثل «کاربر جدید» و «بازآوری») */
  actions?: ReactNode
  children: ReactNode
}) {
  const connected = useConnectionStore((s) => s.status === 'connected')
  const host = useConnectionStore((s) => s.host)

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mb-6 flex flex-wrap items-start justify-between gap-3"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
            <Icon className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-black text-foreground sm:text-2xl">{title}</h1>
            <p className="mt-1 max-w-2xl text-[13px] leading-6 text-muted-foreground">{description}</p>
          </div>
        </div>
        {connected && actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </motion.div>

      {connected ? (
        children
      ) : (
        <ConnectFirstCard title={title} host={host} />
      )}
    </div>
  )
}

function ConnectFirstCard({ title, host }: { title: string; host: string | null }) {
  return (
    <Card className="border-dashed border-amber-500/40 bg-amber-500/[0.03]">
      <CardContent className="flex flex-col gap-5 p-6 sm:p-8">
        <p className="flex items-start gap-2.5 text-sm font-bold leading-7 text-amber-700 dark:text-amber-300">
          <PlugZap className="mt-1 size-5 shrink-0" />
          برای دیدن «{title}» ابتدا باید به سرور خود متصل شوید
          {host ? ` (در حال حاضر به ${host} متصل نیستید)` : ''}.
        </p>
        <p className="text-[13px] leading-7 text-muted-foreground">
          این صفحه هیچ دادهٔ نمایشی ندارد؛ فهرست‌ها و دکمه‌هایش فقط با دستورات
          واقعی headscale روی سرور شما (از مسیر SSH امن) کار می‌کنند. از مرکز
          اتصال، به VPS خود وصل شوید — در اولین بار، اثرانگشت کلید میزبان سرور
          را تأیید می‌کنید.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            onClick={() => navigate('#/connect')}
            className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <PlugZap className="size-5" />
            رفتن به مرکز اتصال
          </Button>
          <Button variant="outline" onClick={() => navigate('#/')} className="h-12 gap-2 rounded-xl px-6 font-bold">
            بازگشت به داشبورد
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
