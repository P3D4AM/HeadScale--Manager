'use client'

/**
 * کارت نمایش امن کلید کامل (PreAuthKey/API Key).
 * کلید فقط همین یک‌بار از سرور می‌آید؛ هرگز لاگ نمی‌شود و بعد از بستن
 * دیالوگ دیگر در هیچ‌جای رابط در دسترس نیست.
 */

import { useEffect, useState } from 'react'
import { Check, Copy, KeyRound, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function KeyRevealCard({
  label,
  value,
  extra,
  className,
}: {
  /** برچسب کلید (مثلاً «کلید اتصال») */
  label: string
  /** مقدار کامل کلید — فقط برای نمایش در همین کارت */
  value: string
  /** توضیح اضافی زیر کلید (مثلاً تنظیمات ساخت) */
  extra?: React.ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      // کلیپ‌بورد در دسترس نیست — کاربر می‌تواند دستی انتخاب و کپی کند
      setCopied(false)
    }
  }

  return (
    <div className={`space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.05] p-4 sm:p-5 ${className ?? ''}`}>
      <p className="flex items-center gap-2 text-sm font-bold text-foreground">
        <KeyRound className="size-4 text-amber-600 dark:text-amber-400" />
        {label}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code
          dir="ltr"
          className="min-w-0 flex-1 select-all break-all rounded-lg border bg-muted/60 px-3 py-2.5 font-mono text-[13px] leading-6 text-foreground"
        >
          {value}
        </code>
        <Button
          type="button"
          onClick={() => void copy()}
          className="h-11 shrink-0 gap-2 rounded-xl font-bold"
          variant={copied ? 'outline' : 'default'}
          aria-label={copied ? 'کپی شد' : `کپی ${label}`}
        >
          {copied ? <Check className="size-4 text-emerald-500" /> : <Copy className="size-4" />}
          {copied ? 'کپی شد' : 'کپی'}
        </Button>
      </div>
      {extra}
      <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] leading-6 text-amber-800 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" />
        این کلید فقط همین یک‌بار نمایش داده می‌شود؛ آن را در جای امن نگه دارید.
        بعد از بستن این پنجره، سرور فقط نسخهٔ ماسک‌شدهٔ آن را می‌شناسد و بازیابی
        آن ممکن نیست — در صورت گم‌شدن، کلید جدید بسازید و قدیمی را باطل کنید.
      </p>
    </div>
  )
}
