---
epic: 33
story: 33.4
status: backlog-blocked
created: '2026-09-19'
gated: true
activation_conditions:
  - "Epic 33.2 stable in production >= 2 weeks"
  - "YouTube API quota optimization complete (10k units/day limit)"
---

# Story 33.4: YouTube VN Advanced Data — InnerTube live chat + Shorts + subscriber history

## Epic
Epic 33: Vietnam Social & Video Platform Expansion

## Status: `backlog-blocked` — DO NOT start until activation conditions confirmed.

## Goal
Extend YouTube VN crawler with live stream chat, Shorts deep analytics, YouTube Music VN, and channel subscriber history via InnerTube/extended APIs beyond Data API v3.

## FRs Covered
- FR-115 (YouTube VN Advanced Data — conditional)

## Story
As a Vietnam content intelligence analyst, I want YouTube VN live chat, Shorts analytics, and subscriber history, so that Nowing can track real-time engagement and influencer growth beyond standard video metrics.

## Current Gap
- `youtube/descriptor.js` covers `search`/`trending_vn`/`channel_videos`/`channel_detail`/`video_detail`/`video_comments` — standard Data API v3 surface.
- Missing: live stream chat (InnerTube continuation), Shorts deep analytics, YouTube Music VN, channel subscriber history.

## Scope Sketch (to be refined on activation)
- `live_chat` action: InnerTube `live_chat/get_live_chat` continuation polling.
- `shorts_analytics`: Shorts-specific engagement metrics.
- `subscriber_history`: channel subscriber count over time.
- `youtube_music_vn`: YouTube Music trending/charts VN.

## Activation Conditions
1. Epic 33.2 stable trong production ≥ 2 tuần.
2. YouTube API quota optimization hoàn tất (10k units/day limit).

## Out of Scope
- InnerTube requires unofficial endpoints — mark as best-effort, fallback to Data API v3 where possible.

## Dev Notes
- InnerTube is unofficial/undocumented — treat as brittle; wrap with circuit breaker + graceful fallback.
