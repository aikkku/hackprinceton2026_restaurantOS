# Phase 1 — profile review and stable contracts

## Working result

At `/expansion`, an owner can choose “Use example restaurant,” review Cedar Kitchen, edit requirements, validate them, save/reload the draft, and continue to the existing explorer. Show the new candidate search as pending Phase 2; do not present the old base-rent filter as intake-based matching.

## Inputs and scope

Read the phase runbook, handoff ledger, repository guidance, Expansion specs, existing schemas/storage/page components and `docs/expansion/examples/restaurant-intake.sample.json`. Read the shared-contract proposal for context; implement Expansion-local contracts.

Suggested files: `domain/intake.ts`, `domain/requirements.ts`, `domain/evidence.ts`, new frontend profile components, `frontend/storage.ts`, `frontend/expansion-page.tsx`, `src/features/expansion/intake.test.ts`, and `frontend/e2e/profile.spec.ts`. Adapt naming to current source and record actual paths.

## Implement in order

1. Define Zod intake/revision schemas matching the entire sample, including answer references, missing values and follow-up questions. Reject dangling/duplicate answer IDs, invalid ranges, negative money and contradictory reserve/funds. Define explicit handling for unsupported currencies/markets; do not reinterpret them as USD/Houston.
2. Normalize the intake into stable requirements with IDs, hard/soft status, units, source-answer IDs and profile revision. Preserve $5,000 all-in occupancy; 40–50 seats soft; kitchen/parking hard; Heights preferred; reserve, area bounds, parking count and financial baseline unknown. Validate user edits at the same boundary.
3. Define the evidence/assessment envelope used next: entity scope (building/space), origin, exact/ranged/unknown values, source/date, method, limitations; pass/fail/unknown/not-applicable with reason codes and evidence IDs. Do not build property adapters or pretend facts exist yet.
4. Build a labeled profile-review UI using existing tokens. Display seven original answers and clearly identify the fictional example. Editing must retain original answers while recording the new user input's origin; do not rewrite the historical interview. Show inline validation and an accessible error summary.
5. Add optional follow-up fields for reserve/cooking needs/financial baseline; initial review works without them. New edits generate immutable revisions so future runs can reference the exact requirements used.
6. Save versioned drafts under a new Expansion-local storage key. Restore valid drafts, preserve corrupt stored content until explicit reset, handle blocked storage without losing in-memory edits, and preserve current demo/local scenario keys. Existing explorer and Tactical navigation still work.

## Required tests

- Sample round-trip and normalized requirements; all nulls and provenance retained.
- Missing source answer, duplicate ID, reversed seat range, reserve above funds, invalid amounts/currency and unsupported target market handled explicitly.
- Unspecified reserve is not zero; seats do not become square feet; parking does not acquire a numeric minimum.
- Edit produces a new revision; old revision and original answer remain unchanged.
- Draft migration/unknown version/corruption/storage write failure and reset behavior.
- Browser: load example → inspect answers → edit limit → receive invalid-input feedback → correct → save → reload → restore → navigate to explorer. Repeat keyboard-only and at mobile width; inspect source labels and no horizontal overflow.
- Regression: existing map/demo and scenario paths, mode switch and Tactical style isolation remain functional. New profile controls must not make earlier features unreachable.

Run the common verification gate from `phases/README.md`. Record actual outcomes; a documentation claim is not evidence of existing checks.

## Completion and next handoff

Complete when the profile path works without manual code changes, schemas and normalization are covered, and regression checks pass. Update `DECISIONS.md` with storage keys, schema versions, requirement IDs, actual exported function signatures and browser steps. Explicitly list search, agent execution, source enrichment and new financial comparison as not implemented. Phase 2 consumes these contracts rather than creating another profile format.

## Copyable agent prompt

```text
Implement Phase 1 of the RestaurantOS profile-driven Expansion work.

Repository: /Users/nofear/Documents/GitHub/hackprinceton2026_restaurantOS

First read AGENTS.md, src/features/expansion/AGENTS.md, the applicable Expansion specs, docs/expansion/phases/README.md, docs/expansion/DECISIONS.md, and docs/expansion/phases/01-profile-and-contracts.md. Inspect the existing code and git status. Treat the complete Phase 1 document as the task specification.

Deliver the working browser profile review/edit/validate/save/reload path and versioned local schemas, using docs/expansion/examples/restaurant-intake.sample.json. Preserve source answers and unknowns. Keep $5,000 as total occupancy, 40–50 seats as a preference, and kitchen/parking as hard requirements. Preserve existing explorer/scenario navigation and Tactical ownership. Do not implement later phases or call old filters the new matching engine.

Implement focused schema/storage tests and the browser acceptance path, then run the common lint/typecheck/Node/build/Playwright gates. Fix failures caused by your changes. Record unrun checks and blockers honestly; do not mark the phase complete without passing its required gates.

Before finishing, update DECISIONS.md with actual files, contracts, revisions/storage keys, test commands/results, what works, what is unfinished, and precise instructions for Phase 2. Return the working flow, changed files, validation evidence and remaining limitations. Stop after Phase 1.
```
