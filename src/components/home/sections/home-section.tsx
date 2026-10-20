'use client'

import {
  BookOpenCheck,
  Cctv,
  CheckCircle2,
  FileCode2,
  GitBranch,
  HeartHandshake,
  Languages,
  Rocket,
  ShieldCheck,
  TerminalSquare,
  Workflow,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { navigate } from '@/lib/nav'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ArchitectureDiagram } from '../architecture-diagram'
import { CodeBlock } from '../code-block'

const FEATURES = [
  {
    icon: Rocket,
    title: 'نصب یک‌دستوری',
    body: 'از یک VPS خام اوبونتو تا سرور Headscale فعال با HTTPS معتبر — فقط با sudo ./install.sh. ۱۷ گام خودکار با توضیح فارسی در هر قدم.',
  },
  {
    icon: ShieldCheck,
    title: 'امنیت پیش‌فرض',
    body: 'دانلود بسته فقط از ریلیز رسمی GitHub با راستی‌آزمایی SHA-256، گواهی معتبر Let’s Encrypt، فایروال حداقلی و محوسازی خودکار اطلاعات حساس در لاگ‌ها.',
  },
  {
    icon: HeartHandshake,
    title: 'احترام به سرویس موجود',
    body: 'Caddy/Headscale از قبل نصب‌شده را تشخیص می‌دهد، قبل از هر تغییری پشتیبان می‌گیرد و به سرویس‌های نامرتبط سرور شما دستی نمی‌زند.',
  },
  {
    icon: Workflow,
    title: 'Subnet Router و دسترسی CRM',
    body: 'دسترسی امن به شبکهٔ دفتر (192.168.1.0/24) و سیستم CRM از هر جای دنیا — گام‌به‌گام در فصل ۶ با hsctl routes.',
  },
  {
    icon: Cctv,
    title: 'دوربین‌های مداربسته',
    body: 'دسترسی امن به NVR و دوربین‌ها از راه دور، بدون باز کردن هیچ پورتی روی اینترنت — حتی پشت CGNAT. با hsctl cameras.',
  },
  {
    icon: BookOpenCheck,
    title: '۱۴ فصل آموزش فارسی',
    body: 'از «VPN چیست؟» تا پروژهٔ عملی و دوربین‌های مداربسته — مبتدی‌پسند، با تشبیه‌های مشخص و مرز صادقانهٔ تشبیه و واقعیت.',
  },
]

const STATS = [
  { value: '۱۴', label: 'فصل آموزش فارسی' },
  { value: '۱۷', label: 'گام نصب خودکار' },
  { value: '+۲۰', label: 'دستور مدیریت hsctl' },
  { value: '۵۳', label: 'تست خودکار (pytest)' },
]

export function HomeSection() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
      {/* ─── Hero ─── */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col items-center text-center"
      >
        <Badge
          variant="outline"
          className="mb-5 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <GitBranch className="size-3.5" />
          خانهٔ محصول — نسخهٔ 0.1.0
        </Badge>

        <h1 className="max-w-3xl text-3xl font-black leading-tight tracking-tight text-foreground sm:text-4xl md:text-5xl">
          Headscale Easy Manager
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-8 text-muted-foreground sm:text-lg">
          نصب‌کنندهٔ هوشمند، مدیر CLI و راهنمای جامع فارسی برای شبکهٔ خصوصی شما
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            نسخهٔ 0.1.0
          </Badge>
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1.5">
            هدف: Headscale v0.29.5
          </Badge>
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1.5">
            <Languages className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            ۱۰۰٪ فارسی
          </Badge>
          <Badge variant="secondary" className="gap-1.5 rounded-full px-3 py-1.5">
            متن‌باز (MIT)
          </Badge>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            onClick={() => navigate('#/install')}
            className="h-12 gap-2 rounded-xl bg-emerald-600 px-7 text-base font-bold text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:shadow-emerald-500/20 dark:hover:bg-emerald-400"
          >
            <Rocket className="size-5" />
            شروع نصب
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate('#/learn')}
            className="h-12 gap-2 rounded-xl px-7 text-base font-bold"
          >
            <BookOpenCheck className="size-5 text-emerald-600 dark:text-emerald-400" />
            مرکز آموزش
          </Button>
        </div>
      </motion.section>

      {/* ─── معماری ─── */}
      <section className="mt-14" aria-label="معماری شبکه">
        <div className="mb-5 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            معماری: VPS فقط هماهنگ‌کننده است
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            گوشی و لپ‌تاپ شما از هر جای دنیا، به شبکهٔ بستهٔ دفتر وصل می‌شوند — بدون
            باز شدن هیچ پورتی
          </p>
        </div>
        <ArchitectureDiagram />

        {/* توضیح صادقانهٔ Control/Data Plane */}
        <Card className="mt-6 border-amber-500/30 bg-amber-500/[0.05]">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
            <FileCode2 className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm leading-7 text-foreground/90">
              <p className="font-bold text-foreground">
                تفاوت Control Plane و Data Plane — حقیقت مهم
              </p>
              <p className="mt-1.5">
                Headscale روی VPS شما فقط «هماهنگ‌کنندهٔ» شبکه است (Control Plane):
                معرفی دستگاه‌ها به هم، تأیید عضویت و تبادل کلید‌ها از اینجا می‌گذرد.
                اما <strong>ترافیک دادهٔ شما معمولاً مستقیماً بین دستگاه‌ها</strong>{' '}
                (رمزنگاری‌شده با WireGuard) جابه‌جا می‌شود و از VPS عبور نمی‌کند؛ VPS
                شما پهنای‌باند شما را مصرف نمی‌کند و محتوای ترافیک‌تان را نمی‌بیند.
                اگر اتصال مستقیم ممکن نباشد، داده از سرور رلهٔ DERP (اختیاری و روی
                همان VPS خودتان) عبور می‌کند.
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ─── آمار ─── */}
      <section aria-label="آمار پروژه" className="mt-14">
        <div className="grid grid-cols-2 gap-3 rounded-2xl border bg-card/60 p-5 sm:grid-cols-4 sm:gap-4 sm:p-7">
          {STATS.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1 text-center">
              <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">
                {s.value}
              </span>
              <span className="text-xs text-muted-foreground sm:text-sm">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ─── ویژگی‌ها ─── */}
      <section aria-label="ویژگی‌ها" className="mt-14">
        <div className="mb-6 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">
            چه کاری برای شما انجام می‌دهد؟
          </h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => {
            const Icon = f.icon
            return (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{ duration: 0.35, delay: i * 0.05 }}
              >
                <Card className="group h-full border-border/80 bg-card/70 transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="inline-flex size-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 transition-colors group-hover:bg-emerald-500/15 dark:text-emerald-400">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="text-base font-bold text-foreground">{f.title}</h3>
                    <p className="text-[13px] leading-6 text-muted-foreground">{f.body}</p>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      </section>

      {/* ─── شروع سریع ─── */}
      <section aria-label="شروع سریع" className="mt-14">
        <div className="mb-5 text-center">
          <h2 className="text-xl font-bold text-foreground sm:text-2xl">شروع سریع</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            پس از ورود به سرور با SSH و دریافت مخزن رسمی پروژه — نصب‌کننده تعاملی
            است و همه‌چیز را قدم‌به‌قدم به فارسی توضیح می‌دهد.
          </p>
        </div>
        <div className="mx-auto max-w-2xl">
          <CodeBlock
            code={'cd headscale-easy-manager\nsudo ./install.sh'}
            language="bash"
            title="شروع نصب — تنها دستور رسمی"
            terminal
          />
          <p className="mt-3 text-center text-xs text-muted-foreground">
            حالت آزمایشی بدون تغییر واقعی:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-emerald-700 dark:text-emerald-400" dir="ltr">
              sudo ./install.sh --dry-run
            </code>
          </p>
        </div>
      </section>

      <Separator className="mt-14" />

      {/* ─── CTA پایانی ─── */}
      <section className="mt-10 rounded-2xl border border-emerald-500/30 bg-gradient-to-b from-emerald-500/10 to-transparent p-6 text-center sm:p-10">
        <h2 className="text-xl font-bold text-foreground sm:text-2xl">
          آمادهٔ ساختن شبکهٔ خصوصی خودتان هستید؟
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-muted-foreground">
          از «VPN چیست؟» شروع کنید یا مستقیم سراغ نصب بروید — هر مسیری، همهٔ
          ابزارها و آموزش‌ها همین‌جا در دسترس‌اند.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            onClick={() => navigate('#/learn/1')}
            className="h-11 gap-2 rounded-xl bg-emerald-600 px-6 font-bold text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400"
          >
            <TerminalSquare className="size-4" />
            از فصل اول شروع کن
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate('#/troubleshoot')}
            className="h-11 gap-2 rounded-xl px-6 font-bold"
          >
            <ShieldCheck className="size-4" />
            راهنمای عیب‌یابی
          </Button>
        </div>
      </section>
    </div>
  )
}
