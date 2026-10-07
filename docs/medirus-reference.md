# 📖 Medirus Complete Function Reference

Every function with real, working examples.

---

## Medirus.tweet - Posting & Managing Tweets

### `post(text, options)` - Post a new tweet
```js
// Simple tweet
await Medirus.tweet.post("Hello world! 🌍")

// Daily motivation poster
const quotes = ["Stay focused! 💪", "Keep building! 🚀", "Never give up! 🔥"]
await Medirus.tweet.post(quotes[Math.floor(Math.random() * quotes.length)])

// Announcement with emoji
await Medirus.tweet.post("🚀 Just launched our new feature! Check it out at example.com")
```

### `reply(tweetElement, text)` - Reply to a tweet
```js
// Reply to first visible tweet
const tweets = Medirus.tweet.getAll()
await Medirus.tweet.reply(tweets[0], "Great insight! Thanks for sharing 🙏")

// Auto-reply to tweets with keywords
const tweets = Medirus.tweet.getAll()
for (const tweet of tweets) {
  const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent || ""
  if (text.toLowerCase().includes("help")) {
    await Medirus.tweet.reply(tweet, "Happy to help! DM me for more details.")
    break
  }
}
```

### `quote(tweetElement, text)` - Quote tweet
```js
// Quote with commentary
const tweets = Medirus.tweet.getAll()
await Medirus.tweet.quote(tweets[0], "This is exactly what I've been saying! 👆")

// Quote to amplify
const tweet = Medirus.tweet.getAll()[0]
await Medirus.tweet.quote(tweet, "Everyone needs to see this 📢")
```

### `delete(tweetElement)` - Delete your tweet
```js
// Delete first tweet (must be yours)
const tweets = Medirus.tweet.getAll()
await Medirus.tweet.delete(tweets[0])

// Bulk delete (use carefully!)
async function deleteMyTweets(count = 5) {
  for (let i = 0; i < count; i++) {
    const tweets = Medirus.tweet.getAll()
    if (tweets.length === 0) break
    await Medirus.tweet.delete(tweets[0])
    await new Promise(r => setTimeout(r, 2000))
  }
}
```

### `pin(tweetElement)` - Pin tweet to profile
```js
// Pin your best tweet
const tweets = Medirus.tweet.getAll()
await Medirus.tweet.pin(tweets[0])
```

### `getId(tweetElement)` - Get tweet ID
```js
// Get ID of first tweet
const tweets = Medirus.tweet.getAll()
const id = Medirus.tweet.getId(tweets[0])
console.log("Tweet URL: https://x.com/i/status/" + id)

// Collect all tweet IDs on page
const ids = Medirus.tweet.getAll().map(t => Medirus.tweet.getId(t))
console.log("Found IDs:", ids)
```

### `getAll()` - Get all visible tweets
```js
// Count tweets
const tweets = Medirus.tweet.getAll()
console.log(`${tweets.length} tweets on page`)

// Find tweets with keyword
const aiTweets = Medirus.tweet.getAll().filter(t => {
  const text = t.querySelector('[data-testid="tweetText"]')?.textContent || ""
  return text.toLowerCase().includes("ai")
})
console.log(`Found ${aiTweets.length} AI tweets`)
```

### `thread(tweets)` - Post a thread
```js
// Educational thread
await Medirus.tweet.thread([
  "🧵 5 JavaScript tips you need to know:",
  "1/ Use const by default, let when needed",
  "2/ Arrow functions inherit 'this' from parent",
  "3/ Template literals are cleaner than concatenation",
  "4/ async/await beats .then() chains",
  "5/ Destructuring saves lines of code",
  "Follow for more tips! 👋"
])
```

---

## Medirus.engage - Engagement Actions

### `like(tweetElement)` - Like a tweet
```js
// Like first tweet
const tweets = Medirus.tweet.getAll()
await Medirus.engage.like(tweets[0])

// Like first 10 tweets
for (const tweet of Medirus.tweet.getAll().slice(0, 10)) {
  await Medirus.engage.like(tweet)
  await new Promise(r => setTimeout(r, 500))
}

// Like tweets with keyword
async function likeByKeyword(keyword, max = 5) {
  let count = 0
  for (const tweet of Medirus.tweet.getAll()) {
    if (count >= max) break
    const text = tweet.querySelector('[data-testid="tweetText"]')?.textContent || ""
    if (text.toLowerCase().includes(keyword)) {
      await Medirus.engage.like(tweet)
      count++
    }
  }
  console.log(`Liked ${count} tweets with "${keyword}"`)
}
await likeByKeyword("web3", 5)
```

### `unlike(tweetElement)` - Unlike a tweet
```js
const tweets = Medirus.tweet.getAll()
await Medirus.engage.unlike(tweets[0])
```

### `retweet(tweetElement)` - Retweet
```js
// Retweet first tweet
const tweets = Medirus.tweet.getAll()
await Medirus.engage.retweet(tweets[0])

// Like + Retweet combo
async function boost(tweet) {
  await Medirus.engage.like(tweet)
  await Medirus.engage.retweet(tweet)
}
await boost(Medirus.tweet.getAll()[0])
```

### `unretweet(tweetElement)` - Undo retweet
```js
const tweets = Medirus.tweet.getAll()
await Medirus.engage.unretweet(tweets[0])
```

### `bookmark(tweetElement)` - Bookmark tweet
```js
// Bookmark first tweet
await Medirus.engage.bookmark(Medirus.tweet.getAll()[0])

// Bookmark tweets with links
for (const tweet of Medirus.tweet.getAll()) {
  if (tweet.querySelector('a[href*="t.co"]')) {
    await Medirus.engage.bookmark(tweet)
  }
}
```

### `unbookmark(tweetElement)` - Remove bookmark
```js
await Medirus.engage.unbookmark(Medirus.tweet.getAll()[0])
```

### `addToList(tweetElement, listName)` - Add author to list
```js
await Medirus.engage.addToList(Medirus.tweet.getAll()[0], "Interesting People")
```

### `report(tweetElement)` - Report tweet
```js
await Medirus.engage.report(Medirus.tweet.getAll()[0])
// Dialog opens - select reason manually
```

### `copyLink(tweetElement)` - Copy tweet link
```js
await Medirus.engage.copyLink(Medirus.tweet.getAll()[0])
console.log("Link copied to clipboard!")
```

### `shareViaDM(tweetElement, username)` - Share via DM
```js
await Medirus.engage.shareViaDM(Medirus.tweet.getAll()[0], "friendname")
```

### `embed(tweetElement)` - Get embed code
```js
await Medirus.engage.embed(Medirus.tweet.getAll()[0])
// Copy embed code from dialog
```

### `viewAnalytics(tweetElement)` - View analytics
```js
await Medirus.engage.viewAnalytics(Medirus.tweet.getAll()[0])
```

### `requestNote(tweetElement)` - Request community note
```js
await Medirus.engage.requestNote(Medirus.tweet.getAll()[0])
```

### `highlight(tweetElement)` - Highlight (Premium)
```js
await Medirus.engage.highlight(Medirus.tweet.getAll()[0])
```

---

## Medirus.user - User Interactions

### `follow(target)` - Follow user
```js
// By username
await Medirus.user.follow("elonmusk")

// Follow list of users
const users = ["openai", "anthropic", "google"]
for (const u of users) {
  await Medirus.user.follow(u)
  await new Promise(r => setTimeout(r, 2000))
}
```

### `unfollow(target)` - Unfollow user
```js
await Medirus.user.unfollow("someuser")
```

### `block(username)` - Block user
```js
await Medirus.user.block("spammer")

// Block multiple
for (const spam of ["spam1", "spam2"]) {
  await Medirus.user.block(spam)
}
```

### `unblock(username)` - Unblock user
```js
await Medirus.user.unblock("formerlyblocked")
```

### `mute(username)` - Mute user
```js
await Medirus.user.mute("annoying")
```

### `unmute(username)` - Unmute user
```js
await Medirus.user.unmute("previouslymuted")
```

### `report(username)` - Report user
```js
await Medirus.user.report("badactor")
```

### `addToList(username, listName)` - Add to list
```js
await Medirus.user.addToList("techwriter", "Tech News")

// Build curated list
const leaders = ["paulg", "naval", "sama"]
for (const l of leaders) {
  await Medirus.user.addToList(l, "Founders")
}
```

### `notifyOn(username)` - Turn on notifications
```js
await Medirus.user.notifyOn("mustwatchaccount")
```

### `notifyOff(username)` - Turn off notifications
```js
await Medirus.user.notifyOff("toofrequent")
```

### `viewTopics(username)` - View topics
```js
await Medirus.user.viewTopics("influencer")
```

### `viewLists(username)` - View lists
```js
await Medirus.user.viewLists("curator")
```

### `viewFollowers(username)` - View followers
```js
await Medirus.user.viewFollowers("competitor")
```

### `viewFollowing(username)` - View following
```js
await Medirus.user.viewFollowing("tastemaker")
```

### `viewLikes(username)` - View likes
```js
await Medirus.user.viewLikes("researcher")
```

### `viewMedia(username)` - View media
```js
await Medirus.user.viewMedia("photographer")
```

### `viewReplies(username)` - View replies
```js
await Medirus.user.viewReplies("activeuser")
```

### `viewHighlights(username)` - View highlights
```js
await Medirus.user.viewHighlights("creator")
```

### `viewArticles(username)` - View articles
```js
await Medirus.user.viewArticles("writer")
```

### `shareProfile(username)` - Copy profile link
```js
await Medirus.user.shareProfile("coolaccount")
```

### `followsYou(username)` - Check if follows you
```js
const follows = await Medirus.user.followsYou("someuser")
console.log(follows ? "They follow you!" : "They don't follow you")

// Find mutuals
async function findMutuals(users) {
  const mutuals = []
  for (const u of users) {
    if (await Medirus.user.followsYou(u)) mutuals.push(u)
  }
  return mutuals
}
```

### `getInfo(username)` - Get user info
```js
const info = await Medirus.user.getInfo("openai")
console.log(`${info.displayName} - ${info.bio}`)
console.log(`Followers: ${info.followers}`)
```

### `restrict(username)` - Restrict user
```js
await Medirus.user.restrict("limitedinteraction")
```

---

## Medirus.dm - Direct Messages

### `send(username, message)` - Send DM
```js
await Medirus.dm.send("friend", "Hey! How are you?")

// Send to multiple
const team = ["member1", "member2"]
for (const m of team) {
  await Medirus.dm.send(m, "Team meeting at 3pm!")
}
```

### `open(username)` - Open conversation
```js
await Medirus.dm.open("friend")
```

### `getConversations()` - Get all conversations
```js
const convos = await Medirus.dm.getConversations()
console.log(`You have ${convos.length} conversations`)
```

### `deleteConversation(element)` - Delete conversation
```js
const convos = await Medirus.dm.getConversations()
await Medirus.dm.deleteConversation(convos[0].element)
```

### `leaveGroup()` - Leave group DM
```js
await Medirus.dm.leaveGroup()
```

### `createGroup(usernames)` - Create group DM
```js
await Medirus.dm.createGroup(["user1", "user2", "user3"])
```

### `sendImage()` - Send image
```js
await Medirus.dm.sendImage()
// File picker opens - select manually
```

### `sendGif(searchTerm)` - Send GIF
```js
await Medirus.dm.sendGif("celebration")
```

### `react(messageElement, emoji)` - React to message
```js
// React with heart
await Medirus.dm.react(messageElement, "❤️")
```

---

## Medirus.search - Search & Discovery

### `query(query, filter)` - Search
```js
await Medirus.search.query("javascript tips")
await Medirus.search.query("AI news", "live") // Latest
```

### `top(query)` - Top results
```js
await Medirus.search.top("startup advice")
```

### `latest(query)` - Latest results
```js
await Medirus.search.latest("breaking news")
```

### `people(query)` - Search people
```js
await Medirus.search.people("web developer")
```

### `photos(query)` - Search photos
```js
await Medirus.search.photos("sunset photography")
```

### `videos(query)` - Search videos
```js
await Medirus.search.videos("coding tutorial")
```

### `from(username)` - Tweets from user
```js
await Medirus.search.from("elonmusk")
```

### `to(username)` - Tweets to user
```js
await Medirus.search.to("openai")
```

### `mentions(username)` - Mentions of user
```js
await Medirus.search.mentions("yourhandle")
```

### `hashtag(tag)` - Search hashtag
```js
await Medirus.search.hashtag("buildinpublic")
```

### `advanced(options)` - Advanced search
```js
// Viral tweets from a user
await Medirus.search.advanced({
  from: "elonmusk",
  minFaves: 10000,
  since: "2024-01-01"
})

// Tech discussions with media
await Medirus.search.advanced({
  words: "AI startup",
  hasMedia: true,
  minRetweets: 100,
  lang: "en"
})

// Find your mentions (excluding RTs)
await Medirus.search.advanced({
  mentioning: "yourusername",
  excludeRetweets: true
})

// Job postings
await Medirus.search.advanced({
  words: "hiring",
  hashtags: ["remotejobs"],
  since: "2024-12-01"
})
```

### `getResults()` - Get search results
```js
await Medirus.search.query("javascript")
const results = Medirus.search.getResults()
console.log(`Found ${results.length} tweets`)
```

---

## Medirus.nav - Navigation

### `home()` - Go to home
```js
await Medirus.nav.home()
```

### `explore()` - Go to explore
```js
await Medirus.nav.explore()
```

### `notifications()` - Go to notifications
```js
await Medirus.nav.notifications()
```

### `messages()` - Go to messages
```js
await Medirus.nav.messages()
```

### `bookmarks()` - Go to bookmarks
```js
await Medirus.nav.bookmarks()
```

### `lists()` - Go to lists
```js
await Medirus.nav.lists()
```

### `communities()` - Go to communities
```js
await Medirus.nav.communities()
```

### `premium()` - Go to premium
```js
await Medirus.nav.premium()
```

### `profile(username)` - Go to profile
```js
await Medirus.nav.profile("elonmusk")
await Medirus.nav.profile() // Your own profile
```

### `settings()` - Go to settings
```js
await Medirus.nav.settings()
```

### `notifyAll()` - All notifications
```js
await Medirus.nav.notifyAll()
```

### `notifyVerified()` - Verified notifications
```js
await Medirus.nav.notifyVerified()
```

### `notifyMentions()` - Mentions only
```js
await Medirus.nav.notifyMentions()
```

### `forYou()` - For You timeline
```js
await Medirus.nav.forYou()
```

### `following()` - Following timeline
```js
await Medirus.nav.following()
```

### `trending()` - Trending
```js
await Medirus.nav.trending()
```

### `news()` - News tab
```js
await Medirus.nav.news()
```

### `sports()` - Sports tab
```js
await Medirus.nav.sports()
```

### `entertainment()` - Entertainment tab
```js
await Medirus.nav.entertainment()
```

### `spaces()` - Spaces page
```js
await Medirus.nav.spaces()
```

### `scrollToTop()` - Scroll to top
```js
Medirus.nav.scrollToTop()
```

### `scrollToBottom()` - Scroll to bottom
```js
Medirus.nav.scrollToBottom()
```

### `scrollBy(pixels)` - Scroll by amount
```js
Medirus.nav.scrollBy(500)  // Scroll down 500px
Medirus.nav.scrollBy(-200) // Scroll up 200px
```

### `back()` - Browser back
```js
Medirus.nav.back()
```

### `forward()` - Browser forward
```js
Medirus.nav.forward()
```

### `refresh()` - Refresh page
```js
Medirus.nav.refresh()
```

---

## Medirus.lists - List Management

### `create(name, description, isPrivate)` - Create list
```js
// Public list
await Medirus.lists.create("Tech News", "Best tech journalists", false)

// Private list
await Medirus.lists.create("Competitors", "Track competitor accounts", true)
```

### `delete(listId)` - Delete list
```js
await Medirus.lists.delete("1234567890")
```

### `edit(listId, newName, newDescription)` - Edit list
```js
await Medirus.lists.edit("1234567890", "Updated Name", "New description")
```

### `follow(listId)` - Follow list
```js
await Medirus.lists.follow("1234567890")
```

### `unfollow(listId)` - Unfollow list
```js
await Medirus.lists.unfollow("1234567890")
```

### `pin(listId)` - Pin/unpin list
```js
await Medirus.lists.pin("1234567890")
```

### `getAll()` - Get all lists
```js
const lists = await Medirus.lists.getAll()
console.log(`You have ${lists.length} lists`)
```

### `viewMembers(listId)` - View list members
```js
await Medirus.lists.viewMembers("1234567890")
```

### `viewFollowers(listId)` - View list followers
```js
await Medirus.lists.viewFollowers("1234567890")
```

---

## Medirus.settings - Account Settings

### `account()` - Account settings
```js
await Medirus.settings.account()
```

### `security()` - Security settings
```js
await Medirus.settings.security()
```

### `privacy()` - Privacy settings
```js
await Medirus.settings.privacy()
```

### `notifications()` - Notification settings
```js
await Medirus.settings.notifications()
```

### `accessibility()` - Accessibility settings
```js
await Medirus.settings.accessibility()
```

### `monetization()` - Monetization settings
```js
await Medirus.settings.monetization()
```

### `creatorSubs()` - Creator subscriptions
```js
await Medirus.settings.creatorSubs()
```

### `premium()` - Premium settings
```js
await Medirus.settings.premium()
```

### `mutedAccounts()` - View muted accounts
```js
await Medirus.settings.mutedAccounts()
```

### `mutedWords()` - View muted words
```js
await Medirus.settings.mutedWords()
```

### `blockedAccounts()` - View blocked accounts
```js
await Medirus.settings.blockedAccounts()
```

### `addMutedWord(word)` - Add muted word
```js
await Medirus.settings.addMutedWord("spoilers")
await Medirus.settings.addMutedWord("politics")
```

### `downloadData()` - Download your data
```js
await Medirus.settings.downloadData()
```

### `deactivate()` - Deactivate page
```js
await Medirus.settings.deactivate()
// Proceed with caution!
```

---

## Medirus.profile - Profile Editing

### `edit()` - Open profile editor
```js
await Medirus.profile.edit()
```

### `updateName(newName)` - Update display name
```js
await Medirus.profile.updateName("John Doe 🚀")
```

### `updateBio(newBio)` - Update bio
```js
await Medirus.profile.updateBio("Building cool stuff | Founder @startup | DMs open")
```

### `updateLocation(location)` - Update location
```js
await Medirus.profile.updateLocation("San Francisco, CA")
```

### `updateWebsite(url)` - Update website
```js
await Medirus.profile.updateWebsite("https://mywebsite.com")
```

### `updateAvatar()` - Change avatar
```js
await Medirus.profile.updateAvatar()
// File picker opens
```

### `updateHeader()` - Change header
```js
await Medirus.profile.updateHeader()
// File picker opens
```

### `switchToProfessional()` - Professional account
```js
await Medirus.profile.switchToProfessional()
```

---

## Medirus.utils - Utilities

### `getCurrentUser()` - Get current username
```js
const me = Medirus.utils.getCurrentUser()
console.log(`Logged in as @${me}`)
```

### `isLoggedIn()` - Check if logged in
```js
if (Medirus.utils.isLoggedIn()) {
  console.log("Ready to automate!")
} else {
  console.log("Please log in first")
}
```

### `getTokens()` - Get auth tokens
```js
const tokens = Medirus.utils.getTokens()
console.log("CSRF token:", tokens.ct0)
// Useful for API calls
```

### `getTweetIdFromUrl(url)` - Extract tweet ID
```js
const id = Medirus.utils.getTweetIdFromUrl("https://x.com/user/status/123456789")
console.log(id) // "123456789"
```

### `getUsernameFromUrl(url)` - Extract username
```js
const user = Medirus.utils.getUsernameFromUrl("https://x.com/elonmusk")
console.log(user) // "elonmusk"
```

### `waitForPageLoad()` - Wait for page
```js
await Medirus.utils.waitForPageLoad()
console.log("Page ready!")
```

### `loadMore(times)` - Scroll to load more
```js
await Medirus.utils.loadMore(5) // Scroll 5 times
```

### `clearXData()` - Clear localStorage
```js
Medirus.utils.clearXData()
```

### `exportBookmarks(maxItems)` - Export bookmarks
```js
// Export 100 bookmarks
const bookmarks = await Medirus.utils.exportBookmarks(100)
console.log(bookmarks)

// Download as JSON
const bookmarks = await Medirus.utils.exportBookmarks(500)
const blob = new Blob([JSON.stringify(bookmarks, null, 2)], {type: 'application/json'})
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'bookmarks.json'
a.click()
```

### `exportLikes(username, maxItems)` - Export likes
```js
const likes = await Medirus.utils.exportLikes("myusername", 200)
console.log(`Exported ${likes.length} liked tweets`)
```

### `copyToClipboard(text)` - Copy to clipboard
```js
await Medirus.utils.copyToClipboard("Hello world!")
```

### `screenshotTweet(tweetUrl)` - Screenshot tweet
```js
await Medirus.utils.screenshotTweet("https://x.com/user/status/123")
// Opens screenshot service in new tab
```

### `showKeyboardShortcuts()` - Show shortcuts
```js
Medirus.utils.showKeyboardShortcuts()
```

### `devMode()` - Enable dev mode
```js
Medirus.utils.devMode()
// All elements outlined with data-testid labels
```

### `getAllSelectors()` - Get all selectors
```js
const selectors = Medirus.utils.getAllSelectors()
console.log(selectors) // Array of all data-testid values on page
```

---

## Medirus.spaces - Twitter Spaces

### `browse()` - Browse spaces
```js
await Medirus.spaces.browse()
```

### `join(spaceId)` - Join space
```js
await Medirus.spaces.join("1234567890")
```

### `leave()` - Leave space
```js
await Medirus.spaces.leave()
```

### `requestToSpeak()` - Request to speak
```js
await Medirus.spaces.requestToSpeak()
```

### `setReminder(spaceId)` - Set reminder
```js
await Medirus.spaces.setReminder("1234567890")
```

### `share()` - Share space
```js
await Medirus.spaces.share()
```

---

## Medirus.communities - Communities

### `browse()` - Browse communities
```js
await Medirus.communities.browse()
```

### `view(communityId)` - View community
```js
await Medirus.communities.view("1234567890")
```

### `join(communityId)` - Join community
```js
await Medirus.communities.join("1234567890")
```

### `leave(communityId)` - Leave community
```js
await Medirus.communities.leave("1234567890")
```

### `post(communityId, text)` - Post in community
```js
await Medirus.communities.post("1234567890", "Hello community! 👋")
```

---

## 🔥 Power User Recipes

### Like & Follow from Search Results
```js
await Medirus.search.query("web3 developer")
await new Promise(r => setTimeout(r, 2000))
const tweets = Medirus.tweet.getAll().slice(0, 10)
for (const tweet of tweets) {
  await Medirus.engage.like(tweet)
  await Medirus.user.follow(tweet)
  await new Promise(r => setTimeout(r, 3000))
}
```

### Export All Your Bookmarks to JSON
```js
const bookmarks = await Medirus.utils.exportBookmarks(1000)
const blob = new Blob([JSON.stringify(bookmarks, null, 2)], {type: 'application/json'})
const a = document.createElement('a')
a.href = URL.createObjectURL(blob)
a.download = `bookmarks-${Date.now()}.json`
a.click()
console.log(`Exported ${bookmarks.length} bookmarks!`)
```

### Find Non-Mutuals
```js
const following = ["user1", "user2", "user3", "user4", "user5"]
const nonMutuals = []
for (const user of following) {
  if (!(await Medirus.user.followsYou(user))) {
    nonMutuals.push(user)
  }
  await new Promise(r => setTimeout(r, 2000))
}
console.log("Non-mutuals:", nonMutuals)
```

### Auto-Engage with Hashtag
```js
await Medirus.search.hashtag("buildinpublic")
await new Promise(r => setTimeout(r, 2000))
for (const tweet of Medirus.tweet.getAll().slice(0, 5)) {
  await Medirus.engage.like(tweet)
  await Medirus.engage.bookmark(tweet)
  await new Promise(r => setTimeout(r, 2000))
}
```

### Daily Posting Schedule
```js
const posts = [
  "Good morning! ☀️ What are you building today?",
  "Tip of the day: Always test your code before deploying 🧪",
  "Evening thought: Consistency beats intensity 💪"
]
for (const post of posts) {
  await Medirus.tweet.post(post)
  // In real usage, you'd schedule these with setTimeout or cron
}
```

---

<p align="center">
  <a href="./automation.md">← Back to Automation Guide</a> |
  <a href="https://github.com/nirholas/XActions">⭐ Star on GitHub</a>
</p>
