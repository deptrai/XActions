# Canonical Action/Arg Matrix

> Auto-generated 2026-09-21T12:36:46.065Z. Do not edit manually.

| Platform | Category | Action | Required Args | Optional Args | Example |
|----------|----------|--------|---------------|---------------|---------|
| twitter | social | search | query | type, filter, since, until, from, to, minLikes, minRetweets, lang, limit, cursor | `{"query":"javascript","type":"Latest","limit":20}` |
| twitter | social | hashtag | tag | hashtag, type, filter, since, until, minLikes, minRetweets, lang, limit, cursor | `{"tag":"AI","type":"Latest","limit":50}` |
| twitter | social | trending | — | woeid, limit, includePromoted | `{"woeid":1,"limit":30}` |
| twitter | social | thread | tweetId | cursor, limit, walkToRoot | `{"tweetId":"1234567890"}` |
| twitter | social | unroll_thread | tweetId | format, destPath, walkToRoot, cursor, limit | `{"tweetId":"1234567890","format":"markdown","destPath":"/tmp/thread.md"}` |
| twitter | social | likes | tweetId | limit, cursor | `{"tweetId":"1234567890","limit":100}` |
| twitter | social | likers | tweetId | limit, cursor | `{"tweetId":"1234567890","limit":100}` |
| twitter | social | bookmarks | — | limit, cursor | `{"limit":50}` |
| twitter | social | export_bookmarks | — | format, destPath, limit, cursor | `{"format":"csv","destPath":"/tmp/bookmarks.csv"}` |
| twitter | social | profile | — | username, url | `{"username":"elonmusk"}` |
| twitter | social | followers | username | limit, cursor | `{"username":"elonmusk","limit":100}` |
| twitter | social | following | username | limit, cursor | `{"username":"elonmusk","limit":100}` |
| twitter | social | retweeters | tweetId | limit, cursor | `{"tweetId":"1234567890","limit":100}` |
| twitter | social | non_followers | username | limit | `{"username":"myuser","limit":1000}` |
| twitter | social | list_members | listUrl | listId, limit, cursor | `{"listUrl":"https://x.com/i/lists/1234567890123456789","limit":100}` |
| twitter | social | community_members | communityUrl | communityId, limit, cursor | `{"communityUrl":"https://x.com/i/communities/1234567890123456789","limit":100}` |
| twitter | social | spaces | query | limit, cursor, state | `{"query":"crypto","limit":20}` |
| twitter | social | media | — | username, tweetId, type, limit, cursor | `{"username":"elonmusk","type":"video","limit":20}` |
| twitter | social | download_video | tweetId | quality, destPath | `{"tweetId":"1234567890123456789","destPath":"/tmp/video.mp4"}` |
| twitter | social | post | text | mediaIds, premium, sensitive, dryRun | `{"text":"Hello XActions","mediaIds":["123"],"dryRun":false}` |
| twitter | social | reply | tweetId, text | mediaIds, premium, sensitive, dryRun | `{"tweetId":"1900000000000000000","text":"Nice","dryRun":false}` |
| twitter | social | quote | tweetId, text | mediaIds, premium, sensitive, dryRun | `{"tweetId":"1900000000000000000","text":"Agree","dryRun":false}` |
| twitter | social | schedule | text, publishAt | mediaIds, premium, sensitive, dryRun | `{"text":"Hello future XActions","publishAt":"2026-09-01T12:00:00Z","dryRun":false}` |
| twitter | social | like | tweetId | dryRun | `{"tweetId":"1900000000000000000","dryRun":false}` |
| twitter | social | unlike | tweetId | dryRun | `{"tweetId":"1900000000000000000","dryRun":false}` |
| twitter | social | retweet | tweetId | dryRun | `{"tweetId":"1900000000000000000","dryRun":false}` |
| twitter | social | undo_retweet | tweetId | dryRun | `{"tweetId":"1900000000000000000","dryRun":false}` |
| twitter | social | follow | — | userId, username, dryRun | `{"username":"elonmusk","dryRun":false}` |
| twitter | social | unfollow | — | userId, username, dryRun | `{"username":"elonmusk","dryRun":false}` |
| twitter | social | block | — | userId, username, dryRun | `{"username":"spammer","dryRun":false}` |
| twitter | social | unblock | — | userId, username, dryRun | `{"username":"spammer","dryRun":false}` |
| twitter | social | mute | — | userId, username, dryRun | `{"username":"noisy_account","dryRun":false}` |
| twitter | social | unmute | — | userId, username, dryRun | `{"username":"noisy_account","dryRun":false}` |
| twitter | social | bookmark | tweetId | dryRun | `{"tweetId":"1900000000000000000","dryRun":false}` |
| twitter | social | unbookmark | tweetId | dryRun | `{"tweetId":"1900000000000000000","dryRun":false}` |
| twitter | social | send_dm | — | userId, username, text, mediaId, conversationId, dryRun | `{"username":"elonmusk","text":"Hello","dryRun":false}` |
| twitter | social | dm_conversations | — | limit, cursor | `{"limit":20}` |
| twitter | social | dm_messages | conversationId | limit, cursor | `{"conversationId":"123-456","limit":50}` |
| twitter | social | create_list | name | description, isPrivate, dryRun | `{"name":"Tech Leaders","description":"Curated list","isPrivate":false,"dryRun":false}` |
| twitter | social | add_list_members | listId | userIds, usernames, dryRun | `{"listId":"12345678","usernames":["elonmusk","sama"],"dryRun":false}` |
| twitter | social | remove_list_members | listId | userIds, usernames, dryRun | `{"listId":"12345678","usernames":["spammer"],"dryRun":false}` |
| bluesky | social | profile | handle | username, actor, identifier, password | `{"handle":"nichxbt.bsky.social"}` |
| bluesky | social | followers | handle | username, actor, limit, cursor, identifier, password | `{"handle":"nichxbt.bsky.social","limit":50}` |
| bluesky | social | following | handle | username, actor, limit, cursor, identifier, password | `{"handle":"nichxbt.bsky.social","limit":50}` |
| bluesky | social | posts | handle | username, actor, limit, cursor, filter, identifier, password | `{"handle":"nichxbt.bsky.social","limit":30}` |
| bluesky | social | tweets | handle | username, actor, limit, cursor, identifier, password | `{"handle":"nichxbt.bsky.social","limit":30}` |
| bluesky | social | search | query | limit, cursor, sort, since, until, author, identifier, password | `{"query":"bluesky","limit":25}` |
| bluesky | social | trending | — | limit, identifier, password | `{"limit":20}` |
| bluesky | social | feed | feedUri | feed, uri, limit, cursor, identifier, password | `{"feedUri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot"}` |
| bluesky | social | post_detail | — | uri, url, postUrl, postId, depth, parentHeight, identifier, password | `{"postUrl":"https://bsky.app/profile/alice.bsky.social/post/3abc"}` |
| bluesky | social | post | text | reply, dryRun, identifier, password | `{"text":"Hello Bluesky from XActions","dryRun":false}` |
| bluesky | social | reply | text, parentUri, parentCid | rootUri, rootCid, dryRun, identifier, password | `{"text":"Great point!","parentUri":"at://did:plc:.../app.bsky.feed.post/...","parentCid":"bafyre..."}` |
| bluesky | social | like | uri, cid | dryRun, identifier, password | `{"uri":"at://did:plc:.../app.bsky.feed.post/...","cid":"bafyre..."}` |
| bluesky | social | repost | uri, cid | dryRun, identifier, password | `{"uri":"at://did:plc:.../app.bsky.feed.post/...","cid":"bafyre..."}` |
| bluesky | social | retweet | uri, cid | dryRun, identifier, password | `{"uri":"at://did:plc:.../app.bsky.feed.post/...","cid":"bafyre..."}` |
| bluesky | social | follow | subject | handle, dryRun, identifier, password | `{"subject":"did:plc:z72i7hdynmk6r22z27h6tvur"}` |
| bluesky | social | unfollow | rkey | dryRun, identifier, password | `{"rkey":"3k2v..."}` |
| mastodon | social | profile | username | instance, target, accessToken | `{"username":"Gargron","instance":"https://mastodon.social"}` |
| mastodon | social | followers | username | instance, limit, max_id, onProgress, accessToken | `{"username":"Gargron","limit":40}` |
| mastodon | social | following | username | instance, limit, max_id, onProgress, accessToken | `{"username":"Gargron","limit":40}` |
| mastodon | social | posts | username | instance, limit, max_id, since_id, exclude_replies, onProgress, accessToken | `{"username":"Gargron","limit":20}` |
| mastodon | social | post_detail | — | statusId, id, url, postUrl, postId, instance, accessToken | `{"postUrl":"https://mastodon.social/@Gargron/1234567890"}` |
| mastodon | social | get_user_feed | username | instance, limit, max_id, accessToken | `{"username":"Gargron","limit":20}` |
| mastodon | social | search | query | instance, type, limit, max_id, accessToken | `{"query":"open source","limit":20}` |
| mastodon | social | hashtag | hashtag | instance, limit, max_id, accessToken | `{"hashtag":"technology","limit":20}` |
| mastodon | social | trending | — | instance, limit, accessToken | `{"limit":20}` |
| mastodon | social | post | text | status, media_ids, visibility, instance, dryRun, accessToken | `{"text":"Hello Mastodon from XActions","dryRun":false}` |
| mastodon | social | reply | text, in_reply_to_id | status, media_ids, instance, dryRun, accessToken | `{"text":"Great point!","in_reply_to_id":"123456789"}` |
| mastodon | social | like | statusId | instance, dryRun, accessToken | `{"statusId":"123456789"}` |
| mastodon | social | reblog | statusId | instance, dryRun, accessToken | `{"statusId":"123456789"}` |
| mastodon | social | retweet | statusId | instance, dryRun, accessToken | `{"statusId":"123456789"}` |
| mastodon | social | follow | accountId | username, instance, dryRun, accessToken | `{"accountId":"12345"}` |
| mastodon | social | unfollow | accountId | username, instance, dryRun, accessToken | `{"accountId":"12345"}` |
| facebook | social | group_posts | groupId | count, cursor | `{}` |
| facebook | social | page_posts | pageId | count, cursor | `{}` |
| facebook | social | get_comments | postId | maxDepth, maxComments, after | `{}` |
| facebook | social | post_comments | url | postId, maxDepth, maxComments, limit, includeReplies, after | `{}` |
| facebook | social | post_detail | — | url, postUrl, postId | `{}` |
| facebook | social | group_comments | url | postId, maxDepth, maxComments, limit, includeReplies, after | `{}` |
| facebook | social | profile | — | username, url | `{"username":"zuck"}` |
| facebook | social | followers | — | username, url, limit, cursor | `{"username":"zuck","limit":20}` |
| facebook | social | following | — | username, url, limit, cursor | `{"username":"zuck"}` |
| facebook | social | group_members | — | groupUrl, groupId, limit, cursor | `{"groupUrl":"https://www.facebook.com/groups/123456","limit":50}` |
| facebook | social | search | query | type, location, limit, cursor | `{"query":"artificial intelligence","type":"posts","limit":20}` |
| facebook | social | group_search | groupUrl, query | limit, cursor | `{"groupUrl":"https://www.facebook.com/groups/123456","query":"ai tools","limit":20}` |
| facebook | social | marketplace | query | location, category, categoryId, minPrice, maxPrice, limit, cursor, after, radiusKm, latitude, longitude, dryRun, priceMin, priceMax, sortBy, condition | `{"query":"macbook pro 14","location":"Ho Chi Minh City","minPrice":800,"maxPrice":1200,"limit":20}` |
| facebook | social | like | postUrl | postUrls, dryRun, delayMin, delayMax, maxBatch | `{"postUrl":"https://www.facebook.com/zuck/posts/1011565502"}` |
| facebook | social | comment | postUrl, text | postUrls, dryRun, delayMin, delayMax, maxBatch | `{"postUrl":"https://www.facebook.com/zuck/posts/1011565502","text":"Great update!"}` |
| facebook | social | post | text | mediaUrls, groupUrl, groupUrls, groupIds, profileUrl, profileUrls, dryRun, delayMin, delayMax, maxBatch | `{"text":"Hello Facebook from XActions Hybrid Crawler!"}` |
| facebook | social | share | postUrl | postUrls, message, dryRun, delayMin, delayMax, maxBatch | `{"postUrl":"https://www.facebook.com/zuck/posts/1011565502"}` |
| facebook | social | messenger_share | postUrl, recipientUids | recipientNames, message, dryRun, delayMin, delayMax, maxBatch | `{"postUrl":"https://www.facebook.com/zuck/posts/1011565502","recipientUids":["100001234567890"]}` |
| facebook | social | share_link_uid | postUrl, recipientUid | message, dryRun, delayMin, delayMax | `{"postUrl":"https://www.facebook.com/zuck/posts/1011565502","recipientUid":"100001234567890"}` |
| facebook | social | join_group | — | groupUrl, groupUrls, groupId, groupIds, keyword, limit, dryRun, delayMin, delayMax, maxBatch | `{"groupUrls":["https://www.facebook.com/groups/123456"]}` |
| facebook | social | send_friend_request | — | targets, mode, location, limit, dryRun, delayMin, delayMax, maxBatch | `{"targets":["https://www.facebook.com/zuck"]}` |
| facebook | social | warmup_scroll | — | targetUrl, durationSeconds, dryRun | `{"targetUrl":"https://www.facebook.com","durationSeconds":60}` |
| facebook | social | warmup_account | — | durationSeconds, allowReactions, reactProbability, dryRun | `{"durationSeconds":120,"allowReactions":true}` |
| facebook | social | cancel_friend_requests | — | limit, olderThanDays, dryRun | `{"limit":10,"olderThanDays":7}` |
| threads | social | get_user_feed | username | count, cursor | `{"username":"zuck","count":20}` |
| threads | social | search | query | count, cursor, searchType | `{"query":"artificial intelligence","count":20}` |
| threads | social | get_post_comments | postId | maxDepth, maxComments, after | `{"postId":"CuZ7X9_sF9y","maxDepth":3,"maxComments":100}` |
| threads | social | post_detail | postId | includeReplies, maxDepth, maxComments, after | `{"postId":"CuZ7X9_sF9y","includeReplies":true,"maxDepth":3,"maxComments":100}` |
| threads | social | profile | username | — | `{"username":"zuck"}` |
| threads | social | followers | username | count, cursor | `{"username":"zuck","count":50}` |
| threads | social | following | username | count, cursor | `{"username":"zuck","count":50}` |
| threads | social | post | text | dryRun | `{"text":"Hello Threads from XActions","dryRun":false}` |
| threads | social | reply | text, postId | dryRun | `{"text":"Great point!","postId":"12345","dryRun":false}` |
| threads | social | like | postId | dryRun | `{"postId":"12345","dryRun":false}` |
| threads | social | repost | postId | dryRun | `{"postId":"12345","dryRun":false}` |
| threads | social | retweet | postId | dryRun | `{"postId":"12345","dryRun":false}` |
| threads | social | follow | userId | username, dryRun | `{"userId":"12345","dryRun":false}` |
| threads | social | unfollow | userId | username, dryRun | `{"userId":"12345","dryRun":false}` |
| reddit | social | subreddit | name | subreddit, limit, sort, time, cursor, after | `{"name":"programming","limit":25,"sort":"new"}` |
| reddit | social | user | username | name, user, limit, sort, cursor, after | `{"username":"spez","limit":25}` |
| reddit | social | search | query | q, limit, sort, time, cursor, after | `{"query":"machine learning","limit":25}` |
| reddit | social | post_comments | postId | subreddit, postUrl, limit, depth, cursor, after | `{"postId":"1a2b3c","subreddit":"programming","limit":100}` |
| reddit | social | subreddit_info | name | subreddit | `{"name":"programming"}` |
| medium | social | user | username | limit, transport, cursor | `{"username":"karpathy","limit":10}` |
| medium | social | author | username | limit, transport, cursor | `{"username":"karpathy","limit":10}` |
| medium | social | posts | username | limit, transport, cursor | `{"username":"karpathy","limit":10}` |
| medium | social | tweets | username | limit, transport, cursor | `{"username":"karpathy","limit":10}` |
| medium | social | feed | username | limit, transport, cursor | `{"username":"karpathy","limit":10}` |
| medium | social | publication | slug | tag, limit, transport, cursor, domain | `{"slug":"towards-data-science","limit":10}` |
| medium | social | pub | slug | tag, limit, transport, cursor, domain | `{"slug":"towards-data-science","limit":10}` |
| medium | social | magazine | slug | tag, limit, transport, cursor, domain | `{"slug":"towards-data-science","limit":10}` |
| medium | social | tag | tag | limit, transport, cursor | `{"tag":"programming","limit":10}` |
| medium | social | hashtag | tag | limit, transport, cursor | `{"tag":"programming","limit":10}` |
| medium | social | topic | tag | limit, transport, cursor | `{"tag":"programming","limit":10}` |
| medium | social | post | postId | url, transport | `{"postId":"a64152b37c35"}` |
| medium | social | post_detail | postId | url, transport | `{"postId":"a64152b37c35"}` |
| medium | social | article | postId | url, transport | `{"postId":"a64152b37c35"}` |
| instagram | social | user | username | limit, cursor, transport | `{"username":"natgeo","limit":25}` |
| instagram | social | author | username | limit, cursor, transport | `{}` |
| instagram | social | profile | username | limit, cursor, transport | `{}` |
| instagram | social | hashtag | tag | limit, cursor, transport | `{"tag":"travel","limit":25}` |
| instagram | social | tag | tag | limit, cursor, transport | `{}` |
| instagram | social | topic | tag | limit, cursor, transport | `{}` |
| instagram | social | post | shortcode | transport | `{"shortcode":"Cxyz123"}` |
| instagram | social | post_detail | shortcode | transport | `{}` |
| instagram | social | media | shortcode | transport | `{}` |
| instagram | social | comments | shortcode | limit, cursor, transport | `{"shortcode":"Cxyz123","limit":50}` |
| tiktok | social | search | query | count, cursor | `{"query":"viral","count":12}` |
| tiktok | social | hashtag_feed | tag | count, cursor | `{"tag":"foryou","count":30}` |
| tiktok | social | post_detail | videoId | includeComments, maxDepth, maxComments | `{"videoId":"7325759242735676680"}` |
| tiktok | social | get_post_comments | videoId | maxDepth, maxComments, after | `{"videoId":"7325759242735676680","maxDepth":3,"maxComments":100}` |
| youtube | social | search | — | — | `{}` |
| youtube | social | trending_vn | — | — | `{}` |
| youtube | social | trending | — | — | `{}` |
| youtube | social | channel_videos | — | — | `{}` |
| youtube | social | channel_detail | — | — | `{}` |
| youtube | social | channel | — | — | `{}` |
| youtube | social | profile | — | — | `{}` |
| youtube | social | video_detail | — | — | `{}` |
| youtube | social | video | — | — | `{}` |
| youtube | social | detail | — | — | `{}` |
| youtube | social | video_comments | — | — | `{}` |
| youtube | social | comments | — | — | `{}` |
| zalo | social | oa_posts | — | — | `{}` |
| zalo | social | posts | — | — | `{}` |
| zalo | social | articles | — | — | `{}` |
| zalo | social | feed | — | — | `{}` |
| zalo | social | oa_followers | — | — | `{}` |
| zalo | social | followers | — | — | `{}` |
| zalo | social | oa_detail | — | — | `{}` |
| zalo | social | oa_info | — | — | `{}` |
| zalo | social | detail | — | — | `{}` |
| zalo | social | profile | — | — | `{}` |
| zalo | social | info | — | — | `{}` |
| zalo | social | marketplace_products | — | — | `{}` |
| zalo | social | marketplace_search | — | — | `{}` |
| zalo | social | products | — | — | `{}` |
| zalo | social | marketplace | — | — | `{}` |
| tiktokshop | ecom | top_products | — | category, limit, page, sortBy | `{"category":"fashion","limit":20}` |
| tiktokshop | ecom | product_detail | productId | — | `{"productId":"172948291048"}` |
| tiktokshop | ecom | search_products | keyword | limit, page, sortBy | `{"keyword":"son moi","limit":20}` |
| fnb | fnb_merchant | search_restaurants | city | platform, district, page, limit | `{"platform":"pasgo","city":"ha-noi","district":"dong-da"}` |
| fnb | fnb_merchant | newly_opened | days | platform, city, page, limit | `{"platform":"foody","days":30,"city":"ho-chi-minh"}` |
| fnb | fnb_merchant | search_by_district | city, district | platform, page, limit | `{"platform":"pasgo","city":"ha-noi","district":"dong-da"}` |
| fnb | fnb_merchant | detail | id | platform, slug, city | `{"platform":"pasgo","id":"123","city":"ha-noi"}` |
| healthcare | social | search_clinics | — | — | `{}` |
| healthcare | social | search_doctors | — | — | `{}` |
| healthcare | social | get_stores | — | — | `{}` |
| healthcare | social | pharmacy_catalog | — | — | `{}` |
| healthcare | social | detail | — | — | `{}` |
| ipvietnam | social | search_gazette | — | — | `{}` |
| ipvietnam | social | search | — | — | `{}` |
| ipvietnam | social | get_weekly_list | — | — | `{}` |
| ipvietnam | social | yearly_summary | — | — | `{}` |
| ipvietnam | social | detail | — | — | `{}` |
| automotive | automotive | search | platform | brand, model, city, yearMin, yearMax, priceMin, priceMax, page, limit | `{"platform":"oto_vn","brand":"toyota","city":"hanoi","page":1}` |
| automotive | automotive | list | platform | page, limit | `{"platform":"bonbanh","page":1}` |
| automotive | automotive | detail | platform, id | slug | `{"platform":"bonbanh","id":"6917077"}` |
| b2b_registry_extended | b2b | search | q | type, limit, platform, opt, p, d | `{"q":"0013180180","platform":"hosocongty"}` |
| b2b_registry_extended | b2b | search_tenders | keyword | searchType, searchScope, searchBy, keywordMatch, limit | `{"keyword":"xây dựng"}` |
| b2b_registry_extended | b2b | detail | id | platform, slug, notifyNo, tenderNo | `{"id":"0013180180","platform":"hosocongty"}` |
| linkedin | recruitment | search_jobs | keyword | location, start, limit, useCdp | `{"keyword":"Software Engineer","location":"Vietnam","limit":10}` |
| linkedin | recruitment | job_detail | jobId | jobUrl, useCdp | `{"jobId":"3892104910"}` |
| linkedin | recruitment | company_profile | companySlug | companyUrl, companyName, industry, scale, website, location, useCdp | `{"companySlug":"microsoft"}` |
| linkedin | recruitment | lead_profile | profileUrl | profileSlug, name, headline, title, companyName, location, cdpPort | `{"profileUrl":"https://www.linkedin.com/in/satyanadella"}` |
| batdongsan | realestate | search_listings | — | city, category, listingType, minPrice, maxPrice, page, limit | `{"city":"SG","category":"can-ho","limit":20}` |
| batdongsan | realestate | listing_detail | productId | url, city | `{"productId":"39821049"}` |
| chotot | realestate | search_listings | — | category, region, region_v2, area_v2, minPrice, maxPrice, minArea, maxArea, propertyType, listingType, limit, page, includePhone | `{"category":"bds","region_v2":13000,"limit":10,"includePhone":true}` |
| chotot | realestate | listing_detail | listId | category, includePhone | `{"listId":"11223344","includePhone":true}` |
| chotot | realestate | get_phone | listId | — | `{"listId":"11223344"}` |
| shopee | ecom | search_products | keyword | limit, page, sortBy, category | `{"keyword":"ao thun","limit":30,"sortBy":"sales"}` |
| shopee | ecom | product_detail | itemId, shopId | — | `{"itemId":"111222","shopId":"333444"}` |
| shopee | ecom | product_reviews | itemId, shopId | limit, offset, filterRating | `{"itemId":"111222","shopId":"333444","limit":20}` |
| topcv | recruitment | search_jobs | keyword | city, salary, exp, page, limit | `{"keyword":"NodeJS Developer","city":"hanoi","limit":20}` |
| topcv | recruitment | job_detail | jobId | jobUrl | `{"jobId":"123456","jobUrl":"https://www.topcv.vn/viec-lam/lap-trinh-vien-nodejs/123456.html"}` |
| topcv | recruitment | company_detail | companyId | companyUrl | `{"companyId":"techcorp-vn","companyUrl":"https://www.topcv.vn/brand/techcorp-vn"}` |
| vietnamworks | recruitment | search_jobs | keyword | city, locationId, salaryMin, salaryMax, exp, employmentType, page, limit | `{"keyword":"NodeJS Developer","locationId":29,"salaryMin":20000000,"limit":20}` |
| vietnamworks | recruitment | job_detail | jobId | jobUrl, keyword | `{"jobId":"1987654"}` |
| vietnamworks | recruitment | company_detail | companyId | companyName | `{"companyId":"vng-corporation","companyName":"VNG Corporation"}` |
| masothue | b2b | search | q | type, limit | `{"q":"0013180180"}` |
| masothue | b2b | search_by_province | province | page, limit | `{"province":"binh-duong","page":1}` |
| masothue | b2b | detail | taxCode | slug | `{"taxCode":"0013180180"}` |
