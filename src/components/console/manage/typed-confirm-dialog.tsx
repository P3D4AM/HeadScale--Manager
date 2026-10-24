'use client'

/**
 * دیالوگ تأیید تایپی — برای عملیات مخرب (حذف کاربر/دستگاه).
 * کاربر باید عین نام واقعی شیء را تایپ کند تا دکمهٔ تأیید فعال شود؛
 * نام از دادهٔ واقعی سرور می‌آید، نه از ورودی کاربر.
 */

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface TypedConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** نام دقیقی که باید تایپ شود (مثلاً نام کاربر) */
  typedName: string
  /** توضیح هویت واقعی شیء (شناسه/نام) */
  targetLabel: React.ReactNode
  /** متن هشدار قرمز — پیامدهای واقعی */
  warning: React.ReactNode
  /** محتوای توضیحی اضافی */
  children?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  pending?: boolean
}

export function TypedConfirmDialog(props: TypedConfirmDialogProps) {
  const { open, onOpenChange, pending, typedName } = props
  return (
    <AlertDialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      {/* کلید = typedName: با تغییر هدف، ورودی تایپی از نو شروع می‌شود؛
          بستن دیالوگ هم محتوای Radix را unmount می‌کند و state پاک می‌شود. */}
      <TypedConfirmInner key={typedName} {...props} />
    </AlertDialog>
  )
}

function TypedConfirmInner({
  title,
  typedName,
  targetLabel,
  warning,
  children,
  confirmLabel,
  onConfirm,
  pending,
}: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const ready = typed.trim() === typedName && typedName.length > 0 && !pending

  return (
    <AlertDialogContent className="max-w-lg">
      <AlertDialogHeader className="text-start">
        <AlertDialogTitle className="flex items-center gap-2 text-start">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
            <AlertTriangle className="size-5" />
          </span>
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-4 text-start">
            <p className="text-[13px] leading-7 text-muted-foreground">{targetLabel}</p>

            {children}

            <div className="rounded-xl border border-red-500/40 bg-red-500/[0.06] p-3.5 text-[13px] leading-7 text-red-700 dark:text-red-300">
              {warning}
            </div>

            <div className="space-y-2">
              <Label htmlFor="typed-confirm-input" className="text-[13px] font-bold text-foreground">
                برای تأیید، این نام را دقیقاً تایپ کنید:{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground" dir="ltr">
                  {typedName}
                </code>
              </Label>
              <Input
                id="typed-confirm-input"
                dir="ltr"
                className="h-11 rounded-xl text-start font-mono"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={typedName}
                autoComplete="off"
                spellCheck={false}
                disabled={pending}
              />
            </div>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="flex-row gap-2 sm:justify-start">
        <Button
          variant="destructive"
          className="h-11 min-w-32 gap-2 rounded-xl font-bold"
          disabled={!ready}
          onClick={onConfirm}
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : null}
          {confirmLabel}
        </Button>
        <AlertDialogCancel className="h-11 min-w-28 rounded-xl font-bold" disabled={pending}>
          انصراف
        </AlertDialogCancel>
      </AlertDialogFooter>
    </AlertDialogContent>
  )
}

/**
 * دیالوگ تأیید ساده (بدون تایپ) — برای عملیات حساس اما غیر مخرب
 * (منقضی‌کردن دستگاه، لغو همهٔ مسیرها، اعمال سیاست و…).
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = 'default',
  onConfirm,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  tone?: 'default' | 'warning' | 'destructive'
  onConfirm: () => void
  pending?: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => (pending ? undefined : onOpenChange(o))}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-start text-[13px] leading-7 text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-2 sm:justify-start">
          <Button
            className="h-11 min-w-32 gap-2 rounded-xl font-bold"
            variant={tone === 'warning' ? 'outline' : tone === 'destructive' ? 'destructive' : 'default'}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
          <AlertDialogCancel className="h-11 min-w-28 rounded-xl font-bold" disabled={pending}>
            انصراف
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
