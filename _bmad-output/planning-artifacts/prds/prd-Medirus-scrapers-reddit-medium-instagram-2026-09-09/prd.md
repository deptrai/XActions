---
title: 'PRD: XActions Multi-Platform Scraper Expansion'
status: final
created: '2026-09-09'
updated: '2026-09-09'
---

# PRD: XActions Multi-Platform Scraper Expansion

## Vision
XActions currently supports Twitter/X, Facebook, Threads, TikTok, Bluesky, Mastodon, YouTube, Zalo. This expansion adds **Reddit**, **Medium**, and **Instagram** scrapers so users can collect and analyze public content across all major social platforms in one toolkit — with unified proxy support.

## Background
Research findings:
- **Reddit** — official REST API + read-only mode feasible; HTTP adapter sufficient.
- **Medium** — official API deprecated; RSS feed (`/feed/@username`) still accessible without auth; HTTP or cheerio adapter sufficient.
- **Instagram** — high complexity; private API via `instagrapi` or Puppeteer needed; proxy + session management required; alternative is external managed service.
- XActions already has `src/proxy/` (`ProxyIpPool`, `providers.js`) and `FacebookAccount.encryptedProxy` — proxy support exists but not yet unified across scrapers.
- Current `.env` uses a `country-vn` SocksNode proxy; US-resident platforms may require `country-us` or other residential proxy.

## Goals
1. Add `src/scrapers/social/reddit/` with `client.js`, `crawler.js`, `normalizer.js`, `validator.js`.
2. Add `src/scrapers/social/medium/` with `client.js`, `crawler.js`, `normalizer.js`, `validator.js`.
3. Add `src/scrapers/social/instagram/` with `client.js`, `crawler.js`, `normalizer.js`, `validator.js` (private API bridge or Puppeteer).
4. Unify proxy support so all social scrapers can inject `ProxyProvider` from constructor.
5. Add tests and docs for each new platform.

## Non-Goals
- Private Instagram API implementation without proxy/session management.
- Paid Reddit API tier integration (start with read-only/free tier).
- Medium member-only content scraping (RSS only).

## Functional Requirements

### FR-1: Reddit Scraper
- **FR-1.1**: `RedditClient` authenticates via OAuth2 read-only mode.
- **FR-1.2**: `RedditCrawler` supports `search`, `subreddit`, `user`, `post` actions and returns normalized `PostItem[]`.
- **FR-1.3**: `normalizer.js` converts `t3` → `PostItem`, `t1` → `CommentItem`, `t5` → `CommunityItem`.
- **FR-1.4**: `validator.js` checks schema for `data.children`, `kind`, `subreddit`, `score`, `num_comments`, `author`.
- **FR-1.5**: Rate limiter respects `x-ratelimit-*` headers and implements exponential backoff.

### FR-2: Medium Scraper
- **FR-2.1**: `MediumClient` fetches public RSS feeds and HTML.
- **FR-2.2**: `MediumCrawler` supports `user`, `publication`, `tag`, `post` actions and returns normalized `PostItem[]`.
- **FR-2.3**: `normalizer.js` converts RSS item → `PostItem` with `title`, `link`, `pubDate`, `categories`, `content:encoded`.
- **FR-2.4**: `validator.js` checks `guid`, `title`, `creator`, `categories`.

### FR-3: Instagram Scraper
- **FR-3.1**: `InstagramClient` supports private API (via `instagrapi` bridge) or Puppeteer public scraping.
- **FR-3.2**: `InstagramCrawler` supports `user`, `media`, `comment`, `hashtag` actions and returns normalized `PostItem[]`.
- **FR-3.3**: `normalizer.js` converts `media` → `PostItem`, `user` → `ProfileItem`, `comment` → `CommentItem`.
- **FR-3.4**: `validator.js` checks `user_id`, `pk`, `code`, `taken_at`, `caption`, `like_count`, `comment_count`.
- **FR-3.5**: Proxy provider injection is required; session persistence is mandatory.

### FR-4: Unified Proxy Support
- **FR-4.1**: All new `Client` classes accept `ProxyProvider` or `proxy` option in constructor.
- **FR-4.2**: `ProxyIpPool` is injected via `options.proxy` or `options.proxyProvider`.
- **FR-4.3**: If no proxy provided, scraper falls back to `PROXY_URL` env or direct connection.

## Non-Functional Requirements
- **NFR-1**: All scrapers must include 1–3s delays between actions.
- **NFR-2**: Rate limit handling must respect platform-specific headers and response codes.
- **NFR-3**: Instagram scraper must support proxy rotation and session persistence.
- **NFR-4**: Tests must use real implementations (no mocks, stubs, or fakes).
- **NFR-5**: Code follows ESM imports, `const` over `let`, emoji-prefixed error messages.
- **NFR-6**: All public scraper actions must return `Promise<PostItem[]>` or `Promise<ProfileItem[]>`.

## Glossary
- **PostItem**: normalized social post object with `id`, `platform`, `author`, `content`, `timestamp`, `engagement`, `url`, `media[]`.
- **ProfileItem**: normalized social profile object with `id`, `platform`, `username`, `name`, `bio`, `followerCount`, `followingCount`.
- **CommentItem**: normalized comment object with `id`, `postId`, `author`, `text`, `timestamp`, `likeCount`.
- **CommunityItem**: normalized community/subreddit object with `id`, `name`, `title`, `subscriberCount`, `description`.
- **ProxyProvider**: interface in `src/proxy/providers.js` for acquiring normalized proxy objects.
- **ProxyIpPool**: proxy pool in `src/proxy/proxy-pool.js` with quarantine, sticky, and round-robin allocation.

## Assumptions
- `[ASSUMPTION]` Medium RSS feed remains accessible without auth for public posts.
- `[ASSUMPTION]` Reddit read-only OAuth2 mode is sufficient for public scraping.
- `[ASSUMPTION]` Instagram private API via `instagrapi` can be bridged or ported to Node.js without major redesign.
- `[ASSUMPTION]` Existing `ProxyIpPool` and `providers.js` can be injected into all social scrapers with minimal refactor.
- `[ASSUMPTION]` A `country-us` or equivalent US residential proxy is available if Reddit/Medium blocks Vietnam IPs.

## Open Questions
- OQ-1: Should Instagram scraper use `instagrapi` Python bridge or pure Node.js implementation?
- OQ-2: Should XActions create a shared `Proxy` table in Prisma schema for cross-platform proxy pool?
- OQ-3: Should default proxy for Reddit/Medium be `country-us` instead of `country-vn`?
- OQ-4: What is the expected scale for Reddit scraping (API pricing vs. read-only limits)?

## Success Metrics
- Each new scraper passes `vitest` tests for `client.js`, `crawler.js`, `normalizer.js`.
- `src/scrapers/social/index.js` exports new platforms.
- `docs/agents/` updated with selectors and patterns for each platform.
- All public scraper actions return `PostItem[]` within 5s per request under normal rate limits.
- Instagram scraper achieves ≥90% session reuse without challenge for ≤10 requests per session.
