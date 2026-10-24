'use client'

import { useState } from 'react'
import { useTheme } from 'next-themes'
import { ChevronDown, Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routeHash, useRoute, type SectionId } from '@/lib/nav'
import { NAV_GROUPS, SECTION_BY_ID } from '@/components/console/sections/registry'
import { ConnectionPill, ConnectionPillMobile } from '@/components/console/connection-pill'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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

function go(id: SectionId) {
  navigate(routeHash({ section: id, chapter: null, tab: null }))
}

/** دکمهٔ ناوبری ساده (بدون زیرمنو) */
function NavButton({ id }: { id: SectionId }) {
  const route = useRoute()
  const meta = SECTION_BY_ID[id]
  const Icon = meta.icon
  const active = route.section === id
  return (
    <button
      type="button"
      onClick={() => go(id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      )}
    >
      <Icon className="size-4" />
      {meta.navLabel}
    </button>
  )
}

/** گروه ناوبری با منوی کشویی */
function NavGroup({ groupKey }: { groupKey: 'manage' | 'server' | 'learn' }) {
  const route = useRoute()
  const group = NAV_GROUPS.find((g) => g.key === groupKey)
  if (!group) return null
  const groupActive = group.items.some((i) => i.id === route.section)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors data-[state=open]:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          groupActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        )}
        aria-label={group.label}
      >
        {group.label}
        <ChevronDown className="size-3.5 transition-transform data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {group.items.map((item) => {
          const Icon = item.icon
          return (
            <DropdownMenuItem
              key={item.id}
              onClick={() => go(item.id)}
              className="min-h-11 cursor-pointer gap-2.5 px-3 py-2 text-[13px]"
            >
              <Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="flex flex-col">
                <span className="font-bold">{item.navLabel}</span>
                <span className="text-[11px] leading-4 text-muted-foreground">
                  {item.status === 'placeholder' ? 'در حال تکمیل' : item.description.slice(0, 34)}
                </span>
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const core = NAV_GROUPS.find((g) => g.key === 'core')?.items ?? []

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
        {/* لوگو */}
        <button
          type="button"
          onClick={() => go('dashboard')}
          className="flex min-h-11 shrink-0 items-center gap-3 text-start"
          aria-label="بازگشت به داشبورد"
        >
          <LogoMark className="size-10 shrink-0" />
          <span className="hidden leading-tight sm:block">
            <span className="block text-sm font-black tracking-tight text-foreground">
              Headscale Easy Manager
            </span>
            <span className="block text-[11px] text-muted-foreground">
              کنسول مدیریت شبکهٔ خصوصی
            </span>
          </span>
        </button>

        {/* ناوبری دسکتاپ */}
        <nav aria-label="ناوبری اصلی" className="hidden items-center gap-0.5 xl:flex">
          {core.map((item) => (
            <NavButton key={item.id} id={item.id} />
          ))}
          <NavGroup groupKey="manage" />
          <NavButton id="install" />
          <NavGroup groupKey="server" />
          <NavGroup groupKey="learn" />
        </nav>

        <div className="flex items-center gap-2">
          <ConnectionPill />
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>

          {/* کشوی موبایل */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0 xl:hidden"
                aria-label="باز کردن منو"
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </Button>
            </SheetTrigger>
            <SheetContent dir="rtl" side="right" className="w-[19rem] overflow-y-auto custom-scrollbar p-0">
              <SheetHeader className="border-b border-border/60 p-4">
                <SheetTitle asChild>
                  <div className="flex items-center gap-3 pt-2">
                    <LogoMark className="size-9" />
                    <div className="leading-tight">
                      <p className="text-sm font-black text-foreground">Headscale Easy Manager</p>
                      <p className="text-[11px] text-muted-foreground">کنسول مدیریت</p>
                    </div>
                  </div>
                </SheetTitle>
                <SheetDescription className="sr-only">ناوبری بخش‌های برنامه</SheetDescription>
              </SheetHeader>

              <div className="space-y-5 p-4">
                <ConnectionPillMobile />

                {NAV_GROUPS.map((group) => (
                  <div key={group.key}>
                    <p className="mb-2 px-1 text-[11px] font-black tracking-wide text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const Icon = item.icon
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setMobileOpen(false)
                              go(item.id)
                            }}
                            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-start text-sm font-medium text-foreground/90 transition-colors hover:bg-muted"
                          >
                            <Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span className="flex-1">{item.navLabel}</span>
                            {item.status === 'placeholder' && (
                              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                به‌زودی
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <div className="flex items-center justify-between rounded-xl border bg-muted/40 p-3">
                  <span className="text-sm text-muted-foreground">حالت نمایش</span>
                  <ThemeToggle />
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
