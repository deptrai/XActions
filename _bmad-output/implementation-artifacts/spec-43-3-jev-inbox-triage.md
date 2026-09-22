---
title: 'Story 43.3: jev-inbox-triage'
type: 'feature'
created: '2026-09-22'
status: 'done'
baseline_revision: 'bf4883b7'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '_bmad-output/implementation-artifacts/epic-42-context.md'
  - 'CLAUDE.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `getConversations` trong `src/dmManager.js` trả `{name, lastMessage, time, unread}` — không có intent classification, không có toxic filter, không có priority. `api/routes/ai/messages.js` chỉ queue scrape jobs, không có triage. `notifications.js` chỉ gửi webhook, không phân loại.

**Approach:** Thêm `src/inbox/jevInboxTriage.js` — `triageConversation(conv)` + `triageInbox(conversations)` qua Jev `decide` (1 call/conversation: `intent` Choice 5 options + `toxic` Noul + `priority` Score 0-3). Cắm vào `api/routes/ai/messages.js` — thêm `POST /triage` sync endpoint nhận `{conversations: [{name, lastMessage, time, unread}]}` → trả `{triaged: [{..., intent, toxic, priority, action}]}`. `action` = `reply` (intent=lead/support/friend & priority>=2) | `escalate` (intent=lead & priority=3) | `ignore` (intent=spam/ignore) | `review` (borderline).

## Boundaries & Constraints

**Always:**
- Jev qua `JevBrain` instance — không module nào gọi `api.typesafe.ai` trực tiếp.
- `triageConversation({name, lastMessage, time, unread}, {brain})` — 1 call/3 questions: `intent` Choice, `toxic` Noul, `priority` Score(0-3).
- `intent` criteria: `{spam, lead, support, friend, ignore}` — Jev trả 1 trong 5.
- `toxic` Noul — "this message contains harassment, threats, or scam content" (noul >= 0.5 → toxic flag).
- `priority` Score(0-3) — "how urgently this message needs a response" (0=never, 1=low, 2=soon, 3=urgent).
- `action` mapping: `intent='spam'` OR `toxic>=0.5` → `'ignore'`; `intent='lead'` AND `priority>=3` → `'escalate'`; `intent` ∈ `['lead','support','friend']` AND `priority>=2` → `'reply'`; else → `'review'`.
- Degraded → `triageConversation` trả `{...conv, intent:'unknown', toxic:0, priority:0, action:'review'}` — không block triage.
- `POST /api/ai/messages/triage` — **sync** endpoint (không queueOp), session optional.
- Test: vitest, `vi.stubGlobal('fetch')` — mirror pattern.
- ESM, JSDoc, `// by nichxbt`.

**Never:**
- `queueOp` cho triage endpoint — sync.
- Đụng `getConversations` / `exportConversation` — giữ nguyên (caller ghép triage sau khi có data).
- Đụng `notifications.js` (webhook-only) — triage là DM concern.
- Auto-reply DMs — triage chỉ classify + recommend action, không act.
- Hardcode thresholds — dùng `confidenceThresholds` pattern.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected | Error |
|----------|-------|----------|-------|
| High-value lead | `{lastMessage:'Need pricing for your automation tool'}` | `intent:'lead'`, `priority:3` → `action:'escalate'` | none |
| Support question | `{lastMessage:'How do I export my data?'}` | `intent:'support'`, `priority:2` → `action:'reply'` | none |
| Spam DM | `{lastMessage:'Earn $500/day working from home!'}` | `intent:'spam'` → `action:'ignore'` | none |
| Toxic message | `{lastMessage:'threats/harassment'}` | `toxic>=0.5` → `action:'ignore'` | none |
| Friend chat | `{lastMessage:'hey how are you'}` | `intent:'friend'`, `priority:1` → `action:'review'` | none |
| Degraded | no API key | `action:'review'`, `intent:'unknown'` | none |
| Empty conversations | `[]` | `{triaged:[]}` | 400 |
| Missing lastMessage | `{name:'user'}` | still processes (Jev works on available fields) | none |

</intent-contract>

## Code Map

- `src/inbox/jevInboxTriage.js` — NEW: `triageConversation` + `triageInbox` — 1-call/3-questions per conversation.
- `api/routes/ai/messages.js` — ADD `POST /triage` sync endpoint.
- `src/dmManager.js` — READ-ONLY: `getConversations` output shape `{name, lastMessage, time, unread}` — triage consumes this shape.
- `tests/inbox/jevInboxTriage.test.js` — NEW: unit tests.
- `tests/api/jev-inbox-triage.test.js` — NEW: route test.

## Tasks & Acceptance

**Execution:**
- `src/inbox/jevInboxTriage.js` — NEW: triageConversation + triageInbox.
- `api/routes/ai/messages.js` — ADD `POST /triage` sync endpoint.
- `tests/inbox/jevInboxTriage.test.js` — NEW: intent classification, toxic flag, priority scoring, action mapping, degraded.
- `tests/api/jev-inbox-triage.test.js` — NEW: route test.

**Acceptance Criteria:**
- Given `triageConversation({lastMessage:'Need pricing'})` Jev returns `intent:'lead', priority:3` → `action:'escalate'`.
- Given `triageConversation({lastMessage:'spam link'})` Jev returns `intent:'spam'` → `action:'ignore'`.
- Given `triageConversation({lastMessage:'help me'})` Jev returns `intent:'support', priority:2` → `action:'reply'`.
- Given toxic message Jev returns `toxic.noul=0.8` → `action:'ignore'` regardless of intent.
- Given degraded → `action:'review'`, `intent:'unknown'`.
- Given `POST /api/ai/messages/triage` with 3 conversations → `{triaged:[3 items with action]}`.
- Given `npx vitest run tests/inbox/ tests/api/jev-inbox-triage.test.js` → pass.

## Spec Change Log

## Review Triage Log

**Auto Run Result (2026-09-22)**
- `src/inbox/jevInboxTriage.js` (new): `triageConversation(conv)` — 1-call/3-questions (intent Choice 5 options: spam/lead/support/friend/ignore + toxic Noul + priority Score 0-3); action mapping toxic>=0.5/spam→ignore, lead+urgent→escalate, reply-worthy→reply, else→review; degraded→review/unknown. `triageInbox(conversations)` batch sequential + stats aggregation (reply/escalate/ignore/review counts).
- `api/routes/ai/messages.js`: `POST /triage` sync endpoint — receives `{conversations: [{name, lastMessage, time, unread}]}` + session cookie header/body → returns `{triaged, stats}`; validation 400 when empty/missing.
- `src/dmManager.js`: READ-ONLY — `getConversations` output shape matches triage input contract.
- `tests/inbox/jevInboxTriage.test.js` (new, 9 tests): lead escalate, support reply, spam ignore, toxic override, friendly review, empty lastMessage, degraded review, batch triage + stats, empty inbox.
- `tests/api/jev-inbox-triage.test.js` (new, 4 tests): triage endpoint success, 400 empty, 400 missing, degraded fallback. Session cookie required by messages.js middleware verified.
- Verify: 27/27 Epic 43 tests pass (writeGate + moderation + triage).


## Design Notes

- **3 questions per call:** `intent` Choice + `toxic` Noul + `priority` Score — 1 call/conversation (~300ms).
- **Action mapping matrix:** toxic/spam → ignore (absolute); lead+urgent → escalate; reply-worthy → reply; else → review.
- **Conversation shape:** `{name, lastMessage, time, unread}` — matches `getConversations` output; `unread` unused in Jev call (context for caller).
- **Degraded:** conservative → `action:'review'` + `intent:'unknown'` — never auto-ignore on missing signal.
- **Sync endpoint:** `/api/ai/messages/triage` — processes provided conversations synchronously (caller fetches conversations via `/conversations` first, then posts to `/triage`).

## Verification

**Commands:**
- `npx vitest run tests/inbox/ tests/api/jev-inbox-triage.test.js` -- expected: all pass.
- `npx vitest run tests/agents/jevBrain.test.js` -- regression.
