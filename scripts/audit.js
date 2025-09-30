
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';

const localDir = path.join(process.cwd(), 'local');

function formatObject(obj, indent = 0) {
    const indentStr = '  '.repeat(indent);
    if (typeof obj !== 'object' || obj === null) {
        return chalk.white(JSON.stringify(obj));
    }
    if (Array.isArray(obj)) {
        return chalk.white('[') + '\n' +
            obj.map(item => '  '.repeat(indent + 1) + formatObject(item, indent + 1)).join(',\n') + '\n' +
            indentStr + chalk.white(']');
    }
    const entries = Object.entries(obj);
    if (entries.length === 0) {
        return chalk.white('{}');
    }
    return chalk.white('{') + '\n' +
        entries.map(([key, value]) =>
            '  '.repeat(indent + 1) + chalk.grey(`"${key}"`) + chalk.white(': ') + formatObject(value, indent + 1)
        ).join(',\n') + '\n' +
        indentStr + chalk.white('}');
}

function loadJson(fileName) {
    const filePath = path.join(localDir, fileName);
    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(fileContent);
    }
    console.error(`Error: ${fileName} not found in local directory.`);
    return null;
}

function findRuleForDomain(domain, rules) {
    // Direct match
    if (rules[domain]) {
        return { key: domain, rule: rules[domain] };
    }
    // Match by rule.domain
    for (const key in rules) {
        if (rules[key].domain === domain) {
            return { key, rule: rules[key] };
        }
        // Group match
        if (rules[key].group) {
            const domains = Array.isArray(rules[key].group) ? rules[key].group : rules[key].group.split(',');
            if (domains.map(d => d.trim()).includes(domain)) {
                return { key, rule: rules[key] };
            }
        }
    }
    return null;
}

function printRule(label, result) {
    console.log(`--- ${label} ---`);
    if (result) {
        console.log(`Source Key: ${result.key}`);
        console.log(formatObject(result.rule));
    } else {
        console.log('Not found.');
    }
    console.log('\n');
}

function extractDomains(rules) {
    // Extract all individual domains covered by rules (single domains + domains in groups)
    const domains = new Set();
    for (const key in rules) {
        const rule = rules[key];
        // Add single domain rules (excluding settings/metadata)
        if (rule.domain && !rule.domain.startsWith('###') && !rule.domain.startsWith('#options_')) {
            domains.add(rule.domain);
        }
        // Add domains from group rules
        if (rule.group) {
            const groupDomains = Array.isArray(rule.group) ? rule.group : rule.group.split(',');
            groupDomains.forEach(d => domains.add(d.trim()));
        }
    }
    return Array.from(domains);
}

async function audit() {
    // First build the latest aggregated rulesets
    console.log('Building latest aggregated rulesets...');
    const { generateAggregatedJson } = await import('../src/generateAggregatedJson.js');
    const { convertJsonToYaml } = await import('../src/convertJsonToYaml.js');

    const sites = loadJson('sites.json');
    const sitesUpdated = loadJson('sites_updated.json');
    const sitesCustom = loadJson('sites_custom.json');

    if (!sites || !sitesUpdated || !sitesCustom) {
        console.error('Missing source files');
        return;
    }

    const aggregatedJson = generateAggregatedJson(JSON.stringify(sites), JSON.stringify(sitesUpdated), JSON.stringify(sitesCustom));
    const aggregatedYaml = convertJsonToYaml(aggregatedJson, '4.2.1.1');

    // Save to local folder
    const fs = await import('fs');
    const path = await import('path');
    const localDir = path.join(process.cwd(), 'local');

    fs.writeFileSync(path.join(localDir, 'sites_aggregated.json'), aggregatedJson);
    fs.writeFileSync(path.join(localDir, 'sites_aggregated.yaml'), aggregatedYaml);
    console.log('Aggregated files updated in /local folder');

    // Now audit individual domains by showing how their rules are defined across source files
    // and how they appear in the final aggregated output
    const aggregatedRules = JSON.parse(aggregatedJson);

    if (!aggregatedRules) {
        return;
    }

    // Get all domains that have rules in updated or custom files
    const updatedDomains = extractDomains(sitesUpdated);
    const customDomains = extractDomains(sitesCustom);
    const domainsToAudit = [...new Set([...updatedDomains, ...customDomains])];

    console.log(`Found ${domainsToAudit.length} domains to audit from updated/custom rules`);
    console.log('Starting domain audit...\n');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = () => new Promise(resolve => {
        rl.question('Press any key to continue, or CTRL+C to exit...', resolve);
    });

    console.log('Starting domain audit...');

    while (true) {
        const randomDomain = domainsToAudit[Math.floor(Math.random() * domainsToAudit.length)];

        console.clear();
        console.log(`========================================`);
        console.log(`Auditing Domain: ${chalk.hex('#FFA500')(randomDomain)}`);
        console.log(`========================================\n`);

        const baseResult = findRuleForDomain(randomDomain, sites);
        const updatedResult = findRuleForDomain(randomDomain, sitesUpdated);
        const customResult = findRuleForDomain(randomDomain, sitesCustom);
        const finalRule = aggregatedRules.find(r => r.domain === randomDomain);

        printRule('Base Rule', baseResult);
        printRule('Updated Rule', updatedResult);
        printRule('Custom Rule', customResult);

        console.log('--- Final Aggregated Rule ---');
        console.log(finalRule ? formatObject(finalRule) : 'Not found in aggregated file.');
        console.log('\n');

        await ask();
    }
}

audit();
