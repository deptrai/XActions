# XActions Backlog Status Dashboard (Epics 1–20)

> Tổng hợp trạng thái toàn bộ story backlog. Cập nhật lần cuối: 2026-08-21.
>
> Nguồn:
> - Epics 1–9: story file headers trong `_bmad-output/implementation-artifacts/<epic>-<story>.md`.
> - Epics 10–20: `_bmad-output/implementation-artifacts/sprint-status.yaml`.
> - `epics-full.md` dùng để xác nhận scope Epic 1–9.

---

## Tổng quan

| Metric | Count |
|---|---|
| **Tổng Epic** | 20 |
| **Tổng Story** | 95 |
| **Done** | 62 story |
| **In Progress** | 4 story |
| **Ready-for-dev** | 24 story |
| **Backlog** | 5 story |
| **Review** | 0 story |

> *Lưu ý: Epic 1–9 tập trung Facebook; Epic 10–20 tập trung kiến trúc mới (Prisma, proxy/governor, hybrid crawlers, Nowing integration).*

---

## Epic 1–9 (Facebook Platform)

| Epic | Mục tiêu | Epic Status | # Stories | Done | Ready | Review | Backlog | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 1 | Facebook Data Reading (profile, posts, followers, search) | ✅ Done | 5 | 5 | 0 | 0 | 0 |  |
| 2 | Facebook Automation (post, like, comment) | ✅ Done | 4 | 4 | 0 | 0 | 0 |  |
| 3 | Multi-Surface & Persistence (CLI, MCP, REST, operations) | ✅ Done | 6 | 6 | 0 | 0 | 0 | Có 3 file 3-2-* đều done |
| 4 | Growth Automation (schedule, share, groups, friends) | ✅ Done | 9 | 9 | 0 | 0 | 0 |  |
| 5 | Messenger Port & Marketplace | ✅ Done | 6 | 5 | 1 | 0 | 0 | 5-2 ready-for-dev |
| 6 | Anti-Detection & Bot Countermeasures | ✅ Done | 18 | 18 | 0 | 0 | 0 | 6-1/6-6/6-7/6-8 đã tạo file |
| 7 | Advanced Scraping & Multi-Account | ✅ Done | 4 | 4 | 0 | 0 | 0 |  |
| 8 | Backend Reliability (Prisma singleton, MCP errors, JWT) | 🟡 Partial | 3 | 2 | 1 | 0 | 0 | 8-2 ready-for-dev |
| 9 | Live Data & Behavioral Hardening | � In Progress | 4 | 0 | 4 | 0 | 0 | 9-1/9-2/9-3/9-4 đã tạo file |

### Chi tiết trạng thái Epic 1–9

| Story | Status |
|---|---|
| 1.1 Facebook adapter scaffold | done |
| 1.2 Scrape profile | done |
| 1.3 Scrape posts | done |
| 1.4 Scrape followers | done |
| 1.5 Search posts | done |
| 2.1 Automation scaffold | done |
| 2.2 Auto like | done |
| 2.3 Auto comment | done |
| 2.4 Create post | done |
| 3.1 CLI platform | done |
| 3.2 MCP Facebook | done |
| 3.2-1 Facebook MCP tool surface extension | done |
| 3.2 MCP tools | complete |
| 3.3 REST API | done |
| 3.4 Operation persistence | done |
| 4.1 Schedule post | done |
| 4.2 Auto share post | done |
| 4.3 View boost | done |
| 4.4 Join groups | done |
| 4.5 Batch post groups | done |
| 4.6 Scrape group members | done |
| 4.7 Send friend requests | done |
| 4.8 Cancel friend requests | done |
| 4.9 Newsfeed farming | done |
| 5.1 GraphQL layer | done |
| 5.2 Messenger share | ready-for-dev |
| 5.3 Auth proxy | done |
| 5.4 Input queue surfaces | done |
| 5.5 Session campaign UI | done |
| 5.6 Marketplace & headless share v2 | done |
| 6.1 Chrome executablePath auto-resolution | done |
| 6.2 Consistent fingerprint | done |
| 6.3 UA pool & viewport | done |
| 6.4 Navigator override | done |
| 6.5 WebRTC leak prevention | done |
| 6.6 Headless mode parameter | done |
| 6.7 Headless-aware timeouts | done |
| 6.8 Behavioral delays in share-link-uid | done |
| 6.9 Bezier mouse | done |
| 6.10 Human click | done |
| 6.11 Typing typos | done |
| 6.12 Natural scrolling | done |
| 6.13 Velocity limits | done |
| 6.14 Account age | done |
| 6.15 Session warming | done |
| 6.16 Timezone & geolocation | done |
| 6.17 Persistent profiles | done |
| 6.18 Human behavior hardening | done |
| 7.1 Foundation health/pool/hydration schema | done |
| 7.2 Multi-type search | done |
| 7.3 Comments & group content | done |
| 7.4 API/MCP surface | done |
| 8.1 PrismaClient singleton | done |
| 8.2 executeTool graceful errors | ready-for-dev |
| 8.3 JWT key standardization | done |
| 9.1 Fix cancel_friend_requests dry-run delay | ready-for-dev |
| 9.2 Verify live Facebook comments selectors | ready-for-dev |
| 9.3 Verify live group posts and group search | ready-for-dev |
| 9.4 Injectable delayFn for loginWithCookie | ready-for-dev |

---

## Epic 10–20 (Universal Hybrid Scraping Engine)

| Epic | Mục tiêu | Epic Status | # Stories | Done | In Progress | Ready-for-dev | Backlog | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 10 | Unified PostgreSQL Storage & Core Interfaces | ✅ Done | 5 | 5 | 0 | 0 | 0 |  |
| 11 | Resilient Network & Proxy/Account Pool | 🟡 In Progress | 5 | 3 | 0 | 2 | 0 | 11.5/11.6 đã gộp vào 11.3 |
| 12 | Frictionless Authentication (QR, CDP) | 🟡 In Progress | 2 | 0 | 0 | 1 | 1 | 12.1 ready-for-dev |
| 13 | Hybrid Scraping Engine (Twitter/Facebook) | 🟡 In Progress | 3 | 0 | 1 | 2 | 0 | Nhiều legacy overlap |
| 14 | Deep Conversation, MCP Daemon, Nowing Stream | 🟡 In Progress | 3 | 0 | 2 | 1 | 0 |  |
| 15 | Threads & TikTok | 🟡 In Progress | 2 | 0 | 0 | 1 | 1 | 15.1 ready-for-dev |
| 16 | Shopee & TikTok Shop | � In Progress | 2 | 0 | 0 | 2 | 0 | Story files created; port from Nowing |
| 17 | Chợ Tốt & Batdongsan | � In Progress | 2 | 0 | 0 | 2 | 0 | Story files created; port from Nowing |
| 18 | TopCV, VietnamWorks, LinkedIn | � In Progress | 3 | 0 | 0 | 2 | 1 | 18.3 blocked bởi 12.2 |
| 19 | Admin Dashboard, CLI, REST, MCP | 🟡 In Progress | 8 | 1 | 1 | 5 | 1 | 19.5 done |
| 20 | Nowing Cutover & Decommission | 🔴 Backlog | 1 | 0 | 0 | 0 | 1 | Blocked bởi 13–18 |

### Chi tiết trạng thái Epic 10–20

| Story | Status | Ghi chú |
|---|---|---|
| 10.1 Core domain interfaces | done |  |
| 10.2 Prisma post/comment schema | done |  |
| 10.3 AI dataset export utility | done |  |
| 10.4 Crawl checkpoint API | done |  |
| 10.5 Metadata schema registry | done |  |
| 11.1 ProxyIpPool & AccountPool | done |  |
| 11.2 Proxy providers | done |  |
| 11.3 429/403 quarantine & replay | done | Đã hấp thụ 11.5/11.6 |
| 11.4 Adaptive governor | ready-for-dev | Core đã có, thiếu surface |
| 11.7 Crawler-governor integration | ready-for-dev | Story file created |
| 12.1 Terminal QR login | ready-for-dev | Partial overlap qrcode.js |
| 12.2 CDP attach | backlog |  |
| 13.1 Tiered signer bridge | in-progress | PreSignedTokenRing done |
| 13.2 Twitter hybrid refactor | ready-for-dev | Legacy scraper overlap |
| 13.3 Facebook hybrid refactor | ready-for-dev | Legacy scraper overlap |
| 14.1 Comment tree extraction | ready-for-dev |  |
| 14.2 MCP daemon HTTP/SSE | in-progress | HTTP transport có sẵn |
| 14.3 Redis stream ingest | in-progress | Stream infra có sẵn |
| 15.1 Threads scraper | ready-for-dev | Legacy threads overlap |
| 15.2 TikTok scraper | backlog |  |
| 16.1 Shopee | ready-for-dev | Port from nowing_backend/shopee |
| 16.2 TikTok Shop | ready-for-dev | Port from nowing_backend/tiktok-shop |
| 17.1 Chợ Tốt | ready-for-dev | Port from nowing_backend/chotot |
| 17.2 Batdongsan | ready-for-dev | Port from nowing_backend/batdongsan |
| 18.1 TopCV | ready-for-dev | Port from nowing_backend/topcv |
| 18.2 VietnamWorks | ready-for-dev | Port from nowing_backend/vietnamworks |
| 18.3 LinkedIn | backlog | Blocked by 12.2 CDP |
| 19.1 Dashboard jobs/checkpoints | ready-for-dev | Backend có, thiếu view |
| 19.2 Dashboard proxies/accounts | ready-for-dev |  |
| 19.3 Dashboard stream metrics | ready-for-dev |  |
| 19.4 Admin CLI | ready-for-dev |  |
| 19.5 Admin CLI checkpoints | done |  |
| 19.6 Admin CLI stream metrics | in-progress |  |
| 19.7 Admin REST API | ready-for-dev |  |
| 19.8 Admin MCP tools | backlog |  |
| 20.1 Nowing cutover | backlog |  |

---

## Những điểm đã giải quyết (2026-08-21)

1. ✅ **Epic 6 thiếu story file 6.1, 6.6, 6.7, 6.8** — đã tạo 4 file stub, xác nhận implement trong 5b.2/5b.3/5b.4.
2. ✅ **Story 5.3 và 6.14 ở `review` quá lâu** — đã kiểm tra code (`loginWithPassword`, `generateTotp`, `getAccountAgeDays` đều implement + test) và chuyển sang `done`.
3. ✅ **Epic 9 hoàn toàn backlog** — đã tạo 4 story file 9.1–9.4 từ PCRs.
4. ✅ **Epic 11.7 backlog** — đã tạo story file `11-7-crawler-governor-integration-validator-contract.md` và chuyển `sprint-status.yaml` sang `ready-for-dev`.
5. ✅ **Epic 16–18 legacy scrapers ở Nowing repo** — đã tạo story files 16.1/16.2, 17.1/17.2, 18.1/18.2/18.3 với ghi chú port từ `nowing_backend/app/proprietary/platforms/`; chuyển 16–17 và 18.1/18.2 sang `ready-for-dev`, 18.3 giữ `backlog` (blocked by 12.2).

## Còn lại cần chú ý

1. **8.2 executeTool graceful errors** — `ready-for-dev`, làm nhanh để harden MCP.
2. **12.2 CDP attach** — `backlog`, blocker cho 18.3 LinkedIn.
3. **15.2 TikTok scraper** — `backlog`.
4. **19.8 Admin MCP tools** — `backlog`.

---

## Decommission Plan (Epic 20.1)

Sau khi 13–18 hoàn thành, các module legacy sau sẽ bị xóa:

- `src/client/Scraper.js` + `src/client/`
- `src/scrapers/twitter/index.js` + `src/scrapers/twitter/http/`
- `src/scrapers/facebook/index.js`
- `src/scrapers/threads/index.js`

`src/scrapers/index.js` sẽ delegate sang `AbstractCrawler` instances thay vì gọi hàm legacy trực tiếp.
