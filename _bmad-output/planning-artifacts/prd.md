---
title: "PRD: Epics 10–18 — XActions Universal Hybrid Scraping & Intelligence Microservice Platform"
created: 2026-08-18
updated: 2026-08-18
status: approved
author: "John (BMad Product Manager) & Winston (BMad System Architect)"
epics: [10, 11, 12, 13, 14, 15, 16, 17, 18]
prd_ref:
  - prd-XActions-2026-06-08
  - prd-XActions-2026-06-10-epic4
  - prd-XActions-2026-08-14-epic7
---

# PRD: Epics 10–18 — XActions Universal Hybrid Scraping & Intelligence Microservice Platform

*Chuyển đổi toàn diện XActions thành Nền tảng Động cơ Cào Dữ liệu Toàn Năng (Universal Scraping Microservice) đa ngành: Mạng Xã Hội (X, Facebook, Threads, TikTok, Instagram), Thương Mại Điện Tử (Shopee, TikTok Shop), Bất Động Sản (Chợ Tốt bóc tách SĐT, Batdongsan.com.vn), và Tuyển Dụng (TopCV, VietnamWorks, LinkedIn).*

---

## 0. Mục Đích & Bối Cảnh Tài Liệu

Tài liệu PRD này là bước nhảy vọt chiến lược tiếp nối từ `prd-XActions-2026-08-14-epic7` (Epics 1–9). PRD này chính thức định nghĩa kiến trúc và yêu cầu sản phẩm cho **Epics 10 đến 18**:
1. **Chuyển dịch sang mô hình Microservice Engine:** XActions trở thành Động cơ Cào dữ liệu chuyên trách (Dedicated Scraping Microservice) cho hệ sinh thái **Nowing (AI Lead & Research Hub)** và nền tảng SaaS / CLI / AI MCP độc lập.
2. **Áp dụng Đột Phá Kỹ Thuật "Tiered Hybrid Browser-Signer Engine":** Kết hợp Pre-Signed Token Ring Buffer O(1) và Signer Worker Page Pool giải mã chữ ký JS (`a_bogus`, `x-client-transaction-id`), chuyển 100% việc fetch dữ liệu sang Async HTTP Client (`got-scraping`/`undici`), giúp giảm **85% RAM**, tăng tốc độ **5–10x**, và tiết kiệm 90% tài nguyên server.
3. **Hợp Nhất Cơ Sở Dữ Liệu trên PostgreSQL (Prisma ORM):** Loại bỏ hoàn toàn sự phân mảnh của SQLite, quy chuẩn hóa dữ liệu đa ngành vào PostgreSQL với quy ước Namespaced ID `${platform}:${externalId}` và cột `metadata Json?` có GIN Index.
4. **Cơ Chế Khai Thác Dữ Liệu 3 Tầng (3-Tier Incremental Gap-Filling):** Chỉ cào bù khoảng trống dữ liệu mới (Delta Gap), triệt tiêu 100% việc cào trùng lặp và tiết kiệm 90% chi phí proxy.
5. **Kế Hoạch Bàn Giao & Dọn Dẹp (Nowing Cutover & Decommissioning):** Thay thế toàn bộ 20+ scraper cũ bên Nowing bằng XActions MCP Client, giảm dung lượng Docker image của Nowing từ 4GB xuống còn <500MB.

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

## 3. Danh Mục Yêu Cầu Chức Năng (Functional Requirements FR-64 ➔ FR-84)

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
* **FR-83 (Realtime Thin Event Redis Stream Ingest):** Phát luồng sự kiện tinh gọn (`{ id, platform, externalId, category, authorId, crawledAt, storageRef }`) vào Redis Stream `stream:social:raw_posts` (`MAXLEN ~ 20000`).
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

---

## 4. Danh Mục Yêu Cầu Phi Chức Năng (Non-Functional Requirements NFR-11 ➔ NFR-16)

* **NFR-11 (Tối ưu Tài Nguyên):** Giảm ít nhất **85% RAM** (từ ~10GB xuống <300MB) và **70% CPU** so với mô hình Full Headless Browser.
* **NFR-12 (Băng Thông & Tốc Độ):** Tăng tốc độ thu thập dữ liệu lên ít nhất **5x–10x (>500 requests/giây)** bằng Async HTTP Client với Connection Pool.
* **NFR-13 (Tự Phục Hồi & Chống Chặn):** Tự động phát hiện proxy chết/rate-limit, cách ly 5 phút và replay request 3 lần với exponential backoff.
* **NFR-14 (Bảo Mật Phi Mật Khẩu):** Không lưu trữ plain-text password; đăng nhập an toàn qua Terminal ASCII QR Code và Chrome CDP Attach.
* **NFR-15 (Kiến Trúc Sạch & Khả Năng Mở Rộng):** Lớp `src/core/` hoàn toàn phi phụ thuộc (Zero-Dependency); thêm nền tảng mới chỉ cần viết thêm Adapter.
* **NFR-16 (Bản Quyền & Tương Thích Ngược):** Mã nguồn 100% tuân thủ MIT / Apache 2.0; bảo toàn 100% tương thích ngược với CLI `unfollowx` và 80+ MCP tools.

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

---

*Tài liệu PRD chính thức được phê duyệt bởi Hội đồng Quản trị Sản phẩm BMad ngày 18/08/2026.*
