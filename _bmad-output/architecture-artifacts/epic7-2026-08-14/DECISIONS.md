# Architecture Decisions — Epic 7

| ID | Decision | Rationale | Consequence |
|---|---|---|---|
| AD-7.1 | `FacebookAccountHealth` lưu trong Prisma với TTL 5 phút | Cần kết quả bền vững giữa các lần restart; Redis chỉ dùng nếu production đã có. | Cần migration thêm `FacebookAccountHealth` model; health check cache miss gây trễ < 2s. |
| AD-7.2 | Thêm `proxy` field vào `FacebookAccount` | Mỗi account cần gắn proxy cố định để tránh IP leak hoặc ghép nhầm proxy khi chạy song song. | `FacebookAccountPool` phải honor proxy affinity; cần migration thêm `proxy` (nullable string). |
| AD-7.3 | `p-limit@7.2.0` pin exact cho concurrency | Thư viện chuẩn, nhỏ, ESM native. Pin exact để tránh auto-resolve lên 7.3.1 mới publish. | `AccountPool` dùng `p-limit` cho `maxConcurrency`; delay giữa launches tự implement wrapper. |
| AD-7.4 | `x_facebook_search type: 'all'` mặc định sequential, có option `parallel: true` | Sequential an toàn hơn cho 1 account; parallel fan-out khi user chủ động chọn và có đủ account live. | `FacebookScrapeService.run` cần detect `all` và dispatch 4 sub-tasks nếu `parallel: true`. |
| AD-7.5 | GraphQL replay (FR-62) dùng `axios` + cookie + headers thật, không dùng TLS/JA3 impersonation | `graphqlSend.js` và `graphql.js` đã dùng `axios` hiệu quả; FR-62 defer Phase 3; tránh dependency native nặng. | Nếu bị block ở Phase 3, sẽ cân nhắc `node-libcurl-ja3` thay vì `impers`/`tls-client-node` (alpha). |
| AD-7.6 | Mỗi task mở browser riêng với `userDataDir: buildUserDataDir(c_user)` | Tách biệt session, cookies, profile giữa các account; tái dụng persistent profiles. | Tiêu tốn RAM nhiều hơn; cần giới hạn concurrency cap 4-8. |
| AD-7.7 | `FacebookScrapeService` là single source of truth cho API + MCP | Tránh duplicate logic login/scrape; thống nhất contract. | API route và MCP tool chỉ là thin wrappers gọi service. |
| AD-7.8 | Hydration JSON extraction là tầng fallback chính, DOM fallback cuối | Giảm độ brittle của selector; DOM chỉ dùng khi hydration không đủ. | Cần duy trì `__typename` mapping và walker. |

## Open / Deferred

- `p-limit` vs `p-queue`: đã quyết `p-limit`.
- TLS/JA3: đã quyết `axios` cho Epic 7.
- GraphQL replay: defer Phase 3.
- Reaction/liker list: defer Epic 7b.
