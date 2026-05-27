import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';
import { generateAggregatedArrayFromSources, mergeRulesByPrecedence, splitGroup } from '../src/aggregation.js';

const localDir = path.join(process.cwd(), 'local');

function loadFile(fileName) {
    const filePath = path.join(localDir, fileName);
    if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
    }
    console.error(`Error: ${fileName} not found in local directory.`);
    return null;
}

function simulateAggregation() {
    // Load source files individually to replicate generateAggregatedJson.js logic
    const sites = JSON.parse((loadFile('sites_latest.json') || loadFile('sites.json')) || '{}');
    const sitesUpdated = JSON.parse(loadFile('sites_updated.json') || '{}');
    const sitesCustom = JSON.parse(loadFile('sites_custom.json') || '{}');

    // 1. Load and merge rules with precedence: Custom > Updated > Base
    const allRules = mergeRulesByPrecedence([sites, sitesUpdated, sitesCustom]);

    // Count total input domains from merged rules (accounting for precedence)
    let totalInputDomains = 0;
    for (const key in allRules) {
        const rule = allRules[key];
        if (rule.group) {
            const domains = splitGroup(rule.group);
            totalInputDomains += domains.length;
        } else if (rule.domain && rule.domain !== '###') {
            totalInputDomains++;
        }
    }

    // 2. Collect rule keys to delete
    const ruleKeysToDelete = new Set();
    if (allRules['###_remove_sites'] && allRules['###_remove_sites'].cs_code) {
        allRules['###_remove_sites'].cs_code.split(',').map(s => s.trim()).forEach(key => {
            if (key) ruleKeysToDelete.add(key);
        });
    }

    for (const key in allRules) {
        const rule = allRules[key];
        if ((rule.domain === '###' && key === '###_remove_sites') || rule.domain === '' || rule.delete) {
            ruleKeysToDelete.add(key);
        }
        // Group deletion marker
        if (rule.domain && rule.domain.startsWith('###_') && !rule.group) {
            for (const k in allRules) {
                if (allRules[k].domain === rule.domain && allRules[k].group) {
                    ruleKeysToDelete.add(k);
                    break;
                }
            }
        }
    }

    // 3. Collect domains to delete from the groups marked for deletion
    const domainsToDelete = new Set();
    ruleKeysToDelete.forEach(key => {
        const rule = allRules[key];
        if (rule && rule.group) {
            const domains = splitGroup(rule.group);
            domains.forEach(d => domainsToDelete.add(d.trim()));
        }
        domainsToDelete.add(key);
    });

    // Count domains that will be deleted
    let deletedDomains = 0;
    ruleKeysToDelete.forEach(key => {
        const rule = allRules[key];
        if (rule && rule.group) {
            const domains = splitGroup(rule.group);
            domains.forEach(d => {
                if (d.trim()) deletedDomains++;
            });
        } else if (rule && rule.domain && rule.domain !== '###') {
            deletedDomains++;
        }
    });

    // 4. Count final domains after expansion and filtering
    let finalDomains = 0;
    const processedDomains = new Set();

    for (const key in allRules) {
        if (ruleKeysToDelete.has(key)) continue;

        const rule = allRules[key];
        if (domainsToDelete.has(rule.domain)) continue;

        if (rule.group) {
            const domains = splitGroup(rule.group);
            domains.forEach(domainStr => {
                const domain = domainStr.trim();
                if (!domain || domainsToDelete.has(domain) || processedDomains.has(domain)) return;

                processedDomains.add(domain);
                finalDomains++;
            });

            // Add group domain itself if valid
            if (rule.domain && !rule.domain.startsWith('###_') && !domainsToDelete.has(rule.domain) && !processedDomains.has(rule.domain)) {
                processedDomains.add(rule.domain);
                finalDomains++;
            }
        } else {
            // Include settings/metadata rules (domain: "###" or starts with "#options_")
            if (rule.domain && !processedDomains.has(rule.domain)) {
                processedDomains.add(rule.domain);
                finalDomains++;
            }
        }
    }

    return {
        totalInputDomains,
        deletedDomains,
        finalDomains
    };
}

async function getStats() {
    const baseFile = loadFile('sites_latest.json') ? 'sites_latest.json' : 'sites.json';
    const sourceFiles = [baseFile, 'sites_updated.json', 'sites_custom.json'];
    const aggregatedFiles = ['sites_aggregated.json', 'sites_aggregated.yaml'];

    // First rebuild the aggregated files
    console.log('Building latest aggregated rulesets...');
    const { generateAggregatedJson } = await import('../src/generateAggregatedJson.js');
    const { convertJsonToYaml } = await import('../src/convertJsonToYaml.js');

    const sites = loadFile(baseFile);
    const sitesUpdated = loadFile('sites_updated.json');
    const sitesCustom = loadFile('sites_custom.json');

    if (!sites || !sitesUpdated || !sitesCustom) {
        console.error('Missing source files');
        return;
    }

    const aggregatedJson = generateAggregatedJson(sites, sitesUpdated, sitesCustom);
    const aggregatedYaml = convertJsonToYaml(aggregatedJson);

    // Save to local folder
    const fs = await import('fs');
    const path = await import('path');
    const localDir = path.join(process.cwd(), 'local');

    fs.writeFileSync(path.join(localDir, 'sites_aggregated.json'), aggregatedJson);
    fs.writeFileSync(path.join(localDir, 'sites_aggregated.yaml'), aggregatedYaml);
    console.log('Aggregated files updated in /local folder\n');

    const allRules = mergeRulesByPrecedence([JSON.parse(sites), JSON.parse(sitesUpdated), JSON.parse(sitesCustom)]);

    let totalStats = {
        singleDomains: 0,
        groupDomains: 0,
        totalDomains: 0,
        singleDomainDeletions: 0,
        groupDomainDeletions: 0,
        totalDeletedDomains: 0,
    };

    for (const fileName of sourceFiles) {
        const rules = JSON.parse(loadFile(fileName) || '{}');
        if (!rules) continue;

        let stats = {
            singleDomains: 0,
            groupDomains: 0,
            totalDomains: 0,
            singleDomainDeletions: 0,
            groupDomainDeletions: 0,
            totalDeletedDomains: 0,
        };

        for (const key in rules) {
            const rule = rules[key];

            if (rule.domain === '###' && key !== '###_remove_sites') continue;

            if (rule.delete || rule.domain === '') {
                stats.singleDomainDeletions++;
                stats.totalDeletedDomains++;
            } else if (rule.domain && rule.domain.startsWith('###_') && !rule.group) {
                const groupDef = Object.values(allRules).find(r => r.domain === rule.domain && r.group);
                if (groupDef) {
                    const domains = splitGroup(groupDef.group);
                    stats.groupDomainDeletions++;
                    stats.totalDeletedDomains += domains.length;
                }
            } else if (key === '###_remove_sites' && rule.cs_code) {
                const deletions = rule.cs_code.split(',').map(s => s.trim());
                deletions.forEach(item => {
                    const itemLower = item.toLowerCase();
                    const matchingKey = Object.keys(allRules).find(k => k.toLowerCase() === itemLower);
                    const matchedRule = matchingKey ? allRules[matchingKey] : null;

                    if (matchedRule && matchedRule.group) {
                        const groupDomains = splitGroup(matchedRule.group);
                        stats.groupDomainDeletions++;
                        stats.totalDeletedDomains += groupDomains.length;
                    } else {
                        stats.singleDomainDeletions++;
                        stats.totalDeletedDomains++;
                    }
                });
            } else if (rule.group) {
                const domains = splitGroup(rule.group);
                stats.groupDomains += domains.length;
                stats.totalDomains += domains.length;
            } else {
                if (rule.domain && !rule.domain.startsWith('###') && !rule.domain.startsWith('#options_')) {
                    stats.singleDomains++;
                    stats.totalDomains++;
                }
            }
        }

        console.log(`--- Stats for ${fileName} ---`);
        console.log(`  Single domains: ${chalk.hex('#FFA500')(stats.singleDomains)}`);
        console.log(`  Group domains: ${chalk.hex('#FFA500')(stats.groupDomains)}`);
        console.log(`  Total domains: ${chalk.hex('#FFA500')(stats.totalDomains)}`);
        console.log(`  Single domain deletions: ${chalk.hex('#FFA500')(stats.singleDomainDeletions)}`);
        console.log(`  Group domain deletions: ${chalk.hex('#FFA500')(stats.groupDomainDeletions)} (affecting ${chalk.hex('#FFA500')(stats.totalDeletedDomains - stats.singleDomainDeletions)} domains)`);
        console.log(`  Total deleted domains: ${chalk.hex('#FFA500')(stats.totalDeletedDomains)}`);
        console.log('\n');

        for (const key in stats) {
            totalStats[key] += stats[key];
        }
    }

    console.log(`--- Total Stats for Source Files ---`);
    console.log(`  Single domains: ${chalk.hex('#FFA500')(totalStats.singleDomains)}`);
    console.log(`  Group domains: ${chalk.hex('#FFA500')(totalStats.groupDomains)}`);
    console.log(`  Total domains: ${chalk.hex('#FFA500')(totalStats.totalDomains)}`);
    console.log(`  Single domain deletions: ${chalk.hex('#FFA500')(totalStats.singleDomainDeletions)}`);
    console.log(`  Group domain deletions: ${chalk.hex('#FFA500')(totalStats.groupDomainDeletions)} (affecting ${chalk.hex('#FFA500')(totalStats.totalDeletedDomains - totalStats.singleDomainDeletions)} domains)`);
    console.log(`  Total deleted domains: ${chalk.hex('#FFA500')(totalStats.totalDeletedDomains)}`);
    console.log('\n');

    const actualFinal = JSON.parse(loadFile('sites_aggregated.json') || '[]').length;
    const simulated = simulateAggregation();
    const mergedRuleCount = Object.keys(allRules).length;
    const rawSourceCount = sourceFiles.reduce((count, fileName) => {
        const rules = JSON.parse(loadFile(fileName) || '{}');
        return count + Object.keys(rules).length;
    }, 0);
    const duplicateRuleCount = rawSourceCount - mergedRuleCount;

    console.log(`--- How Domain Numbers Balance ---`);
    console.log(`  Source domains after per-file counting: ${chalk.hex('#FFA500')(totalStats.totalDomains)}`);
    console.log(`  Raw source rules: ${chalk.hex('#FFA500')(rawSourceCount)}`);
    console.log(`  Duplicate rule keys removed by precedence: ${chalk.hex('#FFA500')(duplicateRuleCount)}`);
    console.log(`  Merged rule keys: ${chalk.hex('#FFA500')(mergedRuleCount)}`);
    console.log(`  Domains marked for deletion: ${chalk.hex('#FFA500')(simulated.deletedDomains)}`);
    console.log(`  Final simulated domains: ${chalk.hex('#FFA500')(simulated.finalDomains)}`);
    console.log(`  Final aggregated rules: ${chalk.hex('#FFA500')(actualFinal)}`);
    console.log('\n');

    for (const fileName of aggregatedFiles) {
        const fileContent = loadFile(fileName);
        if (!fileContent) continue;

        let rules;
        if (fileName.endsWith('.yaml')) {
            rules = yaml.load(fileContent);
        } else {
            rules = JSON.parse(fileContent);
        }

        console.log(`--- Stats for ${fileName} ---`);
        console.log(`  Total rules: ${chalk.hex('#FFA500')(rules.length)}`);
        console.log('\n');
    }
}

getStats().catch(console.error);
