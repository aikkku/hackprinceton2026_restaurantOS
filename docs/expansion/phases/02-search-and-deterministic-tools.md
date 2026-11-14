# Phase 2 — full-city search and deterministic tools

## Working result and prerequisite

Consume Phase 1's profile revision. “Start scouting” searches Houston's supplied snapshot and returns stable groups of offered spaces with explainable assessments. Selecting a result opens synchronized map/list detail. Add validated matching and financial tools that Phase 3 can call without allowing the model to calculate or alter canonical results.

Read Phase 1's ledger handoff and verify its exported contracts/storage behavior. Suggested locations: `backend/candidate-search.ts`, `backend/runs.ts`, `domain/matching.ts`, `domain/scenario.ts`, additive Expansion API routes, candidate UI, root Expansion test files and `frontend/e2e/candidate-search.spec.ts`.

## Implement in order

1. Extend ingestion additively to retain verified suite use/status, rent/size ranges, service inclusions and source IDs. Verify enum mappings against local kit docs; do not guess from building type. Preserve existing cache until a successful atomic rebuild, bump schema version and document required reimport.
2. Search offered spaces across the supported city using server-side batching, verified own-property joins and stable space-ID deduplication. Exclude explicit incompatible uses and off-market records from active-snapshot candidates, retain counts/reasons, and separate unknown-use candidates. Buildings are context, not offered suites. Active snapshot marketing does not verify current vacancy.
3. Evaluate every candidate before selecting a shortlist. Map bounds and page size affect rendering only. Return exact examined/included/excluded counts and any imposed scan cap. No implicit “best three” from the first result page.
4. Implement pure requirement evaluation: any hard failure → rejected; otherwise any hard unknown → needs verification; otherwise meets assessed requirements, with current-availability caveats. Record reason codes/fact IDs. Kitchen history, nearby visible parking and unknown charges cannot produce verified passes. Heights and seats remain soft.
5. Normalize rent/occupancy without double counting included charges. Retain ranges. A complete upper bound ≤ $5,000 can pass; a supported lower bound > $5,000 fails; missing components or a crossing range is unknown. Unknown reserve prevents an upfront-affordability claim. Deterministic ordering follows the background plan with stable ID tie-breaks and an explanation; no opaque score.
6. Expose additive validate/create-run/status/candidates/cancel/assessment endpoints from the background plan. Persist profile/data snapshots and results in separate ignored run storage, scoped to a local session. Bound requests/work; support cancellation, idempotency, safe errors and interrupted-run recovery. A terminal run cannot change to success after cancellation.
7. Add a schema-validated TypeScript financial tool boundary: supplied fixed costs and positive margin produce required sales; missing finance produces unavailable values, not defaults. Preserve existing scenario API behavior while adding completeness/range-aware results. Record the exact callable tools/DTOs for Python in the ledger.
8. Wire profile → real backend → citywide candidate list/map → requirement inspector. Provide loading/retry/empty/error and no-verified-match states. Keep a discoverable rejected-record view with reasons. Distinguish fictional profile from actual source provenance. No AI progress claims yet.

## Required tests

- Synthetic import/cache tests: own-property joins, unmapped links, active/off-market, suite/building use, ranges, stale cache rebuild and atomic failure preservation.
- All pages evaluated; stable ordering/deduplication; several suites at one address stay distinct; map movement cannot change run results.
- $4,500 + unknown extras → unknown; $4,500 + $700 nonincluded extras → fail; $4,000 + complete $800 extras → pass. Included charges not added twice; ranged quotes crossing cap → unknown; invalid/unsupported units rejected or retained unknown.
- Kitchen absent/present/unknown, building-only kitchen note, parking rights unknown, soft seat mismatch, non-Heights Houston candidates, no invented reserve.
- Tool finance: known fixed costs $10,000 and margin 0.4 → required sales $25,000; zero margin → unavailable with reason; missing baseline does not produce revenue/payback.
- API validation, ownership/session separation, cancellation race, idempotent create/retry, restart recovery, zero candidates and source unavailable.
- Browser against a real test-owned synthetic cache/API: profile → run → select candidate → inspect reasons → paginate/pan → stable results → retry a controlled source error. Do not mock all new API routes for this acceptance test.
- Optional private dataset search proves actual configured import/API behavior, recorded separately from synthetic proof.

Run all common gates. Keep new Node tests discoverable by `npm test`; record backend seed/startup commands and any schema/reimport steps.

## Completion and next handoff

Complete only when the search and callable tools work end to end with backend integration tests. Record tool request/response examples using synthetic values, exported schemas/versions, API status/error formats, run/session lifecycle, configuration names (no values), actual test evidence and private-data verification status. Phase 3 consumes these tools; it must not reimplement matching or finance in Python. Agent execution remains explicitly unfinished.

## Copyable agent prompt

```text
Implement Phase 2 in /Users/nofear/Documents/GitHub/hackprinceton2026_restaurantOS.

Read repository/Expansion guidance, applicable specs, docs/expansion/phases/README.md, DECISIONS.md, and docs/expansion/phases/02-search-and-deterministic-tools.md. Verify Phase 1's handoff against the source. Execute the complete Phase 2 specification, preserving unrelated changes.

Deliver profile-driven, offered-space-only full-city search, deterministic pass/fail/unknown assessments, stable explained ordering, persisted/cancellable run APIs, and callable TypeScript matching/finance tools. Connect the actual backend to the candidate list/map/inspector. Preserve unknowns, suite scope, source ranges and the $5,000 total-occupancy requirement. Keep all arithmetic out of AI and do not modify Tactical or implement Deep Agents yet.

Use synthetic cache/API integration tests, focused matching/finance/error tests and the specified browser journey; optional private-data proof must be labeled separately. Run common lint/typecheck/Node/build/Playwright checks and fix regressions. Never replace a failed real source with fictional success or mark an unrun check passed.

Update docs/expansion/DECISIONS.md with actual APIs, schemas, callable tool contracts, cache migrations, run/session behavior, test evidence, blockers and exactly what Phase 3 must consume. Report completed behavior and remaining work. Stop after Phase 2.
```
