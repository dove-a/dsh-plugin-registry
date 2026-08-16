# @a_dove/dsh-plugin-registry

[![npm version](https://img.shields.io/npm/v/@a_dove/dsh-plugin-registry)](https://www.npmjs.com/package/@a_dove/dsh-plugin-registry)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Path registry for DSH (DeepSeek Harness) plugins**: an idea born from its author's own DSH living on the **D drive** (and the many limits that came with relocating it) — it inventories every installed plugin, preset and skill with its real path and origin, automatically detects newly installed, removed and upgraded entries, scans for C-drive residue references inside plugin files, and verifies dependency integrity. Available both as **agent tools** and a **Web GUI panel**.

---

## What it does

- **Full inventory**: uniformly registers plugins / presets / skills from `node_modules`, profiles, preset dirs and skill dirs (name, version, path, carrier type) — see at a glance *who is installed where*.
- **Change tracking (diff)**: compares against the registry snapshot — new installs ➕ / removals ➖ / version upgrades 🔄 listed one by one.
- **C-drive residue scan**: checks plugin files for references to C-drive paths (fast / deep modes), with an interactive **allowlist** to suppress noise (hits are marked `suppressed`, never removed, still visible).
- **Dependency integrity**: flags missing dependencies and broken metadata.
- **Agent tool trio** (callable from a session):
  - `plugin_registry_list` — fast listing of the whole registry from cache
  - `plugin_registry_check` — live rescan + four checks, generates a report (keeps the latest 10 locally)
  - `plugin_registry_report` — reads the most recent check report (incl. C-drive residue details)
- **GUI "Plugin Path Manager" panel**: one click from the sidebar; grouped browsing (scope groups / name tree), sort by name or modification time, keyword search, run checks and view reports in place.

## Who it is for

**Suitable for:**

- **DSH Web GUI users** who installed several plugins and want to know which directory/carrier/version a plugin lives in;
- **D-drive relocators** who moved both DSH and the local `_npx` cache to the D drive — the original motivation for this project;
- **Plugin authors** verifying install location, dependencies and path residue after shipping a plugin;
- **Auditing environments** tracking plugin change history (what was installed when, which upgrade changed a version).

**Limits & notes:**

- Only meaningful in a **DSH environment** (scanning depends on the `DSH_HOME` layout and plugin carrier structure);
- `plugin_registry_list` reads the **cached snapshot** (from the last check) — run `plugin_registry_check` first after installing something new;
- C-drive scan results are **for human decision** (what to clean is your call); the plugin itself is **read-only** towards other plugins — it only writes to its own data dir (registry cache / reports / backups / allowlist).

## Install

```bash
dsh plugin --profile web add @a_dove/dsh-plugin-registry
```

Source-mode (developers): clone this repo and link the package into the web profile's `node_modules/@a_dove/`, then mount it in `cordis.patch.yml` — see the repository layout.

## Verify

- **Agent side**: ask your agent to call `plugin_registry_list` — it should return the registry entries; `plugin_registry_check` generates a fresh report.
- **GUI side**: the sidebar shows a "Plugin Path Manager" entry; open the panel to browse grouped entries and run checks.

## Data & reports

| Location (plugin data dir) | Contents |
|---|---|
| `registry.json` | registry cache / scan baseline |
| `reports/` | check reports (latest 10 kept, md + json) |
| `backups/` | automatic backup before updates (only 1 kept) |
| `allowlist.json` | interactive allowlist (editable in GUI) |

## License

[MIT](LICENSE) © 2026 鸽子鸽子鸽？