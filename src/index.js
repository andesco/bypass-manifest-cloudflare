import { unzip } from 'unzipit';
import { convertSitesJsToJson } from './convertSites.js';
import { generateAggregatedJson } from './generateAggregatedJson.js';
import { convertJsonToYaml } from './convertJsonToYaml.js';

// URL constants set from environment variables (see wrangler.toml [vars] section)

// Helper function to compare versions and return the highest
function getHighestVersion(versions) {
  const validVersions = versions.filter(v => v && v.trim());
  if (validVersions.length === 0) return null;
  if (validVersions.length === 1) return validVersions[0];

  // Simple version comparison (assumes semantic versioning like 4.2.1.8)
  return validVersions.sort((a, b) => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      if (aPart !== bPart) return bPart - aPart; // Descending order
    }
    return 0;
  })[0];
}

export default {
  async scheduled(event, env, ctx) {
    console.log('Scheduled event triggered.');
    ctx.waitUntil(updateFiles(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/initiate-update') {
      console.log('Manual update initiated.');
      ctx.waitUntil(updateFiles(env, true)); // Force update flag
      return new Response('Update initiated successfully!', { status: 200 });
    } else if (path === '/sites.js') {
      const sitesJs = await env.Bypass_KV.get('sites_js');
      if (sitesJs) {
        return new Response(sitesJs, {
          headers: { 'Content-Type': 'application/javascript' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    } else if (path === '/sites.json') {
      const sites = await env.Bypass_KV.get('sites');
      if (sites) {
        return new Response(sites, {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    } else if (path === '/sites_updated.json') {
      const sitesUpdated = await env.Bypass_KV.get('sites_updated');
      if (sitesUpdated) {
        return new Response(sitesUpdated, {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    } else if (path === '/sites_custom.json') {
      const sitesCustom = await env.Bypass_KV.get('sites_custom');
      if (sitesCustom) {
        return new Response(sitesCustom, {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    } else if (path === '/sites_aggregated.json') {
      const sitesAggregatedJson = await env.Bypass_KV.get('sites_aggregated_json');
      if (sitesAggregatedJson) {
        return new Response(sitesAggregatedJson, {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    } else if (path === '/sites_aggregated.yaml') {
      const sitesAggregatedYaml = await env.Bypass_KV.get('sites_aggregated_yaml');
      if (sitesAggregatedYaml) {
        return new Response(sitesAggregatedYaml, {
          headers: { 'Content-Type': 'text/yaml; charset=utf-8' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    } else if (path === '/manifest.json') {
      const manifest = await env.Bypass_KV.get('manifest');
      if (manifest) {
        return new Response(manifest, {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        return new Response('File not found', { status: 404 });
      }
    }

    return new Response('Not found', { status: 404 });
  },
};

async function updateFiles(env, forceUpdate = false) {
  const logs = [];
  const log = async (message) => {
    console.log(message);
    logs.push(`[${new Date().toISOString()}] ${message}`);
    await env.Bypass_KV.put('log:info', logs.join('\n'));
  };

  try {
    await log('Starting updateFiles function.');

    // Set camelCase URL constants from environment variables with GIT_REPOSITORY_URL fallback
    const gitRepositoryUrl = env.GIT_REPOSITORY_URL ? env.GIT_REPOSITORY_URL.replace(/\/+$/, '') : null; // Remove trailing slashes
    const updatesJson = env.UPDATES_JSON || (gitRepositoryUrl ? `${gitRepositoryUrl}/blob/raw?file=updates.json` : null);
    const sitesUpdatedJson = env.SITES_UPDATED_JSON || (gitRepositoryUrl ? `${gitRepositoryUrl}/blob/raw?file=sites_updated.json` : null);
    const sitesCustomJson = env.SITES_CUSTOM_JSON || (gitRepositoryUrl ? `${gitRepositoryUrl}/blob/raw?file=sites_custom.json` : null);
    const manifestJson = env.MANIFEST_JSON || (gitRepositoryUrl ? `${gitRepositoryUrl}/blob/raw?file=manifest.json` : null);

    let sitesVersion = null;
    let remoteManifestVersion = null;
    let sitesUpdatedVersion = null;
    let latestXpi = null;

    if (!updatesJson) {
      await log('ERROR: No UPDATES_JSON URL available. Set UPDATES_JSON or GIT_REPOSITORY_URL environment variable.');
      return;
    }

    await log('Fetching updates.json...');
    const updatesResponse = await fetch(updatesJson);
    if (updatesResponse.ok) {
      const updatesJsonContent = await updatesResponse.json();
      // Extract version and update_link from the first addon's updates array
      if (updatesJsonContent.addons) {
        const firstAddon = Object.values(updatesJsonContent.addons)[0];
        if (firstAddon && firstAddon.updates && firstAddon.updates.length > 0) {
          sitesVersion = firstAddon.updates[0].version;
          latestXpi = firstAddon.updates[0].update_link;
        }
      }
      await log(`Version from updates.json: ${sitesVersion}`);
      await log(`XPI URL from updates.json: ${latestXpi}`);
    } else {
      await log(`Failed to fetch updates.json: ${updatesResponse.statusText}`);
    }

    if (!manifestJson) {
      await log('ERROR: No MANIFEST_JSON URL available. Set MANIFEST_JSON or GIT_REPOSITORY_URL environment variable.');
      return;
    }

    await log('Fetching manifest.json from git repo...');
    const manifestUpdatesResponse = await fetch(manifestJson);
    if (manifestUpdatesResponse.ok) {
      const manifestUpdatesContent = await manifestUpdatesResponse.json();
      remoteManifestVersion = manifestUpdatesContent.version;
      await log(`Version from git repo manifest.json: ${remoteManifestVersion}`);
    } else {
      await log(`Failed to fetch manifest.json from git repo: ${manifestUpdatesResponse.statusText}`);
    }

    const lastSitesVersion = await env.Bypass_KV.get('last_sites_version');
    await log(`Last sites version from KV: ${lastSitesVersion}`);
    const lastRemoteManifestVersion = await env.Bypass_KV.get('last_remote_manifest_version');
    await log(`Last remote manifest version from KV: ${lastRemoteManifestVersion}`);

    let zipNeedsUpdate = false;
    let mirroredFilesNeedUpdate = false;

    if (forceUpdate) {
      await log('Force update requested. Will process sites.js conversion.');
      zipNeedsUpdate = true;
      mirroredFilesNeedUpdate = true;
    } else {
      if (sitesVersion && sitesVersion !== lastSitesVersion) {
        await log('sites.json version changed. Zip needs update.');
        zipNeedsUpdate = true;
      }

      if (remoteManifestVersion && remoteManifestVersion !== lastRemoteManifestVersion) {
        await log('Remote manifest version changed. Mirrored files need update.');
        mirroredFilesNeedUpdate = true;
      }
    }

    if (zipNeedsUpdate && latestXpi) {
      if (forceUpdate) {
        // For force updates, use existing sites.js from KV if available
        await log('Force update: Processing existing sites.js from KV...');
        const existingSitesJs = await env.Bypass_KV.get('sites_js');
        if (existingSitesJs) {
          await log('Converting existing sites.js to JSON...');
          const sitesJson = convertSitesJsToJson(existingSitesJs);
          await env.Bypass_KV.put('sites', sitesJson);
          await log('sites.json stored in KV (force update).');
        } else {
          await log('No existing sites.js found in KV for force update. Downloading from zip...');
          // Fall back to downloading zip if no sites.js exists
          const zipResponse = await fetch(latestXpi);
          if (!zipResponse.ok) {
            await log(`Failed to fetch zip file: ${zipResponse.statusText}`);
          } else {
            const zipData = await zipResponse.arrayBuffer();
            await log('Unzipping zip data...');
            const { entries } = await unzip(zipData);
            const sitesJsEntry = Object.values(entries).find(entry => entry.name.endsWith('/sites.js'));
            if (sitesJsEntry) {
              await log('Processing sites.js from zip...');
              const sitesJsContent = await sitesJsEntry.text();

              // Store the raw sites.js content
              await env.Bypass_KV.put('sites_js', sitesJsContent);
              await log('sites.js stored in KV.');

              // Convert and store as JSON
              const sitesJson = convertSitesJsToJson(sitesJsContent);
              await env.Bypass_KV.put('sites', sitesJson);
              await log('sites.json stored in KV.');

              if (sitesVersion) {
                await env.Bypass_KV.put('last_sites_version', sitesVersion);
                await log('last_sites_version stored in KV.');
              }
            } else {
              await log('sites.js not found in zip file.');
            }
          }
        }
      } else {
        // Normal update process - download zip
        await log('Downloading and processing zip file...');
        const zipResponse = await fetch(latestXpi);
        if (!zipResponse.ok) {
          await log(`Failed to fetch zip file: ${zipResponse.statusText}`);
        } else {
          const zipData = await zipResponse.arrayBuffer();
          await log('Unzipping zip data...');
          const { entries } = await unzip(zipData);
          const sitesJsEntry = Object.values(entries).find(entry => entry.name.endsWith('/sites.js'));
          if (sitesJsEntry) {
            await log('Processing sites.js...');
            const sitesJsContent = await sitesJsEntry.text();

            // Store the raw sites.js content
            await env.Bypass_KV.put('sites_js', sitesJsContent);
            await log('sites.js stored in KV.');

            // Convert and store as JSON
            const sitesJson = convertSitesJsToJson(sitesJsContent);
            await env.Bypass_KV.put('sites', sitesJson);
            await log('sites.json stored in KV.');

            await env.Bypass_KV.put('last_sites_version', sitesVersion);
            await log('last_sites_version stored in KV.');
          } else {
            await log('sites.js not found in zip file.');
          }
        }
      }
    } else if (zipNeedsUpdate && !latestXpi) {
      await log('Cannot update ZIP file: No XPI URL found in updates.json');
    }

    if (mirroredFilesNeedUpdate) {
      if (!sitesUpdatedJson) {
        await log('WARNING: No SITES_UPDATED_JSON URL available. Skipping sites_updated.json update.');
      } else {
        await log('Fetching mirrored files...');
        const sitesUpdatedResponse = await fetch(sitesUpdatedJson);
        if (sitesUpdatedResponse.ok) {
          const sitesUpdatedContent = await sitesUpdatedResponse.text();
          await env.Bypass_KV.put('sites_updated', sitesUpdatedContent);
          await log('sites_updated.json stored in KV.');

          // Extract highest upd_version from sites_updated.json
          try {
            const sitesUpdatedData = JSON.parse(sitesUpdatedContent);
            const updVersions = [];
            for (const [key, value] of Object.entries(sitesUpdatedData)) {
              if (value && typeof value === 'object' && value.upd_version) {
                updVersions.push(value.upd_version);
              }
            }
            sitesUpdatedVersion = getHighestVersion(updVersions);
            await log(`Highest upd_version in sites_updated.json: ${sitesUpdatedVersion}`);
          } catch (error) {
            await log(`Failed to parse sites_updated.json for version extraction: ${error.message}`);
          }
        } else {
          await log(`Failed to fetch sites_updated.json: ${sitesUpdatedResponse.statusText}`);
        }
      }

      if (!sitesCustomJson) {
        await log('WARNING: No SITES_CUSTOM_JSON URL available. Skipping sites_custom.json update.');
      } else {
        const sitesCustomResponse = await fetch(sitesCustomJson);
        if (sitesCustomResponse.ok) {
          const sitesCustomContent = await sitesCustomResponse.text();
          await env.Bypass_KV.put('sites_custom', sitesCustomContent);
          await log('sites_custom.json stored in KV.');
        } else {
          await log(`Failed to fetch sites_custom.json: ${sitesCustomResponse.statusText}`);
        }
      }

      await env.Bypass_KV.put('last_remote_manifest_version', remoteManifestVersion);
      await log('last_remote_manifest_version stored in KV.');
    }

    // Generate and store aggregated files
    await log('Generating aggregated files...');
    const sites = await env.Bypass_KV.get('sites');
    const sitesUpdated = await env.Bypass_KV.get('sites_updated');
    const sitesCustom = await env.Bypass_KV.get('sites_custom');

    if (sites && sitesUpdated && sitesCustom) {
      const aggregatedJson = generateAggregatedJson(sites, sitesUpdated, sitesCustom);
      await env.Bypass_KV.put('sites_aggregated_json', aggregatedJson);
      await log('sites_aggregated.json stored in KV.');

      const allSourceVersions = [sitesVersion, sitesUpdatedVersion, remoteManifestVersion].filter(v => v);
      const highestSourceVersion = getHighestVersion(allSourceVersions);
      const aggregatedYaml = convertJsonToYaml(aggregatedJson, highestSourceVersion);
      await env.Bypass_KV.put('sites_aggregated_yaml', aggregatedYaml);
      await log('sites_aggregated_yaml stored in KV.');
    } else {
      await log('Could not generate aggregated files due to missing source files.');
    }

    if (!zipNeedsUpdate && !mirroredFilesNeedUpdate && !forceUpdate) {
      await log('No version changes. No updates needed.');
    } else if (forceUpdate) {
      await log('Force update completed successfully.');
    }

    if (sitesVersion && remoteManifestVersion) {
      // Ensure we have sitesUpdatedVersion even if files weren't updated
      if (!sitesUpdatedVersion) {
        const existingSitesUpdated = await env.Bypass_KV.get('sites_updated');
        if (existingSitesUpdated) {
          try {
            const sitesUpdatedData = JSON.parse(existingSitesUpdated);
            const updVersions = [];
            for (const [key, value] of Object.entries(sitesUpdatedData)) {
              if (value && typeof value === 'object' && value.upd_version) {
                updVersions.push(value.upd_version);
              }
            }
            sitesUpdatedVersion = getHighestVersion(updVersions);
            await log(`Using existing sitesUpdatedVersion from KV: ${sitesUpdatedVersion}`);
          } catch (error) {
            await log(`Failed to parse existing sites_updated for version: ${error.message}`);
          }
        }
      }
      await log('Generating worker manifest.json...');
      const allVersions = [sitesVersion, sitesUpdatedVersion, remoteManifestVersion].filter(v => v);
      const highestVersion = getHighestVersion(allVersions);

      const workerManifest = {
        sites_js: {
          version: sitesVersion,
          url: 'https://bypass.andrewe.dev/sites.js',
        },
        sites_json: {
          version: sitesVersion,
          url: 'https://bypass.andrewe.dev/sites.json',
        },
        sites_updated_json: {
          version: sitesUpdatedVersion || remoteManifestVersion,
          url: 'https://bypass.andrewe.dev/sites_updated.json',
        },
        sites_custom_json: {
          version: remoteManifestVersion,
          url: 'https://bypass.andrewe.dev/sites_custom.json',
        },
        sites_aggregated_json: {
          version: highestVersion,
          url: 'https://bypass.andrewe.dev/sites_aggregated.json',
        },
        sites_aggregated_yaml: {
          version: highestVersion,
          url: 'https://bypass.andrewe.dev/sites_aggregated.yaml',
        },
      };
      await log(`Generated worker manifest: ${JSON.stringify(workerManifest)}`);
      await env.Bypass_KV.put('manifest', JSON.stringify(workerManifest, null, 2));
      await log('Worker manifest.json stored in KV.');
    } else {
      await log('Could not generate worker manifest.json due to missing version info.');
    }

    await log('updateFiles function finished.');
  } catch (error) {
    await log(`Error in updateFiles: ${error.message}\n${error.stack}`);
  }
}

