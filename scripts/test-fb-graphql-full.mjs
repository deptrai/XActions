import 'dotenv/config';
import fs from 'node:fs';
import { ProxyIpPool } from '../src/proxy/proxy-pool.js';
import { FacebookClient } from '../src/scrapers/social/facebook/client.js';

const rawCookies = JSON.parse(fs.readFileSync('/Users/luisphan/.xactions/facebook-cookies.json', 'utf8'));
const cookieRecord = {};
for (const c of rawCookies) {
  if (c.name) cookieRecord[c.name] = c.value;
}

const FEEDBACK_ID = 'ZmVlZGJhY2s6MTY5ODYyMjE5ODEwNTAxNQ==';

async function main() {
  const proxyPool = new ProxyIpPool({ proxies: [process.env.PROXY_URL], validateOnAdd: false });
  const client = new FacebookClient({ proxyPool, client: 'got' });

  const res = await client.requestGraphQl(client.docIds?.COMMENT_ROOTS || '28217113134586234', {
    after: null,
    commentsAfterCount: 3,
    commentsAfterCursor: null,
    commentsBeforeCount: null,
    commentsBeforeCursor: null,
    commentsIntentToken: null,
    displayCommentsFeedbackContext: null,
    feedLocation: 'FEED_MOBILE',
    feedbackSource: 0,
    focusCommentID: null,
    id: FEEDBACK_ID,
    isAdPreview: false,
    isAdvertisingAndDesign: false,
    isAlbum: false,
    isCometLivePost: false,
    isEnvironmentSwitch: false,
    isFunFact: false,
    isGeographicActivityLog: false,
    isLongformStory: false,
    isMediaStyled: false,
    isNewShareSheet: false,
    isNotificationsDisabled: false,
    isPageNewsFeed: false,
    isPageOnImdb: false,
    isPageOnReact: false,
    isPageOnReddit: false,
    isPageOnTwitter: false,
    isPageStaticNullState: false,
    isPoll: false,
    isReactFocusInlineReply: false,
    isShare: false,
    isStory: false,
    isTranslucentHeader: false,
    isViaMediaProxy: false,
    isWatchParty: false,
    isWorkAccount: false,
    locale: 'en_US',
    numComments: 3,
    photoCommentFlexes: 0,
    privacySelectorRenderLocation: 'COMET_STREAM',
    renderLocation: 'comet.media_viewer',
    scale: 2,
    scope: 'COMET',
    shouldLimitActorName: false,
    shouldRenderCommentOnMedia: false,
    shouldSortComments: false,
    spoilerShouldWarn: false,
    targetDialect: null,
    useDefaultActor: false,
    videoChatViewerNuxType: null,
    videoId: null,
  }, {
    accountId: cookieRecord.c_user,
    cookies: cookieRecord,
  });

  fs.writeFileSync('/tmp/fb-graphql-response.json', JSON.stringify(res, null, 2));
  console.log('saved /tmp/fb-graphql-response.json');
}

main().catch(console.error);
