---
epic: 33
story: 33.3
status: ready-for-dev
created: '2026-09-19'
gated: true
activation_conditions:
  - "Research spike (2 weeks dedicated) completed"
  - "Nowing has concrete need for Zalo personal data"
  - "Legal/compliance review approved by Product Council"
---

# Story 33.3: Zalo Personal Messaging — RESEARCH SPIKE first, implementation after

## Epic
Epic 33: Vietnam Social & Video Platform Expansion

## Status: `backlog-blocked` — DO NOT start until activation conditions confirmed.

## Goal
Reverse engineer Zalo's private mobile/Web API (gRPC/protobuf/WebSocket) to scrape personal messaging (DMs, group chats, friend list) — beyond the current OA public API.

## FRs Covered
- FR-114 (Zalo Personal Messaging — conditional, research-gated)

## Story
As a Vietnam market intelligence analyst, I want to research and then scrape Zalo personal messaging (chats, groups, contacts), so that Nowing can capture lead signals from Vietnam's dominant messaging platform beyond OA public content.

## Current Gap
- `zalo/descriptor.js` only covers `oa_posts`/`oa_followers`/`oa_detail`/`marketplace_products` — Zalo OA public API only.
- Personal Zalo needs reverse engineering of mobile app protocol (gRPC/protobuf) or Web WebSocket — large effort, high risk.

## Phase Plan
- **Phase A (this stub's first deliverable):** 2-week dedicated research spike — intercept Zalo Web/mobile traffic, document protocol, assess feasibility + legal/compliance.
- **Phase B (separate story, created after spike):** implementation if spike is favorable.

## Activation Conditions
1. Nowing có nhu cầu cụ thể cho Zalo personal data.
2. Zalo mobile API research hoàn tất (minimum 2 tuần dedicated).
3. Product Council approve legal/compliance review.

## Out of Scope
- Implementation before research spike completes.
- Any scraping that violates ToS without explicit legal sign-off.

## Dev Notes
- This is the riskiest gated story — reverse engineering a closed E2EE-adjacent protocol may be infeasible or legally restricted; spike verdict may be "do not proceed".
