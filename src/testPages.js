import { TEST_RULE_DOMAIN, TEST_RULE_TITLE } from './testRules.js';

const NO_STORE = 'no-store, max-age=0';

const PAGE_STYLES = `
  :root { font-family: system-ui, sans-serif; background: #f4f4f4; color: #111; }
  body { max-width: 88rem; margin: 0 auto; padding: 1rem 1rem 3rem; line-height: 1.45; }
  a { color: #111; font-weight: 650; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre { overflow: auto; padding: 1rem; background: #111; color: #fff; border-radius: .5rem; }
  h1, h2, h3 { line-height: 1.2; }
  .notice, .legend, .rule-panel { padding: 1rem; border: 2px solid #111; border-radius: .5rem; background: #fff; }
  .page-head { display: flex; flex-wrap: wrap; gap: .5rem 1.5rem; align-items: center; justify-content: space-between; margin-bottom: .25rem; }
  .page-head h1 { margin: 0; }
  .page-intro { margin: 0; }
  .page-nav { margin: 0 0 .5rem; }
  .legend { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .5rem .75rem; }
  .rule-panel { margin-top: 1.5rem; }
  .rule-panel h2 { margin-top: 0; }
  .rule-panel pre { max-height: 14rem; overflow: auto; margin-bottom: 0; }
  .status-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 5.5rem; padding: .35rem .65rem; border-radius: 999px; color: #fff; font-size: .78rem; font-weight: 800; letter-spacing: .04em; }
  .status-badge.status-pass { background: #16803c; }
  .status-badge.status-fail { background: #c62828; }
  .status-badge.status-neutral { background: #111; }
  .summary { display: flex; gap: 1rem; align-items: center; margin: .75rem 0; padding: .75rem 1rem; border: 4px solid #111; border-radius: .75rem; background: #fff; }
  .summary.status-pass { border-color: #16803c; }
  .summary.status-fail { border-color: #c62828; }
  .summary.status-neutral { border-color: #111; }
  .summary h2 { margin: 0; font-size: 1.15rem; }
  .summary p { margin: .25rem 0 0; }
  /* One column on phones; a 2x2 grid from tablet width up so four cards never leave one orphaned on its own row. */
  .cases { display: grid; grid-template-columns: minmax(0, 1fr); gap: .75rem; margin: .75rem 0; }
  @media (min-width: 44rem) {
    .cases { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  /* Wide cards: fixture on the left, results on the right, to keep each card short. */
  .case-main { display: grid; grid-template-columns: minmax(0, 1fr); gap: .75rem; align-items: start; }
  @media (min-width: 70rem) {
    .case-main { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .test-card { padding: .75rem 1rem 1rem; border: 4px solid #111; border-radius: .75rem; background: #fff; }
  .test-card.status-pass { border-color: #16803c; }
  .test-card.status-fail { border-color: #c62828; }
  .test-card.status-neutral { border-color: #111; }
  .case-heading { display: flex; gap: .75rem; justify-content: space-between; align-items: flex-start; }
  .case-heading h2 { margin: 0; }
  .case-heading p { margin: .25rem 0 0; }
  .case-heading h2 { font-size: 1.25rem; }
  .case-fields { color: #111; font-size: .85rem; margin: .5rem 0; }
  .fixture { margin: 0 0 .5rem; padding: .6rem .75rem; border: 2px dashed #111; background: #fafafa; }
  .test-paywall { background: #8b0000; color: #fff; padding: .5rem .75rem; }
  .test-hidden { padding: .5rem .75rem; background: #554400; }
  #test-link-paywall { margin-bottom: .3rem; padding: .35rem .75rem; }
  .link-caption { margin: 0 0 .15rem; font-size: .8rem; line-height: 1.3; color: #444; }
  #test-link-content { margin: 0; padding: .25rem .6rem; border: 1px dashed #888; background: #f4f4f4; color: #333; font-size: .8rem; line-height: 1.3; overflow-wrap: anywhere; }
  #test-link-content::before { content: "Sample output:"; display: block; font-weight: 600; color: #666; }
  #test-link-content p { margin: 0; }
  #bpc_archive ~ [data-link-placeholder] { display: none; }
  #test-link-content #bpc_archive { margin: 0 !important; font-size: .8rem !important; font-weight: normal !important; color: #333 !important; line-height: 1.3 !important; }
  #test-link-content #bpc_archive a { color: #333 !important; font-size: .8rem !important; font-weight: normal !important; }
  .case-fixtures { font-size: .9rem; }
  .case-fixtures article { margin: 0 0 .5rem; }
  .case-fixtures h3 { margin: 0 0 .15rem; font-size: 1rem; }
  .case-fixtures p { margin: 0 0 .35rem; }
  .case-fixtures p:last-child { margin-bottom: 0; }
  .checks { display: grid; gap: .4rem; padding: 0; margin: 0; list-style: none; }
  .check-row { padding: .4rem .6rem; font-size: .9rem; border-left: .45rem solid #111; background: #f4f4f4; }
  .check-row.status-pass { border-left-color: #16803c; }
  .check-row.status-fail { border-left-color: #c62828; }
  .check-row.status-neutral { border-left-color: #111; }
  .check-row strong { display: block; }
  .check-detail { font-size: .9rem; }
  .footer-links { margin-top: 1.5rem; }
`;

const CASE_DEFINITIONS = [
  {
    id: 'dom',
    title: 'DOM cleanup',
    description: 'Tests rm_elem, hide_elem, rm_attrib, and rm_class.',
    fields: 'cs_code',
    body: `
      <div class="fixture">
        <div id="test-dom-remove">This element should be removed.</div>
        <div id="test-dom-hide" class="test-hidden">This element should be hidden.</div>
        <div id="test-dom-style" style="color: transparent">This style attribute should be removed.</div>
        <div id="test-dom-class" class="test-paywall">This paywall class should be removed.</div>
      </div>`,
  },
  {
    id: 'network',
    title: 'Request blocking',
    description: 'Tests block_regex against a Worker-served script.',
    fields: 'block_regex',
    body: `
      <div class="fixture">
        <p id="network-status">The blocked script has not reported execution.</p>
        <script>window.__bypassTestBlockedScriptExecuted = false;</script>
        <script src="/test/assets/blocked-script.js"></script>
      </div>`,
  },
  {
    id: 'content',
    title: 'Content and link selectors',
    description: 'Verifies JSON-LD extraction and the external-link fallback.',
    fields: 'ld_json, add_ext_link',
    body: `
      <div class="fixture" id="test-jsonld-paywall">This is the synthetic paywall marker.</div>
      <article id="test-jsonld-content">
        <h3>Fixture article</h3>
        <p>This locked article shell should be replaced by the JSON-LD body.</p>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"NewsArticle","headline":"Fixture article","articleBody":"JSON-LD extracted fixture content"}
        </script>
      </article>
      <div class="fixture" id="test-link-paywall">This is the synthetic link paywall marker.</div>
      <p class="link-caption" data-link-caption>Expected result: the extension adds a sample fallback link below. This is not an error.</p>
      <article id="test-link-content"><p data-link-placeholder>Waiting for the extension to add the link.</p></article>`,
  },
  {
    id: 'headers',
    title: 'Request headers',
    description: 'Inspects user-agent, referer, and headers_custom at the Worker.',
    fields: 'useragent, referer, headers_custom',
    body: '<div class="fixture"><p>The result below reflects selected headers received by the Worker.</p></div>',
  },
];

function htmlResponse(body) {
  return {
    body,
    contentType: 'text/html; charset=utf-8',
  };
}

function renderCaseCards() {
  return CASE_DEFINITIONS.map(testCase => `
    <article class="test-card status-neutral" data-test-card="${testCase.id}">
      <div class="case-heading">
        <div>
          <h2>${testCase.title}</h2>
          <p>${testCase.description}</p>
        </div>
        <span id="status-${testCase.id}" class="status-badge status-neutral">NEUTRAL</span>
      </div>
      <p class="case-fields"><strong>Rule fields:</strong> <code>${testCase.fields}</code></p>
      <div class="case-main">
        <div class="case-fixtures">${testCase.body}</div>
        <ul id="checks-${testCase.id}" class="checks">
          <li class="check-row status-neutral"><strong>NEUTRAL</strong><span class="check-detail">Waiting for the Worker rule and extension.</span></li>
        </ul>
      </div>
    </article>`).join('');
}

function renderSuite() {
  return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Bypass Manifest test suite</title>
    <style>${PAGE_STYLES}</style>
  </head>
  <body>
    <p class="page-nav"><a href="/health">Worker health</a> · <a href="/manifest.json">Artifact manifest</a> · <a href="/sites_aggregated.json">Aggregated rules</a></p>
    <header class="page-head">
      <h1>Bypass Manifest test suite</h1>
      <div class="legend" aria-label="Status legend">
        <span class="status-badge status-pass">GREEN · PASS</span>
        <span class="status-badge status-fail">RED · FAIL</span>
        <span class="status-badge status-neutral">BLACK · NEUTRAL</span>
      </div>
    </header>
    <p class="page-intro">This single page exercises the Worker-hosted <code>${TEST_RULE_DOMAIN}</code> rule. Green is good, red is bad, and black is neutral/not currently verifiable.</p>

    <section id="test-summary" class="summary status-neutral" aria-live="polite">
      <span id="test-summary-badge" class="status-badge status-neutral">NEUTRAL</span>
      <div>
        <h2 id="test-summary-title">Waiting for test results</h2>
        <p id="test-summary-detail">Checking whether the Worker aggregate contains the test rule.</p>
      </div>
    </section>

    <section class="cases" aria-label="Test cases">
      ${renderCaseCards()}
    </section>

    <section class="rule-panel">
      <h2>Rule status</h2>
      <pre id="test-rule">Loading ${TEST_RULE_TITLE}…</pre>
    </section>

    <p class="footer-links">All fixtures are same-origin and deterministic. Enable the extension, refresh this page, and wait for the statuses to settle.</p>

    <script>
      function makeCheck(state, label, detail) {
        return { state, label, detail: detail || '' };
      }

      function passCheck(label, detail) {
        return makeCheck('pass', label, detail);
      }

      function failCheck(label, detail) {
        return makeCheck('fail', label, detail);
      }

      function neutralCheck(label, detail) {
        return makeCheck('neutral', label, detail);
      }

      function setStatus(element, state, text) {
        element.className = 'status-badge status-' + state;
        element.textContent = text || state.toUpperCase();
      }

      function renderCase(caseId, state, checks) {
        const card = document.querySelector('[data-test-card="' + caseId + '"]');
        const badge = document.querySelector('#status-' + caseId);
        const list = document.querySelector('#checks-' + caseId);
        card.className = 'test-card status-' + state;
        setStatus(badge, state);
        list.replaceChildren(...checks.map(check => {
          const item = document.createElement('li');
          item.className = 'check-row status-' + check.state;
          const label = document.createElement('strong');
          label.textContent = (check.state === 'pass' ? 'PASS: ' : check.state === 'fail' ? 'FAIL: ' : 'NEUTRAL: ') + check.label;
          item.appendChild(label);
          if (check.detail) {
            const detail = document.createElement('span');
            detail.className = 'check-detail';
            detail.textContent = check.detail;
            item.appendChild(detail);
          }
          return item;
        }));
      }

      function setOverall(state, title, detail) {
        const summary = document.querySelector('#test-summary');
        summary.className = 'summary status-' + state;
        setStatus(document.querySelector('#test-summary-badge'), state);
        document.querySelector('#test-summary-title').textContent = title;
        document.querySelector('#test-summary-detail').textContent = detail;
      }

      function renderRuleReport(report) {
        document.querySelector('#test-rule').textContent = JSON.stringify(report, null, 2);
      }

      function hasExtensionEffect(observations) {
        return Object.values(observations).some(checks => checks.some(check => check.effect));
      }

      function stripEffectFlag(checks) {
        return checks.map(check => {
          const copy = { state: check.state, label: check.label, detail: check.detail };
          return copy;
        });
      }

      function neutralize(observations, reason) {
        for (const [caseId, checks] of Object.entries(observations)) {
          renderCase(caseId, 'neutral', checks.map(check => neutralCheck(check.label, reason)));
        }
        setOverall('neutral', 'NEUTRAL · extension not verified', reason);
      }

      async function collectObservations() {
        const hidden = document.querySelector('#test-dom-hide');
        const style = document.querySelector('#test-dom-style');
        const classTarget = document.querySelector('#test-dom-class');
        const hiddenByStyle = hidden && getComputedStyle(hidden).display === 'none';
        const jsonLdPaywall = document.querySelector('#test-jsonld-paywall');
        const jsonLdTarget = document.querySelector('#test-jsonld-content');
        const jsonLdScript = document.querySelector('#test-jsonld-content script[type="application/ld+json"]');
        const jsonLdBody = document.body && document.body.innerText.includes('JSON-LD extracted fixture content');
        const linkTarget = document.querySelector('#test-link-content');
        const linkPaywall = document.querySelector('#test-link-paywall');
        const insertedLinks = linkTarget ? linkTarget.querySelectorAll('a[href*="search.google.com/test/rich-results"]').length : 0;

        const echoResponse = await fetch('/test/echo', { cache: 'no-store' });
        const echo = await echoResponse.json();
        const headers = echo.headers || {};

        return {
          dom: [
            { state: document.querySelector('#test-dom-remove') ? 'fail' : 'pass', label: 'rm_elem removed #test-dom-remove', detail: '', effect: !document.querySelector('#test-dom-remove') },
            { state: hidden && (hidden.hidden || hiddenByStyle || getComputedStyle(hidden).visibility === 'hidden') ? 'pass' : 'fail', label: 'hide_elem hid #test-dom-hide', detail: '', effect: Boolean(hidden && (hidden.hidden || hiddenByStyle || getComputedStyle(hidden).visibility === 'hidden')) },
            { state: style && !style.hasAttribute('style') ? 'pass' : 'fail', label: 'rm_attrib removed the style attribute', detail: '', effect: Boolean(style && !style.hasAttribute('style')) },
            { state: classTarget && !classTarget.classList.contains('test-paywall') ? 'pass' : 'fail', label: 'rm_class removed test-paywall', detail: '', effect: Boolean(classTarget && !classTarget.classList.contains('test-paywall')) },
          ],
          network: [
            { state: window.__bypassTestBlockedScriptExecuted === true ? 'fail' : 'pass', label: 'block_regex prevented the fixture script from executing', detail: String(window.__bypassTestBlockedScriptExecuted), effect: window.__bypassTestBlockedScriptExecuted !== true },
          ],
          content: [
            { state: !jsonLdPaywall && !jsonLdTarget && !jsonLdScript && jsonLdBody ? 'pass' : 'fail', label: 'ld_json replaced the locked article with JSON-LD content', detail: jsonLdBody ? 'extracted body present' : 'extracted body missing', effect: !jsonLdPaywall && !jsonLdTarget && !jsonLdScript && jsonLdBody },
            { state: !linkPaywall && insertedLinks > 0 ? 'pass' : 'fail', label: 'add_ext_link removed the marker and inserted a link', detail: String(insertedLinks) + ' Google link(s) found', effect: !linkPaywall && insertedLinks > 0 },
          ],
          headers: [
            { state: /googlebot/i.test(headers['user-agent'] || '') ? 'pass' : 'fail', label: 'useragent sent a Googlebot user agent', detail: headers['user-agent'] || 'missing', effect: /googlebot/i.test(headers['user-agent'] || '') },
            { state: headers['x-bypass-test'] === 'worker-rule' ? 'pass' : 'fail', label: 'headers_custom sent x-bypass-test', detail: headers['x-bypass-test'] || 'missing', effect: headers['x-bypass-test'] === 'worker-rule' },
            { state: /google/i.test(headers.referer || '') ? 'pass' : 'fail', label: 'referer sent a Google referer', detail: headers.referer || 'missing', effect: /google/i.test(headers.referer || '') },
          ],
        };
      }

      async function runSuite() {
        let report;
        try {
          const response = await fetch('/test/rule.json', { cache: 'no-store' });
          if (!response.ok) throw new Error('rule endpoint returned HTTP ' + response.status);
          report = await response.json();
          renderRuleReport(report);
        } catch (error) {
          const reason = 'Unable to read the Worker test rule: ' + error.message;
          for (const caseId of ['dom', 'network', 'content', 'headers']) renderCase(caseId, 'fail', [failCheck('Worker test rule endpoint', reason)]);
          setOverall('fail', 'FAIL · Worker test setup unavailable', reason);
          return;
        }

        if (report.aggregate_error) {
          const reason = 'Aggregated rules are invalid: ' + report.aggregate_error;
          for (const caseId of ['dom', 'network', 'content', 'headers']) renderCase(caseId, 'fail', [failCheck('aggregate rule JSON', reason)]);
          setOverall('fail', 'FAIL · aggregate is invalid', reason);
          return;
        }

        const rule = report.rule || {};
        const ruleErrors = [];
        if (rule.domain !== '${TEST_RULE_DOMAIN}') ruleErrors.push('domain');
        if (rule.allow_cookies !== 1) ruleErrors.push('allow_cookies');
        if (rule.block_regex !== '/test/assets/blocked-script.js') ruleErrors.push('block_regex');
        if (rule.useragent !== 'googlebot') ruleErrors.push('useragent');
        if (rule.referer !== 'google') ruleErrors.push('referer');
        if (rule.headers_custom?.['x-bypass-test'] !== 'worker-rule') ruleErrors.push('headers_custom');
        if (rule.cs_dompurify !== 1 || !Array.isArray(rule.cs_code)) ruleErrors.push('cs_code');
        if (rule.add_ext_link !== '#test-link-paywall|#test-link-content' || rule.add_ext_link_type !== 'google_search_tool') ruleErrors.push('add_ext_link');
        if (rule.ld_json !== '#test-jsonld-paywall|#test-jsonld-content') ruleErrors.push('ld_json');
        if (!Array.isArray(rule.remove_cookies_select_drop) || !rule.remove_cookies_select_drop.includes('bypass_manifest_test')) ruleErrors.push('remove_cookies_select_drop');
        if (ruleErrors.length) {
          const reason = 'Worker test rule does not match the fixture contract: ' + ruleErrors.join(', ');
          for (const caseId of ['dom', 'network', 'content', 'headers']) renderCase(caseId, 'fail', [failCheck('fixture rule contract', reason)]);
          setOverall('fail', 'FAIL · fixture rule mismatch', reason);
          return;
        }

        if (!report.injected_into_aggregate) {
          neutralize({
            dom: [neutralCheck('DOM cleanup', 'test rule is not in the aggregate')],
            network: [neutralCheck('request blocking', 'test rule is not in the aggregate')],
            content: [neutralCheck('content and link selectors', 'test rule is not in the aggregate')],
            headers: [neutralCheck('request headers', 'test rule is not in the aggregate')],
          }, 'Rule is not in the aggregate yet. Run /initiate-update once, then refresh this page.');
          return;
        }

        let observations;
        try {
          // background.js schedules custom DOM work one second after Safari
          // reports the page. Give that work time to settle, then retry once
          // more for devices where tabs.onUpdated arrives late.
          await new Promise(resolve => setTimeout(resolve, 1500));
          for (let attempt = 0; attempt < 6; attempt++) {
            observations = await collectObservations();
            if (hasExtensionEffect(observations)) {
              await new Promise(resolve => setTimeout(resolve, 400));
              observations = await collectObservations();
              break;
            }
            if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          setOverall('fail', 'FAIL · fixture checks could not run', error.message);
          return;
        }

        if (!hasExtensionEffect(observations)) {
          neutralize(observations, 'No extension change detected. Enable the extension and refresh this page.');
          return;
        }

        let failures = 0;
        for (const [caseId, checks] of Object.entries(observations)) {
          const cleanChecks = stripEffectFlag(checks);
          const caseState = cleanChecks.some(check => check.state === 'fail') ? 'fail' : 'pass';
          failures += caseState === 'fail' ? 1 : 0;
          renderCase(caseId, caseState, cleanChecks);
        }
        setOverall(failures ? 'fail' : 'pass', failures ? 'FAIL · some checks failed' : 'PASS · all active checks passed', failures ? failures + ' case(s) need attention.' : 'The Worker rule is present and the extension applied it successfully.');
      }

      window.addEventListener('load', () => setTimeout(runSuite, 100));
    </script>
  </body>
</html>`);
}

export function getTestRoute(pathname) {
  if (pathname === '/test' || pathname === '/test/') return renderSuite();
  if (pathname === '/test/assets/blocked-script.js') {
    return {
      body: 'window.__bypassTestBlockedScriptExecuted = true; document.querySelector("#network-status")?.replaceChildren("The blocked script executed.");',
      contentType: 'application/javascript; charset=utf-8',
    };
  }
  return null;
}

export { NO_STORE };
