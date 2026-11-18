function toRulesObject(source, label) {
  if (!source) return {};
  if (typeof source === 'string') {
    const parsed = JSON.parse(source);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`${label} must parse to a JSON object`);
    }
    return parsed;
  }
  if (Array.isArray(source) || typeof source !== 'object') {
    throw new Error(`${label} must be an object or JSON object string`);
  }
  return source;
}

export function mergeRulesByPrecedence(sources) {
  return sources.reduce((merged, source, index) => ({
    ...merged,
    ...toRulesObject(source, `source[${index}]`),
  }), {});
}

export function collectDeletionState(allRules) {
  const ruleKeysToDelete = new Set();

  if (allRules['###_remove_sites']?.cs_code) {
    allRules['###_remove_sites'].cs_code
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .forEach(key => ruleKeysToDelete.add(key));
  }

  for (const [key, rule] of Object.entries(allRules)) {
    if (!rule || typeof rule !== 'object') continue;

    if ((rule.domain === '###' && key === '###_remove_sites') || rule.domain === '' || rule.delete) {
      ruleKeysToDelete.add(key);
    }

    if (typeof rule.domain === 'string' && rule.domain.startsWith('###_') && !rule.group) {
      const groupKey = Object.keys(allRules).find(candidateKey => {
        const candidate = allRules[candidateKey];
        return candidate?.domain === rule.domain && candidate.group;
      });
      if (groupKey) ruleKeysToDelete.add(groupKey);
    }
  }

  const domainsToDelete = new Set();
  for (const key of ruleKeysToDelete) {
    const rule = allRules[key];
    if (rule?.group) {
      splitGroup(rule.group).forEach(domain => domainsToDelete.add(domain));
    }
    if (rule?.delete && rule.domain) {
      domainsToDelete.add(rule.domain);
    }
    domainsToDelete.add(key);
  }

  return { ruleKeysToDelete, domainsToDelete };
}

const REGEX_PLACEHOLDER_FIELDS = [
  'block_regex',
  'block_regex_general',
  'block_js_inline',
  'headers_filter',
];

function isConcreteDomain(domain) {
  return Boolean(
    typeof domain === 'string' &&
    domain &&
    !isMetadataDomain(domain) &&
    !domain.startsWith('group_')
  );
}

function interpolateDomainPlaceholders(rule) {
  if (!isConcreteDomain(rule.domain)) return rule;
  const escapedDomain = rule.domain.replace(/\./g, '\\.');

  for (const field of REGEX_PLACEHOLDER_FIELDS) {
    const value = rule[field];
    if (typeof value === 'string' && value.includes('{domain}')) {
      rule[field] = value.replace(/\{domain\}/g, escapedDomain);
    } else if (Array.isArray(value)) {
      rule[field] = value.map(item =>
        typeof item === 'string' && item.includes('{domain}')
          ? item.replace(/\{domain\}/g, escapedDomain)
          : item
      );
    }
  }

  return rule;
}

function normalizeCsCode(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch {
    // Keep original string if not valid JSON
  }
  return value;
}

function normalizeCookieSelectList(value) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  return value;
}

function finalizeAggregatedRule(rawRule, domainOverride = null) {
  const finalized = domainOverride ? { ...rawRule, domain: domainOverride } : { ...rawRule };
  delete finalized.group;
  delete finalized.exception;

  if ('cs_code' in finalized) {
    finalized.cs_code = normalizeCsCode(finalized.cs_code);
  }
  if ('remove_cookies_select_drop' in finalized) {
    finalized.remove_cookies_select_drop = normalizeCookieSelectList(finalized.remove_cookies_select_drop);
  }
  if ('remove_cookies_select_hold' in finalized) {
    finalized.remove_cookies_select_hold = normalizeCookieSelectList(finalized.remove_cookies_select_hold);
  }

  return interpolateDomainPlaceholders(finalized);
}

function findMatchingException(exceptions, domain) {
  if (!Array.isArray(exceptions)) return null;
  return exceptions.find(ex => {
    if (!ex || typeof ex !== 'object') return false;
    if (ex.domain === domain) return true;
    if (Array.isArray(ex.domain)) return ex.domain.map(d => String(d).trim()).includes(domain);
    return false;
  }) || null;
}

function expandExceptionEntries(exceptions, domainsToDelete, finalRules) {
  if (!Array.isArray(exceptions)) return;
  for (const ex of exceptions) {
    if (!ex || typeof ex !== 'object' || !ex.domain) continue;
    for (const excDomain of splitGroup(ex.domain)) {
      if (!excDomain || domainsToDelete.has(excDomain) || isMetadataDomain(excDomain)) continue;
      finalRules[excDomain] = finalizeAggregatedRule(ex, excDomain);
    }
  }
}

export function generateAggregatedArrayFromSources(sources) {
  const allRules = mergeRulesByPrecedence(sources);
  const { ruleKeysToDelete, domainsToDelete } = collectDeletionState(allRules);
  const finalRules = {};

  for (const [key, rule] of Object.entries(allRules)) {
    if (ruleKeysToDelete.has(key) || !rule || typeof rule !== 'object') continue;
    if (domainsToDelete.has(rule.domain)) continue;

    if (rule.group) {
      for (const domain of splitGroup(rule.group)) {
        if (!domain || domainsToDelete.has(domain)) continue;
        if (isMetadataDomain(domain)) continue;

        const matchedException = findMatchingException(rule.exception, domain);
        finalRules[domain] = finalizeAggregatedRule(matchedException || rule, domain);
      }

      expandExceptionEntries(rule.exception, domainsToDelete, finalRules);

      if (rule.domain && !rule.domain.startsWith('###_') && !domainsToDelete.has(rule.domain) && !isMetadataDomain(rule.domain)) {
        const matchedSelfException = findMatchingException(rule.exception, rule.domain);
        finalRules[rule.domain] = finalizeAggregatedRule(matchedSelfException || rule, rule.domain);
      }
      continue;
    }

    if (rule.domain) {
      finalRules[rule.domain] = finalizeAggregatedRule(rule);
    }
    expandExceptionEntries(rule.exception, domainsToDelete, finalRules);
  }

  return Object.values(finalRules).filter(rule => !domainsToDelete.has(rule.domain));
}

export function generateAggregatedObjectFromSources(sources) {
  const allRules = mergeRulesByPrecedence(sources);
  const { ruleKeysToDelete, domainsToDelete } = collectDeletionState(allRules);
  const finalRules = {};

  for (const [key, rule] of Object.entries(allRules)) {
    if (ruleKeysToDelete.has(key) || !rule || typeof rule !== 'object') continue;
    if (domainsToDelete.has(rule.domain) || domainsToDelete.has(key)) continue;
    finalRules[key] = rule;
  }

  return finalRules;
}

export function splitGroup(group) {
  return (Array.isArray(group) ? group : String(group).split(','))
    .map(domain => domain.trim())
    .filter(Boolean);
}

export function isMetadataDomain(domain) {
  return typeof domain === 'string' && (domain.startsWith('###') || domain.startsWith('#options_'));
}
