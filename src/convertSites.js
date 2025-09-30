import { convertSitesJsToJsonAST } from './astConverter.js';

// Helper function to convert sites.js content to JSON
export function convertSitesJsToJson(sitesJsContent) {
  try {
    console.log('Attempting AST-based conversion...');

    // Primary method: Use AST parser (Option 5)
    const astResult = convertSitesJsToJsonAST(sitesJsContent);

    // Check if AST conversion was successful
    const parsed = JSON.parse(astResult);
    if (!parsed.error) {
      console.log('AST conversion successful!');
      return astResult;
    }

    console.log('AST conversion failed, falling back to manual parsing...');

    // Fallback: Manual string parsing
    const match = sitesJsContent.match(/var\s+defaultSites\s*=\s*({[\s\S]*});/);
    if (!match || !match[1]) {
      console.error('Could not extract defaultSites object from sites.js');
      return astResult; // Return AST error details
    }

    return manualConversion(match[1]);
  } catch (error) {
    console.error('Error in convertSitesJsToJson:', error);
    return JSON.stringify({
      error: 'Complete conversion failure',
      message: error.message,
      stack: error.stack
    }, null, 2);
  }
}

// Manual fallback conversion
function manualConversion(objectString) {
  try {
    // Remove comments first
    objectString = objectString.replace(/\/\/[^\n]*$/gm, '');
    objectString = objectString.replace(/\/\*[\s\S]*?\*\//g, '');

    // Convert regex patterns to strings - this needs to be done carefully
    // Look for patterns like: property_name: /regex/flags
    objectString = objectString.replace(/(\w+)\s*:\s*(\/[^\/\n]+\/[gimuy]*)/g, (match, prop, regex) => {
      // Extract the regex pattern more carefully
      const regexParts = regex.match(/^\/(.+)\/([gimuy]*)$/);
      if (regexParts) {
        const pattern = regexParts[1];
        // Escape quotes for JSON parsing, but don't include regex delimiters
        const escapedPattern = pattern.replace(/"/g, '\\"');
        return `"${prop}": "${escapedPattern}"`;
      }
      return match;
    });

    // Handle special cases where regex spans multiple lines or has complex patterns
    // Look for incomplete regex patterns (like the ones causing errors)
    objectString = objectString.replace(/(\w+)\s*:\s*(\/[^\/\n]*$)/gm, (match, prop, incompleteRegex) => {
      // This handles cases where regex is cut off - treat as empty string
      return `"${prop}": ""`;
    });

    // Quote property names - handle names with special characters and spaces
    objectString = objectString.replace(/^(\s*)([a-zA-Z0-9_$\s*]+?)(\s*:)/gm, (match, indent, prop, colon) => {
      const trimmedProp = prop.trim();
      // Skip if already quoted
      if (trimmedProp.startsWith('"') || trimmedProp.startsWith("'")) {
        return match;
      }
      // Quote the property name, escaping any quotes inside
      const quotedProp = `"${trimmedProp.replace(/"/g, '\\"')}"`;
      return `${indent}${quotedProp}${colon}`;
    });

    // Handle arrays - parse them more carefully
    objectString = objectString.replace(/:\s*\[([^\]]*)\]/g, (match, arrayContent) => {
      if (!arrayContent.trim()) return ': []';

      const items = [];
      let current = '';
      let inQuotes = false;
      let quoteChar = '';
      let depth = 0;

      for (let i = 0; i < arrayContent.length; i++) {
        const char = arrayContent[i];

        if (char === '"' || char === "'") {
          if (!inQuotes) {
            inQuotes = true;
            quoteChar = char;
            current += '"'; // Normalize to double quotes
          } else if (char === quoteChar) {
            inQuotes = false;
            current += '"';
          } else {
            current += char;
          }
        } else if (char === ',' && !inQuotes && depth === 0) {
          const item = current.trim();
          if (item) {
            if (!item.startsWith('"') && !item.startsWith("'") &&
                item !== 'true' && item !== 'false' && isNaN(Number(item))) {
              items.push(`"${item}"`);
            } else {
              items.push(item.replace(/'/g, '"'));
            }
          }
          current = '';
        } else {
          if (char === '[' || char === '{') depth++;
          if (char === ']' || char === '}') depth--;
          current += char;
        }
      }

      // Handle the last item
      const lastItem = current.trim();
      if (lastItem) {
        if (!lastItem.startsWith('"') && !lastItem.startsWith("'") &&
            lastItem !== 'true' && lastItem !== 'false' && isNaN(Number(lastItem))) {
          items.push(`"${lastItem}"`);
        } else {
          items.push(lastItem.replace(/'/g, '"'));
        }
      }

      return `: [${items.join(', ')}]`;
    });

    // Convert remaining single quotes to double quotes (but be careful not to break strings)
    objectString = objectString.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

    // Fix numeric values that got quoted
    objectString = objectString.replace(/:\s*"(\d+)"/g, ': $1');

    // Remove trailing commas
    objectString = objectString.replace(/,(\s*[}\]])/g, '$1');

    // Ensure we have proper object structure
    if (!objectString.trim().startsWith('{')) {
      objectString = '{' + objectString + '}';
    }

    // Try to parse the result
    const parsed = JSON.parse(objectString);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    console.error('Manual conversion failed:', e);
    console.error('Error at position:', e.message);
    console.error('Problematic section:', objectString.substring(Math.max(0, (e.lineNumber || 1) * 100 - 200), (e.lineNumber || 1) * 100 + 200));

    // Return a minimal structure on failure
    return '{"error": "Failed to parse sites.js", "raw_error": "' + e.message.replace(/"/g, '\\"') + '"}';
  }
}