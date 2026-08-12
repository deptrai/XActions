# Facebook API Reference

> REST API endpoints for Facebook automation, scraping, and session management.
> Verified 2026-08-12 — share-link-uid, marketplace, headless mode.

## Authentication

All endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <JWT_TOKEN>
```

Get a token via `POST /api/auth/register` or `POST /api/auth/login`.

## Facebook Session Cookie

Facebook uses a **cookie pair** for authentication:

| Cookie | Role | Format |
|---|---|---|
| `c_user` | Numeric user ID | 15-20 digits |
| `xs` | Session token | Long string with `%3A` |
| `datr` | Browser identifier | Optional but recommended |

See [facebook-session-cookie.md](facebook-session-cookie.md) for extraction instructions.

---

## Endpoints

### POST /api/facebook/scrape

Scrape Facebook data (profile, posts, followers, search, group-members, marketplace).

#### Request

```json
{
  "action": "profile | posts | followers | search | group-members | marketplace",
  "url": "https://www.facebook.com/...",
  "query": "search query (for search/marketplace)",
  "authCookie": {
    "c_user": "100012345678901",
    "xs": "12%3AabCdEf...",
    "datr": "..."
  },
  "headless": true
}
```

#### Actions

| Action | Required Param | Returns |
|---|---|---|
| `profile` | `url` | `{ name, username, bio, avatar, followers, url }` |
| `posts` | `url` | Array of `{ id, text, timestamp, likes, comments, url, media }` |
| `followers` | `url` | Array or `{ note }` if private |
| `search` | `query` | Array of `{ id, text, author, timestamp, url }` |
| `group-members` | `url` | Array of `{ name, profileUrl, username }` |
| `marketplace` | `query` | Array of `{ id, title, price, location, image, listingUrl }` |

#### headless Parameter

| Value | Behavior | Default |
|---|---|---|
| `true` | Browser runs invisibly (faster, production) | ✅ Default |
| `false` | Browser window visible (for debugging/monitoring) | |

---

### POST /api/facebook/automate

Run Facebook automation actions (like, comment, post, share, messenger-share, etc).

#### Request

```json
{
  "action": "like | comment | post | share | messenger-share | share-link-uid | ...",
  "urls": ["https://..."],
  "text": "content for comment/post",
  "dryRun": true,
  "headless": true,
  "authCookie": {
    "c_user": "100012345678901",
    "xs": "12%3AabCdEf...",
    "datr": "..."
  },
  "maxBatch": 20
}
```

#### share-link-uid

Share a post URL to specific Facebook users via Messenger using their UIDs.

```json
{
  "action": "share-link-uid",
  "postUrl": "https://www.facebook.com/groups/opensource/posts/123",
  "recipientUid": "1172593649275563",
  "recipientUids": ["uid1", "uid2"],
  "message": "Check this out!",
  "dryRun": false,
  "headless": false,
  "authCookie": { "c_user": "...", "xs": "..." }
}
```

**Response:**

```json
{
  "ok": true,
  "action": "share-link-uid",
  "dryRun": false,
  "headless": false,
  "postUrl": "https://...",
  "results": [
    {
      "uid": "1172593649275563",
      "ok": true,
      "sharesSent": 1,
      "method": "direct-messenger-url"
    }
  ],
  "successCount": 1,
  "totalCount": 1
}
```

**Flow (VERIFIED 2026-08-12):**
1. Navigate to `https://www.facebook.com/messages/t/{uid}`
2. Paste post URL via clipboard API into compose box
3. Press Enter to send

This approach is more reliable than the share dialog because:
- Works with UIDs directly (no display names needed)
- Doesn't require recipients to be in share dialog's friend list
- One-click send vs multi-step share dialog

#### messenger-share

Share a post via the native Facebook share dialog to Messenger recipients.

```json
{
  "action": "messenger-share",
  "postUrl": "https://...",
  "recipients": ["Friend Name 1", "Friend Name 2"],
  "content": "optional message",
  "dryRun": false,
  "authCookie": { "c_user": "...", "xs": "..." }
}
```

#### share

Share posts to your own timeline (share-to-Feed).

```json
{
  "action": "share",
  "urls": ["https://..."],
  "dryRun": false,
  "authCookie": { "c_user": "...", "xs": "..." }
}
```

#### Other Actions

| Action | Required Params | Description |
|---|---|---|
| `like` | `urls[]` | Like posts |
| `comment` | `urls[]`, `text` | Comment on posts |
| `post` | `text` | Create a new post |
| `join-groups` | `groupUrls[]` | Join Facebook groups |
| `batch-post-groups` | `groupUrls[]`, `text` | Post to multiple groups |
| `send-friend-requests` | `targets[]` | Send friend requests by profile URL |
| `cancel-friend-requests` | `olderThanDays`, `limit` | Cancel pending requests |
| `warmup-account` | `durationSeconds`, `allowReactions` | Warm up account with natural behavior |
| `warmup-scroll-feed` | `targetUrl`, `durationSeconds` | Scroll feed naturally |
| `schedule` | `text`, `scheduledAt`, `facebookAccountId` | Schedule a post |

---

### POST /api/facebook/accounts

Store Facebook account sessions (encrypted).

#### Request

```json
{
  "label": "My FB Account",
  "c_user": "100012345678901",
  "xs": "12%3AabCdEf..."
}
```

### GET /api/facebook/accounts

List stored accounts (returns only `id` and `label`, never cookie values).

### DELETE /api/facebook/accounts/:id

Delete a stored account.

---

## Headless Mode

Control browser visibility with the `headless` parameter:

| Value | Browser Visibility | Speed | Use Case |
|---|---|---|---|
| `true` | Invisible (background) | Faster | Production, batch operations |
| `false` | Visible window | Slower (longer delays for visibility) | Debugging, monitoring, CAPTCHA solving |

### Implementation Details

- **headless=true**: Uses `networkidle2` wait strategy, shorter delays (5-8s)
- **headless=false**: Uses `domcontentloaded` wait strategy, longer delays (8-12s) so you can see what's happening
- When visible, console logs show: `[uid] Conversation opened: ...` and `[uid] Sending message...`

---

## Error Handling

All endpoints return consistent error format:

```json
{
  "ok": false,
  "error": "Clear error message (no internal leak)"
}
```

### Common Errors

| Error | Cause | Solution |
|---|---|---|
| `No token provided` | Missing Authorization header | Add Bearer token |
| `Invalid token` | Expired or invalid JWT | Re-login to get new token |
| `action must be one of: ...` | Invalid action name | Check valid actions for endpoint |
| `requires url/query` | Missing required parameter | Provide the missing parameter |
| `Facebook automate failed` | Runtime error | Check server logs for details |
| `session expired or invalid` | Cookies expired | Re-extract cookies from browser |
| `security check detected` | Facebook CAPTCHA/checkpoint | Solve manually, get new cookies |

---

## Rate Limits & Best Practices

1. **Dry-run first**: Always test with `dryRun: true` before real operations
2. **Account risk**: Real writes can trigger Facebook restrictions — use test accounts
3. **Delays**: Built-in 1-3s delays between actions (human-like)
4. **Batch limits**: `maxBatch` defaults to 20 (hard cap)
5. **Cookie rotation**: Rotate cookies every 3-6 months or after security events

---

## Selectors Reference

See [selectors-facebook.md](selectors-facebook.md) for complete DOM selector documentation including:
- Profile, Posts, Search selectors
- **Marketplace selectors** (verified 2026-08-12)
- Login & 2FA selectors
- Messenger share dialog selectors
