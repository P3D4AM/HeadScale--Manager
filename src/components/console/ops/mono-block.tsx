'use client'

/**
 * بلوک یکنواخت LTR برای نمایش لاگ/خروجی دستور/df — همیشه چپ‌به‌راست و mono
 * (کد و لاگ فارسی نیست)؛ اسکرول با استایل سفارشی و حداکثر ارتفاع.
 */

import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const MonoBlock = forwardRef<
  HTMLPreElement,
  React.HTMLAttributes<HTMLPreElement> & { maxHeightClass?: string }
>(function MonoBlock(
  { className, maxHeightClass = 'max-h-96', children, ...props },
  ref
) {
  return (
    <pre
      ref={ref}
      dir="ltr"
      tabIndex={0}
      aria-label="خروجی متنی (چپ‌به‌راست)"
      className={cn(
        'custom-scrollbar overflow-auto rounded-xl border border-slate-700/60 bg-slate-950 p-4 text-left font-mono text-[12px] leading-6 text-slate-200 shadow-inner focus:outline-none focus:ring-2 focus:ring-emerald-500/50',
        maxHeightClass,
        className
      )}
      {...props}
    >
      {children}
    </pre>
  )
})

/** خط لاگ job با رنگ استریم — stderr قرمز، stdout روشن */
export function JobLogLines({
  lines,
}: {
  lines: { line: string; stream: 'stdout' | 'stderr' }[]
}) {
  if (lines.length === 0) {
    return (
      <p className="p-4 text-center font-sans text-[12px] text-slate-400">
        در انتظار نخستین خط خروجی…
      </p>
    )
  }
  return (
    <>
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap break-all',
            l.stream === 'stderr' ? 'text-red-400' : 'text-slate-200'
          )}
        >
          {l.line === '' ? '\u00A0' : l.line}
        </div>
      ))}
    </>
  )
}
