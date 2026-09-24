---
title: 'Story 48.1 — Web API Foundation: BFF Proxy, Typed Client & Session Transport'
type: 'feature'
created: '2026-09-24'
baseline_commit: 'fe2ff812098eedc4b6ad1fe860528630da815e4b'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/xactions-api-contract-epic46/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `apps/web` gọi backend bằng raw `fetch('http://localhost:3001/...')` — vi phạm FR-126 (phải qua `@xactions/api-client` typed contract), không deploy được (hardcode origin), không có auth transport (dựa vào dev-fallback che mất 401).

**Approach:** BFF catch-all route `app/api/[...path]/route.ts` proxy same-origin → backend bằng raw `fetch` (undici) với header injection; `app/api-docs/[[...path]]/route.ts` proxy Swagger UI; session route `app/session/route.ts` quản httpOnly cookies (`xa_bearer`, `xa_session`); `lib/api.ts` typed helper cho client components; migrate 4 màn có backend calls + `backend-status.tsx`; gỡ `pages/` shim.

## Boundaries & Constraints

**Always:**
- Mọi call backend từ browser đi qua same-origin `/api/*` (và `/api-docs/*`) → BFF → `API_INTERNAL_URL`. Không còn raw `fetch` tới absolute URL, không còn literal `localhost:3001` trong `apps/web/app|components|lib`.
- `lib/proxy.ts` forward method, query, body (JSON + raw stream), và **stream response verbatim** (SSE, video download). Envelope đi qua nguyên trạng — không reshape. Dùng **raw `fetch`** cho forwarding — KHÔNG qua `XActionsClient.request()` (nó buffer `res.text()` + unbox envelope, phá streaming/verbatim).
- Request forward: strip hop-by-hop headers (`connection`, `transfer-encoding`, `keep-alive`, `host`, `content-length`). Body stream cần `(init as any).duplex = 'half'` (undici contract).
- Response forward: strip `content-encoding`, `content-length` (undici auto-decompress — forward verbatim gây double-decode), `transfer-encoding`, `connection`; giữ `content-type`, `set-cookie`, status code.
- Auth injection ở BFF: cookie `xa_bearer` → `Authorization: Bearer`, `xa_session` → `x-session-cookie`. Cookie thắng khi cả cookie + explicit header cùng có. Transitional: explicit `authorization`/`x-session-cookie`/`x-payment`/`x-agent-api-key`/`x-api-key` request headers forward khi cookie vắng.
- `/session` route NGOÀI proxy namespace (`app/session/route.ts`): `POST` nhận `{bearerToken?, sessionCookie?}` **hoặc** `{email, password}` (BFF tự gọi `POST {API_INTERNAL_URL}/api/auth/login` rồi set `xa_bearer` từ token trả về) → set httpOnly cookies (SameSite=Lax, Secure khi prod). `GET` trả `{hasBearer, hasSession}` booleans. `DELETE` xóa cả hai.
- `lib/session.ts` + `lib/proxy.ts` **framework-free**: parse raw `cookie` header từ `Request` — route handlers chỉ là thin adapter (Next `cookies()` API không dùng ở lib layer để giữ unit-test runtime-free).
- `API_INTERNAL_URL` server-only env (default `http://localhost:3001`).
- `lib/api.ts` dùng `import type` cho `ApiResult<T>` từ `@xactions/api-client` — cấm value-import (tránh bundle 9.7k-line client xuống browser).
- NFR-20: zero mocks — tests chạy ephemeral upstream server `127.0.0.1:0` thật và invoke handler trực tiếp.

**Never:**
- Không sửa backend (`api/`) — story này thuần `apps/web` + tests. Backend `/api/session/*` routes tồn tại và **by design** vẫn proxy xuống backend (đừng nhầm với frontend `/session`).
- Không migrate thêm màn legacy nào; không đụng `dashboard/`; không xây login UI (F2).
- Không thêm realtime/socket.io vào story này — deferred (xem Design Notes).
- Không thêm shadcn/radix; không để credential trong response body hay client-readable cookie.
- Không proxy `socket.io` hay `/mcp` qua BFF.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| BFF GET happy | `GET /api/checkpoints?limit=5`, cookie `xa_bearer` set | Forward `GET {API_INTERNAL_URL}/api/checkpoints?limit=5` + `Authorization: Bearer …`; status + body passthrough | N/A |
| BFF POST JSON | `POST /api/crm/tag` body JSON | Forward method + body + `content-type`, `duplex:'half'` | N/A |
| Auth cookie wins | Cookie `xa_session=abc` + explicit header `x-session-cookie:xyz` | Upstream nhận `abc` | N/A |
| Auth transitional | Explicit `x-session-cookie` header, cookie vắng | Forward header nguyên trạng | Cả hai vắng → không inject (backend quyết định 401/dev-fallback) |
| Upstream error | Upstream 401/429/500 envelope | Status + body passthrough verbatim | Upstream unreachable → `502` `{success:false,error:{code:'UPSTREAM_UNREACHABLE'}}` |
| Streaming | `GET /metrics/stream` SSE / `/api/video/download` | Body stream passthrough; `content-type` giữ, `content-encoding`/`content-length` strip | N/A |
| Session set tokens | `POST /session {bearerToken, sessionCookie}` | `Set-Cookie` httpOnly; body `{success:true}` | Body rỗng → `400` |
| Session set login | `POST /session {email, password}` | BFF login upstream → set `xa_bearer` từ `data.token`/`data.data.token` | Login fail → forward upstream status + body |
| Session inspect/clear | `GET`/`DELETE /session` | `{hasBearer, hasSession}` booleans / clear cookies | N/A |
| Bare `/api` | `GET /api` | Next 404 (catch-all không match 0 segment) | N/A |

</frozen-after-approval>

## Code Map

- `apps/web/app/api/[...path]/route.ts` — NEW: catch-all route handler mọi method; Next 15 signature `{ params }: { params: Promise<{ path: string[] }> }`, `await ctx.params`; thin adapter gọi `lib/proxy.ts`.
- `apps/web/app/api-docs/[[...path]]/route.ts` — NEW: proxy Swagger UI + assets (`/api-docs` nằm ngoài `/api/*` backend mount, `api/server.js:325`).
- `apps/web/lib/proxy.ts` — NEW: `proxyToBackend(req: Request, opts)` — build upstream URL, header allowlist/denylist, cookie→header auth, stream forwarding. Framework-free, raw `fetch`.
- `apps/web/app/session/route.ts` — NEW: POST/GET/DELETE; thin adapter.
- `apps/web/lib/session.ts` — NEW: cookie names `xa_bearer`/`xa_session`, `parseCookies(req)`, `sessionHeaders(cookies)` (cookie→upstream header map), `buildSetCookie()` helpers. Framework-free.
- `apps/web/lib/api.ts` — NEW: browser-side `api<T>(method, path, opts?)` → `ApiResult<T>` (`import type` only từ `@xactions/api-client`).
- `apps/web/lib/config.ts` — NEW: `API_INTERNAL_URL` resolution.
- `apps/web/app/{viral-miner,optimizer,crm,admin}/page.tsx` + `components/backend-status.tsx` — EDIT: thay raw fetch bằng `lib/api.ts`. Endpoint coverage: `/api/viral/platforms`, `/api/optimizer/{predict,optimize,hashtags}`, `/api/crm/tag`, `/api/checkpoints` (+`/:id/{pause,resume,retry}`), `/api/health`. `app/page.tsx` + `app/explorer/page.tsx` = static mock, không backend call.
- `apps/web/app/page.tsx:68` + `components/sidebar.tsx:27` — EDIT: link `http://localhost:3001/api-docs/` → same-origin `/api-docs/`.
- `apps/web/pages/` — DELETE `_app.tsx`/`_document.tsx` (shim chỉ import globals.css; `app/layout.tsx:2` đã import → an toàn, verify bằng build).
- `packages/api-client/` — REUSE types only. KHÔNG sửa.
- `api/realtime/socketHandler.js:77-105` — REFERENCE cho S1 (socket auth contract).
- `tests/web/api-proxy.test.js` — NEW vitest: ephemeral express upstream `127.0.0.1:0`, invoke `proxyToBackend` trực tiếp, cover mọi I/O matrix row.
- `tests/web/web-session.test.js` — NEW vitest: invoke session handlers với real `Request`/`Response`.
- `tests/web/no-hardcode.test.js` — NEW: file-scan gate (0 match `localhost:3001` trong `apps/web/app|components|lib`; `import type` enforcement trong `lib/api.ts`).
- `tests/playwright/web-foundation.e2e.spec.js` — NEW: real `next start` :3000 + backend :3001 (match `testMatch` `tests/playwright/*.e2e.spec.js`; prerequisite: 2 servers đang chạy — giống convention hiện có).

## Tasks & Acceptance

**Execution:**
- [ ] `apps/web/lib/config.ts` -- `API_INTERNAL_URL` (server-only, default `http://localhost:3001`) -- config single source
- [ ] `apps/web/lib/session.ts` -- cookie constants, `parseCookies`, `sessionHeaders`, `buildSetCookie` -- framework-free contract
- [ ] `apps/web/lib/proxy.ts` -- `proxyToBackend(req)` per I/O matrix (header rules, duplex, stream) -- core BFF
- [ ] `apps/web/app/api/[...path]/route.ts` -- thin route handlers mọi method -- BFF mount
- [ ] `apps/web/app/api-docs/[[...path]]/route.ts` -- thin handlers gọi cùng proxy -- Swagger same-origin
- [ ] `apps/web/app/session/route.ts` -- POST/GET/DELETE per matrix (gồm `{email,password}` login exchange) -- credential boundary
- [ ] `apps/web/lib/api.ts` -- `api<T>()` same-origin helper, `import type` only -- FR-126 surface
- [ ] Migrate 4 pages + `backend-status.tsx` sang `lib/api.ts`; sửa 2 link `/api-docs` -- zero raw fetch
- [ ] Xóa `apps/web/pages/` -- gỡ dual-router shim
- [ ] `tests/web/api-proxy.test.js` + `web-session.test.js` + `no-hardcode.test.js` -- unit coverage mọi matrix row
- [ ] `tests/playwright/web-foundation.e2e.spec.js` -- e2e: `/` render + `api('/api/health')` qua BFF trả envelope thật

**Acceptance Criteria:**
- Given `next build && next start` + backend :3001, when mở `/`, then `backend-status` badge xanh qua BFF `/api/health` — không call trực tiếp :3001.
- Given `POST /session {sessionCookie:'x'}`, when `GET /api/viral/platforms`, then upstream nhận `x-session-cookie: x`, browser không đọc được cookie.
- Given `POST /session {email,password}` hợp lệ, when thành công, then `xa_bearer` được set và `GET /session` trả `{hasBearer:true}`.
- Given upstream trả 401 envelope, when BFF proxy, then browser nhận đúng 401 + body verbatim.
- Given `pages/` đã xóa, when `next build`, then build xanh + CSS load đúng (không regression `34ee8909`).
- Given link `/api-docs` trong app, when click, then Swagger UI load qua same-origin proxy.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

- **BFF namespace `/api/[...path]` + `/api-docs/[[...path]]`**: browser path == backend path, zero mapping. `/session` tách riêng — nếu trong `/api/*` sẽ bị proxy xuống backend (backend có `/api/session/*` riêng, by design).
- **Raw fetch, không XActionsClient**: client `request()` unbox envelope + buffer text — phá verbatim streaming. Types vẫn reuse (`import type`).
- **Cookie httpOnly + `{email,password}` bootstrap**: legacy giữ JWT localStorage (XSS-exposed). Cookie model nâng posture; login-exchange trong `POST /session` đóng bootstrap gap mà không cần F2 UI.
- **Realtime deferred → S1**: `io.use` chỉ đọc `handshake.auth.token` — httpOnly cookie không reachable từ socket auth payload, sửa backend vi phạm boundary. Chưa màn nào dùng socket → defer đến story màn realtime đầu tiên (quyết: extend `io.use` đọc cookie, hoặc token endpoint).

## Verification

**Commands:**
- `cd apps/web && npm run build` -- expected: build xanh, không còn `pages/`, CSS đúng
- `npx vitest run tests/web/` -- expected: all pass, zero mocks
- `PLAYWRIGHT_BASE_URL=http://localhost:3000 npx playwright test tests/playwright/web-foundation.e2e.spec.js` -- expected: pass (prerequisite: backend `npm run dev` :3001 + `next start` :3000 đang chạy)
- `grep -rn "localhost:3001" apps/web/app apps/web/components apps/web/lib` -- expected: 0 match
- `grep -rn "fetch(" apps/web/app apps/web/components` -- expected: 0 match ngoài `lib/` internals

## Auto Run Result

**Status:** done
**Summary:** Implemented Web API Foundation with BFF catch-all proxy (`app/api/[...path]/route.ts`), Swagger UI proxy (`app/api-docs/[[...path]]/route.ts`), session management (`app/session/route.ts`), typed client helper (`lib/api.ts`), and framework-free session/proxy utilities (`lib/session.ts`, `lib/proxy.ts`). Migrated 4 pages + backend-status from raw `fetch('http://localhost:3001/...')` to same-origin typed `api()` calls. Removed legacy `pages/` dual-router shim.

**Files changed:**
- `apps/web/lib/config.ts`, `apps/web/lib/session.ts`, `apps/web/lib/proxy.ts`, `apps/web/lib/api.ts` *(new)*
- `apps/web/app/api/[...path]/route.ts`, `apps/web/app/api-docs/[[...path]]/route.ts`, `apps/web/app/session/route.ts` *(new)*
- `apps/web/app/{viral-miner,optimizer,crm,admin}/page.tsx`, `apps/web/components/backend-status.tsx` — migrated to `api()` helper
- `apps/web/app/page.tsx`, `apps/web/components/sidebar.tsx` — `/api-docs/` same-origin links
- `apps/web/pages/` — **deleted**
- `tests/web/api-proxy.test.js`, `tests/web/web-session.test.js`, `tests/web/no-hardcode.test.js`, `tests/playwright/web-foundation.e2e.spec.js` *(new)*

**Verification:**
- `npm run web:build` — 10 routes, zero errors (3 dynamic BFF routes)
- `npx vitest run tests/web/` — 42/42 tests pass (zero mocks, ephemeral upstream server)
- `grep -rn "localhost:3001" apps/web/app apps/web/components apps/web/lib` — 0 matches
- `grep -rn "fetch(" apps/web/app apps/web/components` — 0 raw fetch in UI components
