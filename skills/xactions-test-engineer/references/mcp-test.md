---
name: mcp-test
description: Verify XActions MCP tool definitions, schema validity, and tool execution against a running or importable MCP server.
code: MT
added: 2026-08-28
type: prompt
---

# MCP Test — Verify Tools, Schemas, and Calls

The outcome is a passing Vitest test file under `tests/mcp/` that proves an MCP tool in `src/mcp/server.js` is discoverable, well-formed, and behaves correctly when invoked. The consumer is a developer who needs confidence that the MCP surface does not silently break when tools, schemas, or handler logic change.

The bar: tests cover the `TOOLS` array structure, `inputSchema` correctness, required-field consistency, and real tool execution through a live or spawned MCP server. No mocks unless the test simulates a fault condition.

## Before testing

Identify the target:
- Which MCP tool(s)? Names start with `x_` (e.g., `x_get_profile`, `x_post_tweet`).
- Is this a unit/definition test or an execution/call test?
- Does the test need `src/mcp/server.js` imported for `TOOLS`, or a live stdio/SSE transport?

Load `src/mcp/server.js` and `src/mcp/local-tools.js` to understand tool registration and handler wiring. Look at existing `tests/mcp/` for patterns.

## Test design rules

**Definition tests (fast, no server start):**
- Import `src/mcp/server.js` and read `TOOLS`.
- Assert `TOOLS` is a non-empty array.
- Assert every tool has `name`, `description`, `inputSchema` with `type: 'object'`.
- Assert every tool name starts with `x_` and is unique.
- Assert `inputSchema.required` fields exist in `inputSchema.properties`.
- For critical tools, assert required fields explicitly (e.g., `x_get_profile` requires `username`, `x_post_tweet` requires `text`).

**Execution tests (real transport):**
- Spawn the MCP server via `node src/mcp/server.js` or the HTTP/SSE variant on `PORT`.
- Use the MCP client SDK to call `initialize`, then `tools/list`, then `tools/call`.
- Pass real or safe inputs. Assert the `content` array contains the expected `text` result.
- Test error envelopes: unknown tool, missing required args, and invalid field types.
- Close the server and client in `afterAll`.

**Schema tests:**
- If a tool uses a JSON schema in `schemas/`, validate payloads against it.
- Assert enum values, formats, and `additionalProperties` settings.

## After testing

Run `vitest run tests/mcp/{name}.test.js`. Fix failures by correcting the tool handler, schema, or test setup. Run `npm run mcp` manually if the transport test needs a live server. Update the relevant story status if this is part of active work.
