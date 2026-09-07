# Epic 14 Retrospective: Deep Conversation Scraper, MCP Daemon & Nowing Event Stream

Status: done  
Date: 2026-09-08

## Summary

Epic 14 xây dựng **event streaming pipeline** cho Nowing AI Lead Hub: hierarchical comment tree extraction, MCP tool exporters daemon, và Redis thin event stream.

Epic complete across three stories:

| Story | Status | Outcome |
|---|---|---|
| 14.1 Hierarchical Comment Tree Extraction | done | Comment tree algorithm, depth tracking |
| 14.2 MCP Tool Exporters + HTTP/SSE Daemon | done | `MCP tool exporter`, HTTP/SSE server |
| 14.3 Real-time Thin Event Redis Stream | done | `RedisStreamPublisher`, `ThinEvent` |

## What Went Well

1. **Comment tree extraction algorithm**
   - Deep conversation thread parsing.
   - Support nested replies.

2. **MCP daemon + SSE**
   - `mcp-server` có thể expose qua HTTP/SSE.
   - `xactions mcp` start daemon mode.

3. **Thin Event streaming**
   - `RedisStreamPublisher` emit `ThinEvent` cho Nowing.
   - Real-time event pipeline cho lead generation.

## What Was Difficult

1. **Comment tree depth**
   - Facebook/Twitter comment structure khác nhau.
   - Infinite scroll → partial tree.

2. **MCP tool exporter dispatch**
   - Nhiều tool cùng prefix `x_facebook_` conflict với Epic 4.
   - Phải check `EPIC7_SCRAPE_TOOLS` trước Epic 4 catch-all.

## Key Decisions

1. **ThinEvent là event contract**
   - `platform`, `category`, `author`, `content`, `timestamp`.
   - Nowing AI consume từ Redis Stream.

2. **Daemon mode cho MCP**
   - `xactions mcp` không chỉ là stdio server — có HTTP/SSE mode.

## Follow-up Recommendations

1. **Event stream consumer docs**
   - Nowing AI cần biết `ThinEvent` schema.
   - Versioning cho contract.

2. **MCP tool versioning**
   - Các tool mới cần avoid prefix conflicts.

## Final State

- Epic 14 status: **done**
- All three stories: **done**
- Retrospective: **done**
