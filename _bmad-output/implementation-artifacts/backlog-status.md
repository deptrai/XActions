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
| **Tổng Story (10–20, tính từ sprint-status)** | 36 |
| **Tổng Story file (1–9, có trạng thái)** | 48 |
| **Done (1–20)** | 35 story + 6 epic done |
| **In Progress / Ready-for-dev** | 16 story |
| **Backlog** | 17 story |
| **Review** | 2 story |

> *Lưu ý: Epic 1–9 tập trung Facebook; Epic 10–20 tập trung kiến trúc mới (Prisma, proxy/governor, hybrid crawlers, Nowing integration).*

---

## Epic 1–9 (Facebook Platform)

| Epic | Mục tiêu | Epic Status | # Stories | Done | In Progress / Ready | Review | Backlog | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 1 | Facebook Data Reading (profile, posts, followers, search) | ✅ Done | 5 | 5 | 0 | 0 | 0 |  |
| 2 | Facebook Automation (post, like, comment) | ✅ Done | 4 | 4 | 0 | 0 | 0 |  |
| 3 | Multi-Surface & Persistence (CLI, MCP, REST, operations) | ✅ Done | 6 | 6 | 0 | 0 | 0 | Có 3 file 3-2-* đều done |
| 4 | Growth Automation (schedule, share, groups, friends) | ✅ Done | 9 | 9 | 0 | 0 | 0 |  |
| 5 | Messenger Port & Marketplace | ✅ Done | 6 | 4 | 1 | 1 | 0 | 5-2 ready-for-dev; 5-3 review |
| 6 | Anti-Detection & Bot Countermeasures | 🟡 Partial | 14 | 13 | 0 | 1 | 0 | 6-14 account-age review; thiếu 6-1, 6-6, 6-7, 6-8 |
| 7 | Advanced Scraping & Multi-Account | ✅ Done | 4 | 4 | 0 | 0 | 0 |  |
| 8 | Backend Reliability (Prisma singleton, MCP errors, JWT) | 🟡 Partial | 3 | 2 | 1 | 0 | 0 | 8-2 ready-for-dev |
| 9 | Live Data & Behavioral Hardening | 🔴 Backlog | 4 | 0 | 0 | 0 | 4 | Chưa có story file |

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
| 5.3 Auth proxy | review |
| 5.4 Input queue surfaces | done |
| 5.5 Session campaign UI | done |
| 5.6 Marketplace & headless share v2 | done |
| 6.2 Consistent fingerprint | done |
| 6.3 UA pool & viewport | done |
| 6.4 Navigator override | done |
| 6.5 WebRTC leak prevention | done |
| 6.9 Bezier mouse | done |
| 6.10 Human click | done |
| 6.11 Typing typos | done |
| 6.12 Natural scrolling | done |
| 6.13 Velocity limits | done |
| 6.14 Account age | review |
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
| 9.x | backlog (4 stories, chưa có file) |

---

## Epic 10–20 (Universal Hybrid Scraping Engine)

| Epic | Mục tiêu | Epic Status | # Stories | Done | In Progress | Ready-for-dev | Backlog | Ghi chú |
|---|---|---|---|---|---|---|---|---|
| 10 | Unified PostgreSQL Storage & Core Interfaces | ✅ Done | 5 | 5 | 0 | 0 | 0 |  |
| 11 | Resilient Network & Proxy/Account Pool | 🟡 In Progress | 5 | 3 | 0 | 1 | 1 | 11.5/11.6 đã gộp vào 11.3; 11.7 backlog |
| 12 | Frictionless Authentication (QR, CDP) | 🟡 In Progress | 2 | 0 | 0 | 1 | 1 | 12.1 ready-for-dev |
| 13 | Hybrid Scraping Engine (Twitter/Facebook) | 🟡 In Progress | 3 | 0 | 1 | 2 | 0 | Nhiều legacy overlap |
| 14 | Deep Conversation, MCP Daemon, Nowing Stream | 🟡 In Progress | 3 | 0 | 2 | 1 | 0 |  |
| 15 | Threads & TikTok | 🟡 In Progress | 2 | 0 | 0 | 1 | 1 | 15.1 ready-for-dev |
| 16 | Shopee & TikTok Shop | 🔴 Backlog | 2 | 0 | 0 | 0 | 2 | Legacy ở Nowing repo |
| 17 | Chợ Tốt & Batdongsan | 🔴 Backlog | 2 | 0 | 0 | 0 | 2 | Legacy ở Nowing repo |
| 18 | TopCV, VietnamWorks, LinkedIn | 🔴 Backlog | 3 | 0 | 0 | 0 | 3 | 18.3 blocked bởi 12.2 |
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
| 11.7 Crawler-governor integration | backlog |  |
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
| 16.1 Shopee | backlog |  |
| 16.2 TikTok Shop | backlog |  |
| 17.1 Chợ Tốt | backlog |  |
| 17.2 Batdongsan | backlog |  |
| 18.1 TopCV | backlog |  |
| 18.2 VietnamWorks | backlog |  |
| 18.3 LinkedIn | backlog |  |
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

## Cảnh báo / Inconsistency cần chú ý

1. **Epic 6 thiếu story file 6.1, 6.6, 6.7, 6.8**: `epics-full.md` ghi 17 stories nhưng chỉ tìm thấy 14 file. Cần kiểm tra xem 4 story này bị bỏ quên hay đã merge.
2. **Story 5.3 (auth proxy) ở `review` khá lâu**: có thể chuyển sang `done` hoặc `ready-for-dev` nếu code đã ổn định.
3. **Epic 8.2 (executeTool graceful errors) ready-for-dev**: thuộc PCR6, có thể làm nhanh để harden MCP.
4. **Epic 9 hoàn toàn backlog**: 4 story chưa có file, là phần duy nhất trong 1–9 chưa bắt đầu.
5. **Epic 11.7 backlog**: story này là cầu nối giữa `AbstractCrawler` và `AdaptiveRateGovernor`, cần làm trước khi các crawler mới (13–18) chạy ổn định.

---

## Decommission Plan (Epic 20.1)

Sau khi 13–18 hoàn thành, các module legacy sau sẽ bị xóa:

- `src/client/Scraper.js` + `src/client/`
- `src/scrapers/twitter/index.js` + `src/scrapers/twitter/http/`
- `src/scrapers/facebook/index.js`
- `src/scrapers/threads/index.js`

`src/scrapers/index.js` sẽ delegate sang `AbstractCrawler` instances thay vì gọi hàm legacy trực tiếp.
