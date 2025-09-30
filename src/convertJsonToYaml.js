
import yaml from 'js-yaml';

export function convertJsonToYaml(aggregatedJson, version = null) {
    console.log('Converting aggregated JSON to YAML...');
    const jsonData = JSON.parse(aggregatedJson);

    // Generate YAML with version header comments
    let versionHeader = '# Bypass \u00B7 Aggregated Ruleset\n';  // unicode middle dot
    versionHeader += `# generated: ${new Date().toISOString()}\n`;

    if (version) {
        versionHeader += `# version: ${version}\n`;
    }
    versionHeader += '# source: https://bypass.andrewe.dev\n';
    versionHeader += '\n';

    const yamlData = yaml.dump(jsonData);
    return versionHeader + yamlData;
}
