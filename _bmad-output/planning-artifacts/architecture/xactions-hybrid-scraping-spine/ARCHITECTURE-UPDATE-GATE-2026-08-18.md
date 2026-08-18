# Post-Update Reviewer Gate — XActions Hybrid Scraping Architecture

**Target:** `ARCHITECTURE-SPINE.md` (updated 2026-08-18)  
**Reviewer:** Winston / BMad Architecture Agent  
**Method:** Re-apply adversarial lens (two teams building one level down) + reality-check lens (package versions, Prisma constraints, brownfield code) after the update.

---

## Verdict

🟢 **Consistent — spine is ready for Story 10.1** with one open question to resolve during implementation.

All 4 critical findings from the original validation report are closed. The spine now fixes the invariants that would otherwise let two teams build incompatibly while still obeying every AD.

---

## Critical Findings — Status

| # | Original Issue | How the update closes it | Status |
|---|---|---|---|
| C1 | `AbstractCrawler` interface mismatch with story methods (`getGroupPosts`, `searchProducts`, etc.) | AD-2 Rule 2 + new AD-11 `CrawlerCommand & ActionRegistry`: all platform actions are registered in a `Map` and invoked via `crawler.start({ action, args })` | ✅ Closed |
| C2 | `Comment.id` collision and missing `depth` | AD-4 Rule 1: `Comment.id = ${platform}:${postExternalId}:${commentExternalId}`; AD-4 Rule 2: `Comment.depth` added; schema updated | ✅ Closed |
| C3 | Missing `CrawlCheckpoint` for 3-Tier Gap-Filling | New AD-12 `CrawlCheckpoint State`; `CrawlCheckpoint` model added; AD-10 Rule 1 updated | ✅ Closed |
| C4 | GIN index not expressible in Prisma schema | AD-4 Rule 3: GIN/expression indexes created via raw migration SQL; raw migration stub included | ✅ Closed |

---

## High Findings — Status

| # | Original Issue | How the update closes it | Status |
|---|---|---|---|
| H1 | Missing `got-scraping` / `qrcode-terminal` | AD-1 Rule 4 calls out `got-scraping` must be in `package.json`; AD-5 Rule 1 calls out `qrcode-terminal` must be in `package.json` | ✅ Closed |
| H2 | `src/client/**` role unclear | AD-2 Rule 3: `src/client/` is legacy Twitter client; new abstractions live in `src/core/**` | ✅ Closed |
| H3 | MCP 80+ tools / auth integration undefined | AD-5 Rule 3 introduces `AbstractLogin` contract and unified `SessionManager` | ✅ Closed |
| H4 | Redis `MAXLEN ~ 20000` data loss risk | AD-7 Rule 2: `MAXLEN` raised to `~ 1000000` or `MINID`; Rule 3: consumer group `XACK` and `CrawlCheckpoint` before emit | ✅ Closed |
| H5 | 30-day TTL not enforced | AD-10 Rule 2: enforce via partition by range or daily cleanup job | ✅ Closed |

---

## Medium / Low Residuals (not blockers)

* **M3 / Scope creep (Instagram, Amazon, etc.):** Moved to section 5 *Deferred & Out-of-Scope*. Not a blocker.
* **L1 / 3s signer timeout:** Changed to adaptive (3s default, 8s warmup) in AD-1 Rule 3.
* **L3 / `error !== 0` too platform-specific:** Replaced by `PlatformResponseValidator` in AD-9 Rule 1.
* **Open Question / `intent_tag`:** Still open in section 6. This is an integration contract question with Nowing; it can be resolved in the integration story (Story 14.4 / Nowing adapter) without blocking Story 10.1.

---

## Adversarial Sanity Check

*Two teams each build a new platform crawler obeying every AD.*

- Team A builds `ShopeeCrawler`, Team B builds `TikTokShopCrawler`. Both inherit `AbstractCrawler`, register `search_products`, `product_reviews`, `top_selling` in `ActionRegistry`. CLI/MCP call `crawler.start({ action: 'search_products', args: { keyword } })`. ✅ Compatible.
- Both use `AbstractStore` and write `Post.id = shopee:123` / `tiktok-shop:456`. `Post.@@unique([platform, externalId])` prevents collision. ✅ Compatible.
- Both write comments with `Comment.id = ${platform}:${postExternalId}:${commentExternalId}` and `depth`. `PrismaStore` sorts by `depth` before insert. ✅ Compatible.
- Both use `ProxyIpPool` with the selected HTTP client. AD-3 Rule 4 prevents SOCKS5 fallback. ✅ Compatible.

No remaining incompatibilities found at this altitude.

---

## Recommendation

**Approve the updated spine for Epic 10 implementation.** The architecture now provides a consistent contract for `src/core/`, `src/scrapers/`, `src/store/`, `src/proxy/`, `src/mcp/`, and `prisma/schema.prisma`.

Before Story 10.2 (Prisma migration), generate the raw SQL migration for GIN/expression indexes from the stub in section 4.

Before Story 14.3/14.4, resolve the open question on `intent_tag` ownership in a Nowing-XActions integration contract.
