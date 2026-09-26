# Spec — Story 50.8: `social/telegram` Platform Descriptor (Skeleton — Transport Deferred)

> Status: **implemented**
> Epic: 50 — Public Scrape Gateway
> Depends on: 50.3 (envelope), 50.5 (self-discovery)
> Date: 2026-09-27
> Constraint: NO MTProto/TDLib dep yet — only interface seam; real impl lands in D4 spec PR

## 1. Goal

Scaffold `src/scrapers/social/telegram/` with descriptor + client + crawler + normalizer
so the platform is discoverable via `/api/actions` as `status:'coming_soon'` and
`syncCapable:false` until a transport is chosen in the D4 spec.

4 action stubs:
| Action | requiredArgs | Purpose |
|---|---|---|
| `channel_messages` | `[channel]` | fetch recent posts from public channel(s) |
| `channel_info` | `[channel]` | metadata (member count, description, linked chat) |
| `search_channels` | `[query]` | find channels by keyword |
| `user_resolve` | `[username]` | username → profile |

## 2. Non-goals

- NO MTProto, TDLib, or Bot API implementation — only the strategy-shim seam
- No real upstream calls — all handlers throw `XACT_4001 'transport not implemented'`
- No sync capability — `syncCapableActions = []` forces async (mirrors 50.2 contract)

## 3. File layout

```
src/scrapers/social/telegram/
  client.js       — TelegramClient extends AbstractApiClient (strategy-shim)
  crawler.js      — TelegramCrawler extends AbstractCrawler (4 action stubs)
  normalizer.js   — stubs producing ThinEvent-shaped records (unused until D4)
  descriptor.js   — aliases/actionMap/mapArgs/factories + coming_soon flag
tests/scrapers/social/telegram/telegram.test.js
```

## 4. Client — strategy-shim (`client.js`)

```js
export const TELEGRAM_TRANSPORTS = Object.freeze(['mtproto', 'bot', 'web']);
export class TelegramClient extends AbstractApiClient {
  name = 'telegram'; platform = 'telegram'; requiresAuth = false;
  constructor(options = {}) {
    super(options);
    this.transport = this.#resolveTransport(options.transport);
  }
  #resolveTransport(t) {
    const env = String(process.env.TELEGRAM_TRANSPORT || '').trim().toLowerCase();
    const pick = (t || env || '').toLowerCase();
    return TELEGRAM_TRANSPORTS.includes(pick) ? pick : null; // null = not chosen yet
  }
  async #requireTransport() {
    if (!this.transport) throw new PlatformError({ code: 'XACT_4001', message: 'telegram transport not implemented — set TELEGRAM_TRANSPORT=mtproto|bot|web and implement in D4 spec', statusCode: 400, suggestedAction: SuggestedActions.USE_ACTIONS_LIST, platform: this.platform });
    return this.transport;
  }
  // Stub methods — throw XACT_4001 regardless of chosen transport until D4 lands impl.
  async getChannelMessages() { await this.#requireTransport(); throw transportNotImpl(this.transport); }
  async getChannelInfo()     { /* same */ }
  async searchChannels()     { /* same */ }
  async resolveUser()        { /* same */ }
}
```

`transportNotImpl(t)` throws `XACT_4001 'transport "<t>" not implemented — D4 spec picks and lands the impl'`.

## 5. Crawler (`crawler.js`)

```js
export class TelegramCrawler extends AbstractCrawler {
  name = 'telegram'; platform = 'telegram'; category = 'social'; requiresAuth = false;
  constructor(deps = {}) { /* register 4 stubs */ }
  async fetchChannelMessages(args)  { await this.client.getChannelMessages(...); }
  async fetchChannelInfo(args)      { /* ... */ }
  async fetchSearchChannels(args)   { /* ... */ }
  async fetchUserResolve(args)      { /* ... */ }
  async cleanup() {}
}
```

Each action registers `requiredArgs`, `optionalArgs`, `outputType`, `example`,
`handler` calling the client stub (which throws XACT_4001).

## 6. Normalizer (`normalizer.js`)

Stub shapes for future impl — emit ThinEvent-shaped records:

- `normalizeChannelMessage(raw)` → `{platform:'telegram', category:'social', type:'channel_message', data:{channel, message_id, text?, posted_at, views?, forwards?}}`
- `normalizeChannelInfo(raw)` → `{platform, category:'social', type:'channel_info', data:{channel, title, member_count, description, linked_chat_id}}`
- `normalizeChannelSearchResult(raw)` → `{platform, category:'social', type:'channel_search_result', data:{channel, title, member_count, description}}`
- `normalizeTelegramUser(raw)` → `{platform, category:'social', type:'telegram_user', data:{username, user_id, display_name, bio, is_bot}}`

## 7. Descriptor (`descriptor.js`)

```js
const TELEGRAM_ACTION_MAP = {
  channel_messages: 'channel_messages', messages: 'channel_messages', posts: 'channel_messages',
  channel_info: 'channel_info', info: 'channel_info', metadata: 'channel_info',
  search_channels: 'search_channels', search: 'search_channels', find_channels: 'search_channels',
  user_resolve: 'user_resolve', resolve: 'user_resolve', user: 'user_resolve', username: 'user_resolve',
};
export default {
  aliases: ['telegram', 'tg'],
  actionMap: TELEGRAM_ACTION_MAP,
  syncCapableActions: [],           // none until transport lands — forces async
  coming_soon: true,                // self-discovery marker for /api/actions
  mapArgs(options) { /* channel|username|query → canonical */ },
  createClient(options) { /* options.client instanceof TelegramClient ? reuse : new */ },
  createCrawler({ client, store, options }) { /* new TelegramCrawler */ },
};
```

## 8. Wiring changes

- `src/scrapers/index.js`: telegramDescriptor import + registration
- `api/routes/platform.js`: VALID_PLATFORMS += `telegram`, `tg`; PLATFORM_ALIASES += tg→telegram
- `src/scrapers/social/actions-list.js`: CANONICAL_PLATFORMS += `telegram`; loader → TelegramCrawler
- `api/openapi.json`: platform enum += telegram/tg
- `src/core/types.js`: (no new category needed — reuses 'social')
- Actions list needs the `coming_soon` marker from descriptor (per-action `status: 'coming_soon'`)

## 9. Tests

- T-1: `TelegramCrawler` instantiates, listActions returns 4 stubs with correct requiredArgs
- T-2: every handler throws XACT_4001 'transport not implemented' when invoked (no TELEGRAM_TRANSPORT set)
- T-3: descriptor `syncCapableActions = []`; `isSyncCapable('telegram', 'channel_messages')` → false
- T-4: `/api/actions?platform=telegram` lists 4 entries with `status:'coming_soon'`, `syncCapable:false`
- T-5: `scrape('telegram','channel_messages',{channel:'x'})` → rejects XACT_4001
- T-6: actionMap aliases resolve (posts→channel_messages, search→search_channels, user→user_resolve)
- T-7: `POST /api/platform/telegram/scrape {action:'channel_messages'}` → mode resolves async (not sync)

## 10. Acceptance mapping

| AC | Mechanism |
|---|---|
| action stubs registered | crawler.registerAction ×4 |
| `transport: 'mtproto'\|'bot'\|'web'` env gate | TelegramClient#resolveTransport + #requireTransport |
| XACT_4001 on invocation | all client stubs throw regardless of transport chosen |
| syncCapableActions empty | descriptor manifest; forces async via 50.2 contract |
| `coming_soon: true` in self-discovery | descriptor field → actions-list status 'coming_soon' |
| requiredArgs exposed | registerAction descriptor |
| envelope shape defined | normalizer stubs show future shape |
| NO MTProto/TDLib dep | only abstract seam |

## Review Triage Log

_(to fill during spec review pass)_

### Findings (self-review, 4 lenses)

- F-1 (contract): descriptor `coming_soon` flag must surface per-action `status:'coming_soon'`
  even though crawler loads — current actions-list only uses 'coming_soon' when no crawler.
  **Fix**: extend actions-list to prefer descriptor.coming_soon → 'coming_soon' over 'stable'.
  Applied to §8.
- F-2 (architecture): crawler instance for actions-list loader must be constructible WITHOUT
  a client arg (no deps). Constructor pattern: `new TelegramCrawler()` — client must
  default-construct inside. **Confirmed** §5.
- F-3 (testing): actions list returns `status:'coming_soon'` via descriptor flag — test needs
  `/api/actions?platform=telegram` not just crawler actions.
- F-4 (security): even though stubs throw XACT_4001, malformed `channel`/`username` still need
  arg validation — `channel` must match `^[a-zA-Z0-9_]{5,32}$` (t.me username rules) — reject
  before transport check to keep error codes deterministic. **Applied** §5.
- F-5 (contract): `syncCapableActions:[]` means `mode:'sync'` on telegram → 400 `not_sync_capable`
  (inherited from 50.2 contract). Test asserts this explicitly.

### Auto Run Result

- spec: this file
- implement: src/scrapers/social/telegram/{client,crawler,normalizer,descriptor}.js
- patch: actions-list.js status honors descriptor.coming_soon
- wiring: src/scrapers/index.js, api/routes/platform.js, api/openapi.json
- tests: tests/scrapers/social/telegram/telegram.test.js (7 cases)
- docs: `npm run docs:matrix` regenerate (telegram ×4, syncCapable all —)


## Implementation Notes (2026-09-27)

- `TelegramClient` resolves transport from `TELEGRAM_TRANSPORT` env or
  `options.transport`; allowed set `{mtproto, bot, web}`; any value outside
  the set (incl. unset) → `transport=null`. All upstream methods call
  `#requireTransport` which throws XACT_4001 `'transport "<t>" not implemented — D4 spec picks and lands the impl'`.
- `TelegramCrawler` registers the 4 stubs with correct requiredArgs; arg
  validation (`TELEGRAM_HANDLE_RE` = 5–32 chars alnum+underscore) runs BEFORE
  the transport gate so callers get deterministic XACT_4002 on malformed
  handles even when transport is unset.
- actions-list.js: descriptor `coming_soon:true` now overrides
  `status:'stable'` → emits `status:'coming_soon'` per action even when
  crawler loads successfully (the loader found the class; only the transport
  is missing). Backwards-compat: platforms without `coming_soon` still emit
  'stable' when their crawler loads.
- VALID_PLATFORMS += `telegram`, `tg`; PLATFORM_ALIASES += `tg→telegram`.
- openapi.json platform enum extended.
- docs/canonical-action-matrix regenerated — 27 platforms, 233 actions.

### Verified live
- `GET /api/actions?platform=telegram` → 4 entries, `status:'coming_soon'`,
  `syncCapable:false`.
- `POST /api/platform/telegram/scrape {action:'channel_messages'}` (default
  mode) → 202, `mode:'async'`, `operationId:'cmuj1o5u9…'` — queued.
- Same call with `mode:'sync'` → 400 `XACT_4001 'action not sync-eligible'`
  (50.2 contract enforced).
- `scrape('telegram','channel_messages')` via descriptor → XACT_4001 throw.

### Tests
- tests/scrapers/social/telegram/telegram.test.js — 7/7 pass.
- Regression: actions-manifest (10) + dexscreener (11) all pass.
