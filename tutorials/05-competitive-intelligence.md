# 05: Read any account like an analyst

**Time:** 15 minutes
**You need:** XActions installed. **No X account, no login, no API key.**
**You end up with:** a defensible read on how any account actually performs, and how two accounts differ.

Everything in this tutorial runs on the guest tier. You never log in.

---

## The question

"How does this account actually do?" is usually answered with follower count, which is the least useful number available. Follower count tells you about the past. What you want to know is how often they post, what they post, how much of their audience reacts, and when.

XActions answers all of that from public data.

---

## 1. One account

```bash
xactions analyze NASA
```

By default it samples the last 50 posts. The report is dense, so here is what each block is telling you:

```
  Audience
  Followers:            92.2M  119 following
  Follower ratio:       775.1K
  Growth:               13.6K/day  lifetime average over 6,802 days
```

**Follower ratio** is followers divided by following. A high ratio means an account people seek out; a ratio near 1 usually means follow-for-follow growth. **Growth** is a lifetime average, so it flatters accounts that grew fast years ago. Treat it as an upper bound, not a current rate.

```
  Output
  Posts, lifetime:      74.3K  10.92/day
  Posts, sampled:       2.48/day  30 posts over 12.1 days
  Typical gap:          2.11h
  Last post:            5h ago
```

The two rates are the interesting part. Lifetime says 10.92/day; the recent sample says 2.48/day. This account posts far less now than it used to. One number would have hidden that entirely.

```
  Engagement
  Rate:                 0.003%  median original post, as a share of followers
  Median per post:      2,713  ♥ 2,127  ↻ 330  💬 152
  Median views:         1M  0.26% of viewers interact, n=17
```

(`n=17` is how many sampled posts reported a view count. A small `n` there means the view-rate figure is directional, not precise.)

**Median, not mean.** One viral post drags a mean anywhere; the median tells you what a typical post does. The engagement rate looks tiny because it is measured against 92 million followers, which is why the views-based number underneath it matters more: 0.26% of people who actually saw the post interacted with it.

```
  Content mix
  Original:             56.7%  replies 0%  reposts 43.3%  quotes 0%
  With media:           64.7%  links 88.2%  hashtags 0%
```

Nearly half of this account's output is reposts, and zero percent is replies. That is a broadcast account, not a conversational one. If you are studying it to copy the strategy, that distinction matters more than any engagement number.

```
  Timing (UTC)
  00   ▃  ▅      ▄  ▅ ▂▃▆█  23
  Best hour:            21:00  median 5,470
  Best weekday:         Thursday  median 3,159
```

The sparkline is engagement by hour of day, UTC, across the sample. Sample more posts for a more trustworthy peak:

```bash
xactions analyze NASA --limit 200
```

## 2. Two accounts, side by side

`analyze` takes several usernames and compares them:

```bash
xactions analyze NASA SpaceX
```

Read the comparison in this order:

1. **Posting cadence.** Who ships more? A 5x cadence difference explains most engagement differences on its own.
2. **Content mix.** Original versus repost versus reply. These are different businesses.
3. **Engagement per view.** The only figure that is fair across wildly different follower counts.
4. **Best hour.** If two accounts serve the same audience and peak at different hours, one of them is wrong.

## 3. Whose followers overlap

```bash
xactions audience NASA SpaceX --max 2000
```

This needs a session (follower lists are not on the guest tier), so run `xactions connect` first if `xactions doctor` says you are guest-only.

Overlap answers a question analysis of a single account cannot: is this a shared audience or two separate ones? High overlap means you are choosing between two accounts for the same people. Low overlap means there is an audience you are not reaching.

`--max` caps how many followers are fetched per account. Start at 2000. Raising it improves the estimate and costs time linearly.

## 4. Keep the raw numbers

Every command above takes `--output`, and the format follows the extension:

```bash
xactions analyze NASA --limit 200 --output nasa.json
xactions analyze NASA --limit 200 --output nasa.csv
xactions analyze NASA --limit 200 --output nasa.xlsx
```

Or take JSON on stdout and cut it yourself:

```bash
xactions analyze NASA --json | jq '{
  followers:   .audience.followers,
  ratio:       .audience.followerRatio,
  postsPerDay: .output.postsPerDay,
  lifetime:    .output.lifetimePostsPerDay,
  median:      .engagement.medianPerOriginal,
  viewRate:    .engagement.viewRate,
  originals:   .mix.originalShare,
  bestHour:    .timing.bestHourUTC,
  bestWeekday: .timing.bestWeekday
}'
```

```json
{
  "followers": 92238530,
  "ratio": 775113.7,
  "postsPerDay": 2.82,
  "lifetime": 10.92,
  "median": 2214,
  "viewRate": 0.27,
  "originals": 55,
  "bestHour": 21,
  "bestWeekday": "Friday"
}
```

The top-level keys are `identity`, `audience`, `output`, `engagement`, `mix`, `timing`, `signals`, `topPosts`, `topHashtags`, `topMentions`, and `meta`. Run `xactions analyze NASA --json | jq 'keys'` to see them, and `jq '.engagement'` to open any one up.

`signals` is the observations block from the formatted report, as data:

```bash
xactions analyze NASA --json | jq -r '.signals[] | "\(.level | ascii_upcase): \(.title)"'
```

`timing.byHourUTC` is the 24-entry array behind the sparkline, so you can find the peak yourself over a large sample:

```bash
xactions analyze NASA --limit 200 --json \
  | jq -r '.timing.byHourUTC | max_by(.medianEngagement) | "best hour \(.index):00 UTC, median \(.medianEngagement)"'
```

`timing.bestHourUTC` is `null` when no single hour cleared `timing.minimumBucketSample` posts, and the formatted report says "not enough data" rather than inventing a peak. Raise `--limit` until it resolves; the sparkline is readable either way.

## 5. Track it over time

A single report is a snapshot. The interesting signal is the change:

```bash
# Take a reading every day, keyed by date
xactions analyze NASA --limit 200 --output "reports/nasa-$(date -u +%F).json"
```

Put that in cron and after two weeks you have a series. XActions also has a built-in version of this:

```bash
xactions snapshot NASA          # start auto-snapshotting
xactions history NASA           # read the series back
```

## 6. A comparison script

```bash
#!/usr/bin/env bash
# compare.sh handle1 handle2 ... — one row per account, sorted by engagement.
set -euo pipefail

printf '%-20s %12s %10s %12s %8s\n' ACCOUNT FOLLOWERS POSTS/DAY MED_ENGAGE BEST_HR

for handle in "$@"; do
  xactions analyze "$handle" --limit 100 --json 2>/dev/null | jq -r --arg h "$handle" '
    [$h,
     (.audience.followers          // 0 | tostring),
     (.output.postsPerDay          // 0 | tostring),
     (.engagement.medianPerOriginal // 0 | tostring),
     (.timing.bestHourUTC          // "?" | tostring)]
    | @tsv'
done | sort -k4 -rn | awk -F'\t' '{ printf "%-20s %12s %10s %12s %8s\n", $1, $2, $3, $4, $5 }'
```

```bash
chmod +x compare.sh
./compare.sh NASA SpaceX
```

Run it against your own account and the five accounts you compete with. The row that surprises you is the one worth investigating.

---

## What you learned

- Why median beats mean, and why engagement-per-view beats engagement-per-follower
- That lifetime and recent cadence disagreeing is itself the finding
- How content mix identifies what kind of account you are actually looking at
- Turning reports into files, JSON, and a time series you can track

## Next

- [06: Everything is JSON](06-everything-is-json.md) to script all of this properly
- [04: Build a brand monitor](04-build-a-brand-monitor.md) to watch continuously instead of on demand
- [CLI reference](../docs/cli-reference.md) for every flag on every command
