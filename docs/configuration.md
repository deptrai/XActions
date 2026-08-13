# Configuration

XActions is configured in four places, and which ones you need depends entirely
on which surface you use.

| Surface | Configuration needed |
|---------|----------------------|
| Browser console scripts | None. Edit the `CONFIG` block in the script. |
| CLI | `~/.xactions/config.json`, written by `xactions login`. |
| Node.js library | Cookies passed in code, or `X_AUTH_TOKEN` / `X_CSRF_TOKEN`. |
| MCP server | Environment block in your AI client's MCP config. |
| Self-hosted API and dashboard | `.env`. |

Only the last one needs a `.env` file at all. Copy [`.env.example`](../.env.example)
if you are running the server.

---

## Session cookies

Everything that reads private or session-tier data needs two cookies from a
logged-in x.com session.

**Where to get them:** open [x.com](https://x.com), log in, then DevTools
(<kbd>F12</kbd>) → **Application** → **Cookies** → `https://x.com`.

| Cookie | What it is | Required |
|--------|------------|:--------:|
| `auth_token` | Your session. Treat it like a password. | yes |
| `ct0` | CSRF token X requires as a request header. | yes |

**Both are required.** With only `auth_token`, X still treats the request as
logged out, and search, followers, likes, bookmarks, and DMs all answer `404`.
This is the single most common configuration mistake.

### CLI

```bash
npx xactions login
```

Prompts for both and writes `~/.xactions/config.json`:

```json
{
  "authToken": "...",
  "csrfToken": "..."
}
```

`xactions logout` removes it.

### Library and examples

```bash
export X_AUTH_TOKEN=...
export X_CSRF_TOKEN=...
```

or in code:

```js
import { Scraper } from 'xactions/client';

const scraper = new Scraper();
await scraper.setCookies(`auth_token=${authToken}; ct0=${csrfToken}`);
```

A full cookie jar exported from the browser also works and is preferred when
you have one, because it carries everything X expects:

```js
await scraper.loadCookies('./cookies.json');   // [{ "name": "auth_token", "value": "..." }, ...]
await scraper.saveCookies('./cookies.json');   // persist a refreshed session
```

### MCP server

Set them in the `env` block of your AI client's MCP configuration, not in a
`.env` file. MCP servers are spawned with a minimal environment:

```json
{
  "mcpServers": {
    "xactions": {
      "command": "npx",
      "args": ["-y", "xactions-mcp"],
      "env": {
        "XACTIONS_SESSION_COOKIE": "your_auth_token",
        "XACTIONS_CSRF_TOKEN": "your_ct0"
      }
    }
  }
}
```

Without them the server still starts and still serves all 144 tools; the
guest-tier ones (profiles, public timelines) work and the rest report that they
need a session.

### Keeping them out of your repo

`.env`, `.env.local`, and `cookies.json` are gitignored. A leaked `auth_token`
is a full account takeover, so:

- Never paste one into an issue, a screenshot, or a PR.
- Log out of x.com in that browser to invalidate a token you think leaked.
- Prefer a secondary account for automation.

---

## Environment variables

Only relevant when self-hosting the API server or dashboard. Grouped by what
they turn on; nothing here is needed for the CLI, the library, or console
scripts.

### Server

| Variable | Default | Notes |
|----------|---------|-------|
| `NODE_ENV` | `development` | `production` enables stricter startup checks. |
| `PORT` | `3001` | HTTP port. |
| `API_URL` | `http://localhost:3001` | Public base URL, used in generated links. |
| `FRONTEND_URL` | `http://localhost:3000` | Used for CORS and redirects. |
| `CORS_ORIGINS` | localhost origins | Comma-separated allowlist. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`. |

### Security

| Variable | Notes |
|----------|-------|
| `JWT_SECRET` | **Required in production.** The server refuses to start without it. |
| `SESSION_SECRET` | **Required in production.** Same. |
| `ADMIN_API_KEY` | Guards the admin endpoints. Generate with `openssl rand -hex 32`. |

### Database and queue

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | PostgreSQL connection string. See [database.md](database.md). |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Backing store for the background job queue. |

### Scraping

| Variable | Notes |
|----------|-------|
| `XACTIONS_SESSION_COOKIE` | `auth_token` value. |
| `XACTIONS_CSRF_TOKEN` | `ct0` value. |
| `XACTIONS_MODE` | `local` (Puppeteer, free) or `remote` (hosted API). |
| `XACTIONS_API_URL` | Endpoint used in `remote` mode. |
| `XACTIONS_SCRAPER_ADAPTER` | `puppeteer` (default), `playwright`, or `http`. |

### Puppeteer

| Variable | Notes |
|----------|-------|
| `PUPPETEER_HEADLESS` | `true` in servers, `false` to watch a run. |
| `PUPPETEER_NO_SANDBOX` | Set `true` in Docker and when running as root. |
| `PUPPETEER_EXECUTABLE_PATH` | Point at a system Chromium instead of the bundled one. |

### Optional integrations

| Variable | Enables |
|----------|---------|
| `OPENROUTER_API_KEY` | LLM-backed sentiment mode and AI tweet generation. |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | OAuth 2.0 login in the dashboard. |
| `STRIPE_*` | Subscription billing. |
| `X402_*` | Per-request payments on the hosted API. Documented inline in [`.env.example`](../.env.example); verify a setup with `npm run verify:x402`. |
| `SENTRY_DSN` | Error reporting. |

---

## Personas and niches

The autonomous agent reads two JSON files that decide what it talks about and
how it sounds. Both live in [`config/`](../config/) and are plain data, so
adding your own is a matter of dropping in a file.

### Personas — how the agent writes

[`config/personas/`](../config/personas/) ships three:
`thought-leader`, `technical-builder`, `community-builder`.

```json
{
  "name": "ThoughtLeader",
  "tone": "opinionated, visionary, contrarian but well-reasoned",
  "expertise": ["technology trends", "industry analysis"],
  "opinions": ["The next decade belongs to builders, not fundraisers"],
  "avoid": ["empty platitudes", "engagement farming", "corporate jargon"],
  "exampleTweets": ["..."]
}
```

`avoid` matters more than it looks. It is the difference between output that
reads like a person and output that reads like a bot, and it is the first field
worth editing.

### Niches — what the agent looks at

[`config/niches/`](../config/niches/) ships `ai-engineering`, `saas-startups`,
and `web3-crypto`.

```json
{
  "name": "AI Engineering",
  "searchTerms": ["AI agents", "LLM engineering", "prompt engineering"]
}
```

The agent uses these to find accounts and posts worth engaging with, which is
also how it trains your timeline algorithm toward a topic.

### Agent settings

Copy [`config/agent-config.example.json`](../config/agent-config.example.json)
to `data/agent-config.json` and edit, or run the wizard:

```bash
npx xactions agent setup
```

---

## Console script settings

Browser scripts are configured in the script itself. Every one opens with a
`CONFIG` block:

```js
const CONFIG = {
  maxUnfollows: Infinity,
  whitelist: [],
  dryRun: true,       // Preview without acting — SET FALSE TO RUN
  delay: 2000,
};
```

`dryRun` defaults to `true` on everything destructive. See
[browser-scripts.md](browser-scripts.md#start-in-dry-run).

---

## Related

- [Getting Started](getting-started.md)
- [Database Schema](database.md)
- [MCP Setup](mcp-setup.md)
- [Deployment](deployment.md)
- [Troubleshooting](troubleshooting.md)
