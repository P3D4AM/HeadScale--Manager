'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRoute } from '@/lib/nav'
import { SiteHeader } from '@/components/home/site-header'
import { SiteFooter } from '@/components/home/site-footer'
import { HomeSection } from '@/components/home/sections/home-section'
import { LearnSection } from '@/components/home/sections/learn-section'
import { InstallSection } from '@/components/home/sections/install-section'
import { CliSection } from '@/components/home/sections/cli-section'
import { CamerasSection } from '@/components/home/sections/cameras-section'
import { TroubleshootSection } from '@/components/home/sections/troubleshoot-section'
import { ProjectSection } from '@/components/home/sections/project-section'

export default function Home() {
  const route = useRoute()

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route.section])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1" id="main-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route.section}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            {route.section === 'home' && <HomeSection />}
            {route.section === 'learn' && <LearnSection />}
            {route.section === 'install' && <InstallSection />}
            {route.section === 'cli' && <CliSection />}
            {route.section === 'cameras' && <CamerasSection />}
            {route.section === 'troubleshoot' && <TroubleshootSection />}
            {route.section === 'project' && <ProjectSection />}
          </motion.div>
        </AnimatePresence>
      </main>
      <SiteFooter />
    </div>
  )
}
