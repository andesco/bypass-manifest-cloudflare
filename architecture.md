# Architecture

## Data Flow

```
                    Git Repository (gitflic.ru)
                    ┌─────────────────────────┐
                    │  updates.json           │──► XPI URL + sites.js version
                    │  sites_updated.json     │──► Rule overrides (upd_version)
                    │  sites_custom.json      │──► Custom rules (highest precedence)
                    │  manifest.json          │──► Remote version tracking
                    └─────────────────────────┘
                               │
                     cron (every 6 hours) or
                     GET /initiate-update
                               │
                               ▼
                    ┌─────────────────────────┐
                    │  updateFiles()          │
                    │                         │
                    │  1. Fetch updates.json  │
                    │  2. Version check       │
                    │  3. Download XPI → unzip│
                    │     → extract sites.js  │
                    │  4. convertSitesJsToJson│
                    │  5. Fetch mirrored files│
                    │  6. Generate aggregated │
                    │  7. Store all in KV     │
                    └─────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│  Cloudflare KV (Bypass_KV)                               │
│                                                          │
│  sites_js ─────────────► GET /sites.js                   │
│  sites ────────────────► GET /sites.json                 │
│  sites_updated ────────► GET /sites_updated.json         │
│  sites_custom ─────────► GET /sites_custom.json          │
│  sites_aggregated_json ► GET /sites_aggregated.json  ◄── recommended
│  sites_aggregated_js ──► GET /sites_aggregated.js        │
│  sites_aggregated_yaml ► GET /sites_aggregated.yaml      │
│  manifest ─────────────► GET /manifest.json              │
│                          GET /health                     │
└──────────────────────────────────────────────────────────┘
```

## Source Files

### Upstream (fetched from git repo)

| File | Description | Version source |
|------|-------------|----------------|
| `updates.json` | Contains XPI archive URL | `addons[0].updates[0].version` |
| XPI archive | ZIP containing `sites.js` | (extracted, not served directly) |
| `sites_updated.json` | Rule overrides/additions | Highest `upd_version` across entries |
| `sites_custom.json` | Custom rules | `manifest.json` version |
| `manifest.json` | Git repo version | `version` field |

### Generated

| File | Source | Groups expanded | Regex format |
|------|--------|----------------|--------------|
| `sites.js` | Extracted from XPI | No | JS literals (`/pattern/`) |
| `sites.json` | `sites.js` via AST conversion | No | Strings (`"pattern"`) |
| `sites_aggregated.json` | All three merged | **Yes** | Strings |
| `sites_aggregated.js` | Merged (no expansion) | **No** | JS literals (re-emitted) |
| `sites_aggregated.yaml` | `sites_aggregated.json` | **Yes** | Strings |

## Aggregation Pipeline

### Merge precedence

```
sites_custom.json  (highest — overrides everything)
        ▼
sites_updated.json (middle — overrides base)
        ▼
sites.json         (lowest — base rules from XPI)
```

Implemented as a single spread: `{ ...base, ...updated, ...custom }`. Keys in later objects replace earlier ones entirely (no deep merge).

### `generateAggregatedJson()` — the primary aggregation

Source: `src/generateAggregatedJson.js`

1. **Merge** the three sources with precedence
2. **Identify deletions:**
   - `###_remove_sites.cs_code` contains a comma-separated list of rule keys to delete
   - Rules with `delete: true` or `domain: ""`
   - Group deletion markers: `domain: "###_groupname"` without a `group` array means delete that group
3. **Collect domains to delete** from any groups marked for deletion
4. **Expand groups**: each domain in a `group` array becomes its own rule entry with the group's properties (minus the `group` field)
5. **Filter**: remove `###`/`#options_` settings entries, deleted domains
6. **Output**: flat JSON array of `{ domain, ...properties }` objects

### `generateAggregatedSitesObject()` — the JS object aggregation

Source: `src/generateAggregatedSitesObject.js`

Same merge and deletion logic, but **does not expand groups**. Returns a keyed JS object (title → rule) for use in `generateAggregatedJs()`.

### `generateAggregatedJs()` — JS file generation

Source: `src/generateAggregatedJs.js`

Takes the object from `generateAggregatedSitesObject()` and serializes it back into JavaScript syntax. Notably:
- Re-emits regex fields (`block_regex`, etc.) as JS regex literals (`/pattern/`)
- Uses `sites.js` as a template, replacing the `defaultSites` object via AST-based splice
- Preserves the original file structure (comments, other code outside `defaultSites`)

### `convertSitesJsToJson()` — JS to JSON conversion

Source: `src/convertSites.js`, `src/astConverter.js`

Converts raw `sites.js` (JS object literal with regex literals) to JSON:
- **Primary**: Acorn AST parser. Walks the AST, converts `node.regex.pattern` to string
- **Fallback**: Manual string parsing (regex removal, quote normalization)

## Source Modules

| Module | Purpose |
|--------|---------|
| `src/index.js` | Worker entry: request routing, cron handler, `updateFiles()` orchestration |
| `src/astConverter.js` | Acorn-based JS→JSON converter (handles regex literals) |
| `src/convertSites.js` | `convertSitesJsToJson()` with AST primary + manual fallback |
| `src/generateAggregatedJson.js` | Full aggregation with group expansion → JSON array |
| `src/generateAggregatedSitesObject.js` | Aggregation without group expansion → JS object |
| `src/generateAggregatedJs.js` | Serializes object back to JS syntax with regex literals |
| `src/convertJsonToYaml.js` | `JSON.parse()` → `js-yaml.dump()` with version header |

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/download.js` | Downloads all served files to `local/` for inspection |
| `scripts/audit.js` | Interactive audit showing how rules merge across sources |
| `scripts/stats.js` | Domain/group/deletion statistics across sources and final output |
| `scripts/versions.js` | Compares MD5 hashes across versions/archives |

## KV Storage Keys

| Key | Content |
|-----|---------|
| `sites_js` | Raw `sites.js` from XPI |
| `sites` | `sites.json` (base rules as JSON) |
| `sites_updated` | Mirrored `sites_updated.json` |
| `sites_custom` | Mirrored `sites_custom.json` |
| `sites_aggregated_json` | Aggregated JSON array (groups expanded) |
| `sites_aggregated_js` | Aggregated JS file (groups not expanded) |
| `sites_aggregated_yaml` | Aggregated YAML |
| `manifest` | Endpoint manifest with versions/URLs |
| `last_sites_version` | Version string for change detection |
| `last_remote_manifest_version` | Version string for change detection |
| `last_update_*` | Update status/timestamps |
| `log:info` | Update log entries |

## Endpoint Comparison

### `sites_aggregated.json` vs `sites_aggregated.js`

The `.json` endpoint is the **complete, consumer-ready** aggregation:
- Groups fully expanded (each domain is its own entry)
- All deletions applied
- Flat array format, parseable with `JSON.parse()`
- Regex patterns as strings

The `.js` endpoint is a **partial** aggregation:
- Groups **not** expanded (preserved as `group` arrays)
- Keyed by title (e.g., `"Financial Times"`) not domain
- JavaScript syntax with regex literals
- Requires JS eval or AST parsing to consume

The `.js` format exists to replicate the original BPC `sites.js` structure. Nothing currently consumes it. It could be removed to simplify the pipeline — `generateAggregatedSitesObject.js` and `generateAggregatedJs.js` would be deleted, along with the `sites_aggregated_js` KV key and `/sites_aggregated.js` route.

## Downstream Consumer

[Ladderflare](../ladder-cloudflare) (`scripts/build-rules.js`) fetches `sites_aggregated.json` at build time and maps BPC rule properties to its own YAML ruleset format, merging with hand-crafted rules from `ruleset-manual.yaml`.
