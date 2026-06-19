// by nichxbt
import { describe, it, expect } from 'vitest';
import { getAudienceInsights } from '../../src/analytics/audienceOverlap.js';

// getAudienceInsights is the only pure function in audienceOverlap.js.
// analyzeOverlap / multiOverlap / findSimilarAudience all require Puppeteer scrapers — skipped.

function makeOverlapResult({ pct, sharedCount, aFollowers, bFollowers, aUsername = 'alice', bUsername = 'bob' }) {
  return {
    accountA: { username: aUsername, followerCount: aFollowers },
    accountB: { username: bUsername, followerCount: bFollowers },
    shared: { percentage: pct, count: sharedCount },
  };
}

describe('getAudienceInsights', () => {
  it('returns an array of insight strings', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 10, sharedCount: 500, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(s => expect(typeof s).toBe('string'));
  });

  it('generates "very high overlap" insight when pct > 50', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 65, sharedCount: 3250, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(result.some(s => s.includes('very high audience overlap'))).toBe(true);
  });

  it('generates "significant shared audience" insight when 25 < pct <= 50', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 35, sharedCount: 1750, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(result.some(s => s.includes('significant shared audience'))).toBe(true);
  });

  it('generates "moderate" insight when 10 < pct <= 25', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 15, sharedCount: 750, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(result.some(s => s.includes('moderate'))).toBe(true);
  });

  it('generates "largely distinct" insight when 3 < pct <= 10', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 5, sharedCount: 250, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(result.some(s => s.includes('largely distinct'))).toBe(true);
  });

  it('generates "minimal overlap" insight when pct <= 3', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 1, sharedCount: 50, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(result.some(s => s.includes('Minimal overlap'))).toBe(true);
  });

  it('includes shared follower count when sharedCount > 0', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 20, sharedCount: 1000, aFollowers: 5000, bFollowers: 5000,
    }));
    expect(result.some(s => s.includes('1,000') || s.includes('1000'))).toBe(true);
  });

  it('does not include shared count line when sharedCount is 0', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 0, sharedCount: 0, aFollowers: 5000, bFollowers: 5000,
    }));
    // Should not have a "shared followers" line
    expect(result.some(s => s.includes('shared followers'))).toBe(false);
  });

  it('mentions collab opportunity when accountB has 5x+ more followers than accountA', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 10, sharedCount: 100, aFollowers: 1000, bFollowers: 10000,
    }));
    expect(result.some(s => s.includes('collab'))).toBe(true);
    expect(result.some(s => s.includes('alice'))).toBe(true); // smaller account mentioned
  });

  it('mentions collab opportunity when accountA has 5x+ more followers than accountB', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 10, sharedCount: 100, aFollowers: 10000, bFollowers: 1000,
    }));
    expect(result.some(s => s.includes('collab'))).toBe(true);
    expect(result.some(s => s.includes('bob'))).toBe(true); // smaller account mentioned
  });

  it('does not add collab insight when follower ratio is between 0.2 and 5', () => {
    const result = getAudienceInsights(makeOverlapResult({
      pct: 10, sharedCount: 200, aFollowers: 5000, bFollowers: 8000,
    }));
    expect(result.some(s => s.includes('collab'))).toBe(false);
  });

  it('handles zero follower counts without throwing', () => {
    expect(() => getAudienceInsights(makeOverlapResult({
      pct: 0, sharedCount: 0, aFollowers: 0, bFollowers: 0,
    }))).not.toThrow();
  });
});
