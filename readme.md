# Bypass Manifest

**Bypass Manifest** is a Cloudflare Worker built to:

- bypass `git` repository;
- payload `.json` files; and
- clean an aggregated ruleset accessible as a single `JSON` or `YAML` file.

The result is a updated manifest that contains the current version and URL for each file served by the deployment:

### Manifest

**0. `manifest.json`**
   1. `sites.js` (`sites_js`)
   2. `sites.json` (`sites_json`)
   3. `sites_latest.js` (`sites_latest_js`)
   4. `sites_latest.json` (`sites_latest_json`)
   5. `sites_updated.json` (`sites_updated_json`)
   6. `sites_custom.json` (`sites_custom_json`)
   7. `sites_aggregated.js` (`sites_aggregated_js`)
   8. `sites_aggregated.json` (`sites_aggregated_json`)
   9. `sites_aggregated.yaml` (`sites_aggregated_yaml`)
   10. `/test` (`test_suite`)
   11. `/test/rule.json` (`test_rule_json`)
   12. `/health` (`health`)
   13. `/cs_local/contentScript_:lang.js` (`cs_local`, a map of filename to URL; see below)

#### `cs_local` entry

Site-specific content scripts (`cs_local/contentScript_*.js`) are extracted from the latest Chrome `.crx` and served unchanged. Unlike the other entries, `cs_local` has no single `url`. It has a `version` (the Chrome version) and a `files` object that maps each filename to its URL:

```json
"cs_local": {
  "version": "4.3.0.0",
  "files": {
    "contentScript_en.js": "https://bypass.example.com/cs_local/contentScript_en.js",
    "contentScript_es.pt.js": "https://bypass.example.com/cs_local/contentScript_es.pt.js"
  }
}
```

The set of files follows the upstream archive, so clients should iterate `files` instead of hardcoding language codes. The `cs_local` key is omitted until a Chrome archive containing these files has been processed.

### Mirrored and Generated Files
<!-- this section should not be eddited by Claude or Gemini -->

**1. `sites.js`**
   - mirrored file: extracted from the latest `.xpi` `ZIP` archive in [`updates.json`][UPDATES_JSON]
   - version: matches the version in [`updates.json`][UPDATES_JSON]
   - cron: if version in [`updates.json`][UPDATES_JSON] updates, fetch decalred `.xpi` `ZIP` archive and extract `sites.js`


**2. `sites.json`**
   - generated file: `JSON` derived from `sites.js`
   - version: matches the version of `sites.js`
   - cron: if `sites.js` updates, convert to `JSON` and save `sites.json`

## Chrome Latest (updates.xml)

These files are extracted from the latest Chrome `.crx` referenced in `updates.xml`.

**`sites_latest.js`**
- mirrored file: extracted from the latest `.crx` archive in `updates.xml`
- version: matches the version in `updates.xml`

**`sites_latest.json`**
- generated file: `JSON` derived from `sites_latest.js`
- version: matches the version of `sites_latest.js`

**3. `sites_updated.json`**
   - mirrored file: [`sites_updated.json`][SITES_UPDATED_JSON]
   - version: match highest `upd_version` within [`sites_updated.json`][SITES_UPDATED_JSON]

**4. `sites_custom.json`**
   - mirrored file: [`sites_custom.json`][SITES_CUSTOM_JSON]
   - version: match current `version` within [`manifest.json`][MANIFEST_JSON]
   
   [UPDATES_JSON]: ../blob/raw?file=updates.json "URL to updates.json"
   [SITES_UPDATED_JSON]: ../blob/raw?file=sites_updated.json "URL to sites_updated.json"
   [SITES_CUSTOM_JSON]: ../blob/raw?file=sites_custom.json "URL to sites_custom.json"
   [MANIFEST_JSON]: ../blob/raw?file=manifest.json "URL to manifest.json"
   
### Agregated Ruleset

**5. `sites_aggregated.json`**
- generated file: aggregated ruleset from above `JSON` files
- precedence: `sites_custom.json` > `sites_updated.json` > `sites_latest.json`
- version: matches the highest version of source `JSON` files
- cron: regenerated after source files are fetched, converted, and validated.

**6. `sites_aggregated.yaml`**
- generated file:
- derived YAML file from `sites_aggregated.json`
- version: matches the highest version of source `JSON` files
- cron: when `sites_aggregated.json` is updated, it is converted to YAML and saved.

## Environment Variables

You have two ways to configure environment variables:

#### option 1: Base Repository Only

| Variable             | Description |
|----------------------|-------------|
| `GIT_REPOSITORY_URL` | URL of base repository |

Enter the base of a git-hosted repository:
```
https://git.net/project/{username}/{repository}
```

#### option 2: All Individual Files

| Variable             | Description |
|----------------------|-------------|
| `UPDATES_JSON`       | URL to `updates.json` |
| `UPDATES_XML`        | URL to `updates.xml` |
| `SITES_UPDATED_JSON` | URL to `sites_updated.json` |
| `SITES_CUSTOM_JSON`  | URL to `sites_custom.json` |
| `MANIFEST_JSON`      | URL to `manifest.json` |
| `PUBLIC_BASE_URL`    | Public origin used when generating served URLs in `manifest.json` |

Point to a file within a git-hosted repository using its unique **`Raw`** link:

`{GIT_REPOSITORY_URL}`&zwj;**`/blob/raw?file={filename}.json`**

## Worker Functionality

The Cloudflare Worker manages and serves several files, ensuring they are kept up-to-date with the latest versions from the upstream repositories.

Updates are staged before KV is changed. The Worker fetches sources, extracts archives, converts `sites.js` to JSON, validates all rule objects, generates aggregate artifacts, and only then writes the new KV values and version metadata. If a source is invalid, the previous served artifacts remain in place and `/health` reports the error.

### File Storage

All files served by the worker are stored in a Cloudflare KV namespace bound as `Bypass_KV`. This provides a persistent cache for the files, reducing the need to fetch them from the source on every request.

### Update Mechanism

The worker updates the files through two mechanisms:

   1. **Scheduled Updates**: \
   A cron job is configured to run every 6 hours to automatically initiate the update process: \
   `0 */6 * * *`
   2. **Manual Updates**: \
   The update process can be manually initiated by sending a request to the endpoint: \
   `/initiate-update`

### Browser Test Suite

The Worker adds a test-only rule for `bypass.example.com` to the aggregated artifacts. It is not written into the mirrored `sites.js`, `sites_latest.json`, `sites_updated.json`, or `sites_custom.json` sources.

`/manifest.json` advertises the Worker's operational and test endpoints alongside the artifact URLs (`test_suite` -> `/test`, `test_rule_json` -> `/test/rule.json`, and `health` -> `/health`), allowing downstream clients to discover all endpoints from the manifest without hardcoding paths.

Visit `/test` on the deployed Worker to open the consolidated fixture suite. The single page contains four status cards covering:

- DOM cleanup operations
- request blocking
- JSON-LD and external-link selectors
- user-agent, referer, and custom request headers

The page uses green for PASS, red for FAIL, and black for NEUTRAL/not currently verifiable. The suite is deterministic and does not depend on live third-party article pages.
