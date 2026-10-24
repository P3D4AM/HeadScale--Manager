'use client'

/**
 * مرحلهٔ ویزارد نصب در پارامتر ?stage= آدرس (query، قبل از hash).
 * چون مسیریابی برنامه hash-based است (nav.ts)، مرحله را در query string
 * نگه می‌داریم تا router مشترک دست‌نخورده بماند:
 *   https://host/?stage=3#/install
 * نکته: history.replaceState هش را تغییر نمی‌دهد → صفحه بازمونت نمی‌شود.
 */

export const INSTALL_STAGES = [1, 2, 3, 4, 5] as const
export type InstallStage = (typeof INSTALL_STAGES)[number]

export function normalizeStage(n: number): InstallStage {
  const i = Math.round(n)
  if (!Number.isFinite(i)) return 1
  return Math.min(5, Math.max(1, i)) as InstallStage
}

/** خواندن مرحله از URL — فقط در کلاینت */
export function readStageFromUrl(): InstallStage {
  if (typeof window === 'undefined') return 1
  const raw = new URLSearchParams(window.location.search).get('stage')
  if (!raw) return 1
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return 1
  return normalizeStage(n)
}

/** نوشتن/حذف مرحله در URL بدون ایجاد رکورد history */
export function writeStageToUrl(stage: InstallStage): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (stage > 1) url.searchParams.set('stage', String(stage))
  else url.searchParams.delete('stage')
  window.history.replaceState(null, '', url.toString())
}

/** پاک‌کردن پارامتر (هنگام ترک بخش) */
export function clearStageFromUrl(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('stage')) return
  url.searchParams.delete('stage')
  window.history.replaceState(null, '', url.toString())
}
