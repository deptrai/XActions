# Decision records

This folder holds the decisions the code cannot explain on its own — choices that bend
more than one component, where the reason would otherwise be lost.

## When to write one

- A decision two or more components, teams, or epics have to share (a shared storage
  format, a protocol choice, a "we do it this way everywhere" rule).
- A path not taken that someone will keep re-proposing.
- A trade-off with real cost (accepted risk, deferred work, an external constraint like
  X's rules or a cease-and-desist precedent).

Do not write ADRs for choices one file already explains, or to narrate history.
The [ROADMAP](../../ROADMAP.md) "deliberately not building" list already does that job
for scope; don't duplicate it here.

## How

Create `adr-<slug>.md` in this folder. Small files, written once, rarely edited —
append a `Superseded:` or `Amended:` line instead of rewriting.

```markdown
---
decision: <one-sentence decision>
date: YYYY-MM-DD
status: proposed | accepted | superseded
---

## Context
<what forced the choice; cite sources and alternatives considered>

## Decision
<what was chosen, stated so it can be enforced>

## Consequences
<what this costs; what it rules out>
```

Cross-link both ways: the ADR names the code it bends, and a comment in that code
points back (`// see docs/decisions/adr-<slug>.md`).

BMad note: an epic adopting a shared decision cites the ADR in its `References`
(`architecture — docs/decisions/adr-<slug>.md`), per the ticket tree rules.
