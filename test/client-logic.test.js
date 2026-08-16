'use strict'
// Client 侧逻辑层测试（无需 react/jsdom）：
//  - PanelController 状态机（订阅/开关/emit）
//  - RegistryApi 请求构造与错误处理（mock global.fetch）
//  - sidebarRoot/newSessionButton/placeEntry 定位逻辑（fake DOM 元素）
//  - entry 创建与 alert 联动契约
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 复刻 lib/client.js 中纯逻辑部分（避免依赖浏览器环境 require react）
// —— 与被测文件的同构实现，逐函数比对保持同步。
const ACTIVE_ATTR = 'data-dsh-registry-active'
const OTHER_ACTIVE_ATTR = 'data-dsh-taskboard-active'

class PanelController {
  constructor() { this.panelOpen = false; this.listeners = new Set() }
  getSnapshot() { return { panelOpen: this.panelOpen } }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  open() { this.panelOpen = true; this.emit() }
  close() { this.panelOpen = false; this.emit() }
  toggle() { this.panelOpen = !this.panelOpen; this.emit() }
  emit() { for (const fn of [...this.listeners]) fn() }
}

class RegistryApi {
  constructor() { this.base = '/api/dsh-plugin-registry' }
  async _request(url, options) {
    const response = await fetch(this.base + url, options ?? {})
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(typeof body === 'object' && body !== null && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
    return body
  }
  list() { return this._request('/list') }
  check(mode) { return this._request('/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) }) }
  report() { return this._request('/report') }
  allowlist() { return this._request('/allowlist') }
  allowlistAdd(path, reason) { return this._request('/allowlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path, reason }) }) }
  allowlistDelete(path) { return this._request('/allowlist/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }) }
}

function sidebarRootFake(document) {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  return column.querySelector('[class*="logoRow"]')?.parentElement ?? column.firstElementChild
}

function newSessionButtonFake(root) {
  const nested = root.querySelector('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) if (child.tagName === 'BUTTON') return child
}

function placeEntryFake(root, entry) {
  const button = newSessionButtonFake(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = row !== null && row.parentElement === root ? row : button
    const family = Array.from(root.children).filter((el) => el instanceof El && el.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-registry-entry]'))
    const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
    root.insertBefore(entry, anchor)
  }
  return true
}

// —— fake DOM ——
class El {
  constructor(tag, attrs = {}) {
    this.tagName = tag
    this.children = []
    this.parentElement = null
    this.dataset = {}
    this._attrs = attrs
  }
  appendChild(child) { child.parentElement = this; this.children.push(child) }
  insertBefore(node, anchor) {
    node.parentElement = this
    const idx = anchor === null || anchor === undefined ? this.children.length : this.children.indexOf(anchor)
    this.children.splice(idx < 0 ? this.children.length : idx, 0, node)
  }
  querySelector(sel) {
    if (this.children.length === 0) return null
    for (const child of this.children) {
      let hit = this._match(child, sel)
      if (hit !== null) return hit
      hit = child.querySelector(sel)
      if (hit !== null) return hit
    }
    return null
  }
  querySelectorAll(sel) {
    const out = []
    const walk = (node) => { for (const c of node.children) { const m = this._match(c, sel); if (m) out.push(m); walk(c) } }
    walk(this)
    return out
  }
  closest(sel) {
    let node = this
    while (node !== null) {
      if (this._match(node, sel) !== null) return node
      node = node.parentElement
    }
    return null
  }
  matches(sel) {
    // 与官方 el.matches 契约一致：支持逗号分隔的组合选择器，任一命中即匹配
    return sel.split(',').some((part) => this._match(this, part.trim()) !== null)
  }
  _match(el, sel) {
    if (sel.startsWith('[class*="')) {
      const name = sel.slice(9, -2)
      return (el._attrs.class || '').includes(name) ? el : null
    }
    if (sel.startsWith('[data-') && sel.endsWith(']')) {
      const key = sel.slice(1, -1)
      return el._attrs[key] !== undefined && el._attrs[key] !== null ? el : null
    }
    if (sel === 'button[class*="newSession"]') {
      return el.tagName === 'BUTTON' && (el._attrs.class || '').includes('newSession') ? el : null
    }
    return null
  }
}

function findEl(root, key) {
  const found = root.querySelectorAll('[data-dsh-registry-entry]')
  return found.length > 0 ? found[0] : null
}

// 与 lib/client.js 同构的抑制判定：报告固化 suppressed 标注 + 白名单路径动态合并
function isSuppressed(issue, allowSet) {
  return issue.suppressed === true || allowSet.has(issue.path)
}
function problemPathSet(issues, allowlist) {
  const allowSet = new Set(allowlist)
  return new Set(issues.filter((i) => !isSuppressed(i, allowSet)).map((i) => i.path))
}

// —— tests ——
test('PanelController 状态机：toggle/open/close/订阅', () => {
  const c = new PanelController()
  let seen = []
  const un = c.subscribe(() => seen.push(c.getSnapshot().panelOpen))
  assert.equal(c.getSnapshot().panelOpen, false)
  c.toggle()
  assert.equal(c.getSnapshot().panelOpen, true)
  c.open()
  assert.equal(c.getSnapshot().panelOpen, true)
  c.close()
  assert.equal(c.getSnapshot().panelOpen, false)
  assert.deepEqual(seen, [true, true, false])
  un()
  c.open()
  assert.deepEqual(seen, [true, true, false])
})

test('RegistryApi 请求构造与错误处理', async () => {
  const calls = []
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => ({ ok: true, entries: [] }) }
  }
  const api = new RegistryApi()
  await api.list()
  await api.check('all')
  await api.report()
  await api.allowlist()
  await api.allowlistAdd('D:\\x', 'reason')
  await api.allowlistDelete('D:\\x')
  assert.equal(calls[0].url, '/api/dsh-plugin-registry/list')
  assert.equal(calls[1].url, '/api/dsh-plugin-registry/check')
  assert.equal(calls[1].options.method, 'POST')
  assert.equal(calls[1].options.body, JSON.stringify({ mode: 'all' }))
  assert.equal(calls[4].url, '/api/dsh-plugin-registry/allowlist')
  assert.equal(calls[4].options.body, JSON.stringify({ path: 'D:\\x', reason: 'reason' }))
  assert.equal(calls[5].url, '/api/dsh-plugin-registry/allowlist/delete')

  global.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) })
  await assert.rejects(() => api.list(), /not found/)
  delete global.fetch
})

test('placeEntry 定位：插在 New Session 行之后、任务板入口后', () => {
  const root = new El('DIV')
  // shell：root 直接子元素含 logoRow（内有 New Session 按钮）与已挂载的 taskboard 入口
  const logoRow = new El('DIV', { class: 'flex logoRow css-abc' })
  const newSession = new El('BUTTON', { class: 'newSession css-xyz' })
  logoRow.appendChild(newSession)
  root.appendChild(logoRow)
  const taskboardEntry = new El('BUTTON', {})
  taskboardEntry.dataset.dshTaskboardEntry = ''
  taskboardEntry._attrs['data-dsh-taskboard-entry'] = ''
  root.appendChild(taskboardEntry)

  const entry = new El('BUTTON', {})
  entry.dataset.dshRegistryEntry = ''
  entry._attrs['data-dsh-registry-entry'] = ''

  assert.equal(placeEntryFake(root, entry), true)
  assert.equal(entry.parentElement, root)
  const idxTask = root.children.indexOf(taskboardEntry)
  const idxEntry = root.children.indexOf(entry)
  assert.equal(idxTask + 1, idxEntry)
  // 幂等：再次放置不重复
  assert.equal(placeEntryFake(root, entry), true)
  assert.equal(root.children.filter((c) => c._attrs['data-dsh-registry-entry'] !== undefined).length, 1)
})

test('打开面板时移除其他面板激活属性、关闭时恢复', () => {
  const c = new PanelController()
  const calls = []
  const applyActive = () => {
    if (c.getSnapshot().panelOpen) {
      calls.push('open')
    } else calls.push('close')
  }
  const un = c.subscribe(applyActive)
  c.open()
  c.close()
  un()
  assert.deepEqual(calls, ['open', 'close'])
})

test('异常判定：白名单路径即时抑制（无需重新扫描生成 suppressed 标注）', () => {
  const issues = [
    { type: 'c-drive', path: 'D:\\A', detail: 'x' },
    { type: 'c-drive', path: 'D:\\B', detail: 'y' },
    { type: 'c-drive', path: 'D:\\C', detail: 'z', suppressed: true }
  ]
  // 无白名单：A/B 为问题，C（报告已标注）不算
  assert.deepEqual([...problemPathSet(issues, [])].sort(), ['D:\\A', 'D:\\B'])
  // 动态白名单加入 A：立即从问题区消失（报告仍是旧报告，无 suppressed 标注）
  assert.deepEqual([...problemPathSet(issues, ['D:\\A'])].sort(), ['D:\\B'])
  // 全部处置后无问题
  assert.equal(problemPathSet(issues, ['D:\\A', 'D:\\B']).size, 0)
  // 白名单与报告标注不冲突
  assert.equal(problemPathSet(issues, ['D:\\C']).size, 2)
})

test('摘要计数：问题数 = 未处置数（白名单/suppressed 不计入），并给出已处置提示量', () => {
  const issues = [
    { type: 'c-drive', path: 'D:\\A', detail: 'x' },
    { type: 'c-drive', path: 'D:\\B', detail: 'y' },
    { type: 'c-drive', path: 'D:\\C', detail: 'z', suppressed: true }
  ]
  const activeCount = (list, allowlist) => list.filter((i) => !isSuppressed(i, new Set(allowlist))).length
  // 无白名单：B 未处置（C 已标注 suppressed），A 未处置 → active 2
  assert.equal(activeCount(issues, []), 2)
  // A 加入白名单（动态生效，无需重新扫描）→ active 1
  assert.equal(activeCount(issues, ['D:\\A']), 1)
  // 三个全处置（A/B 走白名单，C 走报告标注）→ active 0，用户场景：显示「问题 0 处（3 处已白名单处置）」
  assert.equal(activeCount(issues, ['D:\\A', 'D:\\B']), 0)
  assert.equal(issues.length - activeCount(issues, ['D:\\A', 'D:\\B']), 3)
})

// ——— UI 增强纯逻辑（排序/折叠/搜索/交互契约/初始默认状态）———

const SEARCH_SORT_FIELD = 'mtime'
const SEARCH_SORT_ORDER = 'desc'
const DEFAULT_SORT = { field: 'name', order: 'asc' }

// 同前缀折叠：解析名称/版本栏中的 @scope/ 前缀（如 @linxin666/），无前缀返回 null
function parseScopePrefix(name) {
  const match = /^(@[^/]+\/)/.exec(String(name ?? ''))
  return match !== null ? match[1] : null
}

// 按前缀分组：返回 [{ scope, entries }]，scope 为前缀字符串或 null（无前缀组），保持条目输入顺序
function groupByScope(entries) {
  const groups = []
  const index = new Map()
  for (const entry of entries) {
    const scope = parseScopePrefix(entry.name)
    let group = index.get(scope ?? '\u0000')
    if (group === undefined) {
      group = { scope, entries: [] }
      index.set(scope ?? '\u0000', group)
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}

// 折叠默认状态：每次面板初始化均为全部收起（始终默认，不记忆）
function initialCollapsedScopes(entries) {
  return new Set(groupByScope(entries).filter((g) => g.scope !== null).map((g) => g.scope))
}

// 搜索过滤：名称/版本/路径/载体任一包含查询词（不区分大小写）；空查询返回全部
function filterEntries(entries, query) {
  const q = String(query ?? '').trim().toLowerCase()
  if (q === '') return entries.slice()
  return entries.filter((e) => {
    const haystack = [e.name, e.version, e.path, e.carrier].map((v) => String(v ?? '')).join('\n').toLowerCase()
    return haystack.includes(q)
  })
}

// 排序：field=name | mtime（entry.mtimeMs），order=asc | desc；名称用 localeCompare（A-Z）
function sortEntries(entries, field, order) {
  const f = field === 'mtime' ? 'mtime' : 'name'
  const dir = order === 'desc' ? -1 : 1
  return entries.slice().sort((a, b) => {
    let cmp
    if (f === 'mtime') {
      const am = typeof a.mtimeMs === 'number' ? a.mtimeMs : 0
      const bm = typeof b.mtimeMs === 'number' ? b.mtimeMs : 0
      cmp = am === bm ? 0 : (am < bm ? -1 : 1)
    } else {
      cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
    }
    return cmp * dir
  })
}

// 搜索/排序交互契约：进入搜索（keyword 非空）→ mtime 降序（最新在前）；退出搜索 → 恢复进入前最后一次手动排序
function applySearchSort(manualSort, keyword) {
  if (String(keyword ?? '').trim() !== '') return { field: SEARCH_SORT_FIELD, order: SEARCH_SORT_ORDER }
  return { field: manualSort.field, order: manualSort.order }
}

// 初始默认状态：首次打开（无持久化记忆）→ 名称升序（A-Z）；有记忆 → 按记忆
function resolveInitialSort(storedSort) {
  if (storedSort !== null && storedSort !== undefined && (storedSort.field === 'name' || storedSort.field === 'mtime')) {
    return { field: storedSort.field, order: storedSort.order === 'desc' ? 'desc' : 'asc' }
  }
  return { field: DEFAULT_SORT.field, order: DEFAULT_SORT.order }
}

test('parseScopePrefix：识别 @scope/ 前缀，无前缀返回 null', () => {
  assert.equal(parseScopePrefix('@linxin666/dsh-ssh'), '@linxin666/')
  assert.equal(parseScopePrefix('@deepseek-ai/dsh'), '@deepseek-ai/')
  assert.equal(parseScopePrefix('dsh-plugin-registry'), null)
  assert.equal(parseScopePrefix(''), null)
  assert.equal(parseScopePrefix(undefined), null)
})

test('groupByScope：按前缀分组，无前缀独立一组，保持顺序', () => {
  const entries = [
    { name: '@linxin666/dsh-ssh' },
    { name: 'plain-plugin' },
    { name: '@linxin666/dsh-task-board' },
    { name: '@deepseek-ai/dsh' }
  ]
  const groups = groupByScope(entries)
  assert.equal(groups.length, 3)
  assert.equal(groups[0].scope, '@linxin666/')
  assert.equal(groups[0].entries.length, 2)
  assert.equal(groups[1].scope, null)
  assert.equal(groups[1].entries.length, 1)
  assert.equal(groups[2].scope, '@deepseek-ai/')
  assert.equal(groups[2].entries.length, 1)
})

test('initialCollapsedScopes：折叠状态始终默认（全部收起，不记忆展开）', () => {
  const entries = [
    { name: '@linxin666/dsh-ssh' },
    { name: '@linxin666/dsh-task-board' },
    { name: 'plain-plugin' },
    { name: '@deepseek-ai/dsh' }
  ]
  const collapsed = initialCollapsedScopes(entries)
  assert.equal(collapsed.size, 2)
  assert.ok(collapsed.has('@linxin666/'))
  assert.ok(collapsed.has('@deepseek-ai/'))
  // 无论用户上次如何展开，初始化后均为收起（无记忆）
  assert.equal(initialCollapsedScopes(entries).has('@linxin666/'), true)
})

test('filterEntries：按名称/版本/路径/载体过滤，空查询返回全部', () => {
  const entries = [
    { name: '@linxin666/dsh-ssh', version: '1.0.0', path: 'D:\\A\\dsh-ssh', carrier: '@linxin666/*' },
    { name: 'registry-plugin', version: '2.1.0', path: 'D:\\B\\reg', carrier: 'node_modules' },
    { name: '@deepseek-ai/dsh', version: '0.1.0', path: 'D:\\C\\dsh', carrier: '@deepseek-ai/*' }
  ]
  assert.equal(filterEntries(entries, '').length, 3)
  assert.equal(filterEntries(entries, 'SSH').length, 1)
  assert.equal(filterEntries(entries, 'DEEPSEEK').length, 1)
  assert.equal(filterEntries(entries, 'registry').length, 1)
  assert.equal(filterEntries(entries, 'node_modules').length, 1)
  assert.equal(filterEntries(entries, 'D:\\B').length, 1)
  assert.equal(filterEntries(entries, '不存在的词').length, 0)
})

test('sortEntries：名称排序（A-Z 升序/降序）与修改时间排序（升/降）', () => {
  const entries = [
    { name: 'zebra', mtimeMs: 300 },
    { name: 'alpha', mtimeMs: 100 },
    { name: 'mango', mtimeMs: 200 }
  ]
  assert.deepEqual(sortEntries(entries, 'name', 'asc').map((e) => e.name), ['alpha', 'mango', 'zebra'])
  assert.deepEqual(sortEntries(entries, 'name', 'desc').map((e) => e.name), ['zebra', 'mango', 'alpha'])
  assert.deepEqual(sortEntries(entries, 'mtime', 'desc').map((e) => e.name), ['zebra', 'mango', 'alpha'])
  assert.deepEqual(sortEntries(entries, 'mtime', 'asc').map((e) => e.name), ['alpha', 'mango', 'zebra'])
  // 缺少 mtimeMs 视为 0（旧数据/失败 stat 稳定排序）
  const noMtime = [{ name: 'b', mtimeMs: 50 }, { name: 'a' }, { name: 'c', mtimeMs: 10 }]
  assert.deepEqual(sortEntries(noMtime, 'mtime', 'asc').map((e) => e.name), ['a', 'c', 'b'])
})

test('applySearchSort：搜索激活 → mtime 降序；退出搜索 → 恢复搜索前最后手动排序', () => {
  const manual = { field: 'name', order: 'asc' }
  assert.deepEqual(applySearchSort(manual, 'ssh'), { field: 'mtime', order: 'desc' })
  assert.deepEqual(applySearchSort(manual, '  '), { field: 'name', order: 'asc' })
  // 用户在搜索前手动改为 mtime 升序：退出搜索后恢复该状态
  const manualMtime = { field: 'mtime', order: 'asc' }
  assert.deepEqual(applySearchSort(manualMtime, 'x'), { field: 'mtime', order: 'desc' })
  assert.deepEqual(applySearchSort(manualMtime, ''), { field: 'mtime', order: 'asc' })
})

test('resolveInitialSort：首次打开（无记忆）→ 名称升序 A-Z；有记忆 → 按记忆', () => {
  assert.deepEqual(resolveInitialSort(null), { field: 'name', order: 'asc' })
  assert.deepEqual(resolveInitialSort(undefined), { field: 'name', order: 'asc' })
  assert.deepEqual(resolveInitialSort({ field: 'mtime', order: 'desc' }), { field: 'mtime', order: 'desc' })
  assert.deepEqual(resolveInitialSort({ field: 'bogus', order: 'up' }), { field: 'name', order: 'asc' })
})

// ——— 无前缀分组扩展：同名重复按名称分组，唯一条目进「未分类」———

function groupEntries(entries) {
  const nameCount = new Map()
  for (const e of entries) {
    if (parseScopePrefix(e.name) === null) {
      nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1)
    }
  }
  const groups = []
  const index = new Map()
  for (const entry of entries) {
    const scope = parseScopePrefix(entry.name)
    let key
    let label
    if (scope !== null) { key = 'scope:' + scope; label = scope }
    else if ((nameCount.get(entry.name) ?? 0) > 1) { key = 'name:' + entry.name; label = entry.name }
    else { key = 'unclassified'; label = '未分类' }
    let group = index.get(key)
    if (group === undefined) {
      group = { key, label, entries: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.entries.push(entry)
  }
  return groups
}

function initialCollapsedGroupKeys(entries) {
  const out = new Set()
  const walk = (groups) => {
    for (const g of groups) {
      out.add(g.key)
      if (Array.isArray(g.children) && g.children.length > 0) walk(g.children)
    }
  }
  walk(buildGroupTree(entries))
  return out
}

test('groupEntries：同名重复无前缀条目按名称分组，唯一无前缀条目归入未分类', () => {
  const entries = [
    { name: '@linxin666/dsh-ssh' },
    { name: 'accepts' },
    { name: 'accepts' },
    { name: 'plain-the-only' },
    { name: 'minimatch' },
    { name: 'minimatch' },
    { name: '@deepseek-ai/dsh' }
  ]
  const groups = groupEntries(entries)
  const keys = groups.map((g) => `${g.key}(${g.entries.length})`)
  // 组按条目首次出现顺序：scope 组、name 重复组（accepts/minimatch）、未分类组（plain-the-only 唯一）
  assert.deepEqual(keys, ['scope:@linxin666/(1)', 'name:accepts(2)', 'unclassified(1)', 'name:minimatch(2)', 'scope:@deepseek-ai/(1)'])
  const unclassified = groups.find((g) => g.key === 'unclassified')
  assert.equal(unclassified.label, '未分类')
  assert.equal(unclassified.entries[0].name, 'plain-the-only')
  // 未分类组不存在时（全部无前缀条目均重复）不生成
  assert.equal(groupEntries([{ name: 'a' }, { name: 'a' }]).some((g) => g.key === 'unclassified'), false)
})

test('initialCollapsedGroupKeys：所有分组（含未分类与同名重复组）默认收起', () => {
  const entries = [
    { name: '@linxin666/dsh-ssh' },
    { name: 'accepts' },
    { name: 'accepts' },
    { name: 'solo' }
  ]
  const keys = initialCollapsedGroupKeys(entries)
  assert.equal(keys.size, 3)
  assert.ok(keys.has('scope:@linxin666/'))
  assert.ok(keys.has('name:accepts'))
  assert.ok(keys.has('unclassified'))
})

// ——— 段前缀分层折叠：es-errors / es-object-atoms 共享 es 前缀 → es-> 父组 ———

function isSearchActive(query) {
  return typeof query === 'string' && query.trim() !== ''
}

// 树形分组：scope 组（平面）→ 段前缀树（无前缀重复名）→ 未分类组（无前缀唯一条目）
function buildGroupTree(entries) {
  const nameCount = new Map()
  for (const e of entries) {
    if (parseScopePrefix(e.name) === null) {
      nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1)
    }
  }
  const scopeMap = new Map()
  const scopeOrder = []
  const nameMap = new Map()
  const solo = []
  for (const entry of entries) {
    // 分组归属：name 的 @scope/ 前缀优先；否则看 carrier（若为 @xxx/* 载体声明，无前缀包归入该 scope 组）
    const scope = parseScopePrefix(entry.name) ?? parseScopePrefix(entry.carrier)
    if (scope !== null) {
      if (!scopeMap.has(scope)) {
        const g = { key: 'scope:' + scope, label: scope, entries: [], children: [], total: 0 }
        scopeMap.set(scope, g)
        scopeOrder.push(g)
      }
      scopeMap.get(scope).entries.push(entry)
    } else if ((nameCount.get(entry.name) ?? 0) > 1) {
      if (!nameMap.has(entry.name)) nameMap.set(entry.name, [])
      nameMap.get(entry.name).push(entry)
    } else {
      solo.push(entry)
    }
  }
  const groups = [...scopeOrder]
  groups.push(...buildNameTree(nameMap))
  if (solo.length > 0) groups.push({ key: 'unclassified', label: '未分类', entries: solo, children: [], total: solo.length })
  for (const g of scopeOrder) g.total = g.entries.length
  return groups
}

// 段前缀树：无前缀重复名按 '-' 分段构建 trie，共享前缀形成父组；单支穿透不建冗余中间层
function buildNameTree(nameMap) {
  const items = []
  for (const [full, entries] of nameMap) {
    items.push({ full, segs: full.split('-'), entries })
  }
  const descend = (list, prefixSegs) => {
    if (list.length === 0) return []
    const first = list[0]
    if (list.every((it) => it.full === first.full)) {
      return [{ key: 'name:' + first.full, label: first.full, entries: first.entries, children: [], total: first.entries.length }]
    }
    const depth = prefixSegs.length
    const segGroups = new Map()
    const here = []
    for (const it of list) {
      const seg = it.segs[depth]
      if (seg === undefined) { here.push(...it.entries); continue }
      if (!segGroups.has(seg)) segGroups.set(seg, [])
      segGroups.get(seg).push(it)
    }
    if (segGroups.size === 0) {
      return [{ key: 'name:' + first.full, label: first.full, entries: here, children: [], total: here.length }]
    }
    if (segGroups.size === 1 && here.length === 0) {
      const [[seg, sub]] = segGroups
      return descend(sub, [...prefixSegs, seg])
    }
    const isRoot = prefixSegs.length === 0
    const children = []
    for (const [seg, sub] of segGroups) {
      children.push(...descend(sub, [...prefixSegs, seg]))
    }
    if (isRoot) return children
    const label = prefixSegs.join('-')
    const total = here.length + children.reduce((s, c) => s + c.total, 0)
    return [{ key: 'name:' + label, label, entries: here, children, total }]
  }
  return descend(items, [])
}

test('buildGroupTree：共享段前缀嵌套折叠（es -> es-errors / es-object-atoms）', () => {
  const entries = [
    { name: 'es-errors' }, { name: 'es-errors' }, { name: 'es-errors' },
    { name: 'es-object-atoms' }, { name: 'es-object-atoms' }, { name: 'es-object-atoms' },
    { name: 'accepts' }, { name: 'accepts' }, { name: 'accepts' },
    { name: 'solo' }
  ]
  const groups = buildGroupTree(entries)
  const es = groups.find((g) => g.key === 'name:es')
  assert.ok(es, 'es 父组应存在')
  assert.equal(es.label, 'es')
  assert.deepEqual(es.children.map((c) => c.label), ['es-errors', 'es-object-atoms'])
  assert.equal(es.children[0].entries.length, 3)
  assert.equal(es.children[1].entries.length, 3)
  assert.equal(es.total, 6, '父组计数=子树条目总和')
  // 单段重复保持叶组（accepts 无子层）
  const accepts = groups.find((g) => g.key === 'name:accepts')
  assert.ok(accepts)
  assert.equal(accepts.children.length, 0)
  assert.equal(accepts.entries.length, 3)
  // 未分类组仍存在（solo 唯一无前缀）
  assert.ok(groups.some((g) => g.key === 'unclassified'))
})

test('buildGroupTree：单支前缀不产生冗余中间层（agent-base 保持叶组）', () => {
  const entries = [{ name: 'agent-base' }, { name: 'agent-base' }]
  const groups = buildGroupTree(entries)
  assert.deepEqual(groups.map((g) => g.key), ['name:agent-base'])
  assert.equal(groups[0].children.length, 0)
  assert.equal(groups[0].total, 2)
})

test('buildGroupTree：scope 组保持平面、未分类在无唯一条目时不生成', () => {
  const entries = [
    { name: '@linxin666/a' }, { name: '@linxin666/b' },
    { name: 'es-errors' }, { name: 'es-errors' }
  ]
  const groups = buildGroupTree(entries)
  const scope = groups.find((g) => g.key === 'scope:@linxin666/')
  assert.ok(scope)
  assert.equal(scope.children.length, 0)
  assert.equal(scope.entries.length, 2)
  assert.equal(groups.some((g) => g.key === 'unclassified'), false)
})

test('buildGroupTree：有 scope 子组时同前缀折叠互不影响', () => {
  const entries = [
    { name: 'es-errors' }, { name: 'es-errors' },
    { name: 'es-define-property' }, { name: 'es-define-property' }
  ]
  const groups = buildGroupTree(entries)
  const es = groups.find((g) => g.key === 'name:es')
  assert.ok(es)
  assert.deepEqual(es.children.map((c) => c.key), ['name:es-errors', 'name:es-define-property'])
})

// ——— 搜索激活：平铺展示单个插件（不分组不折叠）———

test('isSearchActive：空白/空串视为未激活，输入即激活', () => {
  assert.equal(isSearchActive(''), false)
  assert.equal(isSearchActive('   '), false)
  assert.equal(isSearchActive('es'), true)
  assert.equal(isSearchActive(' @a_dove/ '), true)
})

// ——— 载体归属归类：无 @scope/ 前缀但 carrier 属 scope 载体（如 @a_dove/*）→ 归入该 scope 组 ———

test('buildGroupTree：无前缀但 carrier 属 scope 载体 → 归入该 scope 组', () => {
  const entries = [
    { name: '@a_dove/dsh-plugin-registry', carrier: '@a_dove/*' },
    { name: 'dsh-chat-window-fold', carrier: '@a_dove/*' },
    { name: 'solo-other', carrier: 'node_modules' }
  ]
  const groups = buildGroupTree(entries)
  const dove = groups.find((g) => g.key === 'scope:@a_dove/')
  assert.ok(dove, '@a_dove/ 组应存在')
  const names = dove.entries.map((e) => e.name).sort()
  assert.deepEqual(names, ['@a_dove/dsh-plugin-registry', 'dsh-chat-window-fold'])
  // 不产生 name 组（count=1）也不进未分类
  assert.equal(groups.some((g) => g.key === 'name:dsh-chat-window-fold'), false)
  const un = groups.find((g) => g.key === 'unclassified')
  assert.ok(un, '未分类组仍存在')
  assert.deepEqual(un.entries.map((e) => e.name), ['solo-other'])
})

// ——— 展示白名单：格式化 allowlist 文件内容 ———

function formatAllowlistText(list) {
  const entries = Array.isArray(list?.entries) ? list.entries : []
  if (entries.length === 0) return '（白名单为空）'
  return entries.map((e) => {
    const tail = [e.reason ? `（${e.reason}）` : '', e.added_at ? ` · ${e.added_at}` : ''].filter(Boolean).join('')
    return `- ${e.path}${tail}`
  }).join('\n')
}

test('formatAllowlistText：格式化为可读白名单文件内容', () => {
  const list = {
    entries: [
      { path: 'D:\\A\\x', reason: 'UI manual allow', added_at: '2026-08-16T06:08:47.200Z' },
      { path: 'D:\\B\\y', reason: '', added_at: '' },
      { path: 'D:\\C\\z' }
    ]
  }
  const lines = formatAllowlistText(list).split('\n')
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '- D:\\A\\x（UI manual allow） · 2026-08-16T06:08:47.200Z')
  assert.equal(lines[1], '- D:\\B\\y')
  assert.equal(lines[2], '- D:\\C\\z')
  // 空列表提示
  assert.equal(formatAllowlistText({ entries: [] }), '（白名单为空）')
  assert.equal(formatAllowlistText(null), '（白名单为空）')
  assert.equal(formatAllowlistText({}), '（白名单为空）')
})

// ——— 全屏面板互斥契约（源码级回归） ———
// dsh-ssh / dsh-client-ui-task-board 使用 html[data-dsh-*-active] 属性 + CSS
// display:none!important 隐藏主区；本插件必须加入同一互斥协议：
//  (1) 打开时清空 ssh/taskboard 激活属性（closeForeignPanels + OTHER_ACTIVE_ATTRS）
//  (2) CSS 显示条件同时排除 ssh 与 taskboard（:not 链）
//  (3) 对方激活时自身让位（属性 MutationObserver 兜底 + dsh-panel-activate 事件）
test('面板互斥：与 dsh-ssh / task-board 的激活协议完整互斥', () => {
  const src = require('node:fs').readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  // 1) 打开时移除对方激活属性
  assert.match(src, /data-dsh-taskboard-active.*data-dsh-ssh-active/s, 'OTHER_ACTIVE_ATTRS 应同时含 taskboard 与 ssh')
  assert.match(src, /closeForeignPanels\(\)/, '打开时应先调用 closeForeignPanels 关闭对方面板')
  // 2) CSS 互斥：registry 面板显示/隐藏条件均排除 ssh 激活
  assert.ok(src.includes(':not([data-dsh-taskboard-active]):not([data-dsh-ssh-active])'), 'CSS 应链式排除 taskboard 与 ssh 激活')
  // 3) 对方激活 → 自身让位
  assert.match(src, /foreignAttrObserver/, '应存在对方激活属性的 MutationObserver 兜底')
  assert.match(src, /event\.detail === ['"]taskboard['"] \|\| event\.detail === ['"]ssh['"]/, 'activate 事件应同时响应 taskboard 与 ssh')
})