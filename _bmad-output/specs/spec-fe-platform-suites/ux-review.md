---
spec_id: SPEC-fe-platform-suites
author: Sally (UX Designer)
review_date: 2026-09-28
---

# UX Design Review & Experience Specification — Platform Suites

## 1. Personas & Empathy Map (Alan Cooper Discipline)

### Persona 1: Alex — The Fast-Paced Crypto Trader (30s Degen)
- **Role:** Solana Meme & DeFi Trader, Web3 Researcher.
- **Pain Point:** Mở 5 tab cùng lúc (Pump.fun, Dexscreener, Solscan, Birdeye, Twitter). Khi phát hiện token trên Pump.fun sắp tốt nghiệp bonding curve, phải copy contract thủ công sang Dexscreener để tìm liquidity pool Raydium, mất 15-30 giây quý giá.
- **Needs:** Một bảng điều khiển duy nhất liên kết 2 chiều giữa Pump.fun và Dexscreener, tìm kiếm tức thì theo CA (Contract Address), hiển thị rõ Liquidity, Volume 24h và Price Change.
- **Key Moment of Delight:** Nhập contract address trên `/dexscreener`, thấy ngay link "Graduated from Pump.fun! View original livestream & dev comments" kèm thanh khoản Raydium.

### Persona 2: Linh — The Social Content Strategist
- **Role:** Digital Marketing Lead cho Agency truyền thông tại TP.HCM.
- **Pain Point:** YouTube không cho xem nhanh top video trending Việt Nam theo category mà không bị cá nhân hóa bởi thuật toán tài khoản. Khi nghiên cứu đối thủ, phải lướt thủ công qua hàng trăm comment để nắm bắt dư luận.
- **Needs:** Trình đọc YouTube độc lập với tài khoản cá nhân, xem xu hướng trending VN thuần túy, bóc tách comment theo lượng upvote/reply và xuất dữ liệu nhanh.
- **Key Moment of Delight:** Mở `/youtube`, thấy ngay Top 20 Trending VN không bị nhiễm lịch sử xem cá nhân, click vào video là thấy ngay danh sách bình luận nổi bật nhất kèm tag thời gian.

### Persona 3: Khoa — The Open Web & Privacy Enthusiast
- **Role:** Senior Software Engineer, Open Source Contributor.
- **Pain Point:** Muốn theo dõi tin tức công nghệ từ cả Bluesky và Mastodon nhưng không muốn cài đặt nhiều app nặng nề hoặc đăng nhập tài khoản trên máy làm việc.
- **Needs:** Một màn hình đơn giản, sạch sẽ, chia 2-3 cột linh hoạt như TweetDeck, tải dữ liệu trực tiếp từ các public relay / instance mà không đòi hỏi password hay cookie.
- **Key Moment of Delight:** Mở `/fediverse` là thấy ngay dòng chảy thông tin cập nhật liên tục từ cả hai mạng xã hội phi tập trung lớn nhất hiện nay.

### Persona 4: Hoàng — The Corporate BD & Enterprise Recruiter
- **Role:** Trưởng phòng Phát triển Kinh doanh B2B & Tuyển dụng IT.
- **Pain Point:** Cần tra cứu nhanh pháp nhân công ty đối tác trước khi ký hợp đồng, đồng thời muốn khảo sát mức lương và nhu cầu tuyển dụng các vị trí kỹ sư phần mềm trên thị trường để xây dựng dải lương cạnh tranh.
- **Needs:** Cổng tra cứu pháp nhân doanh nghiệp kèm nhãn hiệu bản quyền, và bảng tổng hợp tin tuyển dụng IT đa nguồn có bộ lọc dải lương rõ ràng.
- **Key Moment of Delight:** Nhập MST công ty, thấy ngay trạng thái hoạt động, tên giám đốc pháp nhân và các đơn đăng ký nhãn hiệu đang sở hữu trong vòng 2 giây.

---

## 2. Interaction Design & Edge-Case Architecture (Don Norman Principles)

### Principles Applied:
1. **Visibility (Độ tường minh):** Trạng thái tải của hệ thống không bao giờ là một màn hình tối mờ. Dùng Content Skeletons phản ánh chính xác layout thật (Card, Table, Grid) để giảm cảm giác chờ đợi nhận thức (Perceived Latency).
2. **Feedback (Phản hồi tức thời):** Mỗi hành động click ("Copy CA", "Xuất CSV", "Lọc theo Chain") đều có phản hồi xúc giác thị giác: Badge đổi màu sang xanh lá (Check icon) trong 1.5 giây, Toast notification tinh tế ở góc phải dưới.
3. **Affordance & Signifiers (Gợi ý thao tác):** Các thẻ có thể click đều có hiệu ứng hover nâng độ sâu (elevation lift `hover:-translate-y-0.5 hover:shadow-md`) và con trỏ chuột `cursor-pointer`.
4. **Error Prevention & Recovery (Xử lý lỗi nhân bản):** Khi upstream platform chặn request (Cloudflare 403, Bot Challenge 429), không bao giờ hiển thị mã lỗi kỹ thuật vô nghĩa như `XACT_4030`. Giao diện hiển thị minh bạch:
   - Icon cảnh báo thân thiện (Shield Alert).
   - Giải thích lý do: *"Upstream platform yêu cầu thử thách bảo mật."*
   - Hành động khắc phục: Nút *"Thử lại bằng kênh dự phòng"* hoặc *"Chuyển sang nguồn dữ liệu thay thế"*.

---

## 3. Detailed Wireframes & Component Specs

### 3.1. Dexscreener Suite (`/dexscreener`)
```
+-----------------------------------------------------------------------------------+
|  [DEX Intelligence]  | Search by token name, symbol, or pair address...   [Search]|
+-----------------------------------------------------------------------------------+
| Chains: [All] [Solana] [Base] [Ethereum] [BSC]  | Sort: [24h Volume v] [Liquidity]|
+-----------------------------------------------------------------------------------+
| +-------------------------+ +-------------------------+ +-------------------------+ |
| | $BONK / SOL   [Raydium] | | $BRETT / WETH    [Aerod]| | $PEPE / WETH   [Uniswap]| |
| | Price: $0.000018 (+12%) | | Price: $0.082 (-3.4%)   | | Price: $0.000009 (+5.1%)| |
| | Vol 24h: $42.5M         | | Vol 24h: $12.1M         | | Vol 24h: $88.9M         | |
| | Liq: $8.4M | FDV: $1.2B | | Liq: $3.2M | FDV: $820M | | Liq: $15.2M | FDV: $3.8B| |
| | [Pump.fun Origin Badge] | | [Copy Pair Address]     | | [View on DEX]           | |
| +-------------------------+ +-------------------------+ +-------------------------+ |
+-----------------------------------------------------------------------------------+
```

### 3.2. Fediverse Multi-Column Deck (`/fediverse`)
```
+-----------------------------------------------------------------------------------+
|  [Fediverse Deck] | Columns: [x] Bluesky Hot  [x] Bluesky Profile  [x] Mastodon   |
+-----------------------------------------------------------------------------------+
| [Column 1: Bluesky Hot]   | [Column 2: Profile Feed]  | [Column 3: Mastodon Trend] |
|---------------------------+---------------------------+---------------------------|
| @alice.bsky.social        | @nichxbt.bsky.social      | @gargron@mastodon.social  |
| Post snippet with rich    | Latest research thread... | Announcement of new v4.3  |
| media preview card...     | [Media image preview]     | release with improvements |
| [Likes: 142] [Reposts: 35]| [Likes: 89] [Reposts: 12] | [Boosts: 310] [Favs: 620] |
|---------------------------+---------------------------+---------------------------|
| @bob.bsky.social          | [Infinite Scroll Cursor]  | @techradar@mastodon.world |
| Discussion on AI agent... | Loading more items...     | Deep dive into decentralized|
+-----------------------------------------------------------------------------------+
```
