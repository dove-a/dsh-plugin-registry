'use strict'
// @dove-a/dsh-plugin-registry — CLI 入口（宿主子进程调用，stdout 输出 JSON）
// 用法:
//   registry-cli.js scan [--mode quick|all] [--dsh-home <path>]
//   registry-cli.js list [--dsh-home <path>]
//   registry-cli.js report [--dsh-home <path>]
const path = require('node:path')
const fs = require('node:fs')
const { scanCarriers } = require('../lib/scanner.js')
const { runChecks, diffAgainstBaseline } = require('../lib/checker.js')
const { RegistryStore } = require('../lib/registry.js')

const DEFAULT_DSH_HOME = process.env.DSH_HOME || 'D:\\AI\\DSH'

function parseArgs(argv) {
  const args = { mode: 'quick', dshHome: DEFAULT_DSH_HOME, command: null }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--mode') args.mode = argv[++i]
    else if (a === '--dsh-home') args.dshHome = argv[++i]
    else if (a === '--json') args.json = true
    else if (a.startsWith('--')) { /* unknown, ignore */ }
    else positional.push(a)
  }
  args.command = positional[0]
  if (!['quick', 'all'].includes(args.mode)) args.mode = 'quick'
  return args
}

function buildMarkdown(report) {
  const L = []
  L.push(`# DSH 插件路径检查报告`)
  L.push('')
  L.push(`- 生成时间: ${report.generated_at}`)
  L.push(`- 模式: ${report.mode}`)
  L.push(`- DSH_HOME: ${report.dsh_home}`)
  L.push(`- 插件条目: ${report.entry_stats.plugins}`)
  L.push(`- 预设条目: ${report.entry_stats.presets}`)
  L.push(`- 技能条目: ${report.entry_stats.skills}`)
  L.push(`- 问题数: ${report.issues.length}`)
  L.push('')
  if (report.diff.added.length || report.diff.removed.length || report.diff.changed.length) {
    L.push('## 基线变化')
    L.push('')
    for (const e of report.diff.added) L.push(`- ➕ 新增: ${e.name}@${e.version || '—'} (${e.path})`)
    for (const e of report.diff.removed) L.push(`- ➖ 删除: ${e.name}@${e.version || '—'} (${e.path})`)
    for (const c of report.diff.changed) L.push(`- 🔄 版本变化: ${c.id}: ${c.from} → ${c.to}`)
    L.push('')
  }
  if (report.issues.length) {
    L.push('## 问题清单')
    L.push('')
    for (const issue of report.issues) {
      L.push(`- [${issue.type}] ${issue.path}: ${issue.detail}`)
    }
    L.push('')
  }
  return L.join('\n')
}

function cmdScan(args) {
  const scan = scanCarriers({ dshHome: args.dshHome, mode: args.mode })
  const { issues } = runChecks({ entries: scan.entries })
  // 交互式白名单：命中 allowlist.json 的 c-drive 引用标记 suppressed（不消除，GUI 可见）
  const allowlistPath = path.join(__dirname, '..', 'data', 'allowlist.json')
  let allowlist = []
  try {
    const parsed = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
    allowlist = Array.isArray(parsed.entries) ? parsed.entries.map((e) => e.path) : []
  } catch { /* no allowlist yet */ }
  if (allowlist.length) {
    for (const issue of issues) {
      if (issue.type === 'c-drive' && allowlist.includes(issue.path)) issue.suppressed = true
    }
  }
  const store = new RegistryStore({ dataDir: path.join(__dirname, '..', 'data'), dshHome: args.dshHome })
  const baseline = store.loadRegistry()
  const diff = diffAgainstBaseline(baseline, scan.entries)

  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode: args.mode,
    dsh_home: args.dshHome,
    entry_stats: {
      plugins: scan.entries.filter((e) => e.type === 'plugin').length,
      presets: scan.entries.filter((e) => e.type === 'preset').length,
      skills: scan.entries.filter((e) => e.type === 'skill').length,
      total: scan.entries.length
    },
    entries: scan.entries,
    issues,
    diff
  }
  report.markdown = buildMarkdown(report)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `${stamp}-scan-${args.mode}`
  store.saveReport(report, filename)
  store.saveRegistry({ schema_version: 1, generated_at: report.generated_at, mode: args.mode, entries: scan.entries })

  return {
    ok: true,
    command: 'scan',
    mode: args.mode,
    generated_at: report.generated_at,
    report: path.join(store.reportsDir, filename + '.json'),
    registry: store.registryPath,
    entry_stats: report.entry_stats,
    issues_count: issues.length,
    diff: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }
  }
}

function cmdList(args) {
  const store = new RegistryStore({ dataDir: path.join(__dirname, '..', 'data'), dshHome: args.dshHome })
  const registry = store.loadRegistry()
  if (!registry) return { ok: false, command: 'list', error: 'registry.json 不存在，请先执行 scan' }
  // 附加 mtimeMs（包目录最终修改时间，实时 stat，不写入 registry.json 数据层）：仅供客户端「文件最后修改时间」排序
  const entries = (registry.entries || []).map((entry) => {
    const copy = { ...entry }
    try {
      const stat = fs.statSync(copy.path)
      copy.mtimeMs = typeof stat.mtimeMs === 'number' ? stat.mtimeMs : 0
    } catch {
      copy.mtimeMs = 0
    }
    return copy
  })
  return { ok: true, command: 'list', generated_at: registry.generated_at, mode: registry.mode, entries }
}

function cmdReport(args) {
  const store = new RegistryStore({ dataDir: path.join(__dirname, '..', 'data'), dshHome: args.dshHome })
  const report = store.latestReport()
  if (!report) return { ok: false, command: 'report', error: '暂无检查报告，请先执行 scan' }
  return { ok: true, command: 'report', report }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  let result
  switch (args.command) {
    case 'scan': result = cmdScan(args); break
    case 'list': result = cmdList(args); break
    case 'report': result = cmdReport(args); break
    default:
      result = { ok: false, command: args.command || '(none)', error: '用法: scan|list|report [--mode quick|all] [--dsh-home <path>]' }
  }
  process.stdout.write(JSON.stringify(result, null, 2))
}

if (require.main === module) main()

module.exports = { cmdScan, cmdList, cmdReport, parseArgs, buildMarkdown }