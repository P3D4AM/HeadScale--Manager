'use client'

import { BookOpenCheck, CircleHelp, CloudUpload, Gauge, Heart, KeyRound, Plug, Rocket, ServerCog, Users } from 'lucide-react'
import { navigate, routeHash, type SectionId } from '@/lib/nav'
import { LogoMark } from './site-header'

const FOOTER_LINKS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'داشبورد', icon: Gauge },
  { id: 'connect', label: 'مرکز اتصال', icon: Plug },
  { id: 'install', label: 'نصب Headscale', icon: Rocket },
  { id: 'users', label: 'مدیریت کاربران', icon: Users },
  { id: 'keys', label: 'کلیدها', icon: KeyRound },
  { id: 'server', label: 'سرور و لاگ', icon: ServerCog },
  { id: 'backup', label: 'پشتیبان و ارتقا', icon: CloudUpload },
  { id: 'learn', label: 'مرکز آموزش (۱۴ فصل)', icon: BookOpenCheck },
  { id: 'help', label: 'راهنما و عیب‌یابی', icon: CircleHelp },
]

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-muted/40 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <LogoMark className="size-9" />
              <div className="leading-tight">
                <p className="text-sm font-black text-foreground">
                  Headscale Easy Manager
                </p>
                <p className="text-[11px] text-muted-foreground">
                  کنسول مدیریت شبکهٔ خصوصی — نصب و مدیریت Headscale
                </p>
              </div>
            </div>
            <p className="mt-4 text-[13px] leading-6 text-muted-foreground">
              این برنامه از طریق SSH به سرور شما وصل می‌شود و Headscale را نصب و
              مدیریت می‌کند — برای کسانی که می‌خواهند شبکهٔ خصوصی خودشان را
              بسازند، بدون آنکه متخصص لینوکس یا VPN باشند.
            </p>
          </div>

          <nav aria-label="پیوندهای پاورقی" className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
            {FOOTER_LINKS.map((link) => {
              const Icon = link.icon
              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => navigate(routeHash({ section: link.id, chapter: null, tab: null }))}
                  className="inline-flex min-h-11 items-center gap-2 text-start text-[13px] text-muted-foreground transition-colors hover:text-primary"
                >
                  <Icon className="size-3.5 shrink-0" />
                  {link.label}
                </button>
              )
            })}
          </nav>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-border/60 pt-5 text-[12px] text-muted-foreground sm:flex-row sm:items-center">
          <p>
            نسخهٔ <span className="font-mono text-foreground/80">0.1.0</span> ·
            مدیریت <span className="font-mono text-foreground/80">Headscale v0.29.5</span> ·
            مجوز MIT
          </p>
          <p className="inline-flex items-center gap-1.5">
            با
            <Heart
              className="size-3.5 fill-emerald-500 text-emerald-500"
              aria-hidden
            />
            برای شبکهٔ خصوصی شما ساخته شده است
          </p>
        </div>
      </div>
    </footer>
  )
}
