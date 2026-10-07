---
id: SPEC-fe-platform-suites
companions:
  - ux-review.md
sources:
  - ../../docs/canonical-action-matrix.md
  - ../planning-artifacts/prd.md
---

# Medirus Frontend Platform Suites — UX & Feature Specification

## Why

Medirus đã hoàn thiện lớp nền tảng Backend vững chắc với 28 platforms và 242 actions được chuẩn hóa qua `UniversalActionDispatcher` và `Public Scrape Gateway` (Epic 50). Tuy nhiên, trên Frontend (`apps/web` Next.js 15), ngoài `/pumpfun` và `/facebook`, đại đa số các tính năng dữ liệu cao cấp vẫn chỉ được hiển thị ở dạng catalog thô tại `/actions` hoặc dữ liệu mẫu tĩnh (mock static) tại `/explorer`. 

Người dùng (growth hacker, nhà nghiên cứu dữ liệu, trader crypto, chuyên viên tuyển dụng B2B) hiện phải tự tạo script hoặc gọi raw API qua `/gateway` thay vì có một giao diện trực quan, giàu tính tương tác và chuẩn mực về trải nghiệm người dùng (UX). 

Spec này quy định chi tiết 5 bộ giao diện người dùng (Platform Suites) mới trên `apps/web`, biến năng lực cào dữ liệu thô thành các công cụ tác nghiệp thời gian thực.

---

## Capabilities

- **CAP-1 — DEX & Token Liquidity Intelligence Suite (`/dexscreener`)**
  - **intent:** Cung cấp cho Web3 trader giao diện tìm kiếm và phân tích cặp thanh khoản DEX (Solana, Base, Ethereum) trực quan, có liên kết mượt mà với Pump.fun.
  - **ux-flow:**
    - Thanh tìm kiếm Token / Pair address tự động phát hiện định dạng ví/contract.
    - Bộ lọc Chain (Solana, Base, ETH, BSC) + Sắp xếp theo 24h Volume, Liquidity, Price Change.
    - Card chi tiết cặp giao dịch: Biểu đồ biến động giá đơn giản, volume 24h, buy/sell txns, thanh khoản, FDV.
    - Quick Action: "View on Pump.fun" (nếu là Solana token ra đời từ bonding curve) và "Copy Pair Contract".
  - **success:** Nhập mã token (ví dụ: `SOL` hoặc mint address), hệ thống gọi `dexscreener:search_pairs` qua gateway sync-mode (<1.5s) và hiển thị lưới card kết quả với trạng thái live badge.

- **CAP-2 — YouTube Video & Channel Insights Suite (`/youtube`)**
  - **intent:** Giúp Content Creator và Marketer nghiên cứu thị trường video, phân tích xu hướng YouTube Việt Nam và đọc bình luận có ngữ cảnh.
  - **ux-flow:**
    - Tab 1: **Trending VN Feed** — Lưới video thịnh hành hiển thị thumbnail chất lượng cao, thời lượng, số view và ngày đăng, lấy dữ liệu từ `youtube:trending_vn`.
    - Tab 2: **Channel Inspector** — Nhập handle kênh (ví dụ: `@F8VNOfficial`, `@MixiGaming3004`) → Hiển thị avatar, subscriber count, tổng số video, danh sách video mới nhất (`youtube:channel_videos`).
    - Tab 3: **Comment & Sentiment Reader** — Nhập Video URL/ID → Tải cây bình luận phân cấp (`youtube:video_comments`), hỗ trợ lọc bình luận có lượng like cao nhất.
  - **success:** Nhập link YouTube bất kỳ, trả về thông tin video và danh sách 20 bình luận đầu tiên dưới 1s (sync cache) hoặc kèm skeleton loading trạng thái rõ ràng.

- **CAP-3 — Decentralized Social Deck (`/fediverse`)**
  - **intent:** Trình đọc mạng xã hội phi tập trung đa cột (Bluesky AT Protocol + Mastodon ActivityPub), không cần API token cá nhân của người dùng.
  - **ux-flow:**
    - Bố cục Multi-Column (cột linh hoạt kiểu TweetDeck):
      - Cột 1: Bluesky What's Hot / Trending Feed (`bluesky:feed`, `bluesky:trending`).
      - Cột 2: Bluesky Profile Post Stream (theo dõi 1 handle chỉ định, e.g. `bsky.app`).
      - Cột 3: Mastodon Trending & Public Timeline (`mastodon:trending`).
    - Post Card: Hiển thị avatar, tên người dùng, handle phân tán, nội dung Markdown, hình ảnh đính kèm (Lightbox preview), liên kết gốc.
    - Quick Action: Lưu bài viết, sao chép permalink, lọc bài có chứa media.
  - **success:** Mở trang `/fediverse` là dữ liệu hiển thị ngay lập tức (zero authentication required) với 3 cột độc lập, tự động cuộn vô tận (infinite scroll) dựa trên cursor.

- **CAP-4 — Vietnam B2B Diligence & Procurement Portal (`/enterprise-vn`)**
  - **intent:** Cung cấp công cụ tra cứu mã số thuế, tình trạng pháp lý doanh nghiệp và danh mục nhãn hiệu bản quyền cho phòng pháp chế và kinh doanh B2B.
  - **ux-flow:**
    - Input thông minh: Nhận diện Mã số thuế (10 hoặc 13 số) hoặc Tên công ty (`masothue:search`, `b2b_registry_extended:search_enterprises`).
    - Hồ sơ Doanh nghiệp (Enterprise Dossier):
      - Trạng thái hoạt động (Đang hoạt động: Badge xanh; Ngừng hoạt động: Badge đỏ).
      - Người đại diện pháp luật, địa chỉ đăng ký kinh doanh, ngày thành lập.
      - Tab Nhãn hiệu (`ipvietnam:search`): Liệt kê các nhãn hiệu / đơn đăng ký sở hữu trí tuệ đã nộp.
    - Export Toolbar: Xuất dữ liệu hồ sơ ra file JSON hoặc CSV để nhập vào CRM.
  - **success:** Tìm kiếm MST (ví dụ `0013180180` - VNPT), trả về đầy đủ hồ sơ pháp nhân và danh sách nhãn hiệu liên quan.

- **CAP-5 — Live Vietnam IT & Tech Jobs Aggregator (`/jobs-vn`)**
  - **intent:** Nâng cấp tab Jobs tại `/explorer` từ dữ liệu mẫu thành cổng thông tin việc làm công nghệ thời gian thực, tổng hợp đa nguồn (TopCV, VietnamWorks, LinkedIn).
  - **ux-flow:**
    - Filter Bar dính trên cùng (Sticky Header): Từ khóa (React, Node, AI Engineer), Địa điểm (Hà Nội, TP.HCM, Da Nang, Remote), Nguồn (TopCV, VietnamWorks, LinkedIn).
    - Job Card: Logo công ty, Tiêu đề vị trí, Tên công ty, Mức lương (Badge nổi bật), Địa điểm, Tag công nghệ, Nút "Ứng tuyển ngay" dẫn tới bài đăng gốc.
    - Trạng thái tải: Skeleton loading theo kích thước card thật, hiển thị thông báo lỗi thân thiện nếu nền tảng nguồn bật Cloudflare/Bot-Challenge kèm nút thử lại.
  - **success:** Tìm kiếm "Golang" trả về danh sách việc làm thực tế được crawl trực tiếp, có phân trang rõ ràng và cache 15 phút tại BFF để tối ưu tốc độ.

---

## Constraints

- **C-1 — BFF Proxy Mandatory:** Mọi call từ client-side component phải đi qua Next.js BFF route (`/api/gateway/scrape` hoặc `/api/platform/:platform/scrape`). Không bao giờ gọi trực tiếp cổng `3001` từ trình duyệt của người dùng.
- **C-2 — Graceful Bot-Challenge Handling (XACT_4030):** Khi upstream platform trả về bot challenge (Cloudflare, PerimeterX), giao diện không được hiển thị màn hình trắng (blank screen). Phải hiển thị Empty State component kèm giải thích: *"Nền tảng đang áp dụng xác thực chống bot. Vui lòng thử lại sau vài phút hoặc sử dụng proxy cao cấp."*
- **C-3 — Image Referrer & CORS Protection:** Toàn bộ ảnh từ mạng xã hội hoặc nền tảng bên ngoài phải được gắn `referrerPolicy="no-referrer"` hoặc đi qua proxy `/api/ipfs/[cid]` để tránh vỡ giao diện do hotlink protection.
- **C-4 — Dark Mode & Design Tokens:** Tuân thủ triệt để token của Tailwind CSS và hệ thống theme dark/light hiện hữu của `apps/web` (Slate-900 / Zinc palette, Emerald/Indigo accents).
- **C-5 — Responsive Breakpoints:** Tất cả 5 trang mới phải hiển thị tốt từ màn hình điện thoại (min-width: 375px) đến màn hình desktop lớn (1440px+). Đối với `/fediverse` multi-column, chuyển thành tab trên thiết bị di động.

---

## Non-goals

- **NG-1** — Không xây dựng chức năng đăng tin tuyển dụng hoặc thanh toán ứng tuyển trên Medirus. Medirus đóng vai trò aggregator và reader.
- **NG-2** — Không thực hiện giao dịch token trên sàn DEX (swap/buy/sell). Giao diện chỉ hiển thị biểu đồ và số liệu phân tích, dẫn link ra Dexscreener hoặc Pump.fun.
- **NG-3** — Không lưu trữ vĩnh viễn toàn bộ cơ sở dữ liệu doanh nghiệp Việt Nam vào Postgres local; chỉ lưu cache ngắn hạn (Redis LRU) cho các lượt tìm kiếm phổ biến.
