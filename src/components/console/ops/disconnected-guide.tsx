'use client'

/**
 * راهنمای «اول اتصال» — حالت قطع سکشن‌های عملیاتی ۶-د.
 * الگوی مشترک با داشبورد/جای‌نگه‌دارها؛ هیچ داده‌ای نمایش داده نمی‌شود.
 */

import { PlugZap } from 'lucide-react'
import { motion } from 'framer-motion'
import { navigate } from '@/lib/nav'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export function DisconnectedGuide({
  title,
  needText,
}: {
  title: string
  /** چه چیزی برای این بخش «اتصال» لازم است — جملهٔ کوتاه فارسی */
  needText: string
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="border-amber-500/30 bg-amber-500/[0.03]">
          <CardContent className="space-y-5 p-6 sm:p-8">
            <div>
              <h1 className="text-xl font-black text-foreground sm:text-2xl">{title}</h1>
              <p className="mt-3 flex items-start gap-2 text-sm leading-7 text-foreground/90">
                <PlugZap className="mt-1 size-5 shrink-0 text-amber-500" />
                {needText}
              </p>
              <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
                این برنامه همهٔ کارها را از طریق SSH و روی دادهٔ واقعی سرور شما انجام
                می‌دهد؛ بدون اتصال، هیچ چیز برای نمایش وجود ندارد (و هرگز دادهٔ
                نمایشی ساخته نمی‌شود).
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => navigate('#/connect')}
                className="h-12 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
              >
                <PlugZap className="size-4" />
                رفتن به مرکز اتصال
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate('#/')}
                className="h-12 gap-2 rounded-xl px-6 font-bold"
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
