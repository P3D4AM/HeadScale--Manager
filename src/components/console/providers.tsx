'use client'

/**
 * Providers سمت کلاینت: QueryClient (داده‌های سرور)، اتصال socket به agent،
 * بازگردانی وضعیت اتصال پس از رفرش و Toaster (sonner).
 */

import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { bindAgentSocket, useConnectionStore } from '@/lib/connection-store'

export function AppProviders({ children }: { children: ReactNode }) {
  // QueryClient باید برای هر کاربر یک‌بار ساخته شود (نه در هر رندر)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 10_000,
          },
        },
      })
  )

  // سوکت + بازگردانی وضعیت اتصال — فقط یک‌بار پس از mount
  useEffect(() => {
    const unbind = bindAgentSocket()
    const store = useConnectionStore.persist
    void (async () => {
      try {
        await store.rehydrate()
      } catch {
        /* localStorage غیرفعال — پیش‌فرض قطع */
      }
      await useConnectionStore.getState().verifyOnLoad()
    })()
    return unbind
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster position="bottom-left" dir="rtl" richColors closeButton />
    </QueryClientProvider>
  )
}
