// Story 25.4 — backward-compatibility error mapping: actionNotAvailable() must
// return a normalized error envelope so the API layer maps it to HTTP 400 (not 500).
import { describe, it, expect } from 'vitest';
import { actionNotAvailable } from '../../src/scrapers/platforms.js';
import { ErrorTypes, SuggestedActions, PlatformError } from '../../src/core/error-envelope.js';

describe('Story 25.4 — actionNotAvailable error envelope', () => {
  it('returns a 400-level PlatformError so API maps it to 400 not 500', () => {
    const err = actionNotAvailable('fb', 'old_action', ['search', 'profile']);
    // API handlers (api/routes/schemas.js:20, checkpoints.js:260) branch on
    // instanceof PlatformError -> toEnvelope()+statusCode. A vanilla Error would 500.
    expect(err).toBeInstanceOf(PlatformError);
    expect(err.isPlatformError).toBe(true);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('XACT_4001');
    expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
    expect(err.platform).toBe('fb');
    expect(err.isRetryable).toBe(false);
    expect(err.suggestedAction).toBe(SuggestedActions.USE_ACTIONS_LIST);
    expect(err.message).toContain('old_action');
    expect(err.message).toContain('fb');
    expect(err.message).toContain('search');
    // envelope serializes cleanly for the API response
    const env = err.toEnvelope();
    expect(env.code).toBe('XACT_4001');
    expect(env.statusCode).toBe(400);
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

  it('tolerates non-array `available` without throwing (edge case)', () => {
    expect(() => actionNotAvailable('fb', 'x', null)).not.toThrow();
    expect(() => actionNotAvailable('fb', 'x', undefined)).not.toThrow();
    const err = actionNotAvailable('fb', 'x', []);
    expect(err.message).toContain('Available:');
  });
});

// Closes verification gap flagged by review: the spec AC asserts barrel
// re-exports resolve, but no test imported social/facebook/index.js directly.
describe('social/facebook barrel — canonical re-exports resolve', () => {
  it('re-exports migrated modules from the barrel (not just deep imports)', async () => {
    const barrel = await import('../../src/scrapers/social/facebook/index.js');
    for (const name of [
      'parseFlatProxy', 'rotateProxy',
      'FB_LIMITS', 'FB_ACCOUNT_AGE_TIERS', 'getActionLimit', 'enforceDelay', 'getAccountAgeDays',
      'parseRecipientsFile', 'parseLinksFile', 'buildCampaignQueue',
      'MESSENGER_SHARE_SELECTORS', 'composeMessengerShareMessage',
      'typeMessage', 'sendMessageToThread', 'shareToMessenger', 'messengerShareCampaign',
    ]) {
      expect(barrel[name], `barrel.${name}`).toBeDefined();
    }
    // spot-check the canonical fns are callable
    expect(typeof barrel.rotateProxy).toBe('function');
    expect(typeof barrel.buildCampaignQueue).toBe('function');
    expect(typeof barrel.messengerShareCampaign).toBe('function');
  });
});
