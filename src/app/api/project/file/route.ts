import fs from 'node:fs/promises'
import path from 'node:path'
import { HEM_ROOT, jsonError } from '@/lib/hem-project'

export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 200 * 1024 // 200KB

const LANG_BY_EXT: Record<string, string> = {
  py: 'python',
  md: 'markdown',
  sh: 'bash',
  bash: 'bash',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  css: 'css',
  html: 'html',
  txt: 'text',
  example: 'text',
  conf: 'ini',
  cfg: 'ini',
  ini: 'ini',
  service: 'ini',
}

const LANG_BY_NAME: Record<string, string> = {
  hsctl: 'bash',
  install: 'bash',
  Makefile: 'makefile',
  LICENSE: 'text',
  CHANGELOG: 'markdown',
  Caddyfile: 'bash',
}

function detectLanguage(name: string): string {
  if (LANG_BY_NAME[name]) return LANG_BY_NAME[name]
  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return LANG_BY_EXT[ext] ?? 'text'
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rel = searchParams.get('path')
    if (!rel) {
      return jsonError('پارامتر path الزامی است.', 400)
    }

    // امنیت: resolve و اطمینان از ماندن مسیر داخل ریشهٔ پروژه (مسدودسازی path traversal)
    const root = path.resolve(HEM_ROOT)
    const target = path.resolve(root, rel)
    if (target !== root && !target.startsWith(root + path.sep)) {
      return jsonError('دسترسی به مسیر خارج از پروژه مجاز نیست.', 403)
    }

    const info = await fs.stat(target).catch(() => null)
    if (!info || !info.isFile()) {
      return jsonError('فایل مورد نظر پیدا نشد.', 404)
    }
    if (info.size > MAX_FILE_SIZE) {
      return jsonError(
        'این فایل بزرگ‌تر از حد مجاز نمایش (۲۰۰ کیلوبایت) است — آن را مستقیم از مخزن ببینید.',
        413
      )
    }

    const buf = await fs.readFile(target)
    // تشخیص فایل باینری: وجود بایت NUL در ابتدای فایل
    const probe = buf.subarray(0, Math.min(buf.length, 8000))
    if (probe.includes(0)) {
      return jsonError('این فایل باینری است و نمایش داده نمی‌شود.', 415)
    }

    const name = path.basename(target)
    return Response.json({
      path: rel,
      name,
      size: info.size,
      language: detectLanguage(name),
      content: buf.toString('utf-8'),
    })
  } catch (err) {
    console.error('[api/project/file]', err)
    return jsonError('خواندن فایل با خطا مواجه شد.', 500)
  }
}
