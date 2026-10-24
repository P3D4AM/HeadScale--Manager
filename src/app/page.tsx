'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRoute, routeHash } from '@/lib/nav'
import { SiteHeader } from '@/components/home/site-header'
import { SiteFooter } from '@/components/home/site-footer'
import { SECTION_BY_ID } from '@/components/console/sections/registry'

export default function Home() {
  const route = useRoute()
  const section = SECTION_BY_ID[route.section]
  const Section = section.Component

  // کلید یکتای ترنزیشن: بخش + فصل/تب (تا جابه‌جایی فصل‌های آموزش هم انیمیت شود)
  const transitionKey = routeHash(route)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [transitionKey])

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1" id="main-content">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={transitionKey}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
          >
            <Section />
          </motion.div>
        </AnimatePresence>
      </main>
      <SiteFooter />
    </div>
  )
}
