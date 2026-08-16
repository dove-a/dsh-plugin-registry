'use strict'
// @a_dove/dsh-plugin-registry — 检查器：元数据完整性 / 基线 diff / 依赖完整性
const fs = require('node:fs')
const path = require('node:path')

// 检查 package.json 元数据完整性：文件存在、可解析、name/version 齐备
function checkMetadata(entry) {
  const issues = []
  const pkgJson = path.join(entry.path, 'package.json')
  if (!fs.existsSync(pkgJson)) {
    issues.push({ type: 'metadata', path: entry.path, detail: 'package.json 缺失' })
    return issues
  }
  let meta
  try {
    meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
  } catch {
    issues.push({ type: 'metadata', path: entry.path, detail: 'package.json 解析失败' })
    return issues
  }
  if (!meta.name) issues.push({ type: 'metadata', path: entry.path, detail: 'name 缺失' })
  if (!meta.version) issues.push({ type: 'metadata', path: entry.path, detail: 'version 缺失' })
  return issues
}

// 依赖完整性：插件条目声明的依赖能否在 DSH 节点模块树中解析
function checkDependencies(entry) {
  const issues = []
  const pkgJson = path.join(entry.path, 'package.json')
  let meta = null
  try { meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8')) } catch { return issues }
  const deps = Object.assign({}, meta.dependencies || {}, meta.optionalDependencies || {})
  const depNames = Object.keys(deps)
  if (!depNames.length) return issues
  // 查找路径：从本包向上找 node_modules；若本包已在某 node_modules 根下，该根本身即候选
  const candidates = []
  let dir = entry.path
  while (true) {
    const parent = path.dirname(dir)
    if (path.basename(parent) === 'node_modules') candidates.push(parent) // 平铺依赖根
    candidates.push(path.join(dir, 'node_modules'))
    if (parent === dir) break
    dir = parent
  }
  candidates.push('D:\\AI\\DSH\\profiles\\web\\node_modules')
  for (const dep of depNames) {
    const resolved = candidates.some((nm) => {
      const direct = path.join(nm, dep)
      const scoped = dep.startsWith('@') ? path.join(nm, dep.split('/')[0], dep.split('/')[1]) : null
      return fs.existsSync(path.join(direct, 'package.json')) || (scoped ? fs.existsSync(path.join(scoped, 'package.json')) : false)
    })
    if (!resolved) {
      issues.push({ type: 'dependency', path: entry.path, detail: `依赖 ${dep}@${deps[dep]} 未解析` })
    }
  }
  return issues
}

// 全量检查：对条目列表执行四项检查（元数据 / C 盘引用 / 依赖），返回 issues
function runChecks({ entries }) {
  const issues = []
  for (const entry of entries) {
    if (entry.type === 'plugin') {
      issues.push(...checkMetadata(entry))
      // cache 载体（npx 缓存/npm 全局）由 npm 自身管理，依赖解析不作为检查项
      if (entry.carrier !== 'npx-persist' && entry.carrier !== 'npm-cache/_npx' && entry.carrier !== 'npm-global') {
        issues.push(...checkDependencies(entry))
      }
    }
    if (entry.cDriveRefs > 0) {
      issues.push({ type: 'c-drive', path: entry.path, detail: `检测到 ${entry.cDriveRefs} 处 C 盘路径引用` })
    }
  }
  return { issues }
}

// 基线 diff：新增 / 删除 / 版本变化
function diffAgainstBaseline(baseline, currentEntries) {
  const baseMap = new Map((baseline && baseline.entries ? baseline.entries : []).map((e) => [e.id, e]))
  const curMap = new Map(currentEntries.map((e) => [e.id, e]))
  const added = []
  const removed = []
  const changed = []
  for (const [id, cur] of curMap) {
    const base = baseMap.get(id)
    if (!base) { added.push(cur); continue }
    if ((base.version || '') !== (cur.version || '')) {
      changed.push({ id, from: base.version || '—', to: cur.version || '—' })
    }
  }
  for (const [id, base] of baseMap) {
    if (!curMap.has(id)) removed.push(base)
  }
  return { added, removed, changed }
}

module.exports = { checkMetadata, checkDependencies, runChecks, diffAgainstBaseline }