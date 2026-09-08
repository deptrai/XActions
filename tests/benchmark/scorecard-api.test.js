// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import benchmarkRoutes, { createBenchmarkRouter } from '../../api/routes/benchmark.js';

describe('Story 34.5: Benchmark REST API Endpoints Unit Tests', () => {
  const mockPrisma = {
    scraperHealthScore: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const mockCache = {
    get: vi.fn(),
  };

  const app = express();
  app.use(express.json());
  app.use('/api/benchmark', createBenchmarkRouter({ prisma: mockPrisma, healthTierCache: mockCache }));

  it('GET /api/benchmark/summary returns aggregated list, tier counts, and avgScore', async () => {
    mockPrisma.scraperHealthScore.findMany.mockResolvedValueOnce([
      {
        scraperId: 'twitter-hybrid',
        platform: 'twitter',
        healthScore: 94.2,
        tier: 'A',
        stabilityScore: 95.0,
        qualityScore: 92.0,
        noiseScore: 96.0,
        costScore: 92.0,
        sampleCount: 1240,
        evaluatedAt: new Date('2026-09-08T10:00:00Z'),
      },
      {
        scraperId: 'pasgo-merchant',
        platform: 'fnb',
        healthScore: 62.1,
        tier: 'C',
        stabilityScore: 70.0,
        qualityScore: 80.0,
        noiseScore: 40.0,
        costScore: 50.0,
        sampleCount: 320,
        evaluatedAt: new Date('2026-09-08T10:00:00Z'),
      },
    ]);

    mockCache.get.mockImplementation((id) => (id === 'twitter-hybrid' ? 'A' : 'C'));

    const res = await request(app).get('/api/benchmark/summary');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('scrapers');
    expect(res.body.scrapers.length).toBe(2);
    expect(res.body).toHaveProperty('counts');
    expect(res.body.counts.tierA).toBe(1);
    expect(res.body.counts.tierC).toBe(1);
    expect(res.body.counts.total).toBe(2);
    expect(res.body.avgScore).toBeCloseTo(78.15, 1);
  });

  it('GET /api/benchmark/scrapers/:id returns 404 when scraper does not exist', async () => {
    mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce(null);

    const res = await request(app).get('/api/benchmark/scrapers/unknown-scraper');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/benchmark/scrapers/:id returns detailed record with metricsSnapshot', async () => {
    mockPrisma.scraperHealthScore.findFirst.mockResolvedValueOnce({
      scraperId: 'twitter-hybrid',
      platform: 'twitter',
      healthScore: 94.2,
      tier: 'A',
      stabilityScore: 95.0,
      qualityScore: 92.0,
      noiseScore: 96.0,
      costScore: 92.0,
      sampleCount: 1240,
      consecutiveCleanRuns: 8,
      requalifiedAt: null,
      evaluatedAt: new Date('2026-09-08T10:00:00Z'),
      metricsSnapshot: {
        raw: { true_success_rate: 0.985 },
        knockoutTriggered: false,
        knockoutReasons: [],
      },
    });

    const res = await request(app).get('/api/benchmark/scrapers/twitter-hybrid');
    expect(res.status).toBe(200);
    expect(res.body.scraperId).toBe('twitter-hybrid');
    expect(res.body.healthScore).toBe(94.2);
    expect(res.body.tier).toBe('A');
    expect(res.body).toHaveProperty('metricsSnapshot');
  });

  it('GET /api/benchmark/history/:id returns time series history array', async () => {
    mockPrisma.scraperHealthScore.findMany.mockResolvedValueOnce([
      { healthScore: 92.0, tier: 'A', evaluatedAt: new Date('2026-09-08T08:00:00Z') },
      { healthScore: 94.2, tier: 'A', evaluatedAt: new Date('2026-09-08T10:00:00Z') },
    ]);

    const res = await request(app).get('/api/benchmark/history/twitter-hybrid');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
    expect(res.body.history.length).toBe(2);
  });

  it('GET /api/benchmark/summary handles database error with 500', async () => {
    mockPrisma.scraperHealthScore.findMany.mockRejectedValueOnce(new Error('DB Connection Failed'));

    const res = await request(app).get('/api/benchmark/summary');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/benchmark/scrapers/:id handles database error with 500', async () => {
    mockPrisma.scraperHealthScore.findFirst.mockRejectedValueOnce(new Error('Query timeout'));

    const res = await request(app).get('/api/benchmark/scrapers/twitter-hybrid');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/benchmark/scrapers/:id returns 400 when id is invalid or too long', async () => {
    const invalidId = 'a'.repeat(129);
    const res = await request(app).get(`/api/benchmark/scrapers/${invalidId}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid scraper ID');
  });

  it('GET /api/benchmark/history/:id returns 400 when id is invalid or too long', async () => {
    const invalidId = 'a'.repeat(129);
    const res = await request(app).get(`/api/benchmark/history/${invalidId}`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid scraper ID');
  });

  it('GET /api/benchmark/history/:id handles database error with 500', async () => {
    mockPrisma.scraperHealthScore.findMany.mockRejectedValueOnce(new Error('Deadlock detected'));

    const res = await request(app).get('/api/benchmark/history/twitter-hybrid');
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });
});
