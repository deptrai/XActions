// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Story 27.1 — FingerprintManager unit tests (real implementations, no mocks).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { FingerprintManager } from '../../src/core/fingerprint-manager.js';
import { TlsProfileProvider, browserFamilyFromUA } from '../../src/core/tls-profile-provider.js';

// Deterministic KV store standing in for SocialAccount persistence.
function makeStore() {
  const m = new Map();
  return {
    data: m,
    get: (k) => m.get(k),
    set: (k, v) => m.set(k, v),
  };
}

const REQUIRED_FIELDS = [
  'userAgent', 'viewport', 'timezone', 'locale', 'colorDepth',
  'platform', 'webgl', 'fonts', 'hardwareConcurrency', 'deviceMemory',
];

describe('Story 27.1 — FingerprintManager', () => {
  it('[P0] returns a complete fingerprint with all required fields', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const fp = await fm.getForAccount('tw', 'alice', { proxy: { region: 'us' } });
    for (const f of REQUIRED_FIELDS) expect(fp, `missing ${f}`).toHaveProperty(f);
    expect(fp.viewport).toHaveProperty('width');
    expect(fp.viewport).toHaveProperty('height');
    expect(fp.webgl).toHaveProperty('vendor');
    expect(fp.webgl).toHaveProperty('renderer');
    expect(Array.isArray(fp.fonts)).toBe(true);
    expect(fp.fonts.length).toBeGreaterThan(0);
    expect(typeof fp.hardwareConcurrency).toBe('number');
    expect(typeof fp.deviceMemory).toBe('number');
  });

  it('[P0] HAPPY_PATH geo-match: us region → America/* timezone + en-US locale', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const fp = await fm.getForAccount('tw', 'alice', { proxy: { region: 'us' } });
    expect(fp.timezone).toMatch(/^America\//);
    expect(fp.locale).toBe('en-US');
    expect(fp.region).toBe('us');
  });

  it('[P0] STABLE: repeated calls return the same fingerprint object', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const a = await fm.getForAccount('tw', 'alice', { proxy: { region: 'us' } });
    const b = await fm.getForAccount('tw', 'alice', { proxy: { region: 'us' } });
    expect(b).toBe(a);
    expect(b.userAgent).toBe(a.userAgent);
  });

  it('[P0] GEO_MATCH: de → Europe/Berlin + de-DE; jp → Asia/Tokyo + ja-JP; vn → Ho_Chi_Minh + vi-VN', async () => {
    const fm = new FingerprintManager({ prisma: null });
    expect((await fm.getForAccount('tw', 'acc-de', { proxy: { region: 'de' } })).timezone).toBe('Europe/Berlin');
    expect((await fm.getForAccount('tw', 'acc-de', { proxy: { region: 'de' } })).locale).toBe('de-DE');
    expect((await fm.getForAccount('tw', 'acc-jp', { proxy: { region: 'jp' } })).timezone).toBe('Asia/Tokyo');
    expect((await fm.getForAccount('tw', 'acc-jp', { proxy: { region: 'jp' } })).locale).toBe('ja-JP');
    expect((await fm.getForAccount('tw', 'acc-vn', { proxy: { region: 'vn' } })).timezone).toBe('Asia/Ho_Chi_Minh');
    expect((await fm.getForAccount('tw', 'acc-vn', { proxy: { region: 'vn' } })).locale).toBe('vi-VN');
  });

  it('[P1] GEO_UNKNOWN: no proxy region → internally-consistent fingerprint', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const fp = await fm.getForAccount('tw', 'acc-noproxy', {});
    for (const f of REQUIRED_FIELDS) expect(fp).toHaveProperty(f);
    expect(fp.timezone).toBeTruthy();
    expect(fp.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
  });

  it('[P0] PERSIST: fingerprint persists to injected store and reloads (no regen)', async () => {
    const store = makeStore();
    const fm1 = new FingerprintManager({ prisma: null, store });
    const first = await fm1.getForAccount('tw', 'persist-acc', { proxy: { region: 'us' } });
    // New manager instance sharing the store → must reload persisted fingerprint.
    const fm2 = new FingerprintManager({ prisma: null, store });
    const second = await fm2.getForAccount('tw', 'persist-acc', { proxy: { region: 'us' } });
    expect(second.userAgent).toBe(first.userAgent);
    expect(second.timezone).toBe(first.timezone);
  });

  it('[P0] NO_DB: no prisma → in-memory stable within process', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const a = await fm.getForAccount('tw', 'mem-acc', {});
    expect(fm.has('tw', 'mem-acc')).toBe(true);
    const b = await fm.getForAccount('tw', 'mem-acc', {});
    expect(b).toBe(a);
  });

  it('[P1] unique per account: two accounts same region → different fingerprints', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const a = await fm.getForAccount('tw', 'u1', { proxy: { region: 'us' } });
    const b = await fm.getForAccount('tw', 'u2', { proxy: { region: 'us' } });
    // Both geo-consistent but distinct identities (UA or webgl/platform may share, but the full object differs or is independently generated).
    expect(a).not.toBe(b);
    expect(a.timezone).toMatch(/^America\//);
    expect(b.timezone).toMatch(/^America\//);
  });

  it('[P0] ROTATE: rotateForAccount produces a new fingerprint and persists', async () => {
    const store = makeStore();
    const fm = new FingerprintManager({ prisma: null, store });
    const before = await fm.getForAccount('tw', 'rot-acc', { proxy: { region: 'us' } });
    const after = await fm.rotateForAccount('tw', 'rot-acc', { proxy: { region: 'us' } });
    expect(after).not.toBe(before);
    expect(store.data.has('tw:rot-acc')).toBe(true);
    const stored = store.data.get('tw:rot-acc');
    expect(stored.fingerprint.userAgent).toBe(after.userAgent);
  });

  it('[P1] corrupt persisted metadata → regenerate + overwrite', async () => {
    const store = makeStore();
    store.data.set('tw:corrupt-acc', { version: 1, fingerprint: { broken: true } });
    const fm = new FingerprintManager({ prisma: null, store });
    const fp = await fm.getForAccount('tw', 'corrupt-acc', { proxy: { region: 'us' } });
    for (const f of REQUIRED_FIELDS) expect(fp).toHaveProperty(f);
  });

  it('[P1] bindProxyRegion makes subsequent fingerprints geo-consistent', async () => {
    const fm = new FingerprintManager({ prisma: null });
    fm.bindProxyRegion('bound-acc', 'jp');
    const fp = await fm.getForAccount('tw', 'bound-acc', {});
    expect(fp.timezone).toBe('Asia/Tokyo');
    expect(fp.locale).toBe('ja-JP');
  });

  it('[P0] throws TypeError when accountId is missing', async () => {
    const fm = new FingerprintManager({ prisma: null });
    await expect(fm.getForAccount('tw', '')).rejects.toThrow(TypeError);
  });
});

describe('Story 27.1 — TlsProfileProvider', () => {
  it('[P0] browserFamilyFromUA detects chrome/firefox/safari', () => {
    expect(browserFamilyFromUA('Mozilla/5.0 ... Chrome/131.0.0.0 Safari/537.36')).toBe('chrome');
    expect(browserFamilyFromUA('Mozilla/5.0 ... rv:121.0 Gecko/20100101 Firefox/121.0')).toBe('firefox');
    expect(browserFamilyFromUA('Mozilla/5.0 (Macintosh) ... Version/17.2 Safari/605.1.15')).toBe('safari');
    expect(browserFamilyFromUA('')).toBe('unknown');
  });

  it('[P0] getProfile(firefox) returns firefox cipher ordering', () => {
    const p = new TlsProfileProvider();
    const profile = p.getProfile('firefox');
    expect(profile.browserFamily).toBe('firefox');
    expect(Array.isArray(profile.cipherSuites)).toBe(true);
    expect(profile.cipherSuites.length).toBeGreaterThan(5);
    expect(profile.minVersion).toBe('TLSv1.2');
    expect(profile.maxVersion).toBe('TLSv1.3');
    expect(profile.alpnProtocols).toContain('h2');
  });

  it('[P1] getProfile from a raw UA string resolves the right family', () => {
    const p = new TlsProfileProvider();
    const profile = p.getProfile('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15');
    expect(profile.browserFamily).toBe('safari');
  });

  it('[P1] unknown family → null (graceful no-op)', () => {
    const p = new TlsProfileProvider();
    expect(p.getProfile('curl/8.0')).toBeNull();
    expect(p.getProfile('')).toBeNull();
  });

  it('[P1] tlsProfileFor maps a fingerprint to a TLS profile', async () => {
    const fm = new FingerprintManager({ prisma: null });
    const fp = await fm.getForAccount('tw', 'tls-acc', { proxy: { region: 'us' } });
    const tls = fm.tlsProfileFor(fp);
    expect(tls).not.toBeNull();
    expect(tls.browserFamily).toBe(fp.browserFamily);
  });

  it('[P1] tlsProfileFor gracefully no-ops when provider throws', async () => {
    const bad = { forFingerprint() { throw new Error('tls boom'); } };
    const fm = new FingerprintManager({ prisma: null, tlsProvider: null });
    fm._tlsProvider = bad; // simulate a throwing provider
    const out = fm.tlsProfileFor({ userAgent: 'x' });
    expect(out).toBeNull();
  });
});
