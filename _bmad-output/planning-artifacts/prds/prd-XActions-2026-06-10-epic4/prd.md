---
title: "Epic 4 — Facebook Growth Automation"
created: 2026-06-10
updated: 2026-06-10
status: draft
epic: 4
prd_ref: prd-XActions-2026-06-08
---

# PRD: Epic 4 — Facebook Growth Automation
*Mở rộng Facebook Platform Extension với các tính năng tăng trưởng tự động, dựa trên phân tích cạnh tranh AutoNuoi.*

## 0. Mục Đích Tài Liệu

PRD này là phần tiếp theo của `prd-XActions-2026-06-08` (Epics 1–3: scrape, automation like/comment/post, CLI/MCP/REST/Persistence). Epic 4 bổ sung các tính năng **tăng trưởng** tự động cho Facebook — nhóm tính năng xác định từ phân tích cạnh tranh AutoNuoi. FR đánh số tiếp từ FR-14 (→ FR-15..FR-23). NFR tiếp từ NFR-5 của Epic 3 (→ NFR-6..NFR-10). ADR-007 (dry-run mặc định cho mọi thao tác ghi) và pattern `runGuardedBatch` từ Epic 2 bắt buộc áp dụng cho mọi FR ghi mới.

**Hai cluster bị defer sang v3:** Cluster 4 (Messaging — gửi/quản lý tin nhắn tự động) và Cluster 5 (Multi-account — proxy rotation, session pool đồng thời). Lý do defer: account risk cực cao, cần kiến trúc proxy/session phức tạp ngoài scope hiện tại.

## 1. Vision

Epic 4 đưa XActions từ "Facebook toolkit" lên "Facebook growth engine" — bộ công cụ tăng trưởng tài khoản ngang tầm AutoNuoi và các tool thương mại, nhưng tích hợp trong cùng một toolkit, một interface, cùng hệ guardrail an toàn đã được kiểm chứng.

Ba cluster tính năng sắp xếp theo rủi ro tăng dần — và đây cũng là thứ tự triển khai đề xuất:

- **Cluster 3** (rủi ro thấp, làm trước): lên lịch post, auto-share, view boost.
- **Cluster 1** (rủi ro trung bình): tham gia nhóm, đăng bài nhóm hàng loạt, scrape thành viên nhóm.
- **Cluster 2** (rủi ro trung-cao): gửi kết bạn tự động, hủy lời mời pending, làm ấm tài khoản.

## 2. Target User

### 2.1 Jobs To Be Done

- **Là người làm growth/marketing**, tôi muốn lên lịch post Facebook trước để không phải online đúng giờ vàng, duy trì nội dung đều đặn trên nhiều tài khoản.
- **Là người vận hành nhiều nhóm Facebook**, tôi muốn đăng bài hàng loạt vào nhiều nhóm với delay tự nhiên và dry-run trước để tránh spam detection.
- **Là người mới tạo tài khoản Facebook**, tôi muốn làm ấm tài khoản (newsfeed farming) một cách tự nhiên để tăng trust score trước khi chạy automation nặng.
- **Là người đang tiệm cận giới hạn 1000 lời mời kết bạn**, tôi muốn bulk cancel lời mời chưa được chấp nhận để giải phóng quota mà không thao tác thủ công từng cái.

### 2.2 Non-Users (Epic 4)

- Người cần scrape số điện thoại — ngoài phạm vi, vi phạm ToS Meta và pháp lý nhiều quốc gia.
- Người cần gửi tin nhắn hàng loạt (bulk DM) — defer Cluster 4 v3.
- Người cần proxy rotation / multi-account đồng thời — defer Cluster 5 v3.
- Người cần Facebook Ads / Business / Marketplace automation — ngoài phạm vi.

### 2.3 Key User Journeys

- **UJ-5**: Tuấn lên lịch một bài vào 20h thứ Sáu. Tuấn nhập nội dung + datetime, hệ thống preview (dry-run), Tuấn xác nhận; job được schedule và worker thực thi đúng giờ. Realizes FR-15.
- **UJ-6**: Mai đăng bài vào 10 nhóm với batch dry-run. Hệ thống liệt kê 10 nhóm + nội dung sẽ đăng; Mai xác nhận; hệ thống thực thi với delay ngẫu nhiên 30–90s giữa mỗi nhóm. Realizes FR-19.
- **UJ-7**: Hưng mới tạo tài khoản, chạy newsfeed farming 15 phút để tài khoản trông tự nhiên trước khi gửi kết bạn. Realizes FR-23.
- **UJ-8**: Lan hủy 200 lời mời kết bạn đang chờ trong một thao tác để giải phóng quota kết bạn. Realizes FR-22.

## 3. Glossary

- **runGuardedBatch** — Hàm helper dùng chung từ Epic 2: nhận array targets, `dryRun` flag, `delayMs` range, `batchLimit`, chạy với delay/retry/stop condition. Bắt buộc dùng hoặc extend cho mọi vòng lặp ghi hàng loạt.
- **Scheduled post** — Post Facebook được tạo sẵn, lưu vào bảng `Schedule` Prisma, thực thi bởi scheduler worker tại `scheduledAt`.
- **View boost** — Scroll tự nhiên mô phỏng người dùng đọc bài để tăng tín hiệu engagement cho thuật toán Facebook mà không thực hiện action rõ ràng (like/comment).
- **Account warming** — Chuỗi hành vi tự nhiên (scroll newsfeed, react nhẹ xác suất thấp) trên tài khoản mới để xây dựng behavioral fingerprint bình thường trước khi chạy automation mutating.
- **Pending friend request** — Lời mời kết bạn đã gửi nhưng chưa được chấp nhận; tích tụ đến 1000 làm Facebook chặn tính năng gửi kết bạn tiếp.
- **Group batch post** — Đăng một nội dung vào nhiều nhóm Facebook theo lượt, với delay và giới hạn số nhóm mỗi session.
- **Session cookie (Facebook)** — Cặp `c_user` + `xs` (kế thừa từ Epic 1/FR-10). Không bao giờ log.

## 4. Features

### 4.1 Cluster 3 — Post Scheduling & Share (Ưu tiên cao, rủi ro thấp)

**Mô tả:** Lên lịch, chia sẻ và tăng lượt xem tự nhiên. Cluster ít rủi ro nhất — không phát sinh action "xã hội" nên ít trigger anti-bot hơn Cluster 1/2. Triển khai trước.

#### FR-15: Lên lịch post Facebook

Người dùng lên lịch một bài đăng tại datetime cụ thể. Realizes UJ-5.

**Consequences (testable):**
- Nhận `{ content, mediaUrls?, scheduledAt: ISO8601, dryRun=true }`.
- `dryRun=true`: preview nội dung + thời gian đăng; không tạo bản ghi `Schedule`.
- `dryRun=false`: tạo bản ghi `Schedule` trong Prisma, scope theo `userId`, trả về `scheduleId`.
- Scheduler worker thực thi trong khoảng ±2 phút so với `scheduledAt`.
- Post thất bại (session hết hạn, checkpoint) cập nhật `Schedule.status = 'failed'` với lý do; không retry mù.

#### FR-16: Auto-share post

Người dùng tự động share một post URL lên timeline của mình.

**Consequences (testable):**
- Nhận `{ postUrl, dryRun=true }`.
- `dryRun=true`: trả về preview action mà không thực thi bất kỳ DOM interaction nào.
- `dryRun=false`: thực hiện share, trả về URL post share đã tạo trong Operation result.
- Nếu `postUrl` không hợp lệ hoặc post bị xóa: trả về lỗi rõ ràng trước khi mở browser.

#### FR-17: View boost (scroll simulation)

Hệ thống mô phỏng scroll tự nhiên trên trang/post để tăng tín hiệu engagement.

**Consequences (testable):**
- Nhận `{ targetUrl, durationSeconds, dryRun=true }`.
- Scroll với tốc độ và pause ngẫu nhiên; không thực hiện click action nào.
- `durationSeconds` giới hạn tối đa 300s/session; vượt ngưỡng bị clamped, không từ chối.
- `dryRun=true`: validate URL và tính toán tham số nhưng không mở browser.
- Không tạo Operation record khi dry-run; tạo khi thực thi thật.

---

### 4.2 Cluster 1 — Group Automation (Rủi ro trung bình)

**Mô tả:** Tự động tham gia nhóm, đăng bài hàng loạt và scrape thành viên. Cảnh báo account risk bắt buộc hiển thị trước mỗi session ghi. `runGuardedBatch` bắt buộc cho FR-18, FR-19.

#### FR-18: Tham gia nhóm tự động

Người dùng tham gia nhóm Facebook theo danh sách URL hoặc kết quả tìm kiếm theo từ khóa.

**Consequences (testable):**
- Chế độ URL: nhận `{ groupUrls: string[], dryRun=true }`.
- Chế độ tìm kiếm: nhận `{ keyword, limit, dryRun=true }` — tìm kiếm rồi tham gia kết quả.
- `dryRun=true`: liệt kê các nhóm sẽ tham gia; không gửi bất kỳ yêu cầu nào.
- `dryRun=false`: gửi yêu cầu tham gia qua `runGuardedBatch` với delay 30–90s giữa các nhóm.
- Cảnh báo account risk hiển thị bắt buộc trước batch đầu tiên.
- Nhóm yêu cầu duyệt (pending approval): ghi trạng thái `pending` vào Operation result; không coi là lỗi.

#### FR-19: Đăng bài vào nhiều nhóm (batch)

Người dùng đăng một nội dung vào nhiều nhóm Facebook với dry-run mặc định, delay ngẫu nhiên và batch có giới hạn. Realizes UJ-6.

**Consequences (testable):**
- Nhận `{ groupUrls: string[], content, mediaUrls?, dryRun=true, batchLimit=10, delayRange=[30000,90000] }`.
- `batchLimit` mặc định 10 nhóm/session; vượt ngưỡng yêu cầu tham số `force=true` tường minh.
- `dryRun=true`: preview danh sách nhóm và nội dung sẽ đăng; không mở browser.
- `dryRun=false`: thực thi qua `runGuardedBatch`; tạo một Operation tổng hợp với progress từng nhóm.
- Nhóm thất bại (không còn là thành viên, bị giới hạn đăng) không làm abort batch; lỗi ghi vào Operation.
- Cảnh báo account risk bắt buộc trước batch.

#### FR-20: Scrape thành viên nhóm

Người dùng lấy danh sách thành viên của một nhóm Facebook theo URL.

**Consequences (testable):**
- Nhận `{ groupUrl, limit }`.
- Trả về `[{ name, username?, profileUrl, platform: 'facebook' }]`.
- Scroll để load thêm cho tới khi đạt `limit` hoặc hết; bounded retry khi không có thành viên mới.
- Khi nhóm không cho phép xem thành viên hoặc tài khoản chưa là thành viên: trả về object với `note` giải thích, không ném lỗi cứng.
- Không thu thập số điện thoại hoặc email kể cả khi DOM hiển thị (NFR-10).

---

### 4.3 Cluster 2 — Friend Management (Rủi ro trung-cao)

**Mô tả:** Gửi kết bạn tự động, hủy lời mời pending và làm ấm tài khoản. Cluster có account risk cao nhất trong Epic 4. Cảnh báo rõ ràng không thể tắt. Delay và batch limit bảo thủ hơn Cluster 1.

#### FR-21: Gửi kết bạn tự động

Người dùng gửi lời mời kết bạn theo UID list, danh sách gợi ý của Facebook, hoặc lọc theo địa điểm công khai.

**Consequences (testable):**
- Nhận `{ mode: 'uid_list'|'suggestions'|'location', targets?, location?, limit, dryRun=true }`.
- `dryRun=true`: liệt kê profiles sẽ được gửi lời mời; không gửi.
- `dryRun=false`: gửi qua `runGuardedBatch` với delay 60–180s giữa các request; `batchLimit` ≤ 20/session.
- Cảnh báo bắt buộc trước khi thực thi: "Gửi kết bạn tự động có thể kích hoạt checkpoint hoặc khóa tính năng kết bạn. Dùng account thử nghiệm trước."
- Profile đã là bạn bè, đã có lời mời pending, hoặc không tìm thấy: bỏ qua và log vào Operation, không fail batch.
- Bộ lọc `location` chỉ dùng trường địa điểm tự khai công khai; không inference hay enrichment.
- Không scrape số điện thoại trong bất kỳ chế độ nào (NFR-10).

#### FR-22: Hủy lời mời kết bạn đang chờ

Người dùng bulk cancel lời mời kết bạn chưa được chấp nhận để giải phóng quota. Realizes UJ-8.

**Consequences (testable):**
- Nhận `{ limit, dryRun=true }` — hủy tối đa `limit` lời mời pending gần nhất.
- `dryRun=true`: trả về danh sách lời mời sẽ bị hủy `[{ name, profileUrl, dateSent }]`.
- `dryRun=false`: thực thi qua `runGuardedBatch` với delay 2–5s giữa mỗi hủy; trả về `{ cancelled, failed, remaining }`.
- Cảnh báo: "Hủy nhiều lời mời liên tiếp có thể bị Facebook gắn cờ; giữ batch nhỏ và dùng delay."

#### FR-23: Newsfeed farming / Account warming

Hệ thống mô phỏng hành vi tự nhiên (scroll newsfeed, react nhẹ xác suất thấp) để làm ấm tài khoản. Realizes UJ-7.

**Consequences (testable):**
- Nhận `{ durationSeconds, reactProbability=0.05, dryRun=true }`.
- Scroll với tốc độ và pause ngẫu nhiên; dừng ≥ 5s ít nhất một lần sau mỗi 3 màn hình cuộn.
- `reactProbability` mặc định 0.05; bị cap tối đa 0.2, không cho vượt kể cả khi người dùng cấu hình.
- `dryRun=true`: validate tham số và log kịch bản sẽ chạy; không mở browser, không thực hiện action.
- `durationSeconds` bị cap tối đa 600s/session.
- Cảnh báo bắt buộc: "Account warming không đảm bảo tránh checkpoint. Dùng trên account thử nghiệm trước khi dùng account chính."

## 5. Non-Goals (Explicit)

- **Không scrape số điện thoại** — vi phạm ToS Meta và pháp lý nhiều quốc gia; không implement kể cả khi DOM hiển thị.
- **Không gửi tin nhắn hàng loạt** (bulk DM / Messenger) — defer Cluster 4 v3; account risk cực cao.
- **Không quản lý proxy/multi-account tự động** — defer Cluster 5 v3; cần kiến trúc session/proxy chuyên dụng.
- **Không tự sinh nội dung post/comment bằng AI** — đã defer từ Epic 3 sang v2+.
- **Không build Facebook Ads / Business / Marketplace automation**.
- **Không đảm bảo tài khoản không bị khóa** — mọi automation chạy trên trách nhiệm người dùng; hệ thống chỉ thiết lập guardrail tốt nhất có thể.

## 6. MVP Scope

### 6.1 In Scope

- FR-15: Schedule post — Prisma `Schedule` record + scheduler worker thực thi đúng giờ.
- FR-16: Auto-share post — single share action với dry-run.
- FR-17: View boost — scroll simulation có `durationSeconds` cap.
- FR-18: Tham gia nhóm — URL mode + keyword search mode, `runGuardedBatch`.
- FR-19: Batch group post — `runGuardedBatch`, `batchLimit=10`, dry-run mặc định.
- FR-20: Scrape group members — mảng profile rút gọn, bounded scroll.
- FR-21: Gửi kết bạn — 3 mode, batch ≤ 20/session, `runGuardedBatch`.
- FR-22: Cancel pending requests — bulk cancel với dry-run.
- FR-23: Newsfeed farming — scroll + react bounded, `reactProbability` cap 0.2.
- Mọi FR ghi: Operation record + Socket.IO progress + cảnh báo account risk.

### 6.2 Out of Scope cho Epic 4

- Cluster 4 (Messaging) và Cluster 5 (Multi-account) — defer v3.
- Proxy rotation, fingerprint spoofing nâng cao — defer v3.
- AI-generated content cho group posts / friend request message — defer v2+.
- Bảng Prisma riêng cho Facebook groups/friends — tái dùng `Operation` + JSON metadata cho MVP.

## 7. Cross-Cutting NFRs (tiếp từ NFR-5 của Epic 3)

- **NFR-6 — Delay sàn cho write action:** Cluster 1 dùng delay 30–90s giữa group actions; Cluster 2 dùng 60–180s giữa friend requests. Không giảm dưới ngưỡng sàn này dù người dùng cấu hình.
- **NFR-7 — runGuardedBatch là bắt buộc:** Mọi FR có vòng lặp ghi hàng loạt (FR-18, FR-19, FR-21, FR-22) phải dùng hoặc extend `runGuardedBatch` từ Epic 2. Không tự viết vòng lặp mutate mới không qua guardrail.
- **NFR-8 — Cảnh báo account risk không thể tắt:** FR-18, FR-19, FR-21, FR-22, FR-23 bắt buộc hiển thị cảnh báo rõ ràng (terminal/dashboard) trước khi thực thi thật. Người dùng không thể suppress cảnh báo qua flag.
- **NFR-9 — Giới hạn throughput scheduling:** Scheduler worker không thực thi quá 5 scheduled posts/giờ/user. Vượt ngưỡng: enqueue với jitter thay vì từ chối hard.
- **NFR-10 — Không thu thập PII nhạy cảm:** Mọi scraper Epic 4 không bao giờ thu thập số điện thoại, email, địa chỉ — kể cả khi DOM hiển thị. Bộ lọc extract loại trừ tường minh ở tầng normalizer, không phụ thuộc vào filter ở caller.

## 8. Success Metrics

**Primary**
- **SM-4**: Dry-run coverage — 100% hàm ghi trong FR-15..FR-23 mặc định `dryRun=true` và không thực thi DOM action nào khi dry-run. Validates ADR-007.
- **SM-5**: `runGuardedBatch` adoption — Mọi vòng lặp ghi hàng loạt (FR-18, FR-19, FR-21, FR-22) đi qua `runGuardedBatch`; không có vòng lặp mutate mới viết thủ công. Validates NFR-7.

**Secondary**
- **SM-6**: Schedule reliability — ≥ 95% scheduled posts thực thi trong ±2 phút so với `scheduledAt` khi session Facebook hợp lệ. Validates FR-15.
- **SM-7**: Group batch completion rate — FR-19 hoàn thành ≥ 90% items trong batch; lỗi từng nhóm không abort toàn batch. Validates FR-19.

**Counter-metrics (không tối ưu theo hướng này)**
- **SM-C3**: Không tăng tốc độ gửi kết bạn hay group post để "chạy nhiều hơn" — delay bảo thủ phải giữ nguyên dù có áp lực throughput. Validates NFR-6.

## 9. Open Questions

**Epic 4 blocker:**
1. `runGuardedBatch` hiện ở module path nào trong codebase? Cần extend thêm gì để hỗ trợ `delayRange` ngẫu nhiên (thay vì fixed delay)?
2. Prisma `Schedule` model đã tồn tại chưa — nếu chưa, migration nào cần chạy trước FR-15?
3. Ngưỡng `batchLimit` an toàn cho FR-21 (friend request) cần thực nghiệm trên account test — khi nào team có account Facebook thử nghiệm sẵn sàng?

**Non-blocking (defer):**
4. Cluster 4 (Messaging): khi nào sẽ spec? Liệu cần proxy/multi-session trước hay sau khi spec?
5. AI content generation cho FR-19 (group post): integrate với AI layer hiện có hay thêm LLM adapter mới?

## 10. Assumptions Index

- **§4.2 FR-19** — `batchLimit=10` là con số khởi điểm bảo thủ; cần điều chỉnh sau khi có dữ liệu thực nghiệm trên account test.
- **§4.3 FR-21** — Bộ lọc `location` chỉ dùng trường địa điểm tự khai công khai; không dùng inference hay enrichment từ nguồn ngoài.
- **§6.2** — Tái dùng `Operation` model hiện có với JSON metadata; không tạo bảng Prisma riêng cho Epic 4 ở MVP.
- **§7 NFR-10** — Giới hạn extract PII thực thi ở tầng normalizer của scraper; caller không thể bypass bằng option.
