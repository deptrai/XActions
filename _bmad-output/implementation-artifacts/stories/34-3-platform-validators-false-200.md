---
title: 'Story 34.3: Platform-Specific Validators & False-200 Detection'
type: 'feature'
created: '2026-09-08'
status: 'backlog'
epic: 34
story_number: 34.3
phase: 'MVP'
priority: 'high'
context:
  - _bmad-output/specs/spec-scraper-benchmark/SPEC.md
  - _bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md
  - _bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md
  - src/core/platform-validator.js
  - src/scrapers/*/{client,crawler,normalizer,validator}.js
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** HTTP 200 responses can be False 200s: Cloudflare challenge pages, Arkose captchas, login walls, empty wrappers. A generic `status === 200` check overestimates True Success Rate. Platform-specific validators must distinguish valid payloads from challenge pages.

**Approach:**
1. Extend `AbstractPlatformResponseValidator` in `src/core/platform-validator.js` with structural signal detection.
2. Define per-platform False-200 signatures (skeleton HTML, Cloudflare/Arkose markers, login-wall markers, empty-data markers).
3. Add `false200Detected` and `checkpointDetected` fields to telemetry.
4. Integrate with canary runs and production telemetry.

## Boundaries & Constraints

**Always:**
- Distinguish True Success (payload passes validator + not False 200) from raw HTTP 200.
- Use structural signals, not just status code (metrics-catalog.md: True Success Rate definition).
- Platform signatures live in `src/core/platform-validator.js` or platform-specific validator modules.

**Ask First:**
- Before adding challenge-solver logic (out of scope — alerting only for Epic 34).

**Never:**
- Do NOT mark a response as success just because `status === 200`.
- Do NOT solve CAPTCHA/challenge automatically in this story.

## I/O & Edge-Case Matrix

| Scenario | Input | Expected Output | Error Handling |
|----------|-------|-----------------|----------------|
| Cloudflare challenge | HTML with `__cf_chl_jschl_tk__` | `false200Detected: true`, `true_success: false` | Fallback to structural marker |
| Arkose captcha | HTML with `arkose` scripts | `false200Detected: true`, `true_success: false` | Log platform |
| Login wall | HTML with "Sign in" / "Đăng nhập" | `checkpointDetected: true`, `true_success: false` | Alert operator |
| Empty wrapper | Valid-looking page but empty data list | `false200Detected: true` if no platform-specific markers | Score as fail |
| Valid payload | Expected JSON/HTML with content | `false200Detected: false`, `true_success: true` | Continue |

</frozen-after-approval>

## Code Map

- `src/core/platform-validator.js` — `AbstractPlatformResponseValidator` + shared False-200 detection
- `src/scrapers/{twitter,facebook,threads,tiktok,shopee,...}/validator.js` — platform-specific structural signals
- `src/core/telemetry-emitter.js` — consumes validator output and sets `false200Detected`/`checkpointDetected`
- `tests/benchmark/platform-validators.test.js` — fixture-based tests

## Technical Notes

### Generic False-200 Signals

```javascript
const GENERIC_FALSE_200_MARKERS = [
  /__cf_chl_jschl_tk__/i,          // Cloudflare challenge
  /arkose/i,                       // Arkose captcha
  /captcha/i,                      // generic captcha
  /id="login"|class="login"|sign in to/i, // login wall
  /please enable javascript|checking your browser/i, // Cloudflare waiting room
];
```

### Platform Structural Markers

Each platform must define a function `hasPlatformData(htmlOrJson)` that returns `true` if the expected data structures are present. Example patterns:
- **Twitter**: JSON with `data.user.result.timeline_v2`
- **Facebook**: JSON with `domops` or HTML with `data-ft`
- **Shopee**: JSON with `data.item` array
- **PasGo/Foody/Riviu**: JSON-LD `Restaurant` / `LocalBusiness`
- **Masothue**: table rows with `.table-taxpayer`

### Integration with Telemetry

```javascript
const validation = validator.validate(response);
const true_success = validation.isValid && !validation.false200 && !validation.checkpoint;
```

## Acceptance Criteria

- [ ] `AbstractPlatformResponseValidator` detects at least 5 generic False-200 patterns.
- [ ] At least 5 platform-specific validators (Twitter, Facebook, Shopee, PasGo, Masothue) produce `false200Detected`/`checkpointDetected`.
- [ ] `telemetryEmitter` uses validator output to set `stability.true_success` correctly.
- [ ] `tests/benchmark/platform-validators.test.js` passes with 20+ fixture cases.
- [ ] Canary runs mark False-200 URLs as `isSuccess: false`.

## Dependencies

- Depends on: Story 34.1, Story 34.2
- Blocks: Story 34.4 (scoring engine depends on True Success), Story 34.7 (canary runs need validation)

## Test Strategy

- **Unit tests**: `tests/benchmark/platform-validators.test.js` (fixture HTML/JSON per platform)
- **Integration tests**: `tests/benchmark/telemetry-pipeline.test.js` (end-to-end with mock responses)

## References

- Spec: `_bmad-output/specs/spec-scraper-benchmark/SPEC.md` (CAP-3, Constraint #3)
- Metrics Catalog: `_bmad-output/specs/spec-scraper-benchmark/metrics-catalog.md` (True Success Rate, False 200 Rate)
- Architecture Spine: `_bmad-output/planning-artifacts/architecture/xactions-benchmark-epic34/ARCHITECTURE-SPINE.md` (AD-26)
