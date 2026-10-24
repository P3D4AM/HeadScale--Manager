'use client'

/**
 * راهنما و عیب‌یابی — ادغام محتوای آموزشی موجود در تب‌ها:
 * عیب‌یابی ۱۴ خطا، مرجع دستورات، چک‌لیست دوربین‌ها و راهنمای آموزشی نصب.
 * تب فعال با زیرمسیر hash همگام است: #/help/troubleshoot | cli | cameras | install
 */

import { CircleHelp, Cctv, Rocket, Stethoscope, TerminalSquare } from 'lucide-react'
import { useRoute, navigate, type HelpTab } from '@/lib/nav'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { TroubleshootSection } from '@/components/home/sections/troubleshoot-section'
import { CliSection } from '@/components/home/sections/cli-section'
import { CamerasSection } from '@/components/home/sections/cameras-section'
import { InstallSection } from '@/components/home/sections/install-section'

const TABS: { id: HelpTab; label: string; icon: React.ElementType }[] = [
  { id: 'troubleshoot', label: 'عیب‌یابی', icon: Stethoscope },
  { id: 'cli', label: 'مرجع دستورات', icon: TerminalSquare },
  { id: 'cameras', label: 'دوربین‌های مداربسته', icon: Cctv },
  { id: 'install', label: 'راهنمای نصب (آموزشی)', icon: Rocket },
]

export function HelpSection() {
  const route = useRoute()
  const active = route.tab ?? 'troubleshoot'

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <CircleHelp className="mb-3 size-8 text-emerald-600 dark:text-emerald-400" />
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          راهنما و عیب‌یابی
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          مرجع خودیاری: خطاهای رایج با نشانه و راهکار، دستورات hsctl/headscale،
          چک‌لیست پذیرش دوربین‌های مداربسته و راهنمای گام‌به‌گام نصب — همه از
          مستندات واقعی همین محصول.{' '}
          <button
            type="button"
            className="font-bold text-emerald-600 underline-offset-4 hover:underline dark:text-emerald-400"
            onClick={() => navigate('#/learn')}
          >
            برای آموزش کامل، مرکز آموزش را ببینید
          </button>
          .
        </p>
      </div>

      <Tabs
        value={active}
        onValueChange={(v) => navigate(`#/help/${v}`)}
        className="w-full"
      >
        <TabsList className="custom-scrollbar mb-2 h-auto w-full justify-start overflow-x-auto rounded-xl p-1.5">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <TabsTrigger
                key={t.id}
                value={t.id}
                className="h-11 min-w-11 gap-2 rounded-lg px-4 text-[13px] font-bold"
              >
                <Icon className="size-4" />
                {t.label}
              </TabsTrigger>
            )
          })}
        </TabsList>
        <TabsContent value="troubleshoot" className="mt-0">
          <TroubleshootSection />
        </TabsContent>
        <TabsContent value="cli" className="mt-0">
          <CliSection />
        </TabsContent>
        <TabsContent value="cameras" className="mt-0">
          <CamerasSection />
        </TabsContent>
        <TabsContent value="install" className="mt-0">
          <InstallSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}
