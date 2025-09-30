export function generateAggregatedJson(sites, sites_updated, sites_custom) {
    console.log('Starting aggregation...');

    // 1. Load and merge rules with precedence: Custom > Updated > Base
    let allRules = { ...JSON.parse(sites), ...JSON.parse(sites_updated), ...JSON.parse(sites_custom) };

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
        // Group deletion marker (domain like ###_groupname without a group array)
        if (rule.domain && rule.domain.startsWith('###_') && !rule.group) {
            // Find the group definition and mark it for deletion
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
            const domains = Array.isArray(rule.group) ? rule.group : rule.group.split(',');
            domains.forEach(d => domainsToDelete.add(d.trim()));
        }
        // Also consider the key itself might be a domain
        domainsToDelete.add(key);
    });

    // 4. Expand groups and filter rules
    const finalRules = {};
    for (const key in allRules) {
        if (ruleKeysToDelete.has(key)) continue;

        const rule = allRules[key];
        if (domainsToDelete.has(rule.domain)) continue;

        if (rule.group) {
            const domains = Array.isArray(rule.group) ? rule.group : rule.group.split(',');
            domains.forEach(domainStr => {
                const domain = domainStr.trim();
                if (!domain || domainsToDelete.has(domain)) return;

                const newRule = { ...rule };
                delete newRule.group;
                newRule.domain = domain;
                if (domain && !domain.startsWith('###') && !domain.startsWith('#options_')) {
                    finalRules[domain] = newRule;
                }
            });

            if (rule.domain && !rule.domain.startsWith('###_')) {
                const originalRule = { ...rule };
                delete originalRule.group;
                if (originalRule.domain && !originalRule.domain.startsWith('###') && !originalRule.domain.startsWith('#options_') && !domainsToDelete.has(originalRule.domain)) {
                    finalRules[originalRule.domain] = originalRule;
                }
            }
        } else {
            // Include settings/metadata rules (domain: "###" or starts with "#options_")
            if (rule.domain) {
                finalRules[rule.domain] = rule;
            }
        }
    }

    // 5. Convert to array and perform final filtering
    const aggregatedArray = Object.values(finalRules).filter(rule => !domainsToDelete.has(rule.domain));

    return JSON.stringify(aggregatedArray, null, 2);
}