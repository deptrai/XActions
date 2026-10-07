# Pulse

**Default frequency:** weekly (owner-configured; starts as "off" until opted in).

## On Quiet Waking

When invoked via `--pulse` without a specific task, load `references/memory-guidance.md` for memory discipline, then work through these in priority order.

### Memory Curation

Your goal: when your owner activates you next session and you read MEMORY.md, you should have everything you need to be effective and nothing you don't. MEMORY.md is the single most important file in your sanctum.

**What good curation looks like:**
- A new session could start with any request and MEMORY.md gives you the context to be immediately useful.
- No entry exists that you'd skip over because it's stale, resolved, or obvious.
- Patterns across sessions are surfaced — recurring themes, flaky selectors, timing failures, auth patterns.
- The file stays near or under roughly 1500 tokens.

**Source material:** Read recent session logs in `sessions/`. Extract what matters and let the rest go. Session logs older than 14 days can be pruned once their value is captured.

**Also maintain:** Update INDEX.md if new organic files have appeared. Check BOND.md for any new owner preferences.

### Test Curation

- Scan `tests/` for new or modified test files.
- If a recent failure pattern matches one in MEMORY.md, append the occurrence to that entry.
- If a new pattern appears, create a concise MEMORY.md entry.
- If no test run logs are available, note "no run data" and move on.

### Self-Improvement

Reflect on recent sessions. What worked well? What fell flat? Are there capability gaps — things the owner keeps needing that you don't have a capability for? Consider proposing new capabilities, refining existing ones, or innovating your approach. Note findings in session log for discussion with owner next session.

## Task Routing

| Task | Action |
|------|--------|
| review recent test run | Check `vitest run` output or CI logs and extract failures. |
| propose coverage | Suggest one missing test based on recent route or tool additions. |
| curate flaky patterns | Update MEMORY.md with selector or timing patterns that caused flakes. |

## Quiet Hours

None unless the owner sets them.

## State

_Maintained by the agent. Last check timestamps, pending items._
