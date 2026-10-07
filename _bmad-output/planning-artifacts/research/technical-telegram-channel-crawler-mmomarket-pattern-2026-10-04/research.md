---
title: 'technical research: Telegram Channel Crawler — Mmomarket-Proven MTProto Relay Pattern'
type: 'technical'
topic: 'telegram-channel-crawler'
decision: 'Kiến trúc cho Story 54.6 (Epic 54 Token Sentiment Intelligence): dùng GramJS MTProto user-client theo relay-service pattern đã proven production tại mmomarket.org vs Bot API vs third-party libs.'
source: 'codebase-derived (mmomarket.org production code)'
status: complete
preset: 'standard'
validation: 'code-verified'
created: '2026-10-04'
updated: '2026-10-04'
---

# Technical research: Telegram Channel Crawler — Mmomarket-Proven Pattern

**Decision this research serves:** Kiến trúc implementation cho Story 54.6 — Telegram Crypto Channel Crawler trong Epic 54. Nguồn chính: production code `~/Documents/GitHub/mmomarket.org/apps/telegram-relay/` (Story 6.x, done 2026-09-20) — đã chạy thật, không phải lý thuyết.

---

## Executive Summary

**Kết luận: dùng GramJS (`telegram@2.26.22`) MTProto user-client trong một standalone relay service — copy nguyên pattern mmomarket.** Mọi bài học khó (session lifecycle, FLOOD_WAIT, ban detection, single-flight) đã được giải và tested trong production.

**3 phát hiện then chốt:**

1. **GramJS đủ cho cả 2 use case** — mmomarket dùng cho bot interaction (send/press/collect), nhưng cùng `TelegramClient` đó support `getMessages(entity)` + `NewMessage` events cho channel reading. Không cần thêm lib.
2. **Relay-service pattern bắt buộc** — MTProto session giữ state (auth key, update state) → không thể nhúng vào process chính có multi-instance. Standalone service + HTTP interface = cách mmomarket giải, Medirus nên copy y hệt (kể cả Dockerfile pattern).
3. **Error taxonomy đã được enumerate** — FLOOD_WAIT_N (parse → cooldown), SESSION_BANNED (terminal), isBusy single-flight. Không phải reinvent.

---

## 1. Stack đã verify trong production

| Thành phần | mmomarket implementation | Dùng lại cho Medirus? |
|---|---|---|
| Library | `telegram@2.26.22` (GramJS, pure JS, no native deps) | ✅ Copy version pin |
| Session | `StringSession` — string env var `TELEGRAM_SESSION` | ✅ Copy |
| Login | `login.js` CLI interactive: phone + OTP + 2FA password → `client.session.save()` | ✅ Copy gần như nguyên |
| Env | `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (my.telegram.org), `TELEGRAM_SESSION`, `RELAY_AUTH_TOKEN` | ✅ Copy naming |
| Node | `node:22-alpine` + `--disable-warning=ExperimentalWarning` (GramJS localStorage warning) | ✅ Copy CMD flag |
| HTTP surface | `/liveness` (no auth), `/health` (auth + busy/cooldown/banned state), `POST /relay` | ⚠️ Đổi `/relay` → `/channel` endpoints |
| Deploy | Dockerfile riêng, EXPOSE internal port only | ✅ Copy pattern |

## 2. Resilience patterns đã enumerate (copy y nguyên)

```js
// FLOOD_WAIT: parse wait seconds → cooldown + buffer
const floodMatch = errMsg.match(/FLOOD_WAIT_(\d+)/i) || errMsg.match(/wait of (\d+) seconds/i);
cooldownUntil = Date.now() + (seconds * 1000 + 5000);

// Terminal errors → permanently_unhealthy, disconnect client
const terminalKeywords = [
  "USER_DEACTIVATED_BAN", "USER_DEACTIVATED",
  "AUTH_KEY_UNREGISTERED", "SESSION_REVOKED", "SESSION_EXPIRED",
];

// Single-flight: một session = một operation tại một thời điểm
if (isBusy) return 503 "RELAY_BUSY";
```

- Health model 3 trạng thái: `healthy` / `cooldown` (kèm `cooldownMs` remaining) / `permanently_unhealthy` (`SESSION_BANNED`).
- Auth: Bearer token `RELAY_AUTH_TOKEN` (≥32 hex), compare bằng `timingSafeEqual` trên SHA-256 hash — tránh timing attack.
- Startup validation: env check chặt (`validateStartupEnv`) — fail-fast, không chạy nửa vời.

## 3. Khác biệt use case: bot-interaction → channel-reading

mmomarket đọc **bot conversations** (send command → collect replies, `getMessages(entity, {limit})` đã dùng trong code+tests). Medirus Story 54.6 cần **channel/group reading**:

| Cần thêm (GramJS API, không cần research thêm) | Mục đích |
|---|---|
| `client.getEntity('@channelname' \| channelId)` | Resolve channel → entity (đã dùng trong relay) |
| `client.getMessages(entity, { limit, minId })` | Poll history — **đã verify trong mmomarket spec/tests** |
| `client.addEventHandler(handler, new NewMessage({ chats: [entities] }))` | Realtime push — thay polling; GramJS native |
| `client.iterDialogs()` | Channel discovery: list mọi channel/group account đang join |
| `GetFullChannelRequest` / `channels.getFullChannel` | `member_count`, `about` metadata cho channel registry |

**Mapping sang PostItem (Epic 14 contract):**
`{ id: msg.id, platform: 'telegram', author: msg.senderId/msg.postAuthor, text: msg.message, ts: msg.date, channelId, forwardFrom: msg.fwdFrom }` — `fwdFrom` là native GramJS field cho forward-chain trace (AC của 54.6).

## 4. Bot API vs MTProto — quyết định cho 54.6

| | Bot API (`getUpdates`) | MTProto (GramJS) — **CHỌN** |
|---|---|---|
| Coverage | Chỉ channel/group **bot được add làm admin/member** | Mọi **public** channel + group user đã join |
| Crypto channel coverage | Thấp — crypto channels không add bot lạ | Cao — join public channels = đọc được |
| Session | Bot token, không ban risk cho user | User session — **ban risk có thật** (đã có terminal-error handling) |
| Realtime | Webhook/poll | `NewMessage` events native |
| mmomarket proof | Không dùng | ✅ Production |

**Khuyến nghị hybrid-lite:** MTProto là primary (coverage). Bot API chỉ đáng cân nhắc nếu jev tự host bot trong các channel riêng — edge case, defer.

## 5. Rủi ro & mitigations

| Rủi ro | Mitigation (đã có sẵn trong pattern) |
|---|---|
| Session ban (read-heavy vào nhiều channel) | Terminal-error detection → `permanently_unhealthy` + alert; session là 1 phone number riêng, không dùng account chính |
| FLOOD_WAIT khi poll nhiều channel | Cooldown parser + `AdaptiveRateGovernor` integration (Epic 11) — TG flood limit strict hơn X |
| Session string lộ (auth key full quyền) | `TELEGRAM_SESSION` = secret như password; relay chỉ bind internal, token auth, timing-safe compare |
| Multi-instance race trên 1 session | Single-flight `isBusy` + single relay instance (không scale ngang bằng replicate — scale = thêm session) |
| Private/invite-only channels | Out of scope MVP — chỉ public channels + group user join được |

## 6. Estimates hiệu chỉnh theo pattern có sẵn

| Hạng mục | Effort | Cơ sở |
|---|---|---|
| Relay service skeleton (copy mmomarket) | 0.5d | `main.js` + `relay-core.js` port, bỏ bot-steps giữ channel-endpoints |
| Channel registry + iterDialogs discovery | 1d | net-new, đơn giản |
| getMessages poll → PostItem → stream publish | 1–2d | normalize + pipeline hook (54.2) |
| NewMessage realtime events | 1d | GramJS native, wire vào stream |
| Forward-chain (fwdFrom) + member_count | 0.5d | fields sẵn |
| MCP/REST surface + governor integration | 1–2d | pattern sẵn (Epic 52, 11) |
| Tests (spec pattern sẵn: relay-core.spec 522 lines) | 1–2d | |
| **Total** | **~5–8 dev-days** | vs ước lượng cũ 1–2 tuần — giảm nhờ pattern reuse |

## 7. Open Questions

1. **Ai sở hữu phone number + session?** — cần SIM/account riêng cho service (khuyến nghị); OTP login chạy 1 lần qua `login.js` CLI.
2. **Channel list seed** — jev supply curated crypto TG channels (tiếng Anh + VN); coverage VN là differentiator chính.
3. **Join rate-limit** — TG giới hạn join ~50 channels/ngày/account; watchlist lớn cần chiến lược join dần.

## 8. Source Appendix

| # | Claim | Source | Confidence |
|---|---|---|---|
| [1] | GramJS `telegram@2.26.22` production-proven | `mmomarket.org/apps/telegram-relay/package.json` | high |
| [2] | StringSession + interactive login CLI | `apps/telegram-relay/src/login.js` | high |
| [3] | FLOOD_WAIT → cooldown, terminal→SESSION_BANNED, isBusy | `apps/telegram-relay/src/main.js` | high |
| [4] | `getMessages(entity,{limit,minId})` used | `relay-core.js` + spec mocks | high |
| [5] | timingSafeEqual auth, /health 3-state | `main.js` | high |
| [6] | Node22-alpine + disable-warning flag | `docker/Dockerfile.telegram-relay` | high |
| [7] | Epic 6 done status 2026-09-20 | `docs/features/epic-06-telegram-relay-sync.md` | high |
| [8] | NewMessage events, iterDialogs, GetFullChannel | GramJS public API (not yet in mmomarket code — first use for Medirus) | medium |

## 9. Staleness Map

| Claim class | Freshness bar | Re-check |
|---|---|---|
| GramJS version/API surface | ≤ 3 tháng (lib active) | 2027-01-04 |
| mmomarket pattern validity | stable — code-verified | khi mmomarket Epic 6 có revision |
| TG flood limits | ≤ 6 tháng | 2027-04-04 |

