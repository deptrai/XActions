// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import {
  registerBenchmarkCommand,
  formatBenchmarkTable,
  formatScraperDetail,
} from '../../src/cli/commands/benchmark.js';

describe('Story 34.5: Operator Scorecard CLI Unit Tests', () => {
  let program;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    program = new Command();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('registers the benchmark command with list and detail subcommands', () => {
    registerBenchmarkCommand(program);
    const benchmarkCmd = program.commands.find((c) => c.name() === 'benchmark');
    expect(benchmarkCmd).toBeDefined();
    expect(benchmarkCmd.description()).toContain('benchmark');

    const subcommands = benchmarkCmd.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('detail');
  });

  describe('formatBenchmarkTable helper', () => {
    it('formats a list of scrapers into an aligned ASCII table', () => {
      const records = [
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
      ];

      const table = formatBenchmarkTable(records);
      expect(table).toContain('twitter-hybrid');
      expect(table).toContain('pasgo-merchant');
      expect(table).toContain('94.2');
      expect(table).toContain('62.1');
      expect(table).toContain('ALERT'); // Tier C has ALERT flag
    });

    it('returns a friendly message when no evaluations exist', () => {
      const emptyTable = formatBenchmarkTable([]);
      expect(emptyTable).toContain('No benchmark scores available yet');
    });
  });

  describe('formatScraperDetail helper', () => {
    it('formats detailed scorecard with metrics snapshot and knockouts', () => {
      const detail = {
        scraperId: 'twitter-hybrid',
        platform: 'twitter',
        healthScore: 94.2,
        tier: 'A',
        stabilityScore: 95.0,
        qualityScore: 92.0,
        noiseScore: 96.0,
        costScore: 92.0,
        sampleCount: 1240,
        consecutiveCleanRuns: 12,
        requalifiedAt: null,
        evaluatedAt: new Date('2026-09-08T10:00:00Z'),
        metricsSnapshot: {
          knockoutTriggered: false,
          knockoutReasons: [],
          raw: {
            true_success_rate: 0.985,
            latency_p95: 2200,
            false_200_rate: 0.002,
            field_fill_rate: 0.97,
            schema_integrity_rate: 0.99,
            proxy_bytes_per_1k: 25000000,
          },
        },
      };

      const history = [
        { healthScore: 93.8, tier: 'A', evaluatedAt: new Date('2026-09-08T09:00:00Z') },
        { healthScore: 94.2, tier: 'A', evaluatedAt: new Date('2026-09-08T10:00:00Z') },
      ];

      const output = formatScraperDetail(detail, history);
      expect(output).toContain('Scorecard: twitter-hybrid');
      expect(output).toContain('94.2');
      expect(output).toContain('Stability');
      expect(output).toContain('Quality');
      expect(output).toContain('Noise');
      expect(output).toContain('Cost');
      expect(output).toContain('Knock-Out Gates: PASSED');
      expect(output).toContain('98.5%'); // true_success_rate formatted
      expect(output).toContain('Evaluation History (Recent)');
    });

    it('displays TRIGGERED knockouts with exact reasons when present', () => {
      const failingDetail = {
        scraperId: 'failing-scraper',
        platform: 'social',
        healthScore: 78.5,
        tier: 'C',
        stabilityScore: 75.0,
        qualityScore: 80.0,
        noiseScore: 82.0,
        costScore: 77.0,
        sampleCount: 200,
        metricsSnapshot: {
          knockoutTriggered: true,
          knockoutReasons: ['True Success Rate < 80%', 'False 200 Rate > 15%'],
          raw: {},
        },
      };

      const output = formatScraperDetail(failingDetail, []);
      expect(output).toContain('Scorecard: failing-scraper');
      expect(output).toContain('Knock-Out Gates: TRIGGERED');
      expect(output).toContain('True Success Rate < 80%');
      expect(output).toContain('False 200 Rate > 15%');
    });
  });

  describe('CLI Action Handlers with Mocked Deps', () => {
    it('executes list command with --tier C filter and logs formatted table', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findMany: vi.fn().mockResolvedValue([
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
          ]),
        },
      };

      registerBenchmarkCommand(program, { prisma: mockPrisma });
      await program.parseAsync(['node', 'test', 'benchmark', 'list', '--tier', 'C']);

      expect(mockPrisma.scraperHealthScore.findMany).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    });

    it('executes list command with --format json', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findMany: vi.fn().mockResolvedValue([
            {
              scraperId: 'twitter-hybrid',
              platform: 'twitter',
              healthScore: 94.2,
              tier: 'A',
            },
          ]),
        },
      };

      registerBenchmarkCommand(program, { prisma: mockPrisma });
      await program.parseAsync(['node', 'test', 'benchmark', 'list', '--format', 'json']);

      expect(logSpy).toHaveBeenCalled();
      const loggedJson = logSpy.mock.calls[0][0];
      const parsed = JSON.parse(loggedJson);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].scraperId).toBe('twitter-hybrid');
    });

    it('executes detail command and prints error when scraper is not found', async () => {
      const mockPrisma = {
        scraperHealthScore: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      };

      registerBenchmarkCommand(program, { prisma: mockPrisma });
      await program.parseAsync(['node', 'test', 'benchmark', 'detail', 'non-existent']);

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0]).toContain('not found');
    });
  });
});
