---
baseline_commit:
---

# Story 9.3: Verify Live Group Posts and Group Search

Status: ready-for-dev

## Story

As a community manager,
I want to scrape posts from public or joined groups,
So that I can monitor group activity and search group content.

## Acceptance Criteria

1. **Given** a public or joined group
2. **When** `x_facebook_group_posts` runs
3. **Then** it returns a non-empty array of posts
4. **And** each post has `id`, `text`, `timestamp`, `likes`, `comments`, `url`, `media`, `platform`

5. **Given** a public or joined group
6. **When** `x_facebook_group_search` runs with a query
7. **Then** it returns a non-empty array of matching posts
8. **And** it returns a clear note explaining access restriction if the group is private and not joined

## Implementation Note

Relates to PCR4. Requires live testing on public/joined groups because current selectors may return 0 results.
