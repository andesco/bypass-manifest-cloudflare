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

        const newRule = { ...rule, domain };
        delete newRule.group;
        finalRules[domain] = newRule;
      }

      if (rule.domain && !rule.domain.startsWith('###_') && !domainsToDelete.has(rule.domain) && !isMetadataDomain(rule.domain)) {
        const originalRule = { ...rule };
        delete originalRule.group;
        finalRules[originalRule.domain] = originalRule;
      }
      continue;
    }

    if (rule.domain) {
      finalRules[rule.domain] = rule;
    }
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
