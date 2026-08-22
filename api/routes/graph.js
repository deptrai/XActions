// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions Social Graph API Routes
 *
 * Routes:
 *   POST   /api/graph/build          — Start graph crawl (background job)
 *   GET    /api/graph                 — List saved graphs
 *   GET    /api/graph/:id             — Get graph data
 *   GET    /api/graph/:id/analysis    — Get computed metrics
 *   GET    /api/graph/:id/recommendations — Get follow/engage recommendations
 *   GET    /api/graph/:id/visualization — Get D3.js-ready JSON (or ?format=gexf|html)
 *   DELETE /api/graph/:id             — Delete a saved graph
 *
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import express from 'express';
/**
 * @typedef {import('@prisma/client').User} User
 */
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Require authentication for all graph routes
router.use(authenticate);

/**
 * @typedef {Object} GraphModule
 * @property {(username: string, opts: Record<string, unknown>) => Promise<Record<string, unknown>>} build
 * @property {() => Promise<Record<string, unknown>[]>} list
 * @property {(id: string) => Promise<Record<string, unknown> | null>} get
 * @property {(id: string) => Promise<boolean>} delete
 * @property {(data: Record<string, unknown>) => Record<string, unknown>} serializeGraph
 * @property {(data: Record<string, unknown>) => Record<string, unknown>} analyze
 * @property {(data: Record<string, unknown>, seed: unknown) => Record<string, unknown>} recommend
 * @property {(data: Record<string, unknown>, format: string) => string | Record<string, unknown>} visualize
 */

// Lazy-load graph module to avoid circular deps
let _graph = /** @type {GraphModule | null} */ (null);
async function getGraph() {
  if (!_graph) {
    const mod = await import('../../src/graph/index.js');
    _graph = /** @type {GraphModule} */ (mod.default);
  }
  return _graph;
}

// ============================================================================
// Build
// ============================================================================

/**
 * POST /api/graph/build — Start a graph crawl
 * Body: { username, depth?, maxFollowers?, maxFollowing?, maxNodes?, authToken? }
 */
router.post('/build', async (req, res) => {
  const reqUser = /** @type {User} */ (req.user);

  try {
    const graph = await getGraph();
    if (!graph) {
      return res.status(500).json({ error: 'Graph module unavailable' });
    }
    const body = /** @type {Record<string, unknown>} */ (req.body);
    const username = String(body.username || '');
    const depth = Number(body.depth) || 2;
    const maxFollowers = Number(body.maxFollowers) || 200;
    const maxFollowing = Number(body.maxFollowing) || 200;
    const maxNodes = Number(body.maxNodes) || 500;
    const authToken = body.authToken ? String(body.authToken) : undefined;

    if (!username) {
      return res.status(400).json({ error: '"username" is required' });
    }

    // For small graphs, run inline. For large crawls, return immediately.
    const isLarge = depth > 1 || maxNodes > 200;

    if (isLarge) {
      // Run in background, return immediately
      const buildPromise = graph.build(username, {
        depth,
        maxFollowers,
        maxFollowing,
        maxNodes,
        authToken: authToken || reqUser?.sessionCookie,
      });

      buildPromise.then((/** @type {Record<string, unknown> & { nodes?: unknown[]; id?: string }} */ result) => {
        const nodes = Array.isArray(result.nodes) ? result.nodes.length : 0;
        console.log(`✅ Graph build complete: @${username} — ${nodes} nodes`);
        // Emit Socket.IO event if available
        const io = req.app && /** @type {{ emit: (event: string, data: unknown) => void }} */ (req.app.get('io'));
        if (io) {
          io.emit('graph:complete', { graphId: result.id, seed: username, nodesCount: nodes });
        }
      }).catch((/** @type {unknown} */ err) => {
        console.error(`❌ Graph build failed for @${username}: ${err instanceof Error ? err.message : String(err)}`);
      });

      return res.status(202).json({
        message: 'Graph build started — this may take several minutes for large networks',
        username,
        depth,
        maxNodes,
        status: 'crawling',
      });
    }

    // Small graph — run inline
    const result = await graph.build(username, {
      depth,
      maxFollowers,
      maxFollowing,
      maxNodes,
      authToken: authToken || reqUser?.sessionCookie,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('❌ Graph build error:', (error instanceof Error ? error.message : String(error)));
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// ============================================================================
// List / Get / Delete
// ============================================================================

/**
 * GET /api/graph — List all saved graphs
 */
router.get('/', async (req, res) => {
  try {
    const graph = await getGraph();
    if (!graph) return res.status(500).json({ error: 'Graph module unavailable' });
    const graphs = await graph.list();
    res.json({ graphs, count: graphs.length });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/graph/:id — Get a specific graph
 */
router.get('/:id', async (req, res) => {
  try {
    const graph = await getGraph();
    if (!graph) return res.status(500).json({ error: 'Graph module unavailable' });
    const data = await graph.get(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Graph not found' });
    }
    res.json(graph.serializeGraph(data));
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * DELETE /api/graph/:id — Delete a saved graph
 */
router.delete('/:id', async (req, res) => {
  try {
    const graph = await getGraph();
    if (!graph) return res.status(500).json({ error: 'Graph module unavailable' });
    const deleted = await graph.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Graph not found' });
    }
    res.json({ success: true, message: 'Graph deleted' });
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

// ============================================================================
// Analysis & Recommendations
// ============================================================================

/**
 * GET /api/graph/:id/analysis — Get computed graph metrics
 */
router.get('/:id/analysis', async (req, res) => {
  try {
    const graphMod = await getGraph();
    if (!graphMod) return res.status(500).json({ error: 'Graph module unavailable' });
    const data = await graphMod.get(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Graph not found' });
    }
    const analysis = graphMod.analyze(data);
    res.json(analysis);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/graph/:id/recommendations — Get follow/engage recommendations
 */
router.get('/:id/recommendations', async (req, res) => {
  try {
    const graphMod = await getGraph();
    if (!graphMod) return res.status(500).json({ error: 'Graph module unavailable' });
    const data = await graphMod.get(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Graph not found' });
    }
    const recs = graphMod.recommend(data, data.seed);
    res.json(recs);
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

/**
 * GET /api/graph/:id/visualization — Get visualization data
 * Query: ?format=d3|gexf|html (default: d3)
 */
router.get('/:id/visualization', async (req, res) => {
  try {
    const graphMod = await getGraph();
    if (!graphMod) return res.status(500).json({ error: 'Graph module unavailable' });
    const data = await graphMod.get(req.params.id);
    if (!data) {
      return res.status(404).json({ error: 'Graph not found' });
    }

    const format = req.query.format || 'd3';
    const result = graphMod.visualize(data, format);

    if (format === 'html') {
      res.type('text/html').send(result);
    } else if (format === 'gexf' || format === 'gephi') {
      res.type('application/xml').send(result);
    } else {
      res.json(result);
    }
  } catch (error) {
    res.status(500).json({ error: (error instanceof Error ? error.message : String(error)) });
  }
});

export default router;
