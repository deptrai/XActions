---
title: 'fix-facebook-api-params-validation'
type: 'bugfix'
created: '2026-08-10T18:10:00Z'
status: 'done'
baseline_commit: 'ff4d92977d2bb8b01109dd43c8b982aa8e1563ad'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 3 Facebook automation APIs fail with validation errors due to mismatched parameter names between route handler and service functions: `send-friend-requests` missing `mode`, `batch-post-groups` uses `text` instead of `content`, `cancel-friend-requests` missing default `limit`.

**Approach:** Fix the route handler in `api/routes/facebook.js` to pass correctly shaped input to each service function, adding sensible defaults where needed.

## Boundaries & Constraints

**Always:** Keep changes isolated to route handler parameter mapping. Do not modify service function signatures.

**Ask First:** Default `limit` value for cancel-friend-requests (recommend: 10).

**Never:** Do not change the service function validation logic. Do not add new features.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| batch-post-groups happy | `{ groupUrls: [...], text: "hello" }` | Calls `postToFacebookGroups` with `{ groupUrls, content: "hello" }` | N/A |
| send-friend-requests with targets | `{ targets: [...] }` | Calls `sendFriendRequests` with `{ mode: 'uid_list', targets }` | N/A |
| send-friend-requests without targets | `{}` | Validation error from service function | Error propagated |
| cancel-friend-requests with limit | `{ limit: 5 }` | Calls with provided limit | N/A |
| cancel-friend-requests without limit | `{}` | Calls with default limit (10) | N/A |

</frozen-after-approval>

## Code Map

- `api/routes/facebook.js` -- Route handler that maps HTTP body to service function calls (lines 395-412)
- `api/services/facebookAutomation.js` -- Service functions with validation (lines 1564-1596, 1835-1861, 2114-2129)

## Tasks & Acceptance

**Execution:**
- [x] `api/routes/facebook.js` -- Fix `batch-post-groups` to pass `content: text` instead of `text` -- field name mismatch
- [x] `api/routes/facebook.js` -- Fix `send-friend-requests` to pass `mode: 'uid_list'` when targets provided -- missing required param
- [x] `api/routes/facebook.js` -- Fix `cancel-friend-requests` to pass default `limit: 10` when not provided -- missing required param
- [x] `api/routes/facebook.js` -- Fix `cancel-friend-requests` dryRun to launch browser (needs page for preview collection)

**Acceptance Criteria:**
- Given `batch-post-groups` request with `text`, when route handler calls service, then `content` field is populated
- Given `send-friend-requests` request with `targets`, when route handler calls service, then `mode` is `'uid_list'`
- Given `cancel-friend-requests` request without `limit`, when route handler calls service, then `limit` defaults to 10

## Verification

**Commands:**
- `curl -s -X POST http://localhost:3001/api/facebook/automate -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"action":"batch-post-groups","groupUrls":["https://www.facebook.com/groups/opensource"],"text":"test","authCookie":$COOKIE,"dryRun":true}'` -- expected: `{"ok":true}`
- `curl -s -X POST http://localhost:3001/api/facebook/automate -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"action":"send-friend-requests","targets":["https://www.facebook.com/nichxbt"],"authCookie":$COOKIE,"dryRun":true}'` -- expected: `{"ok":true}`
- `curl -s -X POST http://localhost:3001/api/facebook/automate -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"action":"cancel-friend-requests","authCookie":$COOKIE,"dryRun":true}'` -- expected: `{"ok":true}`

**Manual checks (if no CLI):**
- Verify each dryRun request returns `ok: true` instead of `ok: false` with validation error

## Suggested Review Order

- Entry point: batch-post-groups param fix (text → content)
  [`facebook.js:400`](../../api/routes/facebook.js#L400)
- send-friend-requests: added mode 'uid_list'
  [`facebook.js:404`](../../api/routes/facebook.js#L404)
- cancel-friend-requests: default limit=10
  [`facebook.js:407`](../../api/routes/facebook.js#L407)
- cancel-friend-requests: dryRun browser exception
  [`facebook.js:435`](../../api/routes/facebook.js#L435)
