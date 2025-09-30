import { parse } from 'acorn';

// AST-based JavaScript to JSON converter using Acorn parser
export function convertSitesJsToJsonAST(sitesJsContent) {
  try {
    console.log('Starting AST-based conversion...');

    // Parse the JavaScript using Acorn
    const ast = parse(sitesJsContent, {
      ecmaVersion: 2020,
      sourceType: 'script'
    });

    // Find the variable declaration for defaultSites
    const defaultSitesDeclaration = findDefaultSitesDeclaration(ast);

    if (!defaultSitesDeclaration) {
      throw new Error('Could not find defaultSites variable declaration');
    }

    // Convert the AST node to a JSON-serializable object
    const jsonObject = astNodeToJson(defaultSitesDeclaration.init);

    // Return formatted JSON
    return JSON.stringify(jsonObject, null, 2);

  } catch (error) {
    console.error('AST conversion failed:', error);
    // Return error information for debugging
    return JSON.stringify({
      error: 'AST conversion failed',
      message: error.message,
      stack: error.stack
    }, null, 2);
  }
}

// Find the defaultSites variable declaration in the AST
function findDefaultSitesDeclaration(ast) {
  for (const node of ast.body) {
    if (node.type === 'VariableDeclaration') {
      for (const declarator of node.declarations) {
        if (declarator.id && declarator.id.name === 'defaultSites') {
          return declarator;
        }
      }
    }
  }
  return null;
}

// Convert AST nodes to JSON-serializable values
function astNodeToJson(node) {
  if (!node) return null;

  switch (node.type) {
    case 'ObjectExpression':
      const obj = {};
      for (const property of node.properties) {
        if (property.type === 'Property') {
          const key = getPropertyKey(property.key);
          const value = astNodeToJson(property.value);
          obj[key] = value;
        }
      }
      return obj;

    case 'ArrayExpression':
      return node.elements.map(element => astNodeToJson(element));

    case 'Literal':
      // Handle regex literals specially
      if (node.regex) {
        // Return just the pattern without delimiters - JSON.stringify will handle escaping
        return node.regex.pattern;
      }
      return node.value;

    case 'Identifier':
      // Handle unquoted values that are actually identifiers
      return node.name;

    case 'TemplateLiteral':
      // Handle template literals (though probably not used in sites.js)
      if (node.quasis.length === 1 && node.expressions.length === 0) {
        return node.quasis[0].value.cooked;
      }
      // For complex template literals, convert to string representation
      return '[TemplateLiteral]';

    case 'UnaryExpression':
      // Handle unary expressions like -1, +1, !true
      if (node.operator === '-' && node.argument.type === 'Literal') {
        return -node.argument.value;
      }
      if (node.operator === '+' && node.argument.type === 'Literal') {
        return +node.argument.value;
      }
      if (node.operator === '!' && node.argument.type === 'Literal') {
        return !node.argument.value;
      }
      return '[UnaryExpression]';

    case 'BinaryExpression':
      // Handle simple binary expressions if needed
      return '[BinaryExpression]';

    case 'CallExpression':
      // Handle function calls - convert to string representation
      return '[CallExpression]';

    case 'MemberExpression':
      // Handle property access - convert to string representation
      return '[MemberExpression]';

    default:
      console.warn(`Unknown AST node type: ${node.type}`);
      return `[${node.type}]`;
  }
}

// Extract property key from various key types
function getPropertyKey(keyNode) {
  switch (keyNode.type) {
    case 'Identifier':
      return keyNode.name;
    case 'Literal':
      return keyNode.value;
    case 'TemplateLiteral':
      if (keyNode.quasis.length === 1 && keyNode.expressions.length === 0) {
        return keyNode.quasis[0].value.cooked;
      }
      return '[TemplateLiteral]';
    default:
      return `[${keyNode.type}]`;
  }
}