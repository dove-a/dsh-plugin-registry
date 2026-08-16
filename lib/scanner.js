'use strict'
// @a_dove/dsh-plugin-registry — 载体扫描器
// 判定规则：含 package.json 的包目录 = 插件条目；SKILL.md 目录 = skill 条目；
// .agent-presets 直接子目录 = preset 条目。
// 双模式：quick（cache 载体仅元数据，pkg/preset/skill 全文扫 C 盘引用）；
//         all（全部载体全文扫）。
const fs = require('node:fs')
const path = require('node:path')

// 拼接避免检测器自身源码出现字面盘符（否则扫到自己：正则文本含 C: 路径模式即被计数）
const C_REF_RE = new RegExp('C' + ':' + '\\\\' + '|C' + ':' + '/', 'g')
const MAX_SCAN_FILE_BYTES = 512 * 1024

const DEFAULT_CARRIERS = (dshHome) => [
  { name: '@deepseek-ai/*', type: 'pkg', roots: [path.join(dshHome, 'profiles', 'web', 'node_modules', '@deepseek-ai')] },
  { name: '@linxin666/*', type: 'pkg', roots: [path.join(dshHome, 'profiles', 'web', 'node_modules', '@linxin666')] },
  { name: '@a_dove/*', type: 'pkg', roots: [path.join(dshHome, 'profiles', 'web', 'node_modules', '@a_dove'), path.join(dshHome, 'profiles', 'web', 'node_modules', 'dsh-chat-window-fold')] },
  { name: 'npx-persist', type: 'cache', roots: [path.join(dshHome, 'cli', 'npx-persist', 'node_modules')] },
  { name: 'npm-cache/_npx', type: 'cache', roots: [path.join(dshHome, 'cli', 'npm-cache', '_npx')] },
  { name: 'npm-global', type: 'cache', roots: [path.join(dshHome, 'cli', 'npm-global')] },
  { name: '.agent-presets', type: 'preset', roots: [path.join(dshHome, '.agent-presets')] },
  { name: 'skills(.agents)', type: 'skill', roots: [path.join(dshHome, '.agents', 'skills')] },
  { name: 'skills(DSH)', type: 'skill', roots: [path.join(dshHome, 'skills')] }
]

// 递归收集含 package.json 的包目录（不深入任何 node_modules 依赖树）。
// npx 容器清单（package.json 含 _npx.packages 字段）不是插件包——跳过其本身，继续深入其 node_modules。
function collectPackages(root, out, carrier, mode, depth) {
  if (depth > 8 || !fs.existsSync(root)) return out
  let stat
  try { stat = fs.statSync(root) } catch { return out }
  if (!stat.isDirectory()) return out
  const pkgJson = path.join(root, 'package.json')
  if (fs.existsSync(pkgJson)) {
    let isNpxContainer = false
    try {
      const meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8'))
      isNpxContainer = Array.isArray(meta._npx && meta._npx.packages)
    } catch { isNpxContainer = false }
    if (!isNpxContainer) {
      const id = path.relative(path.parse(root).root, root).replace(/\\/g, '/')
      out.push({ id, type: 'plugin', name: path.basename(root), version: null, path: root, carrier, cDriveRefs: 0 })
      return out // 不深入包内部依赖树
    }
    // npx 容器：继续遍历其子目录（node_modules 下才是真实包），不返回
  }
  let children = []
  try { children = fs.readdirSync(root, { withFileTypes: true }) } catch { return out }
  for (const child of children) {
    if (!child.isDirectory()) continue
    if (child.name === 'node_modules') {
      // 载体根自身的 node_modules：其直接子项（@scope 或无 scope）按包处理
      const nmRoot = path.join(root, child.name)
      try {
        for (const nmChild of fs.readdirSync(nmRoot, { withFileTypes: true })) {
          if (!nmChild.isDirectory()) continue
          const innerRoot = path.join(nmRoot, nmChild.name)
          if (nmChild.name.startsWith('@')) {
            collectPackages(innerRoot, out, carrier, mode, depth + 1)
          } else {
            collectPackages(innerRoot, out, carrier, mode, depth + 1)
          }
        }
      } catch { /* ignore */ }
      continue
    }
    collectPackages(path.join(root, child.name), out, carrier, mode, depth + 1)
  }
  return out
}

// 全文扫 C 盘引用计数（≤512KB 文本文件，跳过二进制）
const BINARY_EXT = new Set(['.pyc', '.pyo', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.zip', '.gz', '.7z', '.tar', '.woff', '.woff2', '.ttf', '.node', '.map'])
function countCDriveRefs(dir, doScan) {
  if (!doScan) return 0
  let count = 0
  const walk = (d) => {
    let children = []
    try { children = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const child of children) {
      const p = path.join(d, child.name)
      if (child.isDirectory()) { walk(p); continue }
      if (child.isFile()) {
        const ext = path.extname(child.name).toLowerCase()
        if (BINARY_EXT.has(ext)) continue
        try {
          const stat = fs.statSync(p)
          if (stat.size > MAX_SCAN_FILE_BYTES) continue
          const buf = fs.readFileSync(p)
          if (buf.includes(0)) continue // 含 NUL 视为二进制
          const text = buf.toString('utf8')
          const m = text.match(C_REF_RE)
          if (m) count += m.length
        } catch { /* unreadable — skip */ }
      }
    }
  }
  walk(dir)
  return count
}

// 启发式：无显式 carriers 时按根目录名分类（测试友好）
function heuristicCarrier(name) {
  if (/cache|_npx|npx/i.test(name)) return 'cache'
  if (/preset/i.test(name)) return 'preset'
  if (/skill/i.test(name)) return 'skill'
  return 'pkg'
}

// 推断载体目录：dshHome 直接子目录（用户树）或默认 DSH 布局
function resolveCarriers(dshHome, carriers) {
  if (Array.isArray(carriers) && carriers.length) return carriers
  // 优先默认 DSH 布局：任一默认根存在即采用（真实 DSH 环境）
  const defaults = DEFAULT_CARRIERS(dshHome)
  const defaultRoots = defaults.filter((c) => c.roots.some((r) => fs.existsSync(r)))
  if (defaultRoots.length) return defaultRoots
  // 无默认根（测试树/自定义树）：启发式按直接子目录名分类
  const custom = []
  try {
    for (const child of fs.readdirSync(dshHome, { withFileTypes: true })) {
      if (!child.isDirectory() || child.name.startsWith('.')) continue
      custom.push({ name: child.name, type: heuristicCarrier(child.name), roots: [path.join(dshHome, child.name)] })
    }
  } catch { /* empty tree */ }
  // 已知点目录统一按类型追加：.agent-presets → preset、.agents → skill
  for (const [dir, type] of [['.agent-presets', 'preset'], ['.agents', 'skill']]) {
    const p = path.join(dshHome, dir)
    if (fs.existsSync(p)) {
      const existing = custom.findIndex((c) => c.name === dir)
      if (existing >= 0) custom.splice(existing, 1)
      custom.push({ name: dir, type, roots: [p] })
    }
  }
  return custom
}

function scanCarriers({ dshHome, mode = 'quick', carriers }) {
  const carrierList = resolveCarriers(dshHome, carriers)
  const entries = []
  const fullScan = mode === 'all'
  for (const carrier of carrierList) {
    const carrierFullScan = fullScan || carrier.type !== 'cache' // quick: 非 cache 载体仍全文扫
    const scanned = new Set()
    for (const root of carrier.roots) {
      if (scanned.has(root)) continue
      scanned.add(root)
      if (carrier.type === 'preset') {
        // preset 条目 = 根的直接子目录
        let children = []
        try { children = fs.readdirSync(root, { withFileTypes: true }) } catch { continue }
        for (const child of children) {
          if (!child.isDirectory()) continue
          const p = path.join(root, child.name)
          const pkgJson = path.join(p, 'package.json')
          let version = null
          if (fs.existsSync(pkgJson)) {
            try { version = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version || null } catch { /* keep null */ }
          }
          entries.push({
            id: path.relative(dshHome, p).replace(/\\/g, '/'),
            type: 'preset',
            name: child.name,
            version,
            path: p,
            carrier: carrier.name,
            cDriveRefs: countCDriveRefs(p, carrierFullScan)
          })
        }
        continue
      }
      if (carrier.type === 'skill') {
        // skill 条目 = 含 SKILL.md 的直接子目录；若子目录名为 skills 则深入一层
        const walkSkill = (dir) => {
          let children = []
          try { children = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
          for (const child of children) {
            if (!child.isDirectory()) continue
            const p = path.join(dir, child.name)
            if (fs.existsSync(path.join(p, 'SKILL.md'))) {
              entries.push({
                id: path.relative(dshHome, p).replace(/\\/g, '/'),
                type: 'skill',
                name: child.name,
                version: null,
                path: p,
                carrier: carrier.name,
                cDriveRefs: countCDriveRefs(p, carrierFullScan)
              })
            } else if (child.name === 'skills') {
              walkSkill(p)
            }
          }
        }
        walkSkill(root)
        continue
      }
      // pkg / cache：收集 package.json 目录
      const pkgs = collectPackages(root, [], carrier.name, mode, 0)
      for (const pkg of pkgs) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(pkg.path, 'package.json'), 'utf8'))
          pkg.name = meta.name || pkg.name
          pkg.version = meta.version || null
        } catch { /* metadata broken — checker 负责 */ }
        // quick 模式下 cache 载体不全文扫；all 下全扫；pkg 载体 quick 也全文扫
        pkg.cDriveRefs = countCDriveRefs(pkg.path, carrierFullScan)
        entries.push(pkg)
      }
    }
  }
  return { mode, entries }
}

module.exports = { scanCarriers, countCDriveRefs, heuristicCarrier, DEFAULT_CARRIERS }