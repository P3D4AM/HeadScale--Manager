'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  File as FileIcon,
  FileCode2,
  FileJson,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderGit2,
  Loader2,
  Scale,
  TerminalSquare,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '../code-block'
import { faNum } from '../chapter-icons'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  children?: TreeNode[]
}

interface TreeStats {
  files: number
  dirs: number
  pyLines: number
  testFunctions: number
  chapters: number
  totalSize: number
}

interface FilePayload {
  path: string
  name: string
  size: number
  language: string
  content: string
}

const EXT_ICONS: Record<string, React.ElementType> = {
  py: FileCode2,
  md: FileText,
  sh: TerminalSquare,
  toml: FileJson,
  yaml: FileJson,
  yml: FileJson,
  json: FileJson,
  txt: FileText,
  example: FileText,
}

const NAME_ICONS: Record<string, React.ElementType> = {
  hsctl: TerminalSquare,
  install: TerminalSquare,
  Makefile: TerminalSquare,
  LICENSE: Scale,
}

function fileIcon(name: string): React.ElementType {
  if (NAME_ICONS[name]) return NAME_ICONS[name]
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return EXT_ICONS[ext] ?? FileIcon
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function TreeView({
  node,
  depth,
  selected,
  onSelect,
  openMap,
  toggle,
}: {
  node: TreeNode
  depth: number
  selected: string
  onSelect: (path: string) => void
  openMap: Set<string>
  toggle: (path: string) => void
}) {
  const isOpen = openMap.has(node.path)
  const isDir = node.type === 'dir'

  return (
    <div>
      <button
        type="button"
        onClick={() => (isDir ? toggle(node.path) : onSelect(node.path))}
        className={cn(
          'flex min-h-9 w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-start text-[12.5px] transition-colors',
          selected === node.path
            ? 'bg-emerald-500/15 font-bold text-foreground'
            : 'text-foreground/75 hover:bg-muted'
        )}
        style={{ paddingInlineStart: `${depth * 14 + 6}px` }}
        aria-expanded={isDir ? isOpen : undefined}
      >
        {isDir ? (
          <>
            {isOpen ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            {isOpen ? (
              <FolderOpen className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <FolderClosed className="size-4 shrink-0 text-emerald-600/70 dark:text-emerald-400/70" />
            )}
          </>
        ) : (
          <>
            <span className="inline-block size-3.5 shrink-0" />
            {(() => {
              const Icon = fileIcon(node.name)
              return <Icon className="size-4 shrink-0 text-muted-foreground" />
            })()}
          </>
        )}
        <span className="truncate" dir="ltr" title={node.name}>
          {node.name}
        </span>
        {isDir && (
          <span className="ms-auto shrink-0 text-[10px] text-muted-foreground">
            {node.children?.length ?? 0}
          </span>
        )}
      </button>
      {isDir && isOpen && (
        <div>
          {node.children?.map((child) => (
            <TreeView
              key={child.path}
              node={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
              openMap={openMap}
              toggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectSection() {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [stats, setStats] = useState<TreeStats | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [openMap, setOpenMap] = useState<Set<string>>(new Set(['']))
  const [selected, setSelected] = useState<string>('README.md')
  const [files, setFiles] = useState<Record<string, FilePayload>>({})
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    let alive = true
    fetch('/api/project/tree')
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? 'خطا')
        if (alive) {
          setTree(data.root as TreeNode)
          setStats(data.stats as TreeStats)
        }
      })
      .catch(() => {
        if (alive) setTreeError('ساخت درخت پروژه ناموفق بود — اتصال را بررسی کنید.')
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const path = selected
    if (!path || files[path] || fileErrors[path]) return
    fetch(`/api/project/file?path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? 'خطا')
        setFiles((prev) => ({ ...prev, [path]: data as FilePayload }))
      })
      .catch((e: Error) => {
        setFileErrors((prev) => ({
          ...prev,
          [path]: e.message || 'خواندن فایل ناموفق بود.',
        }))
      })
  }, [selected, files, fileErrors])

  const toggle = useCallback((path: string) => {
    setOpenMap((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const statCards = useMemo(() => {
    if (!stats) return []
    return [
      { value: faNum(stats.pyLines), label: 'خط کد پایتون' },
      { value: faNum(stats.testFunctions), label: 'تست خودکار' },
      { value: faNum(stats.chapters), label: 'فصل آموزش فارسی' },
      { value: faNum(stats.files), label: 'فایل پروژه' },
    ]
  }, [stats])

  const file = files[selected] ?? null
  const fileError = fileErrors[selected] ?? null
  const fileLoading = Boolean(selected) && !file && !fileError
  const fileLines = file ? file.content.split('\n').length : 0

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {/* سربرگ */}
      <div className="mb-8 text-center">
        <Badge
          variant="outline"
          className="mb-4 gap-1.5 rounded-full border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300"
        >
          <FolderGit2 className="size-3.5" />
          مرورگر پروژه
        </Badge>
        <h1 className="text-2xl font-black text-foreground sm:text-3xl">
          کد و مستندات پروژه را همین‌جا ورق بزنید
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
          کل مخزن headscale-easy-manager — نصب‌کننده، بستهٔ پایتون hem، ابزار hsctl،
          ۱۴ فصل مستندات و تست‌ها. مستندات وب از همین فایل‌ها خوانده می‌شود؛ منبع
          واحد حقیقت همین‌جاست.
        </p>
      </div>

      {/* آمار پروژه */}
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-2xl border bg-card/60 p-5 sm:grid-cols-4">
        {!stats &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        {statCards.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-1 text-center">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {s.value}
            </span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* دربارهٔ پروژه */}
      <Card className="mb-8 bg-card/70">
        <CardContent className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_360px]">
          <div>
            <h2 className="mb-3 text-base font-bold text-foreground">دربارهٔ پروژه</h2>
            <p className="text-[13px] leading-7 text-muted-foreground">
              بستهٔ پایتون <code dir="ltr" className="rounded bg-muted px-1 font-mono text-xs">hem</code>{' '}
              شامل ماژول‌های installer (۱۷ گام)، system (preflight/پکیج/سرویس/فایروال)،
              network، headscale (نصب/پیکربندی/CTL)، proxy (Caddy)، backup،
              diagnostics (doctor/report)، cameras، learn و core است — فقط با stdlib و
              PyYAML. نقطهٔ ورود CLI فایل{' '}
              <code dir="ltr" className="rounded bg-muted px-1 font-mono text-xs">hsctl</code> است و{' '}
              <code dir="ltr" className="rounded bg-muted px-1 font-mono text-xs">install.sh</code>{' '}
              نصب را راهبری می‌کند. همهٔ حقایق فنی پروژه در{' '}
              <code dir="ltr" className="rounded bg-muted px-1 font-mono text-xs">docs/FACTS.md</code>{' '}
              قفل شده است.
            </p>
            <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <p className="rounded-lg border bg-background/50 px-3 py-2">
                📦 نصب پیش‌فرض: <code dir="ltr" className="font-mono">/opt/headscale-easy-manager</code>
              </p>
              <p className="rounded-lg border bg-background/50 px-3 py-2">
                🧪 تست‌ها: <code dir="ltr" className="font-mono">make test</code> — pytest
              </p>
              <p className="rounded-lg border bg-background/50 px-3 py-2">
                🧹 لینت: <code dir="ltr" className="font-mono">make lint</code> — ruff
              </p>
              <p className="rounded-lg border bg-background/50 px-3 py-2">
                📄 مجوز: MIT — استفاده و تغییر آزاد
              </p>
            </div>
          </div>
          <div>
            <h2 className="mb-3 text-base font-bold text-foreground">انتقال مخزن به Git</h2>
            <CodeBlock
              code={'cd headscale-easy-manager\ngit remote add origin git@github.com:USERNAME/headscale-easy-manager.git\ngit push -u origin main'}
              language="bash"
              terminal
            />
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              دریافت روی سرور: <code dir="ltr" className="font-mono">git clone &lt;REPO_URL&gt; headscale-easy-manager</code>{' '}
              — همیشه از مخزن رسمی؛ در دانلود فایل فشرده، SHA-256 را با صفحهٔ انتشار
              رسمی تطبیق دهید.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* مرورگر فایل */}
      {treeError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 p-6 text-sm text-destructive">
            <FolderGit2 className="size-5 shrink-0" />
            {treeError}
          </CardContent>
        </Card>
      ) : !tree ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Skeleton className="h-96 rounded-2xl" />
          <Skeleton className="h-96 rounded-2xl" />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="grid gap-4 lg:grid-cols-[320px_1fr]"
        >
          {/* درخت */}
          <Card className="h-fit bg-card/70 lg:sticky lg:top-32">
            <CardContent className="p-3">
              <div className="mb-2 flex items-center gap-2 border-b px-2 pb-2 pt-1">
                <FolderGit2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                <span className="font-mono text-xs font-bold text-foreground" dir="ltr">
                  headscale-easy-manager/
                </span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto pe-1 custom-scrollbar lg:max-h-[calc(100vh-320px)]">
                {tree.children?.map((child) => (
                  <TreeView
                    key={child.path}
                    node={child}
                    depth={0}
                    selected={selected}
                    onSelect={setSelected}
                    openMap={openMap}
                    toggle={toggle}
                  />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* نمایشگر فایل */}
          <Card className="min-w-0 bg-card/70">
            <CardContent className="p-4 sm:p-5">
              {fileLoading && (
                <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
                  <Loader2 className="size-5 animate-spin" />
                  در حال بارگذاری فایل…
                </div>
              )}
              {!fileLoading && fileError && (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <FileIcon className="size-10 text-muted-foreground/50" />
                  <p className="max-w-md text-sm leading-7 text-muted-foreground">
                    {fileError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelected('README.md')}
                    className="h-10 rounded-lg"
                  >
                    بازگشت به README
                  </Button>
                </div>
              )}
              {!fileLoading && file && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {(() => {
                        const Icon = fileIcon(file.name)
                        return <Icon className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      })()}
                      <span className="truncate font-mono text-sm font-bold text-foreground" dir="ltr">
                        {file.path || file.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
                      <span>{formatSize(file.size)}</span>
                      <span>{faNum(fileLines)} خط</span>
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {file.language}
                      </Badge>
                    </div>
                  </div>
                  <CodeBlock
                    code={file.content}
                    language={file.language}
                    title={file.name}
                    className="max-h-[70vh] overflow-hidden"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  )
}
