---
title: "Scraper Benchmark Metrics Catalog"
type: reference
purpose: "Detailed metric definitions, formulas, and thresholds for the 4-pillar benchmark framework"
---

# Scraper Benchmark Metrics Catalog

This companion defines every metric, formula, and threshold used by the Benchmark Scoring Engine (CAP-3). Downstream architecture, stories, and tests reference this catalog directly.

---

## Pillar 1: Stability & Resilience

| Metric | Formula / Definition | Threshold |
|--------|----------------------|-----------|
| **True Success Rate** | Valid payloads ÷ total requests. "Valid" = passes platform validator + not a False 200 (login wall, captcha, empty challenge page). | ≥ 98% |
| **P95 Latency** | 95th percentile of end-to-end scrape duration per platform. | Platform-specific: social ≤ 3.5s, e-commerce ≤ 5s, directory ≤ 4s |
| **Checkpoint/Ban Rate** | Accounts hitting platform checkpoint or ban ÷ 1,000 requests. | ≤ 0.5% |
| **Proxy Quarantine Rate** | Proxies quarantined (429/403/auto-quarantine) ÷ total proxy assignments. | ≤ 5% |
| **Circuit Breaker Trips** | Number of times governor/circuit-breaker halts a scraper per day. | ≤ 2/day |

---

## Pillar 2: Data Quality & Completeness

| Metric | Formula / Definition | Threshold |
|--------|----------------------|-----------|
| **Essential Field Fill Rate** | Records with all mandatory fields populated ÷ total records. | ≥ 95% |
| **Schema Integrity Rate** | Records passing `MetadataSchemaRegistry` validation ÷ total records. | ≥ 98% |
| **Data Freshness SLA** | Median age of newest record vs. source timestamp. | ≤ 5 min for social, ≤ 1 h for e-commerce/directory |
| **Comment Tree Completeness** | Scraped comments ÷ expected comment count (from meta tags or API hints). **N/A for non-social platforms** (directories, recruitment, B2B, F&B, healthcare, legal). | ≥ 90% (when applicable) |

---

## Pillar 3: Noise & Relevance

| Metric | Formula / Definition | Threshold |
|--------|----------------------|-----------|
| **Duplicate Ratio** | Duplicate records (same `platform:externalId` or content hash) ÷ total records. | ≤ 2% |
| **Spam/Noise Ratio** | Records flagged as spam, ads, or irrelevant by platform-specific noise filters ÷ total records. | ≤ 5% |
| **Contact Accuracy** | Valid phone numbers (VN format) or emails extracted ÷ total contact attempts. | ≥ 85% |
| **False 200 Rate** | HTTP 200 responses that are actually challenge/login/empty pages ÷ total 200 responses. | ≤ 1% |

---

## Pillar 4: Cost & Efficiency

| Metric | Formula / Definition | Threshold |
|--------|----------------------|-----------|
| **Proxy Bandwidth per 1k Records** | Total proxy bytes consumed ÷ records returned, normalized to 1,000 records. | ≤ 50 MB/1k records |
| **Account Burn Rate** | Accounts hibernated or banned ÷ 1,000 requests. | ≤ 0.1% |
| **Compute Cost per 1k Records** | Estimated CPU/RAM cost (container seconds) ÷ records returned. | ≤ $0.01/1k records |
| **Retry Overhead** | Total retries ÷ successful requests. | ≤ 15% |

---

## Scoring Weights

| Pillar | Weight | Rationale |
|--------|--------|-----------|
| Stability | 0.35 | A scraper that cannot run is useless regardless of output quality. |
| Quality | 0.30 | Missing fields or schema breaks directly poison Nowing leads. |
| Noise | 0.20 | Duplicates and spam waste Nowing storage and scoring cycles. |
| Cost | 0.15 | Expensive scrapers are sustainable only if the other three pillars are strong. |

---

## Tier Classification

| Tier | Score Range | Action |
|------|-------------|--------|
| **A** | 90–100 | Production-ready, Nowing feed allowed. |
| **B** | 70–89 | Degraded but usable; alert operators, continue ingestion with monitoring. |
| **C** | < 70 | Failing or too noisy; tag thin events with `benchmark_health: "C"` + `benchmark_alert: true` and fire operator alerts. **No automatic ingestion cutoff** — human-in-the-loop per spine AD-27. |

---

## Platform-Specific Mandatory Fields

| Platform | Mandatory Fields (Essential Field Fill) |
|----------|----------------------------------------|
| Twitter/X | `author.id`, `author.handle`, `text`, `created_at`, `metrics.likes`, `metrics.retweets` |
| Facebook | `author.id`, `author.name`, `post_text`, `created_at`, `comment_count`, `reaction_count` |
| Threads | `author.id`, `author.handle`, `text`, `created_at`, `like_count`, `reply_count` |
| TikTok | `author.id`, `author.handle`, `desc`, `created_at`, `digg_count`, `comment_count`, `share_count` |
| Bluesky | `author.did`, `author.handle`, `text`, `created_at`, `like_count`, `repost_count` |
| Mastodon | `account.id`, `account.acct`, `content`, `created_at`, `favourites_count`, `reblogs_count` |
| Shopee | `itemid`, `name`, `price`, `sold`, `rating_star`, `shop_location` |
| TikTok Shop | `product_id`, `title`, `price`, `sold_count`, `rating`, `shop_name` |
| Chợ Tốt | `ad_id`, `subject`, `price`, `phone`, `region`, `category` |
| Batdongsan | `id`, `title`, `price`, `area`, `address`, `phone`, `posted_date` |
| TopCV | `job_id`, `title`, `company`, `salary`, `location`, `deadline` |
| VietnamWorks | `job_id`, `title`, `company`, `salary`, `location`, `posted_date` |
| LinkedIn | `job_id`, `title`, `company`, `location`, `posted_date`, `applicant_count` |
| Zalo OA | `article_id`, `title`, `content`, `created_at`, `oa_id` |
| YouTube | `video_id`, `title`, `channel_id`, `published_at`, `view_count`, `like_count` |
| Masothue | `tax_code`, `company_name`, `address`, `legal_rep`, `status` |
| Muasamcong | `bid_id`, `title`, `budget`, `deadline`, `procuring_entity` |
| F&B (PasGo/Foody/Riviu) | `merchant_id`, `name`, `address`, `phone`, `rating`, `price_range` |
| Healthcare (Medpro, etc.) | `clinic_id`, `name`, `address`, `phone`, `specialty`, `hours` |
| Legal/IP | `application_id`, `title`, `applicant`, `status`, `filing_date` |

---

## Telemetry Schema (Redis Stream / DB Table)

```json
{
  "run_id": "uuid",
  "scraper_id": "twitter-hybrid",
  "platform": "twitter",
  "timestamp": "2026-09-08T07:00:00Z",
  "stability": {
    "true_success": true,
    "latency_ms": 2100,
    "http_status": 200,
    "checkpoint_triggered": false,
    "proxy_quarantined": false
  },
  "quality": {
    "field_fill_rate": 0.97,
    "schema_valid": true,
    "freshness_sec": 120,
    "comment_completeness": 0.92
  },
  "noise": {
    "duplicate": false,
    "spam_flagged": false,
    "contact_valid": true,
    "false_200": false
  },
  "cost": {
    "proxy_bytes": 1048576,
    "retries": 1,
    "account_burned": false
  }
}
```

---

*This catalog is the single source of truth for benchmark thresholds. Architecture and stories must cite metric names exactly as defined here.*

---

## Normalization & Scoring Math

Raw metrics are heterogeneous (ms, MB, %, counts). The scoring engine maps each metric to a 0-100 sub-score using linear interpolation between a **target** (score 100) and a **fail** (score 0) boundary, then aggregates per pillar.

### Pillar Sub-Score Formula

```
pillar_score = Σ(weight_i * normalized_score_i) / Σ(weight_i)   for applicable metrics only
```

Where `normalized_score_i = clamp(100 * (metric - fail) / (target - fail), 0, 100)`.

### Hard Knock-Out Gates (Non-Compensatory)

If ANY of the following are true, the scraper is capped at **Tier C** regardless of composite score:
- `True Success Rate < 80%`
- `Essential Field Fill Rate < 85%`
- `False 200 Rate > 15%`
- `Schema Integrity Rate < 90%`

### Category-Specific Metric Profiles

Profile names below are the catalog's logical groups. The code's canonical vocabulary is `CATEGORY_VALUES` in `src/core/types.js`; the scoring engine maps profile → code category per spine AD-28.

| Profile | Code `CATEGORY_VALUES` | Applicable Metrics | Excluded Metrics |
|----------|----------------------|-------------------|------------------|
| `social` | `social` | All 4 pillars | — |
| `ecommerce` | `ecom` | Stability, Quality, Noise, Cost | `comment_completeness` |
| `directory` | `realestate`, `recruitment`, `automotive` | Stability, Quality, Noise, Cost | `comment_completeness`, `contact_accuracy` (if no contacts) |
| `registry` | `b2b` | Stability, Quality, Noise, Cost | `comment_completeness`, `contact_accuracy`, `data_freshness` (historical data) |
| `fnb` | `fnb_merchant` | Stability, Quality, Noise, Cost | `comment_completeness` |
| `healthcare` | `healthcare` | Stability, Quality, Noise, Cost | `comment_completeness` |
| `legal` | `legal` | Stability, Quality, Noise, Cost | `comment_completeness` |

### Safe Ratio Utility

```javascript
function safeRatio(numerator, denominator, fallback = 1.0) {
  if (denominator === 0 || denominator === null || denominator === undefined) return fallback;
  if (numerator === null || numerator === undefined) return 0;
  return numerator / denominator;
}
```

### Example: Zero-Record Run

If a scrape returns 0 records:
- `field_fill_rate = safeRatio(filled, 0, fallback = 0)` → treated as 0 (quality drops)
- `proxy_bytes_per_1k = safeRatio(bytes, 0, fallback = Infinity)` → treated as max cost (score 0)
- `duplicate_ratio = safeRatio(dupes, 0, fallback = 0)` → treated as 0 (no duplicates found)

---

*This catalog is the single source of truth for benchmark thresholds. Architecture and stories must cite metric names exactly as defined here.*
