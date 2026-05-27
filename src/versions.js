export function getHighestVersion(versions) {
  const validVersions = versions.filter(value => typeof value === 'string' && value.trim());
  if (validVersions.length === 0) return null;
  if (validVersions.length === 1) return validVersions[0];

  return [...validVersions].sort(compareVersionsDescending)[0];
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

export function getHighestUpdVersion(rules) {
  return getHighestVersion(
    Object.values(rules)
      .filter(value => value && typeof value === 'object' && typeof value.upd_version === 'string')
      .map(value => value.upd_version)
  );
}
