# Edge Case Hunter — Method-Driven Edge Case Review Prompt

**Story:** 11.8 — SocksNode Dynamic Residential Proxy Provider  
**Role:** Edge Case Hunter  
**Mission:** Walk every branching path and boundary condition in the diff. Report only unhandled edge cases. Do not editorialize. Be exhaustive about inputs, states, and transitions.

## Instructions

1. Read the diff carefully.
2. Enumerate every branch: `if/else if/else`, ternaries, loops, early returns, guard clauses, switch/case, and data-structure lookups.
3. For each branch, identify the boundary conditions and values that are NOT explicitly handled or guarded in the changed code.
4. Ignore the rest of the codebase unless the diff explicitly calls an external function.
5. Output a single valid JSON array and nothing else. Each object must have exactly these fields:
   - `location`: `file:line` or `file:start-end`
   - `trigger_condition`: one-line description (max 15 words)
   - `guard_snippet`: minimal code sketch that closes the gap (single-line escaped string, no raw newlines or unescaped quotes)
   - `potential_consequence`: what could actually go wrong (max 15 words)
6. If no unhandled edge cases are found, output `[]`.

## Diff (runtime code + types + tests)

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
diff --git a/tests/proxy/socksnode-provider.test.js b/tests/proxy/socksnode-provider.test.js
index b4e819a..bb5ec84 100644
--- a/tests/proxy/socksnode-provider.test.js
+++ b/tests/proxy/socksnode-provider.test.js
@@ -6,7 +6,7 @@ import { describe, it, expect } from 'vitest';
 
 describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/proxy/socksnode-provider.test.js)', () => {
   describe('Preset Registration & Gateway Parsing (AC-1)', () => {
-    it.skip('[P0] should recognise socksnode provider and parse socks5 gateway URL', async () => {
+    it('[P0] should recognise socksnode provider and parse socks5 gateway URL', async () => {
       const { DynamicTunnelProvider, PROVIDER_PRESETS } = await import('../../src/proxy/providers.js');
 
       expect(PROVIDER_PRESETS.has('socksnode')).toBe(true);
@@ -24,7 +24,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       expect(provider.password).toBe('testpass');
     });
 
-    it.skip('[P0] should support http scheme gateway for socksnode', async () => {
+    it('[P0] should support http scheme gateway for socksnode', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -36,7 +36,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       expect(provider.port).toBe(8080);
     });
 
-    it.skip('[P1] should enforce session ID length and character constraints', async () => {
+    it('[P1] should enforce session ID length and character constraints', async () => {
       const { PROVIDER_SID_LIMITS } = await import('../../src/proxy/providers.js');
 
       expect(PROVIDER_SID_LIMITS.socksnode).toBeDefined();
@@ -47,7 +47,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
   });
 
   describe('Geo-Targeting & Session Parameter Formatting (AC-2)', () => {
-    it.skip('[P0] should format username with country and city targeting', async () => {
+    it('[P0] should format username with country and city targeting', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -68,7 +68,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       expect(proxy.server).toBe('socks5://gate.socksnode.com:1080');
     });
 
-    it.skip('[P0] should generate deterministic sticky session ID per accountId', async () => {
+    it('[P0] should generate deterministic sticky session ID per accountId', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -85,7 +85,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       expect(proxy1.username).toContain('-session-');
     });
 
-    it.skip('[P1] should include lifetime or session duration in username when provided', async () => {
+    it('[P1] should include lifetime or session duration in username when provided', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -103,7 +103,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
   });
 
   describe('Multi-Protocol Proxy Agent Integration (AC-3)', () => {
-    it.skip('[P0] should return Socks5ProxyAgent for socks5 scheme proxy', async () => {
+    it('[P0] should return Socks5ProxyAgent for socks5 scheme proxy', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -117,7 +117,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       expect(agent).toBeDefined();
     });
 
-    it.skip('[P0] should return ProxyAgent for http scheme proxy', async () => {
+    it('[P0] should return ProxyAgent for http scheme proxy', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -133,7 +133,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
   });
 
   describe('Playwright & Browser Launch Arguments (AC-4)', () => {
-    it.skip('[P0] should convert to Playwright proxy configuration object', async () => {
+    it('[P0] should convert to Playwright proxy configuration object', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -151,7 +151,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       });
     });
 
-    it.skip('[P1] should generate browser launch flags with WebRTC policy', async () => {
+    it('[P1] should generate browser launch flags with WebRTC policy', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -168,7 +168,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
   });
 
   describe('ProxyIpPool Integration & Quarantine (AC-5)', () => {
-    it.skip('[P0] should integrate seamlessly with ProxyIpPool', async () => {
+    it('[P0] should integrate seamlessly with ProxyIpPool', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
       const { ProxyIpPool } = await import('../../src/proxy/proxy-pool.js');
 
@@ -188,7 +188,7 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
       expect(stickyProxy).toBeDefined();
     });
 
-    it.skip('[P1] should quarantine failed proxy and report pool status', async () => {
+    it('[P1] should quarantine failed proxy and report pool status', async () => {
       const { DynamicTunnelProvider } = await import('../../src/proxy/providers.js');
 
       const provider = new DynamicTunnelProvider({
@@ -196,9 +196,18 @@ describe('Story 11.8 — SocksNode Dynamic Residential Proxy Provider (tests/pro
         provider: 'socksnode',
       });
 
+      expect(provider.healthyCount).toBe(1);
+      expect(provider.isAllQuarantined()).toBe(false);
+
       const proxy = provider.getNext();
       provider.quarantine(proxy, 1000);
 
+      // Quarantining a single per-request proxy session doesn't block the full gateway
+      expect(provider.healthyCount).toBe(1);
+
+      // Quarantining the raw gateway blocks the provider
+      provider.quarantine(provider.rawGateway, 1000);
+      expect(provider.healthyCount).toBe(0);
       expect(provider.isAllQuarantined()).toBe(true);
     });
   });
diff --git a/types/proxy.d.ts b/types/proxy.d.ts
index 6ec6e98..dd10329 100644
--- a/types/proxy.d.ts
+++ b/types/proxy.d.ts
@@ -8,7 +8,7 @@
 import type { ProxyAgent, Socks5ProxyAgent } from 'undici';
 
 export type SupportedProxyScheme = 'http' | 'https' | 'socks5';
-export type ProviderPreset = 'brightdata' | 'smartproxy' | 'iproyal' | 'kuaidaili' | 'custom';
+export type ProviderPreset = 'brightdata' | 'smartproxy' | 'iproyal' | 'kuaidaili' | 'socksnode' | 'custom';
 
 export interface NormalizedProxy {
   scheme: SupportedProxyScheme;
@@ -187,6 +187,11 @@ export declare class DynamicTunnelProvider implements ProxyProviderContract {
 
   constructor(options: DynamicTunnelOptions);
 
+  get scheme(): SupportedProxyScheme;
+  get host(): string;
+  get port(): number;
+  get username(): string | undefined;
+  get password(): string | undefined;
   get healthyCount(): number;
   get totalCount(): number;
   isAllQuarantined(): boolean;
```
