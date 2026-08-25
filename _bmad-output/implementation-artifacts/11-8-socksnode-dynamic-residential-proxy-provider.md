# Story 11.8: SocksNode Dynamic Residential Proxy Provider

**Story ID:** 11.8  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** ready-for-dev  
**Owner:** TEA (ATDD) & DEV  
**Source:** `epics.md` Epic 11, `ARCHITECTURE-SPINE.md` AD-3 & AD-15, existing `src/proxy/providers.js`, `src/proxy/proxy-pool.js`.

---

## User Story

As a **Scale-Out Data Engineer & Proxy Administrator**,  
I want **hệ thống hỗ trợ preset nhà cung cấp SocksNode trong `DynamicTunnelProvider` và `ProxyIpPool` với đầy đủ geo-targeting (quốc gia, thành phố), sticky session per account và SOCKS5/HTTP tunnel**,  
So that **các crawler cào dữ liệu tại Việt Nam và quốc tế có thể xoay IP dân cư (Dynamic Residential) hoặc giữ IP ổn định với độ trễ thấp và tỷ lệ sống cao (>99%) mà không bị lộ IP gốc**.

---

## Acceptance Criteria

### AC-1: SocksNode Preset Registration & Gateway Parsing
* **Given** gateway URL dạng `http://username:password@gate.socksnode.com:8080` hoặc `socks5://username:password@gate.socksnode.com:1080`
* **When** khởi tạo `DynamicTunnelProvider({ gatewayUrl, provider: 'socksnode' })`
* **Then** hệ thống nhận diện `provider === 'socksnode'`, parse đúng scheme (`http`, `socks5`), host, port, username, password gốc.
* **And** `PROVIDER_PRESETS` trong `src/proxy/providers.js` bao gồm `'socksnode'`.
* **And** `PROVIDER_SID_LIMITS.socksnode` định nghĩa ràng buộc session ID (`max: 32`, regex: `/^[a-zA-Z0-9_-]+$/`).

### AC-2: Geo-Targeting & Session Parameter Formatting
* **Given** `ProxyRequestOptions` chứa `{ country, city, state, sessionId, sessionDurationMs, lifetime }`
* **When** gọi `provider.getProxy(options)` hoặc `provider.getNext()`
* **Then** hệ thống định dạng username theo chuẩn SocksNode:
  - Nếu có `country`: nối `-country-{code}` (ví dụ `-country-vn`)
  - Nếu có `city`: nối `-city-{city}` (ví dụ `-city-hanoi`)
  - Nếu có `sessionId`: nối `-session-{sid}`
  - Nếu có `lifetime` / `sessionDurationMs`: nối `-lifetime-{minutes}` hoặc `-duration-{seconds}`
* **And** nếu gọi `getStickyProxy(accountId)`: tự động sinh session ID ổn định ánh xạ 1:1 từ `accountId` (dùng deterministic hash) với thời gian sống `sessionDurationMs` (mặc định 10 phút).

### AC-3: Multi-Protocol SOCKS5 & HTTP Proxy Agent Integration
* **Given** một proxy URL được format từ SocksNode (scheme `socks5` hoặc `http`)
* **When** gọi `provider.getProxyAgent(proxy)`
* **Then** với scheme `socks5`: trả về `Socks5ProxyAgent` từ `undici` hoặc `socks-proxy-agent` tương thích.
* **And** với scheme `http`/`https`: trả về `ProxyAgent` từ `undici`.
* **And** không bao giờ fallback về direct connection khi proxy agent gặp lỗi (AD-3).

### AC-4: Playwright & Browser Argument Compatibility
* **Given** một proxy SocksNode
* **When** gọi `provider.toPlaywrightProxy(proxy)` hoặc `provider.getBrowserArgs(proxy)`
* **Then** `toPlaywrightProxy` trả về `{ server: 'socks5://host:port' | 'http://host:port', username, password }`.
* **And** `getBrowserArgs` trả về mảng flags chứa `--proxy-server=...` và `--force-webrtc-ip-handling-policy=disable_non_proxied_udp`.

### AC-5: Auto-Quarantine, Standby Backoff & Pool Health Metrics
* **Given** proxy SocksNode bị lỗi 403, 429 hoặc connection refused
* **When** gọi `provider.quarantine(proxy, durationMs)`
* **Then** proxy bị cách ly vào `failedProxies` trong `durationMs` (mặc định 5 phút).
* **And** `isAllQuarantined()` trả về `true` khi toàn bộ gateway/proxies bị cách ly, kích hoạt Standby Backoff 30s.
* **And** `healthyCount()` và `totalCount()` phản ánh chính xác trạng thái pool.

---

## Tasks / Subtasks

- [ ] **Task 1: SocksNode Preset in Providers Module**
  - [ ] 1.1 Thêm `'socksnode'` vào `PROVIDER_PRESETS` và `PROVIDER_SID_LIMITS`.
  - [ ] 1.2 Triển khai logic format credentials/username cho SocksNode trong `DynamicTunnelProvider.prototype.formatUsername` / `buildProxyUrl`.
  - [ ] 1.3 Hỗ trợ SOCKS5 scheme mapping và remote DNS resolution.
- [ ] **Task 2: SOCKS5 Agent & Protocol Handling**
  - [ ] 2.1 Cập nhật `getProxyAgent(proxy)` khởi tạo `Socks5ProxyAgent` an toàn khi `scheme === 'socks5'`.
  - [ ] 2.2 Tích hợp browser arguments & Playwright config cho SocksNode.
- [ ] **Task 3: Integration with ProxyIpPool**
  - [ ] 3.1 Hỗ trợ `ProxyIpPool({ providers: [socksNodeProvider] })`.
  - [ ] 3.2 Tương thích sticky proxy theo `accountId` và rotation `getNext()`.
- [ ] **Task 4: TypeScript Definitions**
  - [ ] 4.1 Cập nhật `types/proxy.d.ts` và `src/proxy/providers.d.ts` với preset `'socksnode'`.
- [ ] **Task 5: ATDD & Unit Test Verification**
  - [ ] 5.1 Xây dựng `tests/proxy/socksnode-provider.test.js` kiểm thử toàn diện các ACs.

---

## File List

* `src/proxy/providers.js` (UPDATE)
* `src/proxy/providers.d.ts` (UPDATE)
* `src/proxy/index.d.ts` (UPDATE)
* `types/proxy.d.ts` (UPDATE or NEW)
* `tests/proxy/socksnode-provider.test.js` (NEW)
