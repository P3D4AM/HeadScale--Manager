import fs from 'node:fs'
import path from 'node:path'

/**
 * ریشهٔ پروژهٔ «Headscale Easy Manager» — منبع واحد حقیقت برای APIهای مستندات و مرورگر فایل.
 * ترتیب: متغیر محیطی → پوشهٔ کناری cwd → مسیر ثابت sandbox.
 */
const CANDIDATES = [
  process.env.HEM_PROJECT_ROOT,
  path.join(process.cwd(), 'headscale-easy-manager'),
  path.join(process.cwd(), '..', 'headscale-easy-manager'),
  '/home/z/my-project/headscale-easy-manager',
]

function findRoot(): string {
  for (const c of CANDIDATES) {
    if (c && fs.existsSync(path.join(c, 'docs', 'FACTS.md'))) {
      return path.resolve(c)
    }
  }
  throw new Error('پروژهٔ headscale-easy-manager پیدا نشد')
}

export const HEM_ROOT = findRoot()
export const DOCS_FA_DIR = path.join(HEM_ROOT, 'docs', 'fa')

export const PROJECT_EXCLUDE = new Set([
  '.git',
  '__pycache__',
  'node_modules',
  '.venv',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
])

export function isExcluded(name: string): boolean {
  if (PROJECT_EXCLUDE.has(name)) return true
  if (name.endsWith('.pyc')) return true
  return false
}

export function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status })
}
