# Medirus Actions Library Reference (`actions.js`)

> The complete X/Twitter actions library — 2,100+ lines, 12 namespaces, 100+ functions covering every available user action.

**Source:** [`src/automation/actions.js`](../../src/automation/actions.js) (2,116 lines)

---

## Table of Contents

- [Overview](#overview)
- [Loading](#loading)
- [Extended Selectors (SEL)](#extended-selectors-sel)
- [Medirus.tweet — Post Management](#medirustweet--post-management)
- [Medirus.engage — Engagement Actions](#medirusengage--engagement-actions)
- [Medirus.user — User Interactions](#medirususer--user-interactions)
- [Medirus.dm — Direct Messages](#medirusdm--direct-messages)
- [Medirus.search — Search & Discovery](#medirussearch--search--discovery)
- [Medirus.nav — Navigation](#medirusnav--navigation)
- [Medirus.lists — List Management](#mediruslists--list-management)
- [Medirus.settings — Account Settings](#medirussettings--account-settings)
- [Medirus.profile — Profile Editing](#medirusprofile--profile-editing)
- [Medirus.utils — Power Utilities](#medirusutils--power-utilities)
- [Medirus.spaces — Twitter Spaces](#medirusspaces--twitter-spaces)
- [Medirus.communities — Communities](#mediruscommunities--communities)

---

## Overview

`actions.js` replaces `window.Medirus` with a complete action library. It requires `core.js` to be loaded first — it destructures Core's utilities at the top:

```javascript
const { sleep, randomDelay, log, storage, waitForElement, waitForElements, clickElement, typeText } = Core;
```

When loaded successfully, you'll see a banner showing all 12 sections:

```
╔══════════════════════════════════════════════════════════════════════╗
║  📦 Medirus Library - COMPLETE (All 9 Sections)                     ║
╠══════════════════════════════════════════════════════════════════════╣
║  ✅ Medirus.tweet       - Post, reply, quote, delete, pin, thread   ║
║  ✅ Medirus.engage      - Like, RT, bookmark, share, highlight      ║
║  ...                                                                   ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Loading

```javascript
// In browser DevTools console on x.com:
// 1. Paste core.js first
// 2. Then paste actions.js

// Verify:
await Medirus.tweet.post("Test!"); // Posts a tweet
Medirus.utils.getCurrentUser();     // Returns your username
```

> **Important:** After loading actions.js, `window.Medirus.Core` is still accessible via the Core reference inside the closure, but `window.Medirus` now points to the actions library (tweet, engage, user, etc.), not Core. Access Core directly via `window.Medirus.Core` if needed.

---

## Extended Selectors (SEL)

`actions.js` defines its own extended selector map (`SEL`) that goes beyond what Core provides. These are used internally but you can access them via `Medirus.SEL`:

### Compose/Input
| Key | Selector | Element |
|-----|----------|---------|
| `tweetTextarea` | `[data-testid="tweetTextarea_0"]` | Compose box |
| `tweetButton` | `[data-testid="tweetButton"]` | Post button |
| `tweetButtonInline` | `[data-testid="tweetButtonInline"]` | Inline post button |
| `dmTextarea` | `[data-testid="dmComposerTextInput"]` | DM input |
| `dmSendButton` | `[data-testid="dmComposerSendButton"]` | DM send |
| `searchInput` | `[data-testid="SearchBox_Search_Input"]` | Search box |
| `mediaUpload` | `input[data-testid="fileInput"]` | Media file input |
| `gifButton` | `[data-testid="gifyButton"]` | GIF picker |
| `emojiButton` | `[data-testid="emojiButton"]` | Emoji picker |
| `pollButton` | `[data-testid="pollButton"]` | Add poll |
| `scheduleButton` | `[data-testid="scheduledButton"]` | Schedule post |
| `locationButton` | `[data-testid="geoButton"]` | Add location |

### Action Buttons
| Key | Selector | Element |
|-----|----------|---------|
| `likeButton` | `[data-testid="like"]` | Like |
| `unlikeButton` | `[data-testid="unlike"]` | Unlike |
| `retweetButton` | `[data-testid="retweet"]` | Retweet |
| `unretweetButton` | `[data-testid="unretweet"]` | Un-retweet |
| `replyButton` | `[data-testid="reply"]` | Reply |
| `shareButton` | `[data-testid="share"]` | Share |
| `bookmarkButton` | `[data-testid="bookmark"]` | Bookmark |
| `removeBookmark` | `[data-testid="removeBookmark"]` | Remove bookmark |

### Menus & Dialogs
| Key | Selector | Element |
|-----|----------|---------|
| `caret` | `[data-testid="caret"]` | Tweet ⋯ menu |
| `menuItem` | `[role="menuitem"]` | Menu option |
| `confirmButton` | `[data-testid="confirmationSheetConfirm"]` | Confirm |
| `cancelButton` | `[data-testid="confirmationSheetCancel"]` | Cancel |
| `modal` | `[data-testid="modal"]` | Modal dialog |
| `sheetDialog` | `[data-testid="sheetDialog"]` | Sheet dialog |
| `toast` | `[data-testid="toast"]` | Toast notification |

### Profile & Navigation
| Key | Selector | Element |
|-----|----------|---------|
| `profileHeader` | `[data-testid="UserProfileHeader_Items"]` | Profile header |
| `editProfileButton` | `[data-testid="editProfileButton"]` | Edit profile |
| `primaryColumn` | `[data-testid="primaryColumn"]` | Main column |
| `sidebarColumn` | `[data-testid="sidebarColumn"]` | Sidebar |
| `backButton` | `[data-testid="app-bar-back"]` | Back button |
| `tabList` | `[role="tablist"]` | Tab navigation |

### Media & Content
| Key | Selector | Element |
|-----|----------|---------|
| `dmConversation` | `[data-testid="conversation"]` | DM conversation |
| `dmMessage` | `[data-testid="messageEntry"]` | DM message |
| `notification` | `[data-testid="notification"]` | Notification |
| `communityCard` | `[data-testid="CommunityCard"]` | Community card |
| `spaceBar` | `[data-testid="SpaceBar"]` | Space bar |
| `spaceCard` | `[data-testid="SpaceCard"]` | Space card |

---

## Medirus.tweet — Post Management

### `tweet.post(text, options)`

Post a new tweet.

```javascript
await Medirus.tweet.post("Hello world!");
await Medirus.tweet.post("Check this out!", { draft: true }); // Don't auto-send
```

**Options:**
- `mediaUrl` — Triggers media upload dialog (requires manual file selection)
- `draft` — If `true`, types text but doesn't click Post

**How it works:** Opens the compose dialog if needed → types text character-by-character → clicks the Post button.

### `tweet.reply(tweetElement, text)`

Reply to a specific tweet.

```javascript
const tweets = Medirus.tweet.getAll();
await Medirus.tweet.reply(tweets[0], "Great point!");
```

### `tweet.quote(tweetElement, text)`

Quote-tweet with your commentary.

```javascript
const tweets = Medirus.tweet.getAll();
await Medirus.tweet.quote(tweets[0], "This is exactly what I've been saying");
```

### `tweet.delete(tweetElement)`

Delete one of your tweets. Opens ⋯ menu → Delete → Confirm.

```javascript
const tweets = Medirus.tweet.getAll();
await Medirus.tweet.delete(tweets[0]);
```

### `tweet.pin(tweetElement)`

Pin a tweet to your profile. Opens ⋯ menu → Pin → Confirm.

```javascript
await Medirus.tweet.pin(tweetElement);
```

### `tweet.getId(tweetElement)`

Extract the tweet ID from an element.

```javascript
const id = Medirus.tweet.getId(tweetElement);
// Returns: '1234567890123456789'
```

### `tweet.getAll()`

Get all visible tweet elements on the current page.

```javascript
const tweets = Medirus.tweet.getAll();
console.log(`${tweets.length} tweets visible`);
```

### `tweet.thread(tweets)`

Post a thread of multiple tweets.

```javascript
await Medirus.tweet.thread([
  "Thread 🧵 Here's what I learned about AI agents...",
  "1/ First, they need clear goals and constraints...",
  "2/ Second, context management is everything...",
  "3/ Finally, error recovery separates good from great.",
]);
```

---

## Medirus.engage — Engagement Actions

### `engage.like(tweetElement)` / `engage.unlike(tweetElement)`

Like or unlike a tweet.

```javascript
const tweets = Medirus.tweet.getAll();
await Medirus.engage.like(tweets[0]);
await Medirus.engage.unlike(tweets[1]);
```

### `engage.retweet(tweetElement)` / `engage.unretweet(tweetElement)`

Retweet or undo a retweet (clicks confirm dialog).

```javascript
await Medirus.engage.retweet(tweetElement);
```

### `engage.bookmark(tweetElement)` / `engage.unbookmark(tweetElement)`

Bookmark via the share menu.

```javascript
await Medirus.engage.bookmark(tweetElement);
```

### `engage.addToList(tweetElement, listName)`

Add the tweet's author to a list via the ⋯ menu.

```javascript
await Medirus.engage.addToList(tweetElement, 'AI Accounts');
```

### `engage.report(tweetElement, reason)`

Open the report dialog for a tweet.

```javascript
await Medirus.engage.report(tweetElement);
// Opens dialog — complete manually
```

### `engage.copyLink(tweetElement)`

Copy the tweet's link to clipboard via share menu.

### `engage.shareViaDM(tweetElement, username)`

Share a tweet to someone via DM.

```javascript
await Medirus.engage.shareViaDM(tweetElement, 'friendUsername');
```

### `engage.embed(tweetElement)`

Open the embed code dialog.

### `engage.viewAnalytics(tweetElement)`

Open tweet analytics/engagements view.

### `engage.requestNote(tweetElement)`

Request a Community Note on a tweet.

### `engage.highlight(tweetElement)`

Highlight a tweet (X Premium feature).

---

## Medirus.user — User Interactions

### `user.follow(target)` / `user.unfollow(target)`

Follow or unfollow. Accepts a username string or DOM element.

```javascript
await Medirus.user.follow('username');     // Navigate + click follow
await Medirus.user.follow(userCellElement); // Click follow in existing cell
await Medirus.user.unfollow('username');   // Navigate + click unfollow + confirm
```

### `user.block(username)` / `user.unblock(username)`

Block or unblock a user. Navigates to profile → ... menu → Block → Confirm.

```javascript
await Medirus.user.block('spambot123');
await Medirus.user.unblock('spambot123');
```

### `user.mute(username)` / `user.unmute(username)`

Mute or unmute a user.

```javascript
await Medirus.user.mute('annoying_account');
```

### `user.report(username)`

Open the report dialog for a user.

### `user.addToList(username, listName)`

Add a user to a specific list.

```javascript
await Medirus.user.addToList('alice', 'AI People');
```

### `user.notifyOn(username)` / `user.notifyOff(username)`

Toggle post notifications for a user.

```javascript
await Medirus.user.notifyOn('vitalikbuterin'); // Get notified of their posts
```

### `user.restrict(username)`

Restrict a user's interactions with your content.

### `user.followsYou(username)`

Check if a user follows you. Navigates to their profile and checks for the badge.

```javascript
const follows = await Medirus.user.followsYou('someuser');
// Returns: true/false
```

### `user.getInfo(username)`

Get structured user information.

```javascript
const info = await Medirus.user.getInfo('elonmusk');
// Returns: {
//   username: 'elonmusk',
//   displayName: 'Elon Musk',
//   bio: '...',
//   followsYou: false,
//   verified: true,
//   protected: false,
//   followers: '200.5M Followers',
//   following: '800 Following'
// }
```

### Navigation Helpers

All navigate to specific user pages:

```javascript
await Medirus.user.viewFollowers('username');
await Medirus.user.viewFollowing('username');
await Medirus.user.viewLikes('username');
await Medirus.user.viewMedia('username');
await Medirus.user.viewReplies('username');
await Medirus.user.viewHighlights('username');
await Medirus.user.viewArticles('username');
await Medirus.user.viewTopics('username');
await Medirus.user.viewLists('username');
```

---

## Medirus.dm — Direct Messages

### `dm.send(username, message)`

Send a DM to a user. Navigates to Messages → New → Search → Type → Send.

```javascript
await Medirus.dm.send('friendUsername', 'Hey, check out this project!');
```

### `dm.open(username)`

Open an existing DM conversation, or start a new one.

```javascript
await Medirus.dm.open('friendUsername');
```

### `dm.getConversations()`

Get all visible DM conversations.

```javascript
const convos = await Medirus.dm.getConversations();
// Returns: [{ element, text }, ...]
```

### `dm.deleteConversation(conversationElement)`

Delete a DM conversation.

### `dm.leaveGroup()`

Leave a group DM (must be viewing the group).

### `dm.createGroup(usernames, groupName)`

Create a group DM with multiple users.

```javascript
await Medirus.dm.createGroup(['alice', 'bob', 'charlie']);
```

### `dm.sendImage()` / `dm.sendGif(searchTerm)`

Send media in DMs.

```javascript
await Medirus.dm.sendGif('celebration');
// Opens GIF picker, searches 'celebration', clicks first result
```

### `dm.react(messageElement, emoji)`

React to a message with an emoji.

```javascript
await Medirus.dm.react(messageElement, '❤️');
```

---

## Medirus.search — Search & Discovery

### `search.query(query, filter)`

Run a search with optional filter.

```javascript
await Medirus.search.query('AI agents', 'top');
await Medirus.search.query('AI agents', 'live');  // Latest
await Medirus.search.query('AI agents', 'user');  // People
await Medirus.search.query('AI agents', 'image'); // Photos
await Medirus.search.query('AI agents', 'video'); // Videos
```

### Shortcut Methods

```javascript
await Medirus.search.top('AI agents');
await Medirus.search.latest('AI agents');
await Medirus.search.people('AI agents');
await Medirus.search.photos('AI agents');
await Medirus.search.videos('AI agents');
```

### Operator Search

```javascript
await Medirus.search.from('elonmusk');     // Tweets FROM user
await Medirus.search.to('elonmusk');       // Tweets TO user
await Medirus.search.mentions('elonmusk'); // Tweets mentioning user
await Medirus.search.hashtag('web3');      // Search hashtag
```

### `search.advanced(options)`

Build complex search queries using X's undocumented operators.

```javascript
await Medirus.search.advanced({
  words: 'AI agents',              // Contains these words
  exactPhrase: 'large language',   // Contains exact phrase
  anyWords: 'GPT Claude Gemini',   // Contains any of these
  excludeWords: 'crypto NFT',      // Excludes these
  hashtags: ['AI', 'LLM'],         // Has these hashtags
  from: 'username',                // From user
  to: 'username',                  // To user
  mentioning: 'username',          // Mentioning user
  minReplies: 10,                  // Minimum replies
  minFaves: 100,                   // Minimum likes
  minRetweets: 50,                 // Minimum retweets
  since: '2025-01-01',            // After date
  until: '2025-12-31',            // Before date
  lang: 'en',                     // Language
  verified: true,                  // From verified accounts
  hasMedia: true,                  // Has any media
  hasImages: true,                 // Has images
  hasVideos: true,                 // Has videos
  hasLinks: true,                  // Has links
  isReply: true,                   // Is a reply
  excludeRetweets: true,           // No retweets
  near: 'San Francisco',          // Near location
  within: '15mi',                 // Within radius
  filter: 'latest',               // Result filter
});
```

**Generated query example:**
```
AI agents "large language" (GPT OR Claude OR Gemini) -crypto -NFT #AI #LLM
from:username min_faves:100 since:2025-01-01 filter:verified filter:media lang:en
```

### `search.getResults()`

Get current tweet elements from search results.

```javascript
const results = Medirus.search.getResults();
// Returns: Array of tweet DOM elements
```

---

## Medirus.nav — Navigation

### Core Navigation

```javascript
await Medirus.nav.home();           // Home timeline
await Medirus.nav.explore();        // Explore page
await Medirus.nav.notifications();  // Notifications
await Medirus.nav.messages();       // DMs
await Medirus.nav.bookmarks();      // Bookmarks
await Medirus.nav.lists();          // Your lists
await Medirus.nav.communities();    // Communities
await Medirus.nav.premium();        // Premium signup
await Medirus.nav.profile('user');  // User profile
await Medirus.nav.settings();       // Settings
```

### Timeline Tabs

```javascript
await Medirus.nav.forYou();         // "For You" tab
await Medirus.nav.following();      // "Following" tab
```

### Notification Tabs

```javascript
await Medirus.nav.notifyAll();      // All notifications
await Medirus.nav.notifyVerified(); // Verified only
await Medirus.nav.notifyMentions(); // Mentions only
```

### Explore Page Tabs

```javascript
await Medirus.nav.trending();        // Trending
await Medirus.nav.forYouExplore();   // For You
await Medirus.nav.news();            // News
await Medirus.nav.sports();          // Sports
await Medirus.nav.entertainment();   // Entertainment
await Medirus.nav.spaces();          // Spaces
```

### Scroll & History

```javascript
Medirus.nav.scrollToTop();    // Smooth scroll up
Medirus.nav.scrollToBottom(); // Smooth scroll down
Medirus.nav.scrollBy(500);    // Scroll by px
Medirus.nav.back();           // Browser back
Medirus.nav.forward();        // Browser forward
Medirus.nav.refresh();        // Refresh page
```

---

## Medirus.lists — List Management

### `lists.create(name, description, isPrivate)`

Create a new list.

```javascript
await Medirus.lists.create('AI Researchers', 'Top AI/ML accounts', true);
```

### `lists.delete(listId)` / `lists.edit(listId, name, description)`

Delete or edit a list.

```javascript
await Medirus.lists.edit('123456', 'New List Name', 'Updated description');
await Medirus.lists.delete('123456');
```

### `lists.follow(listId)` / `lists.unfollow(listId)`

Follow or unfollow a list.

### `lists.pin(listId)`

Toggle list pin on your sidebar.

### `lists.getAll()`

Get all your lists.

```javascript
const myLists = await Medirus.lists.getAll();
// Returns: [{ element, text }, ...]
```

### `lists.viewMembers(listId)` / `lists.viewFollowers(listId)`

Navigate to list member/follower pages.

---

## Medirus.settings — Account Settings

Navigation functions to settings pages:

```javascript
await Medirus.settings.account();         // Account settings
await Medirus.settings.security();        // Security
await Medirus.settings.privacy();         // Privacy & safety
await Medirus.settings.notifications();   // Notification settings
await Medirus.settings.accessibility();   // Accessibility
await Medirus.settings.monetization();    // Monetization
await Medirus.settings.creatorSubs();     // Creator subscriptions
await Medirus.settings.premium();         // Premium settings
await Medirus.settings.mutedAccounts();   // Muted accounts list
await Medirus.settings.mutedWords();      // Muted words list
await Medirus.settings.blockedAccounts(); // Blocked accounts list
```

### `settings.addMutedWord(word, options)`

Mute a word/phrase.

```javascript
await Medirus.settings.addMutedWord('spoiler');
```

### `settings.downloadData()`

Navigate to the "Download your data" page.

### `settings.deactivate()`

Navigate to the account deactivation page (proceed with caution).

---

## Medirus.profile — Profile Editing

### `profile.edit()`

Open the profile edit modal.

### `profile.updateName(newName)` / `profile.updateBio(newBio)` / `profile.updateLocation(location)` / `profile.updateWebsite(url)`

Update profile fields.

```javascript
await Medirus.profile.updateName('Alice Builder');
await Medirus.profile.updateBio('Building the future of web3 🚀');
await Medirus.profile.updateLocation('San Francisco, CA');
await Medirus.profile.updateWebsite('https://alice.dev');
```

### `profile.updateAvatar()` / `profile.updateHeader()`

Open file picker for avatar/header image (manual file selection required).

### `profile.switchToProfessional()`

Start the professional account conversion flow.

---

## Medirus.utils — Power Utilities

### `utils.getCurrentUser()`

Get your current username.

```javascript
const me = Medirus.utils.getCurrentUser();
// Returns: 'myusername'
```

### `utils.isLoggedIn()`

Check if you're logged in.

```javascript
Medirus.utils.isLoggedIn(); // true/false
```

### `utils.getTokens()`

Get authentication tokens from cookies (for API use).

```javascript
const tokens = Medirus.utils.getTokens();
// Returns: { ct0: 'csrf_token_here', authToken: 'auth_token_here' }
```

> **Warning:** These are sensitive. Never share them.

### `utils.getTweetIdFromUrl(url)` / `utils.getUsernameFromUrl(url)`

Extract IDs from URLs.

```javascript
Medirus.utils.getTweetIdFromUrl('https://x.com/user/status/1234567');
// Returns: '1234567'

Medirus.utils.getUsernameFromUrl('https://x.com/elonmusk');
// Returns: 'elonmusk'
```

### `utils.waitForPageLoad()`

Wait for the main content column to appear.

### `utils.loadMore(times)`

Scroll to load more content.

```javascript
await Medirus.utils.loadMore(5); // Scroll 5 times with 2s pauses
```

### `utils.exportBookmarks(maxItems)`

Scroll through bookmarks and collect them.

```javascript
const bookmarks = await Medirus.utils.exportBookmarks(200);
// Returns: [{ link: 'https://x.com/.../status/...', text: 'Tweet text...' }, ...]
```

### `utils.exportLikes(username, maxItems)`

Export a user's liked tweets.

```javascript
const likes = await Medirus.utils.exportLikes('myusername', 100);
// Returns: ['https://x.com/.../status/...', ...]
```

### `utils.copyToClipboard(text)`

Copy text to clipboard.

### `utils.screenshotTweet(tweetUrl)`

Open a screenshot service for a tweet.

### `utils.clearXData()`

Clear all X-related data from localStorage (broader than `Core.storage.clear()`).

### `utils.devMode()`

Visual DOM inspector — outlines all `data-testid` elements in red with tooltip labels.

```javascript
Medirus.utils.devMode();
// Every data-testid element gets a red outline and hover tooltip
```

### `utils.getAllSelectors()`

Get all `data-testid` values currently on the page.

```javascript
const selectors = Medirus.utils.getAllSelectors();
// Returns: ['SearchBox_Search_Input', 'SideNav_AccountSwitcher_Button', 'tweet', ...]
```

---

## Medirus.spaces — Twitter Spaces

```javascript
await Medirus.spaces.browse();               // Browse live spaces
await Medirus.spaces.join('spaceId');         // Join a space
await Medirus.spaces.leave();                 // Leave current space
await Medirus.spaces.requestToSpeak();        // Request to speak
await Medirus.spaces.setReminder('spaceId');  // Set reminder for scheduled space
await Medirus.spaces.share();                 // Copy space link
```

---

## Medirus.communities — Communities

```javascript
await Medirus.communities.browse();                    // Browse communities
await Medirus.communities.view('communityId');          // View a community
await Medirus.communities.join('communityId');           // Join
await Medirus.communities.leave('communityId');          // Leave
await Medirus.communities.post('communityId', 'Hello!'); // Post in community
```
