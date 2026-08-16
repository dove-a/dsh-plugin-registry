'use strict'
// RED-phase tests for @a_dove/dsh-plugin-registry core (node:test)
// Contract: registry-cli 独立模块 + CLI；四种载体；quick/all 双模式；
// 四项检查；报告保留 10 份；升级备份仅保留 1 份。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const libDir = path.join(__dirname, '..', 'lib')
const { scanCarriers } = require(path.join(libDir, 'scanner.js'))
const { runChecks, diffAgainstBaseline } = require(path.join(libDir, 'checker.js'))
const { RegistryStore } = require(path.join(libDir, 'registry.js'))

function makeTree(base, entries) {
  // entries: { rel, kind: 'pkg'|'skill'|'dir'|'text', name?, version?, deps?, cRef? }
  for (const e of entries) {
    const p = path.join(base, e.rel)
    if (e.kind === 'dir') { fs.mkdirSync(p, { recursive: true }); continue }
    if (e.kind === 'pkg') {
      fs.mkdirSync(p, { recursive: true })
      fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name: e.name, version: e.version, dependencies: e.deps || {} }))
      if (e.cRef) { fs.mkdirSync(path.join(p, 'src'), { recursive: true }); fs.writeFileSync(path.join(p, 'src', 'x.js'), `// ref ${e.cRef}`) }
      continue
    }
    if (e.kind === 'skill') {
      fs.mkdirSync(p, { recursive: true })
      fs.writeFileSync(path.join(p, 'SKILL.md'), `---\nname: ${e.name}\ndescription: test skill\n---\n`)
      continue
    }
  }
}

test('scanCarriers: 判定规则——含 package.json 的目录记为插件条目', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  makeTree(base, [
    { rel: 'carrierA/@scope/pkg1', kind: 'pkg', name: '@scope/pkg1', version: '1.0.0' },
    { rel: 'carrierA/loose-dir', kind: 'dir' }
  ])
  const result = scanCarriers({ dshHome: base, mode: 'quick' })
  assert.ok(result.entries.some(e => e.name === '@scope/pkg1' && e.path.endsWith('pkg1')), 'package.json 目录必须被识别为插件条目')
  assert.ok(!result.entries.some(e => e.id === 'loose-dir'), '无 package.json 的裸目录不得记为插件')
  fs.rmSync(base, { recursive: true, force: true })
})

test('scanCarriers: 判定规则——SKILL.md 目录记为 skill 条目', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  makeTree(base, [
    { rel: 'skills-root/some-skill', kind: 'skill', name: 'some-skill' }
  ])
  const result = scanCarriers({ dshHome: base, mode: 'quick' })
  const skill = result.entries.find(e => e.type === 'skill')
  assert.ok(skill && skill.path.endsWith('some-skill'), 'SKILL.md 目录必须记为 skill 条目')
  fs.rmSync(base, { recursive: true, force: true })
})

test('scanCarriers: quick 模式对 CLI 缓存载体只记元数据（不全文扫 C 盘引用）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  makeTree(base, [
    { rel: 'cli-cache/_npx/abc123/node_modules/@fast/pkgA', kind: 'pkg', name: '@fast/pkgA', version: '2.0.0', cRef: 'C:' + '\\Users\\legacy\\x' }
  ])
  const quick = scanCarriers({ dshHome: base, mode: 'quick' })
  const deep = scanCarriers({ dshHome: base, mode: 'all' })
  const qA = quick.entries.find(e => e.name === '@fast/pkgA')
  const dA = deep.entries.find(e => e.name === '@fast/pkgA')
  assert.ok(qA && dA, '两种模式都必须记录缓存载体条目')
  assert.equal(qA.cDriveRefs, 0, 'quick 模式不得全文扫缓存内容')
  assert.ok(dA.cDriveRefs >= 1, 'all 模式必须全文扫出 C 盘引用')
  fs.rmSync(base, { recursive: true, force: true })
})

test('scanCarriers: quick 模式对 @deepseek-ai/* 与 .agent-presets/* 仍做全文 C 盘扫', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  makeTree(base, [
    { rel: 'pkgs/@deepseek-ai/dsh-core', kind: 'pkg', name: '@deepseek-ai/dsh-core', version: '0.1.0', cRef: 'C:' + '\\Users\\legacy\\y' }
  ])
  fs.mkdirSync(path.join(base, 'presets', 'cordis-vibe', 'scripts', 'runtime'), { recursive: true })
  fs.writeFileSync(path.join(base, 'presets', 'cordis-vibe', 'scripts', 'runtime', 'x.ps1'), '# C:' + '\\Users\\legacy\\z')
  const quick = scanCarriers({ dshHome: base, mode: 'quick' })
  const core = quick.entries.find(e => e.name === '@deepseek-ai/dsh-core')
  assert.ok(core.cDriveRefs >= 1, 'quick 下官方包仍须全文扫')
  const presetEntry = quick.entries.find(e => e.type === 'preset' && e.path.includes('cordis-vibe'))
  assert.ok(presetEntry && presetEntry.cDriveRefs >= 1, 'quick 下预设载体仍须全文扫')
  fs.rmSync(base, { recursive: true, force: true })
})

test('runChecks: 元数据完整性（package.json 缺失 / name 缺失 / version 缺失）', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  makeTree(base, [
    { rel: 'pkgs/@deepseek-ai/ok-pkg', kind: 'pkg', name: '@deepseek-ai/ok-pkg', version: '1.0.0' },
    { rel: 'pkgs/@deepseek-ai/no-version', kind: 'pkg', name: '@deepseek-ai/no-version' }
  ])
  fs.mkdirSync(path.join(base, 'pkgs', '@deepseek-ai', 'broken-json'), { recursive: true })
  fs.writeFileSync(path.join(base, 'pkgs', '@deepseek-ai', 'broken-json', 'package.json'), '{ not json')
  const result = runChecks({ dshHome: base, entries: scanCarriers({ dshHome: base, mode: 'quick' }).entries })
  const broken = result.issues.find(i => i.path.includes('broken-json'))
  assert.ok(broken, '损坏 package.json 必须产生元数据问题')
  const noVer = result.issues.find(i => i.path.includes('no-version'))
  assert.ok(noVer, '缺 version 必须产生元数据问题')
  fs.rmSync(base, { recursive: true, force: true })
})

test('scanCarriers: npx 容器清单（_npx.packages 字段）不得记为插件条目，其下真实包必须收集', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  // 真实世界结构：_npx/<hash>/package.json 是 npx 容器清单（无 name/version，带 _npx.packages），
  // 真实包位于 _npx/<hash>/node_modules/<pkg>
  fs.mkdirSync(path.join(base, 'cli-cache', '_npx', 'abc123', 'node_modules', '@fast', 'pkgA'), { recursive: true })
  fs.writeFileSync(path.join(base, 'cli-cache', '_npx', 'abc123', 'package.json'), JSON.stringify({
    dependencies: { '@fast/pkgA': '^2.0.0' },
    _npx: { packages: ['@fast/pkgA'] }
  }))
  fs.writeFileSync(path.join(base, 'cli-cache', '_npx', 'abc123', 'node_modules', '@fast', 'pkgA', 'package.json'), JSON.stringify({ name: '@fast/pkgA', version: '2.0.0' }))
  const result = scanCarriers({ dshHome: base, mode: 'quick' })
  const hashIds = result.entries.filter(e => e.path.includes('abc123')).map(e => e.id)
  assert.ok(!hashIds.some(id => id.endsWith('abc123')), 'npx 容器根（_npx.packages 清单）不得记为插件条目')
  assert.ok(result.entries.some(e => e.name === '@fast/pkgA' && e.path.includes('_npx')), '容器下真实包必须作为插件条目收集')
  fs.rmSync(base, { recursive: true, force: true })
})

test('diffAgainstBaseline: 识别 新增 / 删除 / 版本变化', () => {
  const baseline = {
    entries: [
      { id: 'a', name: 'a', version: '1.0.0' },
      { id: 'b', name: 'b', version: '1.0.0' },
      { id: 'gone', name: 'gone', version: '1.0.0' }
    ]
  }
  const current = [
    { id: 'a', name: 'a', version: '1.0.0' },
    { id: 'b', name: 'b', version: '2.0.0' },
    { id: 'c', name: 'c', version: '1.0.0' }
  ]
  const diff = diffAgainstBaseline(baseline, current)
  assert.equal(diff.added.length, 1)
  assert.equal(diff.added[0].id, 'c')
  assert.equal(diff.removed.length, 1)
  assert.equal(diff.removed[0].id, 'gone') // baseline-only id
  const changed = diff.changed.find(d => d.id === 'b')
  assert.ok(changed && changed.from === '1.0.0' && changed.to === '2.0.0')
})

test('RegistryStore: 报告保留最近 10 份，超限删最旧', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  const store = new RegistryStore({ dataDir: dir })
  for (let i = 1; i <= 13; i++) {
    store.saveReport({ id: `r${i}`, mode: 'quick', issues: [] }, `report-${String(i).padStart(3, '0')}.json`)
  }
  const files = store.listReports()
  assert.equal(files.length, 10, '只保留 10 份')
  assert.ok(!files.some(f => f.includes('report-001')), '最旧 3 份被清除')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('RegistryStore: 升级备份仅保留 1 份，更早备份被清除', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  const store = new RegistryStore({ dataDir: dir })
  store.backupNow('v1')
  store.backupNow('v2')
  store.backupNow('v3')
  const backups = store.listBackups()
  assert.equal(backups.length, 1, '只保留 1 份备份')
  assert.ok(backups[0].includes('v3'), '保留最新备份')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('RegistryStore: registry.json 存取往返（字段契约）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dovetest-'))
  const store = new RegistryStore({ dataDir: dir })
  const payload = {
    schema_version: 1,
    generated_at: '2026-08-16T00:00:00Z',
    mode: 'quick',
    entries: [
      { id: 'x', type: 'plugin', name: 'x', version: '1.0.0', path: 'D:\\x', carrier: 'pkgs', cDriveRefs: 0, status: 'ok' }
    ],
    baseline: { entries: [] }
  }
  store.saveRegistry(payload)
  const loaded = store.loadRegistry()
  assert.equal(loaded.schema_version, 1)
  assert.equal(loaded.entries[0].id, 'x')
  assert.equal(typeof loaded.entries[0].cDriveRefs, 'number')
  assert.equal(loaded.entries[0].carrier, 'pkgs')
  fs.rmSync(dir, { recursive: true, force: true })
})