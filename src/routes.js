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

export const ROUTES_BY_PATH = new Map(SERVED_FILES.map(file => [file.path, file]));
