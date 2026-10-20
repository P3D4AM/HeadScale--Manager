'use client'

import { useState } from 'react'
import {
  CheckCircle2,
  Cloud,
  Globe,
  KeyRound,
  ListChecks,
  MonitorSmartphone,
  Rocket,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { CodeBlock } from '../code-block'
import { navigate } from '@/lib/nav'
import {
  AUTO_INSTALL_CONF_SAMPLE,
  INSTALL_DIALOG,
  INSTALL_FAQ,
  INSTALL_STEPS,
  POST_INSTALL_CHECKS,
} from '@/data/install-steps'

const PREREQS = [
  {
    icon: MonitorSmartphone,
    title: 'سرور (VPS)',
    body: 'Ubuntu Server 22.04 یا 24.04 LTS — amd64 (یا arm64) — حداقل ۱GB RAM و ۱۰GB فضای آزاد — با IP عمومی و پورت‌های آزاد 80/443.',
  },
  {
    icon: Globe,
    title: 'دامنه',
    body: 'یک زیردامنه (مثل headscale.example.com) که بتوانید رکورد A آن را به IP سرور تنظیم کنید. حالت «پروکسی» ابری (مثل Cloudflare Proxy) سازگار نیست.',
  },
  {
    icon: KeyRound,
    title: 'اتصال SSH',
    body: 'نام کاربری با دسترسی sudo (یا root) و اتصال SSH به سرور. کلاینت‌های رسمی Tailscale روی همهٔ پلتفرم‌ها رایگان‌اند.',
  },
]

function DialogDemo() {
  const [answers, setAnswers] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {}
    INSTALL_DIALOG.forEach((qa, i) => {
      if (qa.recommended !== undefined) init[i] = qa.recommended
    })
    return init
  })

  return (
    <Card className="bg-card/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-5 text-emerald-600 dark:text-emerald-400" />
          نمونهٔ گفت‌وگوی نصب — گزینهٔ دلخواه را انتخاب کنید
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {INSTALL_DIALOG.map((qa, i) => (
          <div key={qa.question} className="rounded-xl border bg-background/50 p-4">
            <p className="text-sm font-bold leading-7 text-foreground">
              <span className="me-1.5 text-emerald-600 dark:text-emerald-400">؟</span>
              {qa.question}
            </p>
            {qa.hint && (
              <p className="mt-1 text-xs leading-6 text-muted-foreground">{qa.hint}</p>
            )}
            {qa.options.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {qa.options.map((opt, j) => {
                  const chosen = answers[i] === j
                  const isRecommended = qa.recommended === j
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [i]: j }))}
                      className={cn(
                        'flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-start text-[13px] transition-colors',
                        chosen
                          ? 'border-emerald-500/50 bg-emerald-500/10 font-bold text-foreground'
                          : 'border-border/70 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-black',
                          chosen
                            ? 'border-emerald-500 bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950'
                            : 'border-border text-muted-foreground'
                        )}
                      >
                        {j + 1}
                      </span>
                      {opt}
                      {isRecommended && (
                        <Badge
                          variant="outline"
                          className="ms-auto shrink-0 border-emerald-500/40 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                        >
                          معمول
                        </Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
            {qa.options.length === 0 && (
              <div className="mt-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2.5" dir="ltr">
                  <span className="select-all font-mono text-sm text-emerald-400">
                    ❯ {qa.sampleAnswer.split('\n')[0]}
                  </span>
                </div>
              </div>
            )}
            {qa.options.length > 0 && answers[i] !== undefined && (
              <div className="mt-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3" dir="ltr">
                  <pre className="whitespace-pre-wrap text-start font-mono text-xs leading-6 text-emerald-300">
                    ❯ {qa.sampleAnswer.split('\n')[answers[i]]}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
        <p className="text-center text-xs text-muted-foreground">
          نمونهٔ کامل دیالوگ با توضیح هر سؤال:{' '}
          <button
            type="button"
            onClick={() => navigate('#/learn/4')}
            className="font-bold text-primary hover:underline"
          >
            فصل چهارم — بخش ۴.۵
          </button>
        </p>
      </CardContent>
    </Card>
  )
}

export function InstallSection() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* سربرگ */}
      <div className="mb-8 text-center">
        <Badge
          variant="outline"
          className="mb-4 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <Rocket className="size-3.5" />
          راهنمای نصب
        </Badge>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          از VPS خام تا سرور آماده — در یک دستور
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          نصب‌کننده تعاملی است: دامنه را می‌پرسد، DNS را بررسی می‌کند، اگر مشکلی باشد
          راهنمایی می‌کند و در پایان گزارش کامل نصب و دستورات اتصال را نشان می‌دهد.
          روش رسمی نصب فقط اجرای <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">install.sh</code> از مخزن رسمی است.
        </p>
      </div>

      {/* حالت‌های نصب */}
      <Tabs defaultValue="interactive" className="mb-10">
        <TabsList className="h-auto w-full max-w-md mx-auto flex-wrap">
          <TabsTrigger value="interactive" className="min-h-11 flex-1 gap-1.5">
            <TerminalSquare className="size-4" />
            تعاملی
          </TabsTrigger>
          <TabsTrigger value="auto" className="min-h-11 flex-1 gap-1.5">
            <ListChecks className="size-4" />
            خودکار
          </TabsTrigger>
          <TabsTrigger value="dry" className="min-h-11 flex-1 gap-1.5">
            <ShieldCheck className="size-4" />
            Dry-Run
          </TabsTrigger>
        </TabsList>
        <TabsContent value="interactive" className="mt-4">
          <Card className="bg-card/70">
            <CardContent className="p-5">
              <p className="mb-4 text-sm leading-7 text-muted-foreground">
                حالت پیش‌فرض و توصیه‌شده — همهٔ سؤال‌ها را قدم‌به‌قدم به فارسی
                می‌پرسد و پیش از هر تغییر خطرناک، تأیید می‌گیرد.
              </p>
              <CodeBlock
                code={'cd headscale-easy-manager\nsudo ./install.sh'}
                language="bash"
                terminal
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="auto" className="mt-4">
          <Card className="bg-card/70">
            <CardContent className="space-y-4 p-5">
              <p className="text-sm leading-7 text-muted-foreground">
                برای اتوماسیون (Ansible و…): پاسخ‌ها را در فایل پیکربندی بگذارید و
                بدون هیچ سؤال نصب کنید. فایل را حتماً با chmod 600 محافظت کنید.
              </p>
              <CodeBlock
                code={
                  'cp examples/hem-install.conf.example hem-install.conf\nnano hem-install.conf\nchmod 600 hem-install.conf\nsudo ./install.sh --config hem-install.conf --non-interactive'
                }
                language="bash"
                terminal
              />
              <CodeBlock
                code={AUTO_INSTALL_CONF_SAMPLE}
                language="yaml"
                title="hem-install.conf (نمونه)"
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="dry" className="mt-4">
          <Card className="bg-card/70">
            <CardContent className="p-5">
              <p className="mb-4 text-sm leading-7 text-muted-foreground">
                همهٔ ۱۷ گام را اجرا و نمایش می‌دهد اما <strong>هیچ چیزی را اعمال
                نمی‌کند</strong> — بهترین راه برای دیدن اینکه دقیقاً چه قرار است روی
                سرور شما اتفاق بیفتد.
              </p>
              <CodeBlock
                code="sudo ./install.sh --dry-run"
                language="bash"
                terminal
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* پیش‌نیازها */}
      <section aria-label="پیش‌نیازها" className="mb-10">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-foreground">
          <Cloud className="size-5 text-emerald-600 dark:text-emerald-400" />
          پیش‌نیازها — قبل از شروع
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {PREREQS.map((p) => {
            const Icon = p.icon
            return (
              <Card key={p.title} className="bg-card/70 transition-colors hover:border-emerald-500/40">
                <CardContent className="space-y-3 p-5">
                  <div className="inline-flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="text-sm font-bold text-foreground">{p.title}</h3>
                  <p className="text-[13px] leading-6 text-muted-foreground">{p.body}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </section>

      {/* تایم‌لاین ۱۷ گام */}
      <section aria-label="گام‌های نصب" className="mb-10">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-foreground">
          <ListChecks className="size-5 text-emerald-600 dark:text-emerald-400" />
          نصب در ۱۷ گام — چه می‌گذرد؟
        </h2>
        <p className="mb-6 text-[13px] text-muted-foreground">
          هر گام یکی از سه وضعیت را نشان می‌دهد: موفق، ناموفق (با توقف و پیام روشن)
          یا «نیازمند اقدام شما». اگر نصب جایی متوقف شد، مشکل را حل کنید و همان دستور
          را دوباره اجرا کنید — گام‌های انجام‌شده تکرار نمی‌شوند.
        </p>
        <div className="relative space-y-3 ps-8">
          <span
            aria-hidden
            className="absolute inset-y-2 start-3 w-0.5 rounded bg-gradient-to-b from-emerald-500/60 via-border to-transparent"
          />
          {INSTALL_STEPS.map((step, i) => (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-20px' }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.35) }}
              className="relative"
            >
              <span
                aria-hidden
                className={cn(
                  'absolute -start-8 top-4 inline-flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-black',
                  step.risk === 'risky'
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                )}
              >
                {step.order}
              </span>
              <Card
                className={cn(
                  'bg-card/70 transition-colors',
                  step.risk === 'risky'
                    ? 'hover:border-amber-500/40'
                    : 'hover:border-emerald-500/40'
                )}
              >
                <CardContent className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-foreground">
                      گام {step.order} — {step.title}
                    </h3>
                    <p className="mt-1 text-[13px] leading-6 text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                  {step.risk === 'risky' ? (
                    <Badge
                      variant="outline"
                      className="w-fit shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    >
                      <ShieldAlert className="size-3" />
                      تغییر واقعی روی سرور
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="w-fit shrink-0 gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    >
                      <ShieldCheck className="size-3" />
                      بدون تغییر / فقط بررسی
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* نمونه دیالوگ */}
      <section aria-label="نمونه گفت‌وگوی نصب" className="mb-10">
        <DialogDemo />
      </section>

      {/* پس از نصب */}
      <section aria-label="پس از نصب" className="mb-10">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-foreground">
          <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
          پس از نصب چه اتفاقی می‌افتد؟ — چک‌لیست سلامت
        </h2>
        <p className="mb-6 text-[13px] text-muted-foreground">
          اگر هر سه تست سبز بودند، سرور شما آماده است — وقت اتصال اولین دستگاه است
          (فصل ۵).
        </p>
        <div className="space-y-4">
          {POST_INSTALL_CHECKS.map((check) => (
            <Card key={check.title} className="bg-card/70">
              <CardContent className="space-y-3 p-5">
                <h3 className="text-sm font-bold text-foreground">{check.title}</h3>
                <CodeBlock code={check.command} language="bash" terminal />
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
                  <p className="mb-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                    خروجی مورد انتظار:
                  </p>
                  <pre
                    dir="ltr"
                    className="overflow-x-auto custom-scrollbar whitespace-pre text-start font-mono text-xs leading-6 text-foreground/80"
                  >
                    {check.expected}
                  </pre>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* پرسش‌های پرتکرار */}
      <section aria-label="پرسش‌های پرتکرار">
        <h2 className="mb-4 text-lg font-bold text-foreground">پرسش‌های پرتکرار نصب</h2>
        <Card className="bg-card/70">
          <CardContent className="p-2 sm:p-4">
            <Accordion type="single" collapsible>
              {INSTALL_FAQ.map((faq, i) => (
                <AccordionItem key={faq.question} value={`faq-${i}`}>
                  <AccordionTrigger className="min-h-11 text-start text-sm font-bold">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-[13px] leading-7 text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
