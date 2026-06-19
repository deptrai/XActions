// by nichxbt
import { describe, it, expect, beforeEach } from 'vitest';
import { generateReport } from '../../src/analytics/reports.js';
import { clearAlerts } from '../../src/analytics/alerts.js';

function makeMonitor(overrides = {}) {
  return {
    id: 'mon_test_1',
    target: 'nichxbt',
    stats: { volatility: 0.12 },
    ...overrides,
  };
}

function makeHistory(count, { label = 'positive', score = 0.5, daysAgo = 0 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(Date.now() - daysAgo * 86400000 - i * 60000).toISOString(),
    score,
    label,
    text: `tweet ${i} about the topic`,
    author: `user${i}`,
    tweetUrl: `https://x.com/user${i}/status/${i}`,
    keywords: ['topic', 'keyword'],
  }));
}

describe('generateReport', () => {
  beforeEach(() => clearAlerts());

  it('returns empty report when history is empty', () => {
    const monitor = makeMonitor();
    const { report } = generateReport(monitor, []);
    // Empty report has totalMentions at top level (not in summary)
    expect(report.totalMentions).toBe(0);
    expect(report.message).toMatch(/no data/i);
  });

  it('returns empty report when all history is outside the period', () => {
    const monitor = makeMonitor();
    const history = makeHistory(5, { daysAgo: 60 });
    const { report } = generateReport(monitor, history, { period: '7d' });
    expect(report.totalMentions).toBe(0);
  });

  it('returns correct totalMentions for data within period', () => {
    const monitor = makeMonitor();
    const history = makeHistory(10);
    const { report } = generateReport(monitor, history, { period: '7d' });
    expect(report.summary.totalMentions).toBe(10);
  });

  it('includes target and period in report', () => {
    const monitor = makeMonitor();
    const history = makeHistory(5);
    const { report } = generateReport(monitor, history, { period: '24h' });
    expect(report.target).toBe('nichxbt');
    expect(report.period).toBe('24h');
  });

  it('summary.averageSentiment is computed from data points', () => {
    const monitor = makeMonitor();
    const history = makeHistory(4, { score: 0.5, label: 'positive' });
    const { report } = generateReport(monitor, history);
    expect(report.summary.averageSentiment).toBeCloseTo(0.5, 2);
  });

  it('summary.distribution counts labels correctly', () => {
    const monitor = makeMonitor();
    const history = [
      ...makeHistory(3, { label: 'positive', score: 0.5 }),
      ...makeHistory(2, { label: 'negative', score: -0.5 }),
      ...makeHistory(1, { label: 'neutral', score: 0.0 }),
    ];
    const { report } = generateReport(monitor, history, { period: 'all' });
    expect(report.summary.distribution.positive).toBe(3);
    expect(report.summary.distribution.negative).toBe(2);
    expect(report.summary.distribution.neutral).toBe(1);
  });

  it('topPositive contains only positive-label items sorted by score desc', () => {
    const monitor = makeMonitor();
    const history = [
      { timestamp: new Date().toISOString(), score: 0.9, label: 'positive', text: 'great', author: 'a', keywords: [] },
      { timestamp: new Date().toISOString(), score: 0.3, label: 'positive', text: 'ok', author: 'b', keywords: [] },
      { timestamp: new Date().toISOString(), score: -0.5, label: 'negative', text: 'bad', author: 'c', keywords: [] },
    ];
    const { report } = generateReport(monitor, history, { period: 'all' });
    expect(report.topPositive.every(t => t.label === 'positive')).toBe(true);
    if (report.topPositive.length >= 2) {
      expect(report.topPositive[0].score).toBeGreaterThanOrEqual(report.topPositive[1].score);
    }
  });

  it('topNegative contains only negative-label items sorted by score asc', () => {
    const monitor = makeMonitor();
    const history = [
      { timestamp: new Date().toISOString(), score: -0.3, label: 'negative', text: 'meh', author: 'a', keywords: [] },
      { timestamp: new Date().toISOString(), score: -0.9, label: 'negative', text: 'awful', author: 'b', keywords: [] },
      { timestamp: new Date().toISOString(), score: 0.5, label: 'positive', text: 'great', author: 'c', keywords: [] },
    ];
    const { report } = generateReport(monitor, history, { period: 'all' });
    expect(report.topNegative.every(t => t.label === 'negative')).toBe(true);
    if (report.topNegative.length >= 2) {
      expect(report.topNegative[0].score).toBeLessThanOrEqual(report.topNegative[1].score);
    }
  });

  it('timeline is sorted by time ascending', () => {
    const monitor = makeMonitor();
    const history = makeHistory(20);
    const { report } = generateReport(monitor, history, { period: '7d' });
    for (let i = 1; i < report.timeline.length; i++) {
      expect(report.timeline[i].time >= report.timeline[i - 1].time).toBe(true);
    }
  });

  it('topKeywords aggregates keyword frequency', () => {
    const monitor = makeMonitor();
    const history = [
      { timestamp: new Date().toISOString(), score: 0.5, label: 'positive', text: 'great', author: 'a', keywords: ['alpha', 'beta'] },
      { timestamp: new Date().toISOString(), score: 0.4, label: 'positive', text: 'good', author: 'b', keywords: ['alpha', 'gamma'] },
      { timestamp: new Date().toISOString(), score: 0.3, label: 'positive', text: 'nice', author: 'c', keywords: ['beta'] },
    ];
    const { report } = generateReport(monitor, history, { period: 'all' });
    const alphaEntry = report.topKeywords.find(k => k.word === 'alpha');
    expect(alphaEntry?.count).toBe(2);
    const betaEntry = report.topKeywords.find(k => k.word === 'beta');
    expect(betaEntry?.count).toBe(2);
  });

  it('returns markdown string when format=markdown', () => {
    const monitor = makeMonitor();
    const history = makeHistory(5);
    const { markdown } = generateReport(monitor, history, { format: 'markdown', period: 'all' });
    expect(typeof markdown).toBe('string');
    expect(markdown).toContain('# 📊 Reputation Report');
    expect(markdown).toContain('nichxbt');
  });

  it('markdown is undefined when format=json (default)', () => {
    const monitor = makeMonitor();
    const history = makeHistory(5);
    const { markdown } = generateReport(monitor, history);
    expect(markdown).toBeUndefined();
  });

  it('empty markdown is returned when no data and format=markdown', () => {
    const monitor = makeMonitor();
    const { markdown } = generateReport(monitor, [], { format: 'markdown', period: '7d' });
    expect(markdown).toContain('No data available');
  });

  it('period "all" includes all history regardless of age', () => {
    const monitor = makeMonitor();
    const old = makeHistory(3, { daysAgo: 365 });
    const recent = makeHistory(3, { daysAgo: 1 });
    const { report } = generateReport(monitor, [...old, ...recent], { period: 'all' });
    expect(report.summary.totalMentions).toBe(6);
  });

  it('distributionPercent sums to ~100 for non-empty data', () => {
    const monitor = makeMonitor();
    const history = [
      ...makeHistory(5, { label: 'positive', score: 0.5 }),
      ...makeHistory(3, { label: 'negative', score: -0.5 }),
      ...makeHistory(2, { label: 'neutral', score: 0.0 }),
    ];
    const { report } = generateReport(monitor, history, { period: 'all' });
    const { positive, neutral, negative } = report.summary.distributionPercent;
    expect(positive + neutral + negative).toBeCloseTo(100, 0);
  });
});
