# ATDD Checklist — Story 11.8: SocksNode Dynamic Residential Proxy Provider

**Story ID:** 11.8  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Phase:** 🟢 GREEN Phase (All 12 Acceptance Tests Passing)  
**Test Suite:** `tests/proxy/socksnode-provider.test.js`  
**Target Module:** `src/proxy/providers.js`, `src/proxy/proxy-pool.js`

---

## 🟢 Acceptance Test Matrix

| Test ID | Priority | Acceptance Criteria | Description | Initial Status | Current Status |
|---|---|---|---|---|---|
| `TEST-11.8-01` | P0 | AC-1 | Parse gateway URL with `socks5://` & `http://` schemes and recognise `provider === 'socksnode'` | 🔴 Red | 🟢 Green |
| `TEST-11.8-02` | P0 | AC-1 | Validate session ID constraints in `PROVIDER_SID_LIMITS.socksnode` (max: 32) | 🔴 Red | 🟢 Green |
| `TEST-11.8-03` | P0 | AC-2 | Format username with geo-targeting: `-country-vn`, `-city-hanoi`, `-session-sid` | 🔴 Red | 🟢 Green |
| `TEST-11.8-04` | P0 | AC-2 | Generate deterministic sticky session ID per `accountId` in `getStickyProxy` | 🔴 Red | 🟢 Green |
| `TEST-11.8-05` | P1 | AC-2 | Format session duration / lifetime parameter (`-lifetime-10` / `-sessionduration-600`) | 🔴 Red | 🟢 Green |
| `TEST-11.8-06` | P0 | AC-3 | Instantiate `Socks5ProxyAgent` for SOCKS5 scheme and `ProxyAgent` for HTTP scheme | 🔴 Red | 🟢 Green |
| `TEST-11.8-07` | P1 | AC-3 | Zero direct connection fallback when proxy agent encounters error (AD-3) | 🔴 Red | 🟢 Green |
| `TEST-11.8-08` | P0 | AC-4 | Generate Playwright proxy config and Chrome browser launch flags with WebRTC policy | 🔴 Red | 🟢 Green |
| `TEST-11.8-09` | P1 | AC-5 | Quarantine failed SocksNode gateway and trigger Standby Backoff on total failure | 🔴 Red | 🟢 Green |
| `TEST-11.8-10` | P0 | AC-5 | Seamless integration with `ProxyIpPool` for sticky and rotating routing | 🔴 Red | 🟢 Green |

---

## 📋 Implementation Checklist

- [x] **Task 1: SocksNode Preset in Providers Module**
  - [x] 1.1 Thêm `'socksnode'` vào `PROVIDER_PRESETS` và `PROVIDER_SID_LIMITS` (`max: 32`, regex: `/^[a-zA-Z0-9_-]+$/`).
  - [x] 1.2 Triển khai format username: `user-country-{country}-city-{city}-session-{sid}-lifetime-{minutes}`.
- [x] **Task 2: SOCKS5 & HTTP Proxy Agent Resolution**
  - [x] 2.1 Hỗ trợ `Socks5ProxyAgent` trong `getProxyAgent(proxy)`.
  - [x] 2.2 Đảm bảo không fallback direct khi agent fail.
- [x] **Task 3: Playwright & Browser Args**
  - [x] 3.1 Trả về đúng format `{ server, username, password }` và flags WebRTC.
- [x] **Task 4: Integration with ProxyIpPool**
  - [x] 4.1 Test `ProxyIpPool` lấy sticky proxy và round-robin với SocksNode provider.
- [x] **Task 5: Type Declarations**
  - [x] 5.1 Cập nhật `src/proxy/providers.d.ts` và `types/proxy.d.ts`.
