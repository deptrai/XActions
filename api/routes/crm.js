// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * XActions CRM API Routes
 * Story 46.2: authenticate → validate → handler; sendData + next(err).
 * @author nich (@nichxbt) - https://github.com/nirholas
 * @license MIT
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/envelope.js';
import {
  CrmUsernameParams,
  CrmSegmentParams,
  CrmTagBody,
  CrmSearchQuery,
} from '../schemas/crm.js';

const router = Router();

// Require authentication for all CRM routes
router.use(authenticate);

// POST /api/crm/sync/:username
router.post('/sync/:username', validate({ params: CrmUsernameParams }), asyncHandler(async (req, res) => {
  const { syncFollowers } = await import('../../src/analytics/followerCRM.js');
  const result = await syncFollowers(req.params.username);
  res.sendData(result);
}));

// POST /api/crm/tag
router.post('/tag', validate({ body: CrmTagBody }), asyncHandler(async (req, res) => {
  const { tagContact } = await import('../../src/analytics/followerCRM.js');
  const { username, tag } = req.body;
  tagContact(username, tag);
  res.sendData({ status: 'tagged', username, tag });
}));

// GET /api/crm/search?q=...
router.get('/search', validate({ query: CrmSearchQuery }), asyncHandler(async (req, res) => {
  const { searchContacts } = await import('../../src/analytics/followerCRM.js');
  const results = searchContacts(req.query.q || '');
  res.sendData({ contacts: results });
}));

// GET /api/crm/segment/:name
router.get('/segment/:name', validate({ params: CrmSegmentParams }), asyncHandler(async (req, res) => {
  const { getSegment } = await import('../../src/analytics/followerCRM.js');
  const members = getSegment(req.params.name);
  res.sendData({ segment: req.params.name, members });
}));

// POST /api/crm/score — auto-score all contacts
router.post('/score', asyncHandler(async (req, res) => {
  const { autoScore } = await import('../../src/analytics/followerCRM.js');
  const result = autoScore();
  res.sendData(result);
}));

export default router;

// by nichxbt
