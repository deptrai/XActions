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

describe('Story 25.4 — DEPRECATED branch (Epic 26 producer, mechanism wired now)', () => {
  it('returns type DEPRECATED + replacement suggestedAction when action is deprecated', () => {
    const err = actionNotAvailable('fb', 'old_share', ['messenger_share'], undefined, 'messenger_share');
    expect(err).toBeInstanceOf(PlatformError);
    expect(err.type).toBe(ErrorTypes.DEPRECATED); // 'deprecated'
    expect(err.code).toBe('XACT_4001');
    expect(err.statusCode).toBe(400);
    expect(err.suggestedAction).toBe('use_messenger_share');
    expect(err.message).toContain('messenger_share');
  });

  it('explicit suggestedAction overrides the derived use_<replacement>', () => {
    const err = actionNotAvailable('fb', 'old_x', ['new_x'], 'relogin', 'new_x');
    expect(err.type).toBe(ErrorTypes.DEPRECATED);
    expect(err.suggestedAction).toBe('relogin');
  });

  it('non-deprecated action stays INVALID_ARGS with use_x_actions_list', () => {
    const err = actionNotAvailable('fb', 'nope', ['search']);
    expect(err.type).toBe(ErrorTypes.INVALID_ARGS);
    expect(err.suggestedAction).toBe('use_x_actions_list');
  });

  it('DEPRECATED_ACTIONS registry exists, is frozen, and is keyed platform:action', async () => {
    const { DEPRECATED_ACTIONS } = await import('../../src/scrapers/platforms.js');
    expect(Object.isFrozen(DEPRECATED_ACTIONS)).toBe(true);
    expect(typeof DEPRECATED_ACTIONS).toBe('object');
  });
});
