---
date: 2026-08-21
canonical_prd: _bmad-output/planning-artifacts/prd.md
---

# PRD Canonicalization Addendum — FR/NFR Master Register

Tài liệu này giải quyết xung đột đánh số FR/NFR giữa các phiên bản PRD cũ và cung cấp bảng tra cứu thống nhất. Các ID gốc trong PRD vẫn được giữ nguyên để không phá vỡ epic traceability; addendum này thêm **prefix phạm vi** khi cần phân biệt.

## FR Master Register

| FR ID | Tên / Mô tả ngắn | Nguồn PRD | Epic / Story chính |
|---|---|---|---|
| FR-1 | Facebook adapter module (`createBrowser`, `createPage`, `loginWithCookie`) | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-2 | `loginWithCookie(page, { c_user, xs })` | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-3 | Dispatcher registration `facebook`/`fb` | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-4 | `scrapeProfile` normalized shape | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-5 | `scrapePosts` / `scrapeTweets` post array | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-6 | `scrapeFollowers` | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-7 | `searchTweets` / search posts | `prds/prd-XActions-2026-06-08` | Epic 1 |
| FR-8 | CLI `--platform facebook` | `prds/prd-XActions-2026-06-08` | Epic 3 |
| FR-9 | MCP Facebook tools | `prds/prd-XActions-2026-06-08` | Epic 3 |
| FR-10 | REST API `POST /api/facebook/scrape` | `prds/prd-XActions-2026-06-08` | Epic 3 |
| FR-11 | `Operation` persistence | `prds/prd-XActions-2026-06-08` | Epic 3 |
| FR-12 | `createFacebookPost` dry-run default | `prds/prd-XActions-2026-06-10-epic4` | Epic 2 |
| FR-13 | `likeFacebookPosts` via `runGuardedBatch` | `prds/prd-XActions-2026-06-10-epic4` | Epic 2 |
| FR-14 | `commentOnFacebookPosts` | `prds/prd-XActions-2026-06-10-epic4` | Epic 2 |
| FR-15 | `scheduleFacebookPost` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-16 | `shareFacebookPosts` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-17 | `warmupScrollFeed` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-18 | `joinFacebookGroups` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-19 | `postToFacebookGroups` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-20 | `scrapeGroupMembers` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-21 | `sendFriendRequests` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-22 | `cancelPendingFriendRequests` | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| FR-23 | GraphQL HTTP layer / Messenger CTA | `prds/prd-XActions-2026-06-08` + `epics-full.md` | Epic 5 |
| FR-24–FR-54 | Messenger Share V2, Marketplace, Headless, Chrome path, Anti-Detection, Fingerprint, Behavioral | `epics-full.md` (không có trong PRD) | Epics 5b, 6 |
| FR-55 | Facebook account health check | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-56 | Facebook account pool & parallel runner | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-57 | Facebook multi-type search | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-58 | Facebook post comments | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-59 | Facebook group posts | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-60 | Facebook group comments | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-61 | Hydration JSON extraction | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-62 | GraphQL replay | `prds/prd-XActions-2026-08-14-epic7` | **Deferred** — không có story nào nhận. |
| FR-63 | Unified Facebook scrape service | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| FR-64 | Core domain interfaces | `prd.md` | Epic 10 / Story 10.1 |
| FR-65 | Tiered Hybrid Signer Engine | `prd.md` | Epic 13 / Story 13.1 |
| FR-66 | Proxy Pool & Auto-Quarantine | `prd.md` | Epic 11 / Story 11.3 |
| FR-66A | AI Streaming Dataset Exporter | `prd.md` | Epic 10 / Story 10.3 |
| FR-66B | Adaptive Rate Limiter / Governor | `prd.md` | Epic 11 / Story 11.4 |
| FR-67 | Namespaced PostgreSQL Storage | `prd.md` | Epic 10 / Story 10.2 |
| FR-68 | Terminal ASCII QR Code Login | `prd.md` | Epic 12 / Story 12.1 |
| FR-69 | CDP Remote Attach Mode | `prd.md` | Epic 12 / Story 12.2 |
| FR-70 | Topological Comment Tree | `prd.md` | Epic 14 / Story 14.1 |
| FR-71 | Twitter Crawler Refactor | `prd.md` | Epic 13 / Story 13.2 |
| FR-72 | Facebook Crawler Refactor | `prd.md` | Epic 13 / Story 13.3 |
| FR-73 | MCP Daemon & CLI Integration | `prd.md` | Epic 14 / Story 14.2 |
| FR-73A | AI Streaming Dataset Exporter | `prd.md` | Epic 10 / Story 10.3 |
| FR-73B | Standardized MCP Tool Envelope | `prd.md` | Epic 14 / Story 14.2 |
| FR-74 | Threads Meta GraphQL Scraper | `prd.md` | Epic 15 / Story 15.1 |
| FR-75 | TikTok Video/Hashtag/Comment Scraper | `prd.md` | Epic 15 / Story 15.2 |
| FR-76 | Shopee Product/Price/Review Scraper | `prd.md` | Epic 16 / Story 16.1 |
| FR-77 | TikTok Shop Winning Products | `prd.md` | Epic 16 / Story 16.2 |
| FR-78 | Chợ Tốt Multi-Category + Phone | `prd.md` | Epic 17 / Story 17.1 |
| FR-79 | Batdongsan.com.vn Property | `prd.md` | Epic 17 / Story 17.2 |
| FR-80 | TopCV Recruitment | `prd.md` | Epic 18 / Story 18.1 |
| FR-81 | VietnamWorks Job | `prd.md` | Epic 18 / Story 18.2 |
| FR-82 | LinkedIn B2B Lead/Job | `prd.md` | Epic 18 / Story 18.3 |
| FR-83 | Realtime Thin Event Redis Stream | `prd.md` | Epic 14 / Story 14.3 |
| FR-84 | Nowing Adapter Cutover | `prd.md` | Epic 20 / Story 20.1 |
| FR-85 | Internal Operator Dashboard & Admin CLI | `prd.md` | Epic 19 |
| FR-86 | Metadata Schema Contract | `prd.md` | Epic 10 / Story 10.5 |
| FR-87 | Data Retention Policy | `prd.md` | Epic 10 / Story 10.2, Epic 19 |
| FR-88 | 3-Tier Incremental Gap-Filling | `prd.md` | Epic 10, 11 |

### Ghi chú FR

- **FR-24..FR-54** tồn tại trong `epics-full.md` nhưng không có trong bất kỳ PRD nào. Khuyến nghị: viết PRD bổ sung hoặc gộp vào canonical PRD dưới dạng addendum.
- **FR-62** (GraphQL replay) được PRD Epic 7 liệt kê nhưng epic ghi deferred. Cần quyết định chính thức: implement hoặc loại bỏ.
- **FR-73 / FR-73A / FR-73B** là sự phân tách hợp lý trong `epics.md`; PRD canonical nên cập nhật để phản ánh.
- **FR-66 / FR-66B** tương tự — PRD gộp, epic tách.

## NFR Master Register

Vì NFR numbering xung đột giữa các PRD, addendum này sử dụng **prefix phạm vi** để phân biệt:

| Canonical ID | ID gốc trong nguồn | Mô tả | Nguồn | Epic / Story |
|---|---|---|---|---|
| `FB-NFR-06` | NFR-6 (Epic 4) | Delay floor cho write action (30–90s / 60–180s) | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| `FB-NFR-07` | NFR-7 (Epic 4) | `runGuardedBatch` bắt buộc | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| `FB-NFR-08` | NFR-8 (Epic 4) | Account risk warning không thể tắt | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| `FB-NFR-09` | NFR-9 (Epic 4) | Scheduler throughput cap ≤5 posts/hour/user | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| `FB-NFR-10` | NFR-10 (Epic 4) | Không thu thập PII nhạy cảm | `prds/prd-XActions-2026-06-10-epic4` | Epic 4 |
| `E7-NFR-10` | NFR-10 (Epic 7) | Không lưu trữ kết quả scrape trong XActions | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| `E7-NFR-11` | NFR-11 (Epic 7) | Health check nhanh <2s, không mở browser | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| `E7-NFR-12` | NFR-12 (Epic 7) | Concurrency cap 4–8 | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| `E7-NFR-13` | NFR-13 (Epic 7) | Privacy: cookie/token không log/echo | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| `E7-NFR-14` | NFR-14 (Epic 7) | Resilience: DOM fallback | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| `E7-NFR-15` | NFR-15 (Epic 7) | Read velocity: delay 1–3s, max 50 scrolls | `prds/prd-XActions-2026-08-14-epic7` | Epic 7 |
| `U-NFR-11` | NFR-11 (Universal) | Resource optimization: giảm ≥85% RAM, 70% CPU | `prd.md` | NFR Traceability Matrix |
| `U-NFR-12` | NFR-12 (Universal) | Throughput >500 req/s, RPC <2ms | `prd.md` | NFR Traceability Matrix |
| `U-NFR-13` | NFR-13 (Universal) | Resilience: proxy quarantine 5 phút, retry 3x | `prd.md` | NFR Traceability Matrix |
| `U-NFR-14` | NFR-14 (Universal) | Zero-credential security (QR/CDP) | `prd.md` | NFR Traceability Matrix |
| `U-NFR-15` | NFR-15 (Universal) | Clean architecture / extensibility | `prd.md` | NFR Traceability Matrix |
| `U-NFR-16` | NFR-16 (Universal) | License / backward compatibility | `prd.md` | NFR Traceability Matrix |
| `U-NFR-17` | NFR-17 (Universal) | Operational observability | `prd.md` | Epic 19 / NFR Traceability Matrix |

### Ghi chú NFR

- **NFR-10** bị trùng: `FB-NFR-10` (PII protection) và `E7-NFR-10` (no storage). Sử dụng prefix để phân biệt.
- **NFR-11..15** bị dùng lại ở Epic 7 và Universal PRD với ý nghĩa khác nhau. Addendum này gán prefix `E7-` hoặc `U-`.
- `epics.md` hiện dùng NFR11–NFR17 (không prefix) ánh xạ sang Universal. Khuyến nghị: cập nhật `epics.md` để thêm ghi chú phạm vi hoặc chuyển sang prefix khi trích dẫn từ Epic 7.

## Hành động tiếp theo

1. Cập nhật `prd.md` để thêm addendum này vào phụ lục hoặc liên kết.
2. Cập nhật `epics.md` NFR Traceability Matrix để ghi rõ `U-NFR-11..17`.
3. Cập nhật `epics-full.md` để ghi rõ `FB-NFR-06..10` và `E7-NFR-10..15` nếu cần.
4. Quyết định FR-62 (GraphQL replay): implement hoặc loại bỏ.
5. Quyết định FR-24..54: viết PRD bổ sung hoặc gộp vào canonical PRD.
