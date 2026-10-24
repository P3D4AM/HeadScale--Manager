'use client'

/**
 * استپر ۵ مرحله‌ای ویزارد نصب — RTL، با حالت انجام‌شده/جاری/آینده.
 * مراحل قبلی کلیک‌پذیرند (بازگشت)، مرحلهٔ جاری هم کلیک‌پذیر، مراحل بعدی غیرفعال.
 */

import { Check } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { InstallStage } from '@/lib/install/stage-url'

export interface StageMetaInfo {
  id: InstallStage
  title: string
  hint: string
}

export const INSTALL_STAGE_META: StageMetaInfo[] = [
  { id: 1, title: 'بررسی سرور', hint: 'کاوش واقعی امکانات و موانع' },
  { id: 2, title: 'تنظیمات نصب', hint: 'پاسخ پرسش‌های نصب‌کننده' },
  { id: 3, title: 'پیش‌نمایش و اعتبارسنجی', hint: 'Dry-Run بدون تغییر سرور' },
  { id: 4, title: 'اجرا', hint: 'نصب واقعی با خروجی زنده' },
  { id: 5, title: 'نتیجه', hint: 'گزارش صادقانهٔ نهایی' },
]

export function InstallStepper({
  current,
  maxReached,
  onGo,
}: {
  current: InstallStage
  /** بالاترین مرحله‌ای که کاربر به آن رسیده (برای فعال‌بودن کلیک) */
  maxReached: InstallStage
  onGo: (stage: InstallStage) => void
}) {
  return (
    <nav aria-label="مراحل نصب" className="w-full">
      <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {INSTALL_STAGE_META.map((s) => {
          const done = s.id < current
          const active = s.id === current
          const reachable = s.id <= maxReached
          return (
            <li key={s.id} className="flex-1">
              <button
                type="button"
                disabled={!reachable}
                aria-current={active ? 'step' : undefined}
                onClick={() => reachable && onGo(s.id)}
                className={cn(
                  'group flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition-all sm:min-h-[72px] sm:flex-col sm:items-start sm:gap-1 sm:px-4',
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/10 shadow-sm shadow-emerald-500/10'
                    : done
                      ? 'border-border/80 bg-card/70 hover:border-emerald-500/40'
                      : 'border-dashed border-border/60 bg-transparent',
                  reachable ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'
                )}
              >
                <span className="flex items-center gap-2.5 sm:order-2">
                  <span
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black transition-colors',
                      active
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950'
                        : done
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {done ? (
                      <Check className="size-4" aria-hidden />
                    ) : (
                      <span aria-hidden>{s.id.toLocaleString('fa-IR')}</span>
                    )}
                    <span className="sr-only">
                      {done ? 'مرحلهٔ انجام‌شده: ' : 'مرحلهٔ '}
                      {s.title}
                    </span>
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-sm font-bold',
                      active ? 'text-foreground' : 'text-foreground/80'
                    )}
                  >
                    {s.title}
                  </span>
                  <span className="hidden text-[11px] leading-4 text-muted-foreground sm:block">
                    {s.hint}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      {/* خط پیشرفت موبایل */}
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted sm:hidden" aria-hidden>
        <motion.div
          className="h-full rounded-full bg-emerald-500"
          initial={false}
          animate={{ width: `${(current / 5) * 100}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </nav>
  )
}
