# Review Prompt — Story 54.0 Spike (blind-hunter)

Conduct a review of CONTENT.
Look for what's missing, not only what's wrong.
Compute your finding floor N from the size of the changes: N = min(floor(sqrt(kB) + 1), 10), where kB is the changed content's size in kilobytes. State the arithmetic in one line, then find at least N issues to fix or improve.
Output a Markdown list of findings only — no severity, priority, or ranking.
If the content is empty, stop and say so.
If you have zero findings, re-check and keep thinking; do not stop with an empty list.

CONTENT:
The changed files for Story 54.0 (ingestion coverage spike):
- `scripts/spike-54-coverage.mjs` (new spike script)
- `_bmad-output/implementation-artifacts/spike-54-coverage-report.md` (verdict report)
- `_bmad-output/implementation-artifacts/spec-54-0-ingestion-coverage-spike.md` (spec)
Inspect them directly before reviewing. Cross-check verdicts against the raw data in `scripts/spike-54-coverage-results/results.json`.

Do not invoke any skill, and do not spawn subagents of your own — you are the reviewer. Return your findings as text in your final message; do not route them through any findings-reporting tool the host may offer.
