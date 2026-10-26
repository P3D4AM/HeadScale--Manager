'use client'

import { useSyncExternalStore } from 'react'

import { DOCS } from '@/generated/docs-content'

/**
 * نقشهٔ مسیرهای کنسول مدیریت (hash-based، بدون سرور).
 * ساختار: section (+ chapter برای آموزش + tab برای راهنما)
 */

export type SectionId =
  | 'dashboard'
  | 'connect'
  | 'install'
  | 'users'
  | 'nodes'
  | 'keys'
  | 'routes'
  | 'policy'
  | 'config'
  | 'server'
  | 'backup'
  | 'console'
  | 'learn'
  | 'help'

export type HelpTab = 'troubleshoot' | 'cli' | 'cameras' | 'install'

export interface Route {
  section: SectionId
  /** شمارهٔ فصل آموزش (۱ تا تعداد فصل‌های موجود) — فقط برای learn */
  chapter: number | null
  /** تب داخل راهنما — فقط برای help */
  tab: HelpTab | null
}

export const SECTION_TITLES: Record<SectionId, string> = {
  dashboard: 'داشبورد',
  connect: 'اتصال',
  install: 'نصب',
  users: 'کاربران',
  nodes: 'دستگاه‌ها',
  keys: 'کلیدها',
  routes: 'مسیرها و Exit Node',
  policy: 'سیاست دسترسی',
  config: 'پیکربندی',
  server: 'سرور و لاگ',
  backup: 'پشتیبان و ارتقا',
  console: 'کنسول پیشرفته',
  learn: 'آموزش',
  help: 'راهنما و عیب‌یابی',
}

/** مسیرهای قدیمی سایت محصول → مقصد جدید (سازگاری لینک‌های اشتراک‌گذاری‌شده) */
const LEGACY_SECTIONS: Partial<Record<string, string>> = {
  cli: '#/help/cli',
  cameras: '#/help/cameras',
  troubleshoot: '#/help/troubleshoot',
  project: '#/',
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [seg, sub] = clean.split('/')
  switch (seg) {
    case 'learn': {
      const n = sub ? Number.parseInt(sub, 10) : NaN
      return {
        section: 'learn',
        // سقف فصل به‌جای عدد ثابت، از تعداد واقعی فصل‌های تولیدشده می‌آید
        chapter: Number.isFinite(n) && n >= 1 && n <= DOCS.length ? n : null,
        tab: null,
      }
    }
    case 'help': {
      const tab: HelpTab | null =
        sub === 'troubleshoot' || sub === 'cli' || sub === 'cameras' || sub === 'install'
          ? sub
          : null
      return { section: 'help', chapter: null, tab }
    }
    case '':
    case undefined:
      return { section: 'dashboard', chapter: null, tab: null }
    case 'connect':
    case 'install':
    case 'users':
    case 'nodes':
    case 'keys':
    case 'routes':
    case 'policy':
    case 'config':
    case 'server':
    case 'backup':
    case 'console':
      return { section: seg as SectionId, chapter: null, tab: null }
    default:
      return { section: 'dashboard', chapter: null, tab: null }
  }
}

const HOME_ROUTE: Route = { section: 'dashboard', chapter: null, tab: null }

let currentRoute: Route =
  typeof window !== 'undefined' ? parseHash(window.location.hash) : HOME_ROUTE

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** هش کامل کانونی برای یک مسیر */
export function routeHash(route: Route): string {
  switch (route.section) {
    case 'dashboard':
      return '#/'
    case 'learn':
      return route.chapter ? `#/learn/${route.chapter}` : '#/learn'
    case 'help':
      return route.tab ? `#/help/${route.tab}` : '#/help'
    default:
      return `#/${route.section}`
  }
}

function handleHashChange(): void {
  const raw = window.location.hash
  // مسیرهای قدیمی (پروژه/دستورات/دوربین‌ها/عیب‌یابی) → جایگزین کانونی
  const seg = raw.replace(/^#\/?/, '').split('/')[0]
  const legacyTarget = LEGACY_SECTIONS[seg]
  if (legacyTarget) {
    window.location.replace(
      `${window.location.pathname}${window.location.search}${legacyTarget}`
    )
    return // hashchange بعدی مسیر جدید را پردازش می‌کند
  }
  currentRoute = parseHash(raw)
  emit()
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', handleHashChange)
  // نرمال‌سازی هش اولیه در بارگذاری صفحه
  const seg = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  const legacyTarget = LEGACY_SECTIONS[seg]
  if (legacyTarget) {
    window.location.replace(
      `${window.location.pathname}${window.location.search}${legacyTarget}`
    )
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): Route {
  return currentRoute
}

function getServerSnapshot(): Route {
  return HOME_ROUTE
}

/** ناوبری برنامه‌ای — hash را تنظیم می‌کند (مثل navigate('#/learn/6')) */
export function navigate(hash: string) {
  if (typeof window === 'undefined') return
  const same = window.location.hash === hash
  window.location.hash = hash
  if (same) {
    currentRoute = parseHash(hash)
    emit()
  }
}

/** رفتن به یک section مشخص */
export function navigateSection(id: SectionId) {
  navigate(routeHash({ section: id, chapter: null, tab: null }))
}

/** hook اصلی مسیر — با hashchange همگام می‌ماند */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
