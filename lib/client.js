'use strict'
// @a_dove/dsh-plugin-registry — Client 侧 GUI（CJS bundle，无 JSX/import）
//   apply(ctx) + inject；sidebar entry 经 DOM 挂载（sidebarRoot/placeEntry）；
//   面板经 conversation 列容器 + <html data-*> 激活属性切换；跨插件 dsh-panel-activate 互斥。
// API: /api/dsh-plugin-registry/{list,check,report,allowlist,allowlist/delete}

window.__ModuleLoader__.load({
	id: "@a_dove/dsh-plugin-registry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");
		var reactDomClient = require("react-dom/client");

const NS = 'dsh-plugin-registry'
const inject = ['locale']

const ACTIVE_ATTR = 'data-dsh-registry-active'
/** 全屏面板互斥协议：打开本面板时清空它们的 html 激活属性。 */
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'dsh-plugin-registry'
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"]'

const CSS_TAG = '@a_dove/dsh-plugin-registry/panel.css'
// ——— UI 增强纯逻辑 ———
const SEARCH_SORT_FIELD = 'mtime'
const SEARCH_SORT_ORDER = 'desc'
const DEFAULT_SORT = { field: 'name', order: 'asc' }
const SORT_STORAGE_KEY = 'dsh-plugin-registry.sort'
const SORT_LABELS = {
  'name:asc': '名称 ↑ (A-Z)',
  'name:desc': '名称 ↓ (Z-A)',
  'mtime:asc': '修改时间 ↑ (旧→新)',
  'mtime:desc': '修改时间 ↓ (新→旧)'
}

// 同前缀折叠：解析名称/版本栏中的 @scope/ 前缀，无前缀返回 null
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

// 分组扩展：@scope/ 前缀组 + 无前缀同名重复按名称组 + 无前缀唯一条目进「未分类」组（全部无前缀唯一条目，不论名称是否有连字符）
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

// 所有分组默认收起（含树形子组）。搜索激活时不分组（平铺展示条目），此函数仅用于非搜索视图。
function initialCollapsedGroupKeys(entries) {
  const out = new Set()
  collectGroupKeys(buildGroupTree(entries), out)
  return out
}
function collectGroupKeys(groups, out) {
  for (const g of groups) {
    out.add(g.key)
    if (Array.isArray(g.children) && g.children.length > 0) collectGroupKeys(g.children, out)
  }
}

// 搜索激活判定：空白/空串视为未激活（未激活时才展示分组折叠树）
function isSearchActive(query) {
  return typeof query === 'string' && query.trim() !== ''
}

// 树形分组：
// 1. @scope/ 前缀组（平面，key='scope:<prefix>'）
// 2. 无前缀重复名按 '-' 段构建前缀树（es-errors/es-object-atoms → es-> 父组，单支穿透不建冗余中间层）
// 3. 无前缀唯一条目 → 「未分类」组
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
    // 分组归属：name 的 @scope/ 前缀优先；否则看 carrier（若为 @xxx/* 载体声明，无前缀包归入该 scope 组，如 @a_dove/* 下的 dsh-chat-window-fold）
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

// localStorage 持久化读写（浏览器环境安全降级）
function readStoredSort() {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage !== 'object') return null
    const raw = window.localStorage.getItem(SORT_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw)
    return (parsed !== null && typeof parsed === 'object' && (parsed.field === 'name' || parsed.field === 'mtime')) ? parsed : null
  } catch { return null }
}
function writeStoredSort(sort) {
  try {
    if (typeof window === 'undefined' || typeof window.localStorage !== 'object') return
    window.localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ field: sort.field, order: sort.order }))
  } catch { /* localStorage 不可用时静默降级 */ }
}

// 展示白名单：格式化 allowlist 文件内容（与 test\client-logic.test.js 同构）
function formatAllowlistText(list) {
  const entries = Array.isArray(list?.entries) ? list.entries : []
  if (entries.length === 0) return '（白名单为空）'
  return entries.map((e) => {
    const tail = [e.reason ? `（${e.reason}）` : '', e.added_at ? ` · ${e.added_at}` : ''].filter(Boolean).join('')
    return `- ${e.path}${tail}`
  }).join('\n')
}
const css = `
[data-dsh-registry-panel]{z-index:60;background:var(--dsw-alias-bg-base);display:none;position:absolute;inset:0;overflow:auto}
html[data-dsh-registry-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-registry-panel]{display:block}
html[data-dsh-registry-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane=conversation]>:not([data-dsh-registry-panel]),html[data-dsh-registry-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*=centerCol]>:not([data-dsh-registry-panel]){display:none!important}
.dr-entry{width:100%;height:32px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-radius:8px;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex}
.dr-entry:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}
.dr-entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary);font-weight:600}
.dr-entry[data-alert]{color:var(--dsw-alias-state-error-primary)}
.dr-entry[data-alert] .dr-entry-icon{color:var(--dsw-alias-state-error-primary)}
.dr-entryIcon{flex:none;justify-content:center;align-items:center;display:inline-flex}
.dr-entryLabel{text-overflow:ellipsis;overflow:hidden}
[data-dsh-frame][data-sidebar-collapsed] .dr-entry{justify-content:center;width:100%;padding:0}
[data-dsh-frame][data-sidebar-collapsed] .dr-entryLabel{display:none}
.dr-panel{background:var(--dsw-alias-bg-base);min-width:0;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);flex-direction:column;gap:10px;padding:14px 16px 16px;display:flex}
.dr-panelHeader{flex:none;align-items:center;gap:10px;display:flex}
.dr-panelTitle{color:var(--dsw-alias-label-primary);white-space:nowrap;flex:1;margin:0;font-size:16px;font-weight:700}
.dr-toolbar{flex:none;align-items:center;gap:8px;display:flex;flex-wrap:wrap}
.dr-button{background:var(--dsw-alias-button-info-fill);color:#f2f3f5;border:none;border-radius:6px;padding:6px 12px;font-size:13px;cursor:pointer}
.dr-button:hover{background:var(--dsw-alias-button-info-hover)}
.dr-button:disabled{color:#c7cbd1}
.dr-button.dr-secondary{background:var(--dsw-alias-interactive-bg-hover)}
.dr-button[disabled]{opacity:.6;cursor:default}
.dr-search{flex:1;min-width:140px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);padding:5px 10px;font-size:12px}
.dr-search:focus{outline:none;border-color:var(--dsw-alias-border-l2)}
.dr-search::placeholder{color:var(--dsw-alias-label-tertiary)}
.dr-sortWrap{position:relative;display:inline-block}
.dr-sortBtn{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border:none;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;margin-left:6px;white-space:nowrap}
.dr-sortBtn:hover{background:var(--dsw-alias-interactive-bg-active)}
.dr-sortMenu{position:absolute;top:calc(100% + 4px);left:0;z-index:70;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:4px;display:flex;flex-direction:column;min-width:140px;box-shadow:0 4px 16px rgb(0 0 0 / .35)}
.dr-sortItem{background:0 0;border:none;border-radius:6px;color:var(--dsw-alias-label-primary);text-align:left;padding:6px 10px;font-size:12px;cursor:pointer;white-space:nowrap}
.dr-sortItem:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dr-sortItem[data-active]{color:var(--dsw-alias-state-info-primary);font-weight:600}
.dr-groupRow td{background:var(--dsw-alias-bg-layer-2);cursor:pointer;user-select:none;font-weight:600;color:var(--dsw-alias-label-primary)}
.dr-groupRow:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.dr-groupRow[data-depth="1"] td{padding-left:20px!important;font-weight:500}
.dr-groupRow[data-depth="2"] td{padding-left:32px!important;font-weight:500}
.dr-groupRow[data-depth="3"] td{padding-left:44px!important;font-weight:500}
.dr-table tr[data-entry-depth="1"] td:first-child{padding-left:20px}
.dr-table tr[data-entry-depth="2"] td:first-child{padding-left:32px}
.dr-table tr[data-entry-depth="3"] td:first-child{padding-left:44px}
.dr-table tr[data-entry-depth="4"] td:first-child{padding-left:56px}
.dr-groupCaret{display:inline-block;width:14px;color:var(--dsw-alias-label-secondary)}
.dr-summary{flex:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;font-size:12px;display:flex;flex-direction:column;gap:4px}
.dr-summary .dr-count-error{color:var(--dsw-alias-state-error-primary);font-weight:600}
.dr-summaryRow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dr-summaryRow .dr-summaryBtn{margin-left:auto}
.dr-modalMask{position:fixed;inset:0;background:rgb(0 0 0 / .55);z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px}
.dr-modal{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;min-width:420px;max-width:760px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgb(0 0 0 / .35)}
.dr-modalHead{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dr-modalHead span{flex:1;font-weight:600;font-size:13px}
.dr-modalBody{margin:0;padding:12px 14px;overflow:auto;font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary)}
.dr-tableWrap{flex:1;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.dr-table{width:100%;border-collapse:collapse;font-size:12px}
.dr-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);text-align:left;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-weight:600;white-space:nowrap}
.dr-table td{padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}
.dr-table tr.dr-row-alert td{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}
.dr-table tr.dr-row-alert td:first-child{box-shadow:inset 3px 0 0 var(--dsw-alias-state-error-primary)}
.dr-name{word-break:break-all;white-space:normal;line-height:1.45;min-width:0}
.dr-path{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}
.dr-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;border:1px solid var(--dsw-alias-border-l2)}
.dr-badge.dr-badge-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dr-badge.dr-badge-warn{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dr-badge.dr-badge-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dr-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:13px}
.dr-ask{flex:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-state-warn-primary);border-radius:8px;padding:10px 12px;font-size:12px;display:flex;flex-direction:column;gap:8px}
.dr-askRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dr-askPath{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;flex:1}
`

function ensureStyle() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-plugin-css="' + CSS_TAG + '"]') !== null) return
  const style = document.createElement('style')
  style.dataset.pluginCss = CSS_TAG
  style.textContent = css
  document.head.appendChild(style)
}

// ——— API 客户端 ———
class RegistryApi {
  constructor() {
    this.base = '/api/dsh-plugin-registry'
  }
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

// ——— 面板控制器 ———
class PanelController {
  constructor() {
    this.panelOpen = false
    this.listeners = new Set()
  }
  getSnapshot() { return { panelOpen: this.panelOpen } }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  open() { this.panelOpen = true; this.emit() }
  close() { this.panelOpen = false; this.emit() }
  toggle() { this.panelOpen = !this.panelOpen; this.emit() }
  emit() { for (const fn of [...this.listeners]) fn() }
}

// ——— 工具 ———
function entryIconMarkup() {
  return '<span class="dr-entryIcon"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3.5h10v9H3z"/><path d="M6 7h4"/><path d="M6 9.5h2.5"/></svg></span>'
}

function createEntry(controller) {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshRegistryEntry = ''
  entry.className = 'dr-entry'
  entry.setAttribute('aria-label', '插件路径管理')
  entry.setAttribute('title', '插件路径管理（DSH 插件注册表）')
  entry.innerHTML = entryIconMarkup() + '<span class="dr-entryLabel">插件路径管理</span>'
  entry.addEventListener('click', () => controller.toggle())
  return entry
}

function setEntryAlert(entry, alert) {
  if (alert) entry.dataset.alert = 'true'
  else delete entry.dataset.alert
}

// ——— 挂载：侧边栏入口 ———
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  return column.querySelector('[class*="logoRow"]')?.parentElement ?? column.firstElementChild
}

function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) if (child.tagName === 'BUTTON') return child
}

function placeEntry(root, entry) {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = row !== null && row.parentElement === root ? row : button
    const family = Array.from(root.children).filter((el) => el instanceof HTMLElement && el.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-registry-entry]'))
    const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
    root.insertBefore(entry, anchor)
  }
  return true
}

function mountSidebarEntry(controller, alertSink) {
  const entry = createEntry(controller)
  let root
  let placed = false
  let lastAlert = false
  // 联动契约：扫描异常且面板未打开 → 入口标红；进入面板 → 恢复；关闭面板 → 恢复上次异常态
  const syncAlert = () => {
    const open = controller.getSnapshot().panelOpen
    setEntryAlert(entry, lastAlert && !open)
  }
  const setAlert = (alert) => {
    lastAlert = Boolean(alert)
    syncAlert()
  }
  const tryPlace = () => {
    if (root !== undefined && !root.isConnected) { rootObserver.disconnect(); root = undefined; placed = false }
    if (placed) { if (document.body.contains(entry)) return; rootObserver.disconnect(); root = undefined; placed = false }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) rootObserver.observe(root, { childList: true, subtree: true })
  }
  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })
  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) { placed = false; tryPlace(); return }
    if (!root.contains(entry)) placed = placeEntry(root, entry)
  })
  const syncActive = () => {
    if (controller.getSnapshot().panelOpen) entry.dataset.active = 'true'
    else delete entry.dataset.active
    syncAlert()
  }
  const unsubscribe = controller.subscribe(syncActive)
  syncActive()
  tryPlace()
  if (typeof alertSink === 'function') alertSink(setAlert)
  const dispose = () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribe()
    entry.remove()
  }
  return { entry, setAlert, dispose }
}

// ——— 面板 React 树 ———
function Panel({ controller, api, bridge }) {
  const [state, setState] = react.useState({ loading: true, entries: [], issues: [], report: null, scanning: false, allowlist: [], lastCheck: null })
  const [searchQuery, setSearchQuery] = react.useState('')
  const [manualSort, setManualSort] = react.useState(() => resolveInitialSort(readStoredSort()))
  const [collapsedGroups, setCollapsedGroups] = react.useState(() => new Set())
  const [sortMenuOpen, setSortMenuOpen] = react.useState(false)
  const [allowlistView, setAllowlistView] = react.useState(null) // { text, entries } | null（关闭）
  // 判定是否已处置：报告固化 suppressed 标注，或路径已动态加入白名单（allowlist 即时生效，无需重新扫描）
  const isSuppressed = (issue, allowSet) => issue.suppressed === true || allowSet.has(issue.path)
  const pushAlert = (issues, allowlist) => {
    if (bridge === undefined || bridge.setAlert === undefined) return
    const allowSet = new Set(allowlist)
    bridge.setAlert(issues.some((i) => !isSuppressed(i, allowSet)))
  }
  const refresh = async (silent) => {
    if (!silent) setState((s) => ({ ...s, loading: true }))
    try {
      const [listResult, reportResult, allowResult] = await Promise.all([api.list(), api.report(), api.allowlist()])
      const entries = Array.isArray(listResult.entries) ? listResult.entries : []
      const issues = (reportResult.report && Array.isArray(reportResult.report.issues)) ? reportResult.report.issues : []
      const allowlist = Array.isArray(allowResult.entries) ? allowResult.entries.map((e) => e.path) : []
      setState((s) => ({ ...s, loading: false, entries, issues, report: reportResult.report ?? null, allowlist }))
      // 折叠状态始终默认：每次数据到达时重置为全部收起（不记忆用户上次展开/折叠）
      setCollapsedGroups(initialCollapsedGroupKeys(entries))
      pushAlert(issues, allowlist)
    } catch (error) {
      setState((s) => ({ ...s, loading: false }))
      console.warn('[dsh-plugin-registry] refresh failed:', error)
    }
  }
  react.useEffect(() => { refresh(true) }, [])

  const runCheck = async (mode) => {
    setState((s) => ({ ...s, scanning: true }))
    try {
      const result = await api.check(mode)
      await refresh(false)
      const reportResult = await api.report()
      const issues = (reportResult.report && Array.isArray(reportResult.report.issues)) ? reportResult.report.issues : []
      setState((s) => ({ ...s, scanning: false, lastCheck: result, issues }))
      pushAlert(issues, state.allowlist)
    } catch (error) {
      setState((s) => ({ ...s, scanning: false }))
      console.warn('[dsh-plugin-registry] check failed:', error)
    }
  }

  const addAllow = async (path) => {
    try {
      await api.allowlistAdd(path, 'UI manual allow')
      setState((s) => ({ ...s, allowlist: [...s.allowlist, path] }))
      refresh(false)
    } catch (error) { console.warn('[dsh-plugin-registry] allowlist add failed:', error) }
  }

  const changeSort = (field, order) => {
    const next = { field, order }
    setManualSort(next)
    writeStoredSort(next)
    setSortMenuOpen(false)
  }

  const openAllowlist = async () => {
    try {
      const result = await api.allowlist()
      setAllowlistView({ text: formatAllowlistText(result), entries: Array.isArray(result.entries) ? result.entries : [] })
    } catch (error) {
      console.warn('[dsh-plugin-registry] allowlist view failed:', error)
      setAllowlistView({ text: '（读取白名单失败）', entries: [] })
    }
  }

  // 异常/提示判定：报告 suppressed 标注 + 白名单路径动态合并（加入白名单即时生效）
  const allowSet = new Set(state.allowlist)
  const activeIssues = state.issues.filter((i) => !isSuppressed(i, allowSet))
  const suppressedCount = state.issues.length - activeIssues.length
  const problemPaths = new Set(activeIssues.map((i) => i.path))
  // 搜索/排序/折叠正交流水线：过滤 → 应用排序（搜索激活时默认 mtime 降序）→ 异常置顶 → 前缀分组
  const filtered = filterEntries(state.entries, searchQuery)
  const effectiveSort = applySearchSort(manualSort, searchQuery)
  const sorted = sortEntries(filtered, effectiveSort.field, effectiveSort.order).sort((a, b) => {
    const aBad = problemPaths.has(a.path) ? 1 : 0
    const bBad = problemPaths.has(b.path) ? 1 : 0
    return bBad - aBad
  })
  // 搜索激活 → 平铺展示单个插件（不分组不折叠）；否则展示树形折叠分组
  const searchActive = isSearchActive(searchQuery)
  const groups = searchActive ? [] : buildGroupTree(sorted)
  const cDriveIssues = activeIssues.filter((i) => i.type === 'c-drive')
  const hasAlert = activeIssues.length > 0
  const sortKey = `${effectiveSort.field}:${effectiveSort.order}`

  const h = react.createElement
  const toggleGroup = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const renderEntries = (entryList, depth) => entryList.map((entry) => {
    const bad = problemPaths.has(entry.path)
    const status = bad ? '异常' : (entry.cDriveRefs > 0 ? 'C盘引用' : '正常')
    const attrs = { key: entry.id, className: bad ? 'dr-row-alert' : '', 'data-alert': bad ? 'true' : undefined }
    // 组内条目按组深度+1 缩进；搜索平铺（无 depth）不缩进
    if (typeof depth === 'number' && depth > 0) attrs['data-entry-depth'] = depth
    return h('tr', attrs,
      h('td', null, h('div', { className: 'dr-name' }, entry.name || '—'), h('div', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' } }, entry.version || '—')),
      h('td', null, entry.type === 'plugin' ? '插件' : entry.type === 'preset' ? '预设' : '技能'),
      h('td', null, entry.carrier || '—'),
      h('td', { className: 'dr-path' }, entry.path),
      h('td', null, h('span', { className: bad ? 'dr-badge dr-badge-error' : (entry.cDriveRefs > 0 ? 'dr-badge dr-badge-warn' : 'dr-badge dr-badge-ok') }, status))
    )
  })
  const renderGroup = (group, depth) => {
    const rows = []
    const d = depth ?? 0
    const collapsed = collapsedGroups.has(group.key)
    const hasChildren = Array.isArray(group.children) && group.children.length > 0
    if (group.key === 'unclassified' && group.entries.length === 0 && !hasChildren) return rows
    rows.push(h('tr', { key: 'group:' + group.key, className: 'dr-groupRow', 'data-depth': d, onClick: () => toggleGroup(group.key) },
      h('td', { colSpan: 5 },
        h('span', { className: 'dr-groupCaret' }, collapsed ? '▸' : '▾'),
        h('span', null, group.label),
        h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginLeft: '6px' } },
          `${group.total ?? group.entries.length} 项${hasChildren ? '（含子组）' : ''}`)
      )
    ))
    if (!collapsed) {
      if (hasChildren) rows.push(...group.children.flatMap((c) => renderGroup(c, d + 1)))
      rows.push(...renderEntries(group.entries, d + 1))
    }
    return rows
  }

  return h('div', { className: 'dr-panel', 'data-dsh-registry-panel': '' },
    h('div', { className: 'dr-panelHeader' },
      h('h2', { className: 'dr-panelTitle' }, '插件路径管理'),
      hasAlert ? h('span', { className: 'dr-badge dr-badge-error' }, '⚠ 存在异常') : h('span', { className: 'dr-badge dr-badge-ok' }, '正常')
    ),
    h('div', { className: 'dr-toolbar' },
      h('input', { className: 'dr-search', type: 'search', placeholder: '搜索插件（名称/版本/路径/载体）…', value: searchQuery, onChange: (e) => setSearchQuery(e.target.value) }),
      h('button', { className: 'dr-button', disabled: state.scanning, onClick: () => runCheck('quick') }, state.scanning ? '检查中…' : '执行检查（快速）'),
      h('button', { className: 'dr-button dr-secondary', disabled: state.scanning, onClick: () => runCheck('all') }, '深度检查'),
      state.lastCheck ? h('span', { style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
        `上次: ${state.lastCheck.mode} ${state.lastCheck.entry_stats?.total ?? 0} 条 / 问题 ${state.lastCheck.issues_count ?? 0}`) : null
    ),
    state.report ? h('div', { className: 'dr-summary' },
      h('div', { className: 'dr-summaryRow' },
        h('span', null, `最近报告 ${state.report.generated_at ? state.report.generated_at.replace('T', ' ').slice(0, 19) : ''} [${state.report.mode || ''}] · 共 ${state.report.entry_stats?.total ?? 0} 条`),
        h('span', null, `问题 ${activeIssues.length} 处${suppressedCount > 0 ? `（${suppressedCount} 处已白名单处置）` : ''}`),
        cDriveIssues.length > 0 ? h('span', { className: 'dr-count-error' }, `C 盘残留引用: ${cDriveIssues.length} 个条目`) : null,
        h('button', { className: 'dr-button dr-secondary dr-summaryBtn', onClick: openAllowlist }, '展示白名单')
      )
    ) : null,
    cDriveIssues.length > 0 ? h('div', { className: 'dr-ask' },
      h('div', { className: 'dr-askRow' },
        h('span', { style: { fontWeight: 600 } }, '检测到疑似内置 C 盘引用，是否加入白名单？'),
        h('button', { className: 'dr-button', onClick: () => cDriveIssues.forEach((i) => addAllow(i.path)) }, '全部加入白名单')
      ),
      cDriveIssues.slice(0, 5).map((issue) =>
        h('div', { className: 'dr-askRow', key: issue.path },
          h('span', { className: 'dr-askPath' }, issue.path),
          h('button', { className: 'dr-button dr-secondary', onClick: () => addAllow(issue.path) }, '加入')
        )
      )
    ) : null,
    state.loading ? h('div', { className: 'dr-empty' }, '加载中…') :
      h('div', { className: 'dr-tableWrap' },
        h('table', { className: 'dr-table' },
          h('thead', null,
            h('tr', null,
              h('th', null,
                '名称/版本',
                h('span', { className: 'dr-sortWrap' },
                  h('button', { className: 'dr-sortBtn', onClick: () => setSortMenuOpen((v) => !v), title: '选择排序方式' }, `排序 ${SORT_LABELS[sortKey] || sortKey}`),
                  sortMenuOpen ? h('span', { className: 'dr-sortMenu' },
                    h('button', { className: 'dr-sortItem', 'data-active': effectiveSort.field === 'name' && effectiveSort.order === 'asc' ? 'true' : undefined, onClick: () => changeSort('name', 'asc') }, '名称 ↑ (A-Z)'),
                    h('button', { className: 'dr-sortItem', 'data-active': effectiveSort.field === 'name' && effectiveSort.order === 'desc' ? 'true' : undefined, onClick: () => changeSort('name', 'desc') }, '名称 ↓ (Z-A)'),
                    h('button', { className: 'dr-sortItem', 'data-active': effectiveSort.field === 'mtime' && effectiveSort.order === 'asc' ? 'true' : undefined, onClick: () => changeSort('mtime', 'asc') }, '修改时间 ↑ (旧→新)'),
                    h('button', { className: 'dr-sortItem', 'data-active': effectiveSort.field === 'mtime' && effectiveSort.order === 'desc' ? 'true' : undefined, onClick: () => changeSort('mtime', 'desc') }, '修改时间 ↓ (新→旧)')
                  ) : null
                )
              ),
              h('th', null, '类型'),
              h('th', null, '载体'),
              h('th', null, '路径'),
              h('th', null, '状态')
            )
          ),
          h('tbody', null,
            sorted.length === 0 ? h('tr', null, h('td', { colSpan: 5, className: 'dr-empty' }, searchActive ? '没有匹配的插件' : '暂无记录，请先执行检查')) :
              (searchActive ? renderEntries(sorted) : groups.flatMap((g) => renderGroup(g, 0)))
          )
        )
      ),
    allowlistView !== null ? h('div', { className: 'dr-modalMask', onClick: () => setAllowlistView(null) },
      h('div', { className: 'dr-modal', onClick: (e) => e.stopPropagation() },
        h('div', { className: 'dr-modalHead' },
          h('span', null, `白名单文件（allowlist.json · ${allowlistView.entries.length} 条）`),
          h('button', { className: 'dr-button dr-secondary', onClick: () => setAllowlistView(null) }, '关闭')
        ),
        h('pre', { className: 'dr-modalBody' }, allowlistView.text)
      )
    ) : null
  )
}

// ——— 挂载：面板 ———
function mountPanel(controller, api, bridge) {
  ensureStyle()
  let root
  let container
  const ensure = () => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = document.querySelector(CONVERSATION_COLUMN_SELECTOR)
    if (!column) return
    container = document.createElement('div')
    container.dataset.dshRegistryPanel = ''
    container.className = 'dr-view'
    column.appendChild(container)
    root = reactDomClient.createRoot(container)
    root.render(react.createElement(Panel, { controller, api, bridge }))
  }
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })
  /** 全屏面板互斥（对齐 dsh-ssh / task-board 协议）：对方面板若已激活，先完整关闭——模拟点击其侧栏 entry 触发对方 toggle 闭环（对方按钮高亮同步熄灭、状态无撕裂）；entry 缺失时降级为直接移除激活属性并清对方 entry 高亮。 */
  const closeForeignPanels = () => {
    const OTHERS = [
      ['data-dsh-ssh-active', '[data-dsh-ssh-entry]'],
      ['data-dsh-taskboard-active', '[data-dsh-taskboard-entry]']
    ]
    for (const [attr, entrySelector] of OTHERS) {
      const root = document.documentElement
      if (!root.hasAttribute(attr)) continue
      const entry = document.querySelector(entrySelector)
      if (entry !== null && typeof entry.click === 'function') {
        entry.click()
        continue
      }
      root.removeAttribute(attr)
      const family = document.querySelectorAll('[data-dsh-ssh-entry], [data-dsh-taskboard-entry]')
      for (const el of family) el.removeAttribute('data-active')
    }
  }
  const applyActive = () => {
    if (controller.getSnapshot().panelOpen) {
      closeForeignPanels()
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else document.documentElement.removeAttribute(ACTIVE_ATTR)
  }
  /** 兜底：任何时刻对方面板被激活（html 属性出现）而本面板还开着 → 立即让位，覆盖事件协议之外的路径。 */
  const foreignAttrObserver = new MutationObserver(() => {
    if (!controller.getSnapshot().panelOpen) return
    const root = document.documentElement
    if (root.hasAttribute('data-dsh-ssh-active') || root.hasAttribute('data-dsh-taskboard-active')) controller.close()
  })
  foreignAttrObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-dsh-ssh-active', 'data-dsh-taskboard-active'] })
  const onOtherActivate = (event) => {
    if ((event.detail === 'taskboard' || event.detail === 'ssh') && controller.getSnapshot().panelOpen) controller.close()
  }
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event) => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()
  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    foreignAttrObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}

/** Client 插件入口。 */
function apply(ctx) {
  ensureStyle()
  const controller = new PanelController()
  const api = new RegistryApi()
  let sidebarMount
  const bridge = { setAlert: undefined }
  const disposers = []
  try {
    sidebarMount = mountSidebarEntry(controller, (setAlert) => { bridge.setAlert = setAlert })
    disposers.push(sidebarMount.dispose)
    disposers.push(mountPanel(controller, api, bridge))
  } catch (error) {
    console.warn('[dsh-plugin-registry] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-plugin-registry: ui mounts')
}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
