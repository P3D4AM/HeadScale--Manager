'use client'

import { useTheme } from 'next-themes'
import {
  BookOpenCheck,
  Cctv,
  FolderGit2,
  Home,
  Moon,
  Rocket,
  Stethoscope,
  Sun,
  TerminalSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, useRoute, type SectionId } from '@/lib/nav'

const NAV_ITEMS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'home', label: 'خانه', icon: Home },
  { id: 'learn', label: 'مرکز آموزش', icon: BookOpenCheck },
  { id: 'install', label: 'نصب', icon: Rocket },
  { id: 'cli', label: 'دستورات', icon: TerminalSquare },
  { id: 'cameras', label: 'دوربین‌ها', icon: Cctv },
  { id: 'troubleshoot', label: 'عیب‌یابی', icon: Stethoscope },
  { id: 'project', label: 'پروژه', icon: FolderGit2 },
]

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      role="img"
      aria-label="نشان Headscale Easy Manager"
    >
      <defs>
        <linearGradient id="hem-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#0d9488" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#hem-logo-g)" />
      <g stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" opacity="0.95">
        <path d="M24 13 L24 35" />
        <path d="M14 19 L24 13 L34 19" fill="none" />
        <path d="M14 19 L14 30 L24 35 L34 30 L34 19" fill="none" />
      </g>
      <g fill="#ffffff">
        <circle cx="24" cy="13" r="3.4" />
        <circle cx="14" cy="19" r="3.4" />
        <circle cx="34" cy="19" r="3.4" />
        <circle cx="14" cy="30" r="3.4" />
        <circle cx="34" cy="30" r="3.4" />
        <circle cx="24" cy="35" r="3.4" />
      </g>
    </svg>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <button
      type="button"
      aria-label="تغییر حالت روشن/تاریک"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      className="inline-flex size-11 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {/* آیکن‌ها با CSS کنترل می‌شوند تا هیچ ناهماهنگی هیدریشن رخ ندهد */}
      <Sun className="hidden size-5 dark:block" />
      <Moon className="size-5 dark:hidden" />
    </button>
  )
}

export function SiteHeader() {
  const route = useRoute()

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('#/')}
          className="flex min-h-11 items-center gap-3 text-start"
          aria-label="بازگشت به خانه"
        >
          <LogoMark className="size-10 shrink-0" />
          <span className="leading-tight">
            <span className="block text-sm font-black tracking-tight text-foreground sm:text-base">
              Headscale Easy Manager
            </span>
            <span className="block text-[11px] text-muted-foreground">
              مدیر آسان هداسکیل · نسخهٔ 0.1.0
            </span>
          </span>
        </button>

        {/* ناوبری دسکتاپ */}
        <nav aria-label="ناوبری اصلی" className="hidden items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => {
            const active = route.section === item.id
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(`#/${item.id === 'home' ? '' : item.id}`)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
          <ThemeToggle />
        </nav>

        <div className="flex items-center gap-2 lg:hidden">
          <ThemeToggle />
        </div>
      </div>

      {/* ناوبری موبایل — اسکرول افقی */}
      <nav
        aria-label="ناوبری موبایل"
        className="border-t border-border/50 lg:hidden"
      >
        <div className="custom-scrollbar flex gap-1 overflow-x-auto px-3 py-2">
          {NAV_ITEMS.map((item) => {
            const active = route.section === item.id
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(`#/${item.id === 'home' ? '' : item.id}`)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            )
          })}
        </div>
      </nav>
    </header>
  )
}
