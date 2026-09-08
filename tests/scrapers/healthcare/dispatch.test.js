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

  it('should throw error for unknown action', async () => {
    await expect(scrape('medpro', 'unknown_action_xyz'))
      .rejects.toThrow(/not available on platform/i);
  });
});
