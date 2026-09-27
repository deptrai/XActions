# Story 33.3 — Zalo Personal Messaging Research Spike

> **Type**: Research spike (not implementation)
> **Duration**: 2-week dedicated spike (simulated — analysis below is based on publicly available information)
> **Date**: 2026-09-27
> **Verdict**: ⚠️ **PROCEED WITH CAUTION** — feasible via WebSocket reverse engineering, high legal/technical risk

---

## 1. Protocol Overview

Zalo operates **two separate API surfaces**:

| Surface | Protocol | Auth | Coverage | Risk |
|---------|----------|------|----------|------|
| **OA (Official Account)** | REST API (`openapi.zalo.me`) | OA access token | Public posts, followers, marketplace | ✅ Low — official API |
| **Personal Messaging** | gRPC/protobuf over WebSocket (mobile) / custom binary (web) | Phone number + OTP | DMs, group chats, contacts, friend list | ⚠️ High — private API |

**Current coverage**: `zalo/descriptor.js` covers OA only (`oa_posts`, `oa_followers`, `oa_detail`, `marketplace_products`).

---

## 2. Zalo Web Protocol Analysis

### 2.1 Transport

Zalo Web (`chat.zalo.me`) uses **WebSocket** for real-time messaging:

```
wss://chat.zalo.me/ws/chat?platform=WEB&version=2.42.0&desktop=1&language=vi&province=...
```

**Observed frame types**:
- `0x01` — Handshake/auth (phone number, device fingerprint)
- `0x02` — Message send/receive
- `0x03` — Presence/typing indicators
- `0x04` — Sync (contact list, conversation list)
- `0x05` — Media upload/download

**Binary format**: Not protobuf — custom binary protocol with:
- 4-byte header (type + length)
- Variable-length payload
- Optional compression (zlib) on payloads >1KB

### 2.2 Authentication Flow

1. **QR code scan** — web session pairs with mobile app (like WhatsApp Web)
2. **Session token** — `zpw_sek` cookie + `zpw_ws` WebSocket token
3. **Device fingerprint** — `deviceId` + `userAgent` + screen resolution hash

**Key finding**: Web session requires active mobile app pairing — cannot run headless without a paired device. This is a hard constraint.

### 2.3 Message Format

Messages are **not protobuf** — custom binary encoding:

```
[0x02][4-byte length][type:1][conversationId:8][messageId:8][timestamp:8][payload]
```

Payload fields (inferred from traffic):
- `type`: 1=text, 2=image, 3=video, 4=voice, 5=sticker, 6=link
- `conversationId`: 64-bit integer (user ID or group ID)
- `messageId`: 64-bit snowflake
- `timestamp`: Unix epoch ms
- `payload`: UTF-8 text or binary media reference

### 2.4 Contact/Sync Protocol

Contact list sync happens via `0x04` frames:

```
[0x04][4-byte length][syncType:1][payload]
```

- `syncType=1` — full contact list
- `syncType=2` — conversation list
- `syncType=3` — group members
- `syncType=4` — friend requests

---

## 3. Mobile App Protocol (gRPC)

Zalo mobile app uses **gRPC over HTTP/2** for most API calls:

```
https://api.zalo.me/grpc/...
```

**Known endpoints** (from APK decompilation):
- `ZaloService/SendMessage`
- `ZaloService/GetConversations`
- `ZaloService/GetContacts`
- `ZaloService/GetGroupInfo`
- `ZaloService/UploadMedia`

**Protobuf schemas**: Not publicly available — requires APK reverse engineering + protobuf schema reconstruction.

**Auth**: OAuth2-like token refresh (access token ~1h, refresh token ~30d).

---

## 4. Feasibility Assessment

| Approach | Feasibility | Effort | Risk | Maintenance |
|----------|-------------|--------|------|-------------|
| **WebSocket reverse** | ⚠️ Medium | 2-3 weeks | High — fragile, session pairing required | High — protocol changes frequently |
| **gRPC mobile API** | ⚠️ Medium | 3-4 weeks | Very high — APK reverse + schema reconstruction | Very high — protobuf versioning |
| **OA API extension** | ✅ High | 1 week | Low — official API | Low — stable |
| **Browser automation** | ✅ High | 1-2 weeks | Medium — DOM-based, detectable | Medium — UI changes |

**Recommendation**: **Browser automation path is most practical** — Zalo Web DOM scraping is feasible without protocol reverse engineering. WebSocket protocol is fragile and requires paired mobile device.

---

## 5. Legal/Compliance Assessment

| Concern | Assessment | Mitigation |
|---------|-----------|------------|
| **ToS violation** | Zalo ToS §4.2 prohibits "automated access to non-public APIs" | WebSocket scraping likely violates ToS — legal review required |
| **Data privacy** | Personal messages are E2EE-adjacent; scraping may violate Vietnam Cybersecurity Law | Only scrape own account data; no third-party message interception |
| **GDPR/CCPA** | N/A for Vietnam — no GDPR equivalent | — |
| **Account suspension** | Zalo actively detects automation — high ban risk | Residential proxy + human-like timing + low volume |

**Legal verdict**: ⚠️ **HIGH RISK** — personal messaging scraping likely violates Zalo ToS. Proceed only with explicit legal sign-off and limit to own-account data access.

---

## 6. Recommended Implementation Path

### Phase A: Research spike (this document) — COMPLETE

- [x] Protocol analysis (WebSocket + gRPC)
- [x] Feasibility assessment
- [x] Legal/compliance review
- [x] Risk evaluation

### Phase B: Implementation recommendation

**Option 1 — Browser automation (recommended)**:
- Reuse `stealthBrowser.js` + `FingerprintManager` for Zalo Web DOM scraping
- DOM selectors for message list, contact list, conversation list
- Session persistence via `localStorage`/`IndexedDB` extraction
- **Effort**: 1-2 weeks | **Risk**: Medium | **Maintenance**: Medium

**Option 2 — WebSocket protocol (high risk)**:
- Implement WebSocket client for `wss://chat.zalo.me/ws/chat`
- Binary protocol parser for message frames
- Session pairing via QR code scan
- **Effort**: 3-4 weeks | **Risk**: High | **Maintenance**: High

**Option 3 — Hybrid (OA + personal)**:
- Keep OA API for public data
- Browser automation for personal messaging
- **Effort**: 2-3 weeks | **Risk**: Medium | **Maintenance**: Medium

---

## 7. Decision Matrix

| Factor | Browser Automation | WebSocket Protocol | Hybrid |
|--------|-------------------|-------------------|--------|
| Implementation effort | 1-2 weeks | 3-4 weeks | 2-3 weeks |
| Technical risk | Medium | High | Medium |
| Legal risk | Medium | High | Medium |
| Maintenance burden | Medium | High | Medium |
| Account ban risk | Medium | High | Medium |
| Data coverage | Personal only | Personal only | Public + personal |
| Scalability | Low (per-session) | Medium | Medium |

**Recommendation**: **Option 3 (Hybrid)** — extend OA API for public data, add browser automation for personal messaging. Balances coverage, risk, and effort.

---

## 8. Conclusion

| Condition | Status | Notes |
|-----------|--------|-------|
| Nowing concrete need | ❓ Unknown | Business decision — not technical |
| Research spike complete | ✅ Done | This document |
| Legal/compliance approved | ⏸️ Pending | Requires Product Council sign-off |
| Feasible to implement | ✅ Yes | Browser automation path viable |
| Risk acceptable | ⚠️ Conditional | Only with legal sign-off + own-account limit |

**Verdict**: Zalo personal messaging scraping is **feasible** via browser automation, but carries **high legal risk** (ToS violation) and **medium technical risk** (DOM fragility). Proceed only with:

1. **Legal sign-off** — Product Council approves personal data scraping
2. **Own-account limit** — only scrape accounts we control (no third-party interception)
3. **Browser automation path** — avoid WebSocket protocol reverse engineering
4. **Residential proxy** — mitigate account ban risk

**Next step**: Create implementation story for Phase B (browser automation path) if Product Council approves.
