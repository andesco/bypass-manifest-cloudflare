export const TEST_RULE_DOMAIN = 'bypass.example.com';
export const TEST_RULE_TITLE = 'Bypass Manifest test harness';

// This rule is intentionally scoped to the Worker host. It gives the browser
// fixtures a stable way to exercise the most common rule mechanisms without
// changing any mirrored upstream source file.
export const WORKER_TEST_RULES = {
  [TEST_RULE_TITLE]: {
    domain: TEST_RULE_DOMAIN,
    allow_cookies: 1,
    // Keep this pattern simple enough for Safari's DNR adapter to lower it to
    // a urlFilter; Safari rejects rules that remain regexFilter rules.
    block_regex: '/test/assets/blocked-script.js',
    useragent: 'googlebot',
    referer: 'google',
    headers_custom: {
      'x-bypass-test': 'worker-rule',
    },
    cs_dompurify: 1,
    cs_code: [
      { cond: '#test-dom-remove', rm_elem: 1 },
      { hide_elem: '#test-dom-hide' },
      { cond: '#test-dom-style', rm_attrib: 'style' },
      { cond: '#test-dom-class', rm_class: 'test-paywall' },
    ],
    add_ext_link: '#test-link-paywall|#test-link-content',
    add_ext_link_type: 'google_search_tool',
    ld_json: '#test-jsonld-paywall|#test-jsonld-content',
    remove_cookies_select_drop: ['bypass_manifest_test'],
  },
};

export function getWorkerTestRule(rules = WORKER_TEST_RULES) {
  return rules[TEST_RULE_TITLE] || null;
}
