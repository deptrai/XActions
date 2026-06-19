// by nichxbt
import { describe, it, expect, afterEach } from 'vitest';
import { TriggerManager } from '../../src/workflows/triggers.js';

// Use a fresh TriggerManager instance per test to avoid state bleed
function makeManager() {
  return new TriggerManager();
}

// ============================================================================
// register — manual trigger
// ============================================================================

describe('TriggerManager — register manual', () => {
  it('registers a manual trigger without errors', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-1', { type: 'manual' });
    expect(result.type).toBe('manual');
    expect(result.workflowId).toBe('wf-1');
  });

  it('manual trigger does not appear in getRegisteredTriggers', async () => {
    const tm = makeManager();
    await tm.register('wf-manual', { type: 'manual' });
    const triggers = tm.getRegisteredTriggers();
    expect(triggers.every(t => t.workflowId !== 'wf-manual')).toBe(true);
  });
});

// ============================================================================
// register — webhook trigger
// ============================================================================

describe('TriggerManager — register webhook', () => {
  it('registers a webhook and returns webhookId + url', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-2', { type: 'webhook' });
    expect(result.type).toBe('webhook');
    expect(result.workflowId).toBe('wf-2');
    expect(typeof result.webhookId).toBe('string');
    expect(result.url).toMatch(/\/api\/workflows\/webhook\//);
  });

  it('uses provided webhookId when supplied', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-3', { type: 'webhook', webhookId: 'custom-hook-id' });
    expect(result.webhookId).toBe('custom-hook-id');
  });

  it('webhook trigger appears in getRegisteredTriggers', async () => {
    const tm = makeManager();
    await tm.register('wf-4', { type: 'webhook', webhookId: 'hook-4' });
    const triggers = tm.getRegisteredTriggers();
    const found = triggers.find(t => t.workflowId === 'wf-4');
    expect(found).toBeDefined();
    expect(found.type).toBe('webhook');
    expect(found.webhookId).toBe('hook-4');
  });
});

// ============================================================================
// register — event trigger
// ============================================================================

describe('TriggerManager — register event', () => {
  it('registers an event trigger', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-5', { type: 'event', event: 'new_follower' });
    expect(result.type).toBe('event');
    expect(result.workflowId).toBe('wf-5');
    expect(result.event).toBe('new_follower');
  });

  it('throws when event field is missing', async () => {
    const tm = makeManager();
    await expect(
      tm.register('wf-6', { type: 'event' }),
    ).rejects.toThrow(/event/i);
  });

  it('event trigger appears in getRegisteredTriggers', async () => {
    const tm = makeManager();
    await tm.register('wf-7', { type: 'event', event: 'follower_lost' });
    const triggers = tm.getRegisteredTriggers();
    const found = triggers.find(t => t.workflowId === 'wf-7');
    expect(found).toBeDefined();
    expect(found.type).toBe('event');
  });
});

// ============================================================================
// register — schedule trigger (no Bull queue)
// ============================================================================

describe('TriggerManager — register schedule (no queue)', () => {
  it('registers schedule trigger as inactive when no queue', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-8', { type: 'schedule', cron: '0 9 * * *' });
    expect(result.type).toBe('schedule');
    expect(result.cron).toBe('0 9 * * *');
  });

  it('throws when cron field is missing', async () => {
    const tm = makeManager();
    await expect(
      tm.register('wf-9', { type: 'schedule' }),
    ).rejects.toThrow(/cron/i);
  });

  it('schedule trigger appears in getRegisteredTriggers', async () => {
    const tm = makeManager();
    await tm.register('wf-10', { type: 'schedule', cron: '*/5 * * * *' });
    const triggers = tm.getRegisteredTriggers();
    const found = triggers.find(t => t.workflowId === 'wf-10');
    expect(found).toBeDefined();
    expect(found.type).toBe('schedule');
  });
});

// ============================================================================
// register — interval trigger
// ============================================================================

describe('TriggerManager — register interval', () => {
  it('registers an interval trigger', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-int', { type: 'interval', interval: 5000 });
    expect(result.type).toBe('interval');
    expect(result.interval).toBe(5000);
    // Clean up the real interval
    await tm.unregister('wf-int');
  });

  it('uses default interval when not specified', async () => {
    const tm = makeManager();
    const result = await tm.register('wf-int2', { type: 'interval' });
    expect(result.interval).toBe(60000);
    await tm.unregister('wf-int2');
  });
});

// ============================================================================
// register — unknown type
// ============================================================================

describe('TriggerManager — unknown trigger type', () => {
  it('throws for unknown trigger type', async () => {
    const tm = makeManager();
    await expect(
      tm.register('wf-unk', { type: 'magic' }),
    ).rejects.toThrow(/Unknown trigger type/);
  });

  it('throws when trigger has no type', async () => {
    const tm = makeManager();
    await expect(
      tm.register('wf-notype', {}),
    ).rejects.toThrow(/type/i);
  });

  it('throws when trigger is null', async () => {
    const tm = makeManager();
    await expect(
      tm.register('wf-null', null),
    ).rejects.toThrow();
  });
});

// ============================================================================
// handleWebhook
// ============================================================================

describe('TriggerManager — handleWebhook', () => {
  it('returns true and emits trigger event when webhookId is known', async () => {
    const tm = makeManager();
    await tm.register('wf-wh', { type: 'webhook', webhookId: 'hook-abc' });

    const events = [];
    tm.on('trigger', e => events.push(e));

    const handled = tm.handleWebhook('hook-abc', { foo: 'bar' });
    expect(handled).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].workflowId).toBe('wf-wh');
    expect(events[0].type).toBe('webhook');
    expect(events[0].payload).toEqual({ foo: 'bar' });
    expect(typeof events[0].triggeredAt).toBe('string');
  });

  it('returns false for unknown webhookId', () => {
    const tm = makeManager();
    const handled = tm.handleWebhook('non-existent-hook', {});
    expect(handled).toBe(false);
  });

  it('does not emit event for unknown webhookId', () => {
    const tm = makeManager();
    const events = [];
    tm.on('trigger', e => events.push(e));
    tm.handleWebhook('ghost-hook', {});
    expect(events).toHaveLength(0);
  });
});

// ============================================================================
// unregister
// ============================================================================

describe('TriggerManager — unregister', () => {
  it('removes webhook handler after unregister', async () => {
    const tm = makeManager();
    await tm.register('wf-rm', { type: 'webhook', webhookId: 'hook-rm' });
    await tm.unregister('wf-rm');

    const handled = tm.handleWebhook('hook-rm', {});
    expect(handled).toBe(false);
  });

  it('removes event watcher after unregister', async () => {
    const tm = makeManager();
    await tm.register('wf-ev-rm', { type: 'event', event: 'test_event' });
    await tm.unregister('wf-ev-rm');

    const triggers = tm.getRegisteredTriggers();
    expect(triggers.find(t => t.workflowId === 'wf-ev-rm')).toBeUndefined();
  });

  it('does not throw when unregistering a non-existent workflowId', async () => {
    const tm = makeManager();
    await expect(tm.unregister('wf-ghost')).resolves.not.toThrow();
  });
});

// ============================================================================
// getRegisteredTriggers
// ============================================================================

describe('TriggerManager — getRegisteredTriggers', () => {
  it('returns empty array when nothing registered', () => {
    const tm = makeManager();
    expect(tm.getRegisteredTriggers()).toEqual([]);
  });

  it('returns all registered trigger types', async () => {
    const tm = makeManager();
    await tm.register('wf-a', { type: 'webhook', webhookId: 'h-a' });
    await tm.register('wf-b', { type: 'event', event: 'tweet' });
    await tm.register('wf-c', { type: 'schedule', cron: '0 * * * *' });

    const triggers = tm.getRegisteredTriggers();
    const types = triggers.map(t => t.type);
    expect(types).toContain('webhook');
    expect(types).toContain('event');
    expect(types).toContain('schedule');

    // Clean up interval-less schedule (no-op since no Bull queue)
  });
});

// ============================================================================
// shutdown
// ============================================================================

describe('TriggerManager — shutdown', () => {
  it('clears all state after shutdown', async () => {
    const tm = makeManager();
    await tm.register('wf-sd', { type: 'webhook', webhookId: 'hook-sd' });
    await tm.register('wf-sd2', { type: 'event', event: 'ev' });

    await tm.shutdown();

    expect(tm.getRegisteredTriggers()).toEqual([]);
    expect(tm.handleWebhook('hook-sd', {})).toBe(false);
  });
});
