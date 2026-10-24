'use client'

/**
 * سکشن جای‌نگه‌دار برای بخش‌هایی که وظیفهٔ ۶-ب/۶-ج تحویل می‌دهند.
 * کارت صادقانه: چه خواهد کرد، چه endpointهایی پشت آن است و قدم بعدی واقعی چیست.
 */

import { Construction, ListChecks, PlugZap } from 'lucide-react'
import type { ComponentType } from 'react'
import { motion } from 'framer-motion'
import { navigate } from '@/lib/nav'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useConnectionStore } from '@/lib/connection-store'

export interface PlaceholderMeta {
  title: string
  description: string
  capabilities: string[]
  owner: string
  icon: ComponentType<{ className?: string }>
}

export function PlaceholderSection({ meta }: { meta: PlaceholderMeta }) {
  const connected = useConnectionStore((s) => s.status === 'connected')
  const host = useConnectionStore((s) => s.host)
  const Icon = meta.icon

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="border-dashed border-amber-500/40 bg-amber-500/[0.03]">
          <CardContent className="flex flex-col gap-6 p-6 sm:p-8">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <div className="inline-flex size-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Icon className="size-7" />
              </div>
              <div>
                <Badge
                  variant="outline"
                  className="mb-2 gap-1.5 rounded-full border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300"
                >
                  <Construction className="size-3" />
                  قسمت در حال تکمیل است
                </Badge>
                <h1 className="text-xl font-black text-foreground sm:text-2xl">
                  {meta.title}
                </h1>
              </div>
            </div>

            <p className="text-sm leading-7 text-foreground/90">{meta.description}</p>

            <div className="rounded-xl border bg-card/70 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-bold text-foreground">
                <ListChecks className="size-4 text-emerald-600 dark:text-emerald-400" />
                قابلیت‌هایی که در نسخهٔ نهایی این صفحه خواهند بود:
              </p>
              <ul className="space-y-2">
                {meta.capabilities.map((cap) => (
                  <li key={cap} className="flex items-start gap-2 text-[13px] leading-6 text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                    {cap}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-border/70 bg-muted/40 p-4 text-[13px] leading-6 text-muted-foreground">
              این بخش توسط <span className="font-bold text-foreground">{meta.owner}</span>{' '}
              پیاده‌سازی می‌شود و پشت آن همان APIهای واقعی سرویس مدیریت (hem-agent)
              قرار می‌گیرد — هیچ دادهٔ نمایشی/جعلی در این برنامه وجود ندارد.
              {!connected && (
                <p className="mt-2 flex items-start gap-2 text-amber-700 dark:text-amber-300">
                  <PlugZap className="mt-1 size-4 shrink-0" />
                  برای استفاده از این بخش در نسخهٔ نهایی، ابتدا باید به سرور خود
                  متصل شوید{host ? ` (در حال حاضر متصل به ${host} نیستید)` : ''}.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => navigate('#/connect')}
                className="h-11 gap-2 rounded-xl bg-emerald-600 px-5 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              >
                <PlugZap className="size-4" />
                رفتن به مرکز اتصال
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('#/')}
                className="h-11 gap-2 rounded-xl px-5 font-bold"
              >
                بازگشت به داشبورد
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  )
}
