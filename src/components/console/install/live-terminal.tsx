'use client'

/**
 * نمایشگر لاگ ترمینالی — LTR و mono (خروجی سرور فارسی/انگلیسی مخلوط است؛
 * چون متن فنی/خروجی است جهت چپ‌به‌راست حفظ می‌شود).
 * اسکرول خودکار تا وقتی کاربر خودش بالا اسکرول نکرده باشد.
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { JobLogEntry } from '@/lib/install/types'

export function LiveTerminal({
  lines,
  className,
  ariaLabel = 'خروجی زندهٔ نصب',
  maxHeight = 'max-h-[420px]',
}: {
  lines: JobLogEntry[]
  className?: string
  ariaLabel?: string
  maxHeight?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  // اسکرول خودکار فقط وقتی کاربر پایین است
  useEffect(() => {
    const el = boxRef.current
    if (!el || !stick) return
    el.scrollTop = el.scrollHeight
  }, [lines, stick])

  const onScroll = () => {
    const el = boxRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    setStick(nearBottom)
  }

  return (
    <div
      dir="ltr"
      role="log"
      aria-label={ariaLabel}
      aria-live="polite"
      className={cn(
        'relative overflow-hidden rounded-xl border border-slate-700/60 bg-slate-950 shadow-inner',
        className
      )}
    >
      {/* نوار ترمینال */}
      <div className="flex items-center justify-between border-b border-slate-700/60 bg-slate-900/80 px-3 py-1.5">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-red-400/80" />
          <span className="size-2.5 rounded-full bg-amber-400/80" />
          <span className="size-2.5 rounded-full bg-emerald-400/80" />
        </div>
        <span className="font-mono text-[11px] text-slate-400">
          install.sh — {lines.length.toLocaleString('en-US')} line{lines.length === 1 ? '' : 's'}
        </span>
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className={cn(
          'hem-terminal-scroll overflow-y-auto px-3 py-2.5 font-mono text-[12px] leading-6 text-slate-200',
          maxHeight
        )}
      >
        {lines.length === 0 ? (
          <p className="py-6 text-center text-slate-500" dir="rtl">
            …در انتظار خروجی
          </p>
        ) : (
          lines.map((l, i) => (
            <div
              key={l.seq ?? `n${i}-${i}`}
              className={cn(
                'whitespace-pre-wrap break-words',
                l.stream === 'stderr' ? 'text-red-300' : 'text-slate-200'
              )}
            >
              {l.line === '' ? '\u00A0' : l.line}
            </div>
          ))
        )}
      </div>
      {!stick && (
        <button
          type="button"
          onClick={() => {
            setStick(true)
            const el = boxRef.current
            if (el) el.scrollTop = el.scrollHeight
          }}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-slate-600 bg-slate-800/95 px-4 py-1.5 text-xs font-bold text-slate-100 shadow-lg transition-colors hover:bg-slate-700"
        >
          ↓ اسکرول به آخرین خط
        </button>
      )}
    </div>
  )
}
