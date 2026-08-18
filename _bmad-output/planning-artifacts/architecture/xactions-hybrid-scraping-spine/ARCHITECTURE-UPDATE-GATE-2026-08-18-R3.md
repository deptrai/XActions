# Post-Update Reviewer Gate — XActions Hybrid Scraping Architecture (r3)

**Target:** `ARCHITECTURE-SPINE.md` (r3 — merge r1 fixes + Dual-Channel + Adaptive Governor)  
**Reviewer:** Winston / BMad Architecture Agent  
**Method:** Re-apply adversarial lens + reality-check lens.

---

## Verdict

🟢 **Consistent — spine is ready for Story 10.1.**

R3 successfully merges the user's new Dual-Channel and Adaptive Governor ideas with the r1 fixes. All r2 critical findings are resolved. Residual items are open questions that can be deferred.

---

## r2 Critical Findings — Status

| # | r2 Issue | How r3 closes it | Status |
|---|---|---|---|
| C1 | CrawlerCommand removed | AD-2 Rule 2 + AD-11 restored | ✅ Closed |
| C2 | Comment.id/depth reverted | AD-4 Rule 1-2 and schema updated | ✅ Closed |
| C3 | CrawlCheckpoint removed | AD-10 Rule 1 + AD-12 + schema | ✅ Closed |
| C4 | >50k evt/s vs MAXLEN 20000 | AD-7 Rule 3: `MAXLEN ~ 1,000,000`/`MINID`; throughput phụ thuộc consumer capacity | ✅ Closed |
| C5 | Adaptive Governor overclaim | AD-13 rewritten as stateful contract with `PlatformRateLimit` per platform; overclaim "100%" removed | ✅ Closed |

## r2 High Findings — Status

| # | r2 Issue | How r3 closes it | Status |
|---|---|---|---|
| H1 | GIN/raw migration/mediaUrls reverted | AD-4 Rule 3, Rule 5; schema; raw migration stub restored | ✅ Closed |
| H2 | HTTP client/SOCKS5/AbstractLogin/PlatformResponseValidator reverted | AD-1 Rule 4, AD-3 Rule 4, AD-5 Rule 3, AD-9 Rule 1 restored | ✅ Closed |
| H3 | Scope creep | AD-8 limited to Epics 10–18 platforms; mermaid updated | ✅ Closed |
| H4 | Dual-Channel integration contract missing | AD-7 Rule 2 adds URL, health, auth, reconnect | ✅ Closed |

---

## Adversarial Sanity Check

- Two platform teams build `ShopeeCrawler` and `TikTokShopCrawler`, both register `search_products` in `ActionRegistry`; CLI calls `crawler.start({ action: 'search_products' })`. ✅ Compatible.
- Both store `Comment` with `${platform}:${postExternalId}:${commentExternalId}` and `depth`. `PrismaStore` sorts by `depth`. ✅ Compatible.
- Two crawlers read from `CrawlCheckpoint` before cào, update after, then emit event. ✅ No duplicate/skip.
- HTTP daemon on port 3001 and Redis Stream both serve Nowing; on-demand queries use HTTP, bulk uses Redis. With `CrawlCheckpoint` durability, no data loss. ✅ Compatible.
- `AdaptiveRateGovernor` receives same inputs from `ProxyIpPool`, account tracker, Redis lag; reduces throughput consistently. ✅ Compatible.

---

## Residual (not blockers)

Open questions in section 6 remain:
1. `intent_tag` ownership (Nowing vs XActions).
2. Auth method for HTTP/SSE between Nowing and XActions.
3. Per-platform rate limit constants need benchmarking.

These can be resolved during implementation or integration stories without blocking Story 10.1.

---

## Recommendation

**Approve the r3 spine for Epic 10 implementation.**
