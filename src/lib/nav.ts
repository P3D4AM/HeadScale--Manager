'use client'

import { useSyncExternalStore } from 'react'

export type SectionId =
  | 'home'
  | 'learn'
  | 'install'
  | 'cli'
  | 'cameras'
  | 'troubleshoot'
  | 'project'

export interface Route {
  section: SectionId
  chapter: number | null
}

export const SECTION_TITLES: Record<SectionId, string> = {
  home: 'خانه',
  learn: 'مرکز آموزش',
  install: 'راهنمای نصب',
  cli: 'مرجع دستورات',
  cameras: 'دوربین‌های مداربسته',
  troubleshoot: 'عیب‌یابی',
  project: 'پروژه',
}

export function parseHash(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '')
  const [seg, sub] = clean.split('/')
  switch (seg) {
    case 'learn': {
      const n = sub ? Number.parseInt(sub, 10) : NaN
      return {
        section: 'learn',
        chapter: Number.isFinite(n) && n >= 1 && n <= 14 ? n : null,
      }
    }
    case 'install':
    case 'cli':
    case 'cameras':
    case 'troubleshoot':
    case 'project':
      return { section: seg, chapter: null }
    default:
      return { section: 'home', chapter: null }
  }
}

const HOME_ROUTE: Route = { section: 'home', chapter: null }

let currentRoute: Route =
  typeof window !== 'undefined' ? parseHash(window.location.hash) : HOME_ROUTE

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    currentRoute = parseHash(window.location.hash)
    emit()
  })
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

/** hook اصلی مسیر — با hashchange همگام می‌ماند */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
