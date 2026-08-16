# @a_dove/dsh-plugin-registry

[![npm version](https://img.shields.io/npm/v/@a_dove/dsh-plugin-registry)](https://www.npmjs.com/package/@a_dove/dsh-plugin-registry)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

> **语言 / Language：** [中文](README.md) · [English](README.en.md)

DSH（DeepSeek Harness）**插件路径注册表**：一个因为我自己的DSH装在D盘，而被限制诸多从而想出的企划，功能为盘点 DSH 环境中所有已安装插件、预设与技能的真实路径与来源，自动发现新安装、被删除与版本变化，扫描插件文件中的 C 盘残留引用，并检查依赖完整性。提供 **Agent 自动工具**与 **Web GUI 面板**双入口。

---

## 作用

- **全载体盘点**：统一登记 node_modules / profiles / 预设目录 / 技能目录中的插件、预设、技能条目（名称、版本、路径、载体类型），一次看清"谁装在哪"。
- **变化监控（diff）**：以注册表缓存为基线自动对比——新安装 ➕ / 被删除 ➖ / 版本升级 🔄 逐条列出。
- **C 盘残留扫描**：检查插件文件中对 C 盘路径的引用（快速 / 深度两种模式），支持交互式**白名单**压噪（命中 allowlist 的条目标记 suppressed，不消除、仍可见）。
- **依赖完整性**：对包缺失依赖、元数据损坏给出提示。
- **Agent 三件套工具**（会话中直接调用）：
  - `plugin_registry_list` — 读缓存快速列出全部注册记录
  - `plugin_registry_check` — 现场重新扫描 + 四项检查，生成报告（本地保留最近 10 份）
  - `plugin_registry_report` — 读取最近一份检查报告（含 C 盘残留明细）
- **GUI「插件路径管理」面板**：侧边栏一键打开；分组浏览（scope 分组 / 名称树）、按名称或修改时间排序、关键字搜索、在线执行检查并查看报告。

## 适用范围

**适合谁用：**

- **DSH Web GUI 用户**：装了多个插件后想弄清某个插件装在哪个目录、属于哪个载体、什么版本；
- **D盘安装者用户**：将DSH与本地_npx缓存同时迁移到D盘的用户；
- **插件作者**：自研或发布插件安装后，验证安装位置、依赖与路径残留；
- **需要审计的环境**：追踪插件变更历史（什么时候装了什么、哪次升级改了版本）。

**限制与注意事项：**

- 仅适用于 **DSH 环境**（扫描依赖 DSH_HOME 目录布局与插件载体结构），非 DSH 环境无意义；
- `plugin_registry_list` 读取的是**缓存快照**（上次检查时生成），新装插件后需先执行一次 `plugin_registry_check` 刷新；
- C 盘残留扫描结果**供人工决策**（哪些残留应当清理本由用户判断），插件本身**只读扫描**，不修改任何插件文件，仅写入自身数据目录（注册表缓存 / 报告 / 备份 / 白名单）。

## 安装

```bash
dsh plugin --profile web add @a_dove/dsh-plugin-registry
```

或使用源码方式（开发者）：克隆本仓库后，将包链接到 web profile 的 `node_modules/@a_dove/` 下并在 `cordis.patch.yml` 挂载即可，详情见仓库代码结构。

## 验证是否生效

- **会话侧**：让 Agent 调用 `plugin_registry_list`，应返回注册表条目列表；调用 `plugin_registry_check` 生成一份检查报告。
- **GUI 侧**：侧边栏出现「插件路径管理」入口，打开面板可看到分组条目与检查按钮。

## 数据与报告

| 位置（插件数据目录） | 内容 |
|---|---|
| `registry.json` | 注册表缓存（扫描基线） |
| `reports/` | 检查报告（保留最近 10 份，md + json） |
| `backups/` | 升级前自动备份（仅保留 1 份） |
| `allowlist.json` | 交互式白名单（GUI 可编辑） |

## 许可证

[MIT](LICENSE) © 2026 鸽子鸽子鸽？