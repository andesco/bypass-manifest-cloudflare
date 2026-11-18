export const SERVED_FILES = [
  {
    path: '/sites.js',
    manifestKey: 'sites_js',
    kvKey: 'sites_js',
    contentType: 'application/javascript',
    source: 'firefox',
  },
  {
    path: '/sites.json',
    manifestKey: 'sites_json',
    kvKey: 'sites',
    contentType: 'application/json',
    source: 'firefox',
  },
  {
    path: '/sites_updated.json',
    manifestKey: 'sites_updated_json',
    kvKey: 'sites_updated',
    contentType: 'application/json',
    source: 'sites_updated',
  },
  {
    path: '/sites_latest.js',
    manifestKey: 'sites_latest_js',
    kvKey: 'sites_latest_js',
    contentType: 'application/javascript',
    source: 'chrome',
  },
  {
    path: '/sites_latest.json',
    manifestKey: 'sites_latest_json',
    kvKey: 'sites_latest_json',
    contentType: 'application/json',
    source: 'chrome',
  },
  {
    path: '/sites_custom.json',
    manifestKey: 'sites_custom_json',
    kvKey: 'sites_custom',
    contentType: 'application/json',
    source: 'sites_custom',
  },
  {
    path: '/sites_aggregated.js',
    manifestKey: 'sites_aggregated_js',
    kvKey: 'sites_aggregated_js',
    contentType: 'application/javascript',
    source: 'aggregate',
  },
  {
    path: '/sites_aggregated.json',
    manifestKey: 'sites_aggregated_json',
    kvKey: 'sites_aggregated_json',
    contentType: 'application/json',
    source: 'aggregate',
  },
  {
    path: '/sites_aggregated.yaml',
    manifestKey: 'sites_aggregated_yaml',
    kvKey: 'sites_aggregated_yaml',
    contentType: 'text/yaml; charset=utf-8',
    source: 'aggregate',
  },
  {
    path: '/manifest.json',
    manifestKey: 'manifest',
    kvKey: 'manifest',
    contentType: 'application/json',
    source: 'manifest',
  },
];

// Site-specific content scripts (`cs_local/contentScript_<lang>.js`) mirrored from
// the upstream archive. The set of languages is discovered during each update and
// stored in KV (see CS_LOCAL_LIST_KEY), so routes are matched by pattern rather
// than from a fixed list.
export const CS_LOCAL_PATH_PREFIX = '/cs_local/';
export const CS_LOCAL_KV_PREFIX = 'cs_local:';
export const CS_LOCAL_LIST_KEY = 'cs_local_files';
export const CS_LOCAL_CONTENT_TYPE = 'application/javascript; charset=utf-8';
// Matches /cs_local/contentScript_:lang.js, e.g. contentScript_en.js, contentScript_es.pt.js
export const CS_LOCAL_FILENAME_PATTERN = /^contentScript_[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*\.js$/;

export function isCsLocalFilename(filename) {
  return CS_LOCAL_FILENAME_PATTERN.test(filename);
}

export function getCsLocalRoute(pathname) {
  if (!pathname.startsWith(CS_LOCAL_PATH_PREFIX)) return null;
  const filename = pathname.slice(CS_LOCAL_PATH_PREFIX.length);
  if (!isCsLocalFilename(filename)) return null;
  return {
    path: pathname,
    manifestKey: null,
    kvKey: `${CS_LOCAL_KV_PREFIX}${filename}`,
    contentType: CS_LOCAL_CONTENT_TYPE,
    source: 'chrome',
  };
}

export const ROUTES_BY_PATH = new Map(SERVED_FILES.map(file => [file.path, file]));
