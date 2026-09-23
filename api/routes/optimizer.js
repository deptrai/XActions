// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions AI Content Optimizer API Routes
 * Story 46.2: Zod validate → handler; sendData + next(err).
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/envelope.js';
import {
  OptimizeBody,
  HashtagsBody,
  PredictBody,
  VariationsBody,
} from '../schemas/optimizer.js';

const router = Router();

// POST /api/optimizer/optimize
router.post('/optimize', validate({ body: OptimizeBody }), asyncHandler(async (req, res) => {
  const { optimizeTweet } = await import('../../src/ai/contentOptimizer.js');
  const { text, goal } = req.body;
  const result = await optimizeTweet(text, { goal: goal || 'engagement' });
  res.sendData(result);
}));

// POST /api/optimizer/hashtags
router.post('/hashtags', validate({ body: HashtagsBody }), asyncHandler(async (req, res) => {
  const { suggestHashtags } = await import('../../src/ai/contentOptimizer.js');
  const result = await suggestHashtags(req.body.text, { count: req.body.count });
  res.sendData(result);
}));

// POST /api/optimizer/predict
router.post('/predict', validate({ body: PredictBody }), asyncHandler(async (req, res) => {
  const { predictPerformance } = await import('../../src/ai/contentOptimizer.js');
  const result = await predictPerformance(req.body.text);
  res.sendData(result);
}));

// POST /api/optimizer/variations
router.post('/variations', validate({ body: VariationsBody }), asyncHandler(async (req, res) => {
  const { generateVariations } = await import('../../src/ai/contentOptimizer.js');
  const result = await generateVariations(req.body.text, req.body.count);
  res.sendData({ variations: result });
}));

export default router;

// by nichxbt
