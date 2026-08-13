# Troubleshooting

Symptoms in the left column, causes and fixes below. If your problem is not
here, [open an issue](https://github.com/nirholas/XActions/issues) with the
command you ran and its full output.

| Symptom | Jump to |
|---------|---------|
| `AUTH_REQUIRED` / `HTTP 404` on search, followers, or DMs | [Endpoints that need a login](#endpoints-that-need-a-login) |
| Everything returns `null`, `0`, or an empty list | [Empty results](#empty-results) |
| `Guest token activation failed: HTTP 404` | [Guest token activation](#guest-token-activation) |
| `RATE_LIMITED` or actions stop working mid-run | [Rate limits](#rate-limits) |
| `Query not found` | [Query not found](#query-not-found) |
| MCP server does not appear in Claude or Cursor | [MCP server not connecting](#mcp-server-not-connecting) |
| Puppeteer fails to launch | [Puppeteer](#puppeteer) |
| `npm install` fails | [Install failures](#install-failures) |
| Browser console script does nothing | [Console scripts](#console-scripts) |

---

## Endpoints that need a login

```
AuthenticationError [AUTH_REQUIRED]: HTTP 404 on
/i/api/graphql/.../SearchTimeline while unauthenticated.
```

**This is expected, not a bug.** X splits its internal API into two tiers:

| Tier | Endpoints | Login |
|------|-----------|-------|
| Guest | Profiles, public user timelines | Not needed |
| Session | Search, followers, following, likes, bookmarks, DMs, home timeline | Required |

X answers a logged-out request to a session-tier endpoint with a bare `404`,
which is why the error mentions 404 even though the resource exists.

**Fix:** supply a session.

```bash
npx xactions login          # prompts for auth_token and ct0
```

or, for the library and the examples:

```bash
export X_AUTH_TOKEN=...
export X_CSRF_TOKEN=...
```

Get both values from DevTools → **Application** → **Cookies** → `https://x.com`.

### Why ct0 matters

`auth_token` identifies you; `ct0` is the CSRF token X requires as a request
header before it will treat a session as logged in. **With only `auth_token`,
session-tier endpoints still fail.** If you configured a login and search still
returns `AUTH_REQUIRED`, a missing `ct0` is almost always why.

---

## Empty results

A scrape that returns `null` fields or an empty array, with no error.

**Most common cause:** the browser path is being used while logged out. X no
longer serves profile or timeline content to a logged-out browser, so the DOM
scrape finds an empty page.

**Fix:** the CLI, the MCP server, and the library all prefer the HTTP client
now, which reads public data with a guest token and does not need a browser at
all. Make sure you are on a current version:

```bash
npx xactions@latest profile nasa
```

If that prints real numbers and your own code does not, you are on an older
release, or calling the Puppeteer scrapers (`scrapers.scrapeProfile`) directly
rather than the client (`Scraper.getProfile`).

**Second cause:** the account is protected, suspended, or renamed. Check it in a
logged-out browser window.

---

## Guest token activation

```
Guest token activation failed: HTTP 404 —
{"errors":[{"message":"Sorry, that page does not exist","code":34}]}
```

The endpoint exists. X rejects requests that do not look like they came from a
browser, and answers with a 404 rather than a 401, which makes it read like a
removed endpoint.

XActions sends a browser `User-Agent` on every request for exactly this reason.
If you see this error:

- **Check your version.** Releases before this fix landed will always hit it.
- **Check any custom `fetch`.** If you passed your own fetch implementation into
  `new Scraper({ fetch })` and it strips or overrides headers, add a browser
  `User-Agent` back.
- **Check your proxy.** Some corporate proxies rewrite `User-Agent`.

---

## Rate limits

```
ScraperError [RATE_LIMITED]: Rate limited (429).
```

`error.rateLimitReset` carries the reset time when X sends one:

```js
catch (error) {
  if (error.code === 'RATE_LIMITED') {
    console.log('retry after', error.rateLimitReset);
  }
}
```

**Guest tokens are throttled hard.** Authenticating raises the ceiling
substantially, so a login is the fix for read-heavy work as well as for
session-tier endpoints.

For browser console scripts, throttling looks different: buttons quietly stop
responding and the progress count stops climbing while the page keeps
scrolling. Stop the run, wait an hour, and raise `delay` in the script's
`CONFIG` block. See [browser-scripts.md](browser-scripts.md#rate-limits-and-not-getting-locked-out).

Rough guidance for write actions (unfollows, follows, likes, deletes): keep
`delay` at 2000ms or more and stay under a few hundred actions a day. Limits
vary by account age and standing, and X does not publish them.

---

## Query not found

```
HTTP 404: {"message":"Query not found"}
```

X rotates the query IDs of its internal GraphQL endpoints. When one changes,
requests to the old ID return this.

XActions keeps every query ID in one place,
[`src/scrapers/twitter/http/endpoints.js`](../src/scrapers/twitter/http/endpoints.js),
and a test fails if a second copy ever appears. To update one:

1. Open x.com in a browser with DevTools on the **Network** tab.
2. Trigger the action (view a profile, run a search).
3. Find the `graphql` request whose path ends in the operation name.
4. Copy the ID segment from the URL: `/i/api/graphql/<THIS>/UserByScreenName`.
5. Update the entry in `endpoints.js` and open a PR. Others are hitting it too.

---

## MCP server not connecting

First, verify the server itself works, independent of your AI client:

```bash
node examples/08-mcp-tool-call.js
```

That spawns the server, completes the handshake, lists the tools, and calls
one. If it prints a profile, the server is fine and the problem is client
configuration.

Then check, in order:

**Config file location.** Claude Desktop reads
`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and
`%APPDATA%\Claude\claude_desktop_config.json` on Windows. Cursor and Windsurf
use their own paths. See [mcp-setup.md](mcp-setup.md).

**JSON validity.** A trailing comma silently disables the whole file. Paste it
into a validator.

**Restart the client.** MCP servers are spawned at startup. Config changes do
not take effect until a full restart, not just a new chat.

**Node on PATH.** MCP clients launch servers with a minimal environment. If
`node` came from a version manager, use an absolute path:

```json
{
  "mcpServers": {
    "xactions": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/XActions/src/mcp/server.js"]
    }
  }
}
```

**Stdout must stay clean.** MCP speaks JSON-RPC over stdout. Anything else
printed there corrupts the stream. If you added logging to a tool, send it to
`stderr` (`console.error`), which is what the server's own banner uses.

---

## Puppeteer

Most operations no longer need Puppeteer: profiles, timelines, and everything
the HTTP client covers run without a browser. Puppeteer is still used for
logged-in UI actions.

**Chromium did not download.** Reinstall it:

```bash
npx puppeteer browsers install chrome
```

**Missing shared libraries on Linux.** The bundled Chromium needs system
packages that minimal images omit:

```bash
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2
```

The repo ships [`setup-puppeteer.sh`](../setup-puppeteer.sh) which installs
these for you.

**Running as root, or in Docker.** Chromium's sandbox needs unprivileged
namespaces. Set:

```bash
export PUPPETEER_NO_SANDBOX=true
```

**Headless launch times out.** Give it more room and a writable temp dir:

```bash
export PUPPETEER_HEADLESS=true
```

---

## Install failures

**`npm ci` fails but `npm install` works.** The lockfile is out of sync with
`package.json`. Run `npm install`, commit the updated `package-lock.json`.

**`ETARGET no matching version`.** A dependency version was yanked from npm.
Delete `node_modules` and `package-lock.json`, then `npm install` to resolve
fresh.

**Disk space.** A full install pulls Chromium and the Remotion renderer, which
together need several GB. `ENOSPC` during install means exactly what it says.

**Optional dependencies failed.** `@atproto/api` (Bluesky), `viem`, and the
`@x402/*` packages are optional. Their install failing does not break the core
toolkit; only the features that use them become unavailable.

---

## Console scripts

**Nothing happened.** Chrome requires you to type `allow pasting` in the console
before it accepts pasted code the first time.

**It ran but did nothing.** Almost always `dryRun: true`, which is the default
for every destructive script. Read the preview output, then set it to `false`.

**Wrong page.** Each script names the page it expects in its header comment and
in the [catalog](browser-scripts.md#the-catalog). A follower script on the home
timeline finds nothing.

**`Identifier has already been declared`.** You pasted the same script twice.
Reload the page and paste once.

**It stops partway.** X unmounts off-screen rows as you scroll, so a script that
stops finding new accounts has usually hit a throttle rather than the end of the
list. Reload, raise `delay`, and continue.

---

## Still stuck

- [Open an issue](https://github.com/nirholas/XActions/issues) with your Node
  version (`node -v`), XActions version (`npx xactions --version`), the exact
  command, and the full output.
- [Discussions](https://github.com/nirholas/XActions/discussions) for questions
  that are not bugs.

## Related

- [Getting Started](getting-started.md)
- [Configuration](configuration.md)
- [MCP Setup](mcp-setup.md)
- [Browser Scripts](browser-scripts.md)
