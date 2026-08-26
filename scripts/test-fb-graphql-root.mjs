import 'dotenv/config';
import fs from 'node:fs';
import { ProxyIpPool } from '../src/proxy/proxy-pool.js';
import { FacebookClient } from '../src/scrapers/social/facebook/client.js';
import { FacebookCrawler } from '../src/scrapers/social/facebook/crawler.js';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}
const PROXY_URL = process.env.PROXY_URL;
const POST_URL = 'https://www.facebook.com/share/p/1EewJwQixN/';

async function main() {
  const proxyPool = new ProxyIpPool({ proxies: [PROXY_URL], validateOnAdd: false });
  const client = new FacebookClient({ proxyPool, client: 'got' });
  const crawler = new FacebookCrawler({ client });

  const context = await crawler.resolvePostFeedbackContext(POST_URL, { accountId: cookieRecord.c_user, cookies: cookieRecord });
  console.log('postContext:', context);

  const postId = context?.postExternalId || context?.feedbackId;
  const feedbackId = context?.feedbackId;
  const expansionToken = context?.expansionToken;

  if (!feedbackId) {
    console.log('No feedbackId, cannot run GraphQL');
    return;
  }

  const variables = {
    after: null,
    displayCommentsFeedbackContext: null,
    feedbackSource: 0,
    feedLocation: 'FEED_MOBILE',
    focusCommentID: null,
    isAdPreview: false,
    isAdvertisingAndDesign: false,
    isCometLivePost: false,
    isEnvironmentSwitch: false,
    isFunFact: false,
    isLongformStory: false,
    isMediaStyled: false,
    isNewShareSheet: false,
    isPageNewsFeed: false,
    isPageOnImdb: false,
    isPageOnReact: false,
    isPageOnReddit: false,
    isPageOnTwitter: false,
    isPageStaticNullState: false,
    isPoll: false,
    isStory: false,
    isAlbum: false,
    isGeographicActivityLog: false,
    isNotificationsDisabled: false,
    isReactFocusInlineReply: false,
    isShare: false,
    isTranslucentHeader: false,
    isViaMediaProxy: false,
    isWatchParty: false,
    isWorkAccount: false,
    locale: 'en_US',
    numComments: 20,
    photoCommentFlexes: 0,
    privacySelectorRenderLocation: 'COMET_STREAM',
    renderLocation: 'comet.media_viewer',
    scope: 'COMET',
    shouldLimitActorName: false,
    shouldRenderCommentOnMedia: false,
    shouldSortComments: false,
    spoilerShouldWarn: false,
    storyViewCount: null,
    storyViewerBucket: null,
    triggerData: null,
    useDefaultActor: false,
    videoChatViewerNuxType: null,
    videoId: null,
    id: feedbackId,
  };

  const response = await client.requestGraphQl(client.docIds?.COMMENT_ROOTS || '28217113134586234', variables, {
    accountId: cookieRecord.c_user,
    cookies: cookieRecord,
  });

  console.log('GraphQL response keys:', Object.keys(response));
  console.log('GraphQL errors:', JSON.stringify(response.errors)?.slice(0, 500));

  await crawler.cleanup();
}

main().catch((err) => {
  console.error('ERROR:', err);
});
