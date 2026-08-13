# Tutorials

Guided walkthroughs. Each one starts from nothing and ends with something
working, and every command in them has been run.

If you would rather read code than prose, the [`examples/`](../examples/)
directory has the same material as short runnable programs.

---

## Start here

| # | Tutorial | Time | You end up with |
|---|----------|------|-----------------|
| 01 | [Your first scrape](01-your-first-scrape.md) | 5 min | Real profile and timeline data, from the terminal and from Node |
| 02 | [Claude that can use X](02-mcp-with-claude.md) | 10 min | Claude Desktop or Cursor driving 144 XActions tools |
| 03 | [Clean up your following list](03-clean-up-your-following.md) | 20 min | A safe, reviewed unfollow of accounts that do not follow back |
| 04 | [Build a brand monitor](04-build-a-brand-monitor.md) | 30 min | A running service that watches X and alerts you on negative mentions |
| 05 | [Read any account like an analyst](05-competitive-intelligence.md) | 15 min | A defensible read on how any account performs, and how two differ |
| 06 | [Everything is JSON](06-everything-is-json.md) | 20 min | XActions inside your own pipelines: jq, cron, exit codes, tab completion |

Work through them in order the first time. Each assumes the setup from the one
before it. Tutorials 01, 05 and 06 need no X account at all.

Never used the CLI before? `xactions quickstart` is the thirty-second version of
tutorial 01, and adapts to what you already have set up.

---

## Prompt library for AI assistants

[`claude-prompts/`](claude-prompts/) is a different thing: 23 ready-to-paste
prompts that hand an AI assistant a complete task brief. Paste one into Claude,
Cursor, or ChatGPT and it has the context to do the job.

| Area | Prompts |
|------|---------|
| Setup and CLI | [01](claude-prompts/01-mcp-setup-and-first-commands.md), [15](claude-prompts/15-cli-mastery-guide.md), [16](claude-prompts/16-browser-automation-framework.md) |
| Follower management | [02](claude-prompts/02-unfollow-non-followers-cleanup.md), [03](claude-prompts/03-growth-automation-suite.md), [07](claude-prompts/07-auto-liker-auto-commenter.md) |
| Content | [05](claude-prompts/05-content-posting-threads-scheduling.md), [12](claude-prompts/12-bookmark-management-export.md), [13](claude-prompts/13-content-cleanup-unlike-clear.md), [17](claude-prompts/17-video-download-thread-media.md) |
| Research and analytics | [04](claude-prompts/04-scraping-research-analysis.md), [06](claude-prompts/06-analytics-competitor-intelligence.md), [14](claude-prompts/14-brand-monitoring-business-tools.md), [18](claude-prompts/18-grok-ai-sentiment-analysis.md) |
| Automation | [09](claude-prompts/09-dm-management-automation.md), [19](claude-prompts/19-customer-service-bot.md), [21](claude-prompts/21-workflows-account-portability.md), [23](claude-prompts/23-autonomous-space-agent.md) |

Full index: [claude-prompts/README.md](claude-prompts/README.md).

---

## Where else to look

- [Examples](../examples/) — runnable programs, shorter than tutorials
- [Documentation](../docs/) — reference material
- [Browser scripts](../docs/browser-scripts.md) — no install at all
- [Troubleshooting](../docs/troubleshooting.md) — when something does not work
