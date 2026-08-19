'use strict'
// @a_dove/dsh-plugin-registry — Host 侧 Cordis 插件
//   name/inject/apply 导出、defineTool、ctx.tools.register、ctx.webServer.register
// 工具经子进程调用 bin/registry-cli.js（stdout JSON，仅标量）。所有跨进程数据只传 JSON。
import { execFile } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

const name = 'dsh-plugin-registry'

/** 依赖服务 */
const inject = ['webServer', 'tools', 'systemPrompt']

const __dirname = import.meta.dirname
const CLI_PATH = path.join(__dirname, '..', '..', 'bin', 'registry-cli.js')
const DATA_DIR = path.join(__dirname, '..', '..', 'data')
const CACHE_PATH = path.join(DATA_DIR, 'registry.json')
const REPORTS_DIR = path.join(DATA_DIR, 'reports')
const ALLOWLIST_PATH = path.join(DATA_DIR, 'allowlist.json')

// ——— 白名单（交互式）：data/allowlist.json = { entries: [{path, reason, added_at}] } ———
function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { entries: [] }
  try { return JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8')) } catch { return { entries: [] } }
}

function saveAllowlist(list) {
  fs.writeFileSync(ALLOWLIST_PATH, JSON.stringify(list, null, 2), 'utf8')
}

// ——— CLI 子进程调用（仅 JSON 边界） ———
function runCli(args, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [CLI_PATH, ...args], {
      timeout: timeoutMs,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`registry-cli 失败: ${error.message}\n${stdout || ''}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(new Error(`registry-cli 输出非 JSON: ${parseError.message}`))
      }
    })
  })
}

// ——— 工具 ———
/** One text content block (the render shape DSH tools require). */
function text(value) {
  return [{ type: 'text', text: value }]
}

function pluginRegistryListTool() {
  return defineTool({
    name: 'plugin_registry_list',
    description: '列出 DSH 已安装插件的路径注册表（读缓存 registry.json，快速）。返回 entries 数组：type(plugin/preset/skill)、name、version、path、carrier、cDriveRefs。Triggers: 插件路径、插件位置、已装插件、注册表。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          command: { type: 'string' },
          error: { type: 'string' },
          generated_at: { type: 'string' },
          mode: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                type: { type: 'string', enum: ['plugin', 'preset', 'skill'] },
                name: { type: 'string', required: true },
                version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                path: { type: 'string', required: true },
                carrier: { type: 'string', required: true },
                cDriveRefs: { type: 'integer' },
                mtimeMs: { type: 'number' }
              }
            }
          }
        }
      },
      render: (_args, value) => {
        if (!value.ok) return text(`registry: ${value.error || 'unknown error'}`)
        const entries = value.entries ?? []
        const byType = {}
        for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1
        const lines = entries.map((e) => `${e.type === 'plugin' ? '插件' : e.type === 'preset' ? '预设' : '技能'} ${e.name}@${e.version || '—'} | ${e.carrier} | ${e.path}`)
        return text([`共 ${entries.length} 条记录（${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ')}）`, ...lines].join('\n'))
      }
    },
    async execute() {
      return runCli(['list'])
    }
  })
}

function pluginRegistryCheckTool() {
  return defineTool({
    name: 'plugin_registry_check',
    description: '现场全量扫描 DSH 插件载体并执行检查（新装/删除/版本变化 diff、路径与包元数据完整性、C 盘残留引用、依赖完整性），写 registry.json 与报告（data\\reports\\，保留 10 份），返回摘要。mode=quick 快速（缓存载体只记元数据）为默认；mode=all 深度（全部载体全文扫 C 盘引用）。Triggers: 检查插件、扫描插件、插件体检、C 盘残留、新装插件检查。',
    parameters: {
      mode: {
        type: 'string',
        enum: ['quick', 'all'],
        description: '扫描模式：quick=快速（默认），all=深度全文扫'
      },
      dsh_home: {
        type: 'string',
        description: '可选的 DSH_HOME 覆盖（默认 D:\\AI\\DSH）'
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          command: { type: 'string' },
          error: { type: 'string' },
          mode: { type: 'string' },
          generated_at: { type: 'string' },
          report: { type: 'string' },
          registry: { type: 'string' },
          entry_stats: {
            type: 'object',
            additionalProperties: false,
            properties: {
              plugins: { type: 'integer' },
              presets: { type: 'integer' },
              skills: { type: 'integer' },
              total: { type: 'integer' }
            }
          },
          issues_count: { type: 'integer' },
          diff: {
            type: 'object',
            additionalProperties: false,
            properties: {
              added: { type: 'integer' },
              removed: { type: 'integer' },
              changed: { type: 'integer' }
            }
          }
        }
      },
      render: (_args, value) => {
        if (!value.ok) return text(`检查失败: ${value.error || 'unknown error'}`)
        const s = value.entry_stats ?? {}
        const d = value.diff ?? {}
        return text([
          `扫描完成 [${value.mode}] 条目 ${s.total ?? 0}（插件 ${s.plugins ?? 0} / 预设 ${s.presets ?? 0} / 技能 ${s.skills ?? 0}）`,
          `问题 ${value.issues_count ?? 0} 处；变化：新增 ${d.added ?? 0} / 删除 ${d.removed ?? 0} / 版本变化 ${d.changed ?? 0}`,
          `报告: ${value.report || ''}`,
          value.issues_count > 0 ? '检测到问题，请查看报告详情。' : '未检出问题。'
        ].join('\n'))
      }
    },
    async execute(args) {
      const mode = args.mode === 'all' ? 'all' : 'quick'
      const cliArgs = ['scan', '--mode', mode]
      if (typeof args.dsh_home === 'string' && args.dsh_home) cliArgs.push('--dsh-home', args.dsh_home)
      return runCli(cliArgs)
    }
  })
}

function pluginRegistryReportTool() {
  return defineTool({
    name: 'plugin_registry_report',
    description: '读取最近一次 plugin_registry_check 生成的检查报告（data\\reports\\ 最新一份），返回完整报告：entries、issues（含 C 盘残留明细）、diff、entry_stats。Triggers: 最近报告、检查报告、C 盘残留明细。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          command: { type: 'string' },
          error: { type: 'string' },
          report: { type: 'object', additionalProperties: true }
        }
      },
      render: (_args, value) => {
        if (!value.ok) return text(`report: ${value.error || 'unknown error'}`)
        const r = value.report ?? {}
        const issues = r.issues ?? []
        const lines = [`报告 ${r.generated_at || ''} [${r.mode || ''}] 条目 ${r.entry_stats?.total ?? 0}，问题 ${issues.length}`]
        for (const issue of issues.slice(0, 40)) {
          lines.push(`- [${issue.type}] ${issue.path}: ${issue.detail}${issue.suppressed ? '（白名单）' : ''}`)
        }
        if (issues.length > 40) lines.push(`… 其余 ${issues.length - 40} 条见完整报告`)
        return text(lines.join('\n'))
      }
    },
    async execute() {
      return runCli(['report'])
    }
  })
}

// ——— HTTP 路由（Client 面板取数） ———
function writeJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk; if (body.length > 1e6) req.destroy() })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch { resolve(undefined) }
    })
    req.on('error', () => resolve(undefined))
  })
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function makeRoutes() {
  return {
    routes: [
      {
        kind: 'exact',
        path: '/api/dsh-plugin-registry/list',
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
          if (req.method !== 'GET') { writeJson(res, 405, { error: `method not allowed: ${req.method}` }); return }
          try {
            const result = await runCli(['list'])
            writeJson(res, 200, result)
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        }
      },
      {
        kind: 'exact',
        path: '/api/dsh-plugin-registry/check',
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
          if (req.method !== 'POST') { writeJson(res, 405, { error: `method not allowed: ${req.method}` }); return }
          const body = await readJsonBody(req)
          if (body === undefined) { writeJson(res, 400, { error: 'invalid JSON body' }); return }
          const mode = body.mode === 'all' ? 'all' : 'quick'
          const cliArgs = ['scan', '--mode', mode]
          if (typeof body.dsh_home === 'string' && body.dsh_home) cliArgs.push('--dsh-home', body.dsh_home)
          try {
            const result = await runCli(cliArgs)
            writeJson(res, 200, result)
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        }
      },
      {
        kind: 'exact',
        path: '/api/dsh-plugin-registry/report',
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
          if (req.method !== 'GET') { writeJson(res, 405, { error: `method not allowed: ${req.method}` }); return }
          try {
            const result = await runCli(['report'])
            writeJson(res, 200, result)
          } catch (error) {
            writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
          }
        }
      },
      {
        kind: 'exact',
        path: '/api/dsh-plugin-registry/allowlist',
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
          if (req.method === 'GET') {
            writeJson(res, 200, loadAllowlist())
            return
          }
          if (req.method === 'POST') {
            const body = await readJsonBody(req)
            if (body === undefined || typeof body.path !== 'string' || !body.path) {
              writeJson(res, 400, { error: 'path required' })
              return
            }
            const list = loadAllowlist()
            const exists = list.entries.some((e) => e.path === body.path)
            if (!exists) {
              list.entries.push({ path: body.path, reason: typeof body.reason === 'string' ? body.reason : '', added_at: new Date().toISOString() })
              saveAllowlist(list)
            }
            writeJson(res, 200, { ok: true, entries: list.entries })
            return
          }
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
        }
      },
      {
        kind: 'exact',
        path: '/api/dsh-plugin-registry/allowlist/delete',
        handler: async (req, res) => {
          if (!isLoopbackRequest(req)) { writeJson(res, 403, { error: 'forbidden: loopback-only' }); return }
          if (req.method !== 'POST') { writeJson(res, 405, { error: `method not allowed: ${req.method}` }); return }
          const body = await readJsonBody(req)
          if (body === undefined || typeof body.path !== 'string') { writeJson(res, 400, { error: 'path required' }); return }
          const list = loadAllowlist()
          list.entries = list.entries.filter((e) => e.path !== body.path)
          saveAllowlist(list)
          writeJson(res, 200, { ok: true, entries: list.entries })
        }
      }
    ]
  }
}

const GUIDANCE = [
  '本机已安装 @a_dove/dsh-plugin-registry 插件（DSH 插件路径注册表）：',
  '- plugin_registry_list：列出所有安装插件路径（读缓存，快）',
  '- plugin_registry_check：现场全扫+四项检查（新装/删除/版本 diff、路径与元数据完整性、C 盘残留引用、依赖完整性），quick 默认快速、all 深度全文扫，写报告；',
  '- plugin_registry_report：读最近检查报告（含 C 盘残留明细）',
  '用户提到「插件路径 / 插件位置 / 插件检查 / C 盘残留」时即指本插件。面板「插件路径管理」入口可 GUI 查看。'
].join('\n')

const SECTION_ORDER = 160

function apply(ctx, config) {
  let current = () => config ?? {}
  const resolve = () => ({
    announceToAgent: current().announceToAgent ?? true,
    enabled: current().enabled ?? true
  })
  const tools = [pluginRegistryListTool(), pluginRegistryCheckTool(), pluginRegistryReportTool()]
  const { routes } = makeRoutes()
  let disposeSection
  let disposeRoutes
  let disposeTools
  const sync = () => {
    const value = resolve()
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (!value.enabled) return
    if (value.announceToAgent) {
      disposeSection = ctx.systemPrompt.section({ name: 'plugin:dsh-plugin-registry', order: SECTION_ORDER, text: GUIDANCE })
    }
    disposeRoutes = ctx.effect(() => {
      const disposers = routes.map((route) => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-plugin-registry: routes')
    disposeTools = ctx.effect(() => {
      const disposers = tools.map((tool) => ctx.tools.register(tool))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-plugin-registry: tools')
  }
  sync()
}

export { name, inject, apply }
export default { name, inject, apply }
