// by nichxbt
import { describe, it, expect } from 'vitest';
import {
  createGraph,
  addNode,
  addEdge,
  serializeGraph,
  deserializeGraph,
} from '../../src/graph/builder.js';

// ============================================================================
// createGraph
// ============================================================================

describe('createGraph', () => {
  it('creates a graph with correct seed and empty collections', () => {
    const g = createGraph('alice');
    expect(g.seed).toBe('alice');
    expect(g.nodes).toBeInstanceOf(Map);
    expect(g.nodes.size).toBe(0);
    expect(g.edges).toEqual([]);
    expect(g.metadata.status).toBe('pending');
    expect(g.metadata.nodesCount).toBe(0);
    expect(g.metadata.edgesCount).toBe(0);
  });

  it('assigns a unique id and ISO timestamps', () => {
    const g1 = createGraph('alice');
    const g2 = createGraph('alice');
    expect(g1.id).not.toBe(g2.id);
    expect(() => new Date(g1.createdAt)).not.toThrow();
  });

  it('handles @ prefix in seed username gracefully', () => {
    // createGraph stores the seed as-is; normalization happens in addNode
    const g = createGraph('@bob');
    expect(g.seed).toBe('@bob');
  });
});

// ============================================================================
// addNode
// ============================================================================

describe('addNode', () => {
  it('adds a new node with normalised lowercase key', () => {
    const g = createGraph('alice');
    const node = addNode(g, 'Alice', { followers: 100 });
    expect(g.nodes.has('alice')).toBe(true);
    expect(node.username).toBe('alice');
    expect(node.followers).toBe(100);
  });

  it('strips leading @ from username', () => {
    const g = createGraph('alice');
    addNode(g, '@bob');
    expect(g.nodes.has('bob')).toBe(true);
    expect(g.nodes.has('@bob')).toBe(false);
  });

  it('merges data when node already exists', () => {
    const g = createGraph('alice');
    addNode(g, 'alice', { followers: 10 });
    addNode(g, 'alice', { followers: 999, bio: 'updated' });
    const node = g.nodes.get('alice');
    expect(node.followers).toBe(999);
    expect(node.bio).toBe('updated');
    expect(g.nodes.size).toBe(1); // still one node
  });

  it('increments metadata.nodesCount', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    addNode(g, 'bob');
    expect(g.metadata.nodesCount).toBe(2);
  });

  it('fills defaults for missing fields', () => {
    const g = createGraph('alice');
    const node = addNode(g, 'alice');
    expect(node.followers).toBe(0);
    expect(node.following).toBe(0);
    expect(node.verified).toBe(false);
    expect(node.crawled).toBe(false);
  });
});

// ============================================================================
// addEdge
// ============================================================================

describe('addEdge', () => {
  it('adds a directed follows edge', () => {
    const g = createGraph('alice');
    addEdge(g, 'alice', 'bob');
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0]).toMatchObject({ source: 'alice', target: 'bob', type: 'follows' });
  });

  it('normalises username casing and strips @', () => {
    const g = createGraph('alice');
    addEdge(g, '@Alice', '@BOB');
    expect(g.edges[0].source).toBe('alice');
    expect(g.edges[0].target).toBe('bob');
  });

  it('does not add duplicate edges of the same type', () => {
    const g = createGraph('alice');
    addEdge(g, 'alice', 'bob', 'follows');
    addEdge(g, 'alice', 'bob', 'follows');
    expect(g.edges).toHaveLength(1);
  });

  it('allows different edge types between the same pair', () => {
    const g = createGraph('alice');
    addEdge(g, 'alice', 'bob', 'follows');
    addEdge(g, 'alice', 'bob', 'likes');
    expect(g.edges).toHaveLength(2);
  });

  it('increments metadata.edgesCount', () => {
    const g = createGraph('alice');
    addEdge(g, 'alice', 'bob');
    addEdge(g, 'bob', 'carol');
    expect(g.metadata.edgesCount).toBe(2);
  });
});

// ============================================================================
// serializeGraph / deserializeGraph (round-trip)
// ============================================================================

describe('serializeGraph + deserializeGraph', () => {
  it('round-trips a graph with nodes and edges', () => {
    const g = createGraph('alice');
    addNode(g, 'alice', { followers: 50 });
    addNode(g, 'bob', { followers: 20 });
    addEdge(g, 'alice', 'bob');

    const serialized = serializeGraph(g);
    // nodes must be a plain array for JSON safety
    expect(Array.isArray(serialized.nodes)).toBe(true);
    expect(serialized.nodes).toHaveLength(2);

    const restored = deserializeGraph(serialized);
    expect(restored.nodes).toBeInstanceOf(Map);
    expect(restored.nodes.size).toBe(2);
    expect(restored.nodes.get('alice').followers).toBe(50);
    expect(restored.edges).toHaveLength(1);
    expect(restored.seed).toBe('alice');
  });

  it('handles an empty graph without throwing', () => {
    const g = createGraph('empty');
    const serialized = serializeGraph(g);
    const restored = deserializeGraph(serialized);
    expect(restored.nodes.size).toBe(0);
    expect(restored.edges).toHaveLength(0);
  });

  it('is JSON-safe (no Map or Set in serialized form)', () => {
    const g = createGraph('alice');
    addNode(g, 'alice');
    const serialized = serializeGraph(g);
    expect(() => JSON.stringify(serialized)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(serialized));
    expect(parsed.nodes).toBeInstanceOf(Array);
  });
});
