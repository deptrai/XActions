import { describe, it, expect } from 'vitest';
import { scrape } from '../../../src/scrapers/index.js';

describe('Healthcare dispatcher integration', () => {
  it('should dispatch via healthcare platform alias', async () => {
    // Thuocsi throws auth error
    await expect(scrape('healthcare', 'pharmacy_catalog', { platform: 'thuocsi' }))
      .rejects.toThrow(/auth/i);
  });

  it('should dispatch via platform-specific alias (thuocsi)', async () => {
    await expect(scrape('thuocsi', 'pharmacy_catalog'))
      .rejects.toThrow(/auth/i);
  });

  it('should dispatch with doctor alias for detail', async () => {
    const httpClient = async () => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<div class="doctor-card"><a href="/dat-kham/bac-si/dr-001"><h3>Dr Test</h3></a></div>',
    });
    const res = await scrape('youmed', 'doctor', { id: 'dr-001', httpClient });
    expect(res.post).toBeDefined();
    expect(res.post.externalId).toBe('dr-001');
  });

  it('should throw error for unknown action', async () => {
    await expect(scrape('medpro', 'unknown_action_xyz'))
      .rejects.toThrow(/not available on platform/i);
  });
});
