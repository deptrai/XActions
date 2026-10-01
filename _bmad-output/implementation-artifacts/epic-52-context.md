# Epic 52 Context: MCP Tool Surface Consolidation & Dual-Mode Runtime

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Consolidate XActions' static catalog of 220+ individual MCP tools into 10 cohesive Domain Dispatchers operating under a default compact mode, reducing schema token overhead by ~95% and eliminating tool-dropping and selection degradation in LLM agents (Claude Code CLI, Cursor, Claude Desktop), while preserving 100% backward compatibility for legacy workflows via a full-catalog runtime switch.

## Stories

- Story 52.1: Domain Dispatcher Schemas & Routing Facade
- Story 52.2: Dual-Mode Runtime Engine & CLI Flags
- Story 52.3: Verification Test Suite & Backward Compatibility Assurance

## Requirements & Constraints

- **Domain Facade Architecture**: The MCP server must expose 10 top-level domain dispatchers (`x_post`, `x_user`, `x_read`, `x_dm`, `x_facebook`, `x_crypto`, `x_scrape`, `x_persona`, `x_analytics`, `x_system`) covering the entire functional spectrum previously spread across 220+ granular tools.
- **Context Window Optimization**: Total tool declaration schema payload presented to connected LLM agents in default mode must not exceed ~2,500–3,000 tokens (down from ~50,000 tokens), staying safely beneath the ~116–128 active tool threshold of Claude Code CLI.
- **Strict Backward Compatibility**: Existing clients and scripts that invoke legacy tool names directly must continue working without breaking changes when full mode is enabled.
- **Dual-Mode Configuration**: Mode selection must support both environment variable `MCP_TOOL_MODE=compact|full` and CLI startup argument `--mode=compact|full`, defaulting to `compact`.
- **Validation and Error Handling**: Dispatch calls with missing required arguments for a specific action must be rejected with standardized error code `XACT_4002` and clear actionable validation messages.
- **Standardized Response Enveloping**: All domain dispatcher responses must adhere to the 3-layer `ToolEnvelope` standard (`{ success, data, metadata }`) with auto-artifact generation when payloads exceed 100 records.
- **Test Integrity**: Test suites must verify both compact (domain dispatcher) and full (legacy catalog) execution paths without regression or test suite timeouts.

## Technical Decisions

- **Domain Facade Routing Pattern**: Introduce a centralized `DOMAIN_DISPATCH_MAP` mapping `(domain_tool, action) -> legacy_handler` inside `src/mcp/server.js`. The dispatcher extracts `action` and specific parameters, validates required arguments against the target handler's signature, and routes execution to existing battle-tested implementation logic without duplicating crawler or scraper code.
- **Domain Grouping Taxonomy**:
  1. `x_post`: Twitter/X write operations (tweet, thread, reply, retweet, quote, like, schedule, delete).
  2. `x_user`: Twitter/X identity, social graph, and relationship management (profile, follow, unfollow, mute, block).
  3. `x_read`: Twitter/X retrieval and search (search, tweet detail, timeline, bookmarks, lists).
  4. `x_dm`: Twitter/X direct messaging and inbox management.
  5. `x_facebook`: Unified Facebook automation and scraping facade (profiles, posts, groups, marketplace, comments).
  6. `x_crypto`: Unified cryptocurrency intelligence facade consolidating Dexscreener and Pump.fun operations discriminated by `platform`.
  7. `x_scrape`: Multi-platform web crawling dispatcher across 29 supported ecosystem platforms.
  8. `x_persona`: Autonomous growth agent, thought leader, and persona orchestration.
  9. `x_analytics`: Engagement metrics, graph algorithms, and viral trend analysis.
  10. `x_system`: Operational health, system status, quota checks, rate-limit governor, and streaming controls.
- **Dynamic Tool Registry Initialization**: The `TOOLS` array is dynamically populated during server bootstrap based on `MCP_TOOL_MODE` / `--mode`. Export accessor functions (`getDomainTools()`, `getAllTools()`) so internal components, test runners, and diagnostic CLIs can inspect either surface on demand.
- **Zero-Duplication Execution**: Domain dispatchers act purely as routing facades; they delegate directly to existing `executeTool` handlers or underlying service functions.

## Cross-Story Dependencies

- **Story 52.1 → Story 52.2**: The dual-mode runtime engine and tool switcher depend on the completion of the 10 domain dispatcher definitions and the `DOMAIN_DISPATCH_MAP` routing facade.
- **Story 52.2 → Story 52.3**: Comprehensive verification and test suite updates require both `compact` and `full` modes, as well as the programmatic tool accessors (`getDomainTools()`, `getAllTools()`), to be fully wired and operational.
- **System Dependencies**: Integrates with existing `ToolEnvelope` utilities, `executeTool` handlers, and legacy scraper/automation modules established in Epics 1, 3, 10, 13, 14, 20, and 50.
