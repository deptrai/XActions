// by nichxbt
import { describe, it, expect, beforeEach } from 'vitest';
import { checkAlerts, getAlerts, clearAlerts } from '../../src/analytics/alerts.js';

// Helper: build a monitor object
function makeMonitor(overrides = {}) {
  return {
    id: 'test_monitor_1',
    target: 'nichxbt',
    alertConfig: {},
    history: [],
    stats: { totalPolls: 1 },
    ...overrides,
  };
}

// Helper: build data points
function makePoints(scores, label = null) {
  return scores.map(score => ({
    score,
    label: label ?? (score > 0.05 ? 'positive' : score < -0.05 ? 'negative' : 'neutral'),
    text: 'sample tweet',
  }));
}

describe('checkAlerts', () => {
  beforeEach(() => clearAlerts());

  it('returns empty array for empty newPoints', () => {
    const monitor = makeMonitor();
    expect(checkAlerts(monitor, [])).toEqual([]);
    expect(checkAlerts(monitor, null)).toEqual([]);
  });

  it('fires sentiment_threshold alert when avg score < default threshold (-0.3)', () => {
    const monitor = makeMonitor();
    const points = makePoints([-0.8, -0.9, -0.7], 'negative');
    const alerts = checkAlerts(monitor, points);
    expect(alerts.some(a => a.type === 'sentiment_threshold')).toBe(true);
  });

  it('does NOT fire sentiment_threshold alert when avg score is above threshold', () => {
    const monitor = makeMonitor();
    const points = makePoints([0.5, 0.6, 0.4], 'positive');
    const alerts = checkAlerts(monitor, points);
    expect(alerts.some(a => a.type === 'sentiment_threshold')).toBe(false);
  });

  it('uses custom sentimentThreshold from alertConfig', () => {
    const monitor = makeMonitor({ alertConfig: { sentimentThreshold: 0.1 } });
    // avg = 0.05, which is < 0.1 threshold
    const points = makePoints([0.05, 0.05], 'neutral');
    const alerts = checkAlerts(monitor, points);
    expect(alerts.some(a => a.type === 'sentiment_threshold')).toBe(true);
  });

  it('assigns critical severity when avg score < -0.6', () => {
    const monitor = makeMonitor();
    const points = makePoints([-0.9, -0.8, -0.95], 'negative');
    const alerts = checkAlerts(monitor, points);
    const thresholdAlert = alerts.find(a => a.type === 'sentiment_threshold');
    expect(thresholdAlert?.severity).toBe('critical');
  });

  it('assigns warning severity when avg score is between threshold and -0.6', () => {
    const monitor = makeMonitor();
    // avg = -0.4: below -0.3 default threshold but above -0.6
    const points = makePoints([-0.4, -0.4, -0.4], 'negative');
    const alerts = checkAlerts(monitor, points);
    const thresholdAlert = alerts.find(a => a.type === 'sentiment_threshold');
    expect(thresholdAlert?.severity).toBe('warning');
  });

  it('does NOT fire volume_spike alert when history is too short (< 20)', () => {
    const monitor = makeMonitor({ history: makePoints([0.1, 0.2]) }); // only 2 history pts
    const points = makePoints([0.1, 0.1, 0.1, 0.1, 0.1]);
    const alerts = checkAlerts(monitor, points);
    expect(alerts.some(a => a.type === 'volume_spike')).toBe(false);
  });

  it('fires volume_spike alert when new points exceed avg * multiplier', () => {
    // Build a history of 30 points, with ~2 polls worth → avg ~1 per poll
    const history = makePoints(Array(30).fill(0.1));
    const monitor = makeMonitor({
      history,
      stats: { totalPolls: 30 }, // so avgPerPoll ≈ 1
    });
    // Send 10 new points — 10x the avg, exceeds default multiplier of 3
    const points = makePoints(Array(10).fill(0.1));
    const alerts = checkAlerts(monitor, points);
    expect(alerts.some(a => a.type === 'volume_spike')).toBe(true);
  });

  it('alert objects have required fields', () => {
    const monitor = makeMonitor();
    const points = makePoints([-0.8, -0.9], 'negative');
    const alerts = checkAlerts(monitor, points);
    expect(alerts.length).toBeGreaterThan(0);
    const alert = alerts[0];
    expect(alert).toHaveProperty('id');
    expect(alert).toHaveProperty('type');
    expect(alert).toHaveProperty('severity');
    expect(alert).toHaveProperty('message');
    expect(alert).toHaveProperty('monitorId');
    expect(alert).toHaveProperty('target');
    expect(alert).toHaveProperty('data');
    expect(alert).toHaveProperty('timestamp');
  });

  it('adds fired alerts to history accessible via getAlerts', () => {
    const monitor = makeMonitor();
    const points = makePoints([-0.8, -0.9], 'negative');
    checkAlerts(monitor, points);
    const history = getAlerts();
    expect(history.length).toBeGreaterThan(0);
  });
});

describe('getAlerts', () => {
  beforeEach(() => clearAlerts());

  it('returns empty array when no alerts fired', () => {
    expect(getAlerts()).toEqual([]);
  });

  it('filters by monitorId', () => {
    const m1 = makeMonitor({ id: 'mon_1', target: 'user1' });
    const m2 = makeMonitor({ id: 'mon_2', target: 'user2' });
    checkAlerts(m1, makePoints([-0.8, -0.9], 'negative'));
    checkAlerts(m2, makePoints([-0.8, -0.9], 'negative'));

    const filtered = getAlerts({ monitorId: 'mon_1' });
    expect(filtered.every(a => a.monitorId === 'mon_1')).toBe(true);
  });

  it('filters by severity', () => {
    const monitor = makeMonitor();
    checkAlerts(monitor, makePoints([-0.95, -0.95], 'negative')); // critical
    const criticals = getAlerts({ severity: 'critical' });
    expect(criticals.every(a => a.severity === 'critical')).toBe(true);
  });

  it('respects limit option', () => {
    const monitor = makeMonitor();
    // Fire multiple alerts across different monitors
    for (let i = 0; i < 5; i++) {
      const m = makeMonitor({ id: `mon_${i}`, target: `user${i}` });
      checkAlerts(m, makePoints([-0.8, -0.9], 'negative'));
    }
    const limited = getAlerts({ limit: 2 });
    expect(limited.length).toBeLessThanOrEqual(2);
  });
});

describe('clearAlerts', () => {
  it('clears all alert history', () => {
    const monitor = makeMonitor();
    checkAlerts(monitor, makePoints([-0.8, -0.9], 'negative'));
    expect(getAlerts().length).toBeGreaterThan(0);
    clearAlerts();
    expect(getAlerts()).toEqual([]);
  });
});
