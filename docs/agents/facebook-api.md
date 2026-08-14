# Tài liệu API Facebook

> REST API để tự động hóa, scrape và quản lý session Facebook.
> Cập nhật 2026-08-14 — bổ sung `post_comments`, `group_posts`, `group_comments`, `group_search`, `browserOptions`, và stored-account resolution.

## Xác thực

Tất cả endpoint yêu cầu Bearer token trong header `Authorization`:

```
Authorization: Bearer <JWT_TOKEN>
```

Lấy token qua `POST /api/auth/register` hoặc `POST /api/auth/login`.

## Cookie Facebook

Facebook xác thực bằng cặp cookie `c_user` + `xs`. API hỗ trợ 4 cách cung cấp session:

1. **Raw cookie** trực tiếp: `authCookie: { c_user, xs, datr?, ... }`
2. **Stored account** trong DB: `authCookie: { accountId }`
3. **Danh sách account**: `accountIds: ["id1", "id2"]` (scrape/automate multi-account)
4. **Auto-pick**: nếu không truyền gì, server chọn account active gần đây nhất trong DB

Cookie được mã hóa AES-256-GCM khi lưu, không bao giờ trả về client (NFR3).

Xem [facebook-session-cookie.md](facebook-session-cookie.md) để biết cách trích xuất cookie.

---

## Endpoints

### Quản lý stored account

#### POST /api/facebook/accounts

Lưu account Facebook vào DB (mã hóa cookie).

**Request:**

```json
{
  "label": "My FB Account",
  "c_user": "100012345678901",
  "xs": "12%3AabCdEf...",
  "proxy": "host:port:user:pass"
}
```

| Trường | Yêu cầu | Mô tả |
|---|---|---|
| `label` | ✅ | Nhãn hiển thị, tối đa 50 ký tự |
| `c_user` | ✅ | UID Facebook, 10–20 chữ số |
| `xs` | ✅ | Session token |
| `proxy` | ❌ | Proxy dạng `host:port` hoặc `host:port:user:pass` |

**Response:**

```json
{ "ok": true, "account": { "id": "...", "label": "My FB Account" } }
```

#### GET /api/facebook/accounts

Liệt kê account đã lưu (chỉ trả `id`, `label`, `createdAt`, không bao giờ trả cookie).

**Response:**

```json
{
  "ok": true,
  "accounts": [
    { "id": "cmst5pno80000pwn2pee4pwvx", "label": "FB #1", "createdAt": "2026-08-14T..." }
  ]
}
```

#### PATCH /api/facebook/accounts/:id

Cập nhật proxy cho stored account.

**Request:**

```json
{ "proxy": "host:port" }
```

#### DELETE /api/facebook/accounts/:id

Xóa stored account.

---

### POST /api/facebook/scrape

Scrape dữ liệu Facebook.

**Body:**

```json
{
  "action": "profile | posts | followers | search | marketplace | post_comments | group_posts | group_comments | group_search",
  "url": "https://www.facebook.com/...",
  "query": "từ khóa (cho search/marketplace/group_search)",
  "type": "posts | people | pages | groups | all",
  "location": "Hồ Chí Minh",
  "limit": 10,
  "includeReplies": true,
  "parallel": false,
  "authCookie": { "accountId": "cmst5pno80000pwn2pee4pwvx" },
  "accountIds": ["id1", "id2"],
  "browserOptions": { "headless": true, "proxy": "...", "skipWarmup": false }
}
```

#### Actions

| Action | Tham số bắt buộc | Mô tả | Giới hạn `limit` |
|---|---|---|---|
| `profile` | `url` | Thông tin profile/page | ≤ 500 |
| `posts` | `url` | Danh sách bài viết từ profile/page | ≤ 500 |
| `followers` | `url` | Danh sách followers hoặc `{ note }` nếu bị ẩn | ≤ 500 |
| `search` | `query` | Tìm kiếm toàn Facebook | ≤ 500 |
| `marketplace` | `query` | Tìm kiếm Marketplace | ≤ 500 |
| `post_comments` | `url` | Bình luận của một post | ≤ 500 |
| `group_posts` | `url` | Bài viết trong group (dùng mobile UA) | ≤ 500 |
| `group_comments` | `url` | Bình luận của post trong group | ≤ 500 |
| `group_search` | `url`, `query` | Tìm kiếm trong group (`url` phải chứa `facebook.com/groups/`) | ≤ 500 |

#### Tham số chung

| Trường | Kiểu | Mô tả |
|---|---|---|
| `action` | string | Một trong các action ở trên |
| `url` | string | URL Facebook (bắt buộc với profile/posts/followers/post_comments/group_posts/group_comments/group_search) |
| `query` | string | Từ khóa tìm kiếm, tối đa 500 ký tự |
| `type` | string | `posts`, `people`, `pages`, `groups`, `all` — chỉ dùng cho `search` |
| `location` | string | Bộ lọc địa điểm cho `search`, tối đa 200 ký tự |
| `parallel` | boolean | Song song hóa `search` type `all` (hiện tại có thể bị bỏ qua) |
| `limit` | number | Số lượng kết quả tối đa, số nguyên dương ≤ 500 |
| `includeReplies` | boolean | Bao gồm reply lồng nhau cho `post_comments`/`group_comments` |
| `authCookie` | object | `{ c_user, xs }` hoặc `{ accountId }` |
| `accountIds` | string[] | Multi-account — scrape sẽ dùng account đầu tiên |
| `browserOptions` | object | `{ headless?, proxy?, proxyAuth?, proxyLocation?, skipWarmup? }` |

#### Phân giải session

Priority:
1. `authCookie.c_user` + `authCookie.xs` (raw cookie)
2. `authCookie.accountId` (stored account đơn)
3. `accountIds[0]` (stored account đầu tiên)
4. Auto-pick account active gần đây nhất trong DB

Nếu không tìm thấy active account, trả lỗi `NO_ACTIVE_ACCOUNT`.

**Response thành công:**

```json
{
  "ok": true,
  "action": "search",
  "result": [ { "id": "...", "text": "...", "author": "..." } ]
}
```

**Response lỗi:**

```json
{ "ok": false, "error": "Facebook scrape failed. See server logs." }
```

---

### POST /api/facebook/automate

Tự động hóa Facebook với `dryRun` mặc định `true`.

**Body:**

```json
{
  "action": "like | comment | post | share | messenger-share | share-link-uid | join-groups | batch-post-groups | send-friend-requests | cancel-friend-requests | warmup-account | warmup-scroll-feed | schedule",
  "urls": ["https://..."],
  "text": "content",
  "postUrl": "https://...",
  "postUrls": ["https://..."],
  "recipients": ["Page 1", "Page 2"],
  "content": "message",
  "message": "message",
  "recipientUid": "1172593649275563",
  "recipientUids": ["uid1", "uid2"],
  "groupUrls": ["https://..."],
  "targets": ["https://..."],
  "targetUrl": "https://...",
  "scheduledAt": "2026-08-15T10:00:00Z",
  "facebookAccountId": "...",
  "olderThanDays": 7,
  "limit": 10,
  "durationSeconds": 120,
  "allowReactions": false,
  "reactProbability": 0.05,
  "dryRun": true,
  "headless": true,
  "authCookie": { "accountId": "..." },
  "maxBatch": 20
}
```

#### Actions

| Action | Tham số bắt buộc | Mô tả |
|---|---|---|
| `like` | `urls[]` | Like nhiều post |
| `comment` | `urls[]`, `text` | Comment trên nhiều post |
| `post` | `text` | Tạo post mới |
| `share` | `urls[]` | Share post lên timeline của bạn |
| `messenger-share` | `postUrl`/`postUrls[]`, `recipients[]`, `content` | Share qua Messenger dialog |
| `share-link-uid` | `postUrl`/`postUrls[]`, `recipientUid`/`recipientUids[]`, `content`/`message` | Share qua URL Messenger trực tiếp theo UID |
| `join-groups` | `groupUrls[]` | Join nhiều group |
| `batch-post-groups` | `groupUrls[]`, `text` | Post cùng nội dung vào nhiều group |
| `send-friend-requests` | `targets[]` | Gửi lời mời kết bạn theo profile URL |
| `cancel-friend-requests` | — | Hủy lời mời đã gửi. `olderThanDays`, `limit` tùy chọn |
| `warmup-account` | — | Scroll newsfeed tự nhiên. `durationSeconds`, `allowReactions`, `reactProbability` |
| `warmup-scroll-feed` | `targetUrl` | Scroll một feed/page cụ thể. `durationSeconds` |
| `schedule` | `text`, `scheduledAt` | Lên lịch post (DB-only, không launch browser). `facebookAccountId` tùy chọn |

**Lưu ý:**
- `dryRun` mặc định `true`. Chỉ khi `dryRun: false` mới thực sự ghi dữ liệu.
- `headless` mặc định `true`. Đặt `false` để mở cửa sổ browser debug.
- `messenger-share` hỗ trợ multi-account round-robin qua `accountIds`.
- `cancel-friend-requests` cần truy cập page ngay cả trong dry-run.

**Response thành công:**

```json
{
  "ok": true,
  "action": "like",
  "dryRun": false,
  "userId": "...",
  "operationId": "...",
  "successCount": 3,
  "totalCount": 3
}
```

---

## `browserOptions`

Tùy chọn browser cho scrape/automate.

| Trường | Kiểu | Mô tả |
|---|---|---|
| `headless` | boolean | `true` (default) chạy ẩn, `false` hiển thị cửa sổ |
| `proxy` | string | Proxy URL, ví dụ `http://user:pass@host:port` |
| `proxyAuth` | string | Thông tin xác thực proxy nếu tách ra |
| `proxyLocation` | string | Vị trí proxy |
| `skipWarmup` | boolean | Bỏ qua bước warm-up |

---

## Headless mode

| Giá trị | Hiển thị | Tốc độ | Dùng khi |
|---|---|---|---|
| `true` | Ẩn | Nhanh hơn | Production, batch |
| `false` | Hiện cửa sổ | Chậm hơn | Debug, giải CAPTCHA, quan sát |

---

## Xử lý lỗi

Tất cả endpoint trả về format nhất quán:

```json
{ "ok": false, "error": "Rõ ràng, không leak nội bộ" }
```

### Lỗi phổ biến

| Lỗi | Nguyên nhân | Giải pháp |
|---|---|---|
| `No token provided` | Thiếu Authorization | Thêm Bearer token |
| `Invalid token` | JWT hết hạn hoặc sai | Login lại |
| `action must be one of: ...` | Action không hợp lệ | Kiểm tra danh sách action |
| `requires url/query` | Thiếu tham số bắt buộc | Bổ sung `url` hoặc `query` |
| `No active Facebook account found` | Không có stored account active | Thêm account hoặc cung cấp raw cookie |
| `Facebook scrape/automate failed` | Lỗi runtime | Xem server log |
| `Facebook cookie authentication failed` (log server) | Cookie hết hạn hoặc không hợp lệ | Trích xuất cookie mới |
| `checkpoint` / `security check` (log server) | Facebook CAPTCHA/checkpoint | Giải thủ công, đổi cookie |

---

## Rate limit & best practice

1. **Luôn dry-run trước**: thử `dryRun: true` trước khi ghi thật.
2. **Rủi ro tài khoản**: real writes dễ bị checkpoint — dùng account phụ.
3. **Delay**: hệ thống tự thêm delay giả lập con người (1–3s, 30s cho group, 60s cho friend requests).
4. **Batch**: `maxBatch` mặc định 20, có thể giới hạn khác tùy action.
5. **Cookie rotation**: thay cookie 3–6 tháng hoặc sau sự kiện bảo mật.

---

## Tài liệu liên quan

- [facebook-session-cookie.md](facebook-session-cookie.md) — cách lấy cookie
- [selectors-facebook.md](selectors-facebook.md) — DOM selector cho scraper
- [mcp-facebook.md](mcp-facebook.md) — gọi Facebook qua MCP server
