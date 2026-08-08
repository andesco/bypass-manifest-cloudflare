import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import worker, { updateFiles } from '../src/index.js';
import { generateAggregatedJson } from '../src/generateAggregatedJson.js';
import { TEST_RULE_DOMAIN, TEST_RULE_TITLE } from '../src/testRules.js';

const KV_KEYS = [
  'sites_js',
  'sites',
  'sites_latest_js',
  'sites_latest_json',
  'sites_updated',
  'sites_custom',
  'sites_aggregated_js',
  'sites_aggregated_json',
  'sites_aggregated_yaml',
  'manifest',
  'last_sites_version',
  'last_sites_latest_version',
  'last_remote_manifest_version',
  'last_update_started_at',
  'last_update_finished_at',
  'last_update_status',
  'last_update_error',
  'last_update_ok_at',
  'log:info',
  'update_lock',
  'meta:source:firefox',
  'meta:source:chrome',
  'meta:source:remote_manifest',
  'meta:source:sites_updated',
  'meta:source:sites_custom',
  'meta:source:aggregate',
];

describe('aggregation', () => {
  it('applies precedence custom > updated > base and expands groups', () => {
    const base = {
      Base: { domain: 'example.com', paywall: true },
      Group: { domain: '###_news', group: ['a.example', 'b.example'], paywall: true },
    };
    const updated = {
      Updated: { domain: 'updated.example', upd_version: '2.0.0' },
      Base: { domain: 'example.com', updated: true },
    };
    const custom = {
      Base: { domain: 'example.com', custom: true },
      RemoveB: { domain: 'b.example', delete: true },
    };

    const aggregated = JSON.parse(generateAggregatedJson(
      JSON.stringify(base),
      JSON.stringify(updated),
      JSON.stringify(custom)
    ));

    expect(aggregated.find(rule => rule.domain === 'example.com')).toMatchObject({ custom: true });
    expect(aggregated.find(rule => rule.domain === 'updated.example')).toMatchObject({ upd_version: '2.0.0' });
    expect(aggregated.find(rule => rule.domain === 'a.example')).toMatchObject({ paywall: true });
    expect(aggregated.find(rule => rule.domain === 'b.example')).toBeUndefined();
  });
});

describe('worker routing and updates', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(KV_KEYS.map(key => env.Bypass_KV.delete(key)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('serves configured KV-backed routes', async () => {
    await env.Bypass_KV.put('sites_aggregated_json', '[{"domain":"example.com"}]');
    const response = await worker.fetch(new Request('https://example.test/sites_aggregated.json'), env, createExecutionContext());

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.json()).toEqual([{ domain: 'example.com' }]);
  });

  it('serves deterministic test pages and exposes the Worker test rule', async () => {
    const indexResponse = await worker.fetch(
      new Request('https://bypass.example.com/test'),
      env,
      createExecutionContext()
    );
    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get('Content-Type')).toContain('text/html');
    const indexHtml = await indexResponse.text();
    expect(indexHtml).toContain('GREEN · PASS');
    expect(indexHtml).toContain('RED · FAIL');
    expect(indexHtml).toContain('BLACK · NEUTRAL');
    for (const caseId of ['dom', 'network', 'content', 'headers']) {
      expect(indexHtml).toContain(`data-test-card="${caseId}"`);
    }

    for (const path of ['/test/dom', '/test/network', '/test/content', '/test/headers']) {
      const response = await worker.fetch(
        new Request(`https://bypass.example.com${path}`),
        env,
        createExecutionContext()
      );
      expect(response.status).toBe(404);
    }

    const assetResponse = await worker.fetch(
      new Request('https://bypass.example.com/test/assets/blocked-script.js'),
      env,
      createExecutionContext()
    );
    expect(assetResponse.status).toBe(200);
    expect(assetResponse.headers.get('Content-Type')).toContain('javascript');

    const echoResponse = await worker.fetch(
      new Request('https://bypass.example.com/test/echo', {
        headers: {
          'user-agent': 'Googlebot/Test',
          referer: 'https://www.google.com/',
          'x-bypass-test': 'worker-rule',
        },
      }),
      env,
      createExecutionContext()
    );
    expect(await echoResponse.json()).toEqual({
      headers: {
        'user-agent': 'Googlebot/Test',
        referer: 'https://www.google.com/',
        'x-bypass-test': 'worker-rule',
      },
    });

    await env.Bypass_KV.put('sites_aggregated_json', JSON.stringify([{ domain: TEST_RULE_DOMAIN }]));
    const ruleResponse = await worker.fetch(
      new Request('https://bypass.example.com/test/rule.json'),
      env,
      createExecutionContext()
    );
    const ruleReport = await ruleResponse.json();
    expect(ruleReport.title).toBe(TEST_RULE_TITLE);
    expect(ruleReport.injected_into_aggregate).toBe(true);
    expect(ruleReport.domain).toBe(TEST_RULE_DOMAIN);
  });

  it('regenerates aggregate from cached sources without partial source rewrites', async () => {
    await env.Bypass_KV.put('last_sites_version', '1.0.0');
    await env.Bypass_KV.put('last_sites_latest_version', '2.0.0');
    await env.Bypass_KV.put('last_remote_manifest_version', '3.0.0');
    await env.Bypass_KV.put('sites_js', 'var defaultSites = {};');
    await env.Bypass_KV.put('sites', JSON.stringify({ FirefoxOnly: { domain: 'firefox.example' } }));
    await env.Bypass_KV.put('sites_latest_js', 'var defaultSites = {};');
    await env.Bypass_KV.put('sites_latest_json', JSON.stringify({ Base: { domain: 'base.example' } }));
    await env.Bypass_KV.put('sites_updated', JSON.stringify({ Updated: { domain: 'updated.example', upd_version: '2.1.0' } }));
    await env.Bypass_KV.put('sites_custom', JSON.stringify({ Custom: { domain: 'custom.example' } }));

    vi.stubGlobal('fetch', vi.fn(async url => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('updates.json')) {
        return Response.json({
          addons: {
            addon: {
              updates: [{ version: '1.0.0', update_link: 'https://cdn.example/sites.xpi' }],
            },
          },
        });
      }
      if (requestUrl.endsWith('updates.xml')) {
        return new Response('<gupdate><app><updatecheck codebase="https://cdn.example/sites.crx" version="2.0.0" /></app></gupdate>');
      }
      if (requestUrl.endsWith('manifest.json')) {
        return Response.json({ version: '3.0.0' });
      }
      return new Response('not found', { status: 404 });
    }));

    const result = await updateFiles({
      ...env,
      GIT_REPOSITORY_URL: 'https://repo.example/project',
      PUBLIC_BASE_URL: 'https://public.example',
    });

    expect(result.status).toBe('ok');
    expect(await env.Bypass_KV.get('last_update_status')).toBe('ok');

    const aggregated = JSON.parse(await env.Bypass_KV.get('sites_aggregated_json'));
    expect(aggregated.map(rule => rule.domain)).toEqual([
      'base.example',
      'updated.example',
      'custom.example',
      TEST_RULE_DOMAIN,
    ]);
    expect(aggregated.find(rule => rule.domain === TEST_RULE_DOMAIN)).toMatchObject({
      allow_cookies: 1,
      block_regex: expect.any(String),
      cs_code: expect.any(Array),
      add_ext_link: expect.any(String),
      useragent: 'googlebot',
    });
    expect(JSON.parse(await env.Bypass_KV.get('sites_updated'))).not.toHaveProperty(TEST_RULE_TITLE);
    expect(JSON.parse(await env.Bypass_KV.get('sites_custom'))).not.toHaveProperty(TEST_RULE_TITLE);
    expect(await env.Bypass_KV.get('sites_aggregated_js')).toContain(TEST_RULE_DOMAIN);
    expect(await env.Bypass_KV.get('sites_aggregated_yaml')).toContain(TEST_RULE_DOMAIN);

    const manifest = JSON.parse(await env.Bypass_KV.get('manifest'));
    expect(manifest.sites_aggregated_json.url).toBe('https://public.example/sites_aggregated.json');
    expect(manifest.sites_aggregated_json.version).toBe('3.0.0');
    expect(JSON.parse(await env.Bypass_KV.get('meta:source:aggregate')).sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid cached source JSON and preserves previous aggregate', async () => {
    await env.Bypass_KV.put('last_sites_version', '1.0.0');
    await env.Bypass_KV.put('last_sites_latest_version', '2.0.0');
    await env.Bypass_KV.put('last_remote_manifest_version', '3.0.0');
    await env.Bypass_KV.put('sites_js', 'var defaultSites = {};');
    await env.Bypass_KV.put('sites', JSON.stringify({ FirefoxOnly: { domain: 'firefox.example' } }));
    await env.Bypass_KV.put('sites_latest_js', 'var defaultSites = {};');
    await env.Bypass_KV.put('sites_latest_json', JSON.stringify({ Base: { domain: 'base.example' } }));
    await env.Bypass_KV.put('sites_updated', '{"broken": true');
    await env.Bypass_KV.put('sites_custom', JSON.stringify({ Custom: { domain: 'custom.example' } }));
    await env.Bypass_KV.put('sites_aggregated_json', '[{"domain":"previous.example"}]');

    vi.stubGlobal('fetch', vi.fn(async url => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('updates.json')) {
        return Response.json({ addons: { addon: { updates: [{ version: '1.0.0', update_link: 'https://cdn.example/sites.xpi' }] } } });
      }
      if (requestUrl.endsWith('updates.xml')) {
        return new Response('<gupdate><app><updatecheck codebase="https://cdn.example/sites.crx" version="2.0.0" /></app></gupdate>');
      }
      if (requestUrl.endsWith('manifest.json')) {
        return Response.json({ version: '3.0.0' });
      }
      return new Response('not found', { status: 404 });
    }));

    const result = await updateFiles({
      ...env,
      GIT_REPOSITORY_URL: 'https://repo.example/project',
    });

    expect(result.status).toBe('error');
    expect(await env.Bypass_KV.get('last_update_status')).toBe('error');
    expect(await env.Bypass_KV.get('sites_aggregated_json')).toBe('[{"domain":"previous.example"}]');
  });

  it('starts manual updates with waitUntil', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://example.test/initiate-update'), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(202);
  });
});
