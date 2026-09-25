# ADR: Pump.fun Authentication Architecture & Dependency Decisions

**Date:** 2026-09-25  
**Status:** Approved  
**Author:** Winston (System Architect) & Luisphan  
**Context:** Story 20.6 & 20.7 — Pump.fun Social Crawler Extensions

---

## 1. Decision: Browser-as-Signer for Authentication (No Heavy Solana SDK)

### Problem
Pump.fun uses Privy (`google_oauth` / embedded Solana wallet) protected by Cloudflare Turnstile and WAF. Re-implementing Sign-In With Solana (SIWS), Privy OAuth dance, and Turnstile challenge bypass in pure headless Node.js would require `@solana/web3.js` (~15MB bloat) and is highly brittle against Cloudflare bot mitigations.

### Decision
Adopt the **Browser-as-Signer / CDP Session Bridge** pattern already proven in XActions (`FacebookBrowserBridge`, `TikTokSignerBridge`):
1. The user logs into pump.fun once via their normal browser (Chrome/Edge/Brave).
2. `PumpFunBrowserBridge` connects via Chrome DevTools Protocol (CDP) or Chrome MCP to extract:
   - HTTP Cookies: `_cfuvid`, `__cf_bm` (Cloudflare bypass session).
   - LocalStorage tokens: `privy:token` (Bearer JWT), `privy:id_token`, `decoded-jwt` (`userId`, `address`).
3. Store the session into `globalSessionManager.set('pumpfun:<accountId>', sessionBundle)`.
4. High-speed headless crawlers (`PumpFunCrawler`) reuse this cookie/JWT bundle in standard HTTP/2 and WebSocket requests without launching a browser.

### Consequences
- **Positive:** Zero heavy dependencies added (`@solana/web3.js` is NOT needed).
- **Positive:** Bypasses Cloudflare Turnstile naturally because cookies are issued to a real browser.
- **Negative:** Requires user to have an active session in a browser for authenticated write actions.

---

## 2. Decision: Crypto & Encoding Dependencies

If standalone Base58 conversion or Ed25519 verification is required in Node.js:
- **Base58:** Use a minimal native utility or lightweight `bs58` (~1KB), avoiding full blockchain SDKs.
- **Ed25519:** Use Node.js built-in `node:crypto` (`crypto.sign(null, data, key)`) which natively supports Ed25519 since Node 12+.

---

## 3. Verified Authenticated Endpoints (Live Probed 2026-09-25)

The following endpoints were verified working with the extracted browser session:
- `GET https://frontend-api-v3.pump.fun/users/me` → 200 OK (current user profile, wallet address, userId)
- `GET https://frontend-api-v3.pump.fun/following/{userId}` → 200 OK (list of followed accounts)
- `GET https://frontend-api-v3.pump.fun/users/{userId}` → 200 OK (user public profile)
- `wss://livechat.pump.fun` → Socket.IO room chat with tokenGate configuration
