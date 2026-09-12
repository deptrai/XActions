# Story 25.2 — `package.json` Exports v2 (Scrapers → `src/scrapers/social/`)

**Epic:** 25 — Unified Scrapers Consolidation & Modern Dispatcher
**Status:** done
**Created:** 2026-09-12
**Depends on:** Story 25.1 (done — universal `scrape()` descriptor dispatcher)

---

## User Story

**As a** consumer of the `xactions` package (npm / local `import`)
**I want** mọi `package.json` export trỏ tới `src/scrapers/social/` thay vì các legacy platform folders (`src/scrapers/{twitter,bluesky,mastodon,threads}/`)
**So that** có một surface API thống nhất, hiện đại, đi qua dispatcher `scrape()` — trong khi vẫn giữ các path cũ hoạt động (backward-compatible) cho ít nhất 1 release cycle.

---

## Acceptance Criteria (BDD)

```gherkin
Given package.json hiện tại có ./scrapers/twitter, ./scrapers/bluesky, ./scrapers/mastodon, ./scrapers/threads
When cập nhật
Then ./scrapers trỏ tới src/scrapers/index.js (dispatcher)            # ĐÃ ĐÚNG — giữ nguyên
And ./scrapers/social trỏ tới src/scrapers/social/index.js            # ĐÃ ĐÚNG — giữ nguyên
And ./scrapers/<platform> redirect tới src/scrapers/social/<platform>/index.js (nếu giữ tên export)
And ./scrapers/twitter/http bị xoá hoặc redirect sang ./scrapers/social/twitter/client.js
And npm run typecheck pass
```

**Ràng buộc compat (từ Epic 25 / FR92 / NFR-16):**
- Legacy export paths phải **tiếp tục resolve** được (không xoá lạnh) — chỉ redirect sang module mới hoặc giữ shim re-export cho tới Epic 26 decommission.
- `npm test` và `npm run typecheck` phải pass; không phá vỡ import nội bộ hiện có.

---

## Dev Notes — Đọc kỹ trước khi sửa

### Trạng thái THẬT của repo (đã verify bằng file system, 2026-09-12)

`package.json` hiện tại đã có `exports` map phong phú. **Mọi target đều tồn tại.** Bảng kiểm chứng:

| Export key | Target hiện tại | Trạng thái | Hành động 25.2 |
|---|---|---|---|
| `.` | `./src/index.js` | OK | giữ |
| `./scrapers` | `./src/scrapers/index.js` (dispatcher) | OK | giữ — đã là AC "Then" |
| `./scrapers/social` | `./src/scrapers/social/index.js` | OK | giữ — đã là AC "And" |
| `./scrapers/social/<p>` | `social/{twitter,facebook,threads,tiktok,bluesky,mastodon,medium,reddit,instagram,...}` | OK | giữ |
| `./scrapers/twitter` | `./src/scrapers/twitter/index.js` (legacy flat, đã `@deprecated`) | LEGACY | **redirect → `social/twitter/index.js`** |
| `./scrapers/bluesky` | `./src/scrapers/bluesky/index.js` (legacy flat) | LEGACY | **redirect → `social/bluesky/index.js`** |
| `./scrapers/mastodon` | `./src/scrapers/mastodon/index.js` (legacy flat) | LEGACY | **redirect → `social/mastodon/index.js`** |
| `./scrapers/threads` | `./src/scrapers/threads/index.js` (legacy flat) | LEGACY | **redirect → `social/threads/index.js`** |
| `./scrapers/twitter/http` | `./src/scrapers/twitter/http/index.js` | LEGACY | **redirect → `social/twitter/client.js`** (hoặc giữ shim) |
| `./scrapers/tiktok` | `./src/scrapers/social/tiktok/index.js` | OK (đã trỏ social) | giữ |
| `./scrapers/ecom/*`, `./scrapers/recruitment/*`, `./scrapers/realestate/*`, `./streaming`, `./analytics`, `./plugins`, `./mcp`, `./cli`, `./client`, `./spaces`, `./store` | đúng chỗ | OK | giữ |

> **ĐIỂM MẤU CHỐT:** Story này KHÔNG phải "thêm exports mới" — exports đã có. Việc thật là **chuyển 4 flat key `./scrapers/{twitter,bluesky,mastodon,threads}` sang trỏ `social/` barrel** + quyết định số phận `./scrapers/twitter/http`.

### ⚠️ BẪY LỚN NHẤT — đừng để dev agent mắc phải

1. **ĐỪNG xoá `src/scrapers/twitter/http/`** — nó vẫn được import nội bộ bởi:
   - `src/scrapers/social/twitter/client.js` (normalize + client dùng chung)
   - `src/scrapers/social/twitter/normalize-*.js`
   - `src/scrapers/adapters/http.js`
   - `src/scrapers/index.js`, `src/scrapers/twitter/http/{playwright-session,guest}.js`
   → **Chỉ redirect/export-key**, KHÔNG đụng file. Việc xoá thư mục thuộc Epic 26 (decommission), không phải story này.

2. **`./scrapers/twitter/http` redirect target phải export được symbol mà consumer dùng.** AC nói "xoá hoặc redirect sang `./scrapers/social/twitter/client.js`". `social/twitter/index.js` re-export `client.js` — kiểm chứng `client.js` có export đủ các symbol mà `twitter/http/index.js` export (browser session helpers, http client). Nếu không đủ → **giữ `./scrapers/twitter/http` như shim re-export**, ghi rõ trong code + `deprecation-plan.md`.

3. **Legacy flat `index.js` files đã có `@deprecated` note** — khi redirect export key sang `social/`, các file cũ vẫn tồn tại cho direct-import nội bộ. Không cần sửa nội dung file legacy.

4. **`types` resolution:** package.json dùng `types: "types/index.d.ts"` (đường dẫn đơn, không có `typesVersions`). Sau khi đổi exports, `tsc --noEmit` phải pass. Nếu thêm `exports` sub-path conditions có `types`, đảm bảo mỗi subpath có `.d.ts` tương ứng hoặc fallback về `types/index.d.ts`.

### Cách thực hiện đề xuất

```jsonc
// package.json → exports (thay 4 flat key)
"./scrapers/twitter":  "./src/scrapers/social/twitter/index.js",
"./scrapers/bluesky":  "./src/scrapers/social/bluesky/index.js",
"./scrapers/mastodon": "./src/scrapers/social/mastodon/index.js",
"./scrapers/threads":  "./src/scrapers/social/threads/index.js",
// twitter/http: redirect sang client nếu symbol-parity đủ, ngược lại giữ nguyên + @deprecated note
"./scrapers/twitter/http": "./src/scrapers/twitter/http/index.js",  // hoặc "./src/scrapers/social/twitter/client.js"
```

**Verify bằng script (chạy trong story):**
```bash
node -e "const p=require('./package.json');const fs=require('fs');
for(const[k,v]of Object.entries(p.exports))if(!fs.existsSync(v))console.log('MISSING',k,v)"
npm run typecheck
npm test   # ít nhất dispatcher + social suites
```

---

## Files to Modify

- `package.json` — `exports` map (4 flat platform keys + quyết định `twitter/http`).
- *(có thể)* `src/scrapers/social/twitter/index.js` — nếu cần re-export thêm để `./scrapers/twitter/http` redirect đủ symbol.
- `docs/deprecation-plan.md` — nếu chưa có thì tạo/skeleton; ghi mapping `legacy export → new export` (phục vụ 25.4).

## Files NOT to touch

- `src/scrapers/twitter/**`, `src/scrapers/bluesky/index.js`, `src/scrapers/mastodon/index.js`, `src/scrapers/threads/index.js` — giữ nguyên làm compat shim.
- Mọi caller nội bộ (`src/mcp`, `api/`, `src/cli`) — migration thuộc **Story 25.3**, không phải 25.2.

## Testing

- Script verify tồn tại target cho mọi export key (ở trên).
- `npm run typecheck` = `tsc --noEmit` phải pass.
- `npm test` — đặc biệt `tests/scrapers/dispatcher.test.js` (35 tests) + social suites; không regression.
- Smoke import: `node -e "import('xactions/scrapers/twitter').then(m=>console.log(Object.keys(m)))"` (hoặc import path tương đương qua self-reference) — xác nhận key cũ vẫn resolve.

---

## Previous Story Intelligence (25.1)

- Story 25.1 đã tạo `src/scrapers/platforms.js` (registry `platforms`/`getPlatform`/`actionNotAvailable`) và 24 `descriptor.js`. Exports v2 **không đụng** dispatcher — chỉ đổi export map trỏ về `social/`.
- Commit `64b0a689` đã verify dispatcher; `src/scrapers/index.js` giờ là thin dispatcher → `./scrapers` trỏ đúng chỗ sẵn.
- Bài học: legacy flat `index.js` vẫn được nhiều file import trực tiếp → đừng xoá/đổi nội dung, chỉ đổi **export key**.

## Definition of Done

- [ ] `./scrapers/{twitter,bluesky,mastodon,threads}` resolve sang `social/` barrel.
- [ ] `./scrapers/twitter/http` resolve được (redirect hoặc shim giữ symbol-parity).
- [ ] Mọi export key resolve tới file tồn tại (script verify pass).
- [ ] `npm run typecheck` pass.
- [ ] `npm test` không regression.
- [ ] `docs/deprecation-plan.md` ghi mapping legacy→new export (nếu file chưa có thì tạo skeleton).
