import { XMLParser } from 'fast-xml-parser';

export function parseFirefoxUpdatesJson(updatesJsonContent) {
  const updates = Object.values(updatesJsonContent.addons || {})
    .flatMap(addon => Array.isArray(addon?.updates) ? addon.updates : [])
    .filter(update => update && update.version && update.update_link);

  if (updates.length === 0) {
    throw new Error('updates.json does not contain any updates with version and update_link');
  }

  updates.sort((a, b) => compareVersionsDescending(a.version, b.version));
  return {
    version: updates[0].version,
    url: updates[0].update_link,
  };
}

export function parseChromeUpdatesXml(xmlText) {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  }).parse(xmlText);
  const updateCheck = findFirstElement(parsed, 'updatecheck');

  if (!updateCheck) {
    throw new Error('updates.xml does not contain an updatecheck element');
  }

  const codebase = updateCheck.codebase;
  const version = updateCheck.version;

  if (!codebase || !version) {
    throw new Error('updates.xml updatecheck element must contain codebase and version attributes');
  }

  return { version, url: codebase };
}

function findFirstElement(value, name) {
  if (!value || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, name)) {
    return Array.isArray(value[name]) ? value[name][0] : value[name];
  }
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findFirstElement(item, name);
        if (found) return found;
      }
    } else {
      const found = findFirstElement(child, name);
      if (found) return found;
    }
  }
  return null;
}

function compareVersionsDescending(a, b) {
  const aParts = a.split('.').map(toVersionPart);
  const bParts = b.split('.').map(toVersionPart);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const aPart = aParts[i] || 0;
    const bPart = bParts[i] || 0;
    if (aPart !== bPart) return bPart - aPart;
  }

  return 0;
}

function toVersionPart(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
