// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  findMutualConnections,
  getMutualConnectionsFor,
  computeInfluenceScores,
  getInfluenceRanking,
  findGhostFollowers,
  analyzeOrbits,
  detectClusters,
  findBridgeAccounts,
} from '../../src/graph/analyzer.js';
import { createGraph, addNode, addEdge } from '../../src/graph/builder.js';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a small test graph:
 *   alice → bob, alice → carol
 *   bob → alice  (mutual with alice)
 *   carol → dave
 *   dave → (nobody)
 */
function makeSimpleGraph() {
  const g = createGraph('alice');
  addNode(g, 'alice');
  addNode(g, 'bob');
  addNode(g, 'carol');
  addNode(g, 'dave');
  addEdge(g, 'alice', 'bob');
  addEdge(g, 'alice', 'carol');
  addEdge(g, 'bob', 'alice');   // mutual alice↔bob
  addEdge(g, 'carol', 'dave');
  return g;
}

// ============================================================================
// buildAdjacency
// ============================================================================

describe('buildAdjacency', () => {
  it('builds correct outgoing and incoming maps', () => {
    const g = makeSimpleGraph();
    const { outgoing, incoming } = buildAdjacency(g);

    expect(outgoing.get('alice').has('bob')).toBe(true);
    expect(outgoing.get('alice').has('carol')).toBe(true);
    expect(outgoing.get('bob').has('alice')).toBe(true);
    expect(incoming.get('alice').has('bob')).toBe(true);
    expect(incoming.get('bob').has('alice')).toBe(true);
  });

  it('ignores non-follows edges', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    addNode(g, 'bob');
    addEdge(g, 'alice', 'bob', 'likes');
    const { outgoing } = buildAdjacency(g);
    expect(outgoing.get('alice').size).toBe(0);
  });

  it('returns empty maps for a graph with no edges', () => {
    const g = createGraph('solo');
    addNode(g, 'solo');
    const { outgoing, incoming } = buildAdjacency(g);
    expect(outgoing.get('solo').size).toBe(0);
    expect(incoming.get('solo').size).toBe(0);
  });
});

// ============================================================================
// findMutualConnections
// ============================================================================

describe('findMutualConnections', () => {
  it('finds alice↔bob mutual pair', () => {
    const g = makeSimpleGraph();
    const mutuals = findMutualConnections(g);
    expect(mutuals).toHaveLength(1);
    expect(mutuals[0]).toMatchObject({ a: 'alice', b: 'bob' });
  });

  it('returns empty array when no mutuals exist', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    addNode(g, 'bob');
    addEdge(g, 'alice', 'bob'); // one-way only
    expect(findMutualConnections(g)).toHaveLength(0);
  });

  it('each mutual pair appears exactly once', () => {
    const g = createGraph('a');
    ['a', 'b', 'c'].forEach((u) => addNode(g, u));
    addEdge(g, 'a', 'b'); addEdge(g, 'b', 'a');
    addEdge(g, 'a', 'c'); addEdge(g, 'c', 'a');
    const mutuals = findMutualConnections(g);
    expect(mutuals).toHaveLength(2);
    // No duplicates
    const keys = mutuals.map((m) => `${m.a}:${m.b}`);
    expect(new Set(keys).size).toBe(2);
  });
});

// ============================================================================
// getMutualConnectionsFor
// ============================================================================

describe('getMutualConnectionsFor', () => {
  it('returns only mutual follows for the requested user', () => {
    const g = makeSimpleGraph();
    const mutuals = getMutualConnectionsFor(g, 'alice');
    expect(mutuals).toContain('bob');
    expect(mutuals).not.toContain('carol'); // alice→carol but carol!→alice
  });

  it('normalises @ prefix in username', () => {
    const g = makeSimpleGraph();
    const mutuals = getMutualConnectionsFor(g, '@alice');
    expect(mutuals).toContain('bob');
  });

  it('returns empty array for a user with no mutuals', () => {
    const g = makeSimpleGraph();
    expect(getMutualConnectionsFor(g, 'dave')).toHaveLength(0);
  });

  it('returns empty array for a user not in graph', () => {
    const g = makeSimpleGraph();
    expect(getMutualConnectionsFor(g, 'ghost')).toHaveLength(0);
  });
});

// ============================================================================
// computeInfluenceScores
// ============================================================================

describe('computeInfluenceScores', () => {
  it('returns a Map with an entry per node', () => {
    const g = makeSimpleGraph();
    const scores = computeInfluenceScores(g);
    expect(scores).toBeInstanceOf(Map);
    expect(scores.size).toBe(4);
  });

  it('returns empty Map for an empty graph', () => {
    const g = createGraph('nobody');
    expect(computeInfluenceScores(g).size).toBe(0);
  });

  it('scores are in the range [0, 100]', () => {
    const g = makeSimpleGraph();
    const scores = computeInfluenceScores(g);
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('a node with more in-links scores higher than an isolated node', () => {
    const g = createGraph('hub');
    ['hub', 'a', 'b', 'c', 'solo'].forEach((u) => addNode(g, u));
    // a, b, c all follow hub; solo is followed by no one
    addEdge(g, 'a', 'hub');
    addEdge(g, 'b', 'hub');
    addEdge(g, 'c', 'hub');
    const scores = computeInfluenceScores(g);
    expect(scores.get('hub')).toBeGreaterThan(scores.get('solo'));
  });
});

// ============================================================================
// getInfluenceRanking
// ============================================================================

describe('getInfluenceRanking', () => {
  it('returns array sorted descending by influenceScore', () => {
    const g = makeSimpleGraph();
    const ranking = getInfluenceRanking(g);
    for (let i = 1; i < ranking.length; i++) {
      expect(ranking[i - 1].influenceScore).toBeGreaterThanOrEqual(ranking[i].influenceScore);
    }
  });

  it('respects topN limit', () => {
    const g = makeSimpleGraph(); // 4 nodes
    const ranking = getInfluenceRanking(g, 2);
    expect(ranking).toHaveLength(2);
  });

  it('each entry has username and influenceScore fields', () => {
    const g = makeSimpleGraph();
    const ranking = getInfluenceRanking(g, 4);
    for (const entry of ranking) {
      expect(entry).toHaveProperty('username');
      expect(entry).toHaveProperty('influenceScore');
    }
  });
});

// ============================================================================
// findGhostFollowers
// ============================================================================

describe('findGhostFollowers', () => {
  it('detects a ghost follower (follows target, not followed back, outdegree ≤ 2)', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    addNode(g, 'ghost');
    // ghost follows alice but alice doesn't follow back; ghost has 0 other edges
    addEdge(g, 'ghost', 'alice');

    const ghosts = findGhostFollowers(g, 'alice');
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0].username).toBe('ghost');
    expect(ghosts[0].mutualFollow).toBe(false);
  });

  it('does not flag a mutual follower as ghost', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    addNode(g, 'bob');
    addEdge(g, 'bob', 'alice');
    addEdge(g, 'alice', 'bob'); // mutual → not a ghost
    expect(findGhostFollowers(g, 'alice')).toHaveLength(0);
  });

  it('does not flag a follower with more than 2 outgoing edges', () => {
    const g = createGraph('alice');
    ['alice', 'heavy', 'x', 'y', 'z'].forEach((u) => addNode(g, u));
    addEdge(g, 'heavy', 'alice');
    addEdge(g, 'heavy', 'x');
    addEdge(g, 'heavy', 'y');
    addEdge(g, 'heavy', 'z'); // outdegree = 4 → not a ghost
    expect(findGhostFollowers(g, 'alice')).toHaveLength(0);
  });

  it('handles @ prefix in username', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    addNode(g, 'ghost');
    addEdge(g, 'ghost', 'alice');
    expect(findGhostFollowers(g, '@alice')).toHaveLength(1);
  });
});

// ============================================================================
// analyzeOrbits
// ============================================================================

describe('analyzeOrbits', () => {
  it('returns correct orbit structure', () => {
    const g = makeSimpleGraph();
    const result = analyzeOrbits(g, 'alice');
    expect(result).toHaveProperty('seed', 'alice');
    expect(result).toHaveProperty('orbits');
    expect(result).toHaveProperty('summary');
    const { orbits } = result;
    expect(orbits).toHaveProperty('innerCircle');
    expect(orbits).toHaveProperty('active');
    expect(orbits).toHaveProperty('outerRing');
    expect(orbits).toHaveProperty('periphery');
  });

  it('places bob in active or innerCircle (mutual with alice)', () => {
    const g = makeSimpleGraph();
    const { orbits } = analyzeOrbits(g, 'alice').orbits
      ? analyzeOrbits(g, 'alice')
      : { orbits: analyzeOrbits(g, 'alice') };
    const allMutuals = [
      ...analyzeOrbits(g, 'alice').orbits.innerCircle.map((x) => x.username),
      ...analyzeOrbits(g, 'alice').orbits.active.map((x) => x.username),
    ];
    expect(allMutuals).toContain('bob');
  });

  it('summary counts match orbit array lengths', () => {
    const g = makeSimpleGraph();
    const result = analyzeOrbits(g, 'alice');
    expect(result.summary.innerCircle).toBe(result.orbits.innerCircle.length);
    expect(result.summary.active).toBe(result.orbits.active.length);
    expect(result.summary.outerRing).toBe(result.orbits.outerRing.length);
    expect(result.summary.periphery).toBe(result.orbits.periphery.length);
  });

  it('does not include the seed user in any orbit', () => {
    const g = makeSimpleGraph();
    const result = analyzeOrbits(g, 'alice');
    const allUsers = [
      ...result.orbits.innerCircle.map((x) => x.username),
      ...result.orbits.active.map((x) => x.username),
      ...result.orbits.outerRing.map((x) => x.username),
      ...result.orbits.periphery.map((x) => x.username),
    ];
    expect(allUsers).not.toContain('alice');
  });
});

// ============================================================================
// detectClusters
// ============================================================================

describe('detectClusters', () => {
  it('returns an array of clusters', () => {
    const g = makeSimpleGraph();
    const clusters = detectClusters(g);
    expect(Array.isArray(clusters)).toBe(true);
  });

  it('each cluster has id, size, members fields', () => {
    const g = makeSimpleGraph();
    const clusters = detectClusters(g);
    for (const c of clusters) {
      expect(c).toHaveProperty('id');
      expect(c).toHaveProperty('size');
      expect(c).toHaveProperty('members');
      expect(c.size).toBe(c.members.length);
    }
  });

  it('drops singleton clusters (size must be > 1)', () => {
    const g = makeSimpleGraph();
    const clusters = detectClusters(g);
    for (const c of clusters) {
      expect(c.size).toBeGreaterThan(1);
    }
  });

  it('returns empty array for a graph with no edges', () => {
    const g = createGraph('a');
    addNode(g, 'a');
    addNode(g, 'b');
    // No edges → every node is a singleton → all filtered out
    expect(detectClusters(g)).toHaveLength(0);
  });
});

// ============================================================================
// findBridgeAccounts
// ============================================================================

describe('findBridgeAccounts', () => {
  it('returns an array capped at topN', () => {
    const g = makeSimpleGraph();
    const bridges = findBridgeAccounts(g, 2);
    expect(bridges.length).toBeLessThanOrEqual(2);
  });

  it('each entry has username and betweenness fields', () => {
    const g = makeSimpleGraph();
    const bridges = findBridgeAccounts(g);
    for (const b of bridges) {
      expect(b).toHaveProperty('username');
      expect(b).toHaveProperty('betweenness');
      expect(typeof b.betweenness).toBe('number');
    }
  });

  it('sorted descending by betweenness', () => {
    const g = makeSimpleGraph();
    const bridges = findBridgeAccounts(g);
    for (let i = 1; i < bridges.length; i++) {
      expect(bridges[i - 1].betweenness).toBeGreaterThanOrEqual(bridges[i].betweenness);
    }
  });

  it('handles a graph with a single node without throwing', () => {
    const g = createGraph('solo');
    addNode(g, 'solo');
    expect(() => findBridgeAccounts(g)).not.toThrow();
  });
});
