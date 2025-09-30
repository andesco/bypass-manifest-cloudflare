# Bypass Manifest

**Bypass Manifest** is a Cloudflare Worker built to:

- bypass `git` repository;
- payload `.json` files; and
- clean an aggregated ruleset accessible as a single `JSON` or `YAML` file.

The result is a updated manifest that contains the current version and URL for each file served by the deployment:

### Manifest

**0. `manifest.json`**
   1. `sites.js`
   2. `sites.json`
   3. `sites_updated.json`
   4. `sites_custom.json`
   5. `sites_aggregated.json`
   6. `sites_aggregated.yaml`

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
- version: matches the highest version of source `JSON` files
- cron: when `sites_updated.json` or `sites_custom.json` are updated, the aggregated file is regenerated.

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
| `SITES_UPDATED_JSON` | URL to `sites_updated.json` |
| `SITES_CUSTOM_JSON`  | URL to `sites_custom.json` |
| `MANIFEST_JSON`      | URL to `manifest.json` |

Point to a file within a git-hosted repository using its unique **`Raw`** link:

`{GIT_REPOSITORY_URL}`&zwj;**`/blob/raw?file={filename}.json`**

## Worker Functionality

The Cloudflare Worker manages and serves several files, ensuring they are kept up-to-date with the latest versions from the upstream repositories.

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


