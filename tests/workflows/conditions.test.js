// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  evaluateCondition,
  getAvailableOperators,
  resolveValue,
  parseExpression,
} from '../../src/workflows/conditions.js';

// ============================================================================
// resolveValue
// ============================================================================

describe('resolveValue', () => {
  const ctx = {
    profile: {
      username: 'nichxbt',
      followers: 1500,
      tweets: [
        { text: 'hello world', likes: 42 },
        { text: 'second tweet', likes: 10 },
      ],
    },
    count: 0,
    flag: false,
  };

  it('resolves a top-level key', () => {
    expect(resolveValue('count', ctx)).toBe(0);
  });

  it('resolves nested dot notation', () => {
    expect(resolveValue('profile.followers', ctx)).toBe(1500);
    expect(resolveValue('profile.username', ctx)).toBe('nichxbt');
  });

  it('resolves array index notation', () => {
    expect(resolveValue('profile.tweets[0].text', ctx)).toBe('hello world');
    expect(resolveValue('profile.tweets[1].likes', ctx)).toBe(10);
  });

  it('returns numeric literal unchanged', () => {
    expect(resolveValue(42, ctx)).toBe(42);
    expect(resolveValue(0, ctx)).toBe(0);
  });

  it('returns boolean literal unchanged', () => {
    expect(resolveValue(true, ctx)).toBe(true);
    expect(resolveValue(false, ctx)).toBe(false);
  });

  it('parses quoted string literals', () => {
    expect(resolveValue('"hello"', ctx)).toBe('hello');
    expect(resolveValue("'world'", ctx)).toBe('world');
  });

  it('parses numeric string literals', () => {
    expect(resolveValue('100', ctx)).toBe(100);
    expect(resolveValue('-3.14', ctx)).toBe(-3.14);
  });

  it('parses boolean string literals', () => {
    expect(resolveValue('true', ctx)).toBe(true);
    expect(resolveValue('false', ctx)).toBe(false);
  });

  it('parses null literal', () => {
    expect(resolveValue('null', ctx)).toBe(null);
  });

  it('converts duration literals to milliseconds', () => {
    expect(resolveValue('30m', ctx)).toBe(1800000);
    expect(resolveValue('1h', ctx)).toBe(3600000);
    expect(resolveValue('2d', ctx)).toBe(172800000);
    expect(resolveValue('500ms', ctx)).toBe(500);
    expect(resolveValue('60s', ctx)).toBe(60000);
  });

  it('returns undefined for missing path', () => {
    expect(resolveValue('profile.nonexistent', ctx)).toBeUndefined();
  });

  it('returns undefined when traversing through null', () => {
    expect(resolveValue('profile.tweets[5].text', ctx)).toBeUndefined();
  });
});

// ============================================================================
// parseExpression
// ============================================================================

describe('parseExpression', () => {
  it('parses > operator', () => {
    const result = parseExpression('profile.followers > 1000');
    expect(result.left).toBe('profile.followers');
    expect(result.operator).toBe('>');
    expect(result.right).toBe('1000');
  });

  it('parses contains operator', () => {
    const result = parseExpression('profile.bio contains "AI"');
    expect(result.operator).toBe('contains');
    expect(result.left).toBe('profile.bio');
    expect(result.right).toBe('"AI"');
  });

  it('parses exists operator (unary)', () => {
    const result = parseExpression('profile.email exists');
    expect(result.operator).toBe('exists');
    expect(result.left).toBe('profile.email');
  });

  it('parses not_contains operator', () => {
    const result = parseExpression('profile.bio not_contains "spam"');
    expect(result.operator).toBe('not_contains');
  });

  it('parses == operator', () => {
    const result = parseExpression('status == "active"');
    expect(result.operator).toBe('==');
    expect(result.left).toBe('status');
    expect(result.right).toBe('"active"');
  });

  it('falls back to exists for bare path (no operator)', () => {
    const result = parseExpression('profile.verified');
    expect(result.operator).toBe('exists');
    expect(result.left).toBe('profile.verified');
  });

  it('parses >= and <= without ambiguity with > and <', () => {
    const gte = parseExpression('count >= 5');
    expect(gte.operator).toBe('>=');

    const lte = parseExpression('count <= 10');
    expect(lte.operator).toBe('<=');
  });
});

// ============================================================================
// evaluateCondition — string expressions
// ============================================================================

describe('evaluateCondition — string expressions', () => {
  const ctx = {
    profile: { followers: 1500, bio: 'AI builder', verified: true },
    items: ['a', 'b', 'c'],
    score: 0,
    tag: '',
  };

  it('passes when numeric comparison is true', () => {
    const r = evaluateCondition('profile.followers > 1000', ctx);
    expect(r.passed).toBe(true);
  });

  it('fails when numeric comparison is false', () => {
    const r = evaluateCondition('profile.followers > 5000', ctx);
    expect(r.passed).toBe(false);
  });

  it('passes contains check (case-insensitive)', () => {
    const r = evaluateCondition('profile.bio contains "ai"', ctx);
    expect(r.passed).toBe(true);
  });

  it('passes not_contains check', () => {
    const r = evaluateCondition('profile.bio not_contains "spam"', ctx);
    expect(r.passed).toBe(true);
  });

  it('passes exists for truthy value', () => {
    const r = evaluateCondition('profile.verified exists', ctx);
    expect(r.passed).toBe(true);
  });

  it('fails empty check on non-empty array', () => {
    const r = evaluateCondition('items empty', ctx);
    expect(r.passed).toBe(false);
  });

  it('passes empty check on empty string', () => {
    const r = evaluateCondition('tag empty', ctx);
    expect(r.passed).toBe(true);
  });

  it('passes not_empty on array with items', () => {
    const r = evaluateCondition('items not_empty', ctx);
    expect(r.passed).toBe(true);
  });

  it('returns details string', () => {
    const r = evaluateCondition('profile.followers > 1000', ctx);
    expect(typeof r.details).toBe('string');
    expect(r.details.length).toBeGreaterThan(0);
  });

  it('fails gracefully on bad expression without throwing', () => {
    const r = evaluateCondition('profile.followers UNKNOWN_OP 5', ctx);
    // falls back to exists check on "profile.followers UNKNOWN_OP 5" as path
    expect(typeof r.passed).toBe('boolean');
  });
});

// ============================================================================
// evaluateCondition — structured object formats
// ============================================================================

describe('evaluateCondition — structured object', () => {
  const ctx = { score: 80, label: 'premium', tags: [] };

  it('handles structured { left, operator, right }', () => {
    const r = evaluateCondition({ left: 'score', operator: '>=', right: 50 }, ctx);
    expect(r.passed).toBe(true);
  });

  it('handles ALL (and) conditions — all pass', () => {
    const r = evaluateCondition({
      all: ['score > 50', 'label == "premium"'],
    }, ctx);
    expect(r.passed).toBe(true);
    expect(r.details).toMatch(/ALL/);
  });

  it('handles ALL (and) conditions — one fails', () => {
    const r = evaluateCondition({
      all: ['score > 50', 'score > 200'],
    }, ctx);
    expect(r.passed).toBe(false);
  });

  it('handles ANY (or) conditions — one passes', () => {
    const r = evaluateCondition({
      any: ['score > 200', 'label == "premium"'],
    }, ctx);
    expect(r.passed).toBe(true);
    expect(r.details).toMatch(/ANY/);
  });

  it('handles ANY (or) conditions — all fail', () => {
    const r = evaluateCondition({
      any: ['score > 200', 'label == "basic"'],
    }, ctx);
    expect(r.passed).toBe(false);
  });

  it('returns { passed: false } for invalid condition format', () => {
    const r = evaluateCondition({}, ctx);
    expect(r.passed).toBe(false);
    expect(typeof r.details).toBe('string');
  });

  it('returns { passed: false } for unknown operator in structured form', () => {
    const r = evaluateCondition({ left: 'score', operator: 'BOGUS', right: 10 }, ctx);
    expect(r.passed).toBe(false);
  });
});

// ============================================================================
// evaluateCondition — edge cases
// ============================================================================

describe('evaluateCondition — edge cases', () => {
  it('handles null/undefined context gracefully', () => {
    const r = evaluateCondition('missing.path > 0', {});
    expect(r.passed).toBe(false);
  });

  it('handles duration literal comparison', () => {
    // age value in ms compared against 30m (1800000ms)
    const ctx = { age: 900000 }; // 15 minutes
    const r = evaluateCondition('age < 30m', ctx);
    expect(r.passed).toBe(true);
  });

  it('does not throw on malformed input', () => {
    expect(() => evaluateCondition(null, {})).not.toThrow();
    expect(() => evaluateCondition(undefined, {})).not.toThrow();
  });
});

// ============================================================================
// getAvailableOperators
// ============================================================================

describe('getAvailableOperators', () => {
  it('returns an array of operator strings', () => {
    const ops = getAvailableOperators();
    expect(Array.isArray(ops)).toBe(true);
    expect(ops.length).toBeGreaterThan(0);
  });

  it('includes expected operators', () => {
    const ops = getAvailableOperators();
    for (const op of ['>', '<', '>=', '<=', '==', '!=', 'contains', 'exists', 'empty']) {
      expect(ops).toContain(op);
    }
  });
});
