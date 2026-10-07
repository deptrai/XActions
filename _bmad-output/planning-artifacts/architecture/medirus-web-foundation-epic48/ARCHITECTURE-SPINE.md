---
name: 'xactions-web-foundation-epic48'
type: architecture-spine
purpose: build-substrate
altitude: epic
paradigm: 'BFF same-origin proxy + httpOnly cookie session + typed client consumption'
scope: 'Ứng dụng web Next.js 15 (apps/web): BFF route handlers, session/credential boundary, realtime transport, screen migration waves — Epic 48'
status: final
created: '2026-09-24'
updated: '2026-09-24'
binds: ['epic-48', 'story-48.1', 'apps/web/**', 'tests/web/**', 'tests/playwright/web-*.e2e.spec.js']
sources: ['_bmad-output/planning-artifacts/epics.md#epic-48', '_bmad-output/implementation-artifacts/spec-48-1-web-api-foundation-bff.md', 'apps/web/', 'api/realtime/socketHandler.js']
companions: ['xactions-api-contract-epic46', 'xactions-hybrid-scraping-spine']
---

# Architecture Spine — XActions Web Foundation & Frontend Consolidation (Epic 48)

## Design Paradigm

**BFF same-origin proxy.** Browser không bao giờ gọi backend trực tiếp: mọi API call đi qua Next.js route handlers tại `/api/*` (và `/api-docs/*`), forward verbatim tới `API_INTERNAL_URL`, inject credentials từ httpOnly cookies. Client components tiêu thụ typed contract của Epic 46 qua `lib/api.ts` (`import type` only).

```mermaid
flowchart LR
  P["app/*/page.tsx<br/>client components"] --> L["lib/api.ts<br/>typed helper, ApiResult&lt;T&gt;"]
  L --> BFF["app/api/[...path]/route.ts<br/>+ app/api-docs/[[...path]]/route.ts"]
  S["app/session/route.ts<br/>POST/GET/DELETE"] -.sets.-> C[("httpOnly cookies<br/>xa_bearer / xa_session")]
  C --> BFF
  BFF -->|raw fetch undici<br/>verbatim stream| BE["Express backend<br/>API_INTERNAL_URL"]
  P -.socket.io-client<br/>direct.-> RT["socketHandler.js<br/>NEXT_PUBLIC_SOCKET_URL"]
```

Dependency direction (rule, không chỉ là hình): `pages → lib/api.ts → route handlers → lib/proxy.ts → backend`. Không gì trong `apps/web` import backend `api/` trực tiếp; `@xactions/api-client` chỉ cung cấp **types** (`import type`) ở client side — `XActionsClient.request()` không dùng cho forwarding vì nó buffer + unbox envelope.

## Inherited Invariants

| Inherited | From parent | Binds here |
| --- | --- | --- |
| NFR-20 — zero mocks, fast tests | xactions-hybrid-scraping-spine / PRD | Web tests dùng ephemeral upstream `127.0.0.1:0` thật + real handler invocation; không mock network |
| NFR-22/23 — contract honesty & non-breaking | xactions-api-contract-epic46 | BFF là transport layer — envelope `{success,data}`/`{success,error}` passthrough verbatim, không reshape; `x402`/`x-session-cookie` transports giữ nguyên semantics |
| Option D — no PII persistence | PRD NFR-21 | Session cookies là credential transport tối thiểu; không lưu profile/PII nào trong `apps/web` |

## Invariants & Rules

### AD-1 — BFF Route-Handler Proxy (không direct client calls)

- **Binds:** `apps/web/app/api/[...path]/route.ts`, `apps/web/app/api-docs/[[...path]]/route.ts`, `apps/web/lib/proxy.ts`
- **Prevents:** CORS sprawl, credential rò ra browser, hardcode origin trong components (hiện trạng: 4 pages + `backend-status.tsx` gọi `fetch('http://localhost:3001/...')`)
- **Rule:** Mọi backend call từ browser đi same-origin `/api/*` → route handler → `lib/proxy.ts` → raw `fetch` tới `API_INTERNAL_URL`. Browser path == backend path, zero mapping table. Forward method/query/body verbatim kể cả stream (SSE, video download): strip hop-by-hop request headers (`connection`, `transfer-encoding`, `keep-alive`, `host`, `content-length`); strip response `content-encoding`/`content-length`/`transfer-encoding`/`connection` (undici auto-decompress); body stream forward với `duplex: 'half'`. Upstream unreachable → `502` `{success:false,error:{code:'UPSTREAM_UNREACHABLE'}}` (canonical envelope, không phải Next error page). Bare `/api` (0 segment) → Next 404 by design. `/session` nằm NGOÀI proxy namespace — nếu để trong `/api/*` sẽ bị forward xuống backend (backend có `/api/session/*` riêng, proxies by design).

### AD-2 — Credential Boundary: httpOnly Cookies + `/session` Route

- **Binds:** `apps/web/app/session/route.ts`, `apps/web/lib/session.ts`, `apps/web/lib/proxy.ts`
- **Prevents:** JWT/session cookie trong `localStorage` (legacy dashboard pattern — XSS-readable), credential trong response body
- **Rule:** `POST /session` nhận `{bearerToken?, sessionCookie?}` hoặc `{email, password}` (BFF tự gọi backend `POST /api/auth/login`, set `xa_bearer` từ token) → set httpOnly cookies `xa_bearer`/`xa_session` (`SameSite=Lax`, `Secure` khi prod). `GET /session` trả `{hasBearer, hasSession}` booleans — không bao giờ trả giá trị. `DELETE /session` clear. Proxy inject: `xa_bearer` → `Authorization: Bearer`, `xa_session` → `x-session-cookie`; cookie thắng explicit header; transitional explicit headers (`authorization`, `x-session-cookie`, `x-payment`, `x-agent-api-key`, `x-api-key`) forward khi cookie vắng. `lib/session.ts`/`lib/proxy.ts` **framework-free** — parse raw `cookie` header từ `Request` (Next `cookies()` cần request scope → phá unit-test runtime-free).

### AD-3 — Realtime Transport: socket.io-client Direct (deferred to Story 48.4)

- **Binds:** `apps/web/lib/realtime.ts` (future), `api/realtime/socketHandler.js`
- **Prevents:** mỗi màn tự chọn transport; ws upgrade fragile qua route handler
- **Rule:** socket.io-client connect DIRECT tới `NEXT_PUBLIC_SOCKET_URL` — KHÔNG qua BFF. Auth gap đã biết: `io.use` chỉ đọc `socket.handshake.auth.token` (`socketHandler.js:88`) trong khi JWT sống trong httpOnly cookie → quyết khi implement màn realtime đầu tiên: **(a)** extend `io.use` parse `socket.handshake.headers.cookie` (backend change nhỏ, được phép trong story đó), hoặc **(b)** BFF cấp short-lived socket token endpoint. SSE (`/metrics/stream`, a2a) đi qua BFF bình thường. Deferred entry: `deferred-work.md` (2026-09-24).

### AD-4 — Component System: Hand-rolled Tailwind + Lucide (shadcn không cài)

- **Binds:** `apps/web/app/**`, `apps/web/components/**`
- **Prevents:** spec thực tế trái nhau — Epic 47 spec nói Shadcn/UI nhưng `package.json` không có `@radix-ui`/`components/ui`
- **Rule:** Giữ hand-rolled components (`tailwind-merge` + `clsx` + `lucide-react`) đã có cho toàn Epic 48; màn mới reuse `components/{sidebar,header}` pattern. Nếu một màn thật sự cần primitive phức tạp (combobox, dialog nâng cao), cài shadcn trong story đó và ghi addendum vào spine này — không cài sẵn "phòng khi cần".

### AD-5 — Single Router: App Router only, xóa `pages/` shim

- **Binds:** `apps/web/pages/` (xóa), `apps/web/app/layout.tsx`
- **Prevents:** dual-router hybrid state (Pages `_app.tsx`/`_document.tsx` chỉ tồn tại để workaround CSS bundle — commit `34ee8909`)
- **Rule:** `pages/` được xóa trong Story 48.1; `app/layout.tsx:2` đã import `globals.css`. Regression gate: `next build` xanh + CSS load đúng trên mọi màn migrated. Không thêm file vào `pages/` nữa.

### AD-6 — Migration Scope: App Screens Only, Marketing Pages Out

- **Binds:** `epics.md#epic-48`, `dashboard/`
- **Prevents:** scope creep — ~20/51 file HTML là marketing/static (index, about, blog, faq, pricing, terms, privacy, features, team, tutorials…), không phải app screens
- **Rule:** Epic 48 migrate **~28 màn app** (admin, monitor, status, run, benchmark, osint, graph, analytics*, price-correlation, workflows, automations, scheduler, calendar, thread*, video, ai*, a2a, jev-test, mcp, agent, platform, playground, extension, facebook, unfollowers, login, security). Marketing pages giữ ở `dashboard/` (hoặc static site riêng sau) — FR-125 chỉ đóng khi **app screens** hết legacy, marketing pages được record là exception trong epic gate.

### AD-7 — Parallel-Run & Decommission

- **Binds:** `dashboard/`, `api/server.js` static mounts
- **Prevents:** big-bang cutover, mất chỗ fallback khi màn mới chưa parity
- **Rule:** `dashboard/` tiếp tục serve trong suốt Epic 48; mỗi screen story phải nêu parity checklist (endpoints covered, realtime events, exports). Decommission theo từng màn — xóa `dashboard/<name>.html` + JS tương ứng chỉ sau khi Next equivalent verified trên production-like run. Story 48.10 là gate cuối: remove phần app còn lại, update `server.js` static routes, đóng FR-125.

### AD-8 — Testing: Root Vitest + Playwright, NFR-20 Zero Mocks

- **Binds:** `tests/web/**`, `tests/playwright/web-*.e2e.spec.js`, `vitest.config.js`, `playwright.config.js`
- **Prevents:** `apps/web` hiện không có test infra — màn migrated không có coverage = regression mù
- **Rule:** Unit/integration tests sống trong `tests/web/*.test.js` (root vitest, node env, include `tests/**/*.test.js`) — libs framework-free nên invoke trực tiếp được. E2E trong `tests/playwright/web-*.e2e.spec.js` (match `testMatch` hiện có) — yêu cầu backend `:3001` + `next start` `:3000` đang chạy (convention hiện hữu: server assumed running). Mỗi screen story phải kèm ≥1 playwright spec cho happy path của màn đó.

## Traceability

| AD | Story chịu binding chính |
| --- | --- |
| AD-1, AD-2, AD-5, AD-8 | Story 48.1 (spec đã approve) |
| AD-2 | Story 48.2 (Auth/Session UI) |
| AD-3 | Story 48.4 (Ops realtime — socket auth quyết tại đây) |
| AD-4, AD-6, AD-7 | Toàn bộ screen waves 48.3–48.10 |
