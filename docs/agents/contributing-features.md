# Adding New Features

## Checklist

1. Create the script in `src/` following [browser-script-patterns.md](browser-script-patterns.md)
2. Add documentation in `docs/examples/your-feature.md`
3. Update `README.md` — add to examples and feature matrix
4. If it belongs to an existing skill category, update that `skills/*/SKILL.md`
5. If it's a new category, create a new `skills/your-category/SKILL.md` with YAML frontmatter

## Documentation Template

```markdown
# Feature Name

Brief description.

## What It Does

1. Step one
2. Step two

## Browser Console Script

Navigate to: x.com/relevant/page
Paste in DevTools console.

## Notes

- Important caveats
```

## SKILL.md Frontmatter Template

```yaml
---
name: your-skill-name
description: Third-person description of what this does and when to use it.
license: Apache-2.0
metadata:
  author: nichxbt
  version: "3.0"
---
```

## Code Style

- `const` over `let`, async/await over raw promises
- Descriptive `console.log` with emojis for visibility
- Comment complex selectors
- Author credit: `// by nichxbt`
- Use `data-testid` selectors when available (see [selectors.md](selectors.md))

## New Platform Scraper Template (Epic 35)

File layout — mirror `src/scrapers/social/{reddit,medium,instagram}/`:

```
src/scrapers/social/<platform>/
├── client.js      → <Platform>Client extends AbstractApiClient (transport, auth, proxy)
├── crawler.js     → <Platform>Crawler extends AbstractCrawler (actions, pagination, store)
├── normalizer.js  → raw API payload → canonical post/comment shapes
├── validator.js   → PlatformResponseValidator (rate-limit / bot-challenge / login-wall detection)
├── bridge.js|.py  → optional browser bridge for JS-gated endpoints
└── index.js       → create<Platform>Client / create<Platform>Crawler factories
```

### ProxyProvider injection contract

All new-platform clients accept the same proxy surface:

```javascript
const client = new RedditClient({
  proxyProvider,   // DynamicTunnelProvider — geo-targeted sticky sessions (preferred)
  proxyPool,       // ProxyIpPool — raw IP list w/ quarantine + round-robin
  requiresProxy,   // true = hard-require; false = proxy only if configured
});
```

Resolution order (implemented in `AbstractApiClient.resolveProxy` + platform override):

1. `proxyProvider.getProxy({ accountId, requiresResidential, country, isp, sessionId, ... })` — sticky session per `accountId`
2. `proxyPool` — defaults to env-seeded `globalProxyPool` (`PROXY_URL`, `PROXY_URLS`, `XEEPY_PROXY_URL`, `FACEBOOK_PROXY`)
3. `process.env.PROXY_URL` direct read when the pool cannot serve
4. `PROXY_EXHAUSTED` (XACT_5030) — never silently direct when `requiresProxy: true`

Failure handling: `isProxyConnectionError(err)` (exported from `base-client.js`) detects tunnel failures → `quarantineProxy(proxy)` (5 min) → retry once with `disableProxy: true` when `requiresProxy` is false.

Tests: see `tests/scrapers/proxy-injection.test.js` — real `ProxyIpPool`/`DynamicTunnelProvider` instances and the `httpClient` transport seam; no mocks (repo rule).
