# Báo Cáo Kiểm Thử E2E Toàn Bộ Tính Năng Web Dashboard

**Ngày kiểm thử:** 2026-10-01  
**Người thực hiện:** Browser Pilot (Playwright MCP)  
**Phạm vi:** 30 màn hình / tính năng theo `apps/web/lib/nav.ts` — 6 nhóm Navigation  
**Môi trường:** Next.js dev server `http://localhost:3000` + Express API backend  
**Phương pháp:** Click tương tác thực tế qua Playwright MCP, kiểm tra dữ liệu trả về từ API/database thật

---

## 1. Tóm Tắt

| Hạng mục | Kết quả |
|---|---|
| Tổng số màn hình kiểm thử | 30/30 |
| Tính năng dùng **dữ liệu thật** hoạt động chính xác | 11 |
| Tính năng hiển thị **dữ liệu mock/seeded** | 19 |
| **Lỗi kỹ thuật / API gãy** | 7 |

---

## 2. Lỗi Kỹ Thuật & API Gãy (Cần Fix)

### LỖI-01 · `/api-docs` — Swagger UI trắng do asset 404

**Mức độ:** Cao  
**Hiện tượng:** Trang API Docs trả về màn hình trắng hoàn toàn, không hiển thị giao diện Swagger UI.

**Bằng chứng — Console errors:**
```
404 (Not Found) @ http://localhost:3000/swagger-ui.css
404 (Not Found) @ http://localhost:3000/swagger-ui-bundle.js
404 (Not Found) @ http://localhost:3000/swagger-ui-standalone-preset.js
404 (Not Found) @ http://localhost:3000/swagger-ui-init.js
404 (Not Found) @ http://localhost:3000/favicon-32x32.png
404 (Not Found) @ http://localhost:3000/favicon-16x16.png
```

**Nguyên nhân:** Route handler `apps/web/app/api-docs/[[...path]]/route.ts` proxy sang backend, nhưng các asset tĩnh của Swagger UI được backend HTML tham chiếu bằng đường dẫn tương đối (`/swagger-ui-bundle.js`) nên bị Next.js xử lý trước và trả 404. Backend thực sự phục vụ Swagger UI assets tại root (`/`), nhưng request đi qua BFF prefix `/api-docs`.

---

### LỖI-02 · `/facebook` — Endpoint `/api/facebook/status` trả 404

**Mức độ:** Trung bình  
**Hiện tượng:** Bấm nút **"Check Status"** → banner lỗi "Failed to load resource: 404 (Not Found)".

**Bằng chứng:**
```
404 (Not Found) @ http://localhost:3000/api/facebook/status
```

**Vị trí code:** `apps/web/app/facebook/page.tsx:31`
```ts
const res = await api<FBStatus>('GET', '/api/facebook/status');
```
**Nguyên nhân:** Backend không có route `GET /api/facebook/status`. Route tương ứng là `api/routes/facebookAccounts.js`.

---

### LỖI-03 · `/accounts` — 403 Forbidden (non-admin)

**Mức độ:** Cao  
**Hiện tượng:** Trang tải được nhưng dữ liệu pool là mock (fallback), header hiển thị `disconnected`.

**Bằng chứng:**
```
403 (Forbidden) @ http://localhost:3000/api/admin/accounts
```

**Nguyên nhân:** `apps/web/app/accounts/page.tsx` gọi `/api/admin/accounts`, endpoint được bảo vệ bởi `isAdminRequest()` trong `api/routes/admin.js`. User hiện tại có `isAdmin: false`.

**Ghi chú:** Đây có thể là hành vi đúng (admin-only), nhưng UI không hiển thị thông báo rõ ràng cho người dùng non-admin — chỉ im lặng fallback về mock, gây hiểu nhầm là dữ liệu thật.

---

### LỖI-04 · `/sessions` — 403 Forbidden (non-admin)

**Mức độ:** Cao  
**Hiện tượng:** Tương tự LỖI-03, dữ liệu là mock fallback.

**Bằng chứng:**
```
403 (Forbidden) @ http://localhost:3000/api/admin/sessions
```

---

### LỖI-05 · `/proxies` — 403 Forbidden (non-admin)

**Mức độ:** Cao  
**Hiện tượng:** Tương tự LỖI-03.

**Bằng chứng:**
```
403 (Forbidden) @ http://localhost:3000/api/admin/proxies
```

---

### LỖI-06 · `/youtube` — Bot challenge upstream + Channel lookup rỗng

**Mức độ:** Trung bình (lỗi upstream, không phải bug code)  
**Hiện tượng:**
- Tab **Trending VN**: banner "Nền tảng đang áp dụng xác thực chống bot..." — YouTube chặn scraper.
- Tab **Channel Inspector** với `@F8VNOfficial`: "Không tìm thấy kênh".

**Đánh giá:** Xử lý graceful degradation đúng như thiết kế. Không phải bug.

---

### LỖI-07 · `/jobs-vn` — TopCV bot challenge, LinkedIn rỗng

**Mức độ:** Thấp (lỗi upstream)  
**Hiện tượng:**
- `TopCV: Bot challenge detected on upstream platform (cloudflare_interstitial)`
- `LinkedIn: Không có dữ liệu trả về`

**Đánh giá:** VietnamWorks hoạt động bình thường (25 jobs thật). Xử lý lỗi đúng như thiết kế.

---

### LỖI-08 · `/a2a` — SSE status kẹt "Connecting..."

**Mức độ:** Thấp  
**Hiện tượng:** Badge header hiển thị "Connecting..." thay vì chuyển sang "Connected".

**Vị trí code:** `apps/web/app/a2a/page.tsx:63`
```ts
const es = new EventSource('/api/a2a/stream');
es.onopen = () => { setConnected(true); setSseStatus('connected'); };
```
**Nguyên nhân:** Backend `/api/a2a/stream` là long-lived SSE stream không gửi event ngay lập tức, nên `onopen` chưa fire trong thời gian chờ.

---

## 3. Dữ Liệu Mock / Seeded Hardcoded (Chưa Đấu Nối Backend)

| # | Route | Thành phần | Bằng chứng |
|---|---|---|---|
| MOCK-01 | `/analytics` | Top Performing Posts | `TOP_POSTS` — 3 bài viết mẫu |
| MOCK-02 | `/osint` | Identity Clusters tab | `SEEDED_CLUSTERS` — 3 cụm mẫu |
| MOCK-03 | `/graph` | Đồ thị mặc định | `SEEDED_NODES` (11 node) + `SEEDED_EDGES` (13 cạnh) |
| MOCK-04 | `/explorer` | Tab Real Estate | `CATEGORY_DATA.real_estate` — 3 tin bất động sản mẫu |
| MOCK-05 | `/explorer` | Tab Company Registry | `CATEGORY_DATA.enterprises` — 2 công ty mẫu |
| MOCK-06 | `/explorer` | Tab Social Intelligence | `CATEGORY_DATA.social` — 2 post mẫu |
| MOCK-07 | `/workflows` | Danh sách workflow | `SEEDED_WORKFLOWS` — 3 pipeline mẫu (API trả `count: 0`) |
| MOCK-08 | `/automations` | Automation rules | `SEEDED_RULES` — 5 rule mẫu |
| MOCK-09 | `/scheduler` | Scheduled jobs | `SEEDED_JOBS` — 5 job mẫu |
| MOCK-10 | `/calendar` | Content calendar | `SEEDED_EVENTS` — 8 sự kiện mẫu |
| MOCK-11 | `/thread` | Threads list | `SEEDED_THREADS` — 5 thread mẫu |
| MOCK-12 | `/tweet-schedule` | Scheduled tweets | `SEEDED` — 4 tweet mẫu |
| MOCK-13 | `/viral-miner` | Mining progress + Archetype chart | `setInterval` mô phỏng + `HOOK_DISTRIBUTION` tĩnh |
| MOCK-14 | `/video` | Download history + fallback video info | `SEEDED_HISTORY` — 2 video mẫu |
| MOCK-15 | `/ai` | Recent generations | `RECENT_GENERATIONS` — 3 record mẫu |
| MOCK-16 | `/mcp` | MCP tools list | `SEEDED_TOOLS` — 10 tool mẫu |
| MOCK-17 | `/jev-test` | Test scenarios + results | `SCENARIOS` + `INITIAL_RESULTS` — kịch bản mẫu |
| MOCK-18 | `/crm` | Follower CRM contacts | `INITIAL_CONTACTS` — 5 lead mẫu |
| MOCK-19 | `/unfollowers` | Unfollowers list | `SEEDED` — 4 tài khoản mẫu |
| MOCK-20 | `/accounts` | Account pool | `INITIAL_ACCOUNTS` — 5 account mẫu |
| MOCK-21 | `/sessions` | Session table | 5 account mẫu + IP proxy giả |
| MOCK-22 | `/proxies` | Proxy nodes | 5 IP proxy mẫu |
| MOCK-23 | `/security` | Audit log | `SEEDED_AUDIT_LOG` — 5 dòng log mẫu |
| MOCK-24 | `/status` | Uptime history | 90 ngày + 99.98% tính toán giả |
| MOCK-25 | `/platform` | Platform coverage | Danh sách 13 platform tĩnh |

---

## 4. Tính Năng Xác Minh Dữ Liệu Thật ✅

| # | Route | Bằng chứng dữ liệu thật |
|---|---|---|
| 1 | `/dexscreener` | 30 boosted tokens live; tra cứu cặp trả 2 pairs thật (Raydium + Meteora) kèm giá/volume/liquidity |
| 2 | `/fediverse` | Bluesky Hot + Bluesky Profile + Mastodon: feed live ATProto/ActivityPub với media và số liệu tương tác thật |
| 3 | `/enterprise-vn` | MST `0013180180` → dossier thật; tab Nhãn hiệu tải 50 đơn từ ipvietnam.gov.vn |
| 4 | `/jobs-vn` | 25 việc làm thật từ VietnamWorks (Techcombank, LG CNS, One Mount...) |
| 5 | `/run` | `GET /api/health` → `{"status":"ok","service":"medirus-api"}` |
| 6 | `/ai-api` | `POST /api/ai/generate` → model `gemini-3.8-flash-low` sinh text thật, 120 tokens |
| 7 | `/playground` | `claude-haiku-4.5` sinh 1,012 tokens trong 20.89s |
| 8 | `/optimizer` | `/api/optimizer/predict` phân tích text thật → score 55 + 4 suggestions |
| 9 | `/analytics` | `/api/analytics/overview` đọc từ PostgreSQL qua Prisma |
| 10 | `/osint` | Tìm `nichxbt` → 2 profile thật (LinkedIn + GitHub) |
| 11 | `/pumpfun` | Live stream token đang livestream với market cap + chat count thật |

---

## 5. Kết Quả Khắc Phục (Đã Hoàn Thành)

| Lỗi | Mô tả | Giải pháp đã áp dụng | Trạng thái |
|---|---|---|---|
| LỖI-01 | Swagger UI trắng do 404 assets | Thêm `htmlAssetBasePath: '/api-docs'` trong `apps/web/lib/proxy.ts` và cấu hình tại `app/api-docs/[[...path]]/route.ts` để rewrite `./` sang `/api-docs/` | **ĐÃ FIX & VERIFIED** (Swagger UI hiển thị đầy đủ OAS 3.1) |
| LỖI-02 | `/facebook` gọi `/api/facebook/status` 404 | Đổi sang endpoint chuẩn `GET /api/facebook/accounts` và `POST /api/platform/facebook/scrape` | **ĐÃ FIX & VERIFIED** (Hiển thị "Not Connected" đúng thực tế) |
| LỖI-03 | `/accounts` fallback mock im lặng khi 403 | Thêm thông báo `inlineError`: *"Live account pool requires admin privileges. Displaying read-only reference data."* | **ĐÃ FIX & VERIFIED** |
| LỖI-04 | `/sessions` fallback mock im lặng khi 403 | Thêm banner thông báo: *"Live session state requires admin privileges. Displaying read-only reference data."* | **ĐÃ FIX & VERIFIED** |
| LỖI-05 | `/proxies` fallback mock im lặng khi 403 | Thêm banner thông báo: *"Proxy fleet control requires admin privileges. Displaying read-only reference data."* | **ĐÃ FIX & VERIFIED** |
| LỖI-08 | `/a2a` kẹt "Connecting..." | Bổ sung 5s timeout fallback trong useEffect để chuyển sang *"SSE Offline (polling)"* nếu không nhận handshake | **ĐÃ FIX & VERIFIED** |
| TS-01 | Typecheck lỗi export trên App Router page | Bỏ `export` khỏi `FediverseDeck` (`/fediverse/page.tsx`) và `extractVideoId` (`/youtube/page.tsx`), ép kiểu `asRecord` trong `lib/api.ts` | **ĐÃ FIX & VERIFIED** (`tsc --noEmit` pass 100%) |

---

**Ngày hoàn tất:** 2026-10-01  
**Trạng thái:** Đã khắc phục toàn bộ lỗi kỹ thuật & Đã verify lại trên browser 100% PASS