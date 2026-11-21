import { unzip } from 'unzipit';
import { convertSitesJsToJson } from './convertSites.js';
import { generateAggregatedJson } from './generateAggregatedJson.js';
import { generateAggregatedSitesObject } from './generateAggregatedSitesObject.js';
import { generateAggregatedJs } from './generateAggregatedJs.js';
import { convertJsonToYaml } from './convertJsonToYaml.js';
import { getHighestUpdVersion, getHighestVersion } from './versions.js';
import {
  CS_LOCAL_KV_PREFIX,
  CS_LOCAL_LIST_KEY,
  CS_LOCAL_PATH_PREFIX,
  CS_LOCAL_VERSION_KEY,
  getCsLocalRoute,
  isCsLocalFilename,
  ROUTES_BY_PATH,
  SERVED_FILES,
} from './routes.js';
import { getPublicBaseUrl, getSourceUrls, SOURCE_METADATA_KEYS } from './sources.js';
import { getTestRoute, NO_STORE } from './testPages.js';
import { buildWorkerTestRules, getTestRuleDomain, getWorkerTestRule, TEST_RULE_TITLE } from './testRules.js';
import { parseChromeUpdatesXml, parseFirefoxUpdatesJson } from './updateSources.js';
import { validateAggregatedJson, validateRulesJson } from './validation.js';

const UPDATE_LOCK_KEY = 'update_lock';
const UPDATE_LOCK_TTL_MS = 5 * 60 * 1000;
const LAST_VERSION_KEYS = {
  firefox: 'last_sites_version',
  chrome: 'last_sites_latest_version',
  remote_manifest: 'last_remote_manifest_version',
};

const worker = {
  async scheduled(event, env, ctx) {
    console.log('Scheduled event triggered.');
    ctx.waitUntil(updateFiles(env));
  },

  async fetch(request, env, ctx) {
    const response = await worker.handle(request, env, ctx);
    if (!isPublicReadPath(new URL(request.url).pathname)) return response;

    // Public read-only routes fetched cross-origin by the extension; errors included.
    const withCors = new Response(response.body, response);
    withCors.headers.set('Access-Control-Allow-Origin', '*');
    return withCors;
  },

  async handle(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/initiate-update') {
      console.log('Manual update initiated.');
      ctx.waitUntil(updateFiles(env, true));
      return new Response('Update initiated successfully!', { status: 202 });
    }

    if (url.pathname === '/health') {
      return Response.json(await buildHealthReport(env));
    }

    if (url.pathname === '/test/rule.json') {
      return Response.json(await buildTestRuleReport(env), {
        headers: { 'Cache-Control': NO_STORE },
      });
    }

    if (url.pathname === '/test/echo') {
      return Response.json({
        headers: {
          'user-agent': request.headers.get('user-agent'),
          referer: request.headers.get('referer'),
          'x-bypass-test': request.headers.get('x-bypass-test'),
        },
      }, {
        headers: { 'Cache-Control': NO_STORE },
      });
    }

    const testRoute = getTestRoute(url.pathname, getTestRuleDomain(env));
    if (testRoute) {
      return new Response(testRoute.body, {
        headers: {
          'Content-Type': testRoute.contentType,
          'Cache-Control': NO_STORE,
        },
      });
    }

    const route = ROUTES_BY_PATH.get(url.pathname) || getCsLocalRoute(url.pathname);
    if (route) {
      const content = await env.Bypass_KV.get(route.kvKey);
      if (!content) return new Response('File not found', { status: 404 });

      return new Response(content, {
        headers: { 'Content-Type': route.contentType },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};

export default worker;

function isPublicReadPath(pathname) {
  return pathname === '/health'
    || pathname === '/test/rule.json'
    || ROUTES_BY_PATH.has(pathname)
    || pathname.startsWith(CS_LOCAL_PATH_PREFIX);
}

export async function updateFiles(env, forceUpdate = false) {
  const logs = [];
  const log = async (level, message, details = {}) => {
    const entry = { timestamp: new Date().toISOString(), level, message, ...details };
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(entry));
    logs.push(JSON.stringify(entry));
    if (logs.length % 10 === 0) await env.Bypass_KV.put('log:info', logs.join('\n'));
  };

  const lock = await acquireUpdateLock(env);
  if (!lock.acquired) {
    await log('warn', 'Update skipped because another update is running.', { lock: lock.current });
    await env.Bypass_KV.put('last_update_status', 'skipped_locked');
    await env.Bypass_KV.put('log:info', logs.join('\n'));
    return { status: 'skipped_locked' };
  }

  try {
    await env.Bypass_KV.put('last_update_started_at', new Date().toISOString());
    await env.Bypass_KV.put('last_update_status', 'running');
    await env.Bypass_KV.delete('last_update_error');
    await log('info', 'Starting updateFiles function.', { forceUpdate });

    const staged = await buildUpdatePlan(env, forceUpdate, log);
    await commitStagedUpdate(env, staged);

    await env.Bypass_KV.put('last_update_finished_at', new Date().toISOString());
    await env.Bypass_KV.put('last_update_status', 'ok');
    await env.Bypass_KV.put('last_update_ok_at', new Date().toISOString());
    await env.Bypass_KV.put('log:info', logs.join('\n'));
    await log('info', 'updateFiles function finished.', {
      writes: staged.writes.length,
      versions: staged.versions,
    });

    return { status: 'ok', versions: staged.versions };
  } catch (error) {
    await log('error', 'Error in updateFiles.', {
      error: String(error?.message || error),
      stack: error?.stack || null,
    });
    await env.Bypass_KV.put('last_update_finished_at', new Date().toISOString());
    await env.Bypass_KV.put('last_update_status', 'error');
    await env.Bypass_KV.put('last_update_error', String(error?.message || error));
    await env.Bypass_KV.put('log:info', logs.join('\n'));
    return { status: 'error', error };
  } finally {
    await releaseUpdateLock(env, lock.id);
  }
}

async function buildUpdatePlan(env, forceUpdate, log) {
  const urls = getSourceUrls(env);
  requireUrl(urls.updatesJson, 'UPDATES_JSON or GIT_REPOSITORY_URL');
  requireUrl(urls.manifestJson, 'MANIFEST_JSON or GIT_REPOSITORY_URL');

  const current = await readCurrentState(env);

  await log('info', 'Fetching source version manifests.');
  const firefoxManifest = parseFirefoxUpdatesJson(await fetchJson(urls.updatesJson, 'updates.json'));
  const remoteManifest = await fetchJson(urls.manifestJson, 'manifest.json');
  const remoteManifestVersion = requireVersion(remoteManifest.version, 'manifest.json');

  let chromeManifest = null;
  if (urls.updatesXml) {
    chromeManifest = parseChromeUpdatesXml(await fetchText(urls.updatesXml, 'updates.xml'));
  } else if (!current.sites_latest_json) {
    throw new Error('UPDATES_XML or cached sites_latest_json is required');
  } else {
    await log('warn', 'No UPDATES_XML URL available; using existing sites_latest cache.');
  }

  const versions = {
    firefox: firefoxManifest.version,
    chrome: chromeManifest?.version || current.last_sites_latest_version,
    remote_manifest: remoteManifestVersion,
  };

  const staged = {
    writes: [],
    versions,
    metadata: {},
  };

  // Re-extract cs_local when it was never stored, or when the stored list is empty and
  // has not been attempted for this Chrome version (an empty list must not block a retry).
  const storedCsLocal = parseKvJson(current.cs_local_files);
  const csLocalBackfillNeeded = !Array.isArray(storedCsLocal)
    || (storedCsLocal.length === 0 && current.cs_local_extracted_version !== versions.chrome);

  const firefoxNeedsUpdate = forceUpdate || !current.sites || !current.sites_js || versions.firefox !== current.last_sites_version;
  const chromeNeedsUpdate = Boolean(chromeManifest) && (forceUpdate || !current.sites_latest_json || !current.sites_latest_js || csLocalBackfillNeeded || versions.chrome !== current.last_sites_latest_version);
  const mirroredNeedsUpdate = forceUpdate || !current.sites_updated || !current.sites_custom || versions.remote_manifest !== current.last_remote_manifest_version;

  const firefox = firefoxNeedsUpdate
    ? await fetchAndConvertArchive(firefoxManifest.url, 'xpi', 'sites', log)
    : { js: current.sites_js, json: current.sites };

  if (firefoxNeedsUpdate) {
    staged.writes.push({ key: 'sites_js', value: firefox.js });
    staged.writes.push({ key: 'sites', value: firefox.json });
    staged.metadata.firefox = await buildSourceMetadata({
      status: 'updated',
      version: versions.firefox,
      url: firefoxManifest.url,
      content: firefox.json,
    });
  } else {
    staged.metadata.firefox = current.metadata.firefox || { status: 'unchanged', version: versions.firefox };
  }

  const chrome = chromeNeedsUpdate
    ? await fetchAndConvertArchive(chromeManifest.url, 'crx', 'sites_latest', log)
    : { js: current.sites_latest_js, json: current.sites_latest_json };

  if (chromeNeedsUpdate) {
    staged.writes.push({ key: 'sites_latest_js', value: chrome.js });
    staged.writes.push({ key: 'sites_latest_json', value: chrome.json });
    staged.metadata.chrome = await buildSourceMetadata({
      status: 'updated',
      version: versions.chrome,
      url: chromeManifest.url,
      content: chrome.json,
    });
  } else {
    staged.metadata.chrome = current.metadata.chrome || { status: 'unchanged', version: versions.chrome };
  }

  const sitesUpdated = mirroredNeedsUpdate
    ? await fetchValidatedRulesJson(urls.sitesUpdatedJson, 'sites_updated.json')
    : { text: current.sites_updated, rules: validateRulesJson(current.sites_updated, 'sites_updated.json') };

  const sitesCustom = mirroredNeedsUpdate
    ? await fetchValidatedRulesJson(urls.sitesCustomJson, 'sites_custom.json')
    : { text: current.sites_custom, rules: validateRulesJson(current.sites_custom, 'sites_custom.json') };

  if (mirroredNeedsUpdate) {
    staged.writes.push({ key: 'sites_updated', value: sitesUpdated.text });
    staged.writes.push({ key: 'sites_custom', value: sitesCustom.text });
    staged.metadata.sites_updated = await buildSourceMetadata({
      status: 'updated',
      version: getHighestUpdVersion(sitesUpdated.rules) || versions.remote_manifest,
      url: urls.sitesUpdatedJson,
      content: sitesUpdated.text,
    });
    staged.metadata.sites_custom = await buildSourceMetadata({
      status: 'updated',
      version: versions.remote_manifest,
      url: urls.sitesCustomJson,
      content: sitesCustom.text,
    });
  } else {
    staged.metadata.sites_updated = current.metadata.sites_updated || {
      status: 'unchanged',
      version: getHighestUpdVersion(sitesUpdated.rules) || versions.remote_manifest,
    };
    staged.metadata.sites_custom = current.metadata.sites_custom || {
      status: 'unchanged',
      version: versions.remote_manifest,
    };
  }

  // Keep the test rule out of mirrored sources while making it available in
  // the aggregate consumed by the extension on the Worker test host.
  const aggregateInputs = [chrome.json, sitesUpdated.text, sitesCustom.text, buildWorkerTestRules(getTestRuleDomain(env))];
  const sitesJsTemplate = chrome.js || firefox.js;
  if (!chrome.json || !sitesUpdated.text || !sitesCustom.text) {
    throw new Error('Missing source files required for aggregation.');
  }

  const aggregatedSitesObject = generateAggregatedSitesObject(...aggregateInputs);
  const aggregatedJs = generateAggregatedJs(aggregatedSitesObject, sitesJsTemplate);
  const aggregatedJson = generateAggregatedJson(...aggregateInputs);
  validateAggregatedJson(aggregatedJson);

  const aggregateVersion = getHighestVersion([
    versions.chrome,
    staged.metadata.sites_updated.version,
    versions.remote_manifest,
  ]);
  const aggregatedYaml = convertJsonToYaml(aggregatedJson, aggregateVersion, getPublicBaseUrl(env));

  staged.writes.push({ key: 'sites_aggregated_js', value: aggregatedJs });
  staged.writes.push({ key: 'sites_aggregated_json', value: aggregatedJson });
  staged.writes.push({ key: 'sites_aggregated_yaml', value: aggregatedYaml });
  staged.metadata.aggregate = await buildSourceMetadata({
    status: 'generated',
    version: aggregateVersion,
    url: null,
    content: aggregatedJson,
  });

  staged.versions = {
    ...versions,
    sites_updated: staged.metadata.sites_updated.version,
    aggregate: aggregateVersion,
  };

  // cs_local content scripts come from the Chrome archive (the base for
  // aggregation). Firefox is only used when no Chrome source is configured.
  const csLocalSource = chromeNeedsUpdate
    ? chrome.csLocalFiles
    : (!chromeManifest && firefoxNeedsUpdate ? firefox.csLocalFiles : null);

  let csLocalFilenames = parseKvJson(current.cs_local_files) || [];
  if (csLocalSource) {
    const previousFilenames = csLocalFilenames;
    csLocalFilenames = Object.keys(csLocalSource).sort();
    for (const filename of csLocalFilenames) {
      staged.writes.push({ key: `${CS_LOCAL_KV_PREFIX}${filename}`, value: csLocalSource[filename] });
    }
    for (const filename of previousFilenames) {
      if (!csLocalFilenames.includes(filename) && isCsLocalFilename(filename)) {
        staged.writes.push({ key: `${CS_LOCAL_KV_PREFIX}${filename}`, delete: true });
      }
    }
    staged.writes.push({ key: CS_LOCAL_LIST_KEY, value: JSON.stringify(csLocalFilenames) });
    staged.writes.push({ key: CS_LOCAL_VERSION_KEY, value: versions.chrome || versions.firefox });
    await log('info', 'Staged cs_local content scripts.', { count: csLocalFilenames.length });
  }
  staged.csLocalFilenames = csLocalFilenames;

  const manifest = buildWorkerManifest(getPublicBaseUrl(env), staged.versions, staged.csLocalFilenames);
  staged.writes.push({ key: 'manifest', value: JSON.stringify(manifest, null, 2) });
  staged.writes.push({ key: LAST_VERSION_KEYS.firefox, value: versions.firefox });
  staged.writes.push({ key: LAST_VERSION_KEYS.chrome, value: versions.chrome });
  staged.writes.push({ key: LAST_VERSION_KEYS.remote_manifest, value: versions.remote_manifest });
  staged.writes.push({ key: SOURCE_METADATA_KEYS.firefox, value: JSON.stringify(staged.metadata.firefox, null, 2) });
  staged.writes.push({ key: SOURCE_METADATA_KEYS.chrome, value: JSON.stringify(staged.metadata.chrome, null, 2) });
  staged.writes.push({ key: SOURCE_METADATA_KEYS.remote_manifest, value: JSON.stringify(await buildSourceMetadata({
    status: 'fetched',
    version: versions.remote_manifest,
    url: urls.manifestJson,
    content: JSON.stringify(remoteManifest),
  }), null, 2) });
  staged.writes.push({ key: SOURCE_METADATA_KEYS.sites_updated, value: JSON.stringify(staged.metadata.sites_updated, null, 2) });
  staged.writes.push({ key: SOURCE_METADATA_KEYS.sites_custom, value: JSON.stringify(staged.metadata.sites_custom, null, 2) });
  staged.writes.push({ key: SOURCE_METADATA_KEYS.aggregate, value: JSON.stringify(staged.metadata.aggregate, null, 2) });

  return staged;
}

async function commitStagedUpdate(env, staged) {
  for (const write of staged.writes) {
    if (write.delete) {
      await env.Bypass_KV.delete(write.key);
      continue;
    }
    if (write.value === null || write.value === undefined) continue;
    await env.Bypass_KV.put(write.key, write.value);
  }
}

async function buildTestRuleReport(env) {
  const testRuleDomain = getTestRuleDomain(env);
  const expectedRule = getWorkerTestRule(testRuleDomain);
  const aggregateRaw = await env.Bypass_KV.get('sites_aggregated_json');
  let aggregateRule = null;
  let aggregateError = null;

  if (aggregateRaw) {
    try {
      const aggregate = JSON.parse(aggregateRaw);
      aggregateRule = aggregate.find(rule => rule?.domain === testRuleDomain) || null;
    } catch (error) {
      aggregateError = String(error?.message || error);
    }
  }

  return {
    domain: testRuleDomain,
    title: TEST_RULE_TITLE,
    injected_into_aggregate: Boolean(aggregateRule),
    aggregate_error: aggregateError,
    rule: aggregateRule || expectedRule,
  };
}

async function fetchAndConvertArchive(url, archiveType, label, log) {
  await log('info', `Downloading ${archiveType.toUpperCase()} archive.`, { label, url });
  const response = await fetchWithRetry(url, { timeoutMs: 30000, retries: 2 });
  if (!response.ok) throw new Error(`Failed to fetch ${label} archive: ${response.status} ${response.statusText}`);

  let archiveData = await response.arrayBuffer();
  if (archiveType === 'crx') archiveData = extractZipFromCrx(archiveData);

  const { entries } = await unzip(archiveData);
  const sitesJsEntry = findSitesJsEntry(entries);
  if (!sitesJsEntry) throw new Error(`${label} archive does not contain sites.js`);

  const js = await sitesJsEntry.text();
  const json = convertSitesJsToJson(js);
  validateRulesJson(json, `${label}.json`);

  const csLocalFiles = {};
  for (const [entryName, entry] of Object.entries(entries)) {
    if (entry.isDirectory) continue;
    const parts = entryName.split('/');
    const filename = parts[parts.length - 1];
    if (parts[parts.length - 2] === 'cs_local' && isCsLocalFilename(filename)) {
      csLocalFiles[filename] = await entry.text();
    }
  }

  return { js, json, csLocalFiles };
}

async function fetchValidatedRulesJson(url, label) {
  requireUrl(url, label);
  const text = await fetchText(url, label);
  const rules = validateRulesJson(text, label);
  return { text: JSON.stringify(rules, null, 2), rules };
}

async function fetchJson(url, label) {
  const text = await fetchText(url, label);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function fetchText(url, label) {
  requireUrl(url, label);
  const response = await fetchWithRetry(url, { timeoutMs: 15000, retries: 2 });
  if (!response.ok) throw new Error(`Failed to fetch ${label}: ${response.status} ${response.statusText}`);
  return response.text();
}

export function buildWorkerManifest(baseUrl, versions, csLocalFilenames = []) {
  const versionBySource = {
    firefox: versions.firefox,
    sites_updated: versions.sites_updated || versions.remote_manifest,
    chrome: versions.chrome,
    sites_custom: versions.remote_manifest,
    aggregate: versions.aggregate,
  };

  const manifest = {};
  for (const file of SERVED_FILES) {
    if (file.manifestKey === 'manifest' || !file.manifestKey) continue;
    const version = versionBySource[file.source];
    if (!version) continue;
    manifest[file.manifestKey] = {
      version,
      url: `${baseUrl}${file.path}`,
    };
  }

  if (Array.isArray(csLocalFilenames) && csLocalFilenames.length > 0) {
    manifest.cs_local = {
      version: versions.chrome || versions.firefox,
      files: Object.fromEntries(
        csLocalFilenames.map(filename => [filename, `${baseUrl}${CS_LOCAL_PATH_PREFIX}${filename}`])
      ),
    };
  }

  if (baseUrl && versions.aggregate) {
    manifest.test_suite = {
      version: versions.aggregate,
      url: `${baseUrl}/test`,
    };
    manifest.test_rule_json = {
      version: versions.aggregate,
      url: `${baseUrl}/test/rule.json`,
    };
    manifest.health = {
      version: versions.aggregate,
      url: `${baseUrl}/health`,
    };
  }

  return manifest;
}

async function buildSourceMetadata({ status, version, url, content }) {
  return {
    status,
    version: version || null,
    url: url || null,
    sha256: content ? await sha256Text(content) : null,
    updated_at: new Date().toISOString(),
  };
}

async function readCurrentState(env) {
  const keys = [
    'sites_js',
    'sites',
    'sites_latest_js',
    'sites_latest_json',
    'sites_updated',
    'sites_custom',
    CS_LOCAL_LIST_KEY,
    CS_LOCAL_VERSION_KEY,
    LAST_VERSION_KEYS.firefox,
    LAST_VERSION_KEYS.chrome,
    LAST_VERSION_KEYS.remote_manifest,
    ...Object.values(SOURCE_METADATA_KEYS),
  ];

  const values = await Promise.all(keys.map(key => env.Bypass_KV.get(key)));
  const byKey = Object.fromEntries(keys.map((key, index) => [key, values[index]]));

  return {
    sites_js: byKey.sites_js,
    sites: byKey.sites,
    sites_latest_js: byKey.sites_latest_js,
    sites_latest_json: byKey.sites_latest_json,
    sites_updated: byKey.sites_updated,
    sites_custom: byKey.sites_custom,
    cs_local_files: byKey[CS_LOCAL_LIST_KEY],
    cs_local_extracted_version: byKey[CS_LOCAL_VERSION_KEY],
    last_sites_version: byKey[LAST_VERSION_KEYS.firefox],
    last_sites_latest_version: byKey[LAST_VERSION_KEYS.chrome],
    last_remote_manifest_version: byKey[LAST_VERSION_KEYS.remote_manifest],
    metadata: Object.fromEntries(
      Object.entries(SOURCE_METADATA_KEYS).map(([name, key]) => [name, parseKvJson(byKey[key])])
    ),
  };
}

async function buildHealthReport(env) {
  const [
    lastUpdateStartedAt,
    lastUpdateFinishedAt,
    lastUpdateStatus,
    lastUpdateError,
    lastUpdateOkAt,
    lastSitesVersion,
    lastSitesLatestVersion,
    lastRemoteManifestVersion,
    manifest,
    sitesUpdatedRaw,
    ...metadataValues
  ] = await Promise.all([
    env.Bypass_KV.get('last_update_started_at'),
    env.Bypass_KV.get('last_update_finished_at'),
    env.Bypass_KV.get('last_update_status'),
    env.Bypass_KV.get('last_update_error'),
    env.Bypass_KV.get('last_update_ok_at'),
    env.Bypass_KV.get(LAST_VERSION_KEYS.firefox),
    env.Bypass_KV.get(LAST_VERSION_KEYS.chrome),
    env.Bypass_KV.get(LAST_VERSION_KEYS.remote_manifest),
    env.Bypass_KV.get('manifest'),
    env.Bypass_KV.get('sites_updated'),
    ...Object.values(SOURCE_METADATA_KEYS).map(key => env.Bypass_KV.get(key)),
  ]);

  let sitesUpdatedVersion = null;
  if (sitesUpdatedRaw) {
    try {
      sitesUpdatedVersion = getHighestUpdVersion(JSON.parse(sitesUpdatedRaw));
    } catch (error) {
      sitesUpdatedVersion = null;
    }
  }

  return {
    status: lastUpdateStatus || 'unknown',
    last_update_started_at: lastUpdateStartedAt || null,
    last_update_finished_at: lastUpdateFinishedAt || null,
    last_update_ok_at: lastUpdateOkAt || null,
    last_update_error: redactUrls(lastUpdateError) || null,
    versions: {
      sites: lastSitesVersion || null,
      sites_latest: lastSitesLatestVersion || null,
      sites_updated: sitesUpdatedVersion || null,
      manifest: lastRemoteManifestVersion || null,
    },
    sources: Object.fromEntries(
      Object.keys(SOURCE_METADATA_KEYS).map((name, index) => [name, publicSourceMetadata(parseKvJson(metadataValues[index]))])
    ),
    manifest: parseKvJson(manifest),
  };
}

// Upstream source URLs (e.g. the Git repository) must never be exposed publicly.
function publicSourceMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const { url, ...rest } = metadata;
  return rest;
}

function redactUrls(text) {
  return typeof text === 'string' ? text.replace(/https?:\/\/[^\s"'<>)]+/gi, '[redacted-url]') : text;
}

async function acquireUpdateLock(env) {
  const now = Date.now();
  const current = parseKvJson(await env.Bypass_KV.get(UPDATE_LOCK_KEY));
  if (current?.expires_at && Date.parse(current.expires_at) > now) {
    return { acquired: false, current };
  }

  const id = crypto.randomUUID();
  const lock = {
    id,
    acquired_at: new Date(now).toISOString(),
    expires_at: new Date(now + UPDATE_LOCK_TTL_MS).toISOString(),
  };
  await env.Bypass_KV.put(UPDATE_LOCK_KEY, JSON.stringify(lock));
  return { acquired: true, id };
}

async function releaseUpdateLock(env, id) {
  const current = parseKvJson(await env.Bypass_KV.get(UPDATE_LOCK_KEY));
  if (current?.id === id) await env.Bypass_KV.delete(UPDATE_LOCK_KEY);
}

async function fetchWithRetry(url, { timeoutMs = 15000, retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
    }
  }
  throw lastError || new Error('fetchWithRetry failed');
}

function extractZipFromCrx(crxArrayBuffer) {
  const bytes = new Uint8Array(crxArrayBuffer);
  if (bytes.length < 12) throw new Error('CRX too small');

  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'Cr24') throw new Error(`Invalid CRX magic: ${magic}`);

  const view = new DataView(crxArrayBuffer);
  const version = view.getUint32(4, true);

  if (version === 2) {
    const pubKeyLen = view.getUint32(8, true);
    const sigLen = view.getUint32(12, true);
    const zipStart = 16 + pubKeyLen + sigLen;
    if (zipStart > bytes.length) throw new Error('CRX2 header exceeds file size');
    return bytes.slice(zipStart).buffer;
  }

  if (version === 3) {
    const headerSize = view.getUint32(8, true);
    const zipStart = 12 + headerSize;
    if (zipStart > bytes.length) throw new Error('CRX3 header exceeds file size');
    return bytes.slice(zipStart).buffer;
  }

  throw new Error(`Unsupported CRX version: ${version}`);
}

function findSitesJsEntry(entries) {
  return Object.values(entries).find(entry => entry.name.split('/').pop() === 'sites.js') || null;
}

async function sha256Text(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function parseKvJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

function requireUrl(url, label) {
  if (!url) throw new Error(`No URL available for ${label}`);
}

function requireVersion(version, label) {
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error(`${label} does not contain a valid version`);
  }
  return version;
}
