# Phase 4 — source enrichment, comparison and saved decisions

## Working result and prerequisite

Consume Phase 3's actual agent run and source gaps. An owner investigates candidate requirements, sees supported interior/aerial/market evidence, compares opening plans, and saves/reloads a reproducible decision brief. Source gaps remain visible; agents cannot convert missing data into a verified match.

Read all prior handoffs and verify the profile, candidate, worker, event and calculation contracts. Suggested changes: Expansion-local provider adapters, `domain/evidence.ts`, `domain/scenario.ts`, investigation/compare UI, brief/storage schemas, Python inspection tools, Node/worker tests and `frontend/e2e/decision-brief.spec.ts`. Reuse existing `data_access.py` carefully; record any changed public helper behavior and run its tests.

## Implement in order

1. Add provider capability/status records: configured, verified, denied, outside coverage, unavailable. Probe safely using bounded permitted calls; key presence is not verification. Each provider has labeled synthetic fixtures for tests and explicit unavailable behavior in local mode. Never silently inject fixture facts into actual candidates.
2. Matterport: validate property/model links and whether they actually identify the offered suite. Embed a permitted viewer when available. Fetch room/area measurements only if the accessible source supports them. Property-level metadata alone does not verify a suite's kitchen or dining area. Derived seats require measured usable dining area plus an explicit density assumption, labeled as a planning estimate, not legal occupancy.
3. Vexcel: reuse extraction/coverage handling, retain capture date when supplied, attach imagery to a documented site context, and optionally derive visible stalls/patio/frontage with reviewed vision output. Keep visible parking separate from customer access/allocation. No image-only hard pass for mandatory parking, and no invented minimum count.
4. Neighborhood/context: add a sourced/versioned Heights boundary or lookup; unknown membership remains unknown. Add a pinned ACS release/variable set with units, geography, margins of error and documented H3 allocation. Current address and price level are missing in the sample: request them optionally and leave home similarity/price-fit unavailable until supplied. Select a competition source with verified permitted map/storage use; check current official policies before integration. Do not assume Google Places is compatible with MapLibre merely because results are aggregated.
5. Connect available source adapters to the Phase 3 market/inspection tools. Keep raw source access server-side, include record/suite scope and source dates, validate evidence IDs, and propagate provider failure as gaps. Any area score needs a versioned normalization/weight/coverage model and tests; otherwise expose individual supported metrics with composite unscored. Market factors never override failed hard requirements.
6. Build requirement-by-requirement investigation. Allow dated user verification/source notes separately from assumptions. Preserve conflicting observations and explicitly show when a hard requirement remains unresolved. Reassess using the Phase 2 engine without changing the historical run snapshot; save a new assessment revision.
7. Complete nullable/ranged finance and compare two or three candidates. Distinguish recurring occupancy from deposits/one-time costs and initial working capital. Do not double count charges. Usable funds require a supplied reserve; required sales require supplied fixed costs and margin. Guests/day requires spend and operating days. Optional seats/turns/revenue inputs are assumptions. Missing defaults stay blank unless the user explicitly chooses labeled illustrative values.
8. Save a versioned decision brief with profile/run revisions, source/evidence snapshots, requirement results, scenario inputs/results, model versions, selected candidates and next questions. Restore without refreshing silently. Explicit refresh produces new evidence/re-evaluation. Preserve legacy saved scenarios and handle corrupt/blocked storage. Provide a usable in-app brief; exports may contain only content allowed by its source rights.

## Required tests and live evidence

- Adapter mapping and provider errors: missing/wrong-suite model, unsupported measurements, stale/missing date, Vexcel 403/outside coverage, occluded imagery, unknown parking rights, malformed source/model output and API timeout.
- Geography/source tests: Heights is a preference; unresolved boundary explicit; ACS release/units/MOE and tract-to-H3 method; no similarity without current address; no invented price level or competition data.
- Evidence tests: conflicting facts retained; user assumption does not become observed; original run immutable; incomplete charge/capacity/kitchen records do not falsely pass hard requirements.
- Finance: rent units/ranges, included charges, reserve unknown, upfront category duplication, zero margin, missing spend/days, and deterministic sensitivity. Synthetic example: complete fixed cost $10,000 and margin 0.4 → $25,000 required monthly sales; no assumed sales → no predicted profit/payback.
- Save/migration: same input restores same calculated result, mixed-profile comparisons prevented or explicitly separated, corrupted/unknown schema preserved, saved-source outage and explicit refresh correctly labeled.
- Browser: example profile → genuine agent run → inspect evidence → add assumption → compare two spaces → inspect formula/source drawer → save → reload → restore → revise profile → new run. Test keyboard, mobile, reduced motion, no matches, no fully verified matches and source failures.
- Common checks plus Python helper/worker/contract suites. Maintain a real backend/worker synthetic acceptance path; mocks alone are insufficient.
- Separately record bounded live proof for CoStar local search, Matterport metadata/association, permitted Vexcel imagery, ACS and the chosen competition/geography sources. Capture actual supported capabilities and limitations, not private payloads. Missing evidence for a specific candidate is acceptable; claiming unsupported measurement or an untested provider is not.

## Completion and next handoff

Two gate sets: (A) core investigation/finance/save journey, (B) live source integrations. Record each provider individually. An honestly unavailable field is valid core behavior; absent provider access leaves that source gate blocked and the phase `partial`, not complete. Do all independent UI/adapter/test work first; list exact remaining access/evidence actions. Phase 5 can harden the core with these gaps visible, but cannot claim the blocked source integrations are finished.

Record actual adapters/capabilities, schema/storage migrations, assumption categories, source/model-processing permissions verified, live versus synthetic test evidence and the final browser path in `DECISIONS.md`.

## Copyable agent prompt

```text
Implement Phase 4 in /Users/nofear/Documents/GitHub/hackprinceton2026_restaurantOS.

Read repository/Expansion guidance, relevant specs, docs/expansion/phases/README.md, all DECISIONS.md handoffs and docs/expansion/phases/04-investigation-and-decisions.md. Verify the Phase 3 Deep Agents/run/tool contracts. Implement the complete phase specification without replacing the existing planner or calculation engine.

Connect permitted Matterport, Vexcel, neighborhood, ACS and competition evidence through validated adapters, with suite association and capability checks. Build requirement investigation, separate user verification from assumptions, complete finance comparison, and versioned saved decision briefs. Preserve $5,000 total occupancy, unknown reserve, soft seats and mandatory kitchen/customer parking. Never manufacture missing facts or treat aerial parking as customer-use rights.

Run specified adapter/finance/evidence/storage tests, the real backend/worker synthetic browser journey, all common checks and Python suites. Record each live integration separately; an unavailable source can be handled correctly without being called a completed integration. Keep the phase partial if required live gates remain blocked and finish independent work.

Update docs/expansion/DECISIONS.md with working flows, actual source capabilities, versions/migrations, commands/results, unresolved evidence and precise Phase 5 handoff. Report changed files, verification and remaining blockers. Stop after Phase 4.
```
