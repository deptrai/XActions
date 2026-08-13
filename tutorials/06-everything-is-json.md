# 06: Everything is JSON

**Time:** 20 minutes
**You need:** XActions installed, plus [`jq`](https://jqlang.github.io/jq/). No login for most of this.
**You end up with:** XActions as a component in your own pipelines rather than a thing you type at.

---

## The idea

XActions prints a formatted report because that is what you want when you are looking at it. Add `--json` and it prints data instead, and stdout carries nothing else. That single rule is what makes everything below possible: no spinner text, no colour codes, no "Fetching..." line to strip.

```bash
xactions profile NASA --json | jq -r .name
```
```
NASA
```

Progress output goes to stderr, so a pipe never has to filter it. That also means you keep seeing progress while piping:

```bash
xactions tweets NASA --limit 200 --json > tweets.json    # progress still shows on your terminal
xactions tweets NASA --limit 200 --json 2>/dev/null      # silence it if you prefer
```

## 1. Tab completion first

Before writing anything, make the CLI type itself:

```bash
# bash
echo 'source <(xactions completion bash)' >> ~/.bashrc && exec bash

# zsh
echo 'source <(xactions completion zsh)' >> ~/.zshrc && exec zsh

# fish
xactions completion fish > ~/.config/fish/completions/xactions.fish
```

Now `xactions <tab>` lists all fifty-plus commands, `xactions plugin <tab>` lists its sub-commands, and `xactions tweets --<tab>` lists that command's flags. The script is generated from the live command tree, so regenerate it after upgrading and it picks up whatever is new.

## 2. Reading a timeline

```bash
xactions tweets NASA --limit 100 --json > tweets.json

# What does one post look like?
jq '.[0]' tweets.json

# Just the text
jq -r '.[].text' tweets.json

# Sorted by likes, top 5
jq -r 'sort_by(-.likes)[:5] | .[] | "\(.likes)\t\(.text[0:70])"' tweets.json
```

Find the field names rather than guessing them:

```bash
jq '.[0] | keys' tweets.json
```

```
["bookmarkCount","conversationId","fullText","hashtags","id","inReplyToStatusId",
 "isQuote","isReply","isRetweet","likes","mentions","permanentUrl","photos","place",
 "poll","quotedStatusId","replies","retweets","sensitiveContent","text","timeParsed",
 "timestamp","urls","userId","username","videos","views"]
```

Three worth knowing up front: the link to a post is `permanentUrl` (not `url`), media is split into `photos` and `videos` (there is no combined `media` array), and `timestamp` is **milliseconds** while `timeParsed` is an ISO string.

## 3. Filtering

`jq` does the filtering, which means you are not limited to flags anyone thought to add.

```bash
# Posts carrying media
jq '[.[] | select(((.photos | length) + (.videos | length)) > 0)] | length' tweets.json

# Original posts only, no reposts or replies
jq '[.[] | select(.isRetweet == false and .isReply == false)] | length' tweets.json

# Posts above 5000 likes, with their links
jq -r '.[] | select(.likes > 5000) | .permanentUrl' tweets.json

# Posts mentioning a word, case insensitive
jq -r '.[] | select(.text | ascii_downcase | contains("launch")) | .text' tweets.json

# Every link ever posted, deduplicated
jq -r '[.[].urls] | flatten | unique | .[]' tweets.json

# Engagement rate per post, best first
jq -r 'map(select(.views > 0))
       | sort_by(-((.likes + .retweets + .replies) / .views))[:5][]
       | "\((((.likes + .retweets + .replies) / .views) * 100) | .*100 | round / 100)%\t\(.text[0:60])"' tweets.json
```

## 4. Combining commands

Pipelines get interesting when one command feeds another. Find who an account talks about, then look each of them up:

```bash
xactions analyze NASA --limit 200 --json \
  | jq -r '.topMentions[:5][] | .handle // .username // .' \
  | while read -r handle; do
      xactions profile "$handle" --json 2>/dev/null \
        | jq -r '"\(.username)\t\(.followersCount // 0)\t\(.bio // "" | .[0:60])"'
    done \
  | column -t -s $'\t'
```

Run `xactions analyze NASA --json | jq '.topMentions[0]'` first to see the exact shape; the `//` fallbacks above exist so the script survives either shape rather than dying on a missing key.

## 5. CSV and spreadsheets without jq

For the common cases the CLI writes the file for you. The format follows the extension:

```bash
xactions tweets NASA --limit 500 --output nasa.csv
xactions tweets NASA --limit 500 --output nasa.xlsx
xactions followers NASA --limit 1000 --output followers.csv     # needs a session
```

Straight into Google Sheets:

```bash
xactions tweets NASA --limit 500 \
  --google-sheets <spreadsheet-id> \
  --sheet-name "NASA" \
  --sheet-mode replace
```

`--sheet-mode` takes `append`, `replace`, or `new-sheet`.

## 6. Exit codes

Every command exits non-zero on failure, so `set -e` and `&&` behave:

```bash
if xactions profile somehandle --json > /dev/null 2>&1; then
  echo "account exists and is readable"
else
  echo "not readable: private, suspended, or does not exist"
fi
```

`xactions doctor` is the one to reach for in CI: it exits non-zero when something is actually broken, so a scheduled job can check its own footing before doing work.

```bash
xactions doctor || { echo "XActions is not healthy, skipping run"; exit 1; }
```

`xactions quickstart --json` reports the machine's setup state as data, which is the cheaper check when all you need to know is whether a session exists:

```bash
tier=$(xactions quickstart --json | jq -r .tier)
[ "$tier" = "session" ] || echo "guest tier: search and followers will not work"
```

## 7. A daily digest

Putting it together. This runs on the guest tier, needs no account, and mails you nothing you did not ask for:

```bash
#!/usr/bin/env bash
# digest.sh — top posts from the accounts you follow professionally.
set -euo pipefail

ACCOUNTS=(NASA SpaceX)
SINCE=$(date -u -d '24 hours ago' +%s 2>/dev/null || date -u -v-24H +%s)
OUT="digest-$(date -u +%F).md"

xactions doctor > /dev/null || { echo "xactions unhealthy"; exit 1; }

{
  echo "# Digest for $(date -u +%F)"
  echo

  for handle in "${ACCOUNTS[@]}"; do
    echo "## @${handle}"
    echo

    # `timestamp` is milliseconds, so the cutoff is compared in milliseconds too.
    xactions tweets "$handle" --limit 50 --json 2>/dev/null \
      | jq -r --argjson since "$((SINCE * 1000))" '
          [ .[]
            | select(.timestamp != null and .timestamp > $since)
            | select(.isRetweet == false)
          ]
          | sort_by(-(.likes // 0))
          | .[:3][]
          | "- **\(.likes // 0) likes** \(.text | gsub("\n"; " ") | .[0:160])\n  \(.permanentUrl // "")"
        ' || echo "_no posts in the last 24h_"

    echo
  done
} > "$OUT"

echo "wrote $OUT"
```

```bash
chmod +x digest.sh && ./digest.sh
```

Then put it in cron:

```cron
0 8 * * * cd /home/you/digests && ./digest.sh >> digest.log 2>&1
```

## 8. When you want a library instead of a pipe

Once the shell script grows conditionals, move to Node. The same data, one import:

```javascript
import { Scraper } from 'xactions/client';

const scraper = new Scraper();
const profile = await scraper.getProfile('NASA');
const tweets = await scraper.getTweets('NASA', 100);

console.log(profile.followersCount, tweets.length);
```

The HTTP client is the same one the CLI uses for guest-tier reads: no browser, no Chromium download.

---

## What you learned

- `--json` puts data on stdout and nothing else, so pipes are always safe
- Progress goes to stderr, so you keep it while redirecting
- `jq` filters beat waiting for someone to add a flag
- Exit codes make XActions safe inside `set -e` scripts and cron
- `--output` handles CSV, XLSX, and Google Sheets without any jq at all

## Next

- [05: Read any account like an analyst](05-competitive-intelligence.md) if you skipped it
- [04: Build a brand monitor](04-build-a-brand-monitor.md) to run continuously instead of on a schedule
- [CLI reference](../docs/cli-reference.md) for every flag
- [REST API](../docs/rest-api.md) if you want this over HTTP instead
