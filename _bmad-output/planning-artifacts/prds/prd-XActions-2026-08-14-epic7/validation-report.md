# Validation Report — PRD Epic 7: Facebook Advanced Scraping & Multi-Account Parallel Execution

- **PRD:** `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/prd.md`
- **Epic catalog:** `_bmad-output/planning-artifacts/epics-full.md` (§ Epic 7)
- **Sprint Change Proposal:** `_bmad-output/planning-artifacts/sprint-change-proposal-2026-08-14.md`
- **Rubric:** `_bmad-output/planning-artifacts/prds/prd-XActions-2026-08-14-epic7/validation-report.md` (self-contained)
- **Run at:** 2026-08-14
- **Grade:** Good

## Overall verdict

PRD/Epic 7 is a coherent, well-scoped expansion that correctly positions itself as a read-only, lead-generation / market-research layer on top of the existing Facebook scrapers. The FRs, UJs, and NFRs are mostly specific and the scope is honest. The main risks are a few load-bearing product/technical decisions that remain open (default behavior of `type: 'all'`, account/proxy binding, storage of health state) and some loose acceptance-criteria wording that will make "done" ambiguous for stories 7.3 and 7.6. No critical flaws; ready to move to story-level architecture once the high findings below are resolved or explicitly deferred.

## Dimension verdicts

- **Decision-readiness — adequate.** Trade-offs are named (Prisma vs Redis, p-limit vs custom, TLS/JA3) but they are parked as Open Questions rather than decided. The most consequential call — whether `x_facebook_search type: 'all'` runs sequentially on one account or in parallel across four — is unresolved, which affects both the account-pool design and the MCP contract.
- **Substance over theater — strong.** Personas (An, Bình, Cường, Dung) are few, each drives a concrete UJ. NFRs carry product-specific thresholds (`< 2s`, cap `4-8`). Vision is not generic.
- **Strategic coherence — strong.** Thesis (lead-gen ready, multi-account parallel read) is clear and every feature serves it. Success metrics are operational and testable; counter-metrics are present. The only tension is FR-62 (GraphQL replay) being listed as "out of scope if time permits" — a conditional phrasing that should be a clear defer.
- **Done-ness clarity — adequate.** FR-55, FR-56, FR-58, FR-59, FR-61, FR-63 have concrete, testable consequences. FR-57 and FR-60 rely on phrases like "normalized results matching the `type` shape" and "reuses `scrapeFacebookComments`" that need exact field lists or function-call references. Story 7.3 and 7.6 repeat this same vagueness.
- **Scope honesty — strong.** Non-goals and out-of-scope are explicit: no UI, no storage, no write automation, no Ads, no PII. Assumptions are indexed; open questions are listed. It does not, however, use inline `[ASSUMPTION]` tags, so the index roundtrip is weak.
- **Downstream usability — adequate.** Glossary is present and the domain nouns are stable. FR/UJ/SM IDs are contiguous. Some references ("shape tương tự `scrapeTweets`", "standard post shape", `buildUserDataDir(c_user)`) point to existing code/PRDs without cross-references. This is acceptable for a brownfield PRD but should be tightened in story files.
- **Shape fit — strong.** This is a brownfield, technical capability PRD. UJs are light but named and load-bearing; the form is not over-formalized. Existing ADRs are referenced correctly.

## Findings by severity

### High

- **[Decision-readiness]** Default behavior of `x_facebook_search` with `type: 'all'` is unresolved (Open Question 4). This changes whether the MCP tool returns one merged object or dispatches four parallel tasks, and therefore whether the account pool must support task fan-out by default. *Fix:* Decide and document the default in §4.2 / Story 7.3; keep the alternate path as a named option (`parallel: true/false`).

- **[Done-ness clarity]** FR-57 consequence "returns normalized results matching the `type` shape" is not specific enough. The exact per-type field lists are given, but the contract for `type: 'all'` (object with four arrays, or a flat list with a `type` discriminator?) is only implied. *Fix:* Add a §4.2.1 "All-type response shape" with the exact schema and one example.

- **[Done-ness clarity]** FR-60 / Story 7.6 say "tái dùng `scrapeFacebookComments`" without specifying the call signature or what differs for group context. *Fix:* State the function name and the exact differences (e.g., group post URL validation, no public access note).

### Medium

- **[Decision-readiness]** Storage of `FacebookAccountHealth` is undecided (Open Question 1). This affects whether a migration is needed and how health TTL is enforced. *Fix:* Decide Prisma vs Redis before Story 7.1 architecture; add a `[NOTE FOR PM]` if it stays open.

- **[Decision-readiness]** Account-to-proxy binding is undecided (Open Question 5). Multi-account parallel scraping is much less effective if each account can leak its IP or be paired with the wrong proxy. *Fix:* Decide whether `FacebookAccount` gains a `proxy` field and how `AccountPool` enforces proxy affinity.

- **[Done-ness clarity / NFRs]** No per-action delay or velocity limit is specified for read operations. NFR-12 caps concurrency but does not bound scroll/action cadence inside a single browser, which is where checkpoint risk actually lives. *Fix:* Add an NFR or FR note: scroll interval 1-3s, max scrolls per task, and a global rate throttle per account.

- **[Scope honesty]** FR-62 "GraphQL replay" is listed as out-of-scope "if time permits," which is not a real scope boundary. *Fix:* Move it to a clear "Deferred to Phase 3" bullet and remove the conditional phrasing.

- **[Downstream usability]** FR-55 says it parses `fb_dtsg`, `c_user`, `xs` "từ HTML." `c_user` and `xs` come from the request cookie, not the HTML. `fb_dtsg` is in the HTML. *Fix:* Rephrase: validate `c_user`/`xs` from the cookie jar, parse `fb_dtsg` from HTML; missing any of the three makes the account `dead`.

### Low

- **[Mechanical]** Inline `[ASSUMPTION]` tags are missing; the Assumptions Index only lists four assumptions without inline markers. *Fix:* Add `[ASSUMPTION: ...]` next to the relevant paragraphs in §2.1, §4.1, §4.5, §4.6.

- **[Mechanical]** The PRD title has `prd_ref: prd-XActions-2026-06-08` but also references `prd-XActions-2026-06-10-epic4` in §0. *Fix:* Add the Epic 4 PRD to `prd_ref` frontmatter or clarify why only one is listed.

- **[Mechanical]** In `epics-full.md`, the Epic 7 Additional Requirements mention ADR-011 (GraphQL HTTP layer), but FR-62 is deferred out of Epic 7 scope. *Fix:* Either remove ADR-011 from the epic list or add a note that it is only relevant if Phase 3 (GraphQL replay) is picked up.

- **[Mechanical]** Story 7.3 AC uses `searchFacebook(page, query, { type, limit })` but PRD FR-57 input list includes `location` and `authCookie`. *Fix:* Align the signature: `searchFacebook({ page, query, type, location, limit, authCookie })` or similar.

## Mechanical notes

- Glossary drift: none observed; terms like "Account pool," "Live account," "Health check" are used consistently.
- ID continuity: FR55-63, UJ7.1-7.4, SM-1..SM-C2 are contiguous and unique.
- Cross-references: PRD references existing PRDs and ADRs; epic catalog references ADR-006 and ADR-011.
- Assumptions Index roundtrip: weak — inline tags absent.
- UJ protagonist naming: each UJ has a named Vietnamese protagonist (An, Bình, Cường, Dung) carrying the context inline.

## Recommended next actions

1. Resolve the three high findings before architecture/story writing: `type: 'all'` default, exact `all` response shape, and group-comments reuse contract.
2. Resolve the two medium decisions before implementation: health-state storage and account/proxy binding.
3. Add per-read velocity/delay guardrails to NFRs or FRs.
4. Add inline `[ASSUMPTION]` tags and re-distill the Assumptions Index.
5. After these fixes, run `bmad-create-story` or proceed to architecture for Epic 7.
