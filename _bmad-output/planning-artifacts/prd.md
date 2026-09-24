---
title: "PRD: Epics 10–20 + 23–26 — XActions Universal Hybrid Scraping & Intelligence Microservice Platform"
created: 2026-08-18
updated: 2026-09-09
status: approved
canonical: true
supersedes:
  - _bmad-output/planning-artifacts/archive/prds/prd-XActions-2026-06-08/prd.md
  - _bmad-output/planning-artifacts/archive/prds/prd-XActions-2026-06-10-epic4/prd.md
  - _bmad-output/planning-artifacts/archive/prds/prd-XActions-2026-08-14-epic7/prd.md
  - _bmad-output/planning-artifacts/archive/prds/prd-XActions-2026-08-18-universal-scraping-engine/prd.md
note: "Canonical PRD cho Epics 10–20, Phase 4 extension Epics 23–26 (Bluesky/Mastodon, utility/adapters consolidation, dispatcher unification, legacy decommission), và Vietnam Market Pivot Epics 21–22, 33 (B2B registry, automotive, F&B, healthcare, legal, Zalo, YouTube VN). Các PRD cũ trong `archive/prds/` được đánh dấu deprecated. FR-24..FR-54 xem `prd-facebook-epics-5-6-2026-08-21.md`. FR-62 xem `FUTURE-WORK.md`."
author: "John (BMad Product Manager) & Winston (BMad System Architect)"
epics: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 23, 24, 25, 26]
prd_ref:
  - prd-XActions-2026-06-08
  - prd-XActions-2026-06-10-epic4
  - prd-XActions-2026-08-14-epic7
---

# PRD: Epics 10–20 + 23–26 — XActions Universal Hybrid Scraping & Intelligence Microservice Platform

*Chuyển đổi toàn diện XActions thành Nền tảng Động cơ Cào Dữ liệu Toàn Năng (Universal Scraping Microservice) đa ngành: Mạng Xã Hội (X, Facebook, Threads, TikTok, Instagram, Bluesky, Mastodon, **Reddit, Medium**), Thương Mại Điện Tử (Shopee, TikTok Shop), Bất Động Sản (Chợ Tốt bóc tách SĐT, Batdongsan.com.vn), và Tuyển Dụng (TopCV, VietnamWorks, LinkedIn).*

---

## 0. Mục Đích & Bối Cảnh Tài Liệu

Tài liệu PRD này là bước nhảy vọt chiến lược tiếp nối từ `prd-XActions-2026-08-14-epic7` (Epics 1–9). PRD này chính thức định nghĩa kiến trúc và yêu cầu sản phẩm cho **Epics 10 đến 20**, cùng **Phase 4 extension Epics 23–26**:
1. **Chuyển dịch sang mô hình Microservice Engine:** XActions trở thành Động cơ Cào dữ liệu chuyên trách (Dedicated Scraping Microservice) cho hệ sinh thái **Nowing (AI Lead & Research Hub)** và nền tảng SaaS / CLI / AI MCP độc lập.
2. **Áp dụng Đột Phá Kỹ Thuật "Tiered Hybrid Browser-Signer Engine":** Kết hợp Pre-Signed Token Ring Buffer O(1) và Signer Worker Page Pool giải mã chữ ký JS (`a_bogus`, `x-client-transaction-id`), chuyển 100% việc fetch dữ liệu sang Async HTTP Client (`got-scraping`/`undici`), giúp giảm **85% RAM**, tăng tốc độ **5–10x**, và tiết kiệm 90% tài nguyên server.
3. **Hợp Nhất Cơ Sở Dữ Liệu trên PostgreSQL (Prisma ORM):** Loại bỏ hoàn toàn sự phân mảnh của SQLite, quy chuẩn hóa dữ liệu đa ngành vào PostgreSQL với quy ước Namespaced ID `${platform}:${externalId}` và cột `metadata Json?` có GIN Index.
4. **Cơ Chế Khai Thác Dữ Liệu 3 Tầng (3-Tier Incremental Gap-Filling):** Chỉ cào bù khoảng trống dữ liệu mới (Delta Gap), triệt tiêu 100% việc cào trùng lặp và tiết kiệm 90% chi phí proxy.
5. **Kế Hoạch Bàn Giao & Dọn Dẹp (Nowing Cutover & Decommissioning):** Thay thế toàn bộ 20+ scraper cũ bên Nowing bằng XActions MCP Client, giảm dung lượng Docker image của Nowing từ 4GB xuống còn <500MB.
6. **Hoàn thiện kiến trúc Universal AbstractCrawler (Epics 23–26):** Đưa Bluesky, Mastodon, Reddit, Medium, Instagram, utility scripts, adapter layer, và dispatcher về cùng một `AbstractCrawler` / `AbstractApiClient` / `CrawlerCommand`, sau đó xóa bỏ toàn bộ legacy scraper modules.

---

## 1. Tầm Nhìn Sản Phẩm (Product Vision)

Trở thành **Nền tảng Tự động hóa & Khai thác Dữ liệu Web Toàn Năng số 1 tại Đông Nam Á (Universal Web Scraping & Lead Intelligence Platform)**:
* **Không tốn phí API bên thứ 3:** Tự động hóa qua giao thức Reverse-Engineered Web API và Browser Signature Bridge.
* **Độ bao phủ đa lĩnh vực (All-in-One):** Tích hợp trọn gói Social Media, E-Commerce, Bất Động Sản, và Tuyển Dụng trong 1 engine duy nhất.
* **Chuẩn AI-First:** Tích hợp trực tiếp 80+ công cụ Model Context Protocol (MCP) cho AI Agent (Claude, Cursor, Antigravity) và Realtime Redis Event Streams cho các nền tảng phân tích NLP/RAG.

---

## 2. Đối Tượng Người Dùng & Jobs-To-Be-Done (JTBD)

### 2.1. Bốn (4) Tệp Khách Hàng Mục Tiêu:

1. **Nowing AI Platform (B2B Lead & Market Intelligence Engine):**
   * *JTBD:* Tự động thu thập hàng ngàn bài đăng BĐS (kèm SĐT chính chủ từ Chợ Tốt), nhu cầu tuyển dụng (TopCV/VietnamWorks), và sản phẩm bán chạy (Shopee/TikTok Shop) đưa vào Lead CRM mà không phải tự vận hành scraper.
2. **Khách hàng SaaS & Marketers (Growth Hackers, Sellers, Nhà đầu tư):**
   * *JTBD:* Quét và phân tích đối thủ, theo dõi biến động giá Shopee, cào toàn bộ cây bình luận đa tầng (nested replies) trên Facebook/TikTok để phân tích Customer Sentiment.
3. **Developers & Data Scientists (Sử dụng CLI `unfollowx`):**
   * *JTBD:* Cào hàng triệu records dữ liệu qua dòng lệnh CLI, đăng nhập không cần mật khẩu qua Terminal ASCII QR Code hoặc gắn Chrome thật (CDP 9222), xuất dữ liệu stream JSONL/CSV nén Gzip phục vụ huấn luyện LLM.
4. **AI Agents (Claude, Cursor, Antigravity thông qua MCP):**
   * *JTBD:* Ra lệnh cào web và bóc tách dữ liệu theo thời gian thực bằng ngôn ngữ tự nhiên thông qua 80+ MCP tools chuẩn 3-Layer JSON Envelope.

---

## 3. Danh Mục Yêu Cầu Chức Năng (Functional Requirements FR-64 ➔ FR-101)

### Nhóm 1: Hạ Tầng Cốt Lõi & Lưu Trữ PostgreSQL (Epic 10)
* **FR-64 (Core Domain Interfaces):** Cung cấp các cổng trừu tượng chuẩn hóa (`AbstractCrawler`, `AbstractApiClient`, `AbstractLogin`, `AbstractStore`, `ISignerBridge`) thuần ESM, Zero-Dependency.
* **FR-67 (Namespaced PostgreSQL Storage & JSONB GIN Indexes):** Lưu trữ tập trung `Post` và `Comment` vào PostgreSQL qua Prisma ORM với khóa chính dạng `${platform}:${externalId}`, `metadata Json?` có GIN Index và batch chunking 500 records.

### Nhóm 2: Mạng & Quản Lý Proxy Bọc Thép (Epic 11)
* **FR-66 (Proxy Pool & Auto-Quarantine):** Quản lý tập trung Static & Dynamic Tunnel Proxy, tự động kích hoạt cờ chống rò rỉ WebRTC/DNS (`--force-webrtc-ip-handling-policy=disable_non_proxied_udp`) và kiểm tra buffer expiration 30s. Cách ly proxy lỗi 5 phút khi gặp mã `429/403`, tự động đổi IP và retry 3 lần với exponential backoff. Chuyển sang Standby Backoff 30s khi 100% proxy bị chặn.
* **FR-66B (Adaptive Rate Limiter):** Điều phối tốc độ scrape theo giới hạn an toàn của nền tảng (Story 11.4).

### Nhóm 3: Xác Thực Không Ma Sát (Epic 12)
* **FR-68 (Terminal ASCII QR Code Login):** Hiển thị mã QR tỷ lệ 1:1 chuẩn (`small: true`) trực tiếp trên Terminal console kèm đếm ngược 60s, timeout 120s và polling cookie ngầm.
* **FR-69 (CDP Remote Attach Mode):** Kết nối trực tiếp vào Google Chrome thật qua cổng 9222 với helper command `unfollowx auth --launch-chrome` và độ trễ phân phối ngẫu nhiên Gaussian Jitter (3–7s).

### Nhóm 4: Động Cơ Cào Lai Tốc Độ Cao & Mạng Xã Hội Trọng Điểm (Epic 13, 14)
* **FR-65 (Tiered Hybrid Signer Engine):** Kết hợp Pre-Signed Token Ring Buffer O(1) và Signer Worker Page Pool (4–8 tabs ngầm có `Promise.race()` 3s timeout) cùng `got-scraping` (TLS/JA4 Spoofing).
* **FR-71 (Twitter Crawler Refactor):** Tái cấu trúc cào Twitter sang GraphQL kết hợp Signer Page Pool và PrismaStore.
* **FR-72 (Facebook Crawler Refactor):** Tái cấu trúc cào Facebook qua GraphQL DocID dispatch kết hợp Proxy Pool.
* **FR-70 (Topological Comment Tree Extraction):** Trích xuất toàn bộ cây bình luận đa tầng (`maxDepth: 3`, `maxComments: 500`), chống tham chiếu vòng, và lưu vào DB theo thứ tự Topological Sort (Root trước, SubComments sau).
* **FR-73 (MCP Daemon & CLI Integration + Streaming Dataset Exporter):** Cung cấp 80+ MCP tools trả về 3-Layer JSON Envelope có cơ chế Auto-Artifact khi payload >100 records. Hỗ trợ xuất dữ liệu ra định dạng JSONL/CSV stream với backpressure.
* **FR-83 (Realtime Thin Event Redis Stream Ingest):** Phát luồng sự kiện tinh gọn (`{ id, platform, externalId, category, authorId, crawledAt, storageRef }`) vào Redis Stream `stream:social:raw_posts` (`MAXLEN ~ 1000000` hoặc `MINID`, configurable).
* **FR-84 (Nowing Adapter Cutover & Legacy Scraper Decommissioning):** Nâng cấp adapter bên Nowing kết nối sang XActions MCP/Redis Stream và gỡ bỏ hoàn toàn 20+ scraper cũ cùng browser dependencies khỏi Nowing backend.

### Nhóm 5: Mạng Xã Hội Trending (Epic 15)
* **FR-74 (Threads Meta GraphQL Scraper):** Cào bài viết, timeline và replies trên Threads qua internal Meta GraphQL (LSD token + DocID).
* **FR-75 (TikTok Video, Hashtag & Comment Scraper):** Cào video trending và hàng ngàn bình luận TikTok qua `a_bogus` Signer Bridge có kiểm tra mã chặn False 200 OK (`error !== 0`).

### Nhóm 6: Thương Mại Điện Tử (Epic 16)
* **FR-76 (Shopee Product, Price & Review Scraper):** Cào sản phẩm, flash sale, giá bán và đánh giá người mua trên Shopee VN qua Web API kết hợp TLS Spoofing và Anti-Bot Validation.
* **FR-77 (TikTok Shop E-Commerce Winning Products Scraper):** Cào sản phẩm bán chạy, doanh số ước tính và đánh giá shop trên TikTok Shop.

### Nhóm 7: Bất Động Sản (Epic 17)
* **FR-78 (Chợ Tốt Multi-Category Scraper with Phone Extractor):** Cào tin đăng BĐS Chợ Tốt kèm giải mã SĐT chính chủ (loại bỏ SĐT masked `***` và validate regex VN).
* **FR-79 (Batdongsan.com.vn Property Scraper):** Cào tin rao BĐS dự án, diện tích và biến động giá đất trên Batdongsan.com.vn.

### Nhóm 8: Tuyển Dụng & B2B Leads (Epic 18)
* **FR-80 (TopCV Recruitment Scraper):** Cào tin tuyển dụng, kỹ năng yêu cầu và dải lương (xử lý case "Thỏa thuận") trên TopCV.
* **FR-81 (VietnamWorks Job Scraper):** Cào tin tuyển dụng IT và cấp cao trên VietnamWorks qua API public.
* **FR-82 (LinkedIn B2B Lead & Job Scraper):** Cào thông tin nhân sự và bài đăng tuyển dụng trên LinkedIn qua CDP Remote Attach 9222.

### Nhóm 9: Open/Federated Social Media & Universal Architecture Completion (Epics 23–26)
* **FR-89 (Bluesky AT Protocol Scraper):** Cào profile, followers, following, user feed, search, và custom feeds trên Bluesky qua public AT Protocol API (`https://public.api.bsky.app`) với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ optional auth (`identifier`/`password`) cho non-public data.
* **FR-90 (Mastodon REST API Scraper):** Cào profile, followers, following, timeline, search, hashtag, và trending trên bất kỳ Mastodon instance nào qua public REST API với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ optional `accessToken` cho authenticated endpoints.
* **FR-98 (Reddit Hybrid Scraper):** Cào subreddit, post, comment, user, và search trên Reddit qua official REST API (`https://api.reddit.com`) hoặc public JSON endpoints với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ OAuth2 read-only mode; **RSS fallback (`/r/{sub}/new.rss`) khi `.json` endpoint trả 403**; **Puppeteer stealth bridge tùy chọn cho full data khi không có OAuth/residential proxy**; normalize `t3` → `PostItem`, `t1` → `CommentItem`, `t5` → `CommunityItem`; tích hợp rate limiter dựa trên `x-ratelimit-*` headers.
* **FR-99 (Medium RSS/HTML Scraper):** Cào post, publication, và tag trên Medium qua public RSS feed (`https://medium.com/@username/feed`) hoặc HTML rendering với `AbstractCrawler` + `AbstractApiClient`; không cần authentication; normalize RSS item → `PostItem`.
* **FR-100 (Instagram Hybrid Scraper):** Cào profile, media, comment, và hashtag trên Instagram qua private API (`instagrapi` bridge hoặc tương đương) hoặc Puppeteer public scraping với `AbstractCrawler` + `AbstractApiClient`; yêu cầu session persistence, proxy rotation, và device emulation; hỗ trợ optional proxy qua `ProxyProvider`.
* **FR-91 (Utility Scripts & Adapters Consolidation):** Audit và quyết định deprecation cho `src/scrapers/*.js` độc lập và `src/scrapers/adapters/`. Convert các tính năng hữu ích (video download, bookmark export, thread unroll) thành `CrawlerCommand` action hoặc chuyển vào `archive/`. Thu gọn adapter layer về `http`, `playwright`, `puppeteer` provider duy nhất.
* **FR-92 (Unified Dispatcher & Backward Compatibility):** `src/scrapers/index.js` trở thành thin dispatcher duy nhất cho mọi platform qua `scrape(platform, action, args)`. Tất cả MCP/CLI/API caller gọi `CrawlerCommand` thay vì import platform cụ thể. Giữ `package.json` exports backward-compatible cho ít nhất 1 release cycle.
* **FR-93 (Legacy Decommission):** Xóa `src/client/Scraper.js`, `src/scrapers/twitter/`, `src/scrapers/facebook/`, `src/scrapers/threads/` (legacy), `src/scrapers/bluesky/` (legacy), `src/scrapers/mastodon/` (legacy), và `src/scrapers/adapters/` sau khi đạt shadow-run parity ≥ 99% trong 7 ngày.
* **FR-94 (Vietnam B2B Registry & Tender Crawler):** Cào danh bạ doanh nghiệp mới thành lập (MST, người đại diện, SĐT, ngành nghề) từ `masothue.com` (HTTP-only) và `hosocongty.vn`, `muasamcong.mpi.gov.vn` (deferred to Epic 21.3 pending Cloudflare/SPA bypass). Chuẩn hóa `PostItem` (`platform: 'masothue' | 'hosocongty' | 'muasamcong'`, `category: 'b2b_lead'`). (Epic 21.1 + 21.3)
* **FR-95 (Vietnam Automotive Market Crawler):** Cào tin rao bán ô tô, xe máy, xe điện từ `oto.com.vn`, `bonbanh.com`, `xe.chotot.com` kèm SĐT chính chủ, hãng/dòng/năm/giá. Chuẩn hóa `PostItem` (`category: 'automotive'`). (Epic 21.2)
* **FR-96 (Vietnam F&B, Healthcare & Legal Directory Crawler):** Cào danh bạ nhà hàng/quán cafe (PasGo, Foody, Riviu), phòng khám/nhà thuốc (Medpro, YouMed, Thuocsi), và đơn đăng ký nhãn hiệu (IP Vietnam `wipo.ipvietnam.gov.vn`). Chuẩn hóa `PostItem` (`category: 'fnb_merchant' | 'healthcare' | 'legal'`). (Epic 22.1–22.3)
* **FR-97 (Zalo OA & YouTube VN Crawler):** Cào Zalo Official Account posts/followers qua Zalo OA API v3.0 (`openapi.zalo.me`) và YouTube VN channels/videos/comments qua YouTube Data API v3 với `regionCode: 'VN'`. HTML fallback khi API quota exhausted. Chuẩn hóa `PostItem` (`platform: 'zalo' | 'youtube'`). (Epic 33)
* **FR-101 (Unified Social Account Storage):** Cung cấp `SocialAccount` và `SocialAccountHealth` Prisma models để lưu trữ session/cookie/proxy dùng chung cho mọi social platform (Reddit, Medium, Instagram, và các platform tương lai). Hỗ trợ `encryptedCookie`, `encryptedProxy`, `metadata Json?`, và quan hệ `User → SocialAccount[]`. Encryption dùng AES-256-GCM với key derivation từ `SESSION_SECRET`/`JWT_SECRET`. (Epic 35.4)
* **FR-102 (Pluggable Browser Backend — Obscura for Public Scraping):** Hỗ trợ `launchStealthBrowser` chọn backend `chrome` (default) | `obscura` (CDP, opt-in) qua `options.backend` hoặc `XACTIONS_BROWSER_BACKEND`. `obscura` CHỈ phục vụ public/guest-visible scraping; post-auth actions (`post`/`like`/`reply`/`dm`/`spaces`) reject `obscura` bằng `PlatformError{ type: INVALID_ARGS }`. Primary/fallback qua `XACTIONS_BROWSER_BACKEND` + `XACTIONS_BROWSER_BACKEND_FALLBACK` (`obscura→chrome` luôn được phép; `chrome→obscura` chỉ trên public-scraping path). Mọi navigation trên `obscura` dùng `waitUntil:'networkidle0'` — `networkidle2` không được hỗ trợ (Obscura 0.2.x). Watch → Verify → Promote gate theo `docs/obscura-watch.md` — `obscura-for-auth` chỉ mở opt-in sau spike-verify, không bao giờ default. (Epic 27.4, AD-23)

---

## 4. Danh Mục Yêu Cầu Phi Chức Năng (Non-Functional Requirements NFR-11 ➔ NFR-19)

* **NFR-11 (Tối ưu Tài Nguyên):** Giảm ít nhất **85% RAM** (từ ~10GB xuống <300MB) và **70% CPU** so với mô hình Full Headless Browser. *Củng cố bởi FR-102:* `obscura` backend (~30MB/engine) cho public scraping, đo improvement qua per-backend telemetry (`XACTIONS_BROWSER_BACKEND_METRICS=1` → `browserBackend` trong Epic 34 benchmark).
* **NFR-12 (Băng Thông & Tốc Độ):** Tăng tốc độ thu thập dữ liệu lên ít nhất **5x–10x (>500 requests/giây)** bằng Async HTTP Client với Connection Pool.
* **NFR-13 (Tự Phục Hồi & Chống Chặn):** Tự động phát hiện proxy chết/rate-limit, cách ly 5 phút và replay request 3 lần với exponential backoff.
* **NFR-14 (Bảo Mật Phi Mật Khẩu):** Không lưu trữ plain-text password; đăng nhập an toàn qua Terminal ASCII QR Code và Chrome CDP Attach.
* **NFR-15 (Kiến Trúc Sạch & Khả Năng Mở Rộng):** Lớp `src/core/` hoàn toàn phi phụ thuộc (Zero-Dependency); thêm nền tảng mới chỉ cần viết thêm Adapter.
* **NFR-16 (Bản Quyền & Tương Thích Ngược):** Mã nguồn 100% tuân thủ MIT / Apache 2.0; bảo toàn 100% tương thích ngược với CLI `unfollowx` và 80+ MCP tools.
* **NFR-18 (Universal Architecture Compliance):** 100% nền tảng và crawler trong XActions phải kế thừa `AbstractCrawler` và `AbstractApiClient`, được gọi thống nhất qua `CrawlerCommand`. Không còn module scraper nào sử dụng API surface riêng hoặc nằm ngoài `src/scrapers/social/<platform>/` sau khi Epic 26 hoàn thành.
* **NFR-19 (Vietnam Geo-Consistent Proxy & Locale):** Tất cả request đến VN platforms (Zalo, VN e-commerce, VN government sites) phải sử dụng VN residential proxy hoặc VN-located server IP; timezone `Asia/Ho_Chi_Minh` và locale `vi-VN` phải consistent với proxy region. Áp dụng từ Epic 21 trở đi.

---

## 5. Phân Tầng Lưu Trữ & Vòng Đời Dữ Liệu (Data Retention Policy)

```
┌────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────┐
│ XACTIONS (Tầng Dữ Liệu Thô - Raw Data Lake)           │ NOWING (Tầng Dữ Liệu Tinh Chế - AI Knowledge Hub)      │
├────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────┤
│ • Lưu bài viết thô, raw JSON, headers, likes/shares gốc│ • Lưu Leads CRM, Số điện thoại/Email đã bóc tách       │
│ • Lưu trữ tạm thời với Hot Cache TTL: **30 ngày**      │ • Lưu Vector Embeddings (1536d) và Intent Tags         │
│ • Tự động dọn dẹp sau 30 ngày (Giữ DB < 5GB)           │ • Lưu trữ vĩnh viễn (Permanent Gold Data)              │
└────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────┘
```

---

## 6. Lộ Trình Phân Kỳ Triển Khai (Phasing Execution Roadmap)

* **Phase 1: Foundation & Resilient Infrastructure (Stories 10.1 ➔ 10.3, 11.1 ➔ 11.4, 12.1 ➔ 12.2)** *(9 stories)*
* **Phase 2: Hybrid Signer, Social Flagships & Nowing Cutover (Stories 13.1 ➔ 13.3, 14.1 ➔ 14.4)** *(7 stories)*
* **Phase 3: Viral Social & E-Commerce Expansion (Stories 15.1 ➔ 15.2, 16.1 ➔ 16.2)** *(4 stories)*
* **Phase 4: High-Value Localized Leads & B2B Recruitment (Stories 17.1 ➔ 17.2, 18.1 ➔ 18.3)** *(5 stories)*
* **Phase 5: Universalization & Legacy Decommission (Stories 23.1 ➔ 26.2)** *(14 stories) — Phase 4 extension*

---

*Tài liệu PRD chính thức được phê duyệt bởi Hội đồng Quản trị Sản phẩm BMad ngày 18/08/2026.*

### PRD liên quan khác

- `prd-facebook-epics-5-6-2026-08-21.md` — PRD canonical cho Epics 5, 5b, 6 (FR23–FR54).
- `FUTURE-WORK.md` — deferred scope: FR-62, FR49–FR51, Phase 3 backlog.

---

## 8. Phụ Lục — Canonicalization & FR/NFR Master Register

Để giải quyết xung đột tài liệu PRD và đánh số FR/NFR giữa các phiên bản, xem `prd-canonicalization-addendum-2026-08-21.md`.

### Tài liệu canonical liên quan

- `CANONICAL-DOCS.md` — registry các tài liệu canonical/deprecated.
- `prd-canonicalization-addendum-2026-08-21.md` — master register FR/NFR với prefix phạm vi (`FB-`, `E7-`, `U-`).
- `epics.md` — epic breakdown bao gồm Epic 35 (Reddit/Medium/Instagram Scraper Expansion).

### Quyết định pending

- **FR-62 (GraphQL replay):** hiện tại `epics-full.md` ghi deferred. Cần quyết định implement trong Phase 3 hay loại bỏ khỏi PRD.
- **FR-24..FR-54:** tồn tại trong `epics-full.md` (Epics 5b–6) nhưng không có trong PRD canonical. Cần viết PRD bổ sung hoặc gộp vào đây.

---

## 7. Phụ Lục — Cập Nhật Sau Readiness Assessment (2026-08-19)

### 7.1. Yêu cầu chức năng bổ sung (FR-85 ➔ FR-101)

*Các yêu cầu dưới đây xuất hiện trong kiến trúc và epic nhưng chưa được gán số FR cho đến khi re-assessment hoàn tất.*

* **FR-85 (Internal Operator Dashboard & Admin CLI):** Cung cấp giao diện vận hành nội bộ (web dashboard + CLI `xactions admin`) để giám sát jobs/checkpoints, proxy pool, account hibernation, stream metrics và alerts. Auth dùng internal admin API key hoặc A2A token, không phải multi-tenant SaaS auth.
* **FR-86 (Metadata Schema Contract for Consumers):** Mỗi platform/category phải publish JSON Schema hoặc TypeScript type cho `Post.metadata`; consumer có thể lấy schema qua API `GET /schemas/:platform/:category`, MCP tool `x_schema_get`, và CLI `xactions schema get`. `PrismaStore` validate `metadata` against schema khi ghi.
* **FR-87 (Data Retention Policy):** Dữ liệu raw crawl (bản gốc thu thập) lưu trong XActions với TTL 30 ngày; dữ liệu lead/processed output đẩy sang Nowing được giữ vĩnh viễn. Lịch sử checkpoints và audit logs giữ 90 ngày.
* **FR-88 (3-Tier Incremental Gap-Filling):** Cào theo mô hình 3 tầng: (1) full seed, (2) delta/gap fill theo `publishedAt`/`lastCrawledAt`, (3) on-demand refresh; loại bỏ 100% duplication và tiết kiệm 90% chi phí proxy so với full re-crawl.
* **FR-89 (Bluesky AT Protocol Scraper):** Cào profile, followers, following, user feed, search, và custom feeds trên Bluesky qua public AT Protocol API (`https://public.api.bsky.app`) với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ optional auth cho non-public data.
* **FR-90 (Mastodon REST API Scraper):** Cào profile, followers, following, timeline, search, hashtag, và trending trên bất kỳ Mastodon instance nào qua public REST API với `AbstractCrawler` + `AbstractApiClient`; hỗ trợ optional `accessToken` cho authenticated endpoints.
* **FR-91 (Utility Scripts & Adapters Consolidation):** Audit và quyết định deprecation cho `src/scrapers/*.js` độc lập và `src/scrapers/adapters/`; convert tính năng hữu ích thành `CrawlerCommand` action hoặc archive; thu gọn adapter layer.
* **FR-92 (Unified Dispatcher & Backward Compatibility):** `src/scrapers/index.js` trở thành thin dispatcher duy nhất qua `scrape(platform, action, args)`; tất cả caller gọi `CrawlerCommand`; giữ `package.json` exports backward-compatible.
* **FR-93 (Legacy Decommission):** Xóa legacy modules sau khi đạt shadow-run parity ≥ 99% trong 7 ngày.
* **FR-102 (Unified Person OSINT Data Harvesting):** Cung cấp MCP tool `x_social_find_profiles` cho phép fan-out truy vấn hồ sơ đồng thời trên Twitter, Facebook, Threads, LinkedIn, Bluesky, Mastodon, TikTok, Zalo OA, Masothue, Chợ Tốt, TopCV. Tuân thủ Option D: XActions chỉ đóng vai trò Data Harvesting, trả về raw `ProfileItem[]`, không lưu trữ Golden Record PII, không tạo bảng thực thể người trong DB.
* **FR-103 (Crawler Lifecycle Stream Unification & CloudEvents v1.0):** Hợp nhất toàn bộ luồng phát sự kiện vào Template Method của `AbstractCrawler.execute()`. Xóa bỏ 100% cờ tạm `__streamEmitted` và các lệnh publish trực tiếp trong crawler con; đảm bảo 100% event đẩy vào Redis Stream tuân thủ chuẩn CloudEvents v1.0 với `idempotencyKey` chống duplicate.
* **FR-104 (Platform-Static Zero-Browser HTTP Routing):** Định tuyến tĩnh Tier 0 (HTTP-First / got-jsdom) cho các domain tĩnh/SSR nhẹ (Masothue, Batdongsan, tin tức, RSS); cắt giảm 85% RAM và tăng tốc độ xử lý so với Headless Browser.
* **FR-105 (Cost-Aware Proxy Escalation & Budget Ceiling):** [Rescoped — ~40% đã có sẵn] Bổ sung `tier` metadata (4 levels: `free`/`datacenter`/`residential`/`mobile_4g`) vào `ProxyIpPool`. `ProxyBudgetGovernor` enforces `PROXY_DAILY_BUDGET_USD` ceiling via `DistributedTokenBucket`. Cost-aware escalation: default `datacenter` → `residential` on 403/Captcha challenge. `BUDGET_CEILING_REACHED` soft degradation trả degraded result thay vì throw `PROXY_EXHAUSTED`.
* **FR-106 (GitOps Selector Healing Assistant):** [Rescoped — ~70% đã có sẵn] CLI tool `xactions canary heal` orchestrates: `SelectorCanary` drift status → `AutoSelectorFallback.investigate()` → `SelectorSandbox` validation → `unified-diff` generation → GitHub Draft PR. Không auto-heal, không runtime injection — tuân thủ Invariant #4 (GitOps-Driven DOM Drift Healing).
* **FR-107 (OSINT Developer & Identity Registries):** Mở rộng platform matrix của `x_social_find_profiles` với 2 nguồn public API zero-auth: **GitHub** (`https://api.github.com/users/{username}` — trả về name, bio, avatar, company, location, public repos; hỗ trợ `username` queryType) và **Gravatar** (`https://api.gravatar.com/v3/profiles/{sha256(email)}` — resolve email → avatar + linked accounts; hỗ trợ queryType `email`). Direct fetch, không cần proxy, không cần crawler mới — chỉ adapter + đăng ký trong `PROFILE_ACTION_MAP`. Rate limit GitHub unauthenticated (60 req/h) quản lý qua `DistributedTokenBucket`; optional `GITHUB_TOKEN` env var nâng lên 5000 req/h. (Epic 41.1)
* **FR-108 (OSINT Entity Resolution & Confidence Clustering):** Cung cấp `EntityResolver` module (pure JS, port thuật toán Jaro-Winkler từ Mr.Holmes `entity_resolver.py` — không port code Python) gộp kết quả fan-out của `x_social_find_profiles` thành `identityClusters[]` với confidence score (0.0–1.0). Scoring: exact username match (+40), display-name similarity > 0.85 (+30), avatar URL/pHash match (+30), cross-link trong bio (+20). Output contract: `identityClusters[]` bổ sung bên cạnh `profiles[]` phẳng (backward compat — profiles[] giữ nguyên). Không persist PII (Option D), tính toán in-memory per-request. (Epic 41.2)
* **FR-109 (Avatar Perceptual Hashing for Entity Resolution):** `EntityResolver` dùng pHash (dHash/aHash + Hamming distance) để so khớp avatar cross-platform khi CDN URL khác nhau. Pure JS module `src/osint/phash.js`, async scoring, không persist PII (Option D). (Story 41.3)
* **FR-110 (Instagram Session Stability Verification):** Nghiệm thu `InstagramClient` duy trì session ≥10 requests liên tiếp không challenge/checkpoint dưới stable residential proxy — đóng action item `epic-35-retro-item-4`. (Story 35.5)
* **FR-111 (Marketplace Advanced Filters — Sort & Condition):** Bổ sung `sortBy` (`relevance|price_asc|price_desc|date_listed`) và `condition` (`new|used`) vào `marketplace()` action; expose đầy đủ `radiusKm/latitude/longitude/categoryId/sortBy/condition` qua MCP `x_facebook_marketplace` inputSchema và CLI flags. (Story 13.11)
* **FR-112 (GraphQL Replay Engine — conditional):** Capture `doc_id` + `fb_dtsg`/`lsd`/`__dyn`/`__csr` từ Puppeteer request, replay bằng HTTP client với replay cache (`redis`/`sqlite`) và DOM/hydration fallback khi doc_id rotate. (Story 13.12 — gated, xem FUTURE-WORK.md activation conditions)
* **FR-113 (Advanced Canvas/WebGL/Audio Fingerprint Spoofing — conditional):** Inject noise động vào `HTMLCanvasElement.toDataURL`/`getImageData`, WebGL buffer readback, `AudioContext`/`AnalyserNode` cho bot-challenge targets. (Story 27.5 — gated)
* **FR-114 (Zalo Personal Messaging — conditional, research-gated):** Cào Zalo cá nhân (tin nhắn, nhóm, friend list) qua reverse-engineered private API sau research spike 2 tuần. (Story 33.3 — gated)
* **FR-115 (YouTube VN Advanced Data — conditional):** Live stream chat, Shorts deep analytics, channel subscriber history qua InnerTube/extended API. (Story 33.4 — gated)
* **FR-116 (OpenAPI 3.1 Spec Generation & Publication):** Hệ thống phải generate OpenAPI 3.1 document từ Zod schemas (single source of truth), serve qua `GET /openapi.json` (CORS `*`) và Swagger UI self-hosted tại `/api-docs`; spec bảo toàn x402 extensions (`x-payment-info`, `x-bazaar`, `x-x402`) và `/.well-known/x402`. (Epic 46 — Stories 46.1, 46.2)
* **FR-117 (Uniform Request Validation):** Mọi route thuộc Route Inventory (epics.md Phụ lục A) phải validate `body`, `query`, `path params` và declared headers qua Zod schema, theo pipeline `authenticate → validate → handler`, trả `400` theo error envelope chuẩn. (Epic 46 — Story 46.2)
* **FR-118 (Uniform Response Envelope):** Mọi JSON endpoint trong scope trả `{ success: true, data: T }` / `{ success: false, error: { code, message, type?, details? } }` + `PaginatedResponse<T>`; domain errors (PlatformError/AD-14) map verbatim qua `error.details`. (Epic 46 — Story 46.2)
* **FR-119 (Generated TypeScript API Client):** Script `npm run generate:api-client` sinh `@xactions/api-client` tại `packages/api-client/` từ committed `api/openapi.json` — types qua `openapi-typescript` + thin fetch wrapper với typed error union. (Epic 46 — Story 46.3)
* **FR-120 (Next.js App Shell & Universal Layout):** Ứng dụng web Next.js 15 (App Router, TypeScript, Tailwind, Shadcn/UI, Lucide) với collapsible sidebar, Dark/Light mode, backend connection badge. (Epic 47 — Story 47.1)
* **FR-121 (Viral DNA Miner Dashboard):** Màn hình `/viral-miner` với realtime progress cards và Recharts visualization cho hook-type distribution/patterns. (Epic 47 — Story 47.2)
* **FR-122 (Follower CRM Screen):** Màn hình `/crm` với TanStack Table, lead score, segment filters, tag management. (Epic 47 — Story 47.3)
* **FR-123 (AI Content Optimizer Playground):** Màn hình `/optimizer` với predict score, AI rewrite side-by-side, hashtag generation. (Epic 47 — Story 47.4)
* **FR-124 (Universal Data Explorer & Export):** Màn hình `/explorer` tra cứu đa ngành (jobs/BĐS/MST/social) với bảng preview và CSV export UTF-8. (Epic 47 — Story 47.5)
* **FR-125 (Legacy HTML Consolidation):** Gom toàn bộ file HTML rời rạc của dashboard cũ vào SPA Next.js — không còn trang app standalone sót lại. (Epic 47 — epic goal) *(Cập nhật 2026-09-24: Epic 47 mới deliver 6 routes; ~28 màn app còn lại hoàn tất trong Epic 48 — Stories 48.3–48.10. ~20 file marketing/static được loại khỏi scope theo AD-6.)*
* **FR-126 (Type-Safe API Consumption):** Web app gọi backend qua typed client/`lib/api.ts` typed helper — không raw `fetch` với origin hardcode; mọi call compile-time type-checked. (Epic 47 — cross-cutting; remediated Epic 48 — Story 48.1) *(Cập nhật 2026-09-24: Epic 47 ship screens dùng `fetch('http://localhost:3001/...')` thô, `@xactions/api-client` chưa được import — Story 48.1 remediates bằng BFF + typed helper.)*
* **FR-127 (Web API Foundation — BFF & Session Transport):** `apps/web` phải có BFF same-origin proxy (`/api/*`, `/api-docs/*`) forward verbatim tới `API_INTERNAL_URL` (method/query/body/streaming, header allowlist, cookie→auth injection); `/session` route quản lý httpOnly cookies `xa_bearer`/`xa_session` (`SameSite=Lax`, `Secure` prod) với login exchange; `lib/api.ts` typed helper (`import type` từ `@xactions/api-client`). (Epic 48 — Story 48.1)
* **FR-128 (Auth & Session UI):** Màn `/login` port từ `dashboard/login.html`, drive `POST /session`; trạng thái phiên visible ở header; 401 hiển thị rõ, không dev-fallback che. (Epic 48 — Story 48.2)
* **FR-129 (Ops & Realtime Screens):** `/monitor`, `/status`, `/run`, `/benchmark` với `lib/realtime.ts` socket.io-client direct-connect; socket auth quyết định theo AD-3 ghi addendum. (Epic 48 — Story 48.3)
* **FR-130 (Admin Console & Fleet Manager):** `/admin` full parity (checkpoint pause/resume/retry + admin panels); `/accounts`, `/proxies`, `/sessions` — fleet management UI hấp thụ FUTURE-WORK deferred item. (Epic 48 — Stories 48.4, 48.5)
* **FR-131 (Intelligence Screens):** `/osint` (profile lookup + identity clusters), `/graph`, `/analytics`, `/analytics-dashboard`, `/price-correlation`. (Epic 48 — Story 48.6)
* **FR-132 (Automation Screens):** `/workflows` builder, `/automations`, `/scheduler`, `/calendar`, `/a2a` (SSE qua BFF), `/jev-test`. (Epic 48 — Story 48.7)
* **FR-133 (Content & Media Screens):** `/thread`, `/thread-composer`, `/tweet-schedule`, `/video` (binary streaming qua BFF), `/ai`, `/ai-api`, `/playground` (x402 payment modal port giữ semantics). (Epic 48 — Story 48.8)
* **FR-134 (Account & Misc Screens):** `/facebook`, `/unfollowers`, `/mcp`, `/extension`, `/platform`, `/agent`, `/security`. (Epic 48 — Story 48.9)
* **FR-135 (Legacy Decommission Gate):** Sau parity verify: xóa app-screen HTML/JS trong `dashboard/`, cập nhật static mounts `api/server.js`; marketing/static pages giữ lại theo AD-6. (Epic 48 — Story 48.10)
* **FR-136 (Hardening Quick Wins):** Plugin routes mount trước 404 handler; CORS preflight allowlist đúng cho worker; `pnpm-lock.yaml` regen sạch; session credentials tách khỏi `miningJobs` map. (Epic 49 — Story 49.1)
* **FR-137 (Comment Tree Concurrency):** Fix race condition `CommentTreeExtractor` (P1, deferred 2 chu kỳ) — concurrent extractions không corrupt state. (Epic 49 — Story 49.2)
* **FR-138 (Distributed Consumer Quota):** Quota enforcement đúng multi-worker qua Redis-backed store (`REDIS_URL`), single-worker in-memory không đổi. (Epic 49 — Story 49.3)
* **FR-139 (Webhook Delivery Isolation):** Webhook delivery qua queue worker với per-endpoint isolation + retry/backoff — xóa head-of-line blocking. (Epic 49 — Story 49.4)
* **FR-140 (Checkpoint Concurrency Safety):** Optimistic locking (version check, 409 conflict) trên checkpoint mutations. (Epic 49 — Story 49.5)

### 7.2. Yêu cầu phi chức năng bổ sung (NFR-17 ➔ NFR-26)

* **NFR-17 (Operational Observability):** Hệ thống phải expose real-time metrics qua `GET /governor/status`, `GET /metrics/stream`, dashboard SSE/polling mỗi 5–30s, và alert khi `pendingMessages > 50,000` hoặc `lastAckTime > 60s`.
* **NFR-18 (Universal Architecture Compliance):** 100% nền tảng và crawler trong XActions phải kế thừa `AbstractCrawler` và `AbstractApiClient`, được gọi thống nhất qua `CrawlerCommand`. Không còn module scraper nào sử dụng API surface riêng hoặc nằm ngoài `src/scrapers/social/<platform>/` sau khi Epic 26 hoàn thành.
* **NFR-19 (Vietnam Geo-Consistent Proxy & Locale):** Tất cả request đến VN platforms (Zalo, VN e-commerce, VN government sites) phải sử dụng VN residential proxy hoặc VN-located server IP; timezone `Asia/Ho_Chi_Minh` và locale `vi-VN` phải consistent với proxy region. Áp dụng từ Epic 21 trở đi.
* **NFR-20 (Zero Mocks & Fast Test Execution):** Cấm mock/stub cho network calls trong integration tests; kiểm thử HTTP-first/TLS handshake qua Local Ephemeral Server (`127.0.0.1:0`). Bắt buộc hỗ trợ `XACTIONS_TEST_FAST_DELAYS=1` đưa độ trễ về 0ms; unit test không được vượt quá 1.5 giây.
* **NFR-21 (Option D Privacy & PII Protection):** XActions không duy trì bất kỳ cơ chế lưu trữ lâu dài thông tin định danh cá nhân tổng hợp (Golden Record). Dữ liệu hồ sơ chỉ luân chuyển tạm thời qua response/stream phục vụ consumer.
* **NFR-22 (Contract Honesty — Spec↔Runtime Parity):** OpenAPI spec luôn khớp runtime: `operationId` duy nhất mọi operation, CI spec lint (`@redocly/cli`) + contract test ≥1 endpoint mỗi route group + regenerate-diff check — fail khi drift. (Epic 46)
* **NFR-23 (Contract Non-Breaking):** Chuẩn hóa API không phá vỡ consumer hiện hữu: x402 extensions/discovery contract, `x-session-cookie` transport (legacy body field được normalize, không remove), domain error fields (AD-14) và operator surfaces (`/api/governor`, `/api/checkpoints`, `/metrics/stream`) giữ nguyên semantics. (Epic 46)
* **NFR-24 (Web Performance):** Ứng dụng web Next.js tải trang < 1.0 giây trên kết nối local/dev. (Epic 47)
* **NFR-25 (Design System Consistency):** Mọi màn hình dùng chung Tailwind + Lucide tokens, hỗ trợ Dark/Light mode nhất quán — không tự ý dùng component ngoài design system. (Epic 47) *(Cập nhật 2026-09-24: Shadcn/UI chưa bao giờ được cài — `apps/web` thực tế hand-rolled `tailwind-merge`+`clsx`+`lucide-react`; Epic 48 AD-4 chốt hand-rolled, spec Epic 47 đã ghi sai.)*
* **NFR-26 (UX Feedback & Connectivity Visibility):** Long-running jobs hiển thị realtime progress (không silent stall); trạng thái kết nối backend luôn visible qua header badge. (Epic 47)
* **NFR-27 (Web Credential Transport Security):** Credentials (JWT, X session cookie) vận chuyển qua httpOnly `SameSite=Lax` cookies do BFF quản lý — không trong `localStorage` (pattern legacy `authToken`), không trong response body; `GET /session` chỉ trả boolean flags. (Epic 48 — AD-2)
* **NFR-28 (Realtime Transport Convention):** socket.io-client direct-connect `NEXT_PUBLIC_SOCKET_URL` (không qua BFF); SSE đi qua BFF verbatim-streaming; mỗi màn realtime dùng `lib/realtime.ts` — không tự chọn transport. (Epic 48 — AD-3)

### 7.3. Lộ trình phân kỳ cập nhật

Cập nhật pha triển khai để bao gồm Epic 19–20 và không còn forward dependency:

* **Phase 1: Foundation & Resilient Infrastructure (Stories 10.1 ➔ 10.5, 11.1 ➔ 11.7, 12.1 ➔ 12.2)**
* **Phase 2: Hybrid Signer, Social Flagships & Event Stream (Stories 13.1 ➔ 13.3, 14.1 ➔ 14.3)**
* **Phase 3: Viral Social & E-Commerce Expansion (Stories 15.1 ➔ 15.2, 16.1 ➔ 16.2)**
* **Phase 4: High-Value Localized Leads & B2B Recruitment (Stories 17.1 ➔ 17.2, 18.1 ➔ 18.3)**
* **Phase 5: Operational Observability & Nowing Cutover (Stories 19.1 ➔ 19.10, 20.1)**
* **Phase A — Vietnam Core (inserted before Phase 6):** Epic 21 (B2B registry + automotive), Epic 22 (F&B + healthcare + legal), Epic 33 (Zalo + YouTube VN). Reactivated from backlog + net-new per VN market pivot 2026-09-05.
* **Phase 6: Universalization & Legacy Decommission (Stories 23.1 ➔ 26.2)**
* **Phase 7: Stream Unification & Frugal Scaling (Epics 36, 37, 38, 39, 40):** Hợp nhất lifecycle phát sự kiện (Epic 38), cung cấp OSINT Harvester tool (Epic 36), tối ưu hoá tài nguyên và chi phí proxy (Epic 37/40), hỗ trợ GitOps selector assistant (Epic 39).
* **Phase 8: OSINT Enhancement (Epic 41):** Mở rộng platform matrix với Developer/Identity Registries (GitHub, Gravatar) và Entity Resolution clustering — nâng cấp `x_social_find_profiles` từ danh sách phẳng sang hồ sơ hợp nhất có confidence score.

### 7.4. Traceability ngắn gọn

| Epic | FR chính |
|---|---|
| Epic 19 | FR-85 |
| Epic 20 | FR-84 |
| Epic 23 | FR-89 |
| Epic 24 | FR-91 |
| Epic 25 | FR-92 |
| Epic 26 | FR-93 |
| Epic 21.1 | FR-94 |
| Epic 21.3 | FR-94 |
| Epic 22 | FR-96 |
| Epic 33 | FR-97 |
| Story 10.5 | FR-86 |
| Data Retention | FR-87 |
| 3-Tier Gap-Filling | FR-88 |
| Stream Metrics / Alerts | NFR-17 |
| Universal Architecture Compliance | NFR-18 |
| VN Geo-Proxy & Locale | NFR-19 |
| Reddit Scraper | FR-98 → Epic 35 |
| Medium Scraper | FR-99 → Epic 35 |
| Instagram Scraper | FR-100 → Epic 35 |
| Epic 35 | FR-98, FR-99, FR-100, FR-101 |
| SocialAccount Storage | FR-101 → Epic 35.4 |
| Epic 36 (OSINT Harvesting) | FR-102, NFR-21 |
| Epic 38 (Stream Lifecycle) | FR-103 |
| Epic 37 (Zero-Browser HTTP) | FR-104, NFR-20 |
| Epic 40 (Cost-Aware Proxy — Rescoped) | FR-105 |
| Epic 39 (GitOps Selector Healing — Rescoped) | FR-106 |
| Epic 41 (OSINT Registries & Entity Resolution) | FR-107, FR-108 |
| Story 41.3 (Avatar pHash — Epic 41) | FR-109 |
| Story 35.5 (IG Session Verify — Epic 35) | FR-110 |
| Story 13.11 (Marketplace Filters — Epic 13) | FR-111 |
| Epic 46 (API Contract & OpenAPI) | FR-116, FR-117, FR-118, FR-119, NFR-22, NFR-23 |
| Epic 47 (Next.js Web App) | FR-120, FR-121, FR-122, FR-123, FR-124, FR-125 (partial → Epic 48), FR-126 (remediated Epic 48), NFR-24, NFR-25, NFR-26 |
| Epic 48 (Web Foundation & Consolidation) | FR-125 (completion), FR-126 (remediation), FR-127, FR-128, FR-129, FR-130, FR-131, FR-132, FR-133, FR-134, FR-135, NFR-27, NFR-28 |
| Epic 49 (Platform Hardening) | FR-136, FR-137, FR-138, FR-139, FR-140 |
| Story 13.12 (GraphQL Replay — Epic 13, gated) | FR-112 |
| Story 27.5 (Fingerprint Spoofing — Epic 27, gated) | FR-113 |
| Story 33.3 (Zalo Personal — Epic 33, gated) | FR-114 |
| Story 33.4 (YouTube VN Advanced — Epic 33, gated) | FR-115 |

### 7.5. Canonicalization & Related Documents

- **Canonical PRD:** Tài liệu này (`prd.md`) là canonical cho Epics 10–20 và Phase 4 extension 23–26.
- **Canonical UX Register:** `ux/README.md` là canonical pointer cho tất cả UX documents (DESIGN.md, EXPERIENCE.md, EXPERIENCE-UNIVERSAL-2026-08-21.md) dùng trong Epic 19 (Internal Operator Dashboard & Admin CLI).
- **PRD liên quan khác:**
  - `prd-facebook-epics-5-6-2026-08-21.md` — PRD canonical cho Epics 5, 5b, 6 (FR-23–FR-54).
  - `FUTURE-WORK.md` — deferred scope: FR-62, advanced Marketplace filters, canvas/WebGL spoofing.
- **Canonicalization addendum:** `_bmad-output/planning-artifacts/prd-canonicalization-addendum-2026-08-21.md` — master register FR/NFR với prefix phạm vi.
- **Open decisions:**
  - **FR-62 (GraphQL replay):** hiện tại deferred, xem `FUTURE-WORK.md`.
  - **FR-24..FR-54:** đã được bổ sung trong `prd-facebook-epics-5-6-2026-08-21.md`.
