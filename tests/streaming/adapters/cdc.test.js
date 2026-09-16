// by nichxbt
import { describe, it, expect } from 'vitest';
import { CDCAdapter } from '../../../src/streaming/adapters/cdc.js';

describe('CDCAdapter', () => {
  it('instantiates with options', () => {
    const adapter = new CDCAdapter('cdc-test-1', {
      sourceStreamKey: 'cdc:raw_events',
      blockTimeoutMs: 2000,
    });
    expect(adapter.streamId).toBe('cdc-test-1');
    expect(adapter.sourceStreamKey).toBe('cdc:raw_events');
    expect(adapter.blockTimeoutMs).toBe(2000);
  });

  it('validates ThinEvent records', () => {
    const adapter = new CDCAdapter('cdc-test-2');

    expect(adapter.validateThinEvent(null)).toBe(false);
    expect(adapter.validateThinEvent({})).toBe(false);

    const validRecord = {
      id: 'custom:123',
      platform: 'custom',
      external_post_id: '123',
      content_snippet: 'CDC payload text',
    };
    expect(adapter.validateThinEvent(validRecord)).toBe(true);

    const validCamelCase = {
      id: 'custom:456',
      platform: 'custom',
      externalId: '456',
      content_snippet: '',
    };
    expect(adapter.validateThinEvent(validCamelCase)).toBe(true);

    const missingContent = {
      id: 'custom:789',
      platform: 'custom',
      externalId: '789',
    };
    expect(adapter.validateThinEvent(missingContent)).toBe(false);
  });
});
