# Blind Hunter — Adversarial Code Review Prompt

**Story:** 11.8 — SocksNode Dynamic Residential Proxy Provider  
**Role:** Blind Hunter (no spec, no project context, diff only)  
**Mission:** Cynically review the diff. Find at least 10 issues. Look for bugs, security holes, design mistakes, hidden regressions, incorrect assumptions, missing error handling, performance problems, and off-by-one or boundary bugs. Do not be nice. Assume the author made mistakes.

## Instructions

1. Read the diff below thoroughly.
2. Analyze every changed line for correctness, safety, and consistency.
3. Output a Markdown list of findings. Each finding must include:
   - One-line title
   - File and line reference (use `file:line` or hunk context)
   - Why it is a problem
   - Suggested fix or mitigation
4. Do not include praise, summaries, or filler.
5. If you find fewer than 10 real issues, re-analyze until you have at least 10 or clearly state why the diff is unusually clean.

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

The test and type diff are also in scope but omitted here to keep the prompt focused on runtime code. If you need them, see `11-8-socksnode-review-diff.patch` in the same directory.
