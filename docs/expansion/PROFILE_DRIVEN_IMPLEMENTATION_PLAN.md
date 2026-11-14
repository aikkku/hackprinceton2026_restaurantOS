# Profile-driven Expansion — implementation plan

Date: 2026-11-14. Status: proposed implementation sequence; application behavior is unchanged.

Execution update: use the [five-phase implementation runbook](phases/README.md) and its per-phase AI-agent prompts. [DECISIONS.md](DECISIONS.md) tracks actual progress and handoffs. Those documents replace the eleven-row execution order below. **Deep Agents is a required Phase 3 deliverable**, following the user's explicit priority; it is no longer a stretch integration. This document remains the detailed background/work-package inventory.

## 1. Outcome and scope

An owner reviews a restaurant profile, searches the supported dataset, inspects why each space fits or conflicts, supplies missing evidence, compares opening scenarios, and saves a reproducible shortlist.

Use `examples/restaurant-intake.sample.json` as the initial fictional profile. Keep its interview answers, source-answer references, missing values, and follow-up questions intact. The profile is a requirement source, not evidence about properties.

The complete journey is:

`Review restaurant → Confirm requirements → Scout Houston → Investigate spaces → Compare opening plans → Save decision brief`

Deliver the profile and deterministic local-data tools first, integrate the required Deep Agents workflow in Phase 3, then complete source enrichment and the decision journey before release hardening. Use the same contracts throughout. This plan covers Expansion; operational readiness work inside Tactical remains Asilbek-owned.

Reference inputs: repository guidance, Expansion specs, current implementation, the sample intake, and the supplied three-page PDF excerpt (original pages 5–7). The excerpt describes architecture and tables, not the entire twelve-page specification. Missing pages are not assumed requirements. Recommendations below are proposals, not instructions taken from the attachment.

## 2. Decisions for the first release

| Decision | Implementation |
|---|---|
| Restaurant | Cedar Kitchen, Mediterranean dine-in/takeout; explicitly fictional |
| Market | Houston; Heights preferred, other Houston neighborhoods allowed |
| Monthly limit | $5,000 total occupancy, hard requirement |
| Capital | $100,000 total; reserve and usable opening budget remain unknown |
| Capacity | 40–50 seats, soft preference; no automatic hard area filter |
| Must-haves | Existing kitchen and customer parking; evidence required |
| Search universe | Offered lease spaces in the supplied snapshot, with verified property joins |
| Recommendation wording | Potential matches to investigate, with source dates and verification gaps |
| Core stack | Existing Next.js, TypeScript, Zod, SQLite, MapLibre and h3-js |
| AI responsibility | Interpret profile text and explain supplied evidence/results |
| Numeric responsibility | Pure TypeScript matching, ordering, rent conversion and finance |
| Persistence | Local profiles/runs first; account-backed Supabase later |

The hypothetical profile can be evaluated against real source records. Display profile provenance and property provenance separately: “Example restaurant profile · CoStar local snapshot.” Do not relabel real records as fictional or imply the example restaurant is real.

## 3. User-facing screens

### A. Restaurant brief

Load Cedar Kitchen through a visible “Use example restaurant” action. Present editable sections for concept, expansion goal, target geography, occupancy limit, capital, capacity and must-haves. Let the owner inspect source answers.

Show three nonblocking questions from the sample: emergency reserve, cooking/ventilation needs, and optional financial records. Request the current restaurant address and price level later if home-area similarity or price-fit analysis is enabled. Do not invent them.

“Start scouting” works without financial records. Missing target market, invalid currency/units or contradictory requirements must be resolved before a search. Editing requirements creates a new profile revision; previous runs remain reproducible.

### B. Scouting map and candidate list

Keep the existing map as the main workspace. Add a compact mission: “Find a second Houston location within $5,000/month, with a kitchen and customer parking.”

Search the full supported Houston snapshot on the server. Panning filters the view, not the underlying shortlist. Show total spaces examined, exclusions, unresolved requirements, source coverage and returned results. Counts distinguish spaces from buildings.

Use three candidate groups: “Meets assessed requirements,” “Needs verification,” and “Does not meet requirements.” A snapshot-only result still needs a current-availability check. Explain when no fully verified candidates exist. Never fill a three-card shortlist with fabricated or rejected spaces.

Use H3 colors for a named supported metric, such as candidate count or verification state. Unsupported market suitability stays unscored. Area labels and listing pins remain distinct, with text equivalents and a keyboard-accessible list.

### C. Space investigation

Show one requirement row per candidate: expected value, source value/range, pass/fail/unknown/not-applicable, evidence, date and next verification step. Separate building facts from suite facts.

Include asking-rent basis, additional occupancy charges, kitchen evidence, parking/access rights, capacity estimate if supported, neighborhood evidence, marketing status and availability caveat. Attach Matterport and aerial views only when the source relationship is supported.

Allow a user to record dated verification with a source note, and separately enter planning assumptions. An assumption can enable a scenario; it does not verify a requirement. Preserve conflicting evidence for review rather than silently replacing it.

### D. Compare opening plans

Compare two or three spaces using the same profile revision: requirements, verification gaps, occupancy range, opening cash, required monthly sales, and assumptions. Keep incomplete comparisons usable, with unavailable fields explicit.

Let the owner edit costs, margin, investment and reserves. Missing finance starts blank, or requires an explicit “Use illustrative assumptions” action. Existing generic defaults are not Cedar Kitchen's financial baseline.

### E. Saved decision brief

Save profile revision, dataset identity, candidate/evidence snapshots, assessment/model versions, scenario inputs/results and unresolved questions. Restore without silently substituting refreshed source data. Label saved evidence and offer an explicit refresh/re-evaluation action.

The final brief explains which sites warrant investigation and the next questions to answer. Saving does not contact brokers, lease a space or commit money.

## 4. Contracts and matching engine

Keep new contracts under `src/features/expansion/domain/` until shared contracts are agreed. Define Zod schemas before adapters and screens.

| Contract | Required content |
|---|---|
| `RestaurantIntake` | Versioned sample shape, nullable fields, answer references, provenance |
| `SearchRequirements` | Normalized hard constraints, preferences, units, profile revision |
| `EvidenceFact` | Entity/suite scope, value or range, units, origin, source/date, method and limitations |
| `RequirementAssessment` | Requirement ID, pass/fail/unknown/not-applicable, reason code, fact references |
| `CandidateAssessment` | Space/property IDs, assessed requirements, group, ordering explanation, model version |
| `ExpansionRun` | Profile/dataset versions, status, progress, counts, results, errors, timestamps |
| `DecisionBrief` | Shortlist, evidence snapshots, assumptions, scenarios, unresolved actions |

Validate finite/nonnegative values, ordered ranges, currencies, references and contradictory requirements. Include versioned migrations for saved data. Do not alter existing demo/scenario contracts incompatibly.

### Candidate retrieval

1. Read offered spaces, not the union of buildings and spaces used by the current browsing endpoint.
2. Preserve suite use, marketing status, size/rent ranges and service basis during import. Validate enum meanings against kit documentation before mapping them.
3. Include retail/restaurant-compatible marketed spaces as search candidates; retail use is not proof of restaurant permission. Exclude explicitly incompatible uses, keep unknown-use candidates separately, and retain exclusion reasons.
4. Use active marketing in the dated snapshot as a retrieval criterion, not a current vacancy assertion. Expose excluded off-market counts/reasons.
5. Deduplicate by verified space identity, not address. Multiple suites in one building remain distinct.
6. Evaluate all candidate pages/batches before selecting finalists. Record any intentional scan/enrichment limit and avoid claiming a complete citywide result when capped.
7. Map pagination and viewport bounds affect display only. Current map query endpoints can remain intact for exploration.

### Evaluation rules

| Requirement | Pass | Fail | Unknown |
|---|---|---|---|
| Occupancy ≤ $5,000 | Complete supported total/range has upper bound ≤ $5,000 | Supported lower bound exceeds $5,000 | Missing charges, ambiguous basis, or range crosses limit |
| Existing kitchen | Reliable evidence for the offered suite supports a usable existing kitchen, with limitations shown | Reliable suite evidence establishes absence/incompatibility | Former restaurant, building note, image hint, or no evidence |
| Customer parking | Supported customer access/use evidence | Supported absence or unusable access | Nearby visible stalls without customer-use rights |
| 40–50 seats | Report preference alignment where supported | Record preference mismatch, not hard rejection | No usable dining-area/capacity evidence |
| Heights preferred | Supported neighborhood membership | Other Houston area remains eligible | Boundary/membership unresolved |
| Upfront affordability | Complete costs fit funds after stated reserve | Complete costs exceed usable capital | Reserve, costs or funding incomplete |

Total occupancy must account for rent inclusions before adding taxes/CAM/insurance/other charges, avoiding double counting. Known base rent above the cap can establish failure when additional charges are nonnegative; base rent below the cap cannot establish affordability alone. Preserve ranges instead of taking arbitrary midpoints.

Candidate grouping: any hard failure → does not meet requirements; otherwise any hard unknown → needs verification; otherwise meets assessed requirements. Physical/legal due diligence and current availability remain separately visible.

Initial ordering is transparent and deterministic: assessment group, completeness of hard-requirement evidence, supported neighborhood preference, then comparable known costs; stable space ID breaks ties. Show why a candidate appears first. Unknown geography/cost is not silently assigned an average. Excluded candidates remain outside the recommendation list.

Do not introduce an opaque overall score in this release. Later area scoring uses documented factors, coverage, normalization and model versions; it never overrides a failed hard requirement.

## 5. Data and integration work

| Source | Existing foundation | Work required | Failure behavior |
|---|---|---|---|
| CoStar local kit | Import, SQLite, property/space joins, map/detail APIs | Preserve candidate fields and ranges; add complete-city space search and reason counts | Explicit source failure; no automatic fixture substitution |
| Python helper | Separate retail search and proxy tenancy hints | Reconcile mapping parity; reuse supported extraction logic without maintaining conflicting canonical caches | Hints remain derived, never verified kitchen facts |
| Neighborhood geography | No established neighborhood matching contract | Obtain sourced boundary/lookup, define which Heights boundary is used, version it | Preference unknown; Houston search proceeds |
| Matterport | Basic model metadata and property-level scan links | Verify offered-suite association and permitted metadata/measurement access; optional viewer; measurements where actually supported | Missing/wrong-suite scan leaves capacity/kitchen unresolved |
| Vexcel | Aerial extraction and coverage handling | Associate imagery, date and parcel/site context; optionally derive visible stalls/patio/frontage observations | 403/no coverage/occlusion produces unavailable observations |
| ACS | Not integrated | Select a documented release, variables and geography; retain margins of error and aggregation method | Demographics unavailable; candidate search continues |
| Competition source | Not integrated | Select licensed source and explicit same-cuisine taxonomy/search coverage | Competition unavailable; no neutral fabricated score |
| User documents/verification | Not integrated | Minimal private upload/entry workflow, scope/date/source and review states | User assumptions remain distinct from verified facts |

Matterport-derived seats require measured usable dining area plus an explicit planning assumption. A seat-density estimate is not a code-approved occupancy limit. Cedar Kitchen's seat target is soft.

Vexcel vision can propose visible parking counts; it cannot establish customer rights, shared-lot allocation, accessibility compliance, or space ownership. No hard rejection based solely on an unreviewed vision count, especially since this intake supplies no numeric parking minimum.

Market enrichment is a separate milestone. The sample lacks a precise current address and price level, so “looks like home” and price-matched demand cannot be calculated yet. ACS values are estimates for Census geographies; any tract-to-H3 allocation must be documented as a derived approximation, never measured hex-level demand. Restaurant density is not measured sales demand.

External integration gates:

- Google Places has storage/display restrictions, including Google-map requirements for results displayed on a map. Resolve allowed use of raw and derived data before integrating it into MapLibre; alternatives are a compatible provider or a separately scoped map change. Do not assume aggregation removes restrictions. [Official Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).
- ACS provides tract/block-group estimates with estimate/margin-of-error fields. Pin a release instead of automatically mixing vintages. [Official ACS API documentation](https://www.census.gov/data/developers/data-sets/acs-5year.html).
- Check actual CoStar/Matterport/Vexcel access, coverage and permitted storage/model processing. Existing helper code and presence of environment variable names are not proof of working access. Do not send restricted records or imagery to an external model without a permitted-use basis.

## 6. Finance and readiness

Reuse existing deterministic rent and scenario functions; extend with nullable completeness checks and explicit ranges where needed.

- Monthly occupancy = base rent + additional charges not already included.
- Usable opening funds = total funds − protected reserve, only once reserve is specified.
- Opening cash required = build-out + equipment + deposits + fees + other one-time costs + initial working capital, with no duplicated categories.
- Funding gap = max(0, opening cash required − usable opening funds), when complete.
- Required monthly sales = monthly fixed costs / contribution margin, for a positive, explicitly supplied/derived margin.
- Required guests/day = required monthly sales / average spend / operating days, only when all inputs exist.
- Optional assumed revenue = seats × turns/day × average spend × operating days. Every input and the output remain a scenario, not a demand forecast.

Do not infer profit/payback from the intake alone. Existing payback remains conditional on positive contribution after fixed costs, with formula limitations displayed. Add useful rent/margin sensitivity rather than forecast certainty.

Initial readiness is a completeness summary: what is known, missing and needed for a decision. The finance specialist can consume an agreed Tactical report later; it does not independently invent a readiness score or edit Tactical modules. Searching remains possible while readiness/financial data is incomplete.

## 7. Backend and proposed APIs

### First release

Next.js remains the application backend; SQLite remains the local source cache. Implement a run service with persisted run metadata/results and server-side batches rather than computing the shortlist from the first map response. Bound inputs and work, support cancellation/retry, redact errors, and preserve partial results. Keep private run data in ignored storage with explicit retention.

Proposed additive endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /api/expansion/intake/validate` | Validate profile and return requirements/follow-ups |
| `POST /api/expansion/runs` | Create a run from an explicit profile revision and data mode |
| `GET /api/expansion/runs/:id` | Read status, stage counts, completeness and errors |
| `GET /api/expansion/runs/:id/candidates` | Paginated assessments, including rejected group |
| `POST /api/expansion/runs/:id/cancel` | Cancel bounded work and preserve completed results |
| `POST /api/expansion/assessments` | Re-evaluate a candidate using validated added facts/assumptions |

Profile drafts and saved briefs can remain browser-local in the first release; the run request carries a validated snapshot. Scope run retrieval to a local session. Introduce authenticated ownership and tenant isolation before multi-user deployment. Existing markets/query/detail APIs continue serving the current explorer.

Run states: queued, running, completed, completed_with_gaps, failed, cancelled. Stage states distinguish pending, running, succeeded, unavailable, failed and skipped. Completion means the requested analysis finished, not that a suitable space exists. Core matching must work without AI.

### Required specialist-agent milestone (Phase 3)

Implement a Python Deep Agents worker behind a narrow service boundary only after the deterministic slice works. It reuses `data_access.py` for permitted provider access. Next.js owns the browser-facing interface; the worker does not become a second source of canonical math.

| Role | Allowed responsibility | Output |
|---|---|---|
| Planner | Schedule bounded steps, track dependencies/retries | Run plan/status |
| Readiness specialist | Identify missing inputs; summarize an agreed Tactical report | Completeness/follow-up report |
| Market analyst | Retrieve supported demographic/competition evidence | Sourced factors and coverage |
| Site scout | Invoke deterministic candidate search | Candidate IDs and rejection reasons |
| Space inspector | Associate supported scan/imagery observations with suites | Scoped evidence and verification tasks |
| Finance specialist | Invoke TypeScript calculation service; explain results | Validated scenarios and caveats |

Python and TypeScript exchange versioned JSON contracts; add cross-language contract fixtures. Do not duplicate finance/scoring in Python or let an LLM change constraints silently. Profile changes require a user-visible revision.

Virtual files such as `profile.json`, `candidates.json`, `inspection.json` and `finance.json` are run-scoped working artifacts, not a substitute for validated persisted results. Give tools allowlisted, bounded access, not unrestricted shell/filesystem authority. Treat source text as data rather than executable instructions.

Stream actual stage/tool events through an additive run-events endpoint (SSE). Record event sequence IDs for reconnects. Expose operational summaries rather than hidden reasoning. Enforce timeouts, limited retries, bounded concurrency/call budgets, cancellation and duplicate-run protection. Use redacted tracing; keep private source payloads out of external traces by default.

Deep Agents supports specialized subagents and tracing/streaming patterns; pin and verify versions during implementation. This plan does not require every role to execute on every run. [Official Deep Agents documentation](https://docs.langchain.com/oss/python/deepagents/subagents).

## 8. Work-package inventory and acceptance gates

These eleven rows describe work packages, not eleven phases. Follow the [five-phase runbook](phases/README.md) for execution order: profile; search/tools; required Deep Agents; investigation/decisions; release/operations. Deep Agents precedes full enrichment and release hardening. Rows below remain useful for tracing feature scope and acceptance criteria.

| Order | Deliverable | Main locations | Acceptance gate |
|---|---|---|---|
| 1 | Profile and requirement schemas | `domain/intake.ts`, `domain/requirements.ts`, focused tests | Sample parses; hard/soft/null distinctions and answer references preserved |
| 2 | Candidate ingestion/search | `backend/local-dataset.ts`, new `backend/candidate-search.ts`, backend tests | Offered-space-only city search; ranges/status/use preserved; stable deduplication; complete counts |
| 3 | Deterministic assessments | New `domain/matching.ts`, `domain/evidence.ts`, tests | Pass/fail/unknown cases correct; explanation codes; no false affordability/kitchen passes |
| 4 | Profile-first UI and run APIs | New profile/run components and routes; existing expansion page/workspace | Example profile → full Houston search → candidate list/map; source/error/empty states work |
| 5 | Investigation and scenarios | Requirement inspector, `domain/scenario.ts`, scenario/compare UI | Verification and assumptions separate; $5,000 all-in limit; incomplete reserve/finance visible |
| 6 | Save/restore and QA | `frontend/storage.ts`, new brief schema, Node and Playwright tests | Reproducible profile/candidate/scenario snapshots; old saves readable; local release ready |
| 7 | Matterport/Vexcel enrichment | Provider adapters and investigation UI | Real permitted calls, suite association checks, explicit coverage gaps; no invented measurements |
| 8 | Neighborhood/market context | Geography/ACS/competition adapters and local scoring model | Supported geography, missing current-address inputs handled, policy-compatible display, evidence coverage |
| 9 | Planner/specialists and live progress | Isolated Python worker, run-events adapter, contract tests | Tool-backed execution, validated outputs, bounded retries, AI outage leaves core flow usable |
| 10 | Accounts and deployable service | Supabase migrations/repositories, auth, deployment configuration | Owner isolation, persistent private source access, worker lifecycle, recovery and restore verified |
| 11 | Optional channels/tracks | Scoped integration modules | Nessie/Photon/MCP/tracing integrations demonstrated separately; sponsor criteria verified |

For milestone 10, keep SQLite on a persistent private host or replace its adapter with an approved server-side database import. A local ignored dataset will not automatically exist on Vercel, and ephemeral files are not durable run storage. Use a worker/queue appropriate to deployed execution limits. No public redistribution of restricted records is implied by hosting the UI.

Nessie remains labeled sandbox finance and needs coordination with Asilbek. Photon alerts require actual messaging integration, opt-in, a permitted refreshable listing source and deduplication. Broker email/text preparation is optional; sending requires a separate explicit user action. SDK/API adapters are sufficient initially; MCP is added only for tools that need it. Sponsor names do not constitute completed integrations.

## 9. Verification plan

Focused unit/integration tests must cover:

- Sample intake parses; null reserve stays null; seats remain soft; malformed references/contradictory ranges fail.
- Base rent $4,500 with unknown extras → affordability unknown; $4,500 + $700 additional charges → fail; $4,000 + fully enumerated $800 extras → pass, subject to evidence freshness.
- No double counting included service charges; rent periods/area/ranges and unknown currencies handled correctly.
- Missing kitchen evidence and a former-food-tenant hint both remain unknown; building evidence does not verify a suite.
- Visible parking does not verify customer access; no numeric minimum is invented.
- Heights preference never rejects the rest of Houston; unresolved boundaries remain explicit.
- Offered-space-only retrieval, source joins/status/use mapping, all-page evaluation, duplicates and count semantics.
- Same inputs/versions yield the same assessments/order; map movement does not alter the citywide shortlist.
- Missing reserve/financial baseline produces incomplete results, not default profitability; zero margin and missing rent are handled.
- Provider timeout, unavailable imagery, AI failure, cancellation and replay preserve accurate statuses/results.
- Mixed provenance, saved-version migration, corrupted storage and source refresh maintain evidence integrity.
- Agent outputs cannot reference nonexistent evidence or manufacture numeric assessments.

Browser acceptance path:

1. Load the fictional Cedar Kitchen profile and inspect the seven interview answers.
2. Confirm $5,000 is total occupancy and capacity is a preference.
3. Start Houston search without answering nonblocking questions.
4. Inspect a candidate's pass/fail/unknown requirements and source evidence.
5. Pan the map and verify the citywide result set remains stable.
6. Add an explicit planning assumption, compare two scenarios, inspect formulas.
7. Save/reload/restore; revise profile and re-run without overwriting prior evidence.
8. Repeat keyboard-only and mobile; exercise source failure, no matches and no verified matches.

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and relevant `npm run test:e2e` coverage for implementation milestones. Run Python helper/worker tests when those modules change. Use synthetic records in committed tests; optional real-data tests require the private configured cache. Report actual results, skips and unrun checks rather than inheriting historical test claims.

## 10. Dependencies, ownership and first handoff

Rain owns this implementation under Expansion and its routes/docs. Asilbek coordination is required only when finalizing restaurant identity/shared evidence contracts, consuming Tactical readiness, sharing financial primitives or changing global UI. The first release can use Expansion-local contracts and existing tokens without waiting for those agreements.

Outreach teammates supply real owner consent, operational needs and permitted evidence. Engineering proceeds using the fictional sample and labeled synthetic integration fixtures; real-data source failures never become synthetic success.

The main evidence dependencies are usable occupancy-charge quotes, kitchen/parking verification, sourced Heights boundaries, suite-level scan associations, permitted aerial/model access, and optional current-location/financial inputs. None should block the initial search; each blocks only the claims that depend on it.

First implementation handoff: [Phase 1 — profile and contracts](phases/01-profile-and-contracts.md). Every phase delivers a working slice, runs its specified checks and updates [DECISIONS.md](DECISIONS.md). The integrated agent-backed decision journey is delivered across Phases 1–4; Phase 5 supplies release hardening and deployment proof. Required gates cannot be silently deferred into optional work.
