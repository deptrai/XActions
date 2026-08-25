# Acceptance Auditor — Story 11.8 SocksNode Code Review Prompt

**Story:** 11.8 — SocksNode Dynamic Residential Proxy Provider  
**Role:** Acceptance Auditor  
**Mission:** Compare the diff against the spec and architecture context. Find any violation of acceptance criteria, missing behavior, deviation from spec intent, or contradiction between spec and code.

## Context documents

- Spec (Story file) — see below.
- Architecture context: `ARCHITECTURE-SPINE.md` AD-3 (Centralized Proxy IP Pool with Auto-Quarantine, Anti-Leak & Proxy Strategy by Auth Mode) and AD-15 (Operational Observability & Least-Privilege Infrastructure). Key constraints: SOCKS5 must use `undici.Socks5ProxyAgent`, never fallback to direct connection, no IP leak, quarantine 5 min, 429/403 → exponential backoff, 100% quarantined → 30s standby.

## Instructions

1. Read the spec and diff carefully.
2. For every acceptance criterion (AC-1 through AC-5), verify the diff actually implements it.
3. Flag any missing implementation, incorrect interpretation, or contradictions.
4. Also check the diff for:
   - Implementation of `asn` token (not in spec but in source hints; not required unless mentioned)
   - `socks5h` or direct-connection fallbacks (must not exist)
   - Export of `PROVIDER_PRESETS` / `PROVIDER_SID_LIMITS` as public API (was `const`, now `export`)
   - Getter `healthyCount` / `isAllQuarantined` accuracy for a single shared gateway
5. Output a Markdown list. Each finding must include:
   - One-line title
   - Which AC or constraint it violates
   - Evidence from the diff (file/line or code snippet)
   - Suggested fix or action
6. If the diff fully satisfies the spec, say so explicitly and list any minor observations.

## Spec

```markdown
# Story 11.8: SocksNode Dynamic Residential Proxy Provider

**Story ID:** 11.8  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** done  
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

- [x] **Task 1: SocksNode Preset in Providers Module**
  - [x] 1.1 Thêm `'socksnode'` vào `PROVIDER_PRESETS` và `PROVIDER_SID_LIMITS`.
  - [x] 1.2 Triển khai logic format credentials/username cho SocksNode trong `DynamicTunnelProvider.prototype.formatUsername` / `buildProxyUrl`.
  - [x] 1.3 Hỗ trợ SOCKS5 scheme mapping và remote DNS resolution.
- [x] **Task 2: SOCKS5 Agent & Protocol Handling**
  - [x] 2.1 Cập nhật `getProxyAgent(proxy)` khởi tạo `Socks5ProxyAgent` an toàn khi `scheme === 'socks5'`.
  - [x] 2.2 Tích hợp browser arguments & Playwright config cho SocksNode.
- [x] **Task 3: Integration with ProxyIpPool**
  - [x] 3.1 Hỗ trợ `ProxyIpPool({ providers: [socksNodeProvider] })`.
  - [x] 3.2 Tương thích sticky proxy theo `accountId` và rotation `getNext()`.
- [x] **Task 4: TypeScript Definitions**
  - [x] 4.1 Cập nhật `types/proxy.d.ts` và `src/proxy/providers.d.ts` với preset `'socksnode'`.
- [x] **Task 5: ATDD & Unit Test Verification**
  - [x] 5.1 Xây dựng `tests/proxy/socksnode-provider.test.js` kiểm thử toàn diện các ACs.

---

## Dev Agent Record

### Implementation Plan
1. Added `'socksnode'` to `PROVIDER_PRESETS` and configured `PROVIDER_SID_LIMITS.socksnode = { max: 32, regex: /^[a-zA-Z0-9_-]+$/ }`.
2. Implemented host auto-detection for `socksnode` domain variants.
3. Implemented SocksNode username formatting supporting `-country-{country}`, `-state-{state}`, `-city-{city}`, `-session-{sessionId}`, `-lifetime-{lifetime}`, and `-sessionduration-{duration}`.
4. Added convenience property getters on `DynamicTunnelProvider` (`scheme`, `host`, `port`, `username`, `password`).
5. Updated `types/proxy.d.ts` with `'socksnode'` union member in `ProviderPreset`.
6. Built and executed comprehensive test suite `tests/proxy/socksnode-provider.test.js` with 12/12 passing tests covering AC-1 to AC-5.

### Completion Notes
- All 12 acceptance tests in `tests/proxy/socksnode-provider.test.js` pass with 100% success rate.
- All 105 tests across `tests/proxy/` test suites continue to pass with 0 regressions.
- `npx tsc --noEmit` clean with 0 type errors.

---

## File List

* `src/proxy/providers.js` (UPDATE)
* `types/proxy.d.ts` (UPDATE)
* `_bmad-output/implementation-artifacts/11-8-socksnode-dynamic-residential-proxy-provider.md` (UPDATE)
* `_bmad-output/test-artifacts/atdd-checklist-11-8-socksnode-dynamic-residential-proxy-provider.md` (UPDATE)
* `tests/proxy/socksnode-provider.test.js` (NEW)

---

## Change Log
- 2026-08-25: Implemented SocksNode dynamic residential proxy provider preset, credential formatting, SOCKS5 agent integration, type declarations, and 12-test suite (Date: 2026-08-25).
```

## Diff

```diff
diff --git a/src/proxy/providers.js b/src/proxy/providers.js
index 0a47286..fc16de3 100644
--- a/src/proxy/providers.js
+++ b/src/proxy/providers.js
@@ -24,14 +24,15 @@ const DEFAULT_STANDBY_BACKOFF_MS = 30000;
 const DEFAULT_QUARANTINE_MS = 5 * 60 * 1000;
 const MAX_ACCOUNT_SEEDS = 10000;
 
-const PROVIDER_PRESETS = new Set(['brightdata', 'smartproxy', 'iproyal', 'kuaidaili', 'custom']);
+export const PROVIDER_PRESETS = new Set(['brightdata', 'smartproxy', 'iproyal', 'kuaidaili', 'socksnode', 'custom']);
 
 /** @type {Record<string, { max?: number, exact?: number, regex: RegExp }>} */
-const PROVIDER_SID_LIMITS = {
+export const PROVIDER_SID_LIMITS = {
   brightdata: { max: 64, regex: /^[a-zA-Z0-9]+$/ },
   smartproxy: { max: 32, regex: /^[a-zA-Z0-9_]+$/ },
   iproyal: { exact: 8, regex: /^[a-zA-Z0-9]{8}$/ },
   kuaidaili: { max: 6, regex: /^[a-zA-Z0-9]+$/ },
+  socksnode: { max: 32, regex: /^[a-zA-Z0-9_-]+$/ },
 };
 
 /**
@@ -628,6 +629,9 @@ export class DynamicTunnelProvider {
     if ((sld === 'kdlapi' && tld === 'com') || (sld === 'kuaidaili' && tld === 'com')) {
       return 'kuaidaili';
     }
+    if (sld === 'socksnode' && (tld === 'com' || tld === 'io' || tld === 'net')) {
+      return 'socksnode';
+    }
 
     return 'custom';
   }
@@ -636,6 +640,26 @@ export class DynamicTunnelProvider {
     return formatProxyUrl(this.rawGateway);
   }
 
+  get scheme() {
+    return this.rawGateway.scheme;
+  }
+
+  get host() {
+    return this.rawGateway.host;
+  }
+
+  get port() {
+    return this.rawGateway.port;
+  }
+
+  get username() {
+    return this.rawGateway.username;
+  }
+
+  get password() {
+    return this.rawGateway.password;
+  }
+
   get totalCount() {
     this.pruneExpiredQuarantines();
     return Math.max(1, this.#activeSessions.size + 1);
@@ -902,6 +926,21 @@ export class DynamicTunnelProvider {
       return { username: rawUser, password };
     }
 
+    if (preset === 'socksnode') {
+      const baseUser = this.#baseUsername(rawUser);
+      const parts = [baseUser];
+      if (req.country) parts.push(`country-${req.country}`);
+      if (req.state) parts.push(`state-${req.state}`);
+      if (req.city) parts.push(`city-${req.city}`);
+      if (req.sessionId) parts.push(`session-${req.sessionId}`);
+      if (req.lifetime) {
+        parts.push(`lifetime-${req.lifetime}`);
+      } else if (typeof req.sessionduration === 'number' && Number.isFinite(req.sessionduration) && req.sessionduration > 0) {
+        parts.push(`sessionduration-${Math.floor(req.sessionduration)}`);
+      }
+      return { username: parts.filter((p) => p !== '').join('-'), password: rawPass };
+    }
+
     if (preset === 'custom') {
       let username = this.template;
       const periodStr = req.period !== undefined && req.period !== null ? String(req.period) : '';
```

The test and type diff are included for completeness in `11-8-socksnode-review-diff.patch` in the same directory.
