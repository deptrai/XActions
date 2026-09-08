import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BenchmarkRetentionCleaner } from '../../api/services/benchmark/retention-cleaner.js';

describe('BenchmarkRetentionCleaner Unit Tests', () => {
  let mockPrisma;
  let cleaner;

  beforeEach(() => {
    mockPrisma = {
      scraperHealthScore: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      scraperCanaryRun: {
        findMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };

    cleaner = new BenchmarkRetentionCleaner({ prisma: mockPrisma, batchSize: 2, batchDelayMs: 5 });
  });

  it('purges ScraperHealthScore rows older than 90 days in batches', async () => {
    // Return 2 IDs for first batch, then empty for second batch
    mockPrisma.scraperHealthScore.findMany
      .mockResolvedValueOnce([{ id: 'h1' }, { id: 'h2' }])
      .mockResolvedValueOnce([]);

    mockPrisma.scraperHealthScore.deleteMany.mockResolvedValue({ count: 2 });

    const result = await cleaner.cleanHealthScores(90);

    expect(result.deletedCount).toBe(2);
    expect(mockPrisma.scraperHealthScore.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.scraperHealthScore.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['h1', 'h2'] } },
    });
  });

  it('purges ScraperCanaryRun rows older than 30 days in batches', async () => {
    mockPrisma.scraperCanaryRun.findMany
      .mockResolvedValueOnce([{ id: 'c1' }, { id: 'c2' }])
      .mockResolvedValueOnce([]);

    mockPrisma.scraperCanaryRun.deleteMany.mockResolvedValue({ count: 2 });

    const result = await cleaner.cleanCanaryRuns(30);

    expect(result.deletedCount).toBe(2);
    expect(mockPrisma.scraperCanaryRun.findMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.scraperCanaryRun.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] } },
    });
  });

  it('runs all retention cleanups with cleanAll()', async () => {
    mockPrisma.scraperHealthScore.findMany.mockResolvedValue([]);
    mockPrisma.scraperCanaryRun.findMany.mockResolvedValue([]);

    const summary = await cleaner.cleanAll();
    expect(summary).toEqual({
      healthScoresDeleted: 0,
      canaryRunsDeleted: 0,
      success: true,
    });
  });
});
