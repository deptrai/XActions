# Persona Engine Reference

**File:** `src/personaEngine.js`

The Persona Engine defines a complete identity for algorithm building.

## Niche Presets

Quick-start templates:

| Preset | Focus |
|--------|-------|
| `crypto-degen` | Crypto, DeFi, web3, memecoins |
| `tech-builder` | Building in public, SaaS, indie hacking |
| `ai-researcher` | AI/ML, LLMs, papers, agents |
| `growth-marketer` | Content strategy, copywriting, audience building |
| `finance-investor` | Stocks, markets, portfolio management |
| `creative-writer` | Writing craft, storytelling, books |
| `custom` | Define your own |

## Activity Patterns

Human-like schedules:

| Pattern | Description |
|---------|-------------|
| `night-owl` | Active late night, sleeps mornings |
| `early-bird` | Active from 5am, winds down by 10pm |
| `nine-to-five` | Checks before/after work, active evenings |
| `always-on` | Creator schedule, active throughout the day |
| `weekend-warrior` | Light weekdays, heavy weekends |

## Engagement Strategies

| Strategy | Follows/day | Likes/day | Comments/day |
|----------|-------------|-----------|-------------|
| `aggressive` | 80 | 150 | 40 |
| `moderate` | 40 | 80 | 20 |
| `conservative` | 15 | 40 | 8 |
| `thoughtleader` | 20 | 60 | 30 (deep) |

## Key Exports

```js
import {
  createPersona, savePersona, loadPersona, listPersonas, deletePersona,
  buildPersonaSystemPrompt, buildCommentPrompt, buildPostPrompt,
  shouldBeActive, planSession, getSessionDuration,
  NICHE_PRESETS, ACTIVITY_PATTERNS, ENGAGEMENT_STRATEGIES,
} from './personaEngine.js';
```

## CLI Commands

```bash
# Create persona interactively
medirus persona create

# Create with options
medirus persona create --preset crypto-degen --strategy aggressive --activity night-owl

# List all personas
medirus persona list

# Run algorithm builder (24/7)
medirus persona run <personaId>
medirus persona run <personaId> --no-headless    # visible browser
medirus persona run <personaId> --dry-run        # preview mode
medirus persona run <personaId> --sessions 5     # stop after 5 sessions

# Check stats
medirus persona status <personaId>

# Edit persona
medirus persona edit <personaId> --topics "ai,llm,agents" --strategy thoughtleader

# Delete persona
medirus persona delete <personaId>
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENROUTER_API_KEY` | Required for LLM-generated comments and posts |
| `MEDIRUS_SESSION_COOKIE` | X auth token (alternative to `--token` flag) |

## Getting Started (5 minutes)

```bash
# 1. Set your OpenRouter key
export OPENROUTER_API_KEY=sk-or-v1-...

# 2. Login to X
medirus login

# 3. Create a persona
medirus persona create --preset crypto-degen --strategy thoughtleader --activity always-on

# 4. Start building (runs forever)
medirus persona run persona_1234567890
```
