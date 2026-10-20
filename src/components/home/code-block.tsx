'use client'

import { useMemo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

/** زبان‌های بدون هایلایت Prism — فقط pre استایل‌شده */
const PLAIN_LANGS = new Set(['text', 'plaintext', 'txt', '', 'none'])

/** نگاشت زبان‌های مستندات به زبان‌های Prism */
const LANG_MAP: Record<string, string> = {
  caddyfile: 'bash',
  sh: 'bash',
  shell: 'bash',
  console: 'bash',
  yml: 'yaml',
  py: 'python',
  'powershell': 'powershell',
  ps1: 'powershell',
}

export function normalizeLang(lang?: string): string {
  const l = (lang ?? '').toLowerCase().trim()
  return LANG_MAP[l] ?? l
}

interface CodeBlockProps {
  code: string
  language?: string
  title?: string
  className?: string
  /** نمایش عنوان ترمینال با آیکن */
  terminal?: boolean
}

/** بلوک کد LTR با دکمهٔ کپی — پایهٔ همهٔ نمایش‌های کد در سایت */
export function CodeBlock({
  code,
  language,
  title,
  className,
  terminal = false,
}: CodeBlockProps) {
  const lang = normalizeLang(language)
  const plain = PLAIN_LANGS.has(lang)
  const displayTitle = title ?? (terminal ? 'ترمینال' : lang)

  const customStyle = useMemo(
    () => ({
      margin: 0,
      background: 'transparent',
      fontSize: '0.8rem',
      padding: '0.9rem 1rem',
    }),
    []
  )

  return (
    <div
      dir="ltr"
      className={cn(
        'group/code relative overflow-hidden rounded-xl border bg-slate-950 text-left',
        className
      )}
    >
      <div className="flex min-h-10 items-center justify-between gap-2 border-b border-white/10 bg-white/[0.04] px-3 py-1.5">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {terminal && <Terminal className="size-3.5 shrink-0 text-emerald-400" />}
          <span className="truncate font-mono text-[11px] tracking-wide text-slate-400">
            {displayTitle}
          </span>
        </div>
        <CopyButton
          text={code}
          className="shrink-0 border-white/10 bg-white/5 text-slate-400 hover:border-emerald-500/40 hover:text-slate-100"
        />
      </div>
      <div className="overflow-x-auto custom-scrollbar">
        {plain ? (
          <pre className="whitespace-pre p-4 font-mono text-[0.8rem] leading-6 text-slate-200">
            {code}
          </pre>
        ) : (
          <SyntaxHighlighter
            language={lang}
            style={oneDark}
            customStyle={customStyle}
            wrapLongLines={false}
            codeTagProps={{ style: { fontFamily: 'var(--font-mono)', direction: 'ltr' } }}
          >
            {code}
          </SyntaxHighlighter>
        )}
      </div>
    </div>
  )
}
