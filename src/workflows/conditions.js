// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Workflow Conditions
 * Conditional logic for workflow steps
 *
 * Evaluates expressions against the workflow context to determine
 * whether to continue, skip, or branch.
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

// ============================================================================
// Built-in Condition Evaluators
// ============================================================================

/**
 * Map of supported comparison operators.
 *
 * @type {Record<string, (a: unknown, b?: unknown) => boolean>}
 */
const OPERATORS = {
  '>': (a, b) => Number(a) > Number(b),
  '<': (a, b) => Number(a) < Number(b),
  '>=': (a, b) => Number(a) >= Number(b),
  '<=': (a, b) => Number(a) <= Number(b),
  '==': (a, b) => String(a) === String(b),
  '!=': (a, b) => String(a) !== String(b),
  'contains': (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
  'not_contains': (a, b) => !String(a).toLowerCase().includes(String(b).toLowerCase()),
  'matches': (a, b) => new RegExp(String(b), 'i').test(String(a)),
  'exists': (a) => Boolean(a !== undefined && a !== null),
  'empty': (a) => Boolean(!a || (Array.isArray(a) && a.length === 0) || (typeof a === 'string' && a.trim() === '')),
  'not_empty': (a) => Boolean(a && (!Array.isArray(a) || a.length > 0) && (typeof a !== 'string' || a.trim() !== '')),
};

/**
 * Resolve a dot-notated path from the context
 * Supports: "profile.followers", "profile.tweets[0].text", "profile.tweets.length"
 *
 * @param {unknown} path
 * @param {import('../types/xactions.js').WorkflowContext} context
 * @returns {unknown}
 */
function resolveValue(path, context) {
  if (path === undefined || path === null) return path;

  // If it's a literal value (quoted string or number)
  if (typeof path === 'number' || typeof path === 'boolean') return path;
  if (typeof path === 'string') {
    // Quoted string literal
    if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
      return path.slice(1, -1);
    }
    // Numeric literal
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    // Boolean literal
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
  }

  // Duration literal (e.g., "30m", "1h", "2d") → returns milliseconds
  const durationMatch = String(path).match(/^(\d+)(ms|s|m|h|d)$/);
  if (durationMatch) {
    const value = Number(durationMatch[1]);
    const unit = /** @type {string} */ (durationMatch[2]);
    const multipliers = /** @type {Record<string, number>} */ ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 });
    return value * (multipliers[unit] ?? 0);
  }

  // Resolve from context via dot notation
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  let current = /** @type {Record<string, unknown> | unknown} */ (context);

  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (typeof current !== 'object') return undefined;
    current = /** @type {Record<string, unknown>} */ (current)[part];
  }

  return current;
}

/**
 * Parse a simple condition expression string
 * Formats:
 *   "profile.followers > 1000"
 *   "profile.tweets[0].text contains 'keyword'"
 *   "profile.tweets[0].age < 30m"
 *   "results.length > 0"
 *
 * @param {unknown} expression
 * @returns {import('../types/xactions.js').WorkflowCondition}
 */
function parseExpression(expression) {
  const str = String(expression).trim();

  // Try each operator (longest first to avoid partial matches)
  const operatorList = ['not_contains', 'not_empty', 'contains', 'matches', '>=', '<=', '!=', '==', '>', '<', 'exists', 'empty'];

  for (const op of operatorList) {
    // For word operators, use word boundary matching
    const regex = /^[a-z]/.test(op)
      ? new RegExp(`^(.+?)\\s+${op}(?:\\s+(.+))?$`, 'i')
      : new RegExp(`^(.+?)\\s*${op.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.+)?$`);

    const match = str.match(regex);
    if (match) {
      return {
        left: match[1].trim(),
        operator: op,
        right: match[2]?.trim(),
      };
    }
  }

  // If no operator found, treat as truthy check
  return {
    left: str,
    operator: 'exists',
    right: undefined,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Evaluate a condition step against the workflow context
 *
 * Supported formats:
 * 1. Simple expression string: { "condition": "profile.followers > 1000" }
 * 2. Structured condition: { "condition": { "left": "profile.followers", "operator": ">", "right": 1000 } }
 * 3. AND conditions: { "condition": { "all": ["expr1", "expr2"] } }
 * 4. OR conditions: { "condition": { "any": ["expr1", "expr2"] } }
 *
 * @param {string | import('../types/xactions.js').WorkflowCondition} condition - The condition to evaluate
 * @param {import('../types/xactions.js').WorkflowContext} context - The workflow variable context
 * @returns {import('../types/xactions.js').ConditionEvaluation}
 */
export function evaluateCondition(condition, context) {
  try {
    if (typeof condition === 'string') {
      return evaluateExpression(condition, context);
    }

    if (typeof condition === 'object' && condition !== null) {
      const cond = /** @type {import('../types/xactions.js').WorkflowCondition} */ (condition);

      // AND conditions
      if (cond.all && Array.isArray(cond.all)) {
        const results = cond.all.map(expr => evaluateExpression(expr, context));
        const passed = results.every(r => r.passed);
        return {
          passed,
          details: `ALL(${results.map(r => `${r.details}=${r.passed}`).join(', ')})`,
        };
      }

      // OR conditions
      if (cond.any && Array.isArray(cond.any)) {
        const results = cond.any.map(expr => evaluateExpression(expr, context));
        const passed = results.some(r => r.passed);
        return {
          passed,
          details: `ANY(${results.map(r => `${r.details}=${r.passed}`).join(', ')})`,
        };
      }

      // Structured condition { left, operator, right }
      if (cond.left && cond.operator) {
        const leftVal = resolveValue(cond.left, context);
        const rightVal = cond.right !== undefined ? resolveValue(cond.right, context) : undefined;
        const op = OPERATORS[cond.operator];

        if (!op) {
          return { passed: false, details: `Unknown operator: ${cond.operator}` };
        }

        const passed = op(leftVal, rightVal);
        return {
          passed,
          details: `${cond.left}(${leftVal}) ${cond.operator} ${cond.right ?? ''}(${rightVal ?? ''})`,
        };
      }
    }

    return { passed: false, details: 'Invalid condition format' };
  } catch (error) {
    return { passed: false, details: `Condition error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Evaluate a single expression string
 *
 * @param {unknown} expression
 * @param {import('../types/xactions.js').WorkflowContext} context
 * @returns {import('../types/xactions.js').ConditionEvaluation}
 */
function evaluateExpression(expression, context) {
  const parsed = parseExpression(expression);
  const leftVal = resolveValue(parsed.left, context);
  const rightVal = parsed.right !== undefined ? resolveValue(parsed.right, context) : undefined;
  const op = OPERATORS[/** @type {string} */ (parsed.operator)];

  if (!op) {
    return { passed: false, details: `Unknown operator: ${parsed.operator}` };
  }

  const passed = op(leftVal, rightVal);
  return {
    passed,
    details: `${parsed.left}(${JSON.stringify(leftVal)}) ${parsed.operator} ${parsed.right ?? ''}`,
  };
}

/**
 * Get list of available operators
 *
 * @returns {string[]}
 */
export function getAvailableOperators() {
  return Object.keys(OPERATORS);
}

export { resolveValue, parseExpression };
