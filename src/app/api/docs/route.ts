import fs from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { DOCS_FA_DIR, jsonError } from '@/lib/hem-project'

export const dynamic = 'force-dynamic'

export interface DocMeta {
  order: number
  slug: string
  title: string
  description: string
  icon: string
  lines: number
}

export async function GET() {
  try {
    const files = await fs.readdir(DOCS_FA_DIR)
    const docs: DocMeta[] = []

    for (const file of files) {
      if (!file.endsWith('.md')) continue
      const raw = await fs.readFile(path.join(DOCS_FA_DIR, file), 'utf-8')
      const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
      let meta: Record<string, unknown> = {}
      if (match) {
        try {
          meta = (yamlLoad(match[1]) as Record<string, unknown>) ?? {}
        } catch {
          meta = {}
        }
      }
      docs.push({
        order: Number(meta.order ?? 99),
        slug: file.replace(/\.md$/, ''),
        title: String(meta.title ?? file),
        description: String(meta.description ?? ''),
        icon: String(meta.icon ?? 'FileText'),
        lines: raw.split('\n').length,
      })
    }

    docs.sort((a, b) => a.order - b.order)
    return Response.json({ chapters: docs })
  } catch (err) {
    console.error('[api/docs]', err)
    return jsonError('خواندن فهرست فصل‌ها با خطا مواجه شد.', 500)
  }
}
