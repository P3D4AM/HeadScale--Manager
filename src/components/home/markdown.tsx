'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Hash, Link2 } from 'lucide-react'
import { navigate } from '@/lib/nav'
import { CodeBlock } from './code-block'

/** لینک‌های نسبی فصل‌های مستندات (مثل 09-eibyabi.md) را به مسیر #/learn/9 تبدیل می‌کند */
function chapterHref(href: string): string | null {
  const m = /^(\d{1,2})-[a-z0-9-]*\.md$/.exec(href)
  if (m) return `#/learn/${Number.parseInt(m[1], 10)}`
  return null
}

function slugifyId(children: React.ReactNode): string {
  return String(children)
    .trim()
    .replace(/[\s.:!?،؛»«]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

export function Markdown({ content }: { content: string }) {
  return (
    <div className="md-fa text-[0.95rem] leading-8 text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mt-2 mb-6 flex items-center gap-3 border-b pb-4 text-2xl font-black text-foreground">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2
              id={slugifyId(children)}
              className="group mt-10 mb-4 flex items-center gap-2 border-b border-border/60 pb-2 text-xl font-bold text-foreground"
            >
              <Hash className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3
              id={slugifyId(children)}
              className="group mt-8 mb-3 flex items-center gap-2 text-lg font-bold text-foreground"
            >
              <span
                aria-hidden
                className="inline-block h-4 w-1 rounded-full bg-emerald-600 dark:bg-emerald-400"
              />
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-6 mb-2 text-base font-bold text-foreground">{children}</h4>
          ),
          p: ({ children }) => <p className="my-4">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-bold text-foreground">{children}</strong>
          ),
          a: ({ children, href }) => {
            if (!href) return <>{children}</>
            const chapter = chapterHref(href)
            if (chapter) {
              return (
                <button
                  type="button"
                  onClick={() => navigate(chapter)}
                  className="inline-flex items-center gap-1 font-medium text-emerald-700 underline decoration-emerald-500/40 underline-offset-4 transition-colors hover:decoration-emerald-500 dark:text-emerald-400"
                >
                  <Link2 className="size-3.5" />
                  {children}
                </button>
              )
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-emerald-700 underline decoration-emerald-500/40 underline-offset-4 hover:decoration-emerald-500 dark:text-emerald-400"
              >
                {children}
              </a>
            )
          },
          ul: ({ children }) => (
            <ul className="my-4 list-disc space-y-2 ps-6 marker:text-emerald-600/70 dark:marker:text-emerald-400/70">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-4 list-decimal space-y-2 ps-6 marker:text-emerald-600/80 dark:marker:text-emerald-400/80">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-7 [&>input[type='checkbox']]:me-2 [&>input[type='checkbox']]:accent-emerald-600">
              {children}
            </li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-5 rounded-lg border-e-4 border-emerald-600/70 bg-emerald-500/[0.06] px-4 py-2 text-foreground/90 dark:border-emerald-400/70">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-8 border-border/70" />,
          table: ({ children }) => (
            <div className="my-6 overflow-x-auto rounded-xl border custom-scrollbar">
              <table className="w-full min-w-[480px] text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-muted/80 text-foreground">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border-b px-3 py-2.5 text-start font-bold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b px-3 py-2.5 align-top leading-7">{children}</td>
          ),
          code: ({ children, className }) => {
            const text = String(children).replace(/\n$/, '')
            const match = /language-(\S+)/.exec(className || '')
            const isBlock = Boolean(match) || text.includes('\n')
            if (!isBlock) {
              return <code className={className}>{children}</code>
            }
            return <CodeBlock code={text} language={match?.[1]} />
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
