#!/usr/bin/env bun
/**
 * generate-docs.ts — build the learn-center content at build time.
 *
 * Root of fix 4.9 of the AUDIT-2025-10 §1: the web UI no longer reads any
 * file from the project root at run time (the /api/docs endpoints were
 * removed; the static export / the Windows package could not be built with
 * them). This script reads the docs/fa chapters of the main repository,
 * extracts the YAML frontmatter with the same logic as before
 * (js-yaml + the same regex) and generates an isomorphic TypeScript module
 * that the UI imports directly — no network, no fs, export-compatible.
 *
 * Run: bun run docs:generate  (or: bun scripts/generate-docs.ts)
 * Output: src/generated/docs-content.ts (generated file — do not hand-edit)
 */
import fs from 'node:fs'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'

/** Web project root — derived from this script's location (cwd-independent). */
const PROJECT_ROOT = path.resolve(path.dirname(path.resolve(process.argv[1] ?? '.')), '..')

/** Documentation source: the main repository (overridable with HEM_PROJECT_ROOT, like the previous contract). */
const REPO_ROOT = process.env.HEM_PROJECT_ROOT
  ? path.resolve(process.env.HEM_PROJECT_ROOT)
  : PROJECT_ROOT
const DOCS_FA_DIR = path.join(REPO_ROOT, 'headscale-easy-manager', 'docs', 'fa')
const OUT_FILE = path.join(PROJECT_ROOT, 'src', 'generated', 'docs-content.ts')

/** Minimum contractual chapter count of the product (the UI text promises this number). */
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

// ─── Read the chapters (same logic as the previous /api/docs parser) ───
if (!fs.existsSync(DOCS_FA_DIR)) {
  fail(`docs folder not found: ${DOCS_FA_DIR} (check the HEM_PROJECT_ROOT variable)`)
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
    `chapter count is ${docs.length} — below the contractual minimum of ${MIN_CHAPTERS}. ` +
      'The docs/fa source of the main repository is incomplete.'
  )
}

// ─── Generate the module ───
const banner = `// ⚠️ GENERATED FILE — do not edit by hand (scripts/generate-docs.ts)
// Source: headscale-easy-manager/docs/fa/*.md — regenerate: bun run docs:generate
// (Fix 4.9: content is generated at build time so the static export output
//  and the Windows package do not depend on run-time fs/endpoints.)

export interface GeneratedDoc {
  order: number
  slug: string
  title: string
  description: string
  icon: string
  content: string
}

/** All chapters, ordered by the frontmatter order (content without frontmatter). */
export const DOCS: GeneratedDoc[] = `

const body = JSON.stringify(docs, null, 2) + '\n'

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
fs.writeFileSync(OUT_FILE, banner + body, 'utf-8')

const kb = (fs.statSync(OUT_FILE).size / 1024).toFixed(1)
console.log(
  `✓ ${docs.length} learn chapters → ${path.relative(PROJECT_ROOT, OUT_FILE)} (${kb} KB) ` +
    `[orders: ${docs.map((d) => d.order).join(', ')}]`
)
