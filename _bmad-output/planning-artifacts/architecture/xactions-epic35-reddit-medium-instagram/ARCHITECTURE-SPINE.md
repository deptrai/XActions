---
name: 'XActions Epic 35 — Reddit, Medium & Instagram Scraper Expansion'
type: architecture-spine
purpose: epic-implementation
altitude: module
paradigm: 'Hexagonal / Ports & Adapters + Tiered Hybrid Signer Pool + Proxy Injection'
scope: 'XActions social scraper expansion: Reddit (HTTP REST API), Medium (RSS/HTML), Instagram (private API bridge or Puppeteer) with unified ProxyProvider support'
status: draft
created: '2026-09-09'
updated: '2026-09-09'
binds:
  - 'src/scrapers/social/**'
  - 'src/proxy/**'
  - 'src/core/**'
  - 'prisma/schema.prisma'
sources:
  - '_bmad-output/planning-artifacts/research/technical-scraping-reddit-medium-instagram-2026-09-08/research.md'
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/epics.md'
---

# Architecture Spine — Epic 35: Reddit, Medium & Instagram Scraper Expansion

## 1. Strategic Position

Epic 35 mở rộng `src/scrapers/social/` với ba nền tảng mới — **Reddit**, **Medium**, **Instagram** — dựa trên kiến trúc Hexagonal/Ports & Adapters hiện có. Mục tiêu:
- Tận dụng `AbstractCrawler` / `AbstractApiClient` / `ProxyProvider` từ `src/core/`.
- Thống nhất cách tiếp cận: mỗi platform có `client.js`, `crawler.js`, `normalizer.js`, `validator.js`.
- Cho phép tất cả scraper mới nhận `ProxyProvider` từ constructor, fallback qua `PROXY_URL` env.
- Không duyệt lại kiến trúc tổng thể; chỉ thêm platform adapters và cầu nối proxy.

## 2. Platform Strategy

| Platform | Adapter | Auth | Proxy | Complexity |
|----------|---------|------|-------|------------|
| Reddit | `http` (got-scraping / undici) | OAuth2 read-only | Required for scale | Low |
| Medium | `http` or `cheerio` | None (public RSS/HTML) | Required if geo-blocked | Low |
| Instagram | `puppeteer` or `instagrapi` Python bridge | Session cookie / username+password | Required | High |

## 3. Core Invariants (must hold)

- **IN-1**: Mọi `Client` mới extends `AbstractApiClient` hoặc implements `AbstractCrawler` interface từ `src/core/`.
- **IN-2**: Mọi `Client` constructor chấp nhận `ProxyProvider` (optional) và `proxy` (string or object) trong `options`.
- **IN-3**: Normalized output phải là `PostItem[]`, `ProfileItem[]`, `CommentItem[]`, hoặc `CommunityItem[]` — không trả về raw platform response.
- **IN-4**: Rate limiting xử lý tại `Client` layer; cào chậm 1–3s giữa các request trừ khi rate limit headers cho phép nhanh hơn.
- **IN-5**: Session/cookie không hard-code; lấy từ env, CLI args, hoặc `PrismaStore`.
- **IN-6**: Mọi social platform session/cookie/proxy phải lưu trong `SocialAccount` model với `encryptedCookie`/`encryptedProxy` (AES-256-GCM). `FacebookAccount` là legacy — sẽ migrate sau.

## 4. Module Layout

```
src/scrapers/social/
├── reddit/
│   ├── client.js         # RedditApiClient extends AbstractApiClient
│   ├── crawler.js        # RedditCrawler extends AbstractCrawler
│   ├── normalizer.js     # Reddit → PostItem/CommentItem/CommunityItem
│   ├── validator.js      # Schema validation for Reddit responses
│   └── index.js          # barrel
├── medium/
│   ├── client.js         # MediumApiClient (RSS + HTML)
│   ├── crawler.js
│   ├── normalizer.js     # RSS/JSON → PostItem
│   ├── validator.js
│   └── index.js
├── instagram/
│   ├── client.js         # InstagramClient (Puppeteer or bridge)
│   ├── crawler.js
│   ├── normalizer.js     # media/user/comment → XActions items
│   ├── validator.js
│   └── index.js
└── index.js              # export new platforms
```

## 5. ProxyProvider Integration

```javascript
// Constructor pattern
class RedditApiClient extends AbstractApiClient {
  constructor(options = {}) {
    super(options);
    this.proxy = options.proxyProvider?.getProxy() || options.proxy || process.env.PROXY_URL;
    this.httpClient = buildHttpClient({ proxy: this.proxy });
  }
}
```

- `src/proxy/providers.js` cung cấp `ProxyProvider` interface.
- `src/proxy/proxy-pool.js` quản lý pool với quarantine, sticky, round-robin.
- Default `PROXY_URL`/`PROXY_URLS` trong `.env` là fallback.
- Mỗi platform có thể ghi đè `country`, `isp`, `sessionId` qua `proxy` option.

## 5.5. Data Storage — SocialAccount

```javascript
// Prisma schema addition
model SocialAccount {
  id              String   @id @default(cuid())
  userId          String
  platform        String   // 'reddit' | 'medium' | 'instagram' | 'facebook' | ...
  label           String
  encryptedCookie String?
  encryptedProxy  String?
  metadata        Json?    // { sessionId, username, deviceId, etc. }
  createdAt       DateTime @default(now())
  updatedAt       DateTime @default(now()) @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  health          SocialAccountHealth?

  @@unique([userId, platform, label])
  @@index([userId])
  @@index([platform])
}

enum SocialAccountHealthStatus {
  active
  checkpoint
  dead
  banned
}

model SocialAccountHealth {
  id          String   @id @default(cuid())
  accountId   String   @unique
  status      SocialAccountHealthStatus
  reason      String?
  lastCheckAt DateTime
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  account     SocialAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
}
```

- Encryption: AES-256-GCM, format `salt:iv:authTag:encrypted`, key = `scryptSync(SESSION_SECRET || JWT_SECRET || 'dev-only-key', salt, 32)`
- `metadata` lưu platform-specific fields: Instagram `sessionId`/`username`/`deviceId`, Reddit `refreshToken`, Medium `uid`
- `SocialAccount` thay thế `FacebookAccount` cho mọi platform mới; `FacebookAccount` migration deferred

## 6. Data Flow

```
CrawlerCommand → AbstractCrawler → [Platform]Client → ProxyProvider → HTTP/Browser
                                  → [Platform]Normalizer → [Platform]Validator → PrismaStore
```

- `Client` thực hiện fetch thô và xử lý rate limit.
- `Crawler` điều phối pagination/gap-filling và gọi `Client`.
- `Normalizer` chuyển raw response thành domain items.
- `Validator` đảm bảo schema contract trước khi lưu.

## 7. Key Technical Decisions

- **AD-35-1**: Reddit dùng HTTP-only (không cần browser) vì official API ổn định.
- **AD-35-2**: Medium dùng RSS trước, HTML scraping fallback nếu RSS thay đổi.
- **AD-35-3**: Instagram dùng `instagrapi` Python bridge hoặc Puppeteer public GraphQL; decision deferred đến Story 35.3.
- **AD-35-4**: Proxy là optional ở constructor nhưng required ở production cho Instagram.
- **AD-35-5**: `country-us` hoặc residential proxy là default cho Reddit/Medium/Instagram; `country-vn` chỉ dùng cho VN platforms.
- **AD-35-6**: `SocialAccount`/`SocialAccountHealth` là canonical storage cho session/cookie/proxy (AES-256-GCM encryption); `FacebookAccount` migration deferred to a later epic.

## 8. Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Reddit API pricing changes | Read-only mode + monitoring r/redditdev |
| Medium RSS disabled | Fallback HTML scraping + `cheerio` adapter |
| Instagram private API block | Contingency: external service or public only |
| Proxy IP blacklisted | Quarantine + rotation + residential proxy pool |
| Python `instagrapi` dependency | Wrap as subprocess service or optional package |

## 9. Acceptance Tests (architecture level)

- Reddit client fetches `/r/programming/.json` with valid User-Agent and returns `PostItem[]`.
- Medium client fetches `medium.com/feed/@x` and returns `PostItem[]`.
- Instagram client (Puppeteer path) logs in via session cookie and fetches `user_medias`.
- All three clients respect `ProxyProvider` when provided.
- No raw platform response leaks past `Validator`.

## 10. References

- Research: `_bmad-output/planning-artifacts/research/technical-scraping-reddit-medium-instagram-2026-09-08/research.md`
- PRD: `_bmad-output/planning-artifacts/prd.md` (FR-98, FR-99, FR-100)
- Epics: `_bmad-output/planning-artifacts/epics.md` (Epic 35)
- Proxy: `src/proxy/index.js`, `src/proxy/providers.js`, `src/proxy/proxy-pool.js`
- Core: `src/core/AbstractCrawler`, `src/core/base-client.js`
