// by nichxbt
import { describe, it, expect } from 'vitest';
import { toD3, toGEXF, toHTML } from '../../src/graph/visualizer.js';
import { createGraph, addNode, addEdge } from '../../src/graph/builder.js';

// ============================================================================
// Helpers
// ============================================================================

function makeTestGraph() {
  const g = createGraph('alice');
  addNode(g, 'alice', { name: 'Alice', followers: 500 });
  addNode(g, 'bob',   { name: 'Bob',   followers: 200 });
  addNode(g, 'carol', { name: 'Carol', followers: 50  });
  addEdge(g, 'alice', 'bob');
  addEdge(g, 'bob',   'alice');
  addEdge(g, 'alice', 'carol');
  return g;
}

// ============================================================================
// toD3
// ============================================================================

describe('toD3', () => {
  it('returns an object with nodes and links arrays', () => {
    const g = makeTestGraph();
    const result = toD3(g);
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('links');
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.links)).toBe(true);
  });

  it('node count matches graph.nodes.size', () => {
    const g = makeTestGraph();
    expect(toD3(g).nodes).toHaveLength(3);
  });

  it('link count matches graph.edges.length', () => {
    const g = makeTestGraph();
    expect(toD3(g).links).toHaveLength(3);
  });

  it('each node has required D3 fields', () => {
    const g = makeTestGraph();
    for (const node of toD3(g).nodes) {
      expect(node).toHaveProperty('id');
      expect(node).toHaveProperty('name');
      expect(node).toHaveProperty('followers');
      expect(node).toHaveProperty('influence');
      expect(node).toHaveProperty('cluster');
      expect(node).toHaveProperty('isSeed');
    }
  });

  it('marks the seed node correctly', () => {
    const g = makeTestGraph();
    const nodes = toD3(g).nodes;
    const seed = nodes.find((n) => n.id === 'alice');
    expect(seed.isSeed).toBe(true);
    const nonSeed = nodes.find((n) => n.id === 'bob');
    expect(nonSeed.isSeed).toBe(false);
  });

  it('influence scores are numbers in [0, 100]', () => {
    const g = makeTestGraph();
    for (const node of toD3(g).nodes) {
      expect(node.influence).toBeGreaterThanOrEqual(0);
      expect(node.influence).toBeLessThanOrEqual(100);
    }
  });

  it('handles an empty graph without throwing', () => {
    const g = createGraph('empty');
    expect(() => toD3(g)).not.toThrow();
    const result = toD3(g);
    expect(result.nodes).toHaveLength(0);
    expect(result.links).toHaveLength(0);
  });

  it('bio is truncated to 200 chars', () => {
    const g = createGraph('alice');
    addNode(g, 'alice', { bio: 'x'.repeat(300) });
    const node = toD3(g).nodes[0];
    expect(node.bio.length).toBeLessThanOrEqual(200);
  });
});

// ============================================================================
// toGEXF
// ============================================================================

describe('toGEXF', () => {
  it('returns a string', () => {
    const g = makeTestGraph();
    expect(typeof toGEXF(g)).toBe('string');
  });

  it('output is valid XML (starts with XML declaration)', () => {
    const g = makeTestGraph();
    expect(toGEXF(g).trimStart()).toMatch(/^<\?xml/);
  });

  it('contains a node entry for each graph node', () => {
    const g = makeTestGraph();
    const xml = toGEXF(g);
    expect(xml).toContain('id="alice"');
    expect(xml).toContain('id="bob"');
    expect(xml).toContain('id="carol"');
  });

  it('contains an edge entry for each graph edge', () => {
    const g = makeTestGraph();
    const xml = toGEXF(g);
    // 3 edges → 3 <edge id="N" ...> entries
    const matches = xml.match(/<edge id="/g);
    expect(matches).toHaveLength(3);
  });

  it('escapes XML special characters in node labels', () => {
    const g = createGraph('alice');
    addNode(g, 'alice', { name: 'A & B <test>' });
    const xml = toGEXF(g);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).not.toContain('A & B'); // raw ampersand must be escaped
  });

  it('includes seed username in description', () => {
    const g = makeTestGraph();
    expect(toGEXF(g)).toContain('@alice');
  });
});

// ============================================================================
// toHTML
// ============================================================================

describe('toHTML', () => {
  it('returns a string', () => {
    const g = makeTestGraph();
    expect(typeof toHTML(g)).toBe('string');
  });

  it('is a complete HTML document', () => {
    const g = makeTestGraph();
    const html = toHTML(g);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
  });

  it('embeds graph data as JSON', () => {
    const g = makeTestGraph();
    const html = toHTML(g);
    expect(html).toContain('const graphData =');
    // The JSON should include node ids
    expect(html).toContain('"alice"');
  });

  it('includes D3 script tag', () => {
    const g = makeTestGraph();
    expect(toHTML(g)).toContain('d3');
  });

  it('node count in subtitle reflects actual graph size', () => {
    const g = makeTestGraph();
    const html = toHTML(g);
    // The template renders: "N accounts · M connections"
    expect(html).toContain('3 accounts');
    expect(html).toContain('3 connections');
  });

  it('handles empty graph without throwing', () => {
    const g = createGraph('empty');
    expect(() => toHTML(g)).not.toThrow();
  });
});
