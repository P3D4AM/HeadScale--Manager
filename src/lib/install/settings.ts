'use client'

/**
 * پیش‌فرض‌ها و پیش‌نویس تنظیمات نصب.
 * پیش‌نویس فقط «تنظیمات» است (بدون هیچ سری) و در localStorage با کلید
 * hem-install-draft ذخیره می‌شود.
 */

import type { InstallPlanField, InstallSettings } from './types'

export const INSTALL_DRAFT_KEY = 'hem-install-draft'

export interface InstallDraft {
  settings: InstallSettings
  savedAt: string
}

/** ساخت مقدار پیش‌فرض فرم از روی planInputsSchema واقعی */
export function defaultsFromSchema(schema: InstallPlanField[]): InstallSettings {
  const out: Record<string, unknown> = {}
  for (const f of schema) {
    if (f.agentManaged) continue // agent خودش مقدار می‌دهد
    const d = f.default
    if (f.type === 'string[]') {
      out[f.key] = Array.isArray(d) ? [...(d as string[])] : []
    } else if (f.type === 'object[]') {
      out[f.key] = []
    } else if (f.type === 'boolean') {
      out[f.key] = typeof d === 'boolean' ? d : false
    } else if (f.type === 'enum') {
      const opts = f.enum ?? f.options ?? []
      out[f.key] = typeof d === 'string' && d !== '' ? d : (opts[0] ?? '')
    } else if (f.type === 'number') {
      // ssh_port: پیش‌فرض واقعی «خالی» است (تشخیص خودکار)
      out[f.key] = typeof d === 'number' ? d : ''
    } else {
      out[f.key] = typeof d === 'string' ? d : ''
    }
  }
  return out as InstallSettings
}

/** ادغام پیش‌نویس ذخیره‌شده روی پیش‌فرض‌ها (کلیدهای ناشناخته حذف می‌شوند) */
export function mergeDraftOverDefaults(
  defaults: InstallSettings,
  draft: InstallSettings | undefined | null
): InstallSettings {
  if (!draft || typeof draft !== 'object') return { ...defaults }
  const out: Record<string, unknown> = { ...defaults }
  for (const key of Object.keys(defaults)) {
    const v = (draft as Record<string, unknown>)[key]
    if (v === undefined) continue
    const defType = Array.isArray((defaults as Record<string, unknown>)[key])
    if (defType) {
      if (Array.isArray(v)) out[key] = v
    } else if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') {
      out[key] = v
    }
  }
  return out as InstallSettings
}

export function loadInstallDraft(): InstallDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(INSTALL_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as InstallDraft
    if (!parsed || typeof parsed !== 'object' || typeof parsed.settings !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export function saveInstallDraft(settings: InstallSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      INSTALL_DRAFT_KEY,
      JSON.stringify({ settings, savedAt: new Date().toISOString() } satisfies InstallDraft)
    )
  } catch {
    // حافظهٔ پر/غیرفعال — نادیده
  }
}

export function clearInstallDraft(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(INSTALL_DRAFT_KEY)
  } catch {
    /* ignore */
  }
}
