# Spec — Story 50.10: Facebook Guest Scrape Lane

> Implemented 2026-10-06. Source proposal: `../planning-artifacts/sprint-change-proposal-2026-10-06-fb-guest-lane.md`.

## Mục tiêu

Expose the existing fb-guest DOM/SSR scrape path as an explicit anonymous lane:
callers pass `auth: "guest"` to run public Facebook reads without cookies or a
stored account. Default `auth: "auto"` preserves prior behaviour.

## Contract

### `POST /api/facebook/scrape` (`api/routes/facebook.js`)
- `auth` ∈ `'auto' | 'guest'` — other values → `400 {ok:false, error:"auth must be 'auto' or 'guest'"}`.
- `auth:'guest'` + action ∉ `PUBLIC_SCRAPE_ACTIONS` → `400 {ok:false, error:"action '...' requires authentication", code:'FB_REQUIRES_AUTH'}`.
- `auth:'guest'` skips `resolveScrapeCookie` entirely — `resolved = { label:'guest', cookie:null }`.
- `PUBLIC_SCRAPE_ACTIONS` (`facebook.js:145`): `profile, posts, page_posts, group_posts, followers, following, search, group_search, group-members, group_members, post_comments, group_comments, marketplace`.

### `POST /api/platform/:platform/scrape` (`api/routes/platform.js`)
- Same `auth` enum validation → `400 errorBody(VALIDATION_FAILED)`.
- `auth:'guest'` + `platform==='facebook'` + action ∉ `FB_GUEST_ACTIONS` → `400 errorBody({code:'FB_REQUIRES_AUTH', kind:'auth'})`.
- `FB_GUEST_ACTIONS` = superset incl. aliases `get_comments`, `comments`, `post_detail` (synced with PUBLIC_SCRAPE_ACTIONS + `requiresAuth:false` descriptors).

### Service (`api/services/facebookScrape.js` `run()`)
- Reads `args.auth`; `isGuest` → `resolved={}` (no `resolveFacebookAuth`), deletes `accountIds`/`accountId` from forwarded `rest` so a stored account can never be picked silently.

## Implementation

| File | Change |
|---|---|
| `api/services/facebookScrape.js` | `auth`/`isGuest` flag; guest skips auth resolution, strips account refs |
| `api/routes/facebook.js` | `auth` validation + `FB_REQUIRES_AUTH` gate + guest `resolved` |
| `api/routes/platform.js` | `FB_GUEST_ACTIONS` const + `auth` validation + guest gate in POST `/:platform/scrape` |
| `tests/scrapers/social/facebook/guest-lane.contract.test.js` | 8 contract tests: descriptors, both routes, service-level bypass |
| `_bmad-output/planning-artifacts/epics.md` | Story 50.10 entry |

## Verification

- `npx vitest run tests/scrapers/social/facebook/guest-lane.contract.test.js` → **8/8 pass**
- Regression: `facebook-scrape.test.js` + `crawler.test.js` → **19/19 pass**
- Live (port 3016, `MEDIRUS_PROXIES` SocksNode rotating residential):
  - `profile` zuck + `auth:'guest'` → 200, real data (121,441,017 followers), `sourceMethod:'ssr'`
  - `posts` zuck + `auth:'guest'` → 200, real post content, `engineUsed:'http'`
  - `auth:'bogus'` → 400; `guest`+`comments`/`like` → `FB_REQUIRES_AUTH`

## Notes / follow-ups

- Requires working proxies — guest lane still goes through `globalProxyPool`; without proxies `Proxy pool exhausted` (XACT_5030). `.env` now has both SocksNode residential entries enabled: `MEDIRUS_PROXIES` (rotating global) + `PROXY_URL` (sticky country-vn failover) → pool = 2 healthy endpoints.
- SSR post extraction enriched (commit `c780ec3f`): `permalink_url`→real `postUrl`+`pfbid` externalId, `creation_time`/`publish_time`→`publishedAt`, `profile_picture.uri`→`authorAvatar` when in window. `dataQuality.score` 80→85; still `degraded` for missing `title`, `mediaUrls`, `viewsCount` (media not reliably extractable from SSR JSON).
- `api/routes/platform (1).js` is an unmounted dead duplicate — do not edit it.
