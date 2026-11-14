# Expansion — decisions and implementation handoff

This is the shared implementation ledger for the [five-phase plan](phases/README.md). Every implementing agent reads it before work and updates it before finishing. It records actual state, not hoped-for features. Keep the current snapshot accurate and append history; do not erase earlier failed checks or unfinished tasks.

## Current snapshot

Last updated: 2026-11-14, documentation preparation only.

Next task: execute [Phase 1](phases/01-profile-and-contracts.md) using its copyable prompt.

| Phase | Status | Delivered by this phase | Gate evidence | Remaining |
|---|---|---|---|---|
| 1 — Profile/contracts | not_started | None | Not run | Entire Phase 1 |
| 2 — Search/tools | not_started | None | Not run | Entire Phase 2 |
| 3 — Deep Agents | not_started | None | Not run | Actual worker/planner/five specialists/tools/live proof |
| 4 — Investigation/decisions | not_started | None | Not run | Source adapters, comparison, saved brief |
| 5 — Release/operations | not_started | None | Not run | Accounts, durable deployment, integrated release proof |

The existing repository already contains an Expansion explorer, demo/local modes, CoStar import/map/detail APIs, deterministic scenario helpers, browser-local scenario storage and a separate Python data-access helper. These are reusable foundations, not proof that the new phases are implemented. Existing implementation notes contain historical test reports; this documentation task did not rerun those application checks.

Observed existing configuration: npm scripts provide lint, typecheck, Node tests, build and Playwright; Node tests currently glob only feature-root `*.test.ts`; browser tests are in the Expansion frontend e2e directory. Future agents must inspect current scripts again because repository state can change.

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

Update decisions with a new ID and rationale; if superseded, retain the old row and link its replacement. Do not supersede a user requirement silently. Technology/provider details not yet chosen are proposals until implemented and verified.

## Contracts and runtime inventory

Populate with actual implemented names/signatures, not proposed filenames copied from the plan.

| Area | Current new-flow contract/version | Implemented file(s) | Consumer / migration |
|---|---|---|---|
| Intake/profile revisions | Not implemented | — | Phase 2 onward |
| Requirements/evidence/assessment | Not implemented | — | Search, specialists, UI |
| Citywide candidate search | Not implemented | — | Run service/site scout |
| Callable deterministic tools | Not implemented | — | Python specialist bridge |
| Run/session/auth lifecycle | Not implemented | — | Worker/UI/storage |
| Deep Agents artifacts/events | Not implemented | — | SSE/recovery/brief |
| Brief/storage/migrations | Not implemented | — | Restore/accounts |
| Worker setup/start/test commands | Not implemented | — | Phases 3–5 |

## Integration and proof ledger

| Integration | Starting foundation | Current verification for new flow | Remaining proof |
|---|---|---|---|
| CoStar local | Existing importer/cache/API code | Not checked in this documentation task | Offered-space city search and actual configured-data path |
| Deep Agents/model | No new-flow worker implemented | Not verified | Genuine framework dispatch, five specialists, live bounded run |
| Matterport | Helper fetches basic model metadata | Not verified for new flow | Accessible model, suite association, supported capabilities |
| Vexcel | Helper extracts imagery/checks coverage | Not verified for new flow | Permitted image access/date/site context |
| Neighborhood geography | No new-flow boundary established | Not verified | Sourced Heights definition and version |
| ACS | No new-flow adapter | Not verified | Pinned variables/geography/MOE and actual retrieval |
| Competition source | Provider/display decision pending | Not verified | Permitted storage/map use and actual retrieval |
| Accounts/hosting | No new-flow release setup | Not verified | Isolation, durable worker/data, deployment smoke/restore |

Store only redacted evidence references here. Never paste credentials, restricted records, private screenshots or raw model/provider payloads. A live synthetic model test verifies model/framework wiring, not real restaurant data or property facts.

## Unfinished work and blockers

All five phases are unfinished. No current blocking condition has been demonstrated; provider credentials, source permissions and target deployment access have not been tested by this documentation task. Do not turn “not checked” into “unavailable.”

Future entries must identify: affected gate/task, observed failure, independent work already completed, exact next action, owner if known, and which claims remain unsupported. Preserve explicit unavailable capability behavior without treating it as provider success.

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

### Handoff H-000 — 2026-11-14 — planning documents

- Created five phase specifications with copyable implementation prompts, deliverables, tests, completion gates and handoff rules.
- Deep Agents moved from a later optional framing to a required Phase 3 milestone, following explicit user steering.
- This ledger is initialized with every phase `not_started`; it does not claim the new application flow works yet.
- Only documentation is changed. Application tests, provider calls, worker setup and deployments were not executed for this documentation-only task. Document-link/structure checks are reported in the chat completion; they do not satisfy implementation gates.
- Next agent: read the runbook and Phase 1, inspect current code, implement the profile path, run its tests, then append H-001 with actual results.
