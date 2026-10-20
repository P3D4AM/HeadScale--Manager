import fs from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { DOCS_FA_DIR, jsonError } from '@/lib/hem-project'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    // امنیت: slug فقط شامل نویسه‌های بی‌خطر فایل است (بدون path traversal)
    if (!/^[a-zA-Z0-9._-]+$/.test(slug) || slug.includes('..')) {
      return jsonError('شناسهٔ فصل نامعتبر است.', 400)
    }

    const filePath = path.join(DOCS_FA_DIR, `${slug}.md`)
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(DOCS_FA_DIR) + path.sep)) {
      return jsonError('مسیر خارج از محدودهٔ مستندات است.', 400)
    }

    let raw: string
    try {
      raw = await fs.readFile(resolved, 'utf-8')
    } catch {
      return jsonError('فصل مورد نظر پیدا نشد.', 404)
    }

    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
    let meta: Record<string, unknown> = {}
    let content = raw
    if (match) {
      try {
        meta = (yamlLoad(match[1]) as Record<string, unknown>) ?? {}
      } catch {
        meta = {}
      }
      content = raw.slice(match[0].length).replace(/^\r?\n+/, '')
    }

    return Response.json({
      slug,
      order: Number(meta.order ?? 0),
      title: String(meta.title ?? slug),
      description: String(meta.description ?? ''),
      icon: String(meta.icon ?? 'FileText'),
      lines: content.split('\n').length,
      content,
    })
  } catch (err) {
    console.error('[api/docs/[slug]]', err)
    return jsonError('خواندن فصل با خطا مواجه شد.', 500)
  }
}
