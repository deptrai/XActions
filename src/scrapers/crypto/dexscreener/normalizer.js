// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Normalizers for dexscreener.com public REST → XActions canonical shapes.
 * All outputs snake_case; domain fields (boosts.active, orders[].type,
 * pair.dexId) live in the `data` payload only — never in the envelope.
 *
 * Field shapes observed live (2026-09-27):
 * - /tokens/v1/{chain}/{token} → array [{chainId, tokenAddress, url, icon, header, description, links: [{type|label, url}]}]
 * - /orders/v1/{chain}/{token} → array [{type:'tokenProfile'|'communityTakeover'|..., status:'processing'|'confirmed'|..., paymentTimestamp}]
 * - /token-pairs/v1/{chain}/{token} → array [{chainId, dexId, pairAddress, baseToken{address,name,symbol}, quoteToken, priceNative, priceUsd, liquidity{usd}, volume{h24}, priceChange{h24}, pairCreatedAt}]
 * - /token-boosts/latest/v1 → array [{tokenAddress, chainId, amount, totalAmount, url, description, icon}]
 * - /token-profiles/latest/v1 → array [{tokenAddress, chainId, url, description, icon, header, links: [{type|label,url}]}]
 *
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

/**
 * Namespaced external id `dexscreener:{externalId}`.
 * @param {string} externalId
 * @returns {string}
 */
export function namespacedDexscreenerId(externalId) {
  return `dexscreener:${externalId}`;
}

/**
 * @param {unknown} v
 * @returns {Record<string, unknown>}
 */
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {});

/**
 * Upstream `icon` is frequently a bare CDN key (e.g. `mWl9YY091RIGUZW5`,
 * verified live 2026-09-29) instead of a full URL. Rendering it raw makes
 * the browser resolve it against its own origin → 404 per token. Absolutize
 * bare keys against the Dexscreener images CDN; pass absolute/data URLs through.
 * @param {unknown} icon
 * @returns {string | null}
 */
function normalizeIcon(icon) {
  if (typeof icon !== 'string') return null;
  const trimmed = icon.trim();
  if (!trimmed) return null;
  if (/^(https?:|ipfs:|data:|blob:)/i.test(trimmed)) return trimmed;
  return `https://cdn.dexscreener.com/cms/images/${trimmed.replace(/^\/+/, '')}`;
}

/**
 * Split a `links[]` entry into social vs website buckets. Dexscreener tags
 * entries with `type` ('twitter'|'telegram'|...) or `label` (freeform website).
 * @param {unknown[]} links
 * @returns {{ socials: {type: string, url: string}[], websites: {label?: string, url: string}[] }}
 */
function splitLinks(links) {
  const socials = [];
  const websites = [];
  if (!Array.isArray(links)) return { socials, websites };
  for (const raw of links) {
    const l = asObj(raw);
    const url = typeof l.url === 'string' ? l.url : null;
    if (!url) continue;
    if (typeof l.type === 'string' && l.type) {
      socials.push({ type: l.type, url });
    } else {
      const site = { url };
      if (typeof l.label === 'string' && l.label) site.label = l.label;
      websites.push(site);
    }
  }
  return { socials, websites };
}

/**
 * Dexscreener pair payload exposes `info.socials[]` ({type,url}) and
 * `info.websites[]` ({label,url}) separately — keep them separate (do not
 * fold websites into socials like a `links[]` stream would).
 * @param {unknown} info
 * @returns {{ socials: {type: string, url: string}[], websites: {label?: string, url: string}[] }}
 */
function splitInfo(info) {
  const i = asObj(info);
  const socials = [];
  const websites = [];
  for (const raw of Array.isArray(i.socials) ? i.socials : []) {
    const s = asObj(raw);
    const url = typeof s.url === 'string' ? s.url : null;
    if (!url) continue;
    socials.push({ type: typeof s.type === 'string' ? s.type : 'link', url });
  }
  for (const raw of Array.isArray(i.websites) ? i.websites : []) {
    const w = asObj(raw);
    const url = typeof w.url === 'string' ? w.url : null;
    if (!url) continue;
    const site = { url };
    if (typeof w.label === 'string' && w.label) site.label = w.label;
    websites.push(site);
  }
  return { socials, websites };
}

/**
 * Normalize the first entry of a /tokens/v1 response into a socials record.
 * @param {string} chainId
 * @param {string} tokenAddress
 * @param {unknown} raw - array or object from upstream
 * @returns {Record<string, unknown>}
 */
export function normalizeTokenSocials(chainId, tokenAddress, raw) {
  // Upstream /tokens/v1 returns an array of pair objects; the pair with the
  // richest `info` block (most socials+websites) wins.
  const pairs = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  let best = null;
  let bestCount = -1;
  let name = null;
  let symbol = null;
  let url = null;
  let image = null;
  let description = null;
  for (const rawPair of pairs) {
    const p = asObj(rawPair);
    const info = asObj(p.info);
    const { socials, websites } = splitInfo(info);
    const count = socials.length + websites.length;
    if (count > bestCount) {
      best = { socials, websites };
      bestCount = count;
      const base = asObj(p.baseToken);
      name = typeof base.name === 'string' ? base.name : name;
      symbol = typeof base.symbol === 'string' ? base.symbol : symbol;
      url = typeof p.url === 'string' ? p.url : url;
      image = typeof info.imageUrl === 'string' ? info.imageUrl
        : (typeof info.header === 'string' ? info.header : image);
      description = typeof info.description === 'string' ? info.description : description;
    }
  }
  const { socials = [], websites = [] } = best || {};
  return {
    platform: 'dexscreener',
    category: 'crypto',
    type: 'token_socials',
    data: {
      chain_id: chainId,
      token_address: tokenAddress,
      name,
      symbol,
      description,
      image,
      url,
      socials,
      websites,
    },
  };
}

/**
 * Normalize /orders/v1 response into a legitimacy record.
 * @param {string} chainId
 * @param {string} tokenAddress
 * @param {unknown} rawOrders - upstream array
 * @returns {Record<string, unknown>}
 */
export function normalizeTokenLegitimacy(chainId, tokenAddress, rawOrders) {
  // Upstream (verified live 2026-09-27): `{orders:[...], boosts:[...]}` —
  // orders carry paid types (tokenProfile/communityTakeover/...), boosts carry
  // active boost amounts. Normalize both into a single legitimacy record.
  const envelope = asObj(rawOrders);
  const orderList = Array.isArray(rawOrders) ? rawOrders : (Array.isArray(envelope.orders) ? envelope.orders : []);
  const boostList = Array.isArray(envelope.boosts) ? envelope.boosts : [];
  const orders = [];
  let boostsActive = 0;
  for (const raw of orderList) {
    const o = asObj(raw);
    const type = typeof o.type === 'string' ? o.type : null;
    const status = typeof o.status === 'string' ? o.status : null;
    const paymentTs = o.paymentTimestamp != null ? Number(o.paymentTimestamp) : null;
    orders.push({
      type,
      status,
      payment_timestamp: paymentTs,
    });
    if ((type === 'tokenProfile' || type === 'boost' || type === 'communityTakeover')
      && (status === 'confirmed' || status === 'approved' || status === 'processing' || status === 'on-hold')) {
      boostsActive += 1;
    }
  }
  const boosts = [];
  for (const raw of boostList) {
    const b = asObj(raw);
    boosts.push({
      id: typeof b.id === 'string' ? b.id : null,
      amount: b.amount != null ? Number(b.amount) : null,
      payment_timestamp: b.paymentTimestamp != null ? Number(b.paymentTimestamp) : null,
    });
    boostsActive += 1;
  }
  return {
    platform: 'dexscreener',
    category: 'crypto',
    type: 'token_legitimacy',
    data: {
      chain_id: chainId,
      token_address: tokenAddress,
      orders,
      boosts,
      boosted: boostsActive > 0,
      boosts_active: boostsActive,
    },
  };
}

/**
 * Normalize /token-pairs/v1 response into a pair lookup record.
 * @param {string} chainId
 * @param {string} tokenAddress
 * @param {unknown} rawPairs - upstream array
 * @returns {Record<string, unknown>}
 */
export function normalizeTokenLookup(chainId, tokenAddress, rawPairs) {
  const list = Array.isArray(rawPairs) ? rawPairs : [];
  const pairs = list.map((raw) => {
    const p = asObj(raw);
    const base = asObj(p.baseToken);
    const liquidity = asObj(p.liquidity);
    const volume = asObj(p.volume);
    const priceChange = asObj(p.priceChange);
    return {
      dex_id: typeof p.dexId === 'string' ? p.dexId : null,
      pair_address: typeof p.pairAddress === 'string' ? p.pairAddress : null,
      pair_url: typeof p.url === 'string' ? p.url : null,
      base_symbol: typeof base.symbol === 'string' ? base.symbol : null,
      base_name: typeof base.name === 'string' ? base.name : null,
      price_usd: p.priceUsd != null ? Number(p.priceUsd) : null,
      price_native: p.priceNative != null ? Number(p.priceNative) : null,
      liquidity_usd: liquidity.usd != null ? Number(liquidity.usd) : null,
      volume_24h: volume.h24 != null ? Number(volume.h24) : null,
      price_change_24h: priceChange.h24 != null ? Number(priceChange.h24) : null,
      pair_created_at: p.pairCreatedAt != null ? Number(p.pairCreatedAt) : null,
    };
  });
  return {
    platform: 'dexscreener',
    category: 'crypto',
    type: 'token_lookup',
    data: {
      chain_id: chainId,
      token_address: tokenAddress,
      pair_count: pairs.length,
      pairs,
    },
  };
}

/**
 * Normalize one entry from /token-boosts/latest/v1.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeBoostedToken(raw) {
  const b = asObj(raw);
  return {
    platform: 'dexscreener',
    category: 'crypto',
    type: 'boosted_token',
    data: {
      token_address: typeof b.tokenAddress === 'string' ? b.tokenAddress : null,
      chain_id: typeof b.chainId === 'string' ? b.chainId : null,
      amount: b.amount != null ? Number(b.amount) : null,
      total_amount: b.totalAmount != null ? Number(b.totalAmount) : null,
      url: typeof b.url === 'string' ? b.url : null,
      description: typeof b.description === 'string' ? b.description : null,
      icon: normalizeIcon(b.icon),
    },
  };
}

/**
 * Normalize one entry from /token-profiles/latest/v1.
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
export function normalizeTokenProfile(raw) {
  const p = asObj(raw);
  const { socials, websites } = splitLinks(p.links);
  return {
    platform: 'dexscreener',
    category: 'crypto',
    type: 'token_profile',
    data: {
      token_address: typeof p.tokenAddress === 'string' ? p.tokenAddress : null,
      chain_id: typeof p.chainId === 'string' ? p.chainId : null,
      url: typeof p.url === 'string' ? p.url : null,
      description: typeof p.description === 'string' ? p.description : null,
      icon: normalizeIcon(p.icon),
      header: typeof p.header === 'string' ? p.header : null,
      socials,
      websites,
    },
  };
}
