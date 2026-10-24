'use client'

/**
 * قرص وضعیت اتصال در هدر — وضعیت واقعی از connection-store.
 * با کلیک به مرکز اتصال می‌رود؛ در حالت متصل دکمهٔ قطع سریع دارد.
 */

import { useState } from 'react'
import { Loader2, PlugZap, ShieldAlert, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { navigate } from '@/lib/nav'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useConnectionStore } from '@/lib/connection-store'
import { useDisconnect } from './use-agent'

export function ConnectionPill({ compact = false }: { compact?: boolean }) {
  const status = useConnectionStore((s) => s.status)
  const host = useConnectionStore((s) => s.host)
  const username = useConnectionStore((s) => s.username)
  const socketAlive = useConnectionStore((s) => s.socketAlive)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const disconnect = useDisconnect()

  const goConnect = () => navigate('#/connect')

  const doDisconnect = async () => {
    setBusy(true)
    try {
      await disconnect()
      toast.success('اتصال قطع شد.')
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  const meta = (() => {
    switch (status) {
      case 'connected':
        return {
          dot: 'bg-emerald-500',
          pulse: socketAlive,
          label: compact ? `متصل: ${host ?? 'سرور'}` : `متصل به ${host ?? 'سرور'}`,
          title: username ? `${username}@${host ?? ''}` : 'نشست فعال',
          cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300',
        }
      case 'connecting':
        return {
          dot: 'bg-amber-500',
          pulse: false,
          label: 'در حال اتصال…',
          title: 'برقراری ارتباط SSH',
          cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300',
        }
      case 'fingerprint-required':
        return {
          dot: 'bg-amber-500',
          pulse: true,
          label: 'در انتظار تأیید اثرانگشت',
          title: 'تأیید کلید میزبان سرور لازم است',
          cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300',
        }
      case 'error':
        return {
          dot: 'bg-red-500',
          pulse: false,
          label: 'خطا در اتصال',
          title: 'اتصال ناموفق بود — مرکز اتصال را ببینید',
          cls: 'border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15 dark:text-red-300',
        }
      default:
        return {
          dot: 'bg-red-500',
          pulse: false,
          label: 'قطع',
          title: 'به هیچ سروری متصل نیستید',
          cls: 'border-border bg-muted/60 text-muted-foreground hover:bg-muted',
        }
    }
  })()

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={goConnect}
          title={meta.title}
          aria-label={meta.title}
          className={cn(
            'inline-flex h-11 min-w-11 items-center gap-2 rounded-full border px-3 text-xs font-bold transition-colors sm:text-[13px]',
            meta.cls
          )}
        >
          <span className="relative flex size-2.5 shrink-0">
            <span className={cn('absolute inline-flex size-2.5 rounded-full', meta.dot)} />
            {meta.pulse && (
              <span
                className={cn(
                  'absolute inline-flex size-2.5 animate-ping rounded-full opacity-60',
                  meta.dot
                )}
              />
            )}
          </span>
          <span className="max-w-[10rem] truncate sm:max-w-[14rem]">{meta.label}</span>
        </button>

        {status === 'connected' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 text-muted-foreground hover:text-red-500"
            onClick={() => setConfirmOpen(true)}
            title="قطع اتصال"
            aria-label="قطع اتصال از سرور"
          >
            <Unplug className="size-4" />
          </Button>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="size-5 text-red-500" />
              قطع اتصال از سرور؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              نشست SSH فعلی با{' '}
              <span className="font-mono" dir="ltr">
                {username}@{host}
              </span>{' '}
              بسته می‌شود. سرور و سرویس Headscale آن‌طور که هست باقی می‌ماند و فقط
              امکان مدیریت از این برنامه موقتاً قطع می‌شود. با یک کلیک می‌توانید
              دوباره وصل شوید.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>انصراف</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void doDisconnect()
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Unplug className="size-4" />}
              بله، قطع کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** نماد کوچک وضعیت برای کشوی موبایل */
export function ConnectionPillMobile() {
  const status = useConnectionStore((s) => s.status)
  const host = useConnectionStore((s) => s.host)
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 p-3">
      <div className="flex items-center gap-2 text-sm">
        {status === 'connected' ? (
          <PlugZap className="size-4 text-emerald-500" />
        ) : status === 'error' ? (
          <ShieldAlert className="size-4 text-red-500" />
        ) : (
          <Unplug className="size-4 text-muted-foreground" />
        )}
        <span className="font-bold">
          {status === 'connected' ? `متصل به ${host ?? 'سرور'}` : 'اتصال برقرار نیست'}
        </span>
      </div>
      <ConnectionPill compact />
    </div>
  )
}
