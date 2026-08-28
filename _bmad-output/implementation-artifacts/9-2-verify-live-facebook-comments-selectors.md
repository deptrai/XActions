---
baseline_commit:
---

# Story 9.2: Verify Live Facebook Comments Selectors

Status: ready-for-dev

## Story

As a data analyst,
I want to scrape comments from public posts with comments enabled,
So that I can analyze engagement and replies.

## Acceptance Criteria

1. **Given** a public post with comments enabled
2. **When** `x_facebook_post_comments` runs with `includeReplies: true`
3. **Then** it returns an array of comments
4. **And** each comment has `author`, `text`, `timestamp`, `likes`, and `replies`

5. **Given** a public group post with comments
6. **When** `x_facebook_group_comments` runs
7. **Then** it returns the same comment shape
8. **And** it returns a `note` if comments are restricted or not accessible

## Implementation Note

Relates to PCR3. Requires live DOM selector verification for `post_comments` and `group_comments`.
