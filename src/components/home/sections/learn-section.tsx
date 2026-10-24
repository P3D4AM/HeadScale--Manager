'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Search,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { navigate, useRoute } from '@/lib/nav'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { chapterIcon, faNum } from '../chapter-icons'
import { Markdown } from '../markdown'
import { useLocalStorageJson } from '@/hooks/use-local-storage'
// محتوای آموزش در «زمان ساخت» تولید می‌شود (scripts/generate-docs.ts — اصلاح ۴.۹):
// بدون endpoint زمان-اجرا → سازگار با static export و بستهٔ ویندوز.
import { DOCS } from '@/generated/docs-content'

export interface DocMeta {
  order: number
  slug: string
  title: string
  description: string
  icon: string
  lines: number
}

interface DocContent extends DocMeta {
  content: string
}

/** فهرست و محتوای فصل‌ها از ماژول تولیدشده (هم‌زمان، بدون شبکه). */
function useDocs(): { chapters: DocMeta[]; bySlug: Map<string, DocContent> } {
  return useMemo(() => {
    const bySlug = new Map<string, DocContent>()
    for (const d of DOCS) {
      bySlug.set(d.slug, { ...d, lines: d.content.split('\n').length })
    }
    return { chapters: [...bySlug.values()], bySlug }
  }, [])
}

export function LearnSection() {
  const route = useRoute()
  const [query, setQuery] = useState('')
  const contentRef = useRef<HTMLDivElement>(null)
  const { chapters, bySlug } = useDocs()

  // فصل‌های خوانده‌شده — localStorage با useSyncExternalStore
  const [readArr, setReadArr] = useLocalStorageJson<number[]>('hem-read-chapters', [])
  const read = useMemo(() => new Set(readArr), [readArr])

  const toggleRead = useCallback(
    (order: number) => {
      setReadArr((prev) =>
        prev.includes(order) ? prev.filter((o) => o !== order) : [...prev, order]
      )
    },
    [setReadArr]
  )

  const selected = useMemo(
    () => chapters.find((c) => c.order === route.chapter) ?? null,
    [chapters, route.chapter]
  )

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return chapters
    return chapters.filter(
      (c) => c.title.includes(q) || c.description.includes(q) || String(c.order).includes(q)
    )
  }, [chapters, query])

  // محتوای فصل انتخاب‌شده — هم‌زمان از ماژول تولیدشده در زمان ساخت
  const currentDoc = selected ? bySlug.get(selected.slug) ?? null : null

  // اسکرول به ابتدای صفحه هنگام تعویض فصل
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [route.chapter])

  // علامت‌گذاری خودکار خوانده‌شده در پایان اسکرول صفحه
  useEffect(() => {
    if (!selected || read.has(selected.order)) return
    const onWindowScroll = () => {
      const scrolled = window.scrollY + window.innerHeight
      const full = document.documentElement.scrollHeight
      if (scrolled >= full - 160) {
        toggleRead(selected.order)
      }
    }
    window.addEventListener('scroll', onWindowScroll, { passive: true })
    return () => window.removeEventListener('scroll', onWindowScroll)
  }, [selected, read, toggleRead])

  const readCount = read.size
  const total = chapters.length
  const idx = selected ? chapters.findIndex((c) => c.order === selected.order) : -1
  const prev = idx > 0 ? chapters[idx - 1] : null
  const next = idx >= 0 && idx < chapters.length - 1 ? chapters[idx + 1] : null

  return (
    <div className="mx-auto max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[300px_1fr]">
      {/* ─── سایدبار فصل‌ها ─── */}
      <aside className="mb-6 lg:mb-0" aria-label="فهرست فصل‌ها">
        <div className="rounded-2xl border bg-card/70 p-4 lg:sticky lg:top-32">
          <div className="relative">
            <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجوی فصل…"
              className="h-11 rounded-xl bg-background pe-9"
              aria-label="جستجوی عنوان فصل‌ها"
            />
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>پیشرفت مطالعه</span>
              <span className="font-bold text-foreground">
                {faNum(readCount)} از {faNum(total)}
              </span>
            </div>
            <Progress
              value={total ? (readCount / total) * 100 : 0}
              className="h-2 [&>div]:bg-emerald-600 dark:[&>div]:bg-emerald-400"
            />
          </div>

          <div className="custom-scrollbar mt-4 max-h-[55vh] space-y-1 overflow-y-auto pe-1 lg:max-h-[calc(100vh-340px)]">
            {filtered.map((c) => {
              const Icon = chapterIcon(c.icon)
              const active = selected?.order === c.order
              const isRead = read.has(c.order)
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => navigate(`#/learn/${c.order}`)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-start transition-colors',
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-transparent hover:bg-muted'
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-black',
                      active
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950'
                        : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {faNum(c.order)}
                  </span>
                  <Icon
                    className={cn(
                      'size-4 shrink-0',
                      active ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                    )}
                  />
                  <span
                    className={cn(
                      'flex-1 truncate text-[13px]',
                      active ? 'font-bold text-foreground' : 'text-foreground/80'
                    )}
                    title={c.title}
                  >
                    {c.title.replace(/^فصل [^:]*:\s*/, '')}
                  </span>
                  {isRead && (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  )}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                فصلی با این عبارت پیدا نشد.
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* ─── محتوا ─── */}
      <div className="min-w-0">
        {!selected && (
          /* نمای کلی — وقتی فصلی انتخاب نشده */
          <div>
            <div className="mb-6">
              <h1 className="flex items-center gap-3 text-2xl font-black text-foreground">
                <BookOpenCheck className="size-7 text-emerald-600 dark:text-emerald-400" />
                مرکز آموزش فارسی
              </h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {faNum(total)} فصل — از «VPN چیست؟» تا پروژهٔ عملی و دوربین‌های مداربسته. همهٔ
                فصل‌ها داخل خود ابزار هم در دسترس‌اند:{' '}
                <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  hsctl learn list
                </code>
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {chapters.map((c, i) => {
                const Icon = chapterIcon(c.icon)
                const isRead = read.has(c.order)
                return (
                  <motion.button
                    key={c.slug}
                    type="button"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(i * 0.04, 0.4) }}
                    onClick={() => navigate(`#/learn/${c.order}`)}
                    className="group h-full"
                  >
                    <Card className="h-full border-border/80 bg-card/70 text-start transition-all hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/5">
                      <CardContent className="flex h-full flex-col gap-2.5 p-5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              <Icon className="size-4" />
                            </span>
                            <span className="text-xs font-black text-muted-foreground">
                              فصل {faNum(c.order)}
                            </span>
                          </div>
                          {isRead && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                              <CheckCircle2 className="size-3" />
                              خوانده‌شده
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold leading-6 text-foreground">
                          {c.title}
                        </h3>
                        <p className="line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {c.description}
                        </p>
                        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-[11px] text-muted-foreground">
                          <Clock className="size-3" />
                          حدود {faNum(Math.max(1, Math.round(c.lines / 15)))} دقیقه مطالعه ·{' '}
                          {faNum(c.lines)} خط
                        </span>
                      </CardContent>
                    </Card>
                  </motion.button>
                )
              })}
            </div>
          </div>
        )}

        {selected && (
          <motion.article
            key={selected.slug}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {/* سربرگ فصل */}
            <div className="mb-5 rounded-2xl border bg-card/70 p-5">
              <nav
                aria-label="مسیر جاری"
                className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <button
                  type="button"
                  onClick={() => navigate('#/learn')}
                  className="transition-colors hover:text-primary"
                >
                  مرکز آموزش
                </button>
                <ChevronLeft className="size-3.5" />
                <span className="text-foreground">فصل {faNum(selected.order)}</span>
              </nav>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="text-xl font-black leading-9 text-foreground sm:text-2xl">
                    {selected.title}
                  </h1>
                  <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
                    {selected.description}
                  </p>
                </div>
                <Button
                  variant={read.has(selected.order) ? 'default' : 'outline'}
                  onClick={() => toggleRead(selected.order)}
                  className={cn(
                    'h-10 shrink-0 gap-2 rounded-xl px-4 text-[13px] font-bold',
                    read.has(selected.order) &&
                      'bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:text-slate-950 dark:hover:bg-emerald-400'
                  )}
                >
                  <CheckCircle2 className="size-4" />
                  {read.has(selected.order) ? 'خوانده شد ✓' : 'این فصل را خواندم'}
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3.5" />
                  زمان مطالعهٔ تقریبی: {faNum(Math.max(1, Math.round(selected.lines / 15)))} دقیقه
                </span>
                <span>{faNum(selected.lines)} خط</span>
                <span className="font-mono" dir="ltr">
                  hsctl learn {selected.order}
                </span>
              </div>
            </div>

            {/* بدنهٔ فصل — محتوای build-time، بدون حالت بارگیری/خطای شبکه */}
            <Card className="bg-card/70">
              <CardContent className="p-4 sm:p-7">
                {currentDoc && (
                  <div ref={contentRef}>
                    <Markdown content={currentDoc.content} />
                  </div>
                )}
                {!currentDoc && (
                  <p className="py-8 text-sm text-muted-foreground">
                    محتوای این فصل در بستهٔ تولیدشده موجود نیست.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ناوبری قبلی/بعدی */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {prev ? (
                <button
                  type="button"
                  onClick={() => navigate(`#/learn/${prev.order}`)}
                  className="group flex min-h-11 items-center gap-3 rounded-xl border bg-card/70 p-4 text-start transition-colors hover:border-emerald-500/40"
                >
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                  <span>
                    <span className="block text-[11px] text-muted-foreground">فصل قبلی</span>
                    <span className="block text-sm font-bold text-foreground">{prev.title}</span>
                  </span>
                </button>
              ) : (
                <span className="hidden sm:block" />
              )}
              {next && (
                <button
                  type="button"
                  onClick={() => navigate(`#/learn/${next.order}`)}
                  className="group flex min-h-11 items-center justify-end gap-3 rounded-xl border bg-card/70 p-4 text-end transition-colors hover:border-emerald-500/40"
                >
                  <span>
                    <span className="block text-[11px] text-muted-foreground">فصل بعدی</span>
                    <span className="block text-sm font-bold text-foreground">{next.title}</span>
                  </span>
                  <ChevronLeft className="size-5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </button>
              )}
            </div>
          </motion.article>
        )}
      </div>
    </div>
  )
}
