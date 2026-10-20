'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Command,
  Lightbulb,
  Search,
  ShieldAlert,
  ShieldCheck,
  Skull,
  TerminalSquare,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CodeBlock } from '../code-block'
import { CopyButton } from '../copy-button'
import {
  CATEGORY_LABELS,
  CLI_COMMANDS,
  CLI_GOLDEN_NOTES,
  type CommandCategory,
  type CommandGroup,
  type RiskLevel,
} from '@/data/cli-commands'

const GROUP_LABELS: Record<CommandGroup, string> = {
  hsctl: 'hsctl — ابزار خود ابزار',
  headscale: 'headscale — موتور خام',
  tailscale: 'tailscale — سمت کلاینت',
}

const GROUP_HINTS: Record<CommandGroup, string> = {
  hsctl: '۱۷ زیرفرمان قراردادی — راهنمای کامل: فصل ۸',
  headscale: 'فرمان‌های کلیدی نسخهٔ ۰.۲۹ — نکته‌های مهاجرت مهم',
  tailscale: 'جریان‌های رسمی سمت کلاینت — فصل‌های ۵ و ۶ و ۷',
}

const RISK_META: Record<RiskLevel, { label: string; icon: React.ElementType; className: string }> = {
  safe: {
    label: 'ایمن',
    icon: ShieldCheck,
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  risky: {
    label: 'نیازمند دقت',
    icon: ShieldAlert,
    className: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  dangerous: {
    label: 'مخرب/بازگشت‌ناپذیر',
    icon: Skull,
    className: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  },
}

export function CliSection() {
  const [group, setGroup] = useState<CommandGroup>('hsctl')
  const [category, setCategory] = useState<CommandCategory | 'all'>('all')
  const [query, setQuery] = useState('')

  const categories = useMemo(() => {
    const set = new Set<CommandCategory>()
    CLI_COMMANDS.filter((c) => c.group === group).forEach((c) => set.add(c.category))
    return [...set]
  }, [group])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return CLI_COMMANDS.filter((c) => {
      if (c.group !== group) return false
      if (category !== 'all' && c.category !== category) return false
      if (!q) return true
      return (
        c.name.toLowerCase().includes(q) ||
        c.command.toLowerCase().includes(q) ||
        c.description.includes(query.trim()) ||
        (c.example ?? '').toLowerCase().includes(q)
      )
    })
  }, [group, category, query])

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      {/* سربرگ */}
      <div className="mb-8 text-center">
        <Badge
          variant="outline"
          className="mb-4 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <Command className="size-3.5" />
          مرجع دستورات
        </Badge>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          مرجع کامل دستورات hsctl و سرور و کلاینت
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          همهٔ دستورات عیناً از قرارداد فنی راستی‌آزمایی‌شدهٔ پروژه (FACTS) آمده‌اند —
          بدون هیچ حدسی. راهنمای کامل هر دستور:{' '}
          <code dir="ltr" className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">hsctl --help</code> و فصل ۸.
        </p>
      </div>

      {/* نکته‌های طلایی */}
      <div className="mb-8 grid gap-3 md:grid-cols-3">
        {CLI_GOLDEN_NOTES.map((note) => (
          <Card key={note.title} className="border-amber-500/30 bg-amber-500/[0.06]">
            <CardContent className="p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-amber-700 dark:text-amber-300">
                <Lightbulb className="size-4 shrink-0" />
                {note.title}
              </p>
              <p className="text-xs leading-6 text-foreground/80">{note.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* فیلتر گروه */}
      <div className="mb-4">
        <Tabs value={group} onValueChange={(v) => {
          setGroup(v as CommandGroup)
          setCategory('all')
        }}>
          <TabsList className="h-auto w-full flex-wrap sm:w-auto">
            {(Object.keys(GROUP_LABELS) as CommandGroup[]).map((g) => (
              <TabsTrigger key={g} value={g} className="min-h-11 gap-2 px-4 font-mono text-xs sm:text-sm">
                <TerminalSquare className="size-4" />
                {g}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="mt-2 px-1 text-xs text-muted-foreground">{GROUP_HINTS[group]}</p>
      </div>

      {/* جستجو + دسته‌ها */}
      <div className="mb-6 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی دستور… (مثلاً routes یا backup)"
            className="h-11 rounded-xl bg-background pe-9"
            aria-label="جستجوی دستور"
          />
        </div>
        <div className="custom-scrollbar flex gap-2 overflow-x-auto pb-1" role="group" aria-label="فیلتر دسته">
          <button
            type="button"
            onClick={() => setCategory('all')}
            className={cn(
              'min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors',
              category === 'all'
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            همه
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'min-h-9 shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors',
                category === c
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* کارت‌های دستور */}
      {filtered.length === 0 && (
        <p className="py-14 text-center text-sm text-muted-foreground">
          دستوری با این مشخصات پیدا نشد.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.map((cmd, i) => {
          const risk = RISK_META[cmd.risk]
          const RiskIcon = risk.icon
          return (
            <motion.div
              key={`${cmd.group}-${cmd.name}`}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-20px' }}
              transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.3) }}
            >
              <Card className="flex h-full flex-col bg-card/70 transition-colors hover:border-primary/35">
                <CardContent className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-mono text-sm font-bold text-foreground" dir="ltr">
                      {cmd.name}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {CATEGORY_LABELS[cmd.category]}
                      </Badge>
                      <Badge variant="outline" className={cn('gap-1 text-[10px]', risk.className)}>
                        <RiskIcon className="size-3" />
                        {risk.label}
                      </Badge>
                    </div>
                  </div>

                  <div className="rounded-xl">
                    <CodeBlock code={cmd.command} language="bash" title={cmd.group} />
                  </div>

                  <p className="text-[13px] leading-6 text-muted-foreground">{cmd.description}</p>

                  {cmd.note && (
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 text-xs leading-6 text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="mt-1 size-3.5 shrink-0" />
                      {cmd.note}
                    </p>
                  )}

                  {cmd.flags && (
                    <ul className="space-y-1.5">
                      {cmd.flags.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-xs leading-6 text-foreground/75">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-emerald-500" />
                          <span dir="auto">{f}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {cmd.example && (
                    <div className="mt-auto flex items-center gap-2 rounded-lg border bg-background/60 px-3 py-2">
                      <span className="shrink-0 text-[10px] font-bold text-muted-foreground">مثال:</span>
                      <code
                        dir="ltr"
                        className="flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-emerald-700 custom-scrollbar dark:text-emerald-300"
                      >
                        {cmd.example}
                      </code>
                      <CopyButton text={cmd.example} label="" className="size-7 min-w-7 p-0" />
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
