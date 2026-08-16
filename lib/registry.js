'use strict'
// @a_dove/dsh-plugin-registry — 数据存储：registry.json 缓存、报告保留 10 份、备份仅 1 份
const fs = require('node:fs')
const path = require('node:path')

const MAX_REPORTS = 10
const MAX_BACKUPS = 1

class RegistryStore {
  constructor({ dataDir, dshHome }) {
    this.dataDir = dataDir
    this.dshHome = dshHome || 'D:\\AI\\DSH'
    this.registryPath = path.join(dataDir, 'registry.json')
    this.reportsDir = path.join(dataDir, 'reports')
    this.backupsDir = path.join(dataDir, 'backups')
    fs.mkdirSync(this.reportsDir, { recursive: true })
    fs.mkdirSync(this.backupsDir, { recursive: true })
  }

  // ——— registry.json 存取 ———
  saveRegistry(payload) {
    this.backupRegistry() // 升级/重写前备份旧版
    fs.writeFileSync(this.registryPath, JSON.stringify(payload, null, 2), 'utf8')
    return this.registryPath
  }

  loadRegistry() {
    if (!fs.existsSync(this.registryPath)) return null
    try { return JSON.parse(fs.readFileSync(this.registryPath, 'utf8')) } catch { return null }
  }

  // ——— 备份：仅保留最近 1 份旧版 ———
  backupRegistry() {
    if (!fs.existsSync(this.registryPath)) return []
    return this.backupNow(`registry-${Date.now()}`)
  }

  backupNow(label) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const target = path.join(this.backupsDir, `backup-${stamp}-${label}.json`)
    if (fs.existsSync(this.registryPath)) {
      fs.copyFileSync(this.registryPath, target)
    } else {
      fs.writeFileSync(target, '{}', 'utf8')
    }
    // 只保留 1 份：删除更早备份
    const backups = this.listBackups().sort()
    while (backups.length > MAX_BACKUPS) {
      const oldest = backups.shift()
      try { fs.unlinkSync(path.join(this.backupsDir, oldest)) } catch { /* ignore */ }
    }
    return this.listBackups()
  }

  listBackups() {
    if (!fs.existsSync(this.backupsDir)) return []
    return fs.readdirSync(this.backupsDir).filter((f) => f.endsWith('.json'))
  }

  // ——— 报告：保留最近 10 份 ———
  saveReport(content, filename) {
    fs.writeFileSync(path.join(this.reportsDir, filename + '.json'), JSON.stringify(content, null, 2), 'utf8')
    if (content.markdown) {
      fs.writeFileSync(path.join(this.reportsDir, filename + '.md'), content.markdown, 'utf8')
    }
    this._trimReports()
    return filename
  }

  _trimReports() {
    const files = this.listReports()
    while (files.length > MAX_REPORTS) {
      const oldest = files.shift()
      try {
        fs.unlinkSync(path.join(this.reportsDir, oldest))
        // 删除伴生 md
        const md = oldest.replace(/\.json$/, '.md')
        if (fs.existsSync(path.join(this.reportsDir, md))) fs.unlinkSync(path.join(this.reportsDir, md))
      } catch { /* ignore */ }
    }
  }

  listReports() {
    if (!fs.existsSync(this.reportsDir)) return []
    return fs.readdirSync(this.reportsDir).filter((f) => f.endsWith('.json')).sort()
  }

  latestReport() {
    const files = this.listReports()
    if (!files.length) return null
    const latest = files[files.length - 1]
    try { return JSON.parse(fs.readFileSync(path.join(this.reportsDir, latest), 'utf8')) } catch { return null }
  }
}

module.exports = { RegistryStore, MAX_REPORTS, MAX_BACKUPS }