'use client'

/**
 * دیالوگ تأیید عملیات مخرب — با تأیید تایپی اختیاری (typed confirm).
 * شرح عملیات همیشه با نام/متن واقعی هدف توسط فراخواننده ساخته می‌شود.
 *
 * محتوای دیالوگ فقط وقتی باز است mount می‌شود؛ بنابراین وضعیت «تایپ‌شده»
 * به‌طور طبیعی با هر بار باز شدن صفر می‌شود (بدون effect و ریست دستی).
 */

import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  /** اگر مقدار دهد، دکمهٔ تأیید فقط بعد از تایپ «عین» همین متن فعال می‌شود */
  typedMatch?: string | null
  typedLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  if (!props.open) return null
  return <ConfirmDialogInner {...props} />
}

function ConfirmDialogInner({
  onOpenChange,
  title,
  description,
  confirmLabel,
  typedMatch,
  typedLabel,
  danger = true,
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')

  const needTyped = typeof typedMatch === 'string' && typedMatch.length > 0
  const typedOk = !needTyped || typed.trim() === typedMatch

  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle
              className={cn('size-5', danger ? 'text-red-500' : 'text-amber-500')}
            />
            {title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="pt-1 text-[13px] leading-7 text-muted-foreground">
              {description}
            </div>
          </DialogDescription>
        </DialogHeader>

        {needTyped && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-typed" className="text-[13px] font-bold text-foreground">
              {typedLabel ??
                'برای تأیید، عین متن داخل کادر قرمز زیر را اینجا تایپ کنید:'}
            </Label>
            <p
              className="select-none rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-center font-mono text-sm font-bold text-red-600 dark:text-red-300"
              dir="auto"
            >
              {typedMatch}
            </p>
            <Input
              id="confirm-typed"
              dir="auto"
              className="h-11 font-mono"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="…"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            variant="outline"
            className="h-11 rounded-xl px-5 font-bold"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            انصراف
          </Button>
          <Button
            className={cn(
              'h-11 gap-2 rounded-xl px-5 font-bold text-white',
              danger
                ? 'bg-red-600 hover:bg-red-500 dark:bg-red-600 dark:text-white dark:hover:bg-red-500'
                : 'bg-emerald-600 hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400'
            )}
            disabled={!typedOk || busy}
            onClick={onConfirm}
          >
            {busy ? 'در حال انجام…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
