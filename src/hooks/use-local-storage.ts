'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

const SERVER_SNAPSHOT: string | null = null

/**
 * استور localStorage به‌صورت useSyncExternalStore — سازگار با SSR
 * (در هیدریشن مقدار پیش‌فرض، سپس مقدار واقعی کلاینت بدون خطای mismatch).
 */
export function useLocalStorageJson<T>(key: string, fallback: T) {
  // مقدار fallback فقط یک‌بار (اولین رندر) منجمد می‌شود
  const [initialFallback] = useState(fallback)

  const subscribe = useCallback(
    (onChange: () => void) => {
      const evt = `ls:${key}`
      window.addEventListener('storage', onChange)
      window.addEventListener(evt, onChange)
      return () => {
        window.removeEventListener('storage', onChange)
        window.removeEventListener(evt, onChange)
      }
    },
    [key]
  )

  const getSnapshot = useCallback(() => localStorage.getItem(key), [key])

  const raw = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT)

  const value = useMemo<T>(() => {
    if (raw == null) return initialFallback
    try {
      const parsed = JSON.parse(raw) as T
      return parsed ?? initialFallback
    } catch {
      return initialFallback
    }
  }, [raw, initialFallback])

  const set = useCallback(
    (updater: (prev: T) => T) => {
      let prev: T | undefined
      try {
        const prevRaw = localStorage.getItem(key)
        if (prevRaw != null) prev = JSON.parse(prevRaw) as T
      } catch {
        // مقدار خراب → پیش‌فرض
      }
      const next = updater(prev ?? initialFallback)
      try {
        localStorage.setItem(key, JSON.stringify(next))
        window.dispatchEvent(new Event(`ls:${key}`))
      } catch {
        // حافظهٔ پر/غیرفعال → نادیده
      }
    },
    [key, initialFallback]
  )

  return [value, set] as const
}
