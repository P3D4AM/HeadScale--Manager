'use client'

import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Cctv,
  Eye,
  KeyRound,
  ListChecks,
  Network,
  Router,
  ShieldCheck,
  Smartphone,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { CodeBlock } from '../code-block'
import { navigate } from '@/lib/nav'
import { useLocalStorageJson } from '@/hooks/use-local-storage'

const ACCEPT_KEY = 'hem-camera-acceptance'

const ACCEPTANCE_ITEMS = [
  'اتصال VPN روی گوشی — اپ Tailscale: متصل و سبز',
  'دسترسی به شبکهٔ دفتر — CRM دفتر از مرورگر گوشی باز می‌شود',
  'CRM روی گوشی با اینترنت همراه — صفحهٔ ورود CRM بالا می‌آید',
  'NVR با IP داخلی از تونل — hsctl cameras check همه‌چیز ✔',
  'احراز هویت NVR — ورود موفق با حساب دستگاه در اپ/مرورگر',
  'تصویر زنده با اپ سازگار — چند دوربین، تصویر زنده و روان',
  'تکرار با اینترنت همراه (بدون وای‌فای) — همهٔ موارد بالا با دادهٔ همراه هم کار می‌کند',
  'اینترنت عادی گوشی از مسیر خودش — با VPN خاموش، مرور وب عادی است (بدون Exit Node)',
  'هیچ پورت مدیریتی روی اینترنت باز نشده — فقط درهای سرور باز است، نه دفتر',
]

const CHECK_MEANINGS = [
  {
    part: '۱) مسیر (Route) شبکه مقصد',
    meaning: 'جاده به شبکهٔ دفتر در سرور ثبت و تأیید شده',
    broken: 'مسیر حذف/تأییدنشده است → فصل ۶ و خطای ۸ فصل ۹',
  },
  {
    part: '۲) دستگاه ساب‌نت‌روتر',
    meaning: 'کامپیوتر پل دفتر روشن و عضو فعال تونل است',
    broken: 'دستگاه دفتر خاموش/آفلاین است → روشنش کنید و tailscale status بگیرید',
  },
  {
    part: '۳) دسترسی به دستگاه NVR',
    meaning: 'خودِ NVR از مسیر تونل به پورت‌هایش پاسخ می‌دهد',
    broken: 'دستگاه خاموش است، IP عوض شده، یا فایروال دفتر مسیر را بسته',
  },
]

function PathFlow() {
  const nodes = [
    { icon: Smartphone, label: 'گوشی', sub: 'هر جای دنیا' },
    { icon: ShieldCheck, label: 'تونل VPN', sub: 'رمزنگاری‌شده' },
    { icon: Router, label: 'ساب‌نت‌روتر', sub: 'کامپیوتر دفتر' },
    { icon: Network, label: 'LAN دفتر', sub: '192.168.1.0/24' },
    { icon: Cctv, label: 'NVR', sub: '192.168.1.108' },
  ]
  return (
    <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-center sm:gap-0">
      {nodes.map((n, i) => {
        const Icon = n.icon
        return (
          <div key={n.label} className="flex items-center gap-1 sm:gap-0">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: i * 0.08 }}
              className="flex min-w-28 flex-1 flex-col items-center gap-1.5 rounded-xl border bg-card px-3 py-4 text-center"
            >
              <Icon className="size-6 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[13px] font-bold text-foreground">{n.label}</span>
              <span className="text-[10px] text-muted-foreground">{n.sub}</span>
            </motion.div>
            {i < nodes.length - 1 && (
              <>
                <ChevronLeft
                  className="hidden size-6 shrink-0 text-emerald-500/70 sm:block"
                  aria-hidden
                />
                <ChevronDown
                  className="mx-auto size-5 shrink-0 text-emerald-500/70 sm:hidden"
                  aria-hidden
                />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AcceptanceChecklist() {
  const [stored, setStored] = useLocalStorageJson<boolean[]>(
    ACCEPT_KEY,
    Array(9).fill(false)
  )
  const checked = stored.length === 9 ? stored : Array(9).fill(false)

  const toggle = (i: number) => {
    setStored((prev) => {
      const base = prev.length === 9 ? [...prev] : Array(9).fill(false)
      base[i] = !base[i]
      return base
    })
  }

  const done = checked.filter(Boolean).length

  return (
    <Card className="bg-card/70">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
            <ListChecks className="size-5 text-emerald-600 dark:text-emerald-400" />
            تست پذیرش — چک‌لیست ۹ بندی
          </h3>
          <Badge
            variant="outline"
            className={cn(
              'gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              done === 9 && 'border-emerald-500 bg-emerald-500 text-white dark:text-slate-950'
            )}
          >
            {done === 9 ? 'همه تأیید شد ✓' : `${done} از ۹`}
          </Badge>
        </div>
        <Progress
          value={(done / 9) * 100}
          className="mb-5 h-2 [&>div]:bg-emerald-600 dark:[&>div]:bg-emerald-400"
        />
        <ul className="space-y-1">
          {ACCEPTANCE_ITEMS.map((item, i) => (
            <li key={item}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-muted/60">
                <Checkbox
                  checked={checked[i]}
                  onCheckedChange={() => toggle(i)}
                  aria-label={`بند ${i + 1}: ${item}`}
                  className="data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600 dark:data-[state=checked]:border-emerald-500 dark:data-[state=checked]:bg-emerald-500"
                />
                <span
                  className={cn(
                    'text-[13px] leading-6',
                    checked[i]
                      ? 'text-muted-foreground line-through decoration-emerald-500/50'
                      : 'text-foreground/90'
                  )}
                >
                  <span className="me-1 font-bold text-emerald-600 dark:text-emerald-400">
                    {i + 1}.
                  </span>
                  {item}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2.5 text-xs leading-6 text-amber-800 dark:text-amber-200">
          <strong>صداقت در گزارش نتیجه:</strong> فقط وقتی هر سه لایه (شبکه + احراز
          هویت + تصویر زنده، آن هم با اینترنت همراه) موفق بود، حق دارید بنویسید
          «اتصال تصویری از راه دور تأیید شد» — نه قبل از آن.
        </p>
      </CardContent>
    </Card>
  )
}

export function CamerasSection() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      {/* سربرگ */}
      <div className="mb-8 text-center">
        <Badge
          variant="outline"
          className="mb-4 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <Cctv className="size-3.5" />
          دوربین‌های مداربسته
        </Badge>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          دیدن دوربین‌ها از راه دور — بدون باز کردن هیچ پورتی
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          دسترسی امن به دستگاه ضبط (NVR/DVR) و دوربین‌ها از هر جای دنیا — حتی پشت
          CGNAT اپراتور. شبکهٔ دفتر از بیرون کاملاً بسته می‌ماند و دسترسی فقط از
          درون تونل رمزنگاری‌شده انجام می‌شود.
        </p>
      </div>

      {/* چرا بهتر از پورت‌فورواردینگ */}
      <Card className="mb-8 border-red-500/25 bg-red-500/[0.04]">
        <CardContent className="p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-300">
            <AlertTriangle className="size-5 shrink-0" />
            چرا روش سنتی «فورواردکردن پورت دوربین» بد است؟
          </p>
          <ul className="space-y-2 text-[13px] leading-6 text-foreground/80">
            <li>• دستگاه‌های مداربسته از نظر امنیتی ضعیف‌اند — رمزهای پیش‌فرض شناخته‌شده و حفره‌های قدیمی، آن‌ها را هدف اول اسکنرهای اینترنتی کرده است.</li>
            <li>• اصلاً ممکن نیست وقتی اینترنت دفتر CGNAT است و IP عمومی واقعی ندارید.</li>
            <li>• اگر خراب شود هیچ هشداری نمی‌گیرید و فقط «یک درِ باز» روی اینترنت باقی می‌ماند.</li>
          </ul>
        </CardContent>
      </Card>

      {/* مسیر */}
      <section aria-label="مسیر دسترسی" className="mb-8">
        <h2 className="mb-5 flex items-center gap-2 text-lg font-bold text-foreground">
          <Camera className="size-5 text-emerald-600 dark:text-emerald-400" />
          مسیر دسترسی
        </h2>
        <PathFlow />
      </section>

      {/* هشدار سه لایه */}
      <Card className="mb-10 border-amber-500/35 bg-amber-500/[0.06]">
        <CardContent className="space-y-4 p-5">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-5 shrink-0" />
            سه لایه متفاوتند — این‌ها را همیشه از هم جدا کنید
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-amber-500/25 bg-background/60 p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                <Network className="size-4 text-amber-600 dark:text-amber-400" />
                ۱. دسترسی شبکه
              </p>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                بسته‌ها از گوشی تا NVR می‌رسند و جواب می‌گیرند — با hsctl cameras
                check تأیید می‌شود. پاسخ TCP فقط همین لایه را ثابت می‌کند!
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-background/60 p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                <KeyRound className="size-4 text-amber-600 dark:text-amber-400" />
                ۲. احراز هویت دستگاه
              </p>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                NVR شما را به‌عنوان کاربر مجاز می‌شناسد — با ورود موفق با نام
                کاربری/رمز در اپ یا مرورگر. مسئولش خود دستگاه است (hsctl اصلاً رمز
                نمی‌پرسد).
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/25 bg-background/60 p-3.5">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                <Eye className="size-4 text-amber-600 dark:text-amber-400" />
                ۳. نمایش تصویر
              </p>
              <p className="mt-1.5 text-xs leading-6 text-muted-foreground">
                تصویر زنده واقعاً روی صفحه می‌آید — به سازگاری اپ/مرورگر با مدل دقیق
                دستگاه بستگی دارد.
              </p>
            </div>
          </div>
          <p className="rounded-lg border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5 text-xs font-bold leading-6 text-red-700 dark:text-red-300">
            ⛔ پورت RTSP یا HTTP دوربین/NVR را هرگز روی اینترنت باز نکنید — کل منطق
            این معماری همین است: دسترسی فقط از تونل.
          </p>
        </CardContent>
      </Card>

      {/* گام‌ها */}
      <section aria-label="گام‌های راه‌اندازی" className="space-y-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
          <ListChecks className="size-5 text-emerald-600 dark:text-emerald-400" />
          راه‌اندازی در ۵ گام
        </h2>

        {/* گام ۱ */}
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-black text-white dark:bg-emerald-500 dark:text-slate-950">۱</span>
              پیش‌نیاز: مسیر شبکهٔ دفتر فعال باشد (فصل ۶)
            </h3>
            <p className="text-[13px] leading-6 text-muted-foreground">
              ساب‌نت‌روتر دفتر وصل و آنلاین باشد؛ مسیر شبکهٔ دفتر در سرور تأیید
              شده باشد؛ و از یک کلاینت (گوشی/لپ‌تاپ با VPN روشن) صفحهٔ CRM دفتر باز
              شود. بدون این پایه، هیچ دوربینی از راه دور دیده نخواهد شد.
            </p>
            <CodeBlock code={'hsctl routes list'} language="bash" terminal />
            <button
              type="button"
              onClick={() => navigate('#/learn/6')}
              className="text-xs font-bold text-primary hover:underline"
            >
              ← آموزش کامل فصل ۶ (دسترسی به شبکهٔ دفتر)
            </button>
          </CardContent>
        </Card>

        {/* گام ۲ */}
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-black text-white dark:bg-emerald-500 dark:text-slate-950">۲</span>
              ثبت دستگاه: hsctl cameras add
            </h3>
            <p className="text-[13px] leading-6 text-muted-foreground">
              روی سرور اجرا کنید — پرسش‌ها یکی‌یکی پرسیده می‌شوند. پورت‌ها
              اختیاری‌اند (اگر نمی‌دانید خالی بگذارید، هرگز حدس نزنید) و ابزار{' '}
              <strong>هیچ رمز یا نام کاربری دوربینی نمی‌پرسد</strong>. در بیشتر
              سامانه‌ها همهٔ دوربین‌ها از یک IP واحد NVR قابل مشاهده‌اند.
            </p>
            <CodeBlock
              code={
                'sudo hsctl cameras add\n\nنام یکتا برای این دستگاه (مثلاً nvr-daftar): nvr-daftar\nبرند سازنده [dahua/hikvision/other]: dahua\nIP داخلی دستگاه در شبکه دفتر (مثلاً 192.168.1.108): 192.168.1.108\nپورت وب مدیریتی — اگر می‌دانید وارد کنید، در غیر این صورت خالی بگذارید: 80\nپورت پخش تصویر (RTSP) — اگر می‌دانید وارد کنید، در غیر این صورت خالی بگذارید: 554\n\n[✓] دستگاه «nvr-daftar» ثبت شد.\nبررسی اولیه اتصال: hsctl cameras check --name nvr-daftar'
              }
              language="text"
              title="نمونهٔ گفت‌وگو"
            />
          </CardContent>
        </Card>

        {/* گام ۳ */}
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-black text-white dark:bg-emerald-500 dark:text-slate-950">۳</span>
              بررسی سه‌لایه: hsctl cameras check
            </h3>
            <CodeBlock
              code={
                'hsctl cameras check --name nvr-daftar\n\nبررسی دستگاه «nvr-daftar» …\n\n۱) مسیر (Route) شبکه مقصد:\n   ✔ رنج 192.168.1.0/24 در سرور موجود و تأییدشده است.\n\n۲) دستگاه ساب‌نت‌روتر:\n   ✔ آنلاین است — آخرین اتصال: ۱ دقیقه پیش.\n\n۳) دسترسی به دستگاه 192.168.1.108:\n   ✔ پورت وب (80): پاسخ می‌دهد.\n   ✔ پورت RTSP (554): پاسخ می‌دهد.\n\nنتیجه: از نظر «لایه شبکه»، مقصد در دسترس است.'
              }
              language="text"
              title="نمونهٔ خروجی"
            />
            <div className="grid gap-2 sm:grid-cols-3">
              {CHECK_MEANINGS.map((m) => (
                <div key={m.part} className="rounded-xl border bg-background/50 p-3">
                  <p className="text-xs font-bold text-foreground">{m.part}</p>
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-5 text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-500" />
                    {m.meaning}
                  </p>
                  <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-5 text-muted-foreground">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-500" />
                    {m.broken}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              💡 گزینهٔ{' '}
              <code dir="ltr" className="rounded bg-muted px-1 py-0.5 font-mono">--from-client</code>{' '}
              همان بررسی را از دید یک دستگاه کلاینت (داخل تونل) اجرا می‌کند.
            </p>
          </CardContent>
        </Card>

        {/* گام ۴ */}
        <Card className="bg-card/70">
          <CardContent className="space-y-3 p-5">
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-emerald-600 text-xs font-black text-white dark:bg-emerald-500 dark:text-slate-950">۴</span>
              اتصال با اپ رسمی سازنده — با IP داخلی
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border bg-background/50 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                  <Smartphone className="size-4 text-emerald-600 dark:text-emerald-400" />
                  از گوشی اندروید (مثال Dahua)
                </p>
                <ol className="list-decimal space-y-1.5 ps-5 text-xs leading-6 text-muted-foreground">
                  <li>اپ رسمی موبایل سازنده (مثل DMSS) را از فروشگاه رسمی (Google Play) نصب کنید — نه از لینک‌های ناشناس و apk های مرموز؛ ناشر اپ را هم تطبیق دهید.</li>
                  <li>دستگاه جدیدی با <strong>IP داخلی NVR</strong> اضافه کنید: آدرس 192.168.1.108 و همان پورت ثبت‌شده (مثلاً 80).</li>
                  <li>VPN روشن باشد — آدرس داخلی فقط از داخل تونل معنا دارد.</li>
                  <li>تصویر زندهٔ چند دوربین را باز کنید (لایه ۳).</li>
                </ol>
              </div>
              <div className="rounded-xl border bg-background/50 p-4">
                <p className="mb-2 text-[13px] font-bold text-foreground">از لپ‌تاپ با مرورگر</p>
                <ol className="list-decimal space-y-1.5 ps-5 text-xs leading-6 text-muted-foreground">
                  <li>VPN لپ‌تاپ روشن.</li>
                  <li>در مرورگر، آدرس پنل وب NVR را باز کنید.</li>
                  <li>با حسابِ خودِ دستگاه وارد شوید (لایه ۲) و تصویر زنده یا تنظیمات را ببینید.</li>
                </ol>
                <CodeBlock code="http://192.168.1.108" language="text" title="آدرس پنل وب NVR" className="mt-2" />
              </div>
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              🔒 چک‌لیست امنیت: رمز پیش‌فرض دستگاه را عوض کنید، حساب «مشاهده‌گر» را
              از «مدیر» جدا کنید، و هیچ رمزی در فایل‌های تنظیمات یا گزارش‌ها
              ذخیره نکنید — جزئیات کامل در{' '}
              <button
                type="button"
                onClick={() => navigate('#/learn/13')}
                className="font-bold text-primary hover:underline"
              >
                فصل ۱۳
              </button>
              .
            </p>
          </CardContent>
        </Card>

        {/* گام ۵ */}
        <AcceptanceChecklist />
      </section>
    </div>
  )
}
