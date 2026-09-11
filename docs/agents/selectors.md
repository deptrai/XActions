# X/Twitter DOM Selectors Reference

> Verified January 2026. X/Twitter frequently changes DOM. Test selectors before relying on them.

## Common

| Element | Selector |
|---------|----------|
| Tweet | `article[data-testid="tweet"]` |
| Tweet text | `[data-testid="tweetText"]` |
| User cell | `[data-testid="UserCell"]` |
| Back button | `[data-testid="app-bar-back"]` |
| Confirmation dialog | `[data-testid="confirmationSheetConfirm"]` |
| Search input | `[data-testid="SearchBox_Search_Input"]` |
| User actions menu | `[data-testid="userActions"]` |
| Verification badge | `[data-testid="icon-verified"]` |
| Toast notification | `[data-testid="toast"]` |

## Posting & Compose

| Element | Selector |
|---------|----------|
| Compose button | `a[data-testid="SideNav_NewTweet_Button"]` |
| Tweet text area | `[data-testid="tweetTextarea_0"]` |
| Post button | `[data-testid="tweetButton"]` |
| Thread add | `[data-testid="addButton"]` |
| Media button | `[data-testid="fileInput"]` |
| Poll button | `[aria-label="Add poll"]` |
| Schedule button | `[data-testid="scheduleOption"]` |
| GIF button | `[aria-label="Add a GIF"]` |
| Emoji button | `[aria-label="Add emoji"]` |
| Alt text | `[data-testid="altTextInput"]` |
| Inline post button | `[data-testid="tweetButtonInline"]` |

## Engagement

| Element | Selector |
|---------|----------|
| Like button | `[data-testid="like"]` |
| Unlike button | `[data-testid="unlike"]` |
| Reply button | `[data-testid="reply"]` |
| Retweet button | `[data-testid="retweet"]` |
| Confirm retweet | `[data-testid="retweetConfirm"]` |
| Unretweet | `[data-testid="unretweet"]` |
| Confirm unretweet | `[data-testid="unretweetConfirm"]` |
| Share button | `[data-testid="share"]` |
| Bookmark button | `[data-testid="bookmark"]` |
| Remove bookmark | `[data-testid="removeBookmark"]` |
| Hide reply | `[data-testid="hideReply"]` |
| Engagements count | `[data-testid="engagements"]` |
| Impressions | `[data-testid="impressions"]` |

## Following & Followers

| Element | Selector |
|---------|----------|
| Unfollow button | `[data-testid$="-unfollow"]` |
| Follows you indicator | `[data-testid="userFollowIndicator"]` |
| Block option | `[data-testid="block"]` |

## Profile

| Element | Selector |
|---------|----------|
| Edit profile button | `[data-testid="editProfileButton"]` |
| Avatar edit | `[data-testid="editProfileAvatar"]` |
| Header edit | `[data-testid="editProfileHeader"]` |
| Save button | `[data-testid="Profile_Save_Button"]` |

## Direct Messages

| Element | Selector |
|---------|----------|
| New message button | `[data-testid="NewDM_Button"]` |
| Search people | `[data-testid="searchPeople"]` |
| Message input | `[data-testid="dmComposerTextInput"]` |
| Send button | `[data-testid="dmComposerSendButton"]` |
| Conversation list | `[data-testid="conversation"]` |
| Message bubble | `[data-testid="messageEntry"]` |

## Communities

| Element | Selector |
|---------|----------|
| Communities nav | `a[aria-label="Communities"]` |
| Community links | `a[href^="/i/communities/"]` |
| Community name | `[data-testid="communityName"]` |
| Joined button | `button[aria-label^="Joined"]` |

## Lists

| Element | Selector |
|---------|----------|
| Create list | `[data-testid="createList"]` |
| List name | `[data-testid="listName"]` |
| List description | `[data-testid="listDescription"]` |
| Pin list | `[data-testid="pinList"]` |
| Add member | `[data-testid="addMember"]` |

## Bookmarks

| Element | Selector |
|---------|----------|
| Bookmark folder | `[data-testid="bookmarkFolder"]` |
| Create folder | `[data-testid="createBookmarkFolder"]` |

## Spaces

| Element | Selector |
|---------|----------|
| Start Space | `[data-testid="SpaceButton"]` |
| Join Space | `[data-testid="joinSpace"]` |
| Speaker list | `[data-testid="spaceSpeakers"]` |
| Listener count | `[data-testid="spaceListeners"]` |
| Recording | `[data-testid="spaceRecording"]` |
| Schedule | `[data-testid="scheduleSpace"]` |

## Articles

| Element | Selector |
|---------|----------|
| Article compose | `a[href="/compose/article"]` |
| Title input | `[data-testid="articleTitle"]` |
| Body editor | `[data-testid="articleBody"]` |
| Publish button | `[data-testid="articlePublish"]` |
| Draft save | `[data-testid="articleSaveDraft"]` |
| Cover image | `[data-testid="articleCoverImage"]` |
| Toolbar | `[data-testid="articleToolbar"]` |

## Explore & Discovery

| Element | Selector |
|---------|----------|
| Trend items | `[data-testid="trend"]` |
| Topic follow | `[data-testid="TopicFollow"]` |
| Search results | `[data-testid="TypeaheadListItem"]` |

## Settings & Notifications

| Element | Selector |
|---------|----------|
| Toggle switch | `[data-testid="settingsSwitch"]` |
| Protected toggle | `[data-testid="protectedTweets"]` |
| Notification cells | `[data-testid="notification"]` |

## Grok AI

| Element | Selector |
|---------|----------|
| Chat input | `[data-testid="grokInput"]` |
| Send button | `[data-testid="grokSendButton"]` |
| Response area | `[data-testid="grokResponse"]` |
| New chat | `[data-testid="grokNewChat"]` |
| Image gen | `[data-testid="grokImageGen"]` |
| Loading indicator | `[data-testid="grokLoading"]` |

## Monetization & Ads

| Element | Selector |
|---------|----------|
| Revenue tab | `[data-testid="revenueTab"]` |
| Analytics tab | `[data-testid="analyticsTab"]` |
| Followers chart | `[data-testid="followersChart"]` |
| Boost button | `[data-testid="boostButton"]` |
| Ads dashboard | `[data-testid="adsDashboard"]` |
| Campaign list | `[data-testid="campaignList"]` |
| Create campaign | `[data-testid="createCampaign"]` |
| Subscription info | `[data-testid="subscriptionInfo"]` |

---

## New Platforms (Epic 35)

Reddit and Medium scrapers are HTTP/RSS clients — no DOM selectors. Instagram uses a login-form DOM for session bootstrap plus the instagrapi bridge.

### Reddit (`src/scrapers/social/reddit/`)

| Surface | Endpoint / pattern |
|---------|--------------------|
| Public listing | `GET {base}/r/{sub}/{sort}.json` (sort: `new|hot|top|rising|controversial`) |
| Post + comments | `GET {base}/comments/{postId}.json` |
| OAuth token | `POST https://www.reddit.com/api/v1/access_token` (client_credentials) |
| RSS fallback | `GET {base}/r/{sub}/{sort}.rss` when `.json` hits a bot challenge |
| User-Agent | REQUIRED — `xactions:reddit-scraper:v1.0.0 by u/{username}` (`buildRedditUserAgent`) |

### Medium (`src/scrapers/social/medium/`)

| Surface | Endpoint / pattern |
|---------|--------------------|
| User feed (RSS) | `GET medium.com/feed/@{username}` |
| Tag feed (RSS) | `GET medium.com/feed/tag/{tag}` |
| HTTP/GraphQL | `POST medium.com/_/graphql` (transport: `graphql`) |
| Transports | `rss` (default) · `http` · `graphql` · `puppeteer` |

### Instagram (`src/scrapers/social/instagram/`)

| Element | Selector |
|---------|----------|
| Username input | `input[name="username"]` |
| Password input | `input[name="password"]` |
| Login submit | `button[type="submit"]` |

Private-API transport goes through `bridge.py` (instagrapi) — proxy applies to all traffic.

### ProxyProvider usage (all three)

```javascript
new RedditClient({ proxyProvider: dynamicTunnelProvider });
// or pool:  { proxyPool: proxyIpPool }  — falls back to globalProxyPool (env-seeded)
// env fallback chain: injected provider → globalProxyPool → process.env.PROXY_URL
```

- Geo/session hints (`country`, `isp`, `sessionId`, …) set in `resolveProxy()` are forwarded to provider-class pools (`DynamicTunnelProvider` → `country-{cc}` token).
- `ProxyIpPool` is a raw IP list — it ignores geo hints; use `DynamicTunnelProvider` for `country`/`city` targeting.
- `requiresProxy: false` (Reddit/Medium default) → proxy only when explicitly configured; a proxy-connection error quarantines the proxy (5 min) and retries once direct. `requiresProxy: true` → quarantine + `PROXY_EXHAUSTED`, never silent-direct.
