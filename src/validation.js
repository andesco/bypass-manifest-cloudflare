export function parseJsonObject(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must be a JSON object`);
  }

  if (parsed.error) {
    throw new Error(`${label} contains conversion error: ${parsed.message || parsed.error}`);
  }

  return parsed;
}

export function parseJsonArray(text, label) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array`);
  }

  return parsed;
}

export function validateRulesObject(rules, label) {
  for (const [key, value] of Object.entries(rules)) {
    if (!value || Array.isArray(value) || typeof value !== 'object') {
      throw new Error(`${label}.${key} must be an object`);
    }

    if ('domain' in value && typeof value.domain !== 'string') {
      throw new Error(`${label}.${key}.domain must be a string`);
    }

    if ('group' in value) {
      const validGroup = Array.isArray(value.group) || typeof value.group === 'string';
      if (!validGroup) {
        throw new Error(`${label}.${key}.group must be a string or array`);
      }
    }
  }

  return rules;
}

export function validateRulesJson(text, label) {
  return validateRulesObject(parseJsonObject(text, label), label);
}

export function validateAggregatedJson(text) {
  const rules = parseJsonArray(text, 'sites_aggregated.json');
  for (const [index, rule] of rules.entries()) {
    if (!rule || Array.isArray(rule) || typeof rule !== 'object') {
      throw new Error(`sites_aggregated.json[${index}] must be an object`);
    }
    if (typeof rule.domain !== 'string' || !rule.domain) {
      throw new Error(`sites_aggregated.json[${index}].domain must be a non-empty string`);
    }
  }
  return rules;
}
