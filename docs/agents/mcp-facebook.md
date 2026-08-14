# MCP Facebook Tools Reference

> Tài liệu các tool Facebook trên XActions MCP server (`src/mcp/server.js`).
> Cập nhật 2026-08-14.

## Tổng quan

MCP server cung cấp các tool để AI agent (Claude, Cursor, v.v.) điều khiển Facebook: scrape profile/post/group, tự động like/comment/post, join group, gửi kết bạn, warmup, v.v.

Tất cả tool Facebook đều nhận `authCookie` dạng:

```json
{
  "authCookie": {
    "c_user": "100012345678901",
    "xs": "12%3AabCdEf..."
  }
}
```

hoặc dùng stored account:

```json
{
  "authCookie": { "accountId": "cmst5pno80000pwn2pee4pwvx" }
}
```

Cookie không bao giờ được log (NFR3).

## Nguyên tắc chung

- `dryRun` mặc định `true`. Tool chỉ preview cho đến khi bạn set `dryRun: false`.
- `maxBatch` mặc định `20`.
- Các action ghi (like, comment, post, share, join, kết bạn) dễ bị checkpoint — luôn test dry-run trước.

---

## Định dạng kết quả

MCP server trả về kết quả trong `content[0].text` dưới dạng JSON.

- **Thành công**: tool trả về object/result trực tiếp — không bọc trong `{ ok: true }`.
- **Dry-run (`dryRun: true`)**: thường trả về `{ dryRun: true, platform: 'facebook', preview: { ... } }`.
- **Lỗi**: MCP server trả `isError: true` và JSON `{ error: '...' }`.

Ví dụ:

```json
{
  "content": [
    { "type": "text", "text": "{ \"dryRun\": true, \"platform\": \"facebook\", \"preview\": {...} }" }
  ]
}
```

Các ví dụ dưới đây hiển thị phần JSON bên trong `text`.

## Danh sách tool

### Scrape

| Tool | Mục đích | Tham số chính |
|---|---|---|
| `x_facebook_posts` | Scrape bài viết từ profile/page | `url`, `limit` |
| `x_facebook_search` | Tìm kiếm Facebook | `query`, `type`, `location`, `limit` |
| `x_facebook_post_comments` | Bình luận của một post | `url`, `limit`, `includeReplies` |
| `x_facebook_group_posts` | Bài viết trong group | `url`, `limit` |
| `x_facebook_group_comments` | Bình luận trong group post | `url`, `limit`, `includeReplies` |
| `x_facebook_group_members` | Danh sách member group | `groupUrl`, `limit` |
| `x_facebook_marketplace` | Tìm kiếm Marketplace | `query`, `location`, `minPrice`, `maxPrice`, `limit` |
| `x_facebook_list_accounts` | Liệt kê stored account | `userId` hoặc `authCookie.accountId` |

### Automation

| Tool | Mục đích | Tham số chính |
|---|---|---|
| `x_facebook_automate` | Like/comment/post/messenger | `action`, `urls`, `text`, `recipients`, `postUrl` |
| `x_facebook_share_posts` | Share post lên timeline | `postUrls` |
| `x_facebook_schedule_post` | Lên lịch post (DB-only) | `content`, `scheduledAt` |
| `x_facebook_warmup_scroll` | Scroll feed/page tự nhiên | `targetUrl`, `durationSeconds` |
| `x_facebook_warmup_account` | Warmup account trên home feed | `durationSeconds`, `allowReactions` |
| `x_facebook_join_groups` | Join nhiều group | `groupUrls` hoặc `keyword` |
| `x_facebook_post_to_groups` | Post vào nhiều group | `groupUrls`, `content`, `force` |
| `x_facebook_send_friend_requests` | Gửi lời mời kết bạn | `mode`, `targets`/`location` |
| `x_facebook_cancel_friend_requests` | Hủy lời mời đã gửi | `olderThanDays`, `limit` |

---

## Chi tiết tool

### `x_facebook_posts`

Scrape bài viết từ profile hoặc page.

**Args:**

```json
{
  "url": "https://www.facebook.com/Mac24h",
  "limit": 10,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

**Response (khi `dryRun: false`):**

```json
[
  {
    "id": "Nguyễn Tuấn Kiệt\n\n·\n4d\nLoại này còn hàng ko",
    "author": null,
    "text": "Nguyễn Tuấn Kiệt · 4d Loại này còn hàng ko",
    "timestamp": "4d",
    "likes": "0",
    "comments": "0",
    "url": null,
    "media": { "images": [], "hasVideo": false },
    "platform": "facebook"
  }
]
```

---

### `x_facebook_search`

Tìm kiếm Facebook theo danh mục.

**Args:**

```json
{
  "query": "macbook pro",
  "type": "posts",
  "location": "Hồ Chí Minh",
  "limit": 10,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- `type`: `posts` | `people` | `pages` | `groups` | `all`
- `type: "all"` trả về `{ posts, people, pages, groups }`

**Response (khi `type: "posts"`, `dryRun: false`):**

```json
[
  {
    "id": "Macbook Pro 14 inch - đáng mua nhất thời điểm 2026 !! … See ",
    "text": "Macbook Pro 14 inch - đáng mua nhất thời điểm 2026 !! … See more",
    "author": "Mac24h",
    "timestamp": "Mac24h",
    "url": null,
    "platform": "facebook"
  }
]
```

**Response (khi `type: "all"`, `dryRun: false`):**

```json
{
  "posts": [...],
  "people": [...],
  "pages": [...],
  "groups": [...]
}
```

---

### `x_facebook_post_comments`

Scrape bình luận của một post.

**Args:**

```json
{
  "url": "https://www.facebook.com/...",
  "limit": 50,
  "includeReplies": true,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

---

### `x_facebook_group_posts`

Scrape bài viết trong group.

**Args:**

```json
{
  "url": "https://www.facebook.com/groups/opensource",
  "limit": 20,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

---

### `x_facebook_group_comments`

Scrape bình luận của post trong group.

**Args:**

```json
{
  "url": "https://www.facebook.com/groups/opensource/posts/123",
  "limit": 50,
  "includeReplies": true,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

---

### `x_facebook_group_members`

Scrape danh sách member công khai của group.

**Args:**

```json
{
  "groupUrl": "https://www.facebook.com/groups/opensource",
  "limit": 100,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

---

### `x_facebook_marketplace`

Tìm kiếm Marketplace.

**Args:**

```json
{
  "query": "macbook pro 14",
  "location": "Ho Chi Minh",
  "minPrice": 10000000,
  "maxPrice": 50000000,
  "limit": 20,
  "dryRun": true
}
```

> Lưu ý: `x_facebook_marketplace` có thể chạy anonymous (không cần `authCookie`).

---

### `x_facebook_list_accounts`

Liệt kê stored Facebook account.

**Args:**

```json
{
  "userId": "..."
}
```

hoặc

```json
{
  "authCookie": { "accountId": "..." }
}
```

**Response:**

```json
{
  "accounts": [
    { "id": "cmskftywp0001hlne2991n7oi", "label": "FB Account #2", "userId": "cmskewokf0000o3r4drq6vx3r", "createdAt": "2026-08-08T13:57:11.545Z" }
  ]
}
```

---

### `x_facebook_automate`

Tự động hóa like/comment/post/messenger.

**Args:**

```json
{
  "action": "comment",
  "urls": ["https://www.facebook.com/..."],
  "text": "Great deal!",
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- `action`: `like` | `comment` | `post` | `messenger`
- `messenger`: yêu cầu `postUrl`, `recipients`, `content`
- `post`: yêu cầu `text`

**Response (khi `action: "like"`, `dryRun: false`):**

```json
{
  "successCount": 3,
  "totalCount": 3,
  "failed": [],
  "platform": "facebook"
}
```

> Kết quả cụ thể tùy action. Dry-run trả về `{ dryRun: true, platform: 'facebook', preview: {...} }`.

---

### `x_facebook_share_posts`

Share một hoặc nhiều post lên timeline.

**Args:**

```json
{
  "postUrls": ["https://www.facebook.com/..."],
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

---

### `x_facebook_schedule_post`

Lên lịch post vào DB.

**Args:**

```json
{
  "content": "Scheduled post",
  "scheduledAt": "2026-08-15T10:00:00Z",
  "facebookAccountId": "...",
  "userId": "...",
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

> `userId` bắt buộc khi `dryRun: false`.

---

### `x_facebook_warmup_scroll`

Scroll feed/page tự nhiên.

**Args:**

```json
{
  "targetUrl": "https://www.facebook.com/",
  "durationSeconds": 60,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- `durationSeconds` tối đa `300`

---

### `x_facebook_warmup_account`

Warmup account trên home feed.

**Args:**

```json
{
  "durationSeconds": 120,
  "allowReactions": false,
  "reactProbability": 0.05,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- `durationSeconds` tối đa `600`
- `reactProbability` clamped ≤ `0.2`

---

### `x_facebook_join_groups`

Join nhiều group.

**Args:**

```json
{
  "groupUrls": ["https://www.facebook.com/groups/..."],
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

hoặc tìm group theo keyword:

```json
{
  "keyword": "opensource",
  "limit": 5,
  "dryRun": false,
  "authCookie": { "accountId": "..." }
}
```

- Delay tối thiểu `30s` giữa các lần join (NFR-6).

---

### `x_facebook_post_to_groups`

Post nội dung vào nhiều group.

**Args:**

```json
{
  "groupUrls": ["https://www.facebook.com/groups/..."],
  "content": "Check this out!",
  "force": false,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- Mặc định giới hạn `10` group; `force: true` cho phép tối đa `20`.
- Delay tối thiểu `30s` giữa các post (NFR-6).

---

### `x_facebook_send_friend_requests`

Gửi lời mời kết bạn.

**Args:**

```json
{
  "mode": "uid_list",
  "targets": ["https://www.facebook.com/user1"],
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- `mode`: `uid_list` | `suggestions` | `location`
- `suggestions`/`location` yêu cầu `dryRun: false`
- Delay tối thiểu `60s` (NFR-6).

---

### `x_facebook_cancel_friend_requests`

Hủy lời mời đã gửi.

**Args:**

```json
{
  "olderThanDays": 7,
  "limit": 10,
  "dryRun": true,
  "authCookie": { "accountId": "..." }
}
```

- Giai đoạn 1 (collect pending requests) vẫn chạy trong dry-run.

---

## JSON-RPC / MCP message format

Ví dụ gửi từ MCP client:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "x_facebook_search",
    "arguments": {
      "query": "macbook pro",
      "type": "posts",
      "limit": 5,
      "dryRun": true,
      "authCookie": { "accountId": "..." }
    }
  },
  "id": 1
}
```

Ví dụ response thành công:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{ \"dryRun\": true, \"platform\": \"facebook\", \"preview\": { \"action\": \"search\", \"query\": \"macbook pro\", \"type\": \"posts\", \"limit\": 5 } }"
      }
    ]
  }
}
```

---

## Xử lý lỗi

Tất cả tool trả về:

```json
{
  "ok": false,
  "error": "Clear error message"
}
```

Các lỗi phổ biến:

| Lỗi | Nguyên nhân | Giải pháp |
|---|---|---|
| `requires authCookie` | Thiếu cookie hoặc `accountId` | Cung cấp `authCookie` |
| `Facebook account not found` | `accountId` không tồn tại | Kiểm tra `/api/facebook/accounts` |
| `Failed to decrypt stored account cookie` | Cookie trong DB không giải mã được | Xóa và import lại |
| `authCookie.c_user must be a numeric Facebook UID` | `c_user` không đúng định dạng | Kiểm tra 10–20 chữ số |

---

## Tài liệu liên quan

- [facebook-api.md](facebook-api.md) — REST API tương đương
- [facebook-session-cookie.md](facebook-session-cookie.md) — cách lấy cookie
- [selectors-facebook.md](selectors-facebook.md) — DOM selectors
- [mcp-setup.md](../mcp-setup.md) — hướng dẫn kết nối MCP server
