# TwitterCrawler Action Audit — 2026-09-03T06:40:48.012Z

| # | Action | Expected | Status | Duration (ms) | Items | Message |
|---|--------|----------|--------|---------------|-------|---------|
| 1 | profile | guest | OK | 6878 | 1 |  |
| 2 | media | guest | OK | 9002 | 3 |  |
| 3 | thread | guest | OK | 2106 | 1 |  |
| 4 | thread (walkToRoot) | guest | OK | 19580 | 1 |  |
| 5 | trending | guest | OK | 5849 | 5 |  |
| 6 | download_video | guest | OK | 1490 | n/a |  |
| 7 | search | auth | AUTH_REQUIRED | 1 | 0 | Twitter search requires an authenticated session (auth_token cookie). Guest sear |
| 8 | hashtag | auth | AUTH_REQUIRED | 1 | 0 | Twitter hashtag search requires an authenticated session (auth_token cookie). Gu |
| 9 | spaces | auth | AUTH_REQUIRED | 1 | 0 | Twitter Spaces search requires an authenticated session (auth_token cookie). Gue |
| 10 | followers | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 11 | following | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 12 | retweeters | auth | AUTH_REQUIRED | 1 | 0 | No available account for authenticated crawler on platform twitter |
| 13 | non_followers | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 14 | list_members | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 15 | community_members | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 16 | likes | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 17 | likers | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 18 | bookmarks | auth | AUTH_REQUIRED | 1 | 0 | No available account for authenticated crawler on platform twitter |
| 19 | post | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 20 | reply | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 21 | quote | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 22 | schedule | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 23 | like | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 24 | unlike | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 25 | retweet | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 26 | undo_retweet | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 27 | follow | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 28 | unfollow | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 29 | block | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 30 | unblock | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 31 | mute | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 32 | unmute | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 33 | bookmark | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 34 | unbookmark | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 35 | create_list | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 36 | add_list_members | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 37 | remove_list_members | auth | AUTH_REQUIRED | 1 | 0 | No available account for authenticated crawler on platform twitter |
| 38 | send_dm | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 39 | dm_conversations | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |
| 40 | dm_messages | auth | AUTH_REQUIRED | 0 | 0 | No available account for authenticated crawler on platform twitter |

## Summary

- **Total**: 40
- **OK**: 6
- **AUTH_REQUIRED / Skipped**: 34
- **FAIL (other)**: 0
- **Auth cookie present**: no

## Notes

- Actions marked **guest** should succeed without an account.
- Actions marked **auth** require an authenticated session (`auth_token` + `ct0` cookies).
- Write actions were executed with `dryRun: true` to avoid side effects; real write actions need auth.
- `search`, `hashtag`, and `spaces*` currently require auth because X/Twitter closed guest SearchTimeline in 2026-09.
- `thread**** returns the root tweet for guests; full conversation still requires auth.
