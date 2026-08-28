# Story 11.5 — End-to-End Request Pipeline (Two-Mode IP Strategy)

**Story ID:** 11.5  
**Epic:** 11 — Resilient Network & Proxy Pool Management  
**Status:** done  
**Owner:** DEV  
**Source:** `epics.md` Story 11.5, `ARCHITECTURE-SPINE.md` AD-3, PRD FR-66 / NFR-13.

---

## Story

As a **Reliability Engineer**,  
I want **`AbstractApiClient` wire `ProxyIpPool`, `AdaptiveRateGovernor` and `AccountPool` into a clear pipeline: sticky IP for auth-required accounts and rotating IP for no-auth platforms**,  
so that **every request goes through the right proxy mode and never falls back to a direct connection**.

---

## Acceptance Criteria

### AC-1: Two-mode proxy selection

* **Given** `AbstractApiClient` is constructed with `proxyPool`, `governor`, `accountPool`, `sessionManager` and a platform-specific `PlatformResponseValidator`
* **When** `request(method, url, options)` is called
* **Then** the pipeline:
  1. Determines `requiresAuth` for the platform.
  2. If `requiresAuth` is `true`, gets `accountId` from `accountPool.getNextAvailable(platform)`, checks `governor.canAccountRequest(accountId, platform)`, and rotates account if hibernating.
  3. If `requiresAuth` is `true`, calls `proxyPool.getStickyProxy(accountId)`; otherwise calls `proxyPool.getNext()` for round-robin/residential rotation.
  4. If the proxy is quarantined or all proxies are quarantined, enters Standby Backoff 30s and throws `ProxyDeadError`.
  5. Sends the request through a proxy agent (`undici.ProxyAgent`, `socks-proxy-agent`, or Playwright browser context as appropriate).
  6. Calls `governor.recordRequest(accountId)` to record the request in a sliding window.
  7. Runs `PlatformResponseValidator.isValidPayload(response)`, `isBotChallenge(response)`, and `isRateLimit(response)` even when HTTP status is 200.
* **And** auth-required platforms (Facebook, TikTok, Shopee, X, Threads, LinkedIn, TopCV, VietnamWorks) use sticky IP.
* **And** no-auth platforms (Batdongsan, Chợ Tốt, etc.) use rotating residential proxy.
* **And** the pipeline never falls back to a direct connection when the proxy fails.
