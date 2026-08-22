// Copyright (c) 2024-2026 nich (@nichxbt). Licensed under the Apache License, Version 2.0.
/**
 * Browser Automation Service
 * 
 * Provides browser automation for X/Twitter scraping and automation.
 * Wraps the scrapers from src/scrapers with session cookie handling.
 * 
 * @module api/services/browserAutomation
 * @author nichxbt
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

// ============================================================================
// Core Utilities
// ============================================================================

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
export const randomDelay = (/** @type {number} */ min = 1000, /** @type {number} */ max = 3000) => sleep(min + Math.random() * (max - min));

/**
 * Parse humanized X/Twitter counts like '1.2K', '12.5K', '1,234', '1M' into numbers.
 * Returns 0 for missing/invalid values.
 * @param {unknown} value
 * @returns {number}
 */
export function parseCompactNumber(value) {
  if (value === null || value === undefined) return 0;
  const str = String(value).replace(/,/g, '').trim().toLowerCase();
  if (!str || str === '0') return 0;
  const match = str.match(/^([\d.]+)\s*([kmbt]?)$/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (Number.isNaN(num)) return 0;
  const suffix = match[2];
  const multiplier = { k: 1000, m: 1000000, b: 1000000000, t: 1000000000000 }[suffix] || 1;
  return Math.round(num * multiplier);
}

// Browser instance management (singleton)
/** @type {import('puppeteer').Browser | null} */
let browserInstance = null;

/**
 * Get or create browser instance — recovers from crashes automatically
 */
async function getBrowser() {
  // Check if existing instance is still connected
  if (browserInstance) {
    try {
      // A crashed/closed browser throws on any call
      await browserInstance.version();
    } catch {
      console.warn('⚠️  Browser disconnected — restarting');
      browserInstance = null;
    }
  }

  if (!browserInstance) {
    browserInstance = await puppeteer.launch({
      headless: process.env.PUPPETEER_HEADLESS === 'false' ? false : true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ]
    });

    // Auto-clear instance reference if browser closes unexpectedly
    browserInstance.on('disconnected', () => {
      browserInstance = null;
    });
  }

  return browserInstance;
}

/**
 * Close browser instance
 */
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Create an authenticated page with session cookie
 * @param {string} [sessionCookie]
 * @returns {Promise<import('puppeteer').Page>}
 */
async function getAuthenticatedPage(sessionCookie) {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Set viewport with slight randomization
  await page.setViewport({ 
    width: 1280 + Math.floor(Math.random() * 100), 
    height: 800 + Math.floor(Math.random() * 100) 
  });

  // Set user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );

  // Set session cookie if provided
  if (sessionCookie) {
    await page.setCookie({
      name: 'auth_token',
      value: sessionCookie,
      domain: '.x.com',
      path: '/',
      httpOnly: true,
      secure: true,
    });
  }

  return page;
}

export const createPage = getAuthenticatedPage;

// ============================================================================
// Profile Scraper
// ============================================================================

/**
 * Scrape profile information for a user
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} username - Twitter username (without the at symbol)
 * @returns {Promise<Record<string, unknown>>} Profile data
 */
export async function scrapeProfile(sessionCookie, username) {
  const page = await getAuthenticatedPage(sessionCookie);
  
  try {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const profile = await page.evaluate(() => {
      const getText = (/** @type {string} */ sel) => document.querySelector(sel)?.textContent?.trim() || null;
      const getAttr = (/** @type {string} */ sel, /** @type {string} */ attr) => document.querySelector(sel)?.getAttribute(attr) || null;

      // Get avatar
      const avatar = document.querySelector('[data-testid="UserAvatar-Container-unknown"] img, [data-testid*="UserAvatar"] img')?.src;

      // Parse name and username
      const nameSection = document.querySelector('[data-testid="UserName"]');
      const fullText = nameSection?.textContent || '';
      const usernameMatch = fullText.match(/@(\w+)/);

      // Get stats
      const followingLink = document.querySelector('a[href$="/following"]');
      const followersLink = document.querySelector('a[href$="/verified_followers"], a[href$="/followers"]');

      const followingText = followingLink?.querySelector('span')?.textContent || null;
      const followersText = followersLink?.querySelector('span')?.textContent || null;

      return {
        name: fullText.split('@')[0]?.trim() || null,
        displayName: fullText.split('@')[0]?.trim() || null,
        username: usernameMatch?.[1] || null,
        bio: getText('[data-testid="UserDescription"]'),
        location: getText('[data-testid="UserLocation"]'),
        website: getAttr('[data-testid="UserUrl"]', 'href') || getAttr('[data-testid="UserUrl"] a', 'href'),
        joinDate: getText('[data-testid="UserJoinDate"]'),
        following: followingText ? parseCompactNumber(followingText) : null,
        followers: followersText ? parseCompactNumber(followersText) : null,
        profileImage: avatar || null,
        profileImageUrl: avatar || null,
        verified: !!document.querySelector('[data-testid="UserName"] svg[aria-label*="Verified"]'),
        protected: !!document.querySelector('[data-testid="UserName"] svg[aria-label*="Protected"]'),
      };
    });

    return profile;
  } finally {
    await page.close();
  }
}

// ============================================================================
// Followers Scraper
// ============================================================================

/**
 * Scrape followers for a user
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} username - Twitter username
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { users: [], nextCursor }
 */
export async function scrapeFollowers(sessionCookie, username, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 100;
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/${username}/followers`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const users = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (users.size < limit && retries < maxRetries) {
      const userData = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        return Array.from(cells).map((cell) => {
          const link = cell.querySelector('a[href^="/"]');
          const nameEl = cell.querySelector('[dir="ltr"] > span');
          const bioEl = cell.querySelector('[data-testid="UserDescription"]');
          const verifiedEl = cell.querySelector('svg[aria-label*="Verified"]');
          const avatarEl = cell.querySelector('img[src*="profile_images"]');

          const href = link?.getAttribute('href') || '';
          const username = href.split('/')[1];

          return {
            username,
            name: nameEl?.textContent || null,
            bio: bioEl?.textContent || null,
            verified: !!verifiedEl,
            profileImage: avatarEl?.src || null,
          };
        }).filter((u) => !!u.username && !u.username.includes('?'));
      });

      const prevSize = users.size;
      userData.forEach((u) => users.set(u.username, u));

      if (users.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      // Scroll down
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      users: Array.from(users.values()).slice(0, limit),
      nextCursor: null, // Browser automation doesn't have cursor support
    };
  } finally {
    await page.close();
  }
}

// ============================================================================
// Following Scraper
// ============================================================================

/**
 * Scrape accounts a user is following
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} username - Twitter username
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { users: [], nextCursor }
 */
export async function scrapeFollowing(sessionCookie, username, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 100;
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/${username}/following`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const users = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (users.size < limit && retries < maxRetries) {
      const userData = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        return Array.from(cells).map((cell) => {
          const link = cell.querySelector('a[href^="/"]');
          const nameEl = cell.querySelector('[dir="ltr"] > span');
          const bioEl = cell.querySelector('[data-testid="UserDescription"]');
          const followsBackEl = cell.querySelector('[data-testid="userFollowIndicator"]');
          const verifiedEl = cell.querySelector('svg[aria-label*="Verified"]');
          const avatarEl = cell.querySelector('img[src*="profile_images"]');

          const href = link?.getAttribute('href') || '';
          const username = href.split('/')[1];

          return {
            username,
            name: nameEl?.textContent || null,
            bio: bioEl?.textContent || null,
            followsBack: !!followsBackEl,
            verified: !!verifiedEl,
            profileImage: avatarEl?.src || null,
          };
        }).filter((u) => !!u.username && !u.username.includes('?'));
      });

      const prevSize = users.size;
      userData.forEach((u) => users.set(u.username, u));

      if (users.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      users: Array.from(users.values()).slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// ============================================================================
// Tweets Scraper
// ============================================================================

/**
 * Scrape tweets from a user's profile
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} username - Twitter username
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { items: [], nextCursor }
 */
export async function scrapeTweets(sessionCookie, username, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 50;
  const includeReplies = typeof options.includeReplies === 'boolean' ? options.includeReplies : false;
  const tab = typeof options.tab === 'string' ? options.tab : 'tweets';
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    let url = `https://x.com/${username}`;
    if (tab === 'likes') {
      url = `https://x.com/${username}/likes`;
    } else if (includeReplies) {
      url = `https://x.com/${username}/with_replies`;
    }
      
    await page.goto(url, { waitUntil: 'networkidle2' });
    await randomDelay();

    const tweets = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (tweets.size < limit && retries < maxRetries) {
      const tweetData = await page.evaluate(() => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(articles).map((article) => {
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const timeEl = article.querySelector('time');
          const likesEl = article.querySelector('[data-testid="like"] span span');
          const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
          const repliesEl = article.querySelector('[data-testid="reply"] span span');
          const viewsEl = article.querySelector('a[href*="/analytics"] span span');
          const linkEl = article.querySelector('a[href*="/status/"]');
          
          // Get media
          const images = /** @type {HTMLImageElement[]} */ (Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img'))).map((i) => ({
            type: 'image',
            url: i.src,
          }));
          const hasVideo = !!article.querySelector('[data-testid="videoPlayer"]');
          
          return {
            id: linkEl?.href?.match(/status\/(\d+)/)?.[1] || null,
            text: textEl?.textContent || null,
            username,
            author: {
              username,
              name: null,
            },
            timestamp: timeEl?.getAttribute('datetime') || null,
            likes: parseCompactNumber(likesEl?.textContent),
            retweets: parseCompactNumber(retweetsEl?.textContent),
            replies: parseCompactNumber(repliesEl?.textContent),
            views: parseCompactNumber(viewsEl?.textContent),
            url: linkEl?.href || null,
            media: [...images, ...(hasVideo ? [{ type: 'video', url: linkEl?.href }] : [])],
            isRetweet: !!article.querySelector('[data-testid="socialContext"]'),
            isQuote: !!article.querySelector('[data-testid="quoteTweet"]'),
          };
        }).filter((t) => !!t.id);
      });

      const prevSize = tweets.size;
      tweetData.forEach((t) => tweets.set(t.id, t));

      if (tweets.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      items: Array.from(tweets.values()).slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// ============================================================================
// Search Tweets
// ============================================================================

/**
 * Search tweets by query
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} query - Search query
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { items: [], nextCursor }
 */
export async function searchTweets(sessionCookie, query, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 50;
  const filter = typeof options.filter === 'string' ? options.filter : 'latest';
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    /** @type {Record<string, string>} */
    const filterMap = {
      latest: 'live',
      top: 'top',
      people: 'user',
      photos: 'image',
      videos: 'video',
      media: 'media',
    };
    
    const encodedQuery = encodeURIComponent(query);
    const f = filterMap[filter] || 'live';
    
    await page.goto(`https://x.com/search?q=${encodedQuery}&src=typed_query&f=${f}`, {
      waitUntil: 'networkidle2',
    });
    await randomDelay();

    const tweets = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (tweets.size < limit && retries < maxRetries) {
      const tweetData = await page.evaluate(() => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(articles).map((article) => {
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
          const authorName = article.querySelector('[data-testid="User-Name"]')?.textContent;
          const timeEl = article.querySelector('time');
          const linkEl = article.querySelector('a[href*="/status/"]');
          const likesEl = article.querySelector('[data-testid="like"] span span');
          const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
          const repliesEl = article.querySelector('[data-testid="reply"] span span');
          
          return {
            id: linkEl?.href?.match(/status\/(\d+)/)?.[1] || null,
            text: textEl?.textContent || null,
            author: {
              username: authorLink?.href?.split('/')[3] || null,
              name: authorName?.split('@')[0]?.trim() || null,
            },
            username: authorLink?.href?.split('/')[3] || null,
            timestamp: timeEl?.getAttribute('datetime') || null,
            likes: parseCompactNumber(likesEl?.textContent),
            retweets: parseCompactNumber(retweetsEl?.textContent),
            replies: parseCompactNumber(repliesEl?.textContent),
            url: linkEl?.href || null,
          };
        }).filter((t) => !!t.id);
      });

      const prevSize = tweets.size;
      tweetData.forEach((t) => tweets.set(t.id, t));

      if (tweets.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      items: Array.from(tweets.values()).slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// ============================================================================
// Thread Scraper
// ============================================================================

/**
 * Scrape a full tweet thread
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} tweetId - Tweet ID to scrape thread from
 * @returns {Promise<Record<string, unknown>>} { author, tweets: [] }
 */
export async function scrapeThread(sessionCookie, tweetId) {
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/i/status/${tweetId}`, { waitUntil: 'networkidle2' });
    await randomDelay();

    // Scroll to load full thread
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1000, 2000);
    }

    const thread = await page.evaluate((mainTweetId) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      
      // Get main author
      const mainArticle = Array.from(articles).find(/** @param {Element} a */ (a) =>
        !!a.querySelector(`a[href*="/status/${mainTweetId}"]`)
      );
      const mainAuthorEl = mainArticle?.querySelector('[data-testid="User-Name"] a');
      const mainAuthor = mainAuthorEl?.href?.split('/')[3];
      const mainAuthorName = mainArticle?.querySelector('[data-testid="User-Name"]')?.textContent?.split('@')[0]?.trim();

      const tweets = Array.from(articles)
        .map((article) => {
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
          const timeEl = article.querySelector('time');
          const linkEl = article.querySelector('a[href*="/status/"]');
          const likesEl = article.querySelector('[data-testid="like"] span span');
          const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
          const repliesEl = article.querySelector('[data-testid="reply"] span span');
          
          const authorUsername = authorLink?.href?.split('/')[3];
          
          return {
            id: linkEl?.href?.match(/status\/(\d+)/)?.[1] || null,
            text: textEl?.textContent || null,
            username: authorUsername,
            author: {
              username: authorUsername,
              name: null,
            },
            timestamp: timeEl?.getAttribute('datetime') || null,
            likes: parseCompactNumber(likesEl?.textContent),
            retweets: parseCompactNumber(retweetsEl?.textContent),
            replies: parseCompactNumber(repliesEl?.textContent),
            url: linkEl?.href || null,
            isMainAuthor: authorUsername === mainAuthor,
          };
        })
        .filter((t) => !!t.id && !!t.isMainAuthor);

      return {
        author: {
          username: mainAuthor,
          name: mainAuthorName,
        },
        tweets,
      };
    }, tweetId);

    return thread;
  } finally {
    await page.close();
  }
}

// ============================================================================
// Hashtag Scraper
// ============================================================================

/**
 * Scrape tweets for a hashtag
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} hashtag - Hashtag to search (with or without #)
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { items: [], nextCursor }
 */
export async function scrapeHashtag(sessionCookie, hashtag, options = {}) {
  const tag = hashtag.startsWith('#') ? hashtag.slice(1) : hashtag;
  return searchTweets(sessionCookie, `#${tag}`, options);
}

// ============================================================================
// Media Scraper
// ============================================================================

/**
 * Scrape media (images/videos) from a user
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} username - Twitter username
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { items: [], nextCursor }
 */
export async function scrapeMedia(sessionCookie, username, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 50;
  const type = typeof options.type === 'string' ? options.type : 'all';
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/${username}/media`, { waitUntil: 'networkidle2' });
    await randomDelay();

    /** @type {{ type: string; url: string; tweetUrl?: string; tweetId?: string }[]} */
    const media = [];
    let retries = 0;
    const maxRetries = 10;

    while (media.length < limit && retries < maxRetries) {
      /** @type {{ type: string; url: string; tweetUrl?: string; tweetId?: string }[]} */
      const newMedia = await page.evaluate(() => {
        const items = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(items).flatMap((article) => {
          const tweetUrl = article.querySelector('a[href*="/status/"]')?.href;
          const tweetId = tweetUrl?.match(/status\/(\d+)/)?.[1];
          if (!tweetUrl) return [];
          
          const images = /** @type {HTMLImageElement[]} */ (Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img')))
            .map((img) => ({
              type: 'image',
              url: img.src.replace(/&name=\w+/, '&name=large'),
              tweetUrl,
              tweetId,
            }));
          
          const hasVideo = !!article.querySelector('[data-testid="videoPlayer"]');
          const videos = hasVideo ? [{
            type: 'video',
            url: tweetUrl,
            tweetUrl,
            tweetId,
          }] : [];
          
          return [...images, ...videos];
        });
      });

      const prevLength = media.length;
      newMedia.forEach((m) => {
        if (!media.find((existing) => existing.url === m.url)) {
          if (type === 'all' || type === m.type + 's') {
            media.push(m);
          }
        }
      });

      if (media.length === prevLength) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      items: media.slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// ============================================================================
// Tweet Likes Scraper (users who liked a tweet)
// ============================================================================

/**
 * Scrape users who liked a tweet
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} tweetId - Tweet ID
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { users: [], nextCursor }
 */
export async function scrapeTweetLikes(sessionCookie, tweetId, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 100;
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/i/status/${tweetId}/likes`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const users = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (users.size < limit && retries < maxRetries) {
      const userData = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        return Array.from(cells).map((cell) => {
          const link = cell.querySelector('a[href^="/"]');
          const nameEl = cell.querySelector('[dir="ltr"] > span');
          const bioEl = cell.querySelector('[data-testid="UserDescription"]');
          const verifiedEl = cell.querySelector('svg[aria-label*="Verified"]');

          const href = link?.getAttribute('href') || '';
          const username = href.split('/')[1];

          return {
            username,
            name: nameEl?.textContent || null,
            bio: bioEl?.textContent || null,
            verified: !!verifiedEl,
          };
        }).filter((u) => !!u.username && !u.username.includes('?'));
      });

      const prevSize = users.size;
      userData.forEach((u) => users.set(u.username, u));

      if (users.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      users: Array.from(users.values()).slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// Alias for backward compatibility
export const scrapeLikes = scrapeTweetLikes;

// ============================================================================
// Tweet Retweets Scraper (users who retweeted a tweet)
// ============================================================================

/**
 * Scrape users who retweeted a tweet
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} tweetId - Tweet ID
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { users: [], nextCursor }
 */
export async function scrapeTweetRetweets(sessionCookie, tweetId, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 100;
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/i/status/${tweetId}/retweets`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const users = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (users.size < limit && retries < maxRetries) {
      const userData = await page.evaluate(() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        return Array.from(cells).map((cell) => {
          const link = cell.querySelector('a[href^="/"]');
          const nameEl = cell.querySelector('[dir="ltr"] > span');
          const bioEl = cell.querySelector('[data-testid="UserDescription"]');
          const verifiedEl = cell.querySelector('svg[aria-label*="Verified"]');

          const href = link?.getAttribute('href') || '';
          const username = href.split('/')[1];

          return {
            username,
            name: nameEl?.textContent || null,
            bio: bioEl?.textContent || null,
            verified: !!verifiedEl,
          };
        }).filter((u) => !!u.username && !u.username.includes('?'));
      });

      const prevSize = users.size;
      userData.forEach((u) => users.set(u.username, u));

      if (users.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      users: Array.from(users.values()).slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// Alias for backward compatibility
export const scrapeRetweets = scrapeTweetRetweets;

// ============================================================================
// Bookmarks Scraper
// ============================================================================

/**
 * Scrape user's bookmarks
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {Record<string, unknown>} options - Scraping options
 * @returns {Promise<Record<string, unknown>>} { items: [], nextCursor }
 */
export async function scrapeBookmarks(sessionCookie, options = {}) {
  const limit = typeof options.limit === 'number' ? options.limit : 100;
  const cursor = options.cursor ? String(options.cursor) : undefined;
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto('https://x.com/i/bookmarks', { waitUntil: 'networkidle2' });
    await randomDelay();

    const bookmarks = new Map();
    let retries = 0;
    const maxRetries = 10;

    while (bookmarks.size < limit && retries < maxRetries) {
      const bookmarkData = await page.evaluate(() => {
        const articles = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(articles).map((article) => {
          const textEl = article.querySelector('[data-testid="tweetText"]');
          const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
          const authorName = article.querySelector('[data-testid="User-Name"]')?.textContent;
          const timeEl = article.querySelector('time');
          const linkEl = article.querySelector('a[href*="/status/"]');
          const likesEl = article.querySelector('[data-testid="like"] span span');
          const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
          const repliesEl = article.querySelector('[data-testid="reply"] span span');
          
          return {
            id: linkEl?.href?.match(/status\/(\d+)/)?.[1] || null,
            text: textEl?.textContent || null,
            author: {
              username: authorLink?.href?.split('/')[3] || null,
              name: authorName?.split('@')[0]?.trim() || null,
            },
            username: authorLink?.href?.split('/')[3] || null,
            timestamp: timeEl?.getAttribute('datetime') || null,
            likes: parseCompactNumber(likesEl?.textContent),
            retweets: parseCompactNumber(retweetsEl?.textContent),
            replies: parseCompactNumber(repliesEl?.textContent),
            url: linkEl?.href || null,
          };
        }).filter((t) => !!t.id);
      });

      const prevSize = bookmarks.size;
      bookmarkData.forEach((b) => bookmarks.set(b.id, b));

      if (bookmarks.size === prevSize) {
        retries++;
      } else {
        retries = 0;
      }

      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await randomDelay(1500, 3000);
    }

    return {
      items: Array.from(bookmarks.values()).slice(0, limit),
      nextCursor: null,
    };
  } finally {
    await page.close();
  }
}

// ============================================================================
// Tweet Details Scraper
// ============================================================================

/**
 * Scrape details of a specific tweet
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} tweetId - Tweet ID
 * @returns {Promise<Record<string, unknown> | null>} Tweet details
 */
export async function scrapeTweetDetails(sessionCookie, tweetId) {
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/i/status/${tweetId}`, { waitUntil: 'networkidle2' });
    await randomDelay();

    const tweet = await page.evaluate(() => {
      const article = document.querySelector('article[data-testid="tweet"]');
      if (!article) return null;

      const textEl = article.querySelector('[data-testid="tweetText"]');
      const authorLink = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
      const authorName = article.querySelector('[data-testid="User-Name"]')?.textContent;
      const timeEl = article.querySelector('time');
      const likesEl = article.querySelector('[data-testid="like"] span span');
      const retweetsEl = article.querySelector('[data-testid="retweet"] span span');
      const repliesEl = article.querySelector('[data-testid="reply"] span span');
      const viewsEl = article.querySelector('a[href*="/analytics"] span span');
      
      // Get media
      const images = /** @type {HTMLImageElement[]} */ (Array.from(article.querySelectorAll('[data-testid="tweetPhoto"] img'))).map((i) => ({
        type: 'image',
        url: i.src,
      }));
      const hasVideo = !!article.querySelector('[data-testid="videoPlayer"]');

      return {
        id: window.location.pathname.match(/status\/(\d+)/)?.[1] || null,
        text: textEl?.textContent || null,
        author: {
          username: authorLink?.href?.split('/')[3] || null,
          name: authorName?.split('@')[0]?.trim() || null,
        },
        timestamp: timeEl?.getAttribute('datetime') || null,
        likes: parseCompactNumber(likesEl?.textContent),
        retweets: parseCompactNumber(retweetsEl?.textContent),
        replies: parseCompactNumber(repliesEl?.textContent),
        views: parseCompactNumber(viewsEl?.textContent),
        media: [...images, ...(hasVideo ? [{ type: 'video' }] : [])],
        isQuote: !!article.querySelector('[data-testid="quoteTweet"]'),
      };
    });

    return tweet;
  } finally {
    await page.close();
  }
}

// ============================================================================
// Video URL Extractor
// ============================================================================

/**
 * Extract video URLs from a tweet
 * @param {string} sessionCookie - X/Twitter auth token
 * @param {string} tweetId - Tweet ID containing video
 * @returns {Promise<Record<string, unknown>[]>} Array of video URLs with quality info
 */
export async function extractVideoUrls(sessionCookie, tweetId) {
  const page = await getAuthenticatedPage(sessionCookie);

  try {
    await page.goto(`https://x.com/i/status/${tweetId}`, { waitUntil: 'networkidle2' });
    await randomDelay();

    // Click on video to ensure it loads
    const videoPlayer = await page.$('[data-testid="videoPlayer"]');
    if (videoPlayer) {
      await videoPlayer.click().catch(() => {});
      await sleep(2000);
    }

    const videos = await page.evaluate(() => {
      /** @type {Record<string, unknown>[]} */
      const results = [];
      const pageContent = document.documentElement.innerHTML;
      
      // Look for video URLs in the page
      const patterns = [
        /https:\/\/video\.twimg\.com\/[^"'\s]+\.mp4[^"'\s]*/g,
        /https:\/\/[^"'\s]*\/amplify_video[^"'\s]*\.mp4[^"'\s]*/g,
        /https:\/\/[^"'\s]*\/ext_tw_video[^"'\s]*\.mp4[^"'\s]*/g,
      ];
      
      patterns.forEach((pattern) => {
        const matches = pageContent.match(pattern) || [];
        matches.forEach((url) => {
          // Clean up URL
          let cleanUrl = url.replace(/\\u002F/g, '/').replace(/\\/g, '');
          cleanUrl = cleanUrl.split('"')[0].split("'")[0].split(' ')[0];
          
          if (cleanUrl.includes('.mp4')) {
            // Extract quality from URL
            const qualityMatch = cleanUrl.match(/\/(\d+x\d+)\//);
            const quality = qualityMatch ? qualityMatch[1] : 'unknown';
            
            // Extract bitrate if available
            const bitrateMatch = cleanUrl.match(/vid\/(\d+)/);
            const bitrate = bitrateMatch ? parseInt(bitrateMatch[1]) : null;
            
            results.push({ 
              url: cleanUrl, 
              quality,
              bitrate,
              contentType: 'video/mp4',
            });
          }
        });
      });

      // Deduplicate by URL (ignoring query params)
      /** @type {Record<string, unknown>[]} */
      const unique = [];
      const seen = new Set();
      results.forEach((v) => {
        const key = String(v.url).split('?')[0];
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(v);
        }
      });

      // Sort by quality (highest first)
      return unique.sort((a, b) => {
        const getPixels = (/** @type {string} */ q) => {
          const match = q.match(/(\d+)x(\d+)/);
          return match ? parseInt(match[1]) * parseInt(match[2]) : 0;
        };
        return getPixels(String(b.quality)) - getPixels(String(a.quality));
      });
    });

    return videos;
  } finally {
    await page.close();
  }
}


/**
 * Navigate to X/Twitter home.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
export async function navigateToTwitter(page) {
  await page.goto('https://x.com/home', { waitUntil: 'networkidle2' });
}


/**
 * Check whether the current page appears to be logged in to X/Twitter.
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
export async function checkAuthentication(page) {
  return !!(await page.$('[data-testid="AppTabBar_Home_Link"], [data-testid="SideNav_AccountSwitcher_Button"], [data-testid="primaryColumn"]'));
}

/**
 * Scrape a user's recent tweets, normalizing the shape used by operations.
 * @param {string} sessionCookie
 * @param {string} username
 * @param {number} [limit]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function getUserTweets(sessionCookie, username, limit = 50) {
  const result = await scrapeTweets(sessionCookie, username, { limit });
  /** @type {Record<string, unknown>[]} */
  const items = /** @type {Record<string, unknown>[]} */ (result.items || []);
  return items.map((t) => {
    const author = /** @type {Record<string, unknown>} */ (t.author);
    return {
      id: String(t.id || ''),
      text: String(t.text || ''),
      url: String(t.url || ''),
      username: String(author.username || '')
    };
  });
}

/**
 * Scrape accounts a user is following.
 * @param {string} sessionCookie
 * @param {string} username
 * @param {number} [limit]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function getFollowing(sessionCookie, username, limit = 100) {
  const result = await scrapeFollowing(sessionCookie, username, { limit });
  /** @type {Record<string, unknown>[]} */
  const users = /** @type {Record<string, unknown>[]} */ (result.users || []);
  return users.map((u) => ({
    username: String(u.username || ''),
    displayName: String(u.name || ''),
    name: String(u.name || ''),
    bio: u.bio,
    verified: u.verified,
    profileImage: u.profileImage,
    followsBack: u.followsBack
  }));
}

/**
 * Scrape a user's followers.
 * @param {string} sessionCookie
 * @param {string} username
 * @param {number} [limit]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function getFollowers(sessionCookie, username, limit = 100) {
  const result = await scrapeFollowers(sessionCookie, username, { limit });
  /** @type {Record<string, unknown>[]} */
  const users = /** @type {Record<string, unknown>[]} */ (result.users || []);
  return users.map((u) => ({
    username: String(u.username || ''),
    displayName: String(u.name || ''),
    name: String(u.name || ''),
    bio: u.bio,
    verified: u.verified,
    profileImage: u.profileImage
  }));
}

/**
 * Scrape users who liked or retweeted a tweet.
 * @param {string} sessionCookie
 * @param {string} tweetUrl
 * @param {'likes' | 'retweets'} [engagementType]
 * @param {number} [limit]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function getTweetEngagers(sessionCookie, tweetUrl, engagementType = 'likes', limit = 100) {
  const tweetId = tweetUrl.split('/status/')[1]?.split('?')[0];
  if (!tweetId) throw new Error('Invalid tweet URL');

  const result = engagementType === 'likes'
    ? await scrapeTweetLikes(sessionCookie, tweetId, { limit })
    : await scrapeTweetRetweets(sessionCookie, tweetId, { limit });

  /** @type {Record<string, unknown>[]} */
  const users = /** @type {Record<string, unknown>[]} */ (result.users || []);
  return users.map((u) => ({
    username: String(u.username || ''),
    displayName: String(u.name || ''),
    name: String(u.name || '')
  }));
}

/**
 * Follow a user by navigating to their profile and clicking the Follow button.
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Record<string, unknown>>}
 */
export async function followUser(page, username) {
  try {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    await randomDelay(1000, 2000);

    const followButton = await page.$('button[aria-label*="Follow" i], div[data-testid="follow"]');
    if (!followButton) {
      return { success: true, alreadyFollowing: true };
    }

    await followButton.click();
    await sleep(2000);
    return { success: true, alreadyFollowing: false };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Unfollow a user by navigating to their profile and clicking the Unfollow button.
 * @param {import('puppeteer').Page} page
 * @param {string} username
 * @returns {Promise<Record<string, unknown>>}
 */
export async function unfollowUser(page, username) {
  try {
    await page.goto(`https://x.com/${username}`, { waitUntil: 'networkidle2' });
    await randomDelay(1000, 2000);

    const unfollowButton = await page.$('button[aria-label*="Following" i], div[data-testid="unfollow"]');
    if (!unfollowButton) {
      return { success: false, error: 'Unfollow button not found' };
    }

    await unfollowButton.click();
    await sleep(500);

    const confirmButton = await page.$('div[data-testid="confirmationSheetConfirm"]');
    if (confirmButton) await confirmButton.click();

    await sleep(1500);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Like a tweet by navigating to it and clicking the Like button.
 * @param {import('puppeteer').Page} page
 * @param {string} tweetUrl
 * @returns {Promise<Record<string, unknown>>}
 */
export async function likePost(page, tweetUrl) {
  try {
    await page.goto(tweetUrl, { waitUntil: 'networkidle2' });
    await randomDelay(1000, 2000);

    const likeButton = await page.$('div[data-testid="like"]');
    if (!likeButton) {
      const unlikeButton = await page.$('div[data-testid="unlike"]');
      if (unlikeButton) return { success: true, alreadyLiked: true };
      return { success: false, error: 'Like button not found' };
    }

    await likeButton.click();
    await sleep(2000);
    return { success: true, alreadyLiked: false };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Post a comment on a tweet.
 * @param {import('puppeteer').Page} page
 * @param {string} tweetUrl
 * @param {string} commentText
 * @returns {Promise<Record<string, unknown>>}
 */
export async function postComment(page, tweetUrl, commentText) {
  try {
    await page.goto(tweetUrl, { waitUntil: 'networkidle2' });
    await randomDelay(1000, 2000);

    const replyButton = await page.$('div[data-testid="reply"]');
    if (!replyButton) {
      return { success: false, error: 'Reply button not found' };
    }

    await replyButton.click();
    await page.waitForSelector('div[role="textbox"]', { timeout: 5000 });
    await page.type('div[role="textbox"]', commentText);

    const tweetButton = await page.$('button[data-testid="tweetButton"], div[data-testid="tweetButton"]');
    if (!tweetButton) {
      return { success: false, error: 'Tweet button not found' };
    }

    await tweetButton.click();
    await sleep(3000);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// Legacy BrowserAutomation Class (for backward compatibility)
// ============================================================================

class BrowserAutomation {
  constructor() {
    /** @type {import('puppeteer').Browser | null} */
    this.browser = null;
  }

  /**
   * @returns {Promise<import('puppeteer').Browser>}
   */
  async initialize() {
    this.browser = await getBrowser();
    return this.browser;
  }

  /**
   * @param {string} [sessionCookie]
   * @returns {Promise<import('puppeteer').Page>}
   */
  async createPage(sessionCookie) {
    return getAuthenticatedPage(sessionCookie);
  }

  async close() {
    await closeBrowser();
  }

  /**
   * @param {import('puppeteer').Page} page
   * @returns {Promise<boolean>}
   */
  async checkAuthentication(page) {
    return checkAuthentication(page);
  }

  /**
   * @param {number} min
   * @param {number} max
   * @returns {Promise<number>}
   */
  async randomDelay(min, max) {
    return randomDelay(min, max);
  }
}

// Create singleton instance
const browserAutomation = new BrowserAutomation();

// Export everything
export { BrowserAutomation };
export default browserAutomation;
