// by nichxbt
import { describe, it, expect } from 'vitest';
import { getRecommendations } from '../../src/graph/recommendations.js';
import { createGraph, addNode, addEdge } from '../../src/graph/builder.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Graph shape:
 *   alice ↔ bob  (mutual)
 *   alice → carol
 *   bob → dave
 *   dave → alice  (dave follows alice)
 *   eve → alice   (eve follows alice, not followed back)
 */
function makeRecoGraph() {
  const g = createGraph('alice');
  ['alice', 'bob', 'carol', 'dave', 'eve'].forEach((u) => addNode(g, u));
  addEdge(g, 'alice', 'bob');
  addEdge(g, 'bob', 'alice');   // mutual alice↔bob
  addEdge(g, 'alice', 'carol');
  addEdge(g, 'bob', 'dave');    // bob follows dave — dave is a follow suggestion for alice
  addEdge(g, 'dave', 'alice');  // dave follows alice
  addEdge(g, 'eve', 'alice');   // eve follows alice
  return g;
}

// ============================================================================
// getRecommendations — shape
// ============================================================================

describe('getRecommendations', () => {
  it('returns the four expected recommendation lists', () => {
    const g = makeRecoGraph();
    const reco = getRecommendations(g, 'alice');

    expect(reco).toHaveProperty('seed', 'alice');
    expect(reco).toHaveProperty('followSuggestions');
    expect(reco).toHaveProperty('engageSuggestions');
    expect(reco).toHaveProperty('competitorWatch');
    expect(reco).toHaveProperty('safeToUnfollow');
    expect(reco).toHaveProperty('generatedAt');
  });

  it('all lists are arrays', () => {
    const g = makeRecoGraph();
    const reco = getRecommendations(g, 'alice');
    expect(Array.isArray(reco.followSuggestions)).toBe(true);
    expect(Array.isArray(reco.engageSuggestions)).toBe(true);
    expect(Array.isArray(reco.competitorWatch)).toBe(true);
    expect(Array.isArray(reco.safeToUnfollow)).toBe(true);
  });

  it('normalises @ prefix in username', () => {
    const g = makeRecoGraph();
    const reco = getRecommendations(g, '@alice');
    expect(reco.seed).toBe('alice');
  });

  it('generatedAt is a valid ISO timestamp', () => {
    const g = makeRecoGraph();
    const { generatedAt } = getRecommendations(g, 'alice');
    expect(() => new Date(generatedAt)).not.toThrow();
    expect(new Date(generatedAt).toISOString()).toBe(generatedAt);
  });
});

// ============================================================================
// followSuggestions
// ============================================================================

describe('getRecommendations — followSuggestions', () => {
  it('suggests dave (followed by mutual bob, alice does not follow dave)', () => {
    const g = makeRecoGraph();
    const { followSuggestions } = getRecommendations(g, 'alice');
    const usernames = followSuggestions.map((s) => s.username);
    expect(usernames).toContain('dave');
  });

  it('does not suggest accounts alice already follows', () => {
    const g = makeRecoGraph();
    const { followSuggestions } = getRecommendations(g, 'alice');
    const usernames = followSuggestions.map((s) => s.username);
    expect(usernames).not.toContain('bob');   // already following
    expect(usernames).not.toContain('carol'); // already following
  });

  it('does not suggest alice herself', () => {
    const g = makeRecoGraph();
    const { followSuggestions } = getRecommendations(g, 'alice');
    expect(followSuggestions.map((s) => s.username)).not.toContain('alice');
  });

  it('each suggestion has required fields', () => {
    const g = makeRecoGraph();
    const { followSuggestions } = getRecommendations(g, 'alice');
    for (const s of followSuggestions) {
      expect(s).toHaveProperty('username');
      expect(s).toHaveProperty('sharedConnections');
      expect(s).toHaveProperty('influence');
      expect(s).toHaveProperty('reason');
    }
  });
});

// ============================================================================
// safeToUnfollow
// ============================================================================

describe('getRecommendations — safeToUnfollow', () => {
  it('does not suggest unfollowing a mutual (bob)', () => {
    const g = makeRecoGraph();
    const { safeToUnfollow } = getRecommendations(g, 'alice');
    expect(safeToUnfollow.map((s) => s.username)).not.toContain('bob');
  });

  it('each suggestion has required fields', () => {
    const g = makeRecoGraph();
    const { safeToUnfollow } = getRecommendations(g, 'alice');
    for (const s of safeToUnfollow) {
      expect(s).toHaveProperty('username');
      expect(s).toHaveProperty('influence');
      expect(s).toHaveProperty('reason');
    }
  });

  it('returns empty array when all followed accounts are mutuals', () => {
    const g = createGraph('alice');
    ['alice', 'bob'].forEach((u) => addNode(g, u));
    addEdge(g, 'alice', 'bob');
    addEdge(g, 'bob', 'alice'); // fully mutual
    const { safeToUnfollow } = getRecommendations(g, 'alice');
    expect(safeToUnfollow).toHaveLength(0);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('getRecommendations — edge cases', () => {
  it('handles a graph with only the seed node', () => {
    const g = createGraph('solo');
    addNode(g, 'solo');
    expect(() => getRecommendations(g, 'solo')).not.toThrow();
    const reco = getRecommendations(g, 'solo');
    expect(reco.followSuggestions).toHaveLength(0);
    expect(reco.safeToUnfollow).toHaveLength(0);
  });

  it('handles a user not present in the graph', () => {
    const g = makeRecoGraph();
    expect(() => getRecommendations(g, 'ghost')).not.toThrow();
    const reco = getRecommendations(g, 'ghost');
    expect(reco.seed).toBe('ghost');
  });
});
