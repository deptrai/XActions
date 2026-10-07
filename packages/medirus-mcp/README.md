# medirus-mcp

> Medirus MCP Server — X/Twitter automation for AI agents. No API fees.

This is the standalone MCP server package for [Medirus](https://github.com/nirholas/XActions). It enables AI assistants like Claude, Cursor, Windsurf, and GPT to automate X/Twitter tasks.

## Quick Start

```bash
npx medirus-mcp
```

## Claude Desktop Config

```json
{
  "mcpServers": {
    "medirus": {
      "command": "npx",
      "args": ["-y", "medirus-mcp"],
      "env": {
        "MEDIRUS_SESSION_COOKIE": "your_auth_token_here"
      }
    }
  }
}
```

## Documentation

See the full setup guide: [medirus.online](https://medirus.online) | [GitHub](https://github.com/nirholas/XActions)

## License

MIT — by [@nichxbt](https://x.com/nichxbt)
