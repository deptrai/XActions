# DIGEST: pump.fun v3 API surface — live browser probe (2026-09-25)

**Method:** `fetch()` từ trong trang pump.fun thật (session Cloudflare `__cf_bm`/`_cfuvid` đã có sẵn), kèm Socket.IO handshake `wss://livechat.pump.fun`, và Performance API resource entries.

## Confirmed-live endpoints (frontend-api-v3.pump.fun)

| Endpoint | Status | Trả về | Dùng cho |
|---|---|---|---|
| `GET /coins/{mint}` | 200 | metadata coin đầy đủ: name, symbol, description, market_cap, market_cap_usd, reply_count, bonding_curve, creator, twitter/telegram/website, image_uri, video_uri, is_currently_live, ath_market_cap, program, chain_id | **CHƯA scrape — coin metadata/social links** |
| `GET /mint-positions/{mint}?sortBy=TOP&withThesis=true` | 200 | `{positions[],totalCount,hasMore}` — position.callout = thesis + PnL + KOL wallet | ĐÃ scrape |
| `GET /coins/currently-live` | 200 | `[{mint,name,viewers?...}]` — 53 coin live | ĐÃ scrape (livestream status) |
| `GET /users/{username}` | 200 | `{address,userId,is_pump_user,...}` — profile lookup by username | **CHƯA scrape — user→wallet resolve** |

## Confirmed-removed / 404 endpoints (v3)

`/replies/{mint}`, `/comments`, `/coins/{mint}/comments`, `/coins/{mint}/replies`, `/threads`, `/feed`, `/chat`, `/trades/{mint}`, `/coins/{mint}/trades`, `/coins/{mint}/holders`, `/coins/{mint}/callouts`, `/callouts/*`, `/coins/king-of-the-hill`, `/coins/featured/*`, `/coins/for-you`, `/coins/kolscan`, `/coins/{mint}/audit`, `/coins/{mint}/dev`, `/coins/{mint}/insiders`, `/coins/{mint}/bundle`, `/coins/{mint}/holders`, `/coins/{mint}/activity`, `/livestreams/*`, `/mint-callouts/*` → **tất cả 404**

## Other hosts discovered

| Host | Status | Note |
|---|---|---|
| `wss://livechat.pump.fun` | LIVE | Socket.IO v4, `joinRoom`/`getMessageHistory` — comments/replies feed (đã implement) |
| `livestream-api.pump.fun` | auth-gated | `/kols` 401; các path livestream 404 khi chưa auth — LiveKit token host |
| `profile-api.pump.fun` | 404 unauth | profile endpoints tồn tại nhưng không public khi chưa auth |
| `solana-mainnet.pump.fun` | live (RPC) | Solana RPC proxy riêng của pump.fun (frontend dùng cho on-chain reads) |
| `clips.pump.fun` | live (HLS) | `.ts` + `.m3u8` livestream clip segments — video content |
| `frontend-api-v2.pump.fun` | 530/503 | deprecated — không dùng |
| `advanced-api-v2.pump.fun` | dead | `/coins/kolscan` không còn — kolscan endpoint đã chuyển/xóa |

## Frontend pages (RSC, server-rendered — không phải REST)

`/explore`, `/leaderboard`, `/live`, `/mayhem`, `/holder-rewards`, `/go`, `/orders`, `/pump-token`, `/explore?feed=watchlist` — data nạp qua `_rsc` payloads (Next.js server components), không expose REST GET.

## Websocket / stream feeds ngoài livechat

- `wss://livechat.pump.fun` — coin comments/chat (joinRoom, getMessageHistory, sendMessage, addReaction, pinMessage, viewerHeartbeat)
- `wss://pumpportal.fun/api/data` — free newToken/trade/account stream (bên thứ 3, không phải pump.fun)
- LiveKit `wss://*.livekit.cloud` — livestream video/audio (auth token qua livestream-api)
- `*.pusher.com` — trong CSP (notifications)

## Scrapable bổ sung (chưa có trong crawler)

1. **`GET /coins/{mint}`** — coin metadata đầy đủ: market cap, reply_count, bonding_curve, creator, social links (twitter/telegram/website), image_uri, video_uri, ath_market_cap, program, chain_id. → **nên thêm `fetch_coin_meta` hoặc merge vào fetch_mint_social**.
2. **`GET /users/{username}`** — resolve username → Solana wallet + is_pump_user. → hữu ích map KOL/tác giả comment.
3. **Callouts feed** — UI hiển thị `/callouts/{mint}/{id}` với position/PnL/likes/replies nhưng REST endpoint đã 404; data giờ nạp qua RSC (server-side) hoặc livechat. `withThesis=true` trên mint-positions vẫn là nguồn callout duy nhất public.
4. **Livestream clips** (`clips.pump.fun`) — HLS video, giá trị lưu trữ/video-content; cần auth token để biết clip nào thuộc mint nào.
5. **`solana-mainnet.pump.fun`** — Solana RPC proxy; có thể đọc on-chain curve state (graduation%) mà không cần RPC riêng — nhưng đó là on-chain, không phải "social".

## Không scrape được (cần auth / không public)

- `livestream-api.pump.fun` + `profile-api.pump.fun` — 401/404 unauth; cần JWT Bearer.
- Pump.fun internal trade/order feed — không có public WS; PumpPortal (3rd party) là nguồn thay thế.
- Post comment (`POST /replies`) — cần JWT; read-only crawler hiện tại không cover.

## Sources

- Live browser probe `pump.fun/coin/{mint}` + `frontend-api-v3.pump.fun` (2026-09-25) — high
- Socket.IO handshake `wss://livechat.pump.fun` (2026-09-25) — high
- Performance API resource entries on pump.fun coin page (2026-09-25) — high
- Prior research `domain-pump-fun-gaps-cho-jev-trading-2026-09-24` — BankkRoll pumpfun-apis + DexScreener — med (stale on v3 endpoint list)
