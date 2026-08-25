# Story 13.1 — Tiered Signer Architecture: Pre-Signed Token Ring & Worker Page Pool

**Story ID:** 13-1  
**Epic:** 13 — High-Throughput Hybrid Scraping Engine (Twitter & Facebook Refactor)  
**Status:** done  
**Owner:** DEV  
**Baseline commit:** `5cb22cf` (HEAD sau khi Story 11.8 SocksNode review patches được merge)  
**Source:**
- `_bmad-output/planning-artifacts/epics.md` Epic 13, Story 13.1
- `_bmad-output/planning-artifacts/prd.md` FR-65
- `_bmad-output/planning-artifacts/architecture/xactions-hybrid-scraping-spine/ARCHITECTURE-SPINE.md` AD-1, AD-2, AD-3, AD-14
- `src/core/signer-pool.js` (stub sẵn tại dòng 8–94)
- `src/core/base-client.js` (AbstractApiClient, phương thức `request` dòng 232–472)
- `types/core.d.ts` (khai báo PreSignedTokenRing / SignerWorkerPagePool dòng 343–355)
- `package.json` got-scraping `^3.2.15`, undici `^7.29.0`, playwright `^1.62.1`, puppeteer `^24.34.0`, p-limit `^7.2.0`

**Cross-Epic Dependencies:**
- Phụ thuộc vào **Epic 10** (core interfaces, error envelope, types), **Epic 11** (ProxyIpPool, getProxyAgent cho `got`/`undici`, auto-quarantine), **Epic 12.2** (CDP/adapter contract để launch/attach browser cho worker page pool).
- Unblocks **Story 13.2** (Twitter GraphQL + x-client-transaction-id), **Story 13.3** (Facebook GraphQL DocID + lsd/fb_dtsg), **Story 15.2** (TikTok a_bogus / X-Bogus), **Story 16.1** (Shopee TLS spoofing).

---

```yaml
baseline_commit: 5cb22cf
```

---

## Story

As a **Power User / AI Agent**,  
I want **hệ thống ký request phân tầng: vòng token đã ký trước O(1) cho session token (`msToken`, `lsd`, `fb_dtsg`) và worker page pool 4–8 tab để ký động (`a_bogus`, `x-client-transaction-id`)**,  
so that **XActions tăng tốc độ 5–10x, giảm RAM ≥85% và có thể cào đồng thời hàng trăm request mà không bị nghẽn Chromium IPC hoặc treo vĩnh viễn khi tab signer crash**.

---

## Acceptance Criteria

### AC-1: PreSignedTokenRing O(1) token allocation

* **Given** `PreSignedTokenRing` được khởi tạo với `capacity` mặc định `50`
* **When** gọi `ring.refill(tokens)` với một mảng token rồi gọi `ring.next()` nhiều lần
* **Then** mỗi lần `next()` trả về token trong < 0.1ms và độ phức tạp là O(1)
* **And** token được cấp theo thứ tự round-robin, tự động quay vòng khi hết mảng
* **And** số lượng token hiện có có thể đọc qua `ring.size`
* **And** `refill()` cắt mảng đầu vào theo `capacity` và reset chỉ số về `0`

### AC-2: SignerWorkerPagePool — 4–8 background pages, circuit breaker, timeout

* **Given** `SignerWorkerPagePool` được khởi tạo với `minSize` (mặc định `4`) và `maxSize` (mặc định `8`)
* **When** gọi `await pool.init()`
* **Then** pool mở đúng `minSize` trang ngầm qua adapter (`playwright`/`puppeteer`) và giữ chúng ở trạng thái idle
* **And** mỗi trang được gán một `load` counter và `state: 'idle' | 'busy' | 'dead'`
* **When** gọi `await pool.evaluate(script, args)`
* **Then** pool chọn trang theo thuật toán **Least-Connections** (trang có `load` thấp nhất và `state !== 'dead'`)
* **And** lệnh `evaluate` được bọc trong `Promise.race` với timeout mặc định `3000ms`
* **And** nếu là lần warmup (`payload.warmup === true` hoặc `init()`), timeout là `8000ms`
* **And** nếu timeout hoặc page crash, đánh dấu page `dead`, tự động spawn page mới (nếu chưa đạt `maxSize`) và retry trên trang khác tối đa 1 lần
* **And** nếu tất cả trang đều `dead` hoặc vượt quá `maxSize`, throw `PlatformError` với `type: 'internal'`, `code: 'XACT_5000'`, `suggestedAction: 'retry_after_delay'`
* **When** gọi `await pool.close()`
* **Then** tất cả page được đóng và (tùy chọn) browser cũng được đóng

### AC-3: AbstractApiClient.requestWithSign dispatches to ring or page pool

* **Given** `AbstractApiClient` được khởi tạo với `tokenRing` hoặc `signerPool`
* **When** gọi `await client.requestWithSign(method, url, payload, options)` trong `src/core/base-client.js`
* **Then** nếu `payload.signType === 'token'` và `client.tokenRing` tồn tại, client lấy token từ `tokenRing.next()` và inject vào request theo `payload.location` (`'header' | 'query' | 'cookie`)
* **And** nếu `payload.signType === 'page'` và `client.signerPool` tồn tại, client gọi `signerPool.evaluate(payload.script, payload.args, payload.timeoutMs)` và merge kết quả vào request
* **And** nếu không có ring/pool, `requestWithSign` fallback về `await this.sign(payload)` (phương thức abstract/subclass)
* **And** sau khi có kết quả ký, `requestWithSign` gọi `this.request(method, resolvedUrl || url, mergedOptions)` để chạy qua pipeline proxy/quarantine/retry hiện có

### AC-4: AbstractApiClient.request pipeline không bị thay đổi

* **Given** toàn bộ test `tests/core/base-client-request.test.js` đang pass
* **When** cài đặt `requestWithSign` và tích hợp signer
* **Then** mọi AC-1 đến AC-9 của Story 11.3 vẫn pass (proxy quarantine, exponential replay, account rotation, governor, pluggable transport)
* **And** `request()` không được trộn `got-scraping` và `undici` trong cùng một request pipeline

### AC-5: Default HTTP client factory cho `got-scraping` và `undici.fetch()`

* **Given** `AbstractApiClient` được khởi tạo với `client: 'undici'` hoặc `client: 'got'` mà không truyền `httpClient`
* **When** `request()` thực thi
* **Then** nếu `client === 'undici'`, sử dụng `undici.request()` hoặc `undici.fetch()` với `dispatcher: agent` (agent lấy từ `getProxyAgent(proxy, { client: 'undici' })`)
* **And** nếu `client === 'got'`, sử dụng `got-scraping` với `proxyUrl` lấy từ `getProxyAgent(proxy, { client: 'got' })` (trả về string), bật `headerGeneratorOptions` nếu cần TLS/JA4 spoofing
* **And** default factory trả về response shape `{ status, headers, data }` để `AbstractApiClient.request()` xử lý rate-limit/bot-challenge như cũ

### AC-6: Đồng bộ cookie từ token ring / page pool

* **Given** `AbstractApiClient` có `cookies` object
* **When** token ring inject token vào cookie (`payload.location === 'cookie'`)
* **Then** `client.updateCookies()` được gọi và `request()` tự động build header `Cookie` từ `this.cookies` trước khi gọi `httpClient`
* **And** page pool trả về `cookies` trong sign result cũng được merge vào `this.cookies`

### AC-7: Khai báo TypeScript vào `types/core.d.ts`

* **Given** `types/core.d.ts` đã khai báo `AbstractApiClient`, `AbstractCrawler`, `PreSignedTokenRing`, `SignerWorkerPagePool`
* **When** cài đặt story
* **Then** thêm `SignPayload`, `SignResult`, `requestWithSign`, `tokenRing`, `signerPool` vào constructor options của `AbstractApiClient`
* **And** cập nhật `PreSignedTokenRing` / `SignerWorkerPagePool` declarations để khớp implementation mới
* **And** `npm run typecheck` phải pass

### AC-8: Kiểm thử thực (no mocks)

* **Given** `vitest` là test runner
* **When** chạy `npm test`
* **Then** tạo file `tests/core/signer-pool.test.js` test `PreSignedTokenRing` và `SignerWorkerPagePool`
* **And** tạo file `tests/core/base-client-sign.test.js` test `requestWithSign` dispatch thông qua token ring / worker page pool với local HTTP server thật
* **And** mọi test suite cũ vẫn pass, đặc biệt `tests/core/base-client-request.test.js`

---

## Technical Requirements

### 1. `PreSignedTokenRing` (`src/core/signer-pool.js`)

Stub hiện tại đã có `constructor`, `refill`, `next`, `size`. Cần hoàn thiện:

```js
export class PreSignedTokenRing {
  /** @type {string[]} */
  #tokens = [];
  /** @type {number} */
  #capacity = 50;
  /** @type {number} */
  #index = 0;

  constructor(options = {}) {
    this.#capacity = options.capacity ?? 50;
  }

  refill(tokens) {
    this.#tokens = tokens.slice(0, this.#capacity);
    this.#index = 0;
  }

  next() {
    if (this.#tokens.length === 0) return null;
    const token = this.#tokens[this.#index % this.#tokens.length];
    this.#index = (this.#index + 1) % this.#tokens.length;
    return token;
  }

  get size() { return this.#tokens.length; }
  get capacity() { return this.#capacity; }
  get isEmpty() { return this.#tokens.length === 0; }
}
```

Yêu cầu bổ sung:
- `capacity` được giới hạn khi `refill`, không tự resize khi `next`.
- `next()` là O(1) và synchronous; không await.
- Tất cả property public đều có JSDoc.
- Không lưu token vào log/error message để tránh leak.

### 2. `SignerWorkerPagePool` (`src/core/signer-pool.js`)

Stub hiện tại có `constructor`, `init`, `evaluate`, `close`. Cần implement đầy đủ.

Giao diện adapter duck-typing (core không import `src/scrapers/adapters/base.js` để tránh circular dependency):

```ts
interface PageAdapter {
  newPage(browser: any, options?: Record<string, unknown>): Promise<any>;
  evaluate(page: any, fn: string | Function, ...args: unknown[]): Promise<unknown>;
  closePage(page: any): Promise<void>;
  closeBrowser?(browser: any): Promise<void>;
}
```

Constructor:

```js
new SignerWorkerPagePool({
  minSize = 4,
  maxSize = 8,
  defaultTimeoutMs = 3000,
  warmupTimeoutMs = 8000,
  browser,           // AdapterBrowser object (từ adapter.launch/connect)
  adapter,           // object có newPage/evaluate/closePage
  pageOptions = {},  // truyền vào adapter.newPage()
  warmupScript,      // script chạy sau khi newPage() trong init()
  warmupArgs = [],
});
```

Thiết kế chi tiết:
- Mỗi worker là một object `{ page, state, load }`, `state ∈ { idle, busy, dead }`, `load` là số evaluate đang chạy.
- `init()` tạo `minSize` pages song song (dùng `p-limit` hoặc `Promise.all`). Nếu `warmupScript` tồn tại, chạy `warmupScript` trên mỗi page với `warmupTimeoutMs`.
- `evaluate(script, args, timeoutMs?)`:
  1. Chọn worker có `state !== 'dead'`, `load` thấp nhất (Least-Connections).
  2. Nếu không có worker healthy:
     - Nếu số worker hiện tại < `maxSize`, spawn thêm một worker.
     - Nếu đã đạt `maxSize` và không healthy, throw `PlatformError`.
  3. Mark worker `busy`, `load += 1`.
  4. Chạy `Promise.race([ adapter.evaluate(page, script, ...args), sleep(timeout) ])`.
  5. Khi thành công: `load -= 1`, mark `idle`, trả về result.
  6. Khi timeout/error: mark worker `dead`, `load = 0`, gọi `adapter.closePage(page)`. Spawn replacement (nếu < `maxSize`) và retry **tối đa 1 lần**. Nếu retry cũng lỗi, throw `PlatformError` với `cause` là lỗi gốc.
- `close()`:
  - Dừng nhận evaluate mới.
  - Đợi các evaluate đang chạy hoàn thành (hoặc timeout).
  - Đóng tất cả page qua `adapter.closePage`.
  - Nếu `browser` được truyền vào, gọi `adapter.closeBrowser?.(browser)` (hoặc để caller tự đóng nếu `options.closeBrowser === false`).
- Cung cấp getter: `healthySize`, `busyCount`, `deadCount`, `isHealthy`.

### 3. `AbstractApiClient.requestWithSign` (`src/core/base-client.js`)

Thêm constructor options:

```js
constructor(options = {}) {
  // ... hiện có ...
  this.tokenRing = options.tokenRing ?? null;
  this.signerPool = options.signerPool ?? null;
  // Nếu httpClient không được truyền, dùng factory mặc định theo this.client
  this.httpClient = options.httpClient ?? createDefaultHttpClient(this.client);
}
```

Payload shape:

```ts
type SignPayload =
  | {
      signType: 'token';
      tokenType?: string;        // 'msToken' | 'lsd' | 'fb_dtsg' | ...
      location?: 'header' | 'query' | 'cookie';
      fieldName?: string;        // tên header/query key/cookie name
    }
  | {
      signType: 'page';
      script: string | ((...args: unknown[]) => unknown);
      args?: unknown[];
      timeoutMs?: number;
      warmup?: boolean;
      resultField?: string;      // nếu page trả về string, header name mặc định
    }
  | Record<string, unknown>;     // fallback cho subclass sign()
```

Resolve sign:

```js
async #resolveSign(payload) {
  if (payload?.signType === 'token' && this.tokenRing) {
    const token = this.tokenRing.next();
    if (!token) throw new PlatformError({ type: ErrorTypes.INTERNAL, code: 'XACT_5000', message: 'Token ring exhausted', suggestedAction: SuggestedActions.RETRY_AFTER_DELAY, platform: this.platform });
    const field = payload.fieldName || 'x-token';
    const location = payload.location || 'header';
    if (location === 'header') return { headers: { [field]: token } };
    if (location === 'cookie') return { cookies: { [field]: token } };
    if (location === 'query') {
      const u = new URL(payload.url); // payload.url bắt buộc khi query
      u.searchParams.set(field, token);
      return { url: u.toString() };
    }
  }

  if (payload?.signType === 'page' && this.signerPool) {
    const timeout = payload.warmup ? this.signerPool.warmupTimeoutMs : (payload.timeoutMs ?? this.signerPool.defaultTimeoutMs);
    const result = await this.signerPool.evaluate(payload.script, payload.args ?? [], timeout);
    if (result && typeof result === 'object') {
      return result; // { headers, body, url, cookies }
    }
    if (typeof result === 'string') {
      return { headers: { [payload.resultField || 'x-signature']: result } };
    }
    return {};
  }

  // Fallback to subclass sign()
  return this.sign(payload);
}
```

`requestWithSign`:

```js
async requestWithSign(method, url, payload, options = {}) {
  let signResult;
  try {
    signResult = await this.#resolveSign({ ...payload, url });
  } catch (err) {
    throw new PlatformError({
      type: ErrorTypes.INTERNAL,
      code: 'XACT_5000',
      message: `Signer resolution failed: ${err.message}`,
      suggestedAction: SuggestedActions.RETRY_AFTER_DELAY,
      platform: this.platform,
      cause: err,
    });
  }

  const opts = { ...options };
  if (signResult.headers) {
    opts.headers = { ...opts.headers, ...signResult.headers };
  }
  if (signResult.body !== undefined) {
    opts.body = opts.body ? { ...opts.body, ...signResult.body } : signResult.body;
  }
  if (signResult.url) {
    url = signResult.url;
  }
  if (signResult.cookies) {
    this.updateCookies(signResult.cookies);
  }

  // Ensure Cookie header is set if cookies object not empty
  const cookieHeader = this.#buildCookieHeader();
  if (cookieHeader) {
    opts.headers = { ...opts.headers, cookie: cookieHeader };
  }

  return this.request(method, url, opts);
}

#buildCookieHeader() {
  const entries = Object.entries(this.cookies);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('; ');
}
```

`AbstractApiClient.sign(payload)` vẫn giữ là abstract hook (throw mặc định), subclass như `TwitterHttpClient` (Story 13.2) sẽ override.

### 4. Default HTTP client factory (`src/core/http-client-factory.js`)

Tạo module mới, export `createDefaultHttpClient(clientType)`.

`clientType === 'undici'`:

```js
import { request as undiciRequest } from 'undici';

function createUndiciClient() {
  return async ({ method, url, headers, body, agent }) => {
    const res = await undiciRequest(url, { method, headers, body, dispatcher: agent });
    const text = await res.body.text();
    return { status: res.statusCode, headers: res.headers, data: safeJsonParse(text) };
  };
}
```

`clientType === 'got'`:

```js
import { gotScraping } from 'got-scraping';

function createGotClient() {
  return async ({ method, url, headers, body, proxy }) => {
    const res = await gotScraping({
      url,
      method,
      headers,
      body,
      proxyUrl: typeof proxy === 'string' ? proxy : undefined,
      headerGeneratorOptions: { browsers: [{ name: 'chrome' }] },
      throwHttpErrors: false,
      timeout: { request: 60000 },
    });
    const text = res.body?.toString?.() ?? '';
    return { status: res.statusCode, headers: res.headers, data: safeJsonParse(text) };
  };
}
```

Lưu ý:
- `body` object cần JSON.stringify trước khi truyền; default factory tự stringify nếu `typeof body === 'object'` và `headers['content-type']` chứa `json`.
- `safeJsonParse` giống helper trong `tests/core/base-client-request.test.js`.
- Cấu hình `got-scraping` phải tôn trọng proxy string từ `getProxyAgent(proxy, { client: 'got' })`.

### 5. Cookie serialization in `AbstractApiClient.request`

Nếu `this.cookies` không rỗng và `options.headers.cookie` chưa được set, tự động thêm `Cookie` header. Đảm bảo `updateCookies` từ page ring/pool được serialize.

---

## Architecture Compliance

### AD-1 — Tiered Hybrid Signer Architecture

- `PreSignedTokenRing` đáp ứng Tier 1: mảng đệm 50 token, cấp phát O(1).
- `SignerWorkerPagePool` đáp ứng Tier 2: 4–8 tab ngầm, phân phối Least-Connections, `Promise.race` timeout 3s / 8s warmup, tự động spawn lại khi page chết.
- `createDefaultHttpClient` đáp ứng Rule 4: chọn **một** runtime duy nhất `got` hoặc `undici`, không trộn.

### AD-2 — Unified Base Scraper & Client Interfaces

- `AbstractApiClient` vẫn là contract platform-agnostic.
- `requestWithSign` là phương thức mới trên `AbstractApiClient`; platform-specific clients chỉ cần override `sign()` hoặc cấu hình `tokenRing` / `signerPool`.
- Không đưa logic `x-client-transaction-id` hay `a_bogus` vào `src/core`; chúng thuộc Story 13.2/13.3/15.2.

### AD-3 — Centralized Proxy IP Pool

- `requestWithSign` **phải đi qua** `this.request()` để reuse `resolveProxy`, `getProxyAgent`, quarantine, governor, retry.
- `getProxyAgent(proxy, { client: 'got' })` đã trả về `proxyUrl` string; `getProxyAgent(proxy, { client: 'undici' })` trả về `ProxyAgent`/`Socks5ProxyAgent`.
- Không được fallback về direct connection khi proxy agent fail.

### AD-14 — Operational Status & Error Envelope

- Mọi lỗi từ signer (timeout, dead page, ring empty) phải trả về `PlatformError` với `code`, `type`, `suggestedAction`.
- `SignerWorkerPagePool` lỗi: `type: 'internal'`, `code: 'XACT_5000'`, `suggestedAction: 'retry_after_delay'`.
- Token ring empty: `type: 'internal'`, `code: 'XACT_5000'`, `suggestedAction: 'retry_after_delay'`.

---

## Library & Framework Requirements

| Package | Version trong `package.json` | Mục đích |
|---|---|---|
| `got-scraping` | `^3.2.15` | HTTP client mặc định cho `client: 'got'`, TLS/JA4 spoofing, header generator, proxy support qua `proxyUrl`. |
| `undici` | `^7.29.0` | HTTP client cho `client: 'undici'`, hỗ trợ `ProxyAgent`, `Socks5ProxyAgent` làm `dispatcher`. |
| `playwright` | `^1.62.1` | Browser engine cho `SignerWorkerPagePool` (không import static trong `src/core`, chỉ dùng qua adapter). |
| `puppeteer` | `^24.34.0` | Thay thế cho Playwright khi `XACTIONS_SCRAPER_ADAPTER=puppeteer`. |
| `p-limit` | `^7.2.0` | Giới hạn concurrency khi init/spawn page. |
| `vitest` | `^4.0.18` | Test framework. |
| `typescript` | `^5.9.3` | `npm run typecheck`. |

### got-scraping usage notes (theo Context7 / package hiện tại)

- Import: `import { gotScraping } from 'got-scraping';`.
- Request: `await gotScraping({ url, method, headers, body, proxyUrl, headerGeneratorOptions: { browsers: [{ name: 'chrome' }] } })`.
- `throwHttpErrors: false` để `AbstractApiClient` tự xử lý status.
- `sessionToken` object giữ header ổn định giữa các request trong cùng phiên.

### undici usage notes

- Import: `import { request, fetch, ProxyAgent, Socks5ProxyAgent } from 'undici';`.
- Proxy: truyền `dispatcher: agent` vào `request()` hoặc `fetch()`.
- `request()` trả về `{ statusCode, headers, body }`; dùng `await body.text()`.

---

## File Structure

### UPDATE (đã tồn tại, cần mở rộng)

| File | Mô tả thay đổi |
|---|---|
| `src/core/signer-pool.js` | Hoàn thiện `PreSignedTokenRing` và `SignerWorkerPagePool`; giữ export hiện có. |
| `src/core/base-client.js` | Thêm `tokenRing`, `signerPool` vào constructor; thêm `requestWithSign`, `#resolveSign`, `#buildCookieHeader`; mặc định `httpClient` từ factory. |
| `src/core/index.js` | Export thêm `createDefaultHttpClient`. |
| `types/core.d.ts` | Thêm `SignPayload`, `SignResult`, `requestWithSign`, cập nhật constructor options của `AbstractApiClient`, `PreSignedTokenRing`, `SignerWorkerPagePool`. |

### CREATE

| File | Mô tả |
|---|---|
| `src/core/http-client-factory.js` | Factory tạo default `httpClient` cho `undici` và `got-scraping`; trả về uniform `{ status, headers, data }`. |
| `tests/core/signer-pool.test.js` | Tests cho token ring (O(1), refill, wrap) và worker page pool (init, evaluate, timeout, retry, close). |
| `tests/core/base-client-sign.test.js` | Tests `requestWithSign` dispatch token/page + integration với local server + real proxy (tương tự pattern Story 11.3). |

### NO TOUCH

| File | Lý do |
|---|---|
| `src/proxy/providers.js` | `getProxyAgent` đã hỗ trợ `client: 'got'` và `client: 'undici'`; không cần sửa. |
| `src/core/base-crawler.js` | Chỉ cần pass `client` (đã có); không thay đổi logic `start()`. |
| `src/scrapers/twitter/http/client.js` | Thuộc Story 13.2; không sửa trong 13.1. |
| `src/scrapers/facebook/core.js` | Thuộc Story 13.3; không sửa trong 13.1. |

---

## Testing Requirements

### `tests/core/signer-pool.test.js`

#### PreSignedTokenRing

- `next()` trả về token theo thứ tự refill.
- Sau khi hết mảng, `next()` quay vòng về token đầu tiên.
- `refill()` cắt mảng vượt `capacity`.
- `size` cập nhật sau `refill`.
- Đo thời gian `next()` < 0.1ms với 1000 lần gọi (nên dùng `process.hrtime` hoặc `performance.now`).

#### SignerWorkerPagePool

- Dùng real Playwright headless (skip nếu `await new PlaywrightAdapter().checkDependencies()` unavailable).
- `init()` mở đúng `minSize` page.
- `evaluate(script, args)` trả về kết quả đúng.
- Timeout: script `() => new Promise(r => setTimeout(r, 10000))` với `timeoutMs = 500` phải throw timeout.
- Dead page / retry: đóng page đang chạy evaluate thủ công và kiểm tra pool tự spawn lại.
- `close()` đóng sạch page, không để resource leak.
- `healthySize`, `busyCount`, `deadCount` cập nhật đúng.

### `tests/core/base-client-sign.test.js`

- Tái sử dụng pattern real HTTP server & proxy từ `tests/core/base-client-request.test.js`.
- Test subclass `TestApiClient extends AbstractApiClient` với `client: 'undici'`, `httpClient: defaultHttpClient`.
- AC-1: `requestWithSign('GET', url, { signType: 'token', fieldName: 'x-test-token' })` inject header `x-test-token` từ PreSignedTokenRing; upstream kiểm tra header.
- AC-2: `requestWithSign('GET', url, { signType: 'page', script: () => ({ 'x-sig': 'abc' }) })` inject header `x-sig` qua SignerWorkerPagePool.
- AC-3: `requestWithSign` vẫn đi qua proxy quarantine pipeline (tạo 429 1 lần rồi 200, proxy bị quarantine, request retry thành công).
- AC-4: Cookie injection: `payload.location === 'cookie'` update `client.cookies` và `Cookie` header được gửi lên.

### Regression

- Chạy `npm test` — toàn bộ suite phải pass.
- Riêng `tests/core/base-client-request.test.js` phải pass mà không cần chỉnh sửa.
- `npm run typecheck` phải pass.

---

## Previous Story Intelligence

### Story 12.2 (CDP Remote Attach)

- Adapter contract (`BaseAdapter.newPage`, `evaluate`, `closePage`, `closeBrowser`) là cách đúng để `src/core` dùng Playwright/Puppeteer mà không hard-code framework.
- `PlaywrightAdapter.newPage` với `preserveProfile: true` dùng context/page hiện có (dòng 85–93 `src/scrapers/adapters/playwright.js`).
- CDP attach dùng `chromium.connectOverCDP` / `puppeteer.connect`.
- Không spawn Chrome mới khi đã có endpoint trên port.

### Story 11.8 (SocksNode Provider)

- Constants nên `Object.freeze()` hoặc dùng helper `freezeSet`.
- Credentials phải redact trong `toJSON()`.
- Kiểm tra TLD auto-detection phải hạn chế (`.com`).
- Tests dùng `toMatch` / `toBe` thay vì `toContain` để kiểm tra format chính xác.

### Story 11.3 (AbstractApiClient Request Pipeline)

- `AbstractApiClient.request` pipeline đã rất ổn định: 429/403 quarantine, exponential backoff, account rotation, governor, `httpClient` pluggable.
- Tests dùng real `node:http` upstream + real forward proxy + `undici` — **no mocks**.
- `httpClient` nhận `{ method, url, headers, body, proxy, agent, accountId }`.

---

## Git Intelligence Summary

- Commit gần nhất trên `main`: `5cb22cf fix(review): apply Story 11.8 SocksNode post-review patches`.
- Các file core (`src/core/base-client.js`, `src/core/base-crawler.js`, `src/core/signer-pool.js`, `types/core.d.ts`) đã ổn định.
- `src/core/signer-pool.js` đã có stub `PreSignedTokenRing` / `SignerWorkerPagePool` cần implement.
- Không có merge conflict dự kiến vì story này thêm phương thức mới vào `AbstractApiClient` thay vì sửa logic `request()`.

---

## Latest Tech Information

### got-scraping

- `got-scraping` v3.2.15 extend `got-cjs` với browser-like headers, HTTP/2 negotiation, proxy qua `proxyUrl`, TLS fingerprint hook.
- Cấu hình mẫu:
  ```ts
  await gotScraping({
    url,
    method,
    headers,
    body,
    proxyUrl: 'http://user:pass@proxy:8080',
    headerGeneratorOptions: { browsers: [{ name: 'chrome' }] },
    throwHttpErrors: false,
  });
  ```
- `tlsHook` tự động match TLS fingerprint theo User-Agent; nếu truyền `https: { ciphers, minVersion }` tùy chỉnh sẽ disable auto-detection.

### undici

- Node.js 20+ built-in `fetch` dựa trên `undici`.
- `undici.request()` và `undici.fetch()` hỗ trợ `dispatcher`.
- `ProxyAgent` và `Socks5ProxyAgent` là dispatcher cho HTTP/SOCKS5 proxy.
- Mẫu:
  ```js
  import { request, ProxyAgent } from 'undici';
  const res = await request(url, { method, headers, body, dispatcher: new ProxyAgent(proxyUrl) });
  const data = await res.body.text();
  ```

### Playwright page.evaluate

- `page.evaluate(fn, ...args)` chạy `fn` trong page context; serializeable qua DevTools Protocol.
- `Promise.race` với `setTimeout` là cách đơn giản và hiệu quả để tránh treo vĩnh viễn.
- Nên tạo page trong context riêng (Playwright `browser.newContext()`) để isolate signer; `BaseAdapter.newPage` đã hỗ trợ.

### TikTok `a_bogus` / `X-Bogus`

- Theo nghiên cứu, TikTok web SDK expose `window.byted_acrawler.frontierSign(...)` để ký URL.
- `a_bogus` / `X-Bogus` là URL signer; `msToken` là session token.
- Tham khảo: `carcabot/tiktok-signature` dùng headless browser load TikTok SDK để generate.
- Worker Page Pool cần evaluate script tương tự: `window.byted_acrawler.frontierSign({ url })` và trả về signed URL.

### Twitter `x-client-transaction-id`

- Theo reverse-engineering, header này được tính bởi `ondemand.s` chunk của `main.xxxxxx.js`.
- Thuật toán sử dụng SHA-256 của `[method, path, time].join('!') + 'bird' + animationKey`, kết hợp key bytes từ DOM SVG và animation values.
- Tham khảo: `Lqm1/x-client-transaction-id` (TypeScript) và `langkor/x-client-transaction` (Rust).
- Worker Page Pool sẽ evaluate đoạn script tương tự trên page đã load `x.com` để lấy header.

---

## Project Context Reference

- `PostItem` / `CommentItem` namespaced id: không liên quan trực tiếp đến signer, nhưng `AbstractCrawler` sẽ dùng `client.requestWithSign()` trong 13.2/13.3.
- Error envelope: mọi lỗi signer phải là `PlatformError` với `code`, `type`, `suggestedAction`.
- `src/core/index.js` đã export `PreSignedTokenRing` và `SignerWorkerPagePool` (dòng 36).
- `ProxyIpPool.getStickyProxy` / `getNext` và `StaticProxyProvider` đã sẵn sàng cho `AbstractApiClient.resolveProxy`.

---

## Open Questions / Notes for Dev

1. **Default HTTP client factory location:** Nên đặt trong `src/core/http-client-factory.js` và export từ `src/core/index.js` để tránh `base-client.js` quá dài.
2. **SignerWorkerPagePool browser source:** Trong 13.1, pool nhận `browser` + `adapter` từ caller (platform client hoặc test). Story 13.2/13.3 sẽ cung cấp browser thích hợp (headless hoặc CDP attach). Không tự launch trong `src/core`.
3. **Cookie serialization:** Thêm `#buildCookieHeader()` và merge vào `request()` sẽ ảnh hưởng đến các client hiện tại nếu chúng set `Cookie` header riêng. Đảm bảo `request()` chỉ set `Cookie` khi header chưa có.
4. **No mocks in tests:** Worker page pool tests cần real Playwright/Puppeteer. Nếu CI không cài binary, dùng `await adapter.checkDependencies()` để skip.
5. **got-scraping import:** Sử dụng `import { gotScraping } from 'got-scraping';` (named import đã verify chạy được trong Node ESM).

---

## Tasks / Subtasks

- [ ] **Task 1: Hoàn thiện `PreSignedTokenRing`** (AC-1)
  - [ ] 1.1 Implement `refill`, `next`, `size`, `capacity`, `isEmpty` trong `src/core/signer-pool.js`.
  - [ ] 1.2 Đảm bảo O(1) bằng index modulo.
  - [ ] 1.3 Viết tests `tests/core/signer-pool.test.js` phần token ring.
- [ ] **Task 2: Hoàn thiện `SignerWorkerPagePool`** (AC-2)
  - [ ] 2.1 Implement worker object `{ page, state, load }`, init, least-connections selection.
  - [ ] 2.2 Implement `evaluate()` với `Promise.race` timeout, dead-page handling, retry 1 lần, spawn up to `maxSize`.
  - [ ] 2.3 Implement `close()`.
  - [ ] 2.4 Viết tests với real Playwright/Puppeteer.
- [ ] **Task 3: `AbstractApiClient.requestWithSign` và `sign` integration** (AC-3, AC-4, AC-6)
  - [ ] 3.1 Thêm `tokenRing`, `signerPool` vào `AbstractApiClient` constructor.
  - [ ] 3.2 Implement `#resolveSign`, `requestWithSign`, `#buildCookieHeader`.
  - [ ] 3.3 Merge sign result vào `options` và gọi `this.request()`.
  - [ ] 3.4 Đảm bảo cookie serialization trong `request()`.
- [ ] **Task 4: Default HTTP client factory** (AC-5)
  - [ ] 4.1 Tạo `src/core/http-client-factory.js` với `createDefaultHttpClient('undici' | 'got')`.
  - [ ] 4.2 Tích hợp factory vào `AbstractApiClient` constructor khi `httpClient` không được truyền.
  - [ ] 4.3 Kiểm tra `client: 'got'` sử dụng `proxyUrl` từ `getProxyAgent`.
  - [ ] 4.4 Kiểm tra `client: 'undici'` sử dụng `dispatcher: agent`.
- [ ] **Task 5: TypeScript declarations** (AC-7)
  - [ ] 5.1 Cập nhật `types/core.d.ts`.
  - [ ] 5.2 Chạy `npm run typecheck`.
- [ ] **Task 6: Tests & regression** (AC-8)
  - [ ] 6.1 Viết `tests/core/base-client-sign.test.js`.
  - [ ] 6.2 Chạy `npm test` và `npm run typecheck`.
  - [ ] 6.3 Đảm bảo `tests/core/base-client-request.test.js` không bị regression.

---

## Dev Agent Record

- **Model / agent:** `devin-default`
- **Story file created:** `_bmad-output/implementation-artifacts/13-1-tiered-signer-architecture-token-ring-worker-pool.md`
- **Target branch:** `main` (baseline `5cb22cf`)
- **Files expected to change:**
  - `src/core/signer-pool.js`
  - `src/core/base-client.js`
  - `src/core/http-client-factory.js` (new)
  - `src/core/index.js`
  - `types/core.d.ts`
  - `tests/core/signer-pool.test.js` (new)
  - `tests/core/base-client-sign.test.js` (new)
- **Files to avoid touching:**
  - `src/proxy/providers.js`
  - `src/scrapers/twitter/http/client.js`
  - `src/scrapers/facebook/core.js`
  - `tests/core/base-client-request.test.js` (chỉ read, không sửa)

---

## Completion Notes

Story 13.1 là nền tảng cho toàn bộ Tiered Hybrid Signer Engine. Nếu AC-1 đến AC-8 được thực hiện đúng, Story 13.2 (Twitter) và 13.3 (Facebook) chỉ cần cung cấp `script`/`tokenType` và `browser` cho `AbstractApiClient`, không cần viết lại logic proxy/quarantine/retry.
