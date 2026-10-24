#!/usr/bin/env bun
/**
 * generate-docs.ts — تولید محتوای مرکز آموزش در «زمان ساخت» (build-time).
 *
 * ریشهٔ اصلاح ایراد ۴.۹ ممیزی (AUDIT-2025-10 §1): رابط وب در زمان اجرا دیگر
 * هیچ فایلی از ریشهٔ پروژه نمی‌خواند (endpointهای /api/docs حذف شدند و خروجی
 * static export / بستهٔ ویندوز با آن‌ها ساخته نمی‌شد). این اسکریپت فصل‌های
 * docs/fa مخزن اصلی را می‌خواند، فرانت‌متر YAML را با همان منطق قبلی
 * (js-yaml + همین regex) جدا می‌کند و ماژول TypeScript ایزومورف تولید
 * می‌کند که UI مستقیماً import می‌کند — بدون شبکه، بدون fs، سازگار با export.
 *
 * اجرا: bun run docs:generate  (یا: bun scripts/generate-docs.ts)
 * خروجی: src/generated/docs-content.ts (فایل تولیدشده — دست‌نویس ممنوع)
 */
import fs from 'node:fs'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'

/** ریشهٔ پروژهٔ وب — از مسیر خود اسکریپت (سازگار با هر cwd). */
const PROJECT_ROOT = path.resolve(path.dirname(path.resolve(process.argv[1] ?? '.')), '..')

/** منبع مستندات: مخزن اصلی (قابل‌بازتعریف با HEM_PROJECT_ROOT مثل قرارداد قبلی). */
const REPO_ROOT = process.env.HEM_PROJECT_ROOT
  ? path.resolve(process.env.HEM_PROJECT_ROOT)
  : PROJECT_ROOT
const DOCS_FA_DIR = path.join(REPO_ROOT, 'headscale-easy-manager', 'docs', 'fa')
const OUT_FILE = path.join(PROJECT_ROOT, 'src', 'generated', 'docs-content.ts')

/** حداقل فصل‌های قراردادی محصول (متن UI روی این عدد وعده داده است). */
const MIN_CHAPTERS = 14

interface GeneratedDoc {
  order: number
  slug: string
  title: string
  description: string
  icon: string
  content: string
}

function fail(message: string): never {
  console.error(`✗ generate-docs: ${message}`)
  process.exit(1)
}

// ─── خواندن فصل‌ها (همان منطق parser اندپوینت‌های قبلی /api/docs) ───
if (!fs.existsSync(DOCS_FA_DIR)) {
  fail(`پوشهٔ مستندات پیدا نشد: ${DOCS_FA_DIR} (متغیر HEM_PROJECT_ROOT را بررسی کنید)`)
}

const docs: GeneratedDoc[] = []
for (const file of fs.readdirSync(DOCS_FA_DIR).sort()) {
  if (!file.endsWith('.md')) continue
  const raw = fs.readFileSync(path.join(DOCS_FA_DIR, file), 'utf-8')
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
  docs.push({
    order: Number(meta.order ?? 99),
    slug: file.replace(/\.md$/, ''),
    title: String(meta.title ?? file),
    description: String(meta.description ?? ''),
    icon: String(meta.icon ?? 'FileText'),
    content,
  })
}

docs.sort((a, b) => a.order - b.order)

if (docs.length < MIN_CHAPTERS) {
  fail(
    `تعداد فصل‌ها ${docs.length} است — کمتر از حداقل قراردادی ${MIN_CHAPTERS}. ` +
      'منبع docs/fa مخزن اصلی ناقص است.'
  )
}

// ─── تولید ماژول ───
const banner = `// ⚠️ فایل تولیدشده — ویرایش دستی ممنوع (scripts/generate-docs.ts)
// منبع: headscale-easy-manager/docs/fa/*.md — بازتولید: bun run docs:generate
// (اصلاح ایراد ۴.۹: محتوا در زمان ساخت تولید می‌شود تا خروجی static export
//  و بستهٔ ویندوز به fs/اندپوینت زمان-اجرا وابسته نباشد.)

export interface GeneratedDoc {
  order: number
  slug: string
  title: string
  description: string
  icon: string
  content: string
}

/** همهٔ فصل‌ها، مرتب‌شده بر اساس order فرانت‌متر (content بدون فرانت‌متر). */
export const DOCS: GeneratedDoc[] = `

const body = JSON.stringify(docs, null, 2) + '\n'

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
fs.writeFileSync(OUT_FILE, banner + body, 'utf-8')

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1)
console.log(
  `✓ ${docs.length} فصل آموزش → ${path.relative(PROJECT_ROOT, OUT_FILE)} (${kb} KB) ` +
    `[orders: ${docs.map((d) => d.order).join(', ')}]`
)
