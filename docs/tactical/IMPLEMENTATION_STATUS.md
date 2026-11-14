# Tactical — current implementation and remaining work

**Reviewed:** 2026-11-14. **Scope:** Asilbek's Tactical module, its routes, data, calculations, tests, and integration boundaries. This inventory describes the current working tree, including uncommitted work; it is not a statement that these changes have been committed, pushed, or deployed.

**Product target:** [Product refinement brief](PRODUCT_REFINEMENT_BRIEF.md). **Architecture map:** [repository structure](../../STRUCTURE.md). **Navigation guide:** [pages](PAGES.md). **Manual demo:** [walkthrough](FRONTEND_WALKTHROUGH.md).

This is the canonical implementation inventory and backlog. Product specifications describe intended behavior; this file records what the code actually does. Update this inventory when a feature ships, and include the verification that justifies changing its status.

## Contents

1. [Product snapshot](#1-product-snapshot)
2. [Architecture and code ownership](#2-architecture-and-code-ownership)
3. [Data sources and persistence](#3-data-sources-and-persistence)
4. [Floor Plan](#4-floor-plan)
5. [Scenarios and saved decisions](#5-scenarios-and-saved-decisions)
6. [Photo analysis](#6-photo-analysis)
7. [Customer Reviews and Social Media](#7-customer-reviews-and-social-media)
8. [Financial Intelligence](#8-financial-intelligence)
9. [HR](#9-hr)
10. [Supply Management](#10-supply-management)
11. [AI Assistant and contextual AI](#11-ai-assistant-and-contextual-ai)
12. [Integrations and Expansion coordination](#12-integrations-and-expansion-coordination)
13. [Reliability, accessibility, and technical debt](#13-reliability-accessibility-and-technical-debt)
14. [Implementation sequence](#14-implementation-sequence)
15. [Verification and acceptance journeys](#15-verification-and-acceptance-journeys)
16. [Decisions and data still needed](#16-decisions-and-data-still-needed)
17. [Definition-of-done checklist](#17-definition-of-done-checklist)

## 1. Product snapshot

RestaurantOS currently provides a **working browser-local restaurant layout and capacity simulator**, surrounded by customer-feedback and business dashboard demos. The six sections exist. They are not yet a unified operating system backed by imported business records.

### Status vocabulary

| Status | Meaning |
| --- | --- |
| Working | The behavior is implemented; the scope and verification are stated below. It may still use demo inputs. |
| Partial | A useful portion works, but important requirements or connections are missing. |
| Demo | Fictional records or pre-authored content support the interface. This does not imply live data or AI. |
| Implemented, live unverified | Provider code exists, but a successful real-provider request has not been verified in this work. |
| Missing | No usable implementation of the requested capability was found. |
| Intentionally deferred | The brief explicitly keeps this out of the current build, or makes it conditional. |

### Six-section overview

| Section | Current status | Strongest implemented capability | Largest remaining gap |
| --- | --- | --- | --- |
| Floor Plan | Working foundation; partial target | Manual geometry, named saved configurations, baseline, contextual heuristics | Operational data, richer physical semantics, evidence-linked AI, polished object art |
| Customer Reviews & Social Media | Demo analytics | Search, rating/theme aggregation, cited mission reviews | Authorized imports, text interpretation, time/source/dish analysis, social relationships |
| HR | Demo | Eight-person roster, schedule and profiles | Synthetic pay/contact/availability data, labor calculation, job-post draft concept |
| Supply Management | Demo | Inventory filters, stock indicators, supplier directory | Derived stock status, estimated costs and consistent restock summary |
| Financial Intelligence | Partial demo | Financial tabs, sample pricing and capacity slider | Validated ledger, channel costs, pricing models, reconciled dashboard, saved finance scenarios |
| AI Assistant | Intentionally deferred | Clearly inactive placeholder | No full chat is required now |

**Do not currently claim:** production accounting, real customer sentiment analysis, automated space optimization, observed seating preference, legal/safety compliance assessment, live banking, CoStar interior geometry, Arlequin network analysis, or a functioning restaurant-wide assistant.

## 2. Architecture and code ownership

### Current route structure

| Route | Actual behavior |
| --- | --- |
| `/` | Redirects to `/tactical`. |
| `/tactical` | Floor Plan, layout library, insights, expandable photo editor, inline scenarios and saved comparisons. |
| `/tactical/reviews` | Customer Reviews & Social Media section; current contents are review analytics only. |
| `/tactical/hr` | Fictional team directory and schedule. |
| `/tactical/supply` | Fictional inventory and suppliers. |
| `/tactical/finance` | Overview, transactions, menu pricing and simulator tabs. |
| `/tactical/ai` | Advisor placeholder. |
| `/tactical/scenarios`, `/tactical/decisions`, `/tactical/analyze` | Compatibility redirects to `/tactical`; no additional top-level experience. |
| `POST /api/tactical/analyze` | Server entry point for photo analysis. |
| `/expansion` | Rain-owned module, reached through shared workspace navigation. |

[Tactical layout](../../src/app/tactical/layout.tsx) mounts the feature once. Section `page.tsx` files supply metadata and generally return `null`. [TacticalWorkspace](../../src/features/tactical/frontend/components/tactical-workspace.tsx) uses the pathname to hide/show mounted panels. This preserves in-memory edits across internal navigation. These are distinct URLs, but not independently mounted feature screens or lazy-loaded bundles.

### Code responsibility map

| Location | Current responsibility | Reuse/extend for |
| --- | --- | --- |
| [frontend/tactical-page.tsx](../../src/features/tactical/frontend/tactical-page.tsx) | Validates static restaurant fixture and displays fixture errors | Loading a validated selected restaurant dataset |
| [frontend/components/tactical-workspace.tsx](../../src/features/tactical/frontend/components/tactical-workspace.tsx) | Layout/history, navigation, library mutations, scenario snapshots, browser storage coordination | Keep orchestration here initially; extract cohesive hooks as behavior grows |
| [domain/schemas.ts](../../src/features/tactical/domain/schemas.ts) | Layout, fixture, review, assumption and scenario validation | Backward-compatible schema additions and provenance |
| [domain/layout.ts](../../src/features/tactical/domain/layout.ts) | Palette, meter/feet conversion, footprints, placement, overlaps, seat counts | Geometry only; no AI or network access |
| [domain/layout-library.ts](../../src/features/tactical/domain/layout-library.ts) | Named-library schema, metrics and rule-based insights | Configuration comparison and explicit heuristic definitions |
| [domain/scenario.ts](../../src/features/tactical/domain/scenario.ts) | Seating/turnover math and snapshot reproducibility | Canonical deterministic capacity calculations |
| [domain/reviews.ts](../../src/features/tactical/domain/reviews.ts) | Counts supplied themes, rating distribution and filtering | Imported review aggregation, after schema extension |
| [domain/analyze.ts](../../src/features/tactical/domain/analyze.ts) | Photo draft/request schemas, rotation, checks | Validated photo interpretation and conversion boundary |
| [frontend/storage.ts](../../src/features/tactical/frontend/storage.ts) | Legacy layout and scenario reads/recovery | Centralize library persistence here or in a dedicated frontend repository |
| [frontend/analyze-lessons.ts](../../src/features/tactical/frontend/analyze-lessons.ts) | Photo correction differences and browser-stored prompt lessons | Honest correction-memory behavior, not model training |
| [backend/analyze.ts](../../src/features/tactical/backend/analyze.ts) | Anthropic request, fallback and corrective pass | Existing server AI adapter foundation |
| [frontend/components/state-button.tsx](../../src/features/tactical/frontend/components/state-button.tsx) | Opts stateful buttons out of browser disabled-state restoration | Retain for dynamic controls and hydration consistency |
| Component CSS and [globals.css](../../src/app/globals.css) | Tactical styling and root tokens | Extend the established visual language |

### Boundaries to preserve

- Tactical UI/browser storage belongs in `frontend/`; pure validation/calculation belongs in `domain/`; secrets/provider calls/server persistence belong in `backend/`.
- Root API routes should be thin entry points. There is no need for a second backend application.
- Rain owns `src/features/expansion/`. Do not move Tactical implementation into his module.
- Shared schemas are still a [proposal](SHARED_CONTRACT_PROPOSAL.md), not an agreed contract. Coordinate entity/provenance/handoff changes before promoting local types.
- Installed UI technology is React/SVG, CSS, Geist and Lucide. Tailwind, shadcn/ui and Recharts are not installed dependencies in the inspected package manifest. They are preferences in the brief, not completed infrastructure or a reason to rewrite working UI.
- No runtime architecture refactor is performed by this documentation review.

## 3. Data sources and persistence

### Where current business data actually lives

| Dataset | Source | Origin and limitation |
| --- | --- | --- |
| Restaurant profile, starting geometry, three reviews, one mission, default assumptions | [demo-restaurant.json](../../src/features/tactical/frontend/data/demo-restaurant.json) | Explicit fictional demo; Zod validated |
| Manual layout alternatives | User edits and browser layout library | User-entered geometry, not independently verified measurements |
| Financial history, ten transactions, eight menu items, three competitors | Constants in [finance-page.tsx](../../src/features/tactical/frontend/components/finance-page.tsx) | Hardcoded examples; not a normalized financial source |
| Eight employees and schedules | Constants in [hr-page.tsx](../../src/features/tactical/frontend/components/hr-page.tsx) | Fictional, not payroll or real staff records |
| Fifteen inventory records and eight suppliers | Constants in [supply-page.tsx](../../src/features/tactical/frontend/components/supply-page.tsx) | Fictional; labels and thresholds are not consistently derived from one rule |
| Photo sample and blank plan | Constants in [analyze-plan.tsx](../../src/features/tactical/frontend/components/analyze-plan.tsx) | Separate synthetic examples |
| No-key photo fallback | `MOCK_PLAN` in backend photo handler | Synthetic, explicitly returned as `source: demo` |
| Photo corrections/lessons | Browser storage | Feedback appended to later prompts; no fine-tuning |

**Gap:** the requirement to make mock data easy to edit in a separate file is only fulfilled for the core restaurant fixture. Changing its profile name does not update hardcoded Juniper Table labels across all supporting pages. There is no restaurant picker or editable restaurant-profile workflow.

### Current storage contracts

| Record | Storage key/persistence | Important behavior |
| --- | --- | --- |
| Legacy single layout | `restaurant-os:tactical:<id>:layout:v1` | Retained for migration; newer library saves do not update this legacy key |
| Named layout library | `restaurant-os:tactical:<id>:layouts:v1` | Version 1; active/baseline IDs; 1–50 entries; validated before writes |
| Scenario snapshots | `restaurant-os:tactical:<id>:scenarios:v1` | Layout, inputs, results and evidence saved independently of library |
| Photo lessons | `restaurant-os:tactical:analyze:lessons:v1` | Global to Tactical browser storage, not restaurant-scoped |
| Photo correction records | `restaurant-os:tactical:analyze:mistakes:v1` | Global to Tactical browser storage; limited recent history |
| Unsaved layout edits, current photo plan, photos and page form state | React memory | Lost on reload unless explicitly saved/exported through the supported flow |

Library migration loads the old valid draft into a new in-memory library and persists on the next explicit write. A corrupt library is preserved and writes are disabled. Scenario recovery retains valid snapshots alongside invalid entries and reports an issue. There is no account, database, cloud sync, automatic conflict resolution, or browser-storage backup service.

### Data foundation backlog

- [ ] **DATA-01 · P0:** Move all mock business records into editable fixture files with a clear manifest or a single expanded fixture. Add schemas before components consume them.
- [ ] **DATA-02 · P0:** Introduce a Tactical-local restaurant dataset boundary; pass identity into HR, Supply and Finance instead of embedding names.
- [ ] **DATA-03 · P0:** Define source metadata: source ID, origin, demo flag, capture date, dataset ID/version, currency/unit, permission context where relevant.
- [ ] **DATA-04 · P0:** Keep observed records, manual assumptions and simulated projections distinct in schemas and UI.
- [ ] **DATA-05 · P1:** Persist authorized imported datasets separately from demo records; allow reset/export without silently deleting unrelated work.
- [ ] **DATA-06 · P1:** Define multi-tab conflict handling, storage failure recovery and a user-facing library export/restore flow.
- [ ] **DATA-07 · Later backend:** Account/workspace ownership, database migrations and access policies only when moving beyond browser-local use.

**Acceptance:** changing the selected fixture changes identity and relevant data across all six sections; invalid fixtures fail visibly; imports cannot silently masquerade as demo or overwrite saved evidence.

## 4. Floor Plan

**Priority: P0. Status: working editing/persistence foundation; partial analytics and presentation.**

### Implemented

- Rectangular top-down SVG room; default fixture is 12 × 7.5 m, with 23 seats and 6 tables.
- Demo template, blank working plan, saved-draft reopening and named alternatives.
- Add, select, drag, nudge, rotate, duplicate and delete objects.
- Palette: tables for 2/4, booth, counter, kitchen zone, door, divider, plant, chair, wall, window, lighting, decoration, AC and custom object.
- Editable dimensions, position, rotation, name and description. Seating objects carry seat counts.
- Meter-based geometry with feet entry/display, 0.25 m snap, zoom and scroll/pan.
- Furniture list and numeric inspector support keyboard workflows; Alt+arrow nudges from the selector.
- Bounds checks prevent invalid main-editor placement and invalid room resizing; overlapping footprints are flagged.
- Undo/redo, reset to editing checkpoint, explicit draft save and unsaved-layout confirmation.
- Versioned JSON import/export with validation, restaurant ownership checks and a 1 MB import limit.
- Named library: rename, duplicate, switch, delete with confirmation and mark baseline.
- Comparison of saved seat counts, room area per seat and monthly revenue change relative to the selected baseline.

Sources: [canvas](../../src/features/tactical/frontend/components/floor-plan.tsx), [inspector](../../src/features/tactical/frontend/components/layout-inspector.tsx), [library UI](../../src/features/tactical/frontend/components/layout-library.tsx), [geometry](../../src/features/tactical/domain/layout.ts).

### What the current behavior means

- A custom object is a manually named/described generic footprint. Natural-language object generation and AI categorization are not implemented.
- New object categories use simple vector primitives; they do not yet have distinctive, polished sprites.
- Table graphics represent their object type; changing the seat count does not necessarily redraw the matching number of chairs.
- Standalone chairs add capacity independently. Adding them around a table that already includes seats can double-count capacity; seat ownership is not modeled yet.
- Windows, walls and AC units are regular floor objects. There are no wall attachments, ceiling layers, airflow directions or circulation-path semantics.
- Duplicate copies a **saved** configuration. Save current edits first; switching actions can discard unsaved edits after confirmation.
- Editing checkpoint, active configuration and scenario baseline are different concepts. Reset returns to the editing checkpoint; it does not necessarily select the business baseline.
- The comparison uses saved versions, not every unsaved draft edit. Area/seat includes kitchen and all other room space; it is not measured clearance or comfort.

### Insights implemented today

The deterministic rule finds seating centers within 2 m of AC, windows, doors or kitchen zones. Overlapping footprints produce separate findings. Findings carry object IDs, explanations and either `Suggestion` or `Potential problem`. Clicking one selects its first object and scrolls to the editor. Results are capped at 20.

There is no live AI analysis, review-to-object matching, automatic proposed-layout preview, observed table utilization, or evidence-supported critical/safety classification. Gray/yellow/red severity styling is not a complete three-level card system yet.

### Floor Plan backlog

- [ ] **FP-01 · P0:** Clarify custom-object creation: description-first form, editable category/name/dimensions, manual placement. Optional AI suggestions must remain estimates.
- [ ] **FP-02 · P0:** Define seat ownership so table seats and standalone chairs cannot accidentally double-count. Migrate existing layouts compatibly.
- [ ] **FP-03 · P0:** Make active layout, unsaved draft, baseline and saved comparison labels unambiguous. Verify baseline seat edits refresh new scenario defaults consistently.
- [ ] **FP-04 · P1:** Add physical semantics only where useful: wall/window anchoring, optional ceiling objects and user-described service paths.
- [ ] **FP-05 · P1:** Add minimum spacing/clearance metrics with explicit geometric definitions. Do not label them code compliance.
- [ ] **FP-06 · P1:** Provide Spacious/Balanced/Higher-density comparison labels as user preferences, not AI aesthetic scores; show known costs and unknown comfort evidence.
- [ ] **FP-07 · P1:** Add measured operational records and a source panel: arrivals, occupancy, table assignment and actual service intervals where supplied.
- [ ] **FP-08 · P1:** Join interior-review evidence to object/area hypotheses; expose uncertainty and missing observations.
- [ ] **FP-09 · P1:** Add contextual finding cards with supported severity, all affected-object highlights, proposed-change preview and explicit apply/reject.
- [ ] **FP-10 · P2:** Improve new object art, floor composition, library density, mobile controls and restrained motion without replacing the SVG editor.
- [ ] **FP-11 · P1:** Library-level backup/import, useful capacity-limit messages and corruption recovery UI.

**Acceptance:** create “Current Restaurant,” duplicate “Comfortable Dining,” change AC/custom metadata, compare both, preview an action, save, reload, and recover all geometry/metadata without altering the original configuration. Capacity must have a documented seat-count convention.

### Operational analytics boundary

POS payment timestamps do not establish dining duration. Aggregate busy-times information does not establish exact arrivals or individual table behavior. Do not populate unavailable metrics with estimates disguised as observations. Dining duration needs appropriate start/end records; revenue per occupied seat needs aligned revenue, occupancy and time windows.

## 5. Scenarios and saved decisions

**Priority: P0. Status: working deterministic seating and turnover models.**

### Implemented

- Inline Floor Plan forms; no independent scenario navigation item.
- Named seating and turnover experiments, editable baseline capacity, turns, occupancy, average check, operating days, contribution margin and investment.
- Preview additional daily covers, monthly revenue, monthly contribution and simple payback.
- Seating previews block when the working layout has overlaps.
- Changed inputs mark a preview stale and prevent saving until recalculated.
- Save/open/delete browser snapshots; old seating snapshots remain readable.
- Snapshot validation and numeric recomputation reject incompatible or tampered results.
- Two-scenario comparison with assumptions, outputs, model version and evidence; differing assumptions are called out.
- Analysis dialog contains formulas, assumptions, limits, cited reviews and occupancy sensitivity at ±10 percentage points, capped at 0–100%.

### Canonical formulas already implemented

```text
seating daily cover change = (draft seats − baseline seats) × turns/day × occupancy
turnover daily cover change = baseline seats × (target turns − baseline turns) × occupancy
monthly revenue change = daily cover change × average check × operating days
monthly contribution change = monthly revenue change × incremental contribution margin
simple payback = investment / monthly contribution change
```

Payback is available only when additional covers and monthly contribution are positive and the result is finite. These are incremental what-if models, not observed revenue forecasts, gross profit, net profit or statistical confidence intervals. They assume enough demand and exclude several fixed/financing/tax/displacement constraints.

### Remaining

- [ ] **SC-01 · P0:** Give Floor Plan and Finance an explicit common assumption context; changing a scenario currently does not change Finance defaults.
- [ ] **SC-02 · P0:** Preserve the baseline identity/version as well as numeric snapshot inputs when linking saved configurations to scenarios.
- [ ] **SC-03 · P1:** Persist/discard unsaved scenario forms intentionally; layout leave-warning alone does not cover all scenario work.
- [ ] **SC-04 · P1:** Add pricing, delivery cost, renovation and break-even models only after their data contracts exist.
- [ ] **SC-05 · P1:** Tie each scenario to its actual dataset and evidence set, rather than always using the fixture's seating mission.
- [ ] **SC-06 · P1:** Harden read-failure/write behavior and multi-tab updates so recovery never silently replaces valid saved work with an empty collection.
- [ ] **SC-07 · Later:** Decision status, realized outcomes and shared/server history.

**Acceptance:** change assumptions in one well-defined context, compare alternatives with those exact inputs, save and reload reproducible results; changing the baseline must not rewrite historical results.

## 6. Photo analysis

**Priority: supporting Floor Plan feature. Status: demo/manual editor works; live AI path implemented but unverified.**

### Implemented

- Expandable Floor Plan section with separate photo editor.
- Up to ten photos; browser resizing to maximum 1280 px and JPEG encoding.
- Optional entrance/bar/cashier wall facts, table counts, spacing and notes.
- Standard/high provider model paths; the API key remains server-side.
- Bounded Zod request fields, structured draft validation and invalid-import rejection.
- No-key fallback explicitly says photos were not analyzed and returns `source: demo`.
- AI result handling, error messages, geometric checks and optional corrective pass.
- Sample/blank plan, table and fixture editing, whole-plan rotation, undo/redo, SVG/PNG/JSON export.
- Selection, duplicate-ID, undo-per-drag and entrance-rotation fixes.
- Correction differences generate reusable prompt lessons stored in the browser.

Sources: [photo UI](../../src/features/tactical/frontend/components/analyze-plan.tsx), [canvas](../../src/features/tactical/frontend/components/draft-canvas.tsx), [schemas/checks](../../src/features/tactical/domain/analyze.ts), [backend](../../src/features/tactical/backend/analyze.ts).

### Important limitations

This is a second representation: approximate feet, `tables`/`fixtures`/`door`, separate from the main meter-based `Layout.objects`. Exported photo JSON is not a main-editor layout file. There is no conversion/apply action, calibration workflow, saved named photo library or automatic restoration of the current photo draft.

“Teach it” stores text for future prompts; it does not train the model. Lesson storage is not restaurant-scoped, and storage failures are swallowed by its helpers. Editing dimensions marks objects verified in code, but that should not be interpreted as independent measurement verification.

The provider response is parsed/normalized and then validated; this is not a fully reusable provider-independent structured-output service. Schema validity does not guarantee an accurate or geometrically valid room. Some geometric problems remain warnings/checks rather than blocked editing. Current export does not preserve a full provenance record.

### Remaining

- [ ] **PHOTO-01 · P0:** Define manual measurement/calibration and a validated feet-to-meters conversion into the main layout schema. Preview mapping/losses before explicit apply.
- [ ] **PHOTO-02 · P1:** Persist draft provenance and mark sample/manual/demo/AI estimates in exports and reopened files.
- [ ] **PHOTO-03 · P1:** Verify configured provider models with authorized test data; test missing keys, failed requests, invalid JSON and unresolved geometry.
- [ ] **PHOTO-04 · P1:** Full keyboard selection/list parity, room resizing, fixture bounds and safer replacement of unsaved photo drafts.
- [ ] **PHOTO-05 · P1:** Scope correction memory by restaurant; validate stored lessons fully and report failed saves accurately.
- [ ] **PHOTO-06 · Before public paid use:** Server-enforced streamed body limits, authentication/authorization, rate/cost limits, request cancellation/timeouts and redacted errors. Content-Length checks alone are insufficient.
- [ ] **PHOTO-07 · P2:** Either use optional photo tags in analysis or remove the currently unused input; centralize sample plans in fixtures.

**Acceptance:** import or estimate a plan, correct it, supply a measured dimension, preview conversion and explicitly apply it to a new named layout; its provenance and units remain visible and it can feed the canonical scenario model.

## 7. Customer Reviews and Social Media

**Priority: P0 customer intelligence; P1 advanced AI/social. Status: demo review browser and deterministic aggregation.**

### Implemented

- Three fictional reviews with stable IDs, dates, ratings, text and supplied themes.
- Average rating, rating distribution and per-theme counts/fractions.
- Counts each review once per normalized theme; a review may mention several themes.
- Keyword search over text, ID and themes; theme selection; mission-evidence-only filter; empty results/reset.
- Supplied seating mission cites two of the reviews and links to the Floor Plan action.

Sources: [review UI](../../src/features/tactical/frontend/components/review-insights.tsx), [review logic](../../src/features/tactical/domain/reviews.ts), [fixture schema](../../src/features/tactical/domain/schemas.ts).

### Requirement-by-requirement gap

| Requested feature | Current state | Required implementation |
| --- | --- | --- |
| Authorized CSV/JSON/text imports | Missing | Bounded parser, mapping preview, validation, duplicates, explicit source and retention policy |
| Source/platform filter | Missing | Source metadata and consistent platform taxonomy |
| Positive/neutral/negative feedback | Missing | Separate supplied rating signals from AI text sentiment and explain method |
| Date ranges and period comparison | Dates stored, filtering/trends missing | Period selector, comparable windows, sample sizes and insufficient-evidence state |
| Author filter/contact | Missing | Optional authorized identity fields; no inferred identities or contacts |
| Dish mentions/menu intelligence | Missing | Stable dish IDs/aliases, evidence-linked mention extraction and polarity |
| Topics and keyword | Working for supplied themes | Classify imported text; preserve original evidence |
| AI researcher | Missing | Structured findings, verified citations, uncertainty, suggested actions and unknown costs |
| Engagement/platform comparison | Missing | Actual post/engagement records with observation dates |
| Interaction/network analysis | Missing | Observed edges, graph calculations and explanation; sentiment alone is insufficient |
| Suggested replies | Missing | Generate editable drafts, copy action, explicit provenance; no automatic publishing |

### Implementation backlog

- [ ] **REV-01 · P0:** Extend review schema with dataset/source/provenance; allow missing optional ratings/authors without inventing values.
- [ ] **REV-02 · P0:** CSV/JSON import preview, row-level errors, file/row limits, stable IDs, deduplication and safe persistence.
- [ ] **REV-03 · P0:** Source/date/sentiment/dish/author filters with accurate denominators and empty states.
- [ ] **REV-04 · P0:** Deterministic overview and period comparison over supplied records, including sample sizes and rating-derived labels.
- [ ] **REV-05 · P1:** Server-side text classification with Zod output and evidence-ID validation; demo/rule-based fallback must be labeled.
- [ ] **REV-06 · P1:** Research findings: title, evidence IDs, action, confidence/limits, missing data and cost assumptions. Never invent precise costs.
- [ ] **REV-07 · P1:** Dish mention trends and menu opportunities; distinguish review popularity from sales.
- [ ] **REV-08 · P1:** Editable positive/negative review reply drafts with copy/download. Publishing remains outside scope without authorized APIs.
- [ ] **REV-09 · P1 conditional:** Social post/engagement ingestion and observed graph analysis when relationship data exists.

**Acceptance:** import an authorized dataset, inspect rejected rows, filter a period/platform, open evidence for a finding, follow its Floor Plan/menu action, and draft a reply without publishing. Every statistic must use the selected dataset rather than the old demo reviews.

## 8. Financial Intelligence

**Priority: P0. Status: demo dashboard and simplified slider, not accounting or a pricing engine.**

### Implemented

- Overview/Transactions/Menu Pricing/Simulator tabs.
- Six hardcoded monthly revenue points, with November marked partial.
- Ten example transaction rows and eight menu items with separate dine-in/delivery prices.
- Three fictional competitor average-check comparisons.
- Estimated covers from latest full-month example revenue divided by the fixture average check.
- Delivery price markup arithmetic; contribution-margin strings and “popular” flags are supplied examples.
- Additional-seat slider using fixture turns, occupancy, average check, days, contribution margin and investment.
- Display of assumptions and capacity-model caveats.
- Nessie placeholder/link, not a connected account or transaction adapter.

Source: [finance-page.tsx](../../src/features/tactical/frontend/components/finance-page.tsx).

### Existing inconsistencies to fix before expanding

1. Revenue chart values are constants, although nearby copy describes a calculation from covers and average check. Those values do not reconcile with the ten transaction rows.
2. The simulator duplicates capacity arithmetic in the component instead of using `domain/scenario.ts`.
3. It receives `fixture.assumptions`; it does not consume edited Floor Plan scenario assumptions or the selected layout's actual seat change.
4. Estimated covers divide by average check without a zero guard, although zero is valid in the general assumption schema.
5. Menu margins are strings, not calculated from ingredient, packaging or channel costs.
6. Competitor data compares restaurant average checks, not dated comparable dish prices.
7. Pricing suggestions are static prose, not a tested cost/demand-sensitive recommendation.
8. No general expense records, cash/account balance, revenue reconciliation, filters, sorting or saved finance scenarios are implemented.

These are code-inspected gaps, not new live-finance test results. Do not present this page as a finished financial model.

### Financial backlog

- [ ] **FIN-01 · P0:** Validated financial-record schema: ID, ISO date, description, amount/currency, income/expense type, category, source, channel and provenance. Define refund/tax/tip semantics.
- [ ] **FIN-02 · P0:** Fixture adapter and import interface; derive all dashboard totals/trends from the same selected records.
- [ ] **FIN-03 · P0:** Transaction source/category/date/channel filters, sorting and filtered totals; editing requires its own validation/audit decision.
- [ ] **FIN-04 · P0:** Separate revenue, known expenses, gross profit where COGS exists, contribution, operating profit where supported, and cash balance. Unknown is not zero.
- [ ] **FIN-05 · P0:** Menu records with costs, sales quantities where known, channel fees, packaging and dated price observations.
- [ ] **FIN-06 · P0:** Dine-in/delivery contribution calculations and candidate price comparison under explicit sales-volume assumptions.
- [ ] **FIN-07 · P0:** Use canonical capacity math; define shared scenario assumptions and a layout-linked seat-change action.
- [ ] **FIN-08 · P1:** Persist named pricing/cost/renovation scenarios, compare inputs and outputs and retain model versions.
- [ ] **FIN-09 · P1:** Comparable competitor dish table with source, collection date and approximate-comparison labels.
- [ ] **FIN-10 · P1 conditional:** Nessie sandbox adapter after access and endpoint requirements are verified; separate sandbox from real finance.

### Proposed finance formulas — not implemented yet

```text
unit contribution = selling price − ingredient/preparation variable cost
                    − channel fee − packaging − other defined variable costs
period contribution = sum(quantity × unit contribution)
scenario contribution change = candidate contribution − baseline contribution
break-even units = incremental fixed cost / positive unit contribution
```

Specify whether fees are percentages, fixed amounts or both; handle tax/tips separately. Price changes require editable demand/volume assumptions. A 5% price increase is not automatically a 5% profit increase. Compare candidate and baseline under the same period/currency definitions.

**Acceptance:** import or load a ledger, filter a period, reconcile totals, inspect channel costs, change a candidate price and quantity assumption, save two alternatives and reproduce them after reload. Missing cost data must prevent unsupported profit claims.

## 9. HR

**Priority: P2, demo only.**

### Implemented

Eight synthetic employees have names, roles, full/part-time status, tenure, a performance label, manually entered weekly hours and seven-day shift strings. The page shows totals, schedule grid and expandable profiles.

Performance labels are not self-reported mood. Weekly hours are separately authored and do not consistently equal the displayed shifts; there is no shift parser, break calculation or payroll computation.

### Remaining

- [ ] **HR-01:** Move records to validated fixtures and pass the selected restaurant's identity.
- [ ] **HR-02:** Add clearly synthetic contact details using reserved example domains, pay rates, availability and self-reported demo satisfaction.
- [ ] **HR-03:** Use explicit start/end/break data or clearly label scheduled-hour assumptions; reconcile displayed totals.
- [ ] **HR-04:** Calculate estimated labor from documented hours and rates; state treatment of taxes, benefits and overtime assumptions rather than imply payroll accuracy.
- [ ] **HR-05:** Editable job-description draft and preview concept; label template versus actual AI output.
- [ ] **HR-06:** Keep Indeed publishing, real staff records, payroll and full scheduling outside this hackathon slice.

**Acceptance:** fictional directory, schedule, availability and labor estimate agree; a manager can preview/copy a job draft without any publication or claim of Indeed integration.

## 10. Supply Management

**Priority: P2, demo only.**

### Implemented

Fifteen synthetic items have category, supplier, current quantity, threshold, unit, status, order date and optional delivery date. Inventory/category filters, stock bars, low/critical counts and eight supplier cards are present. No actual orders are placed.

Current statuses are supplied rather than calculated from a single rule. The summary partly hardcodes named critical items. “Deliveries pending” counts items with dates, not distinct shipments. Product costs and displayed reorder thresholds are missing from the current table. Supplier email-like strings should be replaced with reserved example addresses rather than plausible real domains.

### Remaining

- [ ] **SUP-01:** Move inventory/suppliers to validated fixtures with stable supplier IDs and explicit units.
- [ ] **SUP-02:** Derive stock status and restock count from documented thresholds; distinguish low, critical and overstock rules.
- [ ] **SUP-03:** Display thresholds and estimated unit/reorder costs; reject inconsistent units.
- [ ] **SUP-04:** Generate a rule-based summary grouped by supplier using current records; label it rule-based demo analysis.
- [ ] **SUP-05:** Rename delivery counts accurately or introduce synthetic shipment IDs.
- [ ] **SUP-06:** Preserve the demo boundary; no purchasing, logistics, stock automation or supplier API is required.

**Acceptance:** editing a fixture quantity changes its status, count and restock summary consistently; no hardcoded item names or live-order claims remain.

## 11. AI Assistant and contextual AI

### Placeholder

The AI Assistant page has preview feature cards and a disabled input/send button with an explicit inactive message. This satisfies the requested placeholder scope. Some card descriptions use present tense; revise them to consistently describe planned capability.

Do not build a full chatbot before the contextual workflows work.

### Shared AI foundation

The photo handler is the only current Tactical provider path. There is no common finding schema/service, review researcher, global advisor context, reusable analysis cache, streaming explanation layer or analysis persistence model.

- [ ] **AI-01 · P1:** Tactical-local finding schema: ID, title, evidence IDs, object/page references, severity, confidence/limits, assumptions, suggested action and optional numeric scenario reference.
- [ ] **AI-02 · P1:** Validate that every returned evidence/object ID belongs to the submitted dataset; reject fabricated citations.
- [ ] **AI-03 · P1:** Extract provider access behind a bounded server interface, reusing the existing SDK. Keep deterministic calculations outside model output.
- [ ] **AI-04 · P1:** Define explicit permission/data-sending UX for uploaded business content, retry/error states and provenance of fallback outputs.
- [ ] **AI-05 · P1:** Cache/persist results by restaurant, dataset version, model and prompt version; invalidate stale analysis honestly.
- [ ] **AI-06 · P2:** Update placeholder copy and document future context contracts; full assistant remains deferred.

**Acceptance:** supplied data produces a schema-valid finding whose citations open actual records; unavailable providers show a clear error or explicitly labeled fallback. AI explanations cannot replace canonical arithmetic.

## 12. Integrations and Expansion coordination

| Service/track | Current Tactical implementation | What is still required |
| --- | --- | --- |
| Anthropic | Server photo handler and demo fallback; live path unverified | Successful authorized request, model availability, output/failure tests and cost controls |
| Capital One Nessie | UI placeholder only | Adapter, sandbox credentials/access, source mapping and verifiable request-to-scenario journey |
| CoStar | No Tactical adapter | Agreed property/building record handoff with Rain; authorized relevant fields; manual geometry fallback |
| Arlequin | No graph integration or network analysis | Verify requirements and available relationship data; implement observed edges and graph-derived findings |
| Amazon AI | No verified Tactical Amazon integration | Verify challenge/service requirements; existing Anthropic use does not prove eligibility |
| Peri/outreach | No supplied consultation dataset wired here | Team-provided permitted findings and a demonstrable adaptation to that restaurant |
| Indeed | No posting integration | Draft preview only unless later explicitly implemented/authorized |
| Social/review publishing | None | Copyable drafts first; supported authorized posting adapter only later |
| Google busy times/POS | None | Legitimate sources and explicit metric coverage; never infer unsupported per-seat facts |

No sponsor eligibility is verified by this document. Do not count demo output or conceptual alignment as a working integration.

### Rain coordination checklist

- [ ] Agree on restaurant IDs and selected-restaurant propagation.
- [ ] Agree on evidence/provenance and recommendation/scenario contracts before sharing types.
- [ ] Define a user-controlled Tactical → Expansion action payload and supported filters; current connection is navigation only.
- [ ] Define optional property cost/building context consumed as labeled assumptions, not observed interior geometry.
- [ ] Keep private property datasets out of browser bundles and respect Rain's data adapters.
- [ ] Coordinate root tokens, dependencies and shared shell changes; keep independent feature work in each owned directory.

## 13. Reliability, accessibility, and technical debt

### Recently fixed and retained

- Invalid photo-plan import no longer replaces the valid draft and crashes rendering.
- Photo selection persists after click; table IDs are unique; one drag produces one undo entry; entrance fraction rotates correctly.
- Missing photo API key is explicitly a demo result.
- Legacy extra routes redirect to Floor Plan.
- Firefox's restored disabled button state is disabled via `StateButton`; Chrome/Firefox reload behavior has regression coverage.

### Remaining cross-cutting work

| ID | Priority | Work and reason |
| --- | --- | --- |
| QA-01 | P0 | Unified fixtures/provenance and shared restaurant identity; prevents contradictory dashboard records |
| QA-02 | P0 | Finance reconciliation, zero average-check handling and shared calculations |
| QA-03 | P1 | Separate library persistence/editor actions into tested helpers or hooks; workspace currently carries many responsibilities |
| QA-04 | P1 | Avoid treating a hidden mounted panel as an independently loaded page; consider lazy mounting only with explicit state preservation |
| QA-05 | P1 | Multi-tab/storage error handling; scenario writes currently consume recovered read results without a full conflict policy |
| QA-06 | P1 | Photo lesson save failures, dataset scope and draft-loss handling |
| QA-07 | P1 | Full keyboard/focus/screen-reader audit, especially photo canvas selection and clickable findings; a mobile route test is not an accessibility audit |
| QA-08 | P2 | Check reduced-motion behavior of imperative scrolling as well as CSS; some handlers explicitly request smooth scrolling |
| QA-09 | P2 | Replace remaining hardcoded object colors with agreed tokens and improve artwork coherently |
| QA-10 | P1 | Contextual empty/loading/error states for future imports/providers; preserve last valid data on failure |
| QA-11 | Before deployment | Access control, rate limits, request limits, secret/error handling for paid server endpoints |
| QA-12 | P1 | Validate state restoration and stale assumptions when saving/editing the baseline; saved-history reproducibility must remain intact |

These are implementation tasks and code-inspection risks. Do not imply that every row is a browser-reproduced defect.

## 14. Implementation sequence

This sequence implements the brief without rebuilding the app. Owners are Tactical unless a coordination dependency is stated.

| Order | Deliverable | Reuse | Dependency | Exit criterion |
| --- | --- | --- | --- | --- |
| 1 | Unified validated fixtures and restaurant context | Existing JSON/schema loader, supporting pages | None | One fixture/context controls all section identities; invalid inputs are visible |
| 2 | Review ingestion and deterministic analytics | Review schema/browser/aggregator | Step 1 provenance | Authorized CSV/JSON → validated records → filters/counts/evidence → reload |
| 3 | Financial ledger and reconciled overview | Finance tabs and table styling | Step 1 financial schema | Dashboard exactly reconciles to selected records; unknown values stay unavailable |
| 4 | Menu/channel cost and pricing scenarios | Canonical scenario conventions | Step 3 cost/sales records | Dine-in/delivery candidates calculated with explicit demand assumptions |
| 5 | Scenario/context connections | Layout library and saved-snapshot engine | Steps 1–4 | Layout/finance share declared assumptions and retain historical snapshots |
| 6 | Contextual AI review findings/replies | Existing server provider, review evidence | Step 2 | Validated citations, transparent fallback, copyable human-edited replies |
| 7 | Floor analytics and photo conversion | Main editor, photo draft/schema, insights | Measurement/provenance decisions | Confirmed conversion to new layout; supported operational metrics only |
| 8 | HR/Supply demo completion | Existing pages | Step 1 | Consistent derived totals, fictional contacts/costs and preview-only actions |
| 9 | Conditional sponsor work | Separate adapters | Credentials, permitted datasets, verified requirements | Real end-to-end integration proof, demo/live states separated |
| 10 | Final UX, reliability and release review | Existing tokens and browser tests | Core journeys stable | Keyboard/mobile/reload/error journeys verified, docs match code |

Small corrections such as finance labeling and zero guards can ship alongside the first steps. Do not delay functional review/finance data work for full 3D, NPCs, generic chat, production HR or purchasing.

### Suggested future file additions — proposed, not present

| Proposed module | Purpose |
| --- | --- |
| `domain/restaurant-data.ts` | Dataset/provenance boundaries and normalized restaurant context |
| `domain/review-import.ts` | Bounded import validation and mapping rules |
| `domain/finance.ts` | Record aggregation, channel contribution and pricing math |
| `domain/findings.ts` | Evidence-linked structured finding schema |
| `frontend/data/` fixture manifest or expanded JSON | Editable synthetic restaurant, finance, HR, supply and photo records |
| `frontend/layout-storage.ts` or extracted storage helpers | Named-library persistence/migration separate from rendering |
| `backend/ai/` | Provider adapter and bounded review-analysis workflows, if justified by actual reuse |
| `backend/adapters/` | Nessie/property/review sources only as real integrations are implemented |

Use the existing frontend/domain/backend separation. Do not create empty directories or a large generic framework simply to match this proposal.

## 15. Verification and acceptance journeys

### Last completed code verification

The preceding hydration-fix work ran and passed:

- 68 repository unit tests, including 25 Tactical tests and 43 Expansion tests.
- 6 Tactical browser runs: three journeys each in Chromium/Chrome and Firefox.
- ESLint, TypeScript typecheck and production build.
- Browser journeys cover named-layout save/rename/delete/baseline/metadata, photo selection/invalid import/redirects/mobile navigation, and disabled-state reload behavior.

This documentation review does not rerun or claim new live-provider, full accessibility, or exhaustive visual tests. The main suite is stronger around geometry/calculations/storage than around newer financial and supporting-page behavior.

### Commands

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install firefox
PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.tactical.config.ts
```

Use Node >=22.18; this workspace has used `mise exec node@24 -- ...`. Tactical browser config uses port 3057 and a production server. Build first. If reusing an already running server, confirm it serves the current build. The default `npm run test:e2e` targets Expansion's config, not these Tactical tests. Without installed Chrome, install the matching Playwright Chromium and omit `PLAYWRIGHT_CHANNEL`.

### Acceptance journeys to add as features ship

| Journey | Expected proof |
| --- | --- |
| Review import | Valid rows retained, invalid rows explained, duplicate handling stable, provenance survives reload |
| Review finding | Every citation opens an actual selected-dataset record; insufficient samples do not become invented trends |
| Finance ledger | Filtered totals, chart and tables reconcile; refunds/expenses/channel fees follow documented rules |
| Pricing scenario | Zero volume, missing cost, reduced demand, fee changes and negative contribution handled explicitly |
| Shared assumptions | Finance and Floor Plan use the declared context; saved snapshots stay unchanged after edits |
| Photo conversion | Feet/meters, dimensions, object IDs, provenance and unsupported categories validated before apply |
| Persistence failures | Quota/read errors and concurrent tabs preserve last valid work and show useful recovery paths |
| Accessibility | Full journey with keyboard, screen reader labels/focus, narrow viewport and reduced motion |
| Provider integration | Authorized real request, schema-valid response, timeout/error handling and unmistakable fallback |
| Expansion handoff | Only agreed parameters cross the boundary; no Tactical change breaks Rain's routes/types |

## 16. Decisions and data still needed

These are not blockers for continuing with labeled fixtures. They determine whether later outputs can be treated as real evidence.

| Needed input/decision | Why it matters | Safe interim behavior |
| --- | --- | --- |
| Authorized restaurant review export | Real theme/time/source analysis | Small explicit fixture, then import contract |
| Transaction/menu-cost sample and accounting definitions | Reconciled finance and channel margin | Validated synthetic ledger with explicit unknowns |
| Table service intervals/assignments | Dining duration and occupancy | Display unavailable rather than infer from payment times |
| Measured room/furniture dimensions | Physical layout credibility/photo calibration | Manual dimensions marked user-entered |
| Seat-count convention | Prevent table/chair double-counting | Preserve existing table-inclusive semantics until migration decided |
| Design feedback per page | Focused polish | Keep shared tokens and working layout |
| Demand response and investment assumptions | Honest pricing/renovation simulations | Editable sensitivity assumptions, no guarantees |
| Sponsor credentials and permitted data | Working integrations | Clearly labeled demo adapters/fixtures |
| Rain's agreed shared contract | Cross-domain identity/actions | Navigation link only; Tactical-local types |
| Browser-only versus account-backed release | Persistence and security scope | Explicit local save/export until backend is authorized/prioritized |

## 17. Definition-of-done checklist

### Present now

- [x] Six required Tactical navigation sections and Floor Plan landing page.
- [x] Existing Expansion navigation remains available.
- [x] Manual floor editing, named configurations, baseline and persistent metadata.
- [x] AC and manually customizable object types.
- [x] Seating/turnover scenarios integrated in Floor Plan.
- [x] Deterministic, explained capacity calculations and saved comparisons.
- [x] HR/Supply demo labels and intentionally inactive AI Assistant.
- [x] Missing photo key clearly distinguished from real analysis.
- [x] Code checks and the documented browser regression suite passed in the preceding implementation work.

### Still required for the full refinement brief

- [ ] Every page consumes one selected restaurant/data context with centralized editable fixtures.
- [ ] Review analysis works on authorized imports, not only authored themes.
- [ ] Review trends, menu intelligence and evidence-linked contextual findings work with visible sample sizes.
- [ ] Financial indicators reconcile to validated records and explicit formulas.
- [ ] Pricing scenarios model dine-in/delivery costs and demand assumptions.
- [ ] Floor Plan and Finance share deliberate assumptions and scenario connections.
- [ ] Measured operational analytics and richer seating hypotheses are connected where data supports them.
- [ ] HR and Supply contain their remaining requested demo fields and consistent derived values.
- [ ] Responsive, keyboard, reduced-motion and failure/recovery journeys have a complete audit.
- [ ] Conditional external integrations have separate, verifiable proof before being claimed.

**Current next implementation task:** DATA-01 through DATA-04, followed by REV-01/REV-02 and FIN-01/FIN-02. Keep the working editor/scenario path intact while making the surrounding business data credible and replaceable.
