'use strict'
// Host 插件冒烟测试：mock 宿主 ctx（webServer/tools/systemPrompt/effect），
// 调用 apply()，验证：
//  - 3 个工具注册、5 条路由注册、1 条公告 section
//  - 路由 handler 对 mock req/res 的真实往返（list/check/report）
//  - apply 返回的 disposer 可清理
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { EventEmitter } = require('node:events')

const HOST = path.join(__dirname, '..', 'lib', 'host', 'index.mjs')

/** ESM host 插件经动态 import 加载（宿主以 ESM 契约加载；CJS 测试用 import() 对齐） */
let hostModule
async function loadHost() {
  if (hostModule === undefined) {
    const mod = await import(pathToFileURL(HOST).href)
    hostModule = {
      name: mod.name ?? mod.default?.name,
      inject: mod.inject ?? mod.default?.inject,
      apply: mod.apply ?? mod.default?.apply
    }
  }
  return hostModule
}

function makeMockCtx() {
  const calls = { tools: [], routes: [], sections: [] }
  const ctx = {
    tools: {
      register(tool) { calls.tools.push(tool); return () => {} }
    },
    webServer: {
      register(route) { calls.routes.push(route); return () => {} }
    },
    systemPrompt: {
      section(section) { calls.sections.push(section); return () => {} }
    },
    effect(fn) { fn(); return () => {} }
  }
  return { ctx, calls }
}

function mockRes() {
  const res = { status: 0, body: null }
  res.writeHead = (status) => { res.status = status }
  res.end = (body) => { res.body = body }
  return res
}

function mockReq(method, body) {
  const req = new EventEmitter()
  req.method = method
  req.socket = { remoteAddress: '127.0.0.1' }
  if (body !== undefined) {
    let data = JSON.stringify(body)
    process.nextTick(() => req.emit('data', data))
    process.nextTick(() => req.emit('end'))
  } else {
    process.nextTick(() => req.emit('end'))
  }
  return req
}

test('host 插件导出形状对齐官方先例 (name/inject/apply)', async () => {
  const m = await loadHost()
  assert.equal(m.name, 'dsh-plugin-registry')
  assert.deepEqual(m.inject, ['webServer', 'tools', 'systemPrompt'])
  assert.equal(typeof m.apply, 'function')
})

test('apply() 注册 3 工具 + 5 路由 + 1 公告', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: true, enabled: true })
  assert.equal(calls.tools.length, 3)
  assert.equal(calls.routes.length, 5)
  assert.equal(calls.sections.length, 1)
  const toolNames = calls.tools.map((t) => t.name)
  assert.deepEqual(toolNames, ['plugin_registry_list', 'plugin_registry_check', 'plugin_registry_report'])
  const paths = calls.routes.map((r) => r.path)
  assert.ok(paths.includes('/api/dsh-plugin-registry/list'))
  assert.ok(paths.includes('/api/dsh-plugin-registry/check'))
  assert.ok(paths.includes('/api/dsh-plugin-registry/report'))
  assert.ok(paths.includes('/api/dsh-plugin-registry/allowlist'))
  assert.ok(paths.includes('/api/dsh-plugin-registry/allowlist/delete'))
})

test('announceToAgent=false 时不注册公告', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  assert.equal(calls.sections.length, 0)
  assert.equal(calls.tools.length, 3)
})

test('enabled=false 时不注册任何能力', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: true, enabled: false })
  assert.equal(calls.tools.length, 0)
  assert.equal(calls.routes.length, 0)
  assert.equal(calls.sections.length, 0)
})

test('GET /list 路由往返返回 registry 形状', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  const listRoute = calls.routes.find((r) => r.path === '/api/dsh-plugin-registry/list')
  const res = mockRes()
  await listRoute.handler(mockReq('GET'), res)
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.ok(Array.isArray(body.entries))
  assert.ok(body.entries.length > 0)
  const first = body.entries[0]
  assert.equal(typeof first.type, 'string')
  assert.equal(typeof first.path, 'string')
  assert.equal(typeof first.carrier, 'string')
})

test('GET /report 路由往返返回最近报告', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  const reportRoute = calls.routes.find((r) => r.path === '/api/dsh-plugin-registry/report')
  const res = mockRes()
  await reportRoute.handler(mockReq('GET'), res)
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.ok(body.report !== null && typeof body.report === 'object')
})

test('POST /check 路由往返（quick）生成新报告', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  const checkRoute = calls.routes.find((r) => r.path === '/api/dsh-plugin-registry/check')
  const res = mockRes()
  await checkRoute.handler(mockReq('POST', { mode: 'quick' }), res)
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.ok, true)
  assert.equal(body.mode, 'quick')
  assert.equal(typeof body.issues_count, 'number')
  assert.ok(typeof body.report === 'string' && body.report.length > 0)
})

test('POST /allowlist 往返：添加/读取/删除', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  const probe = 'D:\\__smoke_probe__\\path'
  const addRoute = calls.routes.find((r) => r.path === '/api/dsh-plugin-registry/allowlist')
  const delRoute = calls.routes.find((r) => r.path === '/api/dsh-plugin-registry/allowlist/delete')

  const addRes = mockRes()
  await addRoute.handler(mockReq('POST', { path: probe, reason: 'smoke test' }), addRes)
  assert.equal(addRes.status, 200)
  assert.ok(JSON.parse(addRes.body).entries.some((e) => e.path === probe))

  const getRes = mockRes()
  await addRoute.handler(mockReq('GET'), getRes)
  assert.equal(getRes.status, 200)
  assert.ok(JSON.parse(getRes.body).entries.some((e) => e.path === probe))

  const delRes = mockRes()
  await delRoute.handler(mockReq('POST', { path: probe }), delRes)
  assert.equal(delRes.status, 200)
  assert.ok(!JSON.parse(delRes.body).entries.some((e) => e.path === probe))
})

test('非回环请求被拒绝', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  const listRoute = calls.routes.find((r) => r.path === '/api/dsh-plugin-registry/list')
  const res = mockRes()
  const req = mockReq('GET')
  req.socket.remoteAddress = '192.168.1.50'
  await listRoute.handler(req, res)
  assert.equal(res.status, 403)
})

test('工具对象形状含 name/description/parameters/execute', async () => {
  const { ctx, calls } = makeMockCtx()
  const m = await loadHost()
  m.apply(ctx, { announceToAgent: false, enabled: true })
  for (const tool of calls.tools) {
    assert.equal(typeof tool.name, 'string')
    assert.equal(typeof tool.description, 'string')
    assert.ok(tool.parameters !== undefined)
    assert.equal(typeof tool.execute, 'function')
    assert.ok(tool.output !== undefined && tool.output.schema !== undefined)
  }
})