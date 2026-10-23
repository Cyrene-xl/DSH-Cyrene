#!/usr/bin/env node
/**
 * 发布契约自检：DSH STORE 的固定源检查会因为「清单没交代清楚」直接把插件判成
 * 不可安装（Catalog blocked），而这些错误在本地跑测试是发现不了的。这个脚本把
 * 那几条**确定性**要求变成一次本地检查：
 *
 *   1. `engines` 里必须同时有 Node 与 DSH 的兼容范围（商店要求"显式声明"）；
 *   2. `exports` 的每个目标必须是**文件**，不能是目录（`"./x/": "./x/"` 会被判
 *      `runtime artifact path is invalid`）；
 *   3. `files` 必须显式列出，且覆盖所有 export 目标（否则分发面不完整，
 *      商店会判 `fixed-source scan is incomplete`）；
 *   4. 不能有生命周期脚本（商店自动通道不允许跑 prepare/install）；
 *   5. 运行时依赖必须为空（本仓库刻意零依赖）。
 *
 * 只读本地文件，不联网、不安装。用法：`node scripts/verify-package.mjs`
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const problems = []

/** 判断一个路径条目是否"有效"（与商店的 validPath 同口径）。 */
function validPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 1024
    && !path.startsWith('/') && !/[\\\0\r\n]/.test(path)
    && !path.split('/').some((part) => part === '..' || part === '.' || part === '')
}

/** 把一个 files 选择器展开成相对路径集合（只处理本项目用到的字面量 / 目录 / * / **）。 */
function expandSelector(selector) {
  const cleaned = String(selector).replace(/^\.\//, '').replace(/\/$/, '')
  if (!validPath(cleaned)) return null
  if (!cleaned.includes('*')) {
    const absolute = join(root, cleaned)
    if (!existsSync(absolute)) return null
    if (statSync(absolute).isFile()) return [cleaned]
    const found = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.git') continue
        const absoluteChild = join(dir, name)
        const rel = relative(root, absoluteChild)
        if (statSync(absoluteChild).isDirectory()) walk(absoluteChild)
        else found.push(rel)
      }
    }
    walk(absolute)
    return found
  }
  // 只支持单段 * 与整段 **（本项目没用更复杂的 glob）
  const segments = cleaned.split('/')
  let current = ['']
  for (const segment of segments) {
    const next = []
    for (const prefix of current) {
      if (segment === '**') {
        const walk = (rel) => {
          next.push(rel)
          const absolute = join(root, rel)
          if (!existsSync(absolute) || !statSync(absolute).isDirectory()) return
          for (const name of readdirSync(absolute)) {
            if (name === 'node_modules' || name === '.git') continue
            const child = rel === '' ? name : `${rel}/${name}`
            if (statSync(join(root, child)).isDirectory()) walk(child)
            else next.push(child)
          }
        }
        walk(prefix)
        continue
      }
      if (segment === '*') {
        const absolute = join(root, prefix)
        if (!existsSync(absolute) || !statSync(absolute).isDirectory()) continue
        for (const name of readdirSync(absolute)) {
          if (name === 'node_modules' || name === '.git') continue
          next.push(prefix === '' ? name : `${prefix}/${name}`)
        }
        continue
      }
      next.push(prefix === '' ? segment : `${prefix}/${segment}`)
    }
    current = next
  }
  return current.filter((rel) => existsSync(join(root, rel)) && statSync(join(root, rel)).isFile())
}

// ── 1) 兼容范围 ───────────────────────────────────────────────────────────
const engines = manifest.engines
if (engines === null || typeof engines !== 'object') {
  problems.push('package.json 缺 engines')
} else {
  for (const key of ['node', 'dsh']) {
    const value = engines[key]
    if (typeof value !== 'string' || value.trim() === '' || value.startsWith('workspace:')) {
      problems.push(`engines.${key} 必须是显式语义化版本范围（当前：${JSON.stringify(value)}）`)
    }
  }
}

// ── 2) exports 目标必须是文件 ─────────────────────────────────────────────
const exportTargets = new Set()
for (const [key, value] of Object.entries(manifest.exports ?? {})) {
  if (typeof value !== 'string') {
    problems.push(`exports["${key}"] 必须是字符串路径（条件导出本仓库不使用）`)
    continue
  }
  const target = value.replace(/^\.\//, '')
  if (!validPath(target)) {
    problems.push(`exports["${key}"] 目标无效（目录形式会被商店判 invalid）：${value}`)
    continue
  }
  if (target.includes('*')) {
    problems.push(`exports["${key}"] 使用通配目标，商店会自动拒绝：${value}`)
    continue
  }
  if (!existsSync(join(root, target)) || !statSync(join(root, target)).isFile()) {
    problems.push(`exports["${key}"] 指向的文件不存在：${value}`)
    continue
  }
  exportTargets.add(target)
}

// ── 3) files 覆盖 ─────────────────────────────────────────────────────────
const files = manifest.files
if (!Array.isArray(files) || files.length === 0) {
  problems.push('package.json 必须显式声明 files')
} else {
  const packaged = new Set(['package.json'])
  for (const selector of files) {
    const expanded = expandSelector(selector)
    if (expanded === null) {
      problems.push(`files 选择器无效或不存在：${selector}`)
      continue
    }
    for (const rel of expanded) packaged.add(rel)
  }
  for (const target of exportTargets) {
    if (!packaged.has(target)) problems.push(`export 目标不在 files 分发面里：${target}`)
  }
  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'preset/chat/agent.cordis.yml']) {
    if (!packaged.has(required)) problems.push(`运行时文件没被打包：${required}`)
  }
}

// ── 4) 生命周期脚本 ───────────────────────────────────────────────────────
for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
  if (typeof manifest.scripts?.[name] === 'string') problems.push(`不允许生命周期脚本：${name}`)
}

// ── 5) 运行时依赖 ─────────────────────────────────────────────────────────
for (const field of ['dependencies', 'optionalDependencies']) {
  if (manifest[field] !== undefined && Object.keys(manifest[field] ?? {}).length > 0) {
    problems.push(`${field} 必须为空（本仓库刻意零运行时依赖）`)
  }
}

if (problems.length === 0) {
  console.log(`✅ 发布契约自检通过：engines ${engines.node} / dsh ${engines.dsh}，`
    + `${exportTargets.size} 个 export 目标、${(manifest.files ?? []).length} 条 files 选择器，`
    + '零生命周期脚本、零运行时依赖。')
} else {
  console.error(`✗ 发布契约自检发现 ${problems.length} 个问题：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exitCode = 1
}
