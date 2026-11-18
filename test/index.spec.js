import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import worker, { buildWorkerManifest, updateFiles } from '../src/index.js';
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
  'cs_local_files',
  'cs_local_extracted_version',
];

// Minimal ZIP writer (stored entries) so tests can fake upstream XPI/CRX archives.
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function buildZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((total, chunk) => total + chunk.length, 0));
  let position = 0;
  for (const chunk of all) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}

function buildCrx3(zipBytes) {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  header.set([0x43, 0x72, 0x32, 0x34]); // "Cr24"
  view.setUint32(4, 3, true);
  view.setUint32(8, 0, true); // empty header
  const out = new Uint8Array(header.length + zipBytes.length);
  out.set(header);
  out.set(zipBytes, header.length);
  return out;
}

const SITES_JS = 'var defaultSites = { Example: { domain: "example.com" } };';

// Stubs fetch for a full update run; `archives` supplies the XPI/CRX bodies.
function stubUpstream({ chromeVersion = '2.0.0', chromeFiles, firefoxFiles }) {
  const fetchMock = vi.fn(async url => {
    const requestUrl = String(url);
    if (requestUrl.endsWith('updates.json')) {
      return Response.json({
        addons: { addon: { updates: [{ version: '1.0.0', update_link: 'https://cdn.example/sites.xpi' }] } },
      });
    }
    if (requestUrl.endsWith('updates.xml')) {
      return new Response(`<gupdate><app><updatecheck codebase="https://cdn.example/sites.crx" version="${chromeVersion}" /></app></gupdate>`);
    }
    if (requestUrl.endsWith('manifest.json')) return Response.json({ version: '3.0.0' });
    if (requestUrl.endsWith('sites_updated.json')) return Response.json({ Updated: { domain: 'updated.example', upd_version: '2.1.0' } });
    if (requestUrl.endsWith('sites_custom.json')) return Response.json({ Custom: { domain: 'custom.example' } });
    if (requestUrl.endsWith('sites.xpi')) return new Response(buildZip(firefoxFiles));
    if (requestUrl.endsWith('sites.crx')) return new Response(buildCrx3(buildZip(chromeFiles)));
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

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

  it('resolves group and general-rule exceptions, strips raw exception arrays, interpolates {domain}, and normalizes polymorphic fields', () => {
    const base = {
      AdvGroup: {
        domain: '###_adv_group',
        group: ['alpha.example.com', 'beta.example.com', 'gamma.example.com', 'delta.example.com'],
        allow_cookies: 1,
        block_regex: '(\\.sophi\\.io\\/|reader\\.{domain}\\/banner\\.js)',
        block_js_inline: 'reader\\.{domain}\\/inline\\/',
        exception: [
          {
            domain: 'alpha.example.com',
            allow_cookies: 1,
            useragent: 'googlebot',
          },
          {
            domain: ['beta.example.com', 'gamma.example.com', 'extra-optin.example.com'],
            allow_cookies: 1,
            block_regex: '\\.{domain}\\/custom-wall\\.js',
          },
        ],
      },
      GeneralTownNews: {
        domain: '###_usa_townnews',
        block_regex_general: '\\/tncms\\/api\\/access\\.js',
        cs_dompurify: 1,
        exception: [
          {
            domain: 'eagle.example.com',
            block_regex_general: '\\.{domain}\\/tncms\\/api\\/access\\.js',
            useragent: 'googlebot',
            cs_dompurify: 1,
          },
        ],
      },
    };
    const custom = {
      CustomStringy: {
        domain: 'custom.example.co.uk',
        block_regex: '\\.{domain}\\/paywall\\.js',
        headers_filter: 'x-{domain}',
        cs_code: '[{"cond":"#paywall","rm_elem":1}]',
        remove_cookies_select_drop: 'pw_a, pw_b',
        remove_cookies_select_hold: 'session_id',
      },
      DeleteGamma: {
        domain: 'gamma.example.com',
        delete: true,
      },
    };

    const aggregated = JSON.parse(generateAggregatedJson(
      JSON.stringify(base),
      JSON.stringify({}),
      JSON.stringify(custom)
    ));

    // Zero leftover group or exception fields anywhere
    for (const rule of aggregated) {
      expect(rule).not.toHaveProperty('group');
      expect(rule).not.toHaveProperty('exception');
    }

    // String exception domain replaces parent rule cleanly (no inherited block_js_inline)
    expect(aggregated.find(rule => rule.domain === 'alpha.example.com')).toEqual({
      domain: 'alpha.example.com',
      allow_cookies: 1,
      useragent: 'googlebot',
    });

    // Array exception domain replaces parent rule and interpolates {domain}
    expect(aggregated.find(rule => rule.domain === 'beta.example.com')).toEqual({
      domain: 'beta.example.com',
      allow_cookies: 1,
      block_regex: '\\.beta\\.example\\.com\\/custom-wall\\.js',
    });

    // Exception domain outside group list (opt-in style) is also emitted
    expect(aggregated.find(rule => rule.domain === 'extra-optin.example.com')).toEqual({
      domain: 'extra-optin.example.com',
      allow_cookies: 1,
      block_regex: '\\.extra-optin\\.example\\.com\\/custom-wall\\.js',
    });

    // Deleted exception domain is omitted
    expect(aggregated.find(rule => rule.domain === 'gamma.example.com')).toBeUndefined();

    // Non-excepted group member inherits parent rule with {domain} interpolated
    expect(aggregated.find(rule => rule.domain === 'delta.example.com')).toEqual({
      domain: 'delta.example.com',
      allow_cookies: 1,
      block_regex: '(\\.sophi\\.io\\/|reader\\.delta\\.example\\.com\\/banner\\.js)',
      block_js_inline: 'reader\\.delta\\.example\\.com\\/inline\\/',
    });

    // Non-group ###_* general rule keeps its rule (minus exception) and emits concrete exception domain
    expect(aggregated.find(rule => rule.domain === '###_usa_townnews')).toEqual({
      domain: '###_usa_townnews',
      block_regex_general: '\\/tncms\\/api\\/access\\.js',
      cs_dompurify: 1,
    });
    expect(aggregated.find(rule => rule.domain === 'eagle.example.com')).toEqual({
      domain: 'eagle.example.com',
      block_regex_general: '\\.eagle\\.example\\.com\\/tncms\\/api\\/access\\.js',
      useragent: 'googlebot',
      cs_dompurify: 1,
    });

    // Polymorphic custom fields normalized + {domain} interpolated
    expect(aggregated.find(rule => rule.domain === 'custom.example.co.uk')).toEqual({
      domain: 'custom.example.co.uk',
      block_regex: '\\.custom\\.example\\.co\\.uk\\/paywall\\.js',
      headers_filter: 'x-custom\\.example\\.co\\.uk',
      cs_code: [{ cond: '#paywall', rm_elem: 1 }],
      remove_cookies_select_drop: ['pw_a', 'pw_b'],
      remove_cookies_select_hold: ['session_id'],
    });
  });
});

describe('worker routing and updates', () => {
  beforeEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(KV_KEYS.map(key => env.Bypass_KV.delete(key)));
    const csLocalKeys = await env.Bypass_KV.list({ prefix: 'cs_local:' });
    await Promise.all(csLocalKeys.keys.map(({ name }) => env.Bypass_KV.delete(name)));
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
    // The four case cards come before the less important "Rule status" panel.
    expect(indexHtml.indexOf('aria-label="Test cases"')).toBeLessThan(indexHtml.indexOf('<h2>Rule status</h2>'));
    expect(indexHtml.lastIndexOf('data-test-card="headers"')).toBeLessThan(indexHtml.indexOf('<h2>Rule status</h2>'));

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
    await env.Bypass_KV.put('cs_local_files', '[]');
    await env.Bypass_KV.put('cs_local_extracted_version', '2.0.0');
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
      block_regex: '/test/assets/blocked-script.js',
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
    expect(manifest.test_suite).toEqual({
      version: '3.0.0',
      url: 'https://public.example/test',
    });
    expect(manifest.test_rule_json).toEqual({
      version: '3.0.0',
      url: 'https://public.example/test/rule.json',
    });
    expect(manifest.health).toEqual({
      version: '3.0.0',
      url: 'https://public.example/health',
    });
    expect(buildWorkerManifest('https://public.example', { aggregate: '4.5.0.0' })).toMatchObject({
      test_suite: { version: '4.5.0.0', url: 'https://public.example/test' },
      test_rule_json: { version: '4.5.0.0', url: 'https://public.example/test/rule.json' },
      health: { version: '4.5.0.0', url: 'https://public.example/health' },
    });
    expect(JSON.parse(await env.Bypass_KV.get('meta:source:aggregate')).sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid cached source JSON and preserves previous aggregate', async () => {
    await env.Bypass_KV.put('last_sites_version', '1.0.0');
    await env.Bypass_KV.put('last_sites_latest_version', '2.0.0');
    await env.Bypass_KV.put('last_remote_manifest_version', '3.0.0');
    await env.Bypass_KV.put('cs_local_files', '[]');
    await env.Bypass_KV.put('cs_local_extracted_version', '2.0.0');
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

  it('serves cs_local content scripts from KV and rejects invalid names', async () => {
    await env.Bypass_KV.put('cs_local:contentScript_en.js', 'window.cs_default = function () {};');
    await env.Bypass_KV.put('cs_local:contentScript_es.pt.js', '// es.pt');

    const ok = await worker.fetch(new Request('https://example.test/cs_local/contentScript_en.js'), env, createExecutionContext());
    expect(ok.status).toBe(200);
    expect(ok.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8');
    expect(await ok.text()).toBe('window.cs_default = function () {};');

    const dotted = await worker.fetch(new Request('https://example.test/cs_local/contentScript_es.pt.js'), env, createExecutionContext());
    expect(dotted.status).toBe(200);
    expect(await dotted.text()).toBe('// es.pt');

    const missing = await worker.fetch(new Request('https://example.test/cs_local/contentScript_de.js'), env, createExecutionContext());
    expect(missing.status).toBe(404);

    for (const path of [
      '/cs_local/',
      '/cs_local/other.js',
      '/cs_local/contentScript_en.txt',
      '/cs_local/contentScript_en.js/extra',
      '/cs_local/sub/contentScript_en.js',
    ]) {
      const response = await worker.fetch(new Request(`https://example.test${path}`), env, createExecutionContext());
      expect(response.status).toBe(404);
    }
  });

  it('extracts cs_local scripts from the Chrome archive, publishes them in the manifest, and prunes removed ones', async () => {
    const chromeFiles = {
      'extension/sites.js': SITES_JS,
      'extension/cs_local/contentScript_en.js': '// en v1',
      'extension/cs_local/contentScript_es.pt.js': '// es.pt v1',
      'extension/cs_local/notes.txt': 'not a content script',
      'extension/other/contentScript_ignored.js': '// outside cs_local',
    };
    stubUpstream({
      chromeFiles,
      // Firefox cs_local must not override the Chrome source.
      firefoxFiles: { 'sites.js': SITES_JS, 'cs_local/contentScript_ff.js': '// firefox' },
    });
    const updateEnv = { ...env, GIT_REPOSITORY_URL: 'https://repo.example/project', PUBLIC_BASE_URL: 'https://public.example' };

    const result = await updateFiles(updateEnv, true);
    expect(result.status).toBe('ok');

    expect(JSON.parse(await env.Bypass_KV.get('cs_local_files'))).toEqual([
      'contentScript_en.js',
      'contentScript_es.pt.js',
    ]);
    expect(await env.Bypass_KV.get('cs_local:contentScript_en.js')).toBe('// en v1');
    expect(await env.Bypass_KV.get('cs_local:contentScript_es.pt.js')).toBe('// es.pt v1');
    expect(await env.Bypass_KV.get('cs_local:contentScript_ignored.js')).toBeNull();
    expect(await env.Bypass_KV.get('cs_local:contentScript_ff.js')).toBeNull();

    const manifest = JSON.parse(await env.Bypass_KV.get('manifest'));
    expect(manifest.cs_local).toEqual({
      version: '2.0.0',
      files: {
        'contentScript_en.js': 'https://public.example/cs_local/contentScript_en.js',
        'contentScript_es.pt.js': 'https://public.example/cs_local/contentScript_es.pt.js',
      },
    });

    // The advertised URL path is actually served by the Worker.
    const served = await worker.fetch(new Request(manifest.cs_local.files['contentScript_en.js']), env, createExecutionContext());
    expect(await served.text()).toBe('// en v1');

    // Upstream drops es.pt and bumps the Chrome version: the stale script is removed.
    delete chromeFiles['extension/cs_local/contentScript_es.pt.js'];
    chromeFiles['extension/cs_local/contentScript_en.js'] = '// en v2';
    stubUpstream({ chromeVersion: '2.1.0', chromeFiles, firefoxFiles: { 'sites.js': SITES_JS } });
    expect((await updateFiles(updateEnv)).status).toBe('ok');

    expect(JSON.parse(await env.Bypass_KV.get('cs_local_files'))).toEqual(['contentScript_en.js']);
    expect(await env.Bypass_KV.get('cs_local:contentScript_en.js')).toBe('// en v2');
    expect(await env.Bypass_KV.get('cs_local:contentScript_es.pt.js')).toBeNull();
    const manifestV2 = JSON.parse(await env.Bypass_KV.get('manifest'));
    expect(Object.keys(manifestV2.cs_local.files)).toEqual(['contentScript_en.js']);
    expect(manifestV2.cs_local.version).toBe('2.1.0');
  });

  it('keeps cs_local entries when the Chrome version is unchanged and backfills them when missing', async () => {
    const chromeFiles = { 'sites.js': SITES_JS, 'cs_local/contentScript_en.js': '// en' };
    const fetchMock = stubUpstream({ chromeFiles, firefoxFiles: { 'sites.js': SITES_JS } });
    const updateEnv = { ...env, GIT_REPOSITORY_URL: 'https://repo.example/project', PUBLIC_BASE_URL: 'https://public.example' };

    // Seed caches as an older Worker would have left them: no cs_local keys at all.
    await env.Bypass_KV.put('last_sites_version', '1.0.0');
    await env.Bypass_KV.put('last_sites_latest_version', '2.0.0');
    await env.Bypass_KV.put('last_remote_manifest_version', '3.0.0');
    await env.Bypass_KV.put('sites_js', SITES_JS);
    await env.Bypass_KV.put('sites', JSON.stringify({ Example: { domain: 'example.com' } }));
    await env.Bypass_KV.put('sites_latest_js', SITES_JS);
    await env.Bypass_KV.put('sites_latest_json', JSON.stringify({ Example: { domain: 'example.com' } }));
    await env.Bypass_KV.put('sites_updated', JSON.stringify({ Updated: { domain: 'updated.example', upd_version: '2.1.0' } }));
    await env.Bypass_KV.put('sites_custom', JSON.stringify({ Custom: { domain: 'custom.example' } }));

    expect((await updateFiles(updateEnv)).status).toBe('ok');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('sites.crx'))).toBe(true);
    expect(await env.Bypass_KV.get('cs_local:contentScript_en.js')).toBe('// en');
    expect(JSON.parse(await env.Bypass_KV.get('manifest')).cs_local.files).toHaveProperty('contentScript_en.js');

    // Second run: nothing changed, so the archive is not downloaded again and the manifest keeps cs_local.
    fetchMock.mockClear();
    expect((await updateFiles(updateEnv)).status).toBe('ok');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('sites.crx'))).toBe(false);
    expect(JSON.parse(await env.Bypass_KV.get('manifest')).cs_local).toEqual({
      version: '2.0.0',
      files: { 'contentScript_en.js': 'https://public.example/cs_local/contentScript_en.js' },
    });
  });

  it('retries cs_local extraction when a stored empty list was never extracted for this Chrome version, using the real archive layout', async () => {
    // Real upstream layout: top-level cs_local/ with an explicit directory entry.
    const chromeFiles = {
      'background.js': '// bg',
      'sites.js': SITES_JS,
      'cs_local/': '',
      'cs_local/contentScript_en.js': '// en real layout',
      'cs_local/contentScript_fi.se.js': '// fi.se real layout',
    };
    const fetchMock = stubUpstream({ chromeFiles, firefoxFiles: { 'sites.js': SITES_JS } });
    const updateEnv = { ...env, GIT_REPOSITORY_URL: 'https://repo.example/project', PUBLIC_BASE_URL: 'https://public.example' };

    // An earlier run left an empty list (e.g. extraction found nothing) with all versions current.
    await env.Bypass_KV.put('last_sites_version', '1.0.0');
    await env.Bypass_KV.put('last_sites_latest_version', '2.0.0');
    await env.Bypass_KV.put('last_remote_manifest_version', '3.0.0');
    await env.Bypass_KV.put('cs_local_files', '[]');
    await env.Bypass_KV.put('sites_js', SITES_JS);
    await env.Bypass_KV.put('sites', JSON.stringify({ Example: { domain: 'example.com' } }));
    await env.Bypass_KV.put('sites_latest_js', SITES_JS);
    await env.Bypass_KV.put('sites_latest_json', JSON.stringify({ Example: { domain: 'example.com' } }));
    await env.Bypass_KV.put('sites_updated', JSON.stringify({ Updated: { domain: 'updated.example', upd_version: '2.1.0' } }));
    await env.Bypass_KV.put('sites_custom', JSON.stringify({ Custom: { domain: 'custom.example' } }));

    expect((await updateFiles(updateEnv)).status).toBe('ok');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('sites.crx'))).toBe(true);
    expect(JSON.parse(await env.Bypass_KV.get('cs_local_files'))).toEqual(['contentScript_en.js', 'contentScript_fi.se.js']);
    expect(await env.Bypass_KV.get('cs_local:contentScript_en.js')).toBe('// en real layout');
    expect(await env.Bypass_KV.get('cs_local_extracted_version')).toBe('2.0.0');
    expect(Object.keys(JSON.parse(await env.Bypass_KV.get('manifest')).cs_local.files)).toEqual(['contentScript_en.js', 'contentScript_fi.se.js']);

    // An empty list that was already attempted for this version is not retried on every run.
    await env.Bypass_KV.put('cs_local_files', '[]');
    fetchMock.mockClear();
    expect((await updateFiles(updateEnv)).status).toBe('ok');
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('sites.crx'))).toBe(false);
  });

  it('builds the cs_local manifest entry only when scripts exist', () => {
    const versions = { chrome: '4.3.0.0', firefox: '4.2.1.0', aggregate: '4.3.0.5' };
    expect(buildWorkerManifest('https://public.example', versions)).not.toHaveProperty('cs_local');
    expect(buildWorkerManifest('https://public.example', versions, [])).not.toHaveProperty('cs_local');
    expect(buildWorkerManifest('https://public.example', versions, ['contentScript_de.js', 'contentScript_fi.se.js']).cs_local).toEqual({
      version: '4.3.0.0',
      files: {
        'contentScript_de.js': 'https://public.example/cs_local/contentScript_de.js',
        'contentScript_fi.se.js': 'https://public.example/cs_local/contentScript_fi.se.js',
      },
    });
  });

  it('starts manual updates with waitUntil', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://example.test/initiate-update'), env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(202);
  });
});
