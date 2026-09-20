---
epic: 27
story: 27.5
status: ready-for-dev
created: '2026-09-19'
gated: true
activation_conditions:
  - "FR-40..FR-54 stable in production"
  - "Checkpoint rate still > 5% (confirms need for deeper spoofing)"
---

# Story 27.5: Advanced Fingerprint Spoofing — Canvas / WebGL / Audio noise injection

## Epic
Epic 27: Anti-Detection & Session Resilience

## Status: `backlog-blocked` — DO NOT start until activation conditions confirmed.

## Goal
Inject dynamic, per-account-stable noise into canvas, WebGL buffer readback, and AudioContext fingerprints for targets with aggressive bot-challenge (checkpoint rate >5%).

## FRs Covered
- FR-113 (Advanced Canvas/WebGL/Audio Fingerprint Spoofing — conditional)

## Story
As an XActions operator scraping heavily-defended targets, I want canvas/WebGL/audio fingerprints spoofed with stable per-account noise, so that headless sessions survive advanced bot detection that reads rendering/audio entropy.

## Current Gap
- `stealthBrowser.js:295-302` only spoofs WebGL **vendor/renderer strings** (static, from FingerprintManager profile).
- `FingerprintManager` profiles are **static** — no canvas `toDataURL`/`getImageData` noise, no WebGL buffer perturbation, no `AudioContext`/`AnalyserNode` spoof.

## Scope Sketch (to be refined on activation)
- `canvas` noise: override `HTMLCanvasElement.toDataURL`/`getImageData`/`measureText` with deterministic per-account jitter.
- `webgl` buffer noise: perturb `readPixels`/`getParameter` beyond vendor/renderer.
- `audio` spoof: override `AudioContext`/`AnalyserNode` `getFloatFrequencyData`/oscillator fingerprint.
- Deterministic seed per account (stable across sessions — same fingerprint for same account).

## Activation Conditions
- FR-40..FR-54 stable, checkpoint rate vẫn > 5%.

## Out of Scope
- TLS/JA4 spoofing (already `TlsProfileProvider`).
- Changing `FingerprintManager` profile schema beyond adding noise seeds.

## Dev Notes
- Must keep noise **deterministic per account** — random-per-load defeats the point (consistent fingerprint = human).
