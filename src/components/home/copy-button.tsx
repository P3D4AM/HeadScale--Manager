'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

/** کپی با fallback برای مرورگرهای بدون Clipboard API */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // ادامه با روش قدیمی
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function CopyButton({
  text,
  className,
  label = 'کپی',
}: {
  text: string
  className?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onCopy = useCallback(async () => {
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    }
  }, [text])

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? 'کپی شد' : label}
      className={cn(
        'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-border/70 bg-background/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        copied && 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400',
        className
      )}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      <span className="hidden sm:inline">{copied ? 'کپی شد!' : label}</span>
    </button>
  )
}
