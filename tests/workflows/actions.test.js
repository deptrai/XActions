// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  registerAction,
  getAction,
  listActions,
  executeAction,
} from '../../src/workflows/actions.js';

// ============================================================================
// registerAction / getAction / listActions
// ============================================================================

describe('registerAction + getAction', () => {
  it('registers an action and retrieves it by name', () => {
    registerAction('_test_noop', {
      description: 'Test no-op',
      category: 'test',
      params: {},
      async execute() { return 'ok'; },
    });

    const action = getAction('_test_noop');
    expect(action).not.toBeNull();
    expect(typeof action.execute).toBe('function');
  });

  it('returns null for an unknown action', () => {
    expect(getAction('__definitely_does_not_exist__')).toBeNull();
  });

  it('overwrites a previously registered action', () => {
    registerAction('_test_overwrite', {
      description: 'v1',
      async execute() { return 'v1'; },
    });
    registerAction('_test_overwrite', {
      description: 'v2',
      async execute() { return 'v2'; },
    });
    expect(getAction('_test_overwrite').description).toBe('v2');
  });
});

describe('listActions', () => {
  it('returns an array of action metadata objects', () => {
    const list = listActions();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it('each entry has name, description, params, category', () => {
    const list = listActions();
    for (const entry of list) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.description).toBe('string');
      expect(typeof entry.params).toBe('object');
      expect(typeof entry.category).toBe('string');
    }
  });

  it('includes built-in actions: filter, count, pick, slice, template, log, delay', () => {
    const names = listActions().map(a => a.name);
    for (const name of ['filter', 'count', 'pick', 'slice', 'template', 'log', 'delay']) {
      expect(names).toContain(name);
    }
  });

  it('includes scraper actions in the list', () => {
    const names = listActions().map(a => a.name);
    expect(names).toContain('scrapeProfile');
    expect(names).toContain('scrapeFollowers');
  });
});

// ============================================================================
// executeAction — transform actions (no browser/network)
// ============================================================================

describe('executeAction — filter', () => {
  const ctx = {
    users: [
      { username: 'alice', followers: 1200 },
      { username: 'bob', followers: 800 },
      { username: 'carol', followers: 2000 },
    ],
  };

  it('filters array with > operator', async () => {
    const result = await executeAction(
      { action: 'filter', input: 'users', field: 'followers', operator: '>', value: 1000 },
      ctx,
    );
    expect(result).toHaveLength(2);
    expect(result.map(u => u.username)).toContain('alice');
    expect(result.map(u => u.username)).toContain('carol');
  });

  it('filters with == operator', async () => {
    const result = await executeAction(
      { action: 'filter', input: 'users', field: 'username', operator: '==', value: 'bob' },
      ctx,
    );
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('bob');
  });

  it('returns empty array when nothing matches', async () => {
    const result = await executeAction(
      { action: 'filter', input: 'users', field: 'followers', operator: '>', value: 9999 },
      ctx,
    );
    expect(result).toHaveLength(0);
  });

  it('throws when input is not an array', async () => {
    await expect(
      executeAction(
        { action: 'filter', input: 'users', field: 'followers', operator: '>', value: 0 },
        { users: 'not-an-array' },
      ),
    ).rejects.toThrow(/not an array/);
  });

  it('throws for unknown operator', async () => {
    await expect(
      executeAction(
        { action: 'filter', input: 'users', field: 'followers', operator: 'BOGUS', value: 0 },
        ctx,
      ),
    ).rejects.toThrow(/unknown operator/);
  });
});

describe('executeAction — count', () => {
  it('returns count of array items', async () => {
    const result = await executeAction(
      { action: 'count', input: 'items' },
      { items: [1, 2, 3, 4, 5] },
    );
    expect(result).toBe(5);
  });

  it('returns 0 for empty array', async () => {
    const result = await executeAction(
      { action: 'count', input: 'items' },
      { items: [] },
    );
    expect(result).toBe(0);
  });

  it('returns 0 for non-array value', async () => {
    const result = await executeAction(
      { action: 'count', input: 'items' },
      { items: 'not-an-array' },
    );
    expect(result).toBe(0);
  });
});

describe('executeAction — pick', () => {
  const ctx = {
    users: [
      { username: 'alice', followers: 100, email: 'a@x.com' },
      { username: 'bob', followers: 200, email: 'b@x.com' },
    ],
  };

  it('picks specified fields from each object', async () => {
    const result = await executeAction(
      { action: 'pick', input: 'users', fields: ['username', 'followers'] },
      ctx,
    );
    expect(result).toHaveLength(2);
    expect(Object.keys(result[0])).toEqual(['username', 'followers']);
    expect(result[0].email).toBeUndefined();
  });

  it('picks a single field', async () => {
    const result = await executeAction(
      { action: 'pick', input: 'users', fields: ['username'] },
      ctx,
    );
    expect(result[0]).toEqual({ username: 'alice' });
  });

  it('throws when input is not an array', async () => {
    await expect(
      executeAction({ action: 'pick', input: 'users', fields: ['x'] }, { users: null }),
    ).rejects.toThrow(/not an array/);
  });
});

describe('executeAction — slice', () => {
  const ctx = { items: [10, 20, 30, 40, 50] };

  it('slices from start to end', async () => {
    const result = await executeAction(
      { action: 'slice', input: 'items', start: 1, end: 3 },
      ctx,
    );
    expect(result).toEqual([20, 30]);
  });

  it('slices from start without end', async () => {
    const result = await executeAction(
      { action: 'slice', input: 'items', start: 3 },
      ctx,
    );
    expect(result).toEqual([40, 50]);
  });

  it('slices from 0 when start omitted', async () => {
    const result = await executeAction(
      { action: 'slice', input: 'items', end: 2 },
      ctx,
    );
    expect(result).toEqual([10, 20]);
  });

  it('throws when input is not an array', async () => {
    await expect(
      executeAction({ action: 'slice', input: 'items', start: 0 }, { items: 'bad' }),
    ).rejects.toThrow(/not an array/);
  });
});

describe('executeAction — template', () => {
  it('replaces {{variable}} placeholders', async () => {
    const result = await executeAction(
      { action: 'template', text: 'Hello {{name}}, you have {{count}} followers.' },
      { name: 'Alice', count: 1500 },
    );
    expect(result).toBe('Hello Alice, you have 1500 followers.');
  });

  it('replaces nested {{obj.field}} placeholders', async () => {
    const result = await executeAction(
      { action: 'template', text: 'User: {{profile.username}}' },
      { profile: { username: 'nichxbt' } },
    );
    expect(result).toBe('User: nichxbt');
  });

  it('leaves unresolvable placeholders unchanged', async () => {
    const result = await executeAction(
      { action: 'template', text: 'Hi {{unknown}}!' },
      {},
    );
    expect(result).toBe('Hi {{unknown}}!');
  });

  it('returns plain string unchanged when no placeholders', async () => {
    const result = await executeAction(
      { action: 'template', text: 'No placeholders here.' },
      {},
    );
    expect(result).toBe('No placeholders here.');
  });
});

describe('executeAction — log', () => {
  it('returns the message when variable not specified', async () => {
    const result = await executeAction(
      { action: 'log', message: 'hello from workflow' },
      {},
    );
    expect(result).toBe('hello from workflow');
  });

  it('returns context variable value when variable specified', async () => {
    const result = await executeAction(
      { action: 'log', variable: 'myData' },
      { myData: [1, 2, 3] },
    );
    expect(result).toEqual([1, 2, 3]);
  });
});

describe('executeAction — template variable resolution in params', () => {
  it('resolves {{variable}} in string step params before execution', async () => {
    // The executeAction function itself resolves {{}} in step params before
    // passing to action.execute — test that via template action
    const result = await executeAction(
      { action: 'template', text: 'Target: {{target}}' },
      { target: 'nichxbt' },
    );
    expect(result).toBe('Target: nichxbt');
  });
});

describe('executeAction — unknown action', () => {
  it('throws for an unregistered action name', async () => {
    await expect(
      executeAction({ action: '__no_such_action__' }, {}),
    ).rejects.toThrow(/Unknown action/);
  });
});
