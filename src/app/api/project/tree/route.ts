import fs from 'node:fs/promises'
import path from 'node:path'
import { HEM_ROOT, isExcluded, jsonError } from '@/lib/hem-project'

export const dynamic = 'force-dynamic'

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  children?: TreeNode[]
}

export interface TreeStats {
  files: number
  dirs: number
  pyLines: number
  testFunctions: number
  chapters: number
  totalSize: number
}

async function walk(absDir: string, relDir: string, stats: TreeStats): Promise<TreeNode[]> {
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []

  for (const entry of entries) {
    if (isExcluded(entry.name)) continue
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name
    const abs = path.join(absDir, entry.name)

    if (entry.isDirectory()) {
      stats.dirs += 1
      const children = await walk(abs, rel, stats)
      const size = children.reduce((acc, c) => acc + (c.type === 'file' ? c.size : 0), 0)
      dirs.push({ name: entry.name, path: rel, type: 'dir', size, children })
    } else if (entry.isFile()) {
      const info = await fs.stat(abs)
      stats.files += 1
      stats.totalSize += info.size

      if (entry.name.endsWith('.py')) {
        const text = await fs.readFile(abs, 'utf-8')
        const lineCount = text.split('\n').length
        stats.pyLines += lineCount
        if (rel.startsWith('tests/')) {
          stats.testFunctions += (text.match(/^def test_/gm) ?? []).length
        }
      }
      if (rel.startsWith('docs/fa/') && entry.name.endsWith('.md')) {
        stats.chapters += 1
      }
      files.push({ name: entry.name, path: rel, type: 'file', size: info.size })
    }
  }

  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'en')
  dirs.sort(byName)
  files.sort(byName)
  return [...dirs, ...files]
}

export async function GET() {
  try {
    const stats: TreeStats = {
      files: 0,
      dirs: 0,
      pyLines: 0,
      testFunctions: 0,
      chapters: 0,
      totalSize: 0,
    }
    const tree = await walk(HEM_ROOT, '', stats)
    return Response.json({
      root: {
        name: 'headscale-easy-manager',
        path: '',
        type: 'dir' as const,
        size: stats.totalSize,
        children: tree,
      },
      stats,
    })
  } catch (err) {
    console.error('[api/project/tree]', err)
    return jsonError('ساخت درخت پروژه با خطا مواجه شد.', 500)
  }
}
