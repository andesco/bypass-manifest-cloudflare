import { parse } from 'acorn';

const REGEX_FIELD_PATTERN = /regex/;

function shouldEmitRegexLiteral(key, value) {
  if (!key || typeof key !== 'string') return false;
  if (!REGEX_FIELD_PATTERN.test(key)) return false;
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('{domain}')) return false;
  return true;
}

function escapeRegexPattern(pattern) {
  let result = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch !== '/') {
      result += ch;
      continue;
    }

    // Only escape if the slash is not already escaped by an odd number of backslashes.
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && pattern[j] === '\\'; j--) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      result += '\\/';
    } else {
      result += '/';
    }
  }
  return result;
}

function isValidIdentifier(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function serializeKey(key) {
  if (isValidIdentifier(key)) return key;
  return JSON.stringify(key);
}

function serializeValue(value, key, indentLevel) {
  const indent = '  '.repeat(indentLevel);
  const nextIndent = '  '.repeat(indentLevel + 1);

  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value === 'string') {
    if (shouldEmitRegexLiteral(key, value)) {
      return `/${escapeRegexPattern(value)}/`;
    }
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map(item => `${nextIndent}${serializeValue(item, null, indentLevel + 1)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(([k, v]) => `${nextIndent}${serializeKey(k)}: ${serializeValue(v, k, indentLevel + 1)}`);
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }

  return JSON.stringify(value);
}

function serializeSitesObject(sitesObject) {
  return serializeValue(sitesObject, null, 0);
}

function replaceDefaultSitesObject(template, objectString) {
  try {
    const ast = parse(template, { ecmaVersion: 2020, sourceType: 'script' });
    for (const node of ast.body) {
      if (node.type !== 'VariableDeclaration') continue;
      for (const declarator of node.declarations) {
        if (declarator.id && declarator.id.name === 'defaultSites' && declarator.init) {
          const start = declarator.init.start;
          const end = declarator.init.end;
          if (typeof start === 'number' && typeof end === 'number') {
            return template.slice(0, start) + objectString + template.slice(end);
          }
        }
      }
    }
  } catch (error) {
    // Fall back to string scanning
  }

  const marker = 'var defaultSites =';
  const markerIndex = template.indexOf(marker);
  if (markerIndex === -1) {
    return `${marker} ${objectString};\n`;
  }

  const openBraceIndex = template.indexOf('{', markerIndex);
  if (openBraceIndex === -1) {
    return `${marker} ${objectString};\n` + template;
  }

  let depth = 0;
  let closeBraceIndex = -1;
  for (let i = openBraceIndex; i < template.length; i++) {
    const ch = template[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) {
      closeBraceIndex = i;
      break;
    }
  }

  if (closeBraceIndex === -1) {
    return `${marker} ${objectString};\n` + template;
  }

  const before = template.slice(0, markerIndex);
  let after = template.slice(closeBraceIndex + 1);
  if (after.startsWith(';')) {
    after = after.slice(1);
  }

  return `${before}${marker} ${objectString};${after}`;
}

export function generateAggregatedJs(aggregatedSitesObject, sitesJsTemplate = null) {
  const objectString = serializeSitesObject(aggregatedSitesObject);

  if (!sitesJsTemplate) {
    return `var defaultSites = ${objectString};\n`;
  }

  return replaceDefaultSitesObject(sitesJsTemplate, objectString);
}
