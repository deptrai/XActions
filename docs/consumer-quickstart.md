# Consumer Quickstart — migrating to the Unified Scrape Gateway

> Story 50.9 — UX-4 fix. Convert a legacy `xactionsClient.ts` (queue+poll via
> `/api/ai/discovery/search`) to the new `POST /api/platform/:platform/scrape`
> contract in under 30 minutes.

## TL;DR

| Before | After |
|---|---|
| `POST /api/ai/discovery/search` + poll `/api/ai/action/status/:id` | `POST /api/platform/:platform/scrape` |
| `sessionCookie` + cookie jar auth | `Authorization: Bearer <jwt or serviceKey>` |
| Async-only (queue+poll) | `mode:'sync'` for sub-1.5s reads, `mode:'async'` when paging |
| `{result:[...]}` envelope | `{success, ok, mode, metadata, data[]}` AD-5 envelope |
| String error code in `error.message` | Typed `error.kind` enum + `retryable` flag |

## 1. Auth migration

### Before
```ts
const client = new XActionsClient({
  sessionCookie: process.env.X_SESSION_COOKIE,
});
```

### After — pick your lane

| Lane | Header | When |
|---|---|---|
| **Internal** (dashboard login JWT) | `Authorization: Bearer <jwt>` | Dashboard users, in-app flows |
| **Named consumer** (service key) | `Authorization: Bearer sk_<key>` | Server-to-server, quota metered per `{consumer}:{platform}:{action}` |
| **x402** | `X-Payment: <payment-proof>` | Pay-per-call; bypasses consumer quota |
| **Anonymous** | _(none)_ | IP-bucketed 10 req/min free tier |

⚠️ `X-Consumer-Id` is **observability only** — never authoritative. Bearer
identity wins; a spoofed `X-Consumer-Id` on an anonymous request lands on the
anonymous IP bucket anyway.

### After — code
```ts
const client = new XActionsClient({
  apiKey: process.env.XACTIONS_API_KEY, // e.g. sk_jev_xxx
});
```

## 2. Method migration — `searchReddit`

### Before (legacy queue+poll)
```ts
async searchReddit(query: string) {
  const res = await fetch(`${this.base}/api/ai/discovery/search`, {
    method: 'POST',
    headers: { 'Cookie': `session=${this.sessionCookie}` },
    body: JSON.stringify({ query }),
  });
  const { operationId } = await res.json();
  // poll loop
  for (;;) {
    const op = await fetch(`${this.base}/api/ai/action/status/${operationId}`);
    const { status, result } = await op.json();
    if (status === 'completed') return result.posts;
    if (status === 'failed') throw new Error(result.error);
    await sleep(1500);
  }
}
```

### After (sync lane, single request)
```ts
async searchReddit(query: string) {
  const res = await fetch(`${this.base}/api/platform/reddit/scrape`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'search',
      mode: 'sync',
      options: { query },
    }),
  });
  const envelope = await res.json();
  if (!envelope.ok) throw new GatewayError(envelope.error);
  const posts = envelope.data[0]?.posts ?? [];
  return posts;
}
```

## 3. Method migration — `searchTwitter`

### Before
```ts
async searchTwitter(query: string) {
  const res = await fetch(`${this.base}/api/ai/discovery/search`, { /* same queue+poll */ });
  const { operationId } = await res.json();
  /* poll loop */
}
```

### After
```ts
async searchTwitter(query: string) {
  const res = await fetch(`${this.base}/api/platform/x/scrape`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'search',
      mode: 'sync',
      options: { query, limit: 25 },
    }),
  });
  const env = await res.json();
  if (!env.ok) throw new GatewayError(env.error);
  return env.data; // TweetItem[]
}
```

## 4. Sync-vs-async decision tree

```
Is the action in the descriptor's syncCapableActions?
├─ No (e.g. telegram stubs, livestream pollers, mass-scrape)
│  └─ mode:'async' — you get operationId + statusUrl, poll the status endpoint
│
└─ Yes (reddit/search, pumpfun/fetch_coin_meta, dexscreener/*, x/search …)
   └─ Does the call usually finish under 1.5s?
      ├─ Yes → mode:'sync' — fastest path
      └─ No (cold upstream, deep paging) → mode:'sync' anyway —
         if upstream crosses 1.5s the gateway returns 202 + degraded_reason
         + operationId. Poll it the same way as explicit async.
```

## 5. `error.kind` → retry strategy

| kind | retryable | retry_after_ms | Action |
|---|---|---|---|
| `auth` | `false` | — | Refresh credentials; check `XACTIONS_API_KEY` |
| `validation` | `false` | — | Fix args; check `GET /api/actions` for requiredArgs |
| `consumer_quota` | `true` | yes | Wait `retry_after_ms`, then retry — your bucket is exhausted |
| `upstream_rate_limit` | `true` | yes | Exponential backoff; upstream is throttling us |
| `proxy_ip_block` | `true` | — | Retry; egress IP rotated automatically |
| `upstream_error` | `true` | — | Retry; escalate if persistent (5xx upstream) |
| `internal` | `false` | — | Report with `metadata.request_id` |

## 6. Common pitfalls

- **`X-Consumer-Id` spoofing** — always lands on anonymous IP bucket; never
  use it to "become" a named consumer. Bearer auth is the only authoritative
  identity.
- **`mode:'sync'` on non-sync action** → 400 `XACT_4001 'action not
  sync-eligible'`. Check `GET /api/actions` for `syncCapable` first.
- **Empty `data[]` with `ok:true`** — upstream returned 200 with zero items
  (e.g. niche query). Not an error; `metadata.degraded_reason` will flag
  silent blocks when detected.
- **Anonymous rate ceiling** — 10 req/min per IP on the free tier. Burst
  callers see `429 consumer_quota` + `Retry-After`.
- **Polling `statusUrl` too fast** — use `retry_after_ms` from the 429
  envelope; the status endpoint is also quota-gated.

## 7. jev-trading specific

If you're running against the private `jev-trading` deployment, the diff
is identical — swap `base` to your deployment host and reuse `sk_jev_*`
service keys. Paths inside your repo to update:

- `src/clients/xactionsClient.ts` — replace `searchReddit`, `searchTwitter`,
  `scrapePumpfun`, `dexscreenerLookup` bodies with the sync-lane calls above
- `src/jobs/monitor.ts` — replace the `poll operationId` loop with either
  sync response handling or async `statusUrl` poller (unchanged shape)

## 8. Working playground

- **Try it live**: `https://xactions.app/gateway` — pick platform + action +
  mode, paste body, see envelope + `metadata.request_id` for tracing.
- **Action catalog**: `https://xactions.app/actions` — canonical list of all
  actions with `requiredArgs`, `syncCapable`, `status`.
- **Monitor**: `https://xactions.app/gateway/monitor` — p50/p95/p99,
  upstream health per platform, quota degrade reasons, request trace lookup.

## Support

`metadata.request_id` is the end-to-end trace — include it in reports.
`GET /api/admin/gateway/trace/:requestId` returns the full call record.
