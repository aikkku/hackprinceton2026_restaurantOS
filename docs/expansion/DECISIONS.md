# Expansion — decisions and implementation handoff

This is the shared implementation ledger for the [five-phase plan](phases/README.md). Every implementing agent reads it before work and updates it before finishing. It records actual state, not hoped-for features. Keep the current snapshot accurate and append history; do not erase earlier failed checks or unfinished tasks.

## Current snapshot

Last updated: 2026-11-14, Phase 1 implementation (see handoffs H-001 and H-002 below).

Next task: execute [Phase 2](phases/02-search-and-deterministic-tools.md), consuming the Phase 1 contracts (see "Phase 2 handoff" at the end of H-001, as amended by H-002).

| Phase | Status | Delivered by this phase | Gate evidence | Remaining |
|---|---|---|---|---|
| 1 — Profile/contracts | partial | Versioned intake/revision schemas, normalized requirements, immutable revisions, resilient draft storage, profile review/edit/save/restore UI at `/expansion` with explorer bridge | Typecheck passes; 86/86 Node tests pass in-process; lint clean for Expansion (3 pre-existing Tactical errors untouched per user decision); exact `npm test`/`npm run build`/`npm run test:e2e` blocked by session sandbox `spawn EPERM` (user chose in-process equivalents over escalation) | Run the exact gate commands in an unsandboxed shell; fix or get permission for the 3 pre-existing Tactical lint errors |
| 2 — Search/tools | not_started | None | Not run | Entire Phase 2 |
| 3 — Deep Agents | not_started | None | Not run | Actual worker/planner/five specialists/tools/live proof |
| 4 — Investigation/decisions | not_started | None | Not run | Source adapters, comparison, saved brief |
| 5 — Release/operations | not_started | None | Not run | Accounts, durable deployment, integrated release proof |

The existing repository already contains an Expansion explorer, demo/local modes, CoStar import/map/detail APIs, deterministic scenario helpers, browser-local scenario storage and a separate Python data-access helper. Phase 1 adds the profile layer without replacing them. Existing implementation notes contain historical test reports; this session's run results are in H-001.

Observed existing configuration: npm scripts provide lint, typecheck, Node tests, build and Playwright; Node tests currently glob only feature-root `*.test.ts`; browser tests are in the Expansion frontend e2e directory. On this Windows session, the DSH sandbox blocks child-process pipe creation, so any command that spawns workers with piped stdio (`npm test` file workers, `next dev`/`next build` workers, Playwright runner/browsers) fails with `spawn EPERM`. The user chose in-process equivalents over sandbox escalation; see H-001.

## Decisions to preserve

| ID | Decision | Reason / boundary |
|---|---|---|
| D-001 | Use `examples/restaurant-intake.sample.json` as Cedar Kitchen's fictional starting profile | User-selected example; preserve answers, source references and missing values |
| D-002 | $5,000 is a hard total monthly occupancy cap | Base rent alone does not establish affordability |
| D-003 | $100,000 total funds does not equal available opening spend | Emergency reserve is unspecified |
| D-004 | 40–50 seats is soft; area bounds and parking minimum remain unknown | Do not invent square-footage/count constraints |
| D-005 | Existing kitchen and customer parking are mandatory | Missing or building-only evidence is unknown, not pass/fail |
| D-006 | Houston required, Heights preferred | Other Houston neighborhoods remain eligible |
| D-007 | TypeScript owns canonical matching and financial arithmetic | Model/worker invokes tools; no duplicated Python/LLM formulas |
| D-008 | Deep Agents is required in Phase 3 | User explicitly emphasized its importance; genuine planner + five specialist delegations and live proof required |
| D-009 | Retain Next.js/MapLibre/H3 and existing data adapter foundations | Rebuild the flow incrementally; Python worker has a narrow boundary |
| D-010 | Full-city candidate assessment is independent of map pagination | First-page/viewport sampling cannot establish the best candidates |
| D-011 | Separate profile, property, observation and assumption provenance | Fictional restaurant can evaluate actual dated records without relabeling their origin |
| D-012 | Phase documents govern the new five-phase execution order | Original eleven rows are work packages, not eleven further phases |
| D-013 | Keep contracts Expansion-local until jointly agreed | Do not edit Tactical/shared contracts silently |
| D-014 | Required live proof and synthetic tests are separate gates | Mocks/unavailable handling do not establish a working integration |
| D-015 | `/expansion` opens with a profile-first gate; explorer stays reachable via an explicit “Continue to the scouting map” action | Phase 1 journey starts with “Use example restaurant”; existing explorer/scenario behaviors and Tactical navigation must remain reachable; the old base-rent filter is NOT presented as intake-based matching (Phase 2 replaces matching) |
| D-016 | Requirement edits create new immutable revisions; the original intake snapshot and originalSourceAnswerIds are never rewritten; a no-change save emits no edits | Future runs must reference the exact requirements used; interview provenance must survive editing |
| D-017 | Unsupported currencies/markets are rejected explicitly (UnsupportedProfileError), never re-interpreted as USD/Houston | No silent coercion at any boundary |
| D-018 | This session: leave the 3 pre-existing Tactical lint errors untouched and use in-process equivalents for spawn-blocked gate commands | User explicitly declined editing Tactical files and declined sandbox escalation; recorded, not papered over |

Update decisions with a new ID and rationale; if superseded, retain the old row and link its replacement. Do not supersede a user requirement silently. Technology/provider details not yet chosen are proposals until implemented and verified.

## Contracts and runtime inventory

Populate with actual implemented names/signatures, not proposed filenames copied from the plan.

| Area | Current new-flow contract/version | Implemented file(s) | Consumer / migration |
|---|---|---|---|
| Intake/profile revisions | `INTAKE_SCHEMA_VERSION = "1.0"`; `intakeSchema`, `parseIntake`, `profileRevisionSchema`, `profileDraftEnvelopeSchema` (draft `schemaVersion: 1`); `PROFILE_DRAFT_SCHEMA_VERSION = 1` | `src/features/expansion/domain/intake.ts`, `src/features/expansion/domain/requirements.ts`, `src/features/expansion/frontend/storage.ts` | Phase 2 search, run service, UI. New drafts start at v1; unknown versions are preserved until explicit reset |
| Requirements | `REQUIREMENTS_MODEL_VERSION = "expansion-requirements-v1"`; 14 stable requirement IDs; `normalizeRequirements`, `createProfileRevision`, `validateRequirements`, `requirementEditSchema` | `src/features/expansion/domain/requirements.ts` | Search, specialists, UI. Phase 2 fills assessment envelopes; do not rename IDs without migration |
| Evidence/assessment envelope | Removed as unused on 2026-11-14 (test-only; see H-002) | — | Phase 2 defines fact/assessment contracts when assessments are actually implemented |
| Citywide candidate search | Not implemented | — | Run service/site scout (Phase 2) |
| Callable deterministic tools | Not implemented | — | Python specialist bridge (Phase 2/3) |
| Run/session/auth lifecycle | Not implemented | — | Worker/UI/storage (Phase 3+) |
| Deep Agents artifacts/events | Not implemented | — | SSE/recovery/brief (Phase 3) |
| Brief/storage/migrations | Not implemented | — | Restore/accounts (Phases 4–5) |
| Worker setup/start/test commands | Not implemented | — | Phases 3–5 |

### Actual exported contracts (Phase 1)

- `src/features/expansion/domain/intake.ts`
  - `INTAKE_SCHEMA_VERSION = "1.0"`, `PROFILE_DRAFT_SCHEMA_VERSION = 1`
  - `intakeSchema` (Zod) — validates the entire `restaurant-intake.sample.json` shape; rejects dangling/duplicate answer IDs, reversed seat ranges, negative money, nonfinite amounts, reserve > funds, reserve + upfront spending > funds.
  - `parseIntake(value: unknown): RestaurantIntake`; types `RestaurantIntake`, `SourceAnswer`, `FollowUpQuestion`, `BudgetSection`, `SpaceSection`, `FinancialBaseline`, `RestaurantSection`, `ExpansionSection`.
- `src/features/expansion/domain/requirements.ts`
  - `REQUIREMENT_IDS` (14 stable IDs): `market.target`, `market.neighborhoodPreference`, `occupancy.monthlyLimit`, `occupancy.scope`, `funds.totalAvailable`, `funds.emergencyReserve`, `space.seats`, `space.areaSqFt`, `space.existingKitchen`, `space.customerParking`, `space.parkingSpacesMinimum`, `space.ventilation`, `timeline.openingDate`, `finance.baseline`.
  - `normalizeRequirements(intake, { revisionId, revisionNumber, createdAt }): SearchRequirements` — throws `UnsupportedProfileError` (`unsupported_currency` / `unsupported_market`).
  - `createProfileRevision(intake, options, edits?, followUpAnswers?): ProfileRevision` — validates edits with `requirementEditSchema` at the same boundary, applies them as `origin: "assumed"` with `sourceAnswerIds: []` and preserved `originalSourceAnswerIds`, rejects cross-field contradictions via `ProfileValidationError` (carries `issues: RequirementIssue[]`), and deep-freezes the result. Revisions are immutable and chained (`parentRevisionId`).
  - `validateRequirements(requirements): RequirementIssue[]`; `requirementEditSchema` (discriminated by `id`); `requirementDisplayValue`; `REQUIREMENTS_MODEL_VERSION = "expansion-requirements-v1"`.
  - *(Removed 2026-11-14 per user cleanup: `domain/evidence.ts` fact/assessment schemas — no runtime consumer, test-only. Phase 2 will define these when assessments are actually implemented.)*
- `src/features/expansion/frontend/storage.ts` (new section; scenario functions unchanged)
  - `PROFILE_DRAFT_STORAGE_KEY = "restaurantos.expansion.profile.draft.v1"`
  - `decodeProfileDraft(raw): {status:"empty"} | {status:"ok", envelope} | {status:"corrupt", raw, reason} | {status:"unsupported", raw, schemaVersion}` — corrupt/unknown content is never rewritten.
  - `persistProfileDraft(storage, envelope)` (validates, propagates write errors), `resetProfileDraft(storage)`, `currentProfileRevision(envelope)`, `profileDraftEnvelopeSchema` (sequence + parent-chain validated).
- `src/features/expansion/frontend/profile-form.ts`
  - `FormState`, `formFromRevision(revision)`, `buildEdits(form, previousRevision)` (diff-filtered; no-change save emits no edits), `requirementToField`, `changedSummary`, `FORM_LABELS`, `MARKET_OPTIONS`, `FieldIssue`.
- `src/features/expansion/frontend/data/intake-example.ts`
  - `EXAMPLE_INTAKE` (validated clone of `docs/expansion/examples/restaurant-intake.sample.json`), `exampleIntake()` returns a clone.

### Storage keys (Expansion)

| Key | Owner | Contents |
|---|---|---|
| `restaurantos.expansion.profile.draft.v1` | Phase 1 (new) | Versioned profile draft envelope: all immutable revisions, updatedAt |
| `restaurantos.expansion.demo.scenarios.v1` | Existing, unchanged | Legacy demo scenario snapshots |
| `restaurantos.expansion.local.scenarios.v2` | Existing, unchanged | Local dataset scenario snapshots |
| `restaurantos.expansion.mode` | Existing, unchanged | demo/local mode preference |

Tactical storage keys are untouched. `persistProfileDraft` writes only its own key; a test asserts scenario/mode keys survive profile saves.

## Integration and proof ledger

| Integration | Starting foundation | Current verification for new flow | Remaining proof |
|---|---|---|---|
| CoStar local | Existing importer/cache/API code | Untouched by Phase 1; existing importer present | Offered-space city search and actual configured-data path (Phase 2) |
| Deep Agents/model | No new-flow worker implemented | Not verified | Genuine framework dispatch, five specialists, live bounded run (Phase 3) |
| Matterport | Helper fetches basic model metadata | Not verified for new flow | Accessible model, suite association, supported capabilities |
| Vexcel | Helper extracts imagery/checks coverage | Not verified for new flow | Permitted image access/date/site context |
| Neighborhood geography | No new-flow boundary established | Not verified | Sourced Heights definition and version |
| ACS | No new-flow adapter | Not verified | Pinned variables/geography/MOE and actual retrieval |
| Competition source | Provider/display decision pending | Not verified | Permitted storage/map use and actual retrieval |
| Accounts/hosting | No new-flow release setup | Not verified | Isolation, durable worker/data, deployment smoke/restore |

Store only redacted evidence references here. Never paste credentials, restricted records, private screenshots or raw model/provider payloads. A live synthetic model test verifies model/framework wiring, not real restaurant data or property facts.

## Unfinished work and blockers

Phase 1 delivered its code and the checks that can run in this session; the following remain:

- **Browser acceptance/regression gate (`npm run test:e2e`)**: blocked by the session sandbox — Playwright cannot spawn its test workers (`spawn EPERM`), and `next dev` cannot fork its server process for the same reason. The user explicitly chose not to escalate sandbox permissions. The 17-test suite (including the new `profile.spec.ts` journey, keyboard, mobile, corruption and write-failure tests) parses and is enumerated by the runner; it is ready to run in an unsandboxed shell: `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` (system Chrome is installed; no Playwright browser cache exists).
- **`npm test`**: fails in-sandbox with `spawn EPERM` on all 8 file workers (Node test runner spawns per-file children). In-process equivalent with identical files/assertions passes: `node --test --test-isolation=none src/features/tactical/*.test.ts src/features/expansion/*.test.ts` → 88/88 pass.
- **`npm run build`**: compiles successfully (`✓ Compiled successfully`) then fails at the spawned TypeScript worker with `spawn EPERM`. The same TS check passes via `npm run typecheck` (exit 0).
- **Lint**: fails only on 3 pre-existing Tactical errors (`src/features/tactical/domain/analyze.ts:136` prefer-const; `src/features/tactical/frontend/components/analyze-plan.tsx:84` set-state-in-effect and `:358` refs-during-render) plus 4 pre-existing Tactical warnings. The user chose to leave Tactical untouched; the Expansion code added/changed in this phase is lint-clean. Fixing or permitting fixes to those Tactical files would let the gate pass.
- **Python helper/worker/contracts**: not applicable to Phase 1 (no Python changes).
- Live model/framework and live sources/deployment: not applicable to Phase 1; unchanged from Phase 0 status.

These blockers are environmental/ownership, not product defects discovered by the checks. Do not mark them passed without a real run.

## Required handoff template

Append this completed record after each implementation attempt, including partial attempts. Then update the current snapshot, inventory, decisions and integration table above.

```markdown
### Handoff H-00N — YYYY-MM-DD — Phase N — status

- Implementing agent/chat reference and code revision, if available:
- Prerequisite handoffs inspected and discrepancies found:
- Working user path (URL and exact actions):
- Implemented behavior:
- Files added/changed and actual exported contracts/signatures:
- Decisions added/superseded and why:
- Schema/model/API/event versions and backward compatibility:
- Setup/env names, worker/start/test commands and cache migration steps:
- Source modes (profile, properties, enrichment, model execution):

| Check | Exact command/environment | Outcome / exit | Pass/fail/skip counts | Evidence or blocker |
|---|---|---|---|---|
| Lint | | | | |
| Typecheck | | | | |
| Node tests | | | | |
| Build | | | | |
| Browser acceptance/regressions | | | | |
| Python helper/worker/contracts, if applicable | | | | |
| Live model/framework, if applicable | | | | |
| Live sources/deployment, if applicable | | | | |

- Required gates passed:
- Required gates failed/skipped/unrun (exact reasons):
- What is NOT implemented or still incomplete:
- Risks, evidence gaps and coordination needed:
- Phase status and why that status is accurate:
- Next agent: exact files/contracts to consume and first remaining task:
```

## History

### Handoff H-002 — 2026-11-14 — Phase 1 cleanup (unused code and caches removed)

- **User instruction:** delete code that is used only by tests and caches that are not needed for Phases 2–5.
- **Code removed:** `src/features/expansion/domain/evidence.ts` (fact/assessment envelope schemas; its only consumer was `intake.test.ts`; no runtime imports). Its two test blocks were removed from `intake.test.ts`. `seatRangeSchema` in `domain/intake.ts` is no longer exported (still used internally by `spaceSectionSchema`), and `EXAMPLE_INTAKE` in `frontend/data/intake-example.ts` is no longer exported (still used by `exampleIntake()`). No runtime behavior changed.
- **Caches/derived files removed (all git-ignored, regenerable):** `.next/`, `test-results/`, `tsconfig.tsbuildinfo`, `__pycache__/`, root `cache/` and `output/` (Python helper scratch), and under `src/features/expansion/data/data/`: `cache/` (Matterport JSON), `runs/`, `images/` (Vexcel chips), `costar.sqlite` (legacy v2, explicitly not reused), `store.json` (legacy store); plus `src/features/expansion/data/output/restaurants.csv` (legacy one-off export). Kept because they are still needed: the CoStar kit, `data/data/expansion.sqlite` (the imported local dataset), `quickstart/` source index/notebooks, `.venv/`, `.env` files. `data_access.py` inspects but never reads the legacy SQLite as truth; its own cache rebuilds from the kit.
- **Verification after cleanup:** in-process Node suite 86/86 pass (`node --test --test-isolation=none src/features/tactical/*.test.ts src/features/expansion/*.test.ts`), `npm run typecheck` exit 0, lint unchanged (only the 3 pre-existing Tactical errors + 4 warnings; Expansion clean). Production compile re-verified (`✓ Compiled successfully`) before deleting `.next` again. Exact `npm test`/`npm run build`/`npm run test:e2e` remain sandbox-blocked as recorded in H-001.
- **Phase 2 amendment:** H-001's Phase 2 handoff no longer references `domain/evidence.ts`. Phase 2 defines its own fact/assessment contracts (entity scope, exact/ranged/unknown values, pass/fail/unknown/not-applicable with reason codes and evidence IDs) only when candidate assessments are actually implemented, and consumes the unchanged intake/requirements/storage contracts listed in the inventory above.

### Handoff H-001 — 2026-11-14 — Phase 1 — partial

- **Implementing agent/chat reference:** Rain-owned Expansion task executed in the DeepSeek Harness session; repo `hackprinceton2026_restaurantOS` at HEAD `2d31e56` (no pre-existing uncommitted changes).
- **Prerequisite handoffs inspected and discrepancies found:** H-000 claims only documentation existed; the code base actually contains a working Expansion explorer (demo/local modes), scenario storage, CoStar import/map/detail APIs and e2e specs — all reused, not rewritten. Phase 1's required Explorer/Tactical navigation baseline was confirmed present. No prior "passed" gate was accepted without a fresh run.
- **Working user path (URL and exact actions):**
  1. Open `/expansion` → profile gate: “Set up the restaurant profile”.
  2. Click **Use example restaurant** → Cedar Kitchen review: fictional labels, restaurant basics, seven original interview answers with answer IDs, normalized requirements table (hard/soft badges, units, source answers), matching notes, revision history.
  3. Click **Edit requirements** → edit form (occupancy limit, funds, optional reserve, seat range, kitchen/parking must-haves, neighborhoods, market, optional ventilation/baseline follow-ups).
  4. Submit invalid values (reversed seat range, reserve above funds, empty limit, unsupported market) → accessible inline errors plus a focused error summary (`role="alert"`); nothing saves.
  5. Correct → **Save profile draft** → new immutable revision stored; toast confirms save.
  6. Reload the page → the saved revision (including edits and follow-up answers) is restored automatically.
  7. **Continue to the scouting map** → the existing explorer works unchanged (4 demo property cards, Try-opening-here scenario, scenario save/restore); a compact profile strip shows the active revision with an **Edit profile** return path. “Continue to the scouting map” on the start screen also reaches the explorer without a profile.
  8. Corrupt/unknown-version draft content shows a preserved-storage warning; saving stays disabled until an explicit **Reset**; storage write failures keep in-memory edits.
- **Implemented behavior:** versioned intake validation (dangling/duplicate answer IDs, reversed ranges, negative/nonfinite money, contradictory reserve/funds, unsupported currency/market rejection), normalized requirements with the 14 stable IDs (preserving the $5,000 total-occupancy cap, unknown reserve, soft 40–50 seats, hard kitchen/parking, Heights preference, unknown area/parking-count/baseline), immutable frozen profile revisions with parent chains and preserved intake snapshots, diff-filtered edits (`origin: "assumed"`, original answer references retained), resilient versioned draft storage under a new key, profile review/edit/save/restore UI, explorer bridge and profile strip, accessible validation summary, keyboard-focusable flow, mobile layout.
- **Files added/changed and actual exported contracts/signatures:** see “Contracts and runtime inventory” above.
  - Added: `src/features/expansion/domain/intake.ts`, `src/features/expansion/domain/requirements.ts`, `src/features/expansion/domain/evidence.ts`, `src/features/expansion/frontend/profile-form.ts`, `src/features/expansion/frontend/data/intake-example.ts`, `src/features/expansion/frontend/components/profile-workspace.tsx`, `src/features/expansion/intake.test.ts`, `src/features/expansion/profile-form.test.ts`, `src/features/expansion/frontend/e2e/profile.spec.ts`.
  - Changed: `src/features/expansion/frontend/storage.ts` (profile draft section appended; scenario code untouched), `src/features/expansion/frontend/expansion-page.tsx` (profile gate + explorer bridge), `src/features/expansion/frontend/components/expansion-workspace.tsx` (optional profile strip + `Edit profile`), `src/features/expansion/frontend/components/expansion.css` (profile styles, scoped under `.expansion-app`), `src/features/expansion/frontend/e2e/expansion.spec.ts` and `local-dataset.spec.ts` (pass through the new gate before exercising unchanged explorer assertions — equivalent functional behavior, no weakened assertions).
- **Decisions added:** D-015 (profile-first gate with explicit explorer skip), D-016 (immutable revisions, diff-filtered edits), D-017 (explicit unsupported currency/market rejection), D-018 (leave Tactical lint errors untouched; use in-process equivalents — both per explicit user choice).
- **Schema/model/API/event versions and backward compatibility:** intake `schemaVersion "1.0"`; requirements model `expansion-requirements-v1`; evidence `expansion-evidence-v1`; assessments `expansion-requirement-assessment-v1`; draft envelope `schemaVersion 1` under `restaurantos.expansion.profile.draft.v1`. Unknown draft versions and corrupt content are preserved untouched until explicit reset; existing demo/local scenario keys and Tactical storage are not read or written by profile code; existing scenario snapshots remain readable (existing `decodeScenarios` tests still pass).
- **Setup/env names, worker/start/test commands and cache migration steps:** no new env vars or dependencies (Zod/React/Playwright already present); `npm install --cache .npm-cache-local` was used once to restore the missing `@anthropic-ai/sdk` (sandbox blocks writes to the default npm cache; the local cache dir was removed afterwards). Node ≥ 22.18 per `package.json` (session runs v25.9.0). No cache migration needed; draft v1 is the first profile-storage version.
- **Source modes (profile, properties, enrichment, model execution):** profile = fictional example intake (`docs/expansion/examples/restaurant-intake.sample.json`, `isDemo: true`, `origin: "simulated"`, labeled everywhere); properties = existing demo fixture / dated local CoStar snapshot (unchanged); enrichment and model execution = none in Phase 1 (out of scope).

| Check | Exact command/environment | Outcome / exit | Pass/fail/skip counts | Evidence or blocker |
|---|---|---|---|---|
| Lint | `npm run lint` | exit 1 | 0 pass / 3 errors / 4 warnings (all pre-existing Tactical) | Errors: `tactical/domain/analyze.ts:136` prefer-const; `tactical/frontend/components/analyze-plan.tsx:84` set-state-in-effect, `:358` refs-during-render. Warnings in `analyze.ts:86`, `analyze-plan.tsx:373`, `draft-canvas.tsx:3`, `tactical-workspace.tsx:63`. All Expansion files lint-clean. User chose to leave Tactical untouched (D-018) |
| Typecheck | `npm run typecheck` | exit 0 | pass | Clean after removing stale `.next/dev` types and restoring `@anthropic-ai/sdk` (environment repair, no code change) |
| Node tests | `node --test --test-isolation=none src/features/tactical/*.test.ts src/features/expansion/*.test.ts` | exit 0 | 88 pass / 0 fail / 0 skip | Same files/assertions as `npm test`; exact `npm test` is sandbox-blocked: `spawn EPERM` on all 8 file workers (user chose in-process equivalents, D-018) |
| Build | `npm run build` | exit 1 | Compile ✓ / TS worker spawn blocked | `✓ Compiled successfully`, then `spawn EPERM` at the spawned TypeScript worker (sandbox named-pipe restriction). The same TS check passes standalone (`npm run typecheck`) |
| Browser acceptance/regressions | `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` | exit 1 (blocked) | 17 tests enumerated / 0 executed | Runner fails to spawn workers with `spawn EPERM` before any test runs (sandbox); `next dev` itself cannot fork under the sandbox. System Chrome is installed; no Playwright browser cache. Suite includes the new `profile.spec.ts` (journey, invalid-input correction, keyboard-only, mobile overflow, corruption/reset, write failure) and updated explorer/Tactical regression specs |
| Python helper/worker/contracts | n/a | — | — | No Python changes in Phase 1 |
| Live model/framework | n/a | — | — | Phase 3 |
| Live sources/deployment | n/a | — | — | Phases 4–5 |

- **Required gates passed:** `npm run typecheck`; Node unit suite (in-process equivalent, 88/88 — intake schema/round-trip, normalization, revisions/immutability, storage corruption/write-failure/reset/backward-compat, evidence envelope, form helpers).
- **Required gates failed/skipped/unrun (exact reasons):** `npm run lint` fails only on 3 pre-existing Tactical errors the user chose to leave untouched; exact `npm test`, `npm run build` and `npm run test:e2e` cannot execute in this session's sandbox (`spawn EPERM` on child-process pipes for the test runner workers, Next's TypeScript/build workers, and Playwright's runner/dev-server; user chose in-process equivalents over escalation). Browser acceptance therefore remains unexecuted and must not be claimed as passed.
- **What is NOT implemented or still incomplete:** candidate search/requirement assessment (Phase 2), Deep Agents worker (Phase 3), evidence enrichment/investigation/brief (Phase 4), release operations (Phase 5). The explorer's “Monthly base-rent budget” filter is the old scout filter and is not intake-based; no matching engine exists yet. Browser verification is pending a real `test:e2e` run.
- **Risks, evidence gaps and coordination needed:** the new e2e specs are written but unrun (sandbox); the profile UI was verified by typecheck, the compiled production build (compile step), and in-process unit tests of the exact form/validation logic, not by a browser. Coordinating with Asilbek is only needed if the team wants the 3 Tactical lint errors fixed so the lint gate can go green; no shared contracts were changed.
- **Phase status and why that status is accurate:** `partial` — every Phase 1 deliverable is implemented and every check that can run in this session passes, but three gate commands are environment-blocked and one gate fails on pre-existing out-of-ownership errors, so the required gate set is not fully green. Per the runbook, a phase is `complete` only when every required gate passes; no check was weakened or skipped to claim completion.
- **Phase 2 handoff — next agent, exact files/contracts to consume and first remaining task:** consume `src/features/expansion/domain/intake.ts`, `requirements.ts` (14 `REQUIREMENT_IDS`, `SearchRequirements`, `ProfileRevision`, `validateRequirements`, `createProfileRevision`), `frontend/storage.ts` (`decodeProfileDraft`, `persistProfileDraft`, `PROFILE_DRAFT_STORAGE_KEY`) and `frontend/profile-form.ts`. *(H-002 removed `evidence.ts`; see its Phase 2 amendment.)* First remaining task: implement the full-city offered-space search in `backend`/API and assess every candidate against the active profile revision (pass/fail/unknown/not-applicable with reason codes and evidence references, defining those assessment contracts in Phase 2), wiring the explorer's candidate list to those assessments — and re-run the Phase 1 gates (including `npm run test:e2e` in an unsandboxed shell) before trusting the Phase 1 handoff.

### Handoff H-000 — 2026-11-14 — planning documents

- Created five phase specifications with copyable implementation prompts, deliverables, tests, completion gates and handoff rules.
- Deep Agents moved from a later optional framing to a required Phase 3 milestone, following explicit user steering.
- This ledger is initialized with every phase `not_started`; it does not claim the new application flow works yet.
- Only documentation is changed. Application tests, provider calls, worker setup and deployments were not executed for this documentation-only task. Document-link/structure checks are reported in the chat completion; they do not satisfy implementation gates.
- Next agent: read the runbook and Phase 1, inspect current code, implement the profile path, run its tests, then append H-001 with actual results.
