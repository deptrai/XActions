// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * PumpFun scraper module barrel (Story 20.5).
 * @author nich (@nichxbt)
 * @license Apache-2.0
 */

export { PumpFunClient, createPumpFunClient, PUMPFUN_API_BASE, SOLANA_MINT_RE } from './client.js';
export { PumpFunCrawler, createPumpFunCrawler } from './crawler.js';
export { computeCommentVelocity } from './velocity.js';
export { KolscanResolver, createKolscanResolver, loadKolSeed, fetchKolscanWallets } from './kolscan.js';
export { LivestreamPoller, createLivestreamPoller } from './livestream.js';
export {
  namespacedPumpfunId,
  normalizeThesis,
  normalizeHolder,
  extractTheses,
  extractTopHolders,
} from './normalizer.js';
export { normalizePumpfunReply, normalizePumpfunReplies } from './comments.js';
export { default as pumpfunDescriptor } from './descriptor.js';
