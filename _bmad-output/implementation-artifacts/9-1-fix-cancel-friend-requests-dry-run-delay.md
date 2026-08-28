---
baseline_commit:
---

# Story 9.1: Fix cancel_friend_requests Dry-Run Delay

Status: ready-for-dev

## Story

As an MCP user,
I want `x_facebook_cancel_friend_requests` dry-run to return immediately,
So that I can preview the action without waiting 63 seconds.

## Acceptance Criteria

1. **Given** `x_facebook_cancel_friend_requests` is called with `dryRun: true`
2. **When** the tool executes
3. **Then** it returns in less than 1 second
4. **And** it does not launch a browser
5. **And** it does not call `runGuardedBatch` or any delay loop
6. **And** it returns a preview with the list of requests that would be canceled

## Implementation Note

Relates to PCR1. The dry-run branch should short-circuit before the batch/delay loop in `cancelPendingFriendRequests`.
