// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFunMedia — parses and extracts HLS livestream clips metadata (m3u8 playlists, segments).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export class PumpFunMedia {
  /**
   * Normalize a raw clip record to canonical shape.
   * @param {Record<string, unknown>} raw
   * @returns {Record<string, unknown>}
   */
  normalizeClip(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    return {
      clipId: c.clipId || c.id || c.clip_id || null,
      streamerWallet: c.streamer || c.creator || c.walletAddress || c.userAddress || null,
      title: c.title || c.name || '',
      duration: Number(c.duration) || 0,
      resolution: c.resolution || c.quality || null,
      hlsPlaylistUrl: c.hlsPlaylist || c.playlist || c.url || c.m3u8 || null,
      thumbnailUrl: c.thumbnail || c.poster || null,
      startedAt: c.startedAt || c.createdAt || null,
      endedAt: c.endedAt || c.ended_at || null,
      viewers: Number(c.viewers) || 0,
      raw: c,
    };
  }

  /**
   * Extract HLS segment URLs from an m3u8 playlist text.
   * @param {string} playlistContent - raw .m3u8 file text
   * @param {string} baseUrl - base URL for resolving relative segment paths
   * @returns {Array<{ url: string, duration: number }>}
   */
  parseHlsPlaylist(playlistContent, baseUrl = '') {
    const lines = playlistContent.split('\n').map(l => l.trim());
    const segments = [];
    let currentDuration = 0;

    for (const line of lines) {
      if (line.startsWith('#EXTINF:')) {
        const d = parseFloat(line.split(':')[1].split(',')[0]);
        if (!isNaN(d)) currentDuration = d;
      } else if (line && !line.startsWith('#')) {
        // Resolve relative path
        const url = line.startsWith('http') ? line : new URL(line, baseUrl).href;
        segments.push({ url, duration: currentDuration });
      }
    }
    return segments;
  }
}

export default PumpFunMedia;
