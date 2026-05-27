# Architecture

## Overview

This project is a Cloudflare Worker that periodically fetches upstream extension rule sources, normalizes them into multiple formats, and serves them via stable HTTP endpoints backed by Cloudflare KV.

## High-Level Data Flow

```text
Triggers
  - Cron (every 6 hours)
  - Manual: GET /initiate-update
        |
        v
Cloudflare Worker (updateFiles)
  - Fetch upstream version manifests:
      - updates.json  -> Firefox XPI URL + version
      - updates.xml   -> Chrome CRX URL + version
      - manifest.json -> remote manifest version tracking (input)
  - Fetch mirrored rule files:
      - sites_updated.json (mirrored, exposed)
      - sites_custom.json  (custom overrides, used in aggregation)
  - Extract + convert:
      - XPI -> sites.js -> sites.json
      - CRX -> sites_latest.js -> sites_latest.json
  - Aggregate:
      - sites_latest.json + sites_updated.json + sites_custom.json -> sites_aggregated.*
  - Validate staged artifacts
  - Write artifacts + status keys to KV
        |
        v
Cloudflare KV (Bypass_KV)
        |
        v
Public HTTP API (read-through from KV + computed /health)
```

## Update Lifecycle

1. Triggered by cron or `GET /initiate-update` (force refresh).
2. Worker fetches `updates.json` (Firefox) and `updates.xml` (Chrome) to determine the latest versions and artifact URLs.
3. Worker fetches upstream `manifest.json` to detect changes that should refresh mirrored files.
4. If the Firefox version changed (or forced), Worker downloads the XPI, extracts `sites.js`, stores `sites_js`, and stores the JSON conversion as `sites`.
5. If the Chrome version changed (or forced), Worker downloads the CRX, extracts the ZIP payload, extracts `sites.js`, stores it as `sites_latest_js`, and stores the JSON conversion as `sites_latest_json`.
6. If the upstream manifest version changed (or forced), Worker refreshes `sites_updated.json` (stored as `sites_updated`) and `sites_custom.json` (stored as `sites_custom`).
7. Worker generates `sites_aggregated_json` using `sites_latest_json` + `sites_updated` + `sites_custom` (groups expanded), `sites_aggregated_js` using the same inputs (groups not expanded; regex literals re-emitted), and `sites_aggregated_yaml` derived from `sites_aggregated_json`.
8. Worker validates generated artifacts, writes a Worker-generated `/manifest.json` to KV key `manifest`, and updates `last_*`, `meta:source:*`, and `log:info` status keys.

## Public Endpoints

| Endpoint | Content-Type | Backing KV key | Notes |
|----------|--------------|----------------|-------|
| `GET /sites.js` | `application/javascript` | `sites_js` | Raw `sites.js` extracted from Firefox XPI |
| `GET /sites.json` | `application/json` | `sites` | JSON conversion of `sites.js` |
| `GET /sites_latest.js` | `application/javascript` | `sites_latest_js` | Raw `sites.js` extracted from Chrome CRX |
| `GET /sites_latest.json` | `application/json` | `sites_latest_json` | JSON conversion of `sites_latest.js` |
| `GET /sites_updated.json` | `application/json` | `sites_updated` | Mirrored upstream file; middle precedence during aggregation |
| `GET /sites_custom.json` | `application/json` | `sites_custom` | Mirrored upstream file; overrides base during aggregation |
| `GET /sites_aggregated.json` | `application/json` | `sites_aggregated_json` | Recommended consumer endpoint (groups expanded) |
| `GET /sites_aggregated.js` | `application/javascript` | `sites_aggregated_js` | BPC-like JS shape (groups preserved) |
| `GET /sites_aggregated.yaml` | `text/yaml; charset=utf-8` | `sites_aggregated_yaml` | YAML derived from aggregated JSON |
| `GET /manifest.json` | `application/json` | `manifest` | Worker-generated manifest of served URLs + versions |
| `GET /health` | `application/json` | (computed) | Status report derived from multiple KV keys |

## Source Files

### Upstream (fetched from git repo)

| File | Description | Version source |
|------|-------------|----------------|
| `updates.json` | Firefox update manifest: XPI archive URL | `addons[0].updates[0].version` |
| XPI archive | ZIP containing `sites.js` | (extracted, not served directly) |
| `updates.xml` | Chrome update manifest: CRX URL | `<updatecheck ... version="...">` |
| CRX file | CRX container with a ZIP payload containing `sites.js` | (extracted, not served directly) |
| `sites_updated.json` | Mirrored file: rule overrides/additions | Highest `upd_version` across entries |
| `sites_custom.json` | Mirrored file: custom rules (highest precedence) | `manifest.json` version |
| `manifest.json` | Remote manifest version tracking (input) | `version` field |

### Generated

| File | Source | Groups expanded | Regex format |
|------|--------|----------------|--------------|
| `sites.js` | Extracted from XPI | No | JS literals: `/pattern/` |
| `sites.json` | `sites.js` via AST conversion | No | strings: `"pattern"` |
| `sites_latest.js` | Extracted from CRX | No | JS literals: `/pattern/` |
| `sites_latest.json` | `sites_latest.js` via AST conversion | No | strings: `"pattern"` |
| `sites_aggregated.json` | `sites_latest.json` + `sites_updated.json` + `sites_custom.json` | **Yes** | strings |
| `sites_aggregated.js` | `sites_latest.json` + `sites_updated.json` + `sites_custom.json` (no expansion) | **No** | re-emitted JS literals |
| `sites_aggregated.yaml` | `sites_aggregated.json` | **Yes** | strings |

## Aggregation Pipeline

### Merge precedence

```
sites_custom.json  (highest — custom overrides)
        ▼
sites_updated.json (middle — upstream update overrides)
        ▼
sites_latest.json  (lowest — base rules extracted from Chrome CRX)
```

Implemented through shared aggregation helpers as a shallow key merge. Keys in later objects replace earlier ones entirely (no deep merge). Worker code and local scripts use the same helpers so audits and stats match production behavior.

### `generateAggregatedJson()` — the primary aggregation

Source: `src/generateAggregatedJson.js`

1. **Merge** the three sources with precedence (Custom > Updated > Base)
2. **Identify deletions:** `###_remove_sites.cs_code` contains a comma-separated list of rule keys to delete; rules with `delete: true` or `domain: ""` are deleted; and group deletion markers use `domain: "###_groupname"` without a `group` array to delete that group.
3. **Collect domains to delete** from any groups marked for deletion
4. **Expand groups**: each domain in a `group` array becomes its own rule entry with the group's properties (minus the `group` field)
5. **Filter**: apply the deletion markers to rule keys and domains; keep metadata/settings entries (e.g. `domain: "###"` or `#options_*`) unless explicitly deleted
6. **Output**: JSON array of rule objects (mostly `{ domain, ...properties }`)

### `generateAggregatedSitesObject()` — the JS object aggregation

Source: `src/generateAggregatedSitesObject.js`

Same merge and deletion logic, but **does not expand groups**. Returns a keyed JS object (title -> rule) for use in `generateAggregatedJs()`.

### `generateAggregatedJs()` — JS file generation

Source: `src/generateAggregatedJs.js`

Takes the object from `generateAggregatedSitesObject()` and serializes it back into JavaScript syntax. Notably:
- Re-emits regex fields (`block_regex`, etc.) as JS regex literals (`/pattern/`)
- Uses `sites.js` as a template, replacing the `defaultSites` object via AST-based splice
- Preserves the original file structure (comments, other code outside `defaultSites`)

### `convertSitesJsToJson()` — JS to JSON conversion

Source: `src/convertSites.js`, `src/astConverter.js`

Converts raw `sites.js` / `sites_latest.js` (JS object literal with regex literals) to JSON:
- **Primary**: Acorn AST parser. Walks the AST, converts `node.regex.pattern` to string
- **Fallback**: Manual string parsing (regex removal, quote normalization)

## Source Modules

| Module | Purpose |
|--------|---------|
| `src/index.js` | Worker entry: request routing, cron handler, `updateFiles()` orchestration |
| `src/astConverter.js` | Acorn-based JS->JSON converter (handles regex literals) |
| `src/convertSites.js` | `convertSitesJsToJson()` with AST primary + manual fallback |
| `src/aggregation.js` | Shared precedence merge, deletion, filtering, and group expansion helpers |
| `src/generateAggregatedJson.js` | Full aggregation with group expansion -> JSON array |
| `src/generateAggregatedSitesObject.js` | Aggregation without group expansion -> JS object |
| `src/generateAggregatedJs.js` | Serializes object back to JS syntax with regex literals |
| `src/convertJsonToYaml.js` | `JSON.parse()` -> `js-yaml.dump()` with version header |
| `src/routes.js` | Route table for served KV-backed endpoints |
| `src/sources.js` | Environment URL resolution and source metadata key definitions |
| `src/updateSources.js` | Version manifest parsers for `updates.json` and `updates.xml` |
| `src/validation.js` | Source and generated artifact validation |
| `src/versions.js` | Version comparison helpers |

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
| `sites_latest_js` | Raw `sites.js` extracted from CRX (Chrome "latest") |
| `sites_latest_json` | `sites_latest.json` (Chrome "latest" rules as JSON) |
| `sites_updated` | Mirrored `sites_updated.json` |
| `sites_custom` | Mirrored `sites_custom.json` |
| `sites_aggregated_json` | Aggregated JSON array (groups expanded) |
| `sites_aggregated_js` | Aggregated JS file (groups not expanded) |
| `sites_aggregated_yaml` | Aggregated YAML |
| `manifest` | Endpoint manifest with versions/URLs |
| `last_sites_version` | Version string for change detection |
| `last_sites_latest_version` | Version string for change detection |
| `last_remote_manifest_version` | Version string for change detection |
| `meta:source:*` | Per-source metadata including version, source URL, SHA-256 hash, status, and timestamp |
| `update_lock` | Short-lived lock that reduces overlapping cron/manual updates |
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

[Ladderflare](../ladder-cloudflare) (`scripts/build-rules.js`) fetches `sites_aggregated.json` at build time.
