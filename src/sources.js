export const SOURCE_METADATA_KEYS = {
  firefox: 'meta:source:firefox',
  chrome: 'meta:source:chrome',
  remote_manifest: 'meta:source:remote_manifest',
  sites_updated: 'meta:source:sites_updated',
  sites_custom: 'meta:source:sites_custom',
  aggregate: 'meta:source:aggregate',
};

export function getSourceUrls(env) {
  const gitRepositoryUrl = env.GIT_REPOSITORY_URL
    ? env.GIT_REPOSITORY_URL.replace(/\/+$/, '')
    : null;

  const fromRepo = fileName => (gitRepositoryUrl ? `${gitRepositoryUrl}/blob/raw?file=${fileName}` : null);

  return {
    updatesJson: env.UPDATES_JSON || fromRepo('updates.json'),
    updatesXml: env.UPDATES_XML || fromRepo('updates.xml'),
    sitesUpdatedJson: env.SITES_UPDATED_JSON || fromRepo('sites_updated.json'),
    sitesCustomJson: env.SITES_CUSTOM_JSON || fromRepo('sites_custom.json'),
    manifestJson: env.MANIFEST_JSON || fromRepo('manifest.json'),
  };
}

export function getPublicBaseUrl(env) {
  return (env.PUBLIC_BASE_URL || 'https://bypass.andrewe.dev').replace(/\/+$/, '');
}
