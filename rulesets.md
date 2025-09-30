# Bypass Paywalls Clean: Ruleset Documentation

This document provides a technical overview of the different rulesets used by the Bypass Paywalls Clean Chrome extension to bypass paywalls. It details the purpose, structure, and hierarchy of each ruleset, and explains how they are loaded and applied by the extension.

## 1. Introduction to Rulesets

The extension's core logic revolves around a set of rules that define how to handle paywalls for specific websites. These rules are stored in multiple locations, allowing for a flexible system of default rules, updates, and user-defined customizations. The rulesets are processed and applied by the `background.js` script.

The primary rulesets are:

*   **Default Rules:** `sites.js`
*   **Updated Rules:** `sites_updated.json`
*   **Custom Rules:** `sites_custom.json`

## 2. Ruleset Details

### 2.1. Default Rules: `sites.js`

*   **Purpose:** \
	This file contains the base set of rules for all websites supported by the extension out of the box. It is bundled with the extension and is updated with each new release.
*   **Structure:** \
	The file contains a single JavaScript object named `defaultSites`. Each key in this object is the name of a website or a group of websites, and the value is an object containing the specific bypass rules for that site.

*   **Common Rule Properties:**
    *   `domain`: The domain name of the website. For grouped sites, this is a special identifier like `###_usa_gannett`.
    *   `group`: An array of domain names for sites that share the same rules.
    *   `allow_cookies`: If set to `1`, cookies are allowed for the site. Otherwise, they are blocked by default.
    *   `remove_cookies`: If set to `1`, cookies are removed after the page loads.
    *   `block_regex`: A regular expression that matches the URLs of scripts or other resources to be blocked.
    *   `useragent`: Specifies a predefined User-Agent to use (e.g., `googlebot`, `bingbot`).
    *   `useragent_custom`: A custom User-Agent string to use.
    *   `referer`: A predefined Referer to use (e.g., `google`, `facebook`).
    *   `cs_code`: A JSON string representing an array of operations for the content script to perform on the page (e.g., hiding elements, removing classes).
    *   `ld_json`: Specifies how to extract content from a JSON-LD script tag.

### 2.2. Updated Rules: `sites_updated.json`

*   **Purpose:** This file provides a mechanism for delivering updates to the rulesets between full extension releases. This allows for faster fixes and the addition of new sites without requiring users to wait for a new version of the extension to be published.
*   **Loading Mechanism:** The `check_sites_updated` function in `background.js` is responsible for fetching and processing this file. If the `optInUpdate` setting is enabled, the extension will periodically check for updates.
*   **Structure:** A JSON object with the same structure as `defaultSites` but also includes an `upd_version` property to indicate the version of the update.

### 2.3. Custom Rules: `sites_custom.json`

*   **Purpose:** This ruleset allows users to create their own bypass rules or override existing ones for any website. This is useful for unsupported sites or for tweaking the behavior of the bypass for a supported site.
*   **Structure:** A JSON object, similar to `defaultSites`.

## 3. Hierarchy and Precedence

The extension applies the rulesets in a specific order of precedence, ensuring that user customizations and timely updates take priority over the default rules. The hierarchy is as follows:

1.  **`sites_custom.json`** \
Custom rules have the highest precedence. If a custom rule exists for a site, it will always be used, overriding any rules from `sites_updated.json` or `sites.js`.
2.  **`sites_updated.json`** \
If a rule for a site exists in the updated rules, it will override a corresponding rule in `sites.js`.
3.  **`sites.js`** \
The default rules are the base rules that are used if no custom or updated rule is found for a given site.

## 4. Rule Application Logic

The `set_rules` function in `background.js` is the central point for processing and applying the rules.:

1.  **Initialization:** The function starts by clearing all existing rules.
2.  **Loading Rules:** It retrieves the enabled sites, custom rules (`sites_custom`), and updated rules (`sites_updated`) from local storage.
3.  **Iterating Through Enabled Sites:** The function iterates through the list of sites that the user has enabled in the options.
4.  **Rule Merging and Precedence:** For each enabled site, the `set_rules` function determines which rule to apply based on the precedence hierarchy:
    *   It first checks if a custom rule exists in `sites_custom`. If so, that rule is used.
    *   If no custom rule is found, it checks for a rule in `sites_updated`. If found, that rule is used.
    *   If neither a custom nor an updated rule is found, it falls back to the rule in `defaultSites`.
5.  **Applying Rules:** Once the appropriate rule has been selected, the `addRules` function is called to apply the specific bypass techniques defined in the rule (examples: setting up request blocking, header modifications).
