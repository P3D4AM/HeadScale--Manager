'use client'

import { useMemo, useState } from 'react'
import {
  AlertOctagon,
  BookOpenCheck,
  Layers,
  Search,
  Siren,
  Stethoscope,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { CodeBlock } from '../code-block'
import { navigate } from '@/lib/nav'
import { SIX_LAYERS, TROUBLESHOOTING_ERRORS } from '@/data/troubleshooting'

export function TroubleshootSection() {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return TROUBLESHOOTING_ERRORS
    return TROUBLESHOOTING_ERRORS.filter(
      (e) =>
        e.title.includes(q) ||
        e.symptom.includes(q) ||
        e.cause.includes(q) ||
        e.fix.includes(q) ||
        e.checkCommand.includes(q)
    )
  }, [query])

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* سربرگ */}
      <div className="mb-8 text-center">
        <Badge
          variant="outline"
          className="mb-4 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <Stethoscope className="size-3.5" />
          عیب‌یابی
        </Badge>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          ۱۴ خطای رایج — با نشانه، دستور بررسی و راهکار ایمن
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          قانون اول همیشه: <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">hsctl doctor</code>{' '}
          — عیب‌یابی خودکار با خروجی چهارتایی (مشکل / علت / چگونگی بررسی / راهکار).
          اگر جواب نداد، جدول زیر و نقشهٔ شش لایه مسیر شماست.
        </p>
      </div>

      {/* نقشهٔ شش لایه */}
      <Card className="mb-8 bg-card/70">
        <CardContent className="p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-bold text-foreground">
            <Layers className="size-5 text-emerald-600 dark:text-emerald-400" />
            نقشهٔ شش لایه — از نزدیک به دور تست کنید
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {SIX_LAYERS.map((l, i) => (
              <motion.div
                key={l.layer}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
                className="rounded-xl border bg-background/50 p-3.5"
              >
                <p className="text-xs font-black text-emerald-700 dark:text-emerald-300">
                  {l.layer}
                </p>
                <p className="mt-1 text-[12px] leading-6 text-foreground/85">{l.checks}</p>
                <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                  تست: <span dir="auto">{l.how}</span>
                </p>
              </motion.div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            روش کار: از لایهٔ ۱ شروع کنید و به پایین بیایید. اولین لایه‌ای که خراب
            بود، همان‌جا باید تعمیر کنید — تعمیر لایه‌های سالم فقط وقت‌تان را تلف
            می‌کند.
          </p>
        </CardContent>
      </Card>

      {/* جستجو */}
      <div className="relative mb-6">
        <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="جستجو در خطاها… (مثلاً DNS یا گواهی یا فایروال)"
          className="h-12 rounded-xl bg-background pe-9"
          aria-label="جستجوی خطاها"
        />
      </div>

      {/* لیست خطاها */}
      <div className="mb-8">
        {filtered.length === 0 && (
          <p className="py-14 text-center text-sm text-muted-foreground">
            خطایی با این عبارت پیدا نشد — عبارت کوتاه‌تری امتحان کنید یا{' '}
            <button
              type="button"
              onClick={() => navigate('#/learn/9')}
              className="font-bold text-primary hover:underline"
            >
              فصل ۹
            </button>{' '}
            را ببینید.
          </p>
        )}
        {filtered.length > 0 && (
          <Accordion type="single" collapsible className="space-y-3">
            {filtered.map((err, i) => (
              <motion.div
                key={err.id}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-20px' }}
                transition={{ duration: 0.25, delay: Math.min(i * 0.03, 0.25) }}
              >
                <Card
                  className={cn(
                    'bg-card/70 transition-colors hover:border-primary/30',
                    'border-border/80'
                  )}
                >
                  <CardContent className="p-0">
                    <AccordionItem value={`err-${err.id}`} className="border-b-0">
                      <AccordionTrigger className="min-h-12 gap-3 px-4 text-start sm:px-5">
                        <span className="flex items-center gap-3">
                          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-xs font-black text-red-600 dark:text-red-400">
                            {err.id}
                          </span>
                          <span>
                            <span className="block text-sm font-bold text-foreground">
                              {err.title}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              لایهٔ {err.layer}
                            </span>
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 px-4 pb-5 sm:px-5">
                        <div className="rounded-xl border border-red-500/25 bg-red-500/[0.05] p-3.5">
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-300">
                            <Siren className="size-3.5" />
                            نشانه
                          </p>
                          <p className="text-[13px] leading-6 text-foreground/85">{err.symptom}</p>
                        </div>

                        <div>
                          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                            <AlertOctagon className="size-3.5" />
                            دستور بررسی
                          </p>
                          <CodeBlock code={err.checkCommand} language="bash" terminal />
                        </div>

                        <div className="rounded-xl border bg-background/50 p-3.5">
                          <p className="mb-1 text-xs font-bold text-foreground">معنی خروجی</p>
                          <p className="text-[13px] leading-6 text-muted-foreground">{err.meaning}</p>
                        </div>

                        <div className="rounded-xl border bg-background/50 p-3.5">
                          <p className="mb-1 text-xs font-bold text-foreground">علت احتمالی</p>
                          <p className="text-[13px] leading-6 text-muted-foreground">{err.cause}</p>
                        </div>

                        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-3.5">
                          <p className="mb-1 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                            راهکار ایمن
                          </p>
                          <p className="text-[13px] leading-6 text-foreground/90">{err.fix}</p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </Accordion>
        )}
      </div>

      {/* لینک فصل کامل */}
      <Card className="border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-transparent">
        <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
          <BookOpenCheck className="size-8 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h2 className="text-base font-bold text-foreground">
              الگوی چهار سؤالی، خواندن لاگ‌ها و همهٔ جزئیات
            </h2>
            <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
              آموزش کامل عیب‌یابی — با نقشهٔ شش لایه، جدول سریع و روش خواندن لاگ مثل
              یک متخصص — در فصل نهم مرکز آموزش.
            </p>
          </div>
          <Button
            onClick={() => navigate('#/learn/9')}
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <Stethoscope className="size-4" />
            آموزش عیب‌یابی کامل (فصل ۹)
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
