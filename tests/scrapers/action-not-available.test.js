// Story 25.4 — backward-compatibility error mapping: actionNotAvailable() must
// return a normalized error envelope so the API layer maps it to HTTP 400 (not 500).
import { describe, it, expect } from 'vitest';
import { actionNotAvailable } from '../../src/scrapers/platforms.js';
import { ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';

describe('Story 25.4 — actionNotAvailable error envelope', () => {
  it('returns a 400-level Error with the full normalized envelope', () => {
    const err = actionNotAvailable('fb', 'old_action', ['search', 'profile']);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('XACT_4001');
    expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
    expect(err.platform).toBe('fb');
    expect(err.suggestedAction).toBe(SuggestedActions.USE_ACTIONS_LIST);
    expect(err.message).toContain('old_action');
    expect(err.message).toContain('fb');
    expect(err.message).toContain('search');
  });

  it('honours an explicit suggestedAction override', () => {
    const err = actionNotAvailable('twitter', 'legacy_x', ['search'], 'relogin');
    expect(err.suggestedAction).toBe('relogin');
    expect(err.statusCode).toBe(400);
    expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
  });

  it('defaults suggestedAction to use_x_actions_list when omitted', () => {
    const err = actionNotAvailable('threads', 'gone', ['search']);
    expect(err.suggestedAction).toBe('use_x_actions_list');
  });

  it('DEPRECATED type is defined for forward-compat (Epic 26 wires the producer)', () => {
    // Story 25.4 added the enum; the producer is deferred to Epic 26 decommission.
    // This pins the enum value so a future wire-up cannot silently change it.
    expect(ErrorTypes.DEPRECATED).toBe('deprecated');
  });
});
