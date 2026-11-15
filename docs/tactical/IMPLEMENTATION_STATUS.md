# Tactical — current implementation and remaining work

**Latest Capital One increment (2026-11-15):** Cash calendar now connects the Nessie sandbox balance/bills to editable payroll, restock and payment assumptions. Month/Agenda, daily evidence, reserve warnings, saved bank/input snapshots and explicit refresh failures are implemented. MongoDB revision 8 contains the new mocks. See [Cash calendar](CASH_CALENDAR.md).


**Latest finance refinement (2026-11-15):** Report and Price playground replace the previous finance tabs. Dated mock sales, fictional comparisons, deterministic pricing/delivery/cut analysis and purple qualitative AI with full numeric evidence are implemented. The report is saved in MongoDB revision 7; later Atlas reads failed, so current connectivity is unverified. See [Finance workflow](FINANCE_WORKFLOW.md) for verification and limits.


## Supply AI removal and centralization proposal — November 15, 2026

Supply Management is inventory-only: its AI workbench and unlock controls are removed, entering the page does not fetch the AI session, and the dedicated supply task is no longer accepted by the AI API. The central assistant can still use inventory facts for an explicit question. [Connected data and AI plan](CONNECTED_DATA_AND_AI_PLAN.md) defines proposed phases CEN-01 through CEN-07; the context/artifact/decision architecture is not yet implemented.

## Inventory and collisions — November 15, 2026

Supply now uses roomier inventory cards, search/category/stock filters, visible mock expiration dates and expandable costs/reorder/delivery details. Supplier directory and supplier columns are removed. Existing supplier data relationships remain compatible. The fixture and MongoDB dataset (revision 6) have 34 mock expiration dates and three packaging records with no expiry listed. Dates are display data, not shelf-life or safety predictions. Overlapping floor objects turn red live; proximity-only warnings remain yellow, and assigned chairs are exempt from their own table collision. Rain’s latest Expansion commits were pulled and merged without conflicts. Validation on the merged checkout: 242 unit tests passed (one skipped), 54 Tactical Chrome/Firefox checks passed, typecheck and production build passed. Lint has no errors and one existing Expansion unused-variable warning; the build reports nine Expansion filesystem-tracing warnings.

## HR update — November 15, 2026

HR now has Schedule, Team and Hire employees views, seven mock employees, a dated 36-shift calendar, and an independent seven-day item-demand sample. Four real Gemini assessments are cached in `restaurantos.tactical_hr_analysis` with green/yellow/red states and hover/focus evidence. Hiring drafts respond to the selected role and owner requirements and remain editable/copyable; Indeed posting is disabled. The live MongoDB restaurant was updated with only employees/workforce (revision 5), preserving other operations and layouts. The audited AI context exactly matches the synthetic fixture and excludes employee names/emails. Live overview and hiring generation succeeded. Validation: 187 unit tests; 46 existing Tactical browser checks plus six new HR checks passed in Chrome/Firefox, with lint, typecheck and build passing. The build retains two preexisting Expansion tracing warnings. Schedule editing, payroll and saving owner-edited job drafts remain open. See [HR workflow](HR_WORKFLOW.md).

## Customer Reviews update — November 14, 2026

Reviews now use persisted Gemini themes, sentiment and High priority filtering with per-review explanations. Each review offers an editable/copyable AI reply and a disabled Reply button. Both themes and reviews scroll independently. Classifications live in `restaurantos.tactical_review_analysis`; unchanged source reviews reuse their saved results, while new/edited reviews are processed incrementally through dataset uploads or the unlocked Reviews page. Live readback verified 30 classifications, nine high-priority flags and stable cached records. Validation passed with 181 unit tests, Chrome/Firefox review and AI checks, lint, typecheck and production build. Direct platform posting remains intentionally unavailable. See [review workflow](REVIEW_WORKFLOW.md) for processing limits and file ownership.

## Floor Plan visual refinement — November 14, 2026

The current editor uses one quiet workspace frame, a searchable furniture menu with previews, a compact Save/version group and an icon-only settings popover. Furniture art is rendered in room units with proportionate chairs. The canvas has thin walls, subdued floorboards and floating icon-only editing controls. The Seating Problem remains a collapsed purple AI surface. Proximity warnings appear as yellow object borders with an on-map hover tooltip. The selected saved version now survives reload, and Escape cancels an active drag/resize. Existing MongoDB version records, meter coordinates, automatic capacity rules and AI context contracts are unchanged. No Expansion files were edited.

Validation: 174 unit tests and 38 Tactical Chrome/Firefox checks passed, with a further focused Floor Plan pass after responsive sizing. Lint, typecheck and production build passed; the build retains two existing Expansion tracing warnings. A live Gemini request returned three findings and included current-object and saved-version geometry evidence. For development, use `http://localhost:3000/tactical`; the dev server blocked HMR requests through the alternate `127.0.0.1` origin.

**Reviewed:** 2026-11-14. **Scope:** Asilbek's Tactical module, its routes, data, calculations, tests, and integration boundaries. This inventory describes the current working tree, including uncommitted work; it is not a statement that these changes have been committed, pushed, or deployed.

**Product target:** [Product refinement brief](PRODUCT_REFINEMENT_BRIEF.md). **Architecture map:** [repository structure](../../STRUCTURE.md). **Navigation guide:** [pages](PAGES.md). **Manual demo:** [walkthrough](FRONTEND_WALKTHROUGH.md).

**Latest Floor Plan update:** The editor uses a freeform map, a searchable furniture menu, automatic seat sizing, red overlaps/yellow proximity warnings and compact map controls. Saved versions are available beside Save and write to MongoDB when configured. The expandable seating analysis and advisor receive working and saved coordinates. Inline scenarios, the historical library panel and backup controls were removed. See [the floor plan guide](FLOOR_PLAN_GUIDE.md).

**Previous Arlequin Track 2 increment:** Reviews → Content & connectivity implements the supplied challenge: bounded public Hacker News import or normalized messaging JSON, explicit actor links, greedy modularity groups, AI message themes/tone with exact source spans, deterministic topic-by-group counts, cross-group conversation paths, chronological evidence and report export. An observed 23-message sample, complete Gemini labeling, authenticated browser theme tracing and report export were verified. Current validation: 169 unit tests, 36 Tactical browser checks, lint, typecheck and build. See [track implementation](ARLEQUIN_TRACK2.md).

**Previous sponsor increment:** Finance now includes a separate Nessie sandbox cash planner with a validated server adapter, explicit demo/API provenance, editable reserve assumptions and JSON export. Reviews includes permission-aware graph JSON import, evidence browsing, deterministic connection/topic metrics, browser save/reopen and purple Gemini hypotheses. Nessie is configured and verified live after approved fictional seeding: one customer, one checking account, two deposits and one withdrawal. Authenticated browser refresh, bank evidence, reserve calculations and scenario export pass. Arlequin Track 2 requirements are now supplied and the observed public-data path is verified; see the latest increment above. See [sponsor workflows and remaining gates](SPONSOR_INTEGRATIONS.md).

**Previous AI increment:** the user requested all Tactical AI workflows and purple provenance. Gemini now serves floor analysis, custom-object suggestions, review research/replies, finance/supply explanations, job drafts, the advisor and existing photo estimation. Failures return only **Something is wrong**, with no demo fallback. See [AI setup and boundaries](AI_FEATURES.md).

**Previous floor-plan increment:** main floor-plan improvements: custom-object creation, explicit chair ownership, footprint-gap measurements, affected-object highlights and reversible move previews, clearer baseline/draft behavior, library backup/recovery and stale-tab checks. Photo work was deferred at the user’s request. The preceding MongoDB increment remains available; Rain’s module is unchanged in this batch. See [MongoDB setup/API guide](MONGODB_SETUP.md). The database remains synthetic. See the latest Floor Plan update for version saving.

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
| Customer Reviews & Social Media | Working AI review triage on mock data | Saved themes/sentiment/priority, incremental classification, reply draft/copy, content/network workflow | Platform posting, live review ingestion, time/source/dish analysis |
| HR | Working demo + live AI | Seven-person roster, dated calendar, AI assessments and editable hiring drafts | Synthetic weekly demand, role-level analysis, disabled Indeed posting |
| Supply Management | Demo | Inventory cards, expiration dates, stock filters | Derived stock status, estimated costs and consistent restock summary |
| Financial Intelligence | Working mock ledger and simulations | Reconciled ledger totals, channel unit costs, price/volume experiments | Real-data imports, saved pricing scenarios and shared edited assumptions |
| AI Assistant | Working contextual request UI | Single-turn Gemini advisor with evidence and purple results | Durable history, multi-turn context and real business data |

**Do not currently claim:** production accounting, real customer sentiment analysis, automated space optimization, observed seating preference, legal/safety compliance assessment, live banking, CoStar interior geometry, Arlequin qualification or observed social-network findings, or a functioning restaurant-wide assistant.

## 2. Architecture and code ownership

### Current route structure

| Route | Actual behavior |
| --- | --- |
| `/` | Redirects to `/tactical`. |
| `/tactical` | Floor Plan, layout library, insights, expandable photo editor, inline scenarios and saved comparisons. |
| `/tactical/reviews` | Customer Reviews & Social Media section; current contents are review analytics only. |
| `/tactical/hr` | Fictional team directory and schedule. |
| `/tactical/supply` | Fictional inventory with expiration dates. |
| `/tactical/finance` | Report and Price playground; independent ledger and Nessie Sandbox. |
| `/tactical/ai` | Single-turn evidence-linked Gemini advisor. |
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
| [backend/analyze.ts](../../src/features/tactical/backend/analyze.ts) | Gemini photo request, validation and generic failure | Shared Gemini/access foundation |
| [frontend/components/state-button.tsx](../../src/features/tactical/frontend/components/state-button.tsx) | Opts stateful buttons out of browser disabled-state restoration | Retain for dynamic controls and hydration consistency |
| Component CSS and [globals.css](../../src/app/globals.css) | Tactical styling and root tokens | Extend the established visual language |

### Boundaries to preserve

- Tactical UI/browser storage belongs in `frontend/`; pure validation/calculation belongs in `domain/`; secrets/provider calls/server persistence belong in `backend/`.
- Root API routes should be thin entry points. There is no need for a second backend application.
- Rain owns `src/features/expansion/`. Do not move Tactical implementation into his module.
- Shared schemas are still a [proposal](SHARED_CONTRACT_PROPOSAL.md), not an agreed contract. Coordinate entity/provenance/handoff changes before promoting local types.
- Installed UI technology is React/SVG, CSS, Geist and Lucide. Tailwind, shadcn/ui and Recharts are not installed dependencies in the inspected package manifest. They are preferences in the brief, not completed infrastructure or a reason to rewrite working UI.
- MongoDB is now the user-selected shared database. Tactical uses a server-side loader/repository and thin API routes; Rain’s backend remains untouched.

## 3. Data sources and persistence

### Where current business data actually lives

All synthetic business records now live in [demo-restaurant.json](../../src/features/tactical/frontend/data/demo-restaurant.json), validated by [domain/dataset.ts](../../src/features/tactical/domain/dataset.ts). The same dataset is stored in `restaurantos.tactical_datasets` and selected by the server loader.

| Dataset | Current contents |
| --- | --- |
| Core restaurant | Profile, main layout, 30 fictional reviews, one cited mission and default assumptions |
| Configurations/history | Versioned layout configuration and a reproducible example turnover snapshot; ready for API upload, not auto-synced with browser saves |
| Finance | 312 synthetic ledger entries from June through November 2026 across dine-in, delivery, takeaway and shared costs, 24 menu items, a separate 92-day item-sales report and 65 fictional price comparisons |
| HR | Seven fictional employees with reserved-domain contacts, assumed pay, validated dated shifts and weekly item demand |
| Supply | 37 inventory items with costs and thresholds, and 12 fictional suppliers |
| Social analysis | 24 fictional messages from nine actors in the editable conversation fixture |
| Photo examples | Manual sample/blank plans and an unused legacy fallback fixture; provider failures never load it |

`TACTICAL_DATA_SOURCE=demo` reads the local fixture. `mongodb` reads the selected restaurant by `TACTICAL_RESTAURANT_ID` and displays source/revision. All six sections receive the selected profile; the UI still has no interactive restaurant picker. All records are explicitly synthetic, including after MongoDB storage. Real staff/banking uploads are not supported by this contract.

### Current storage contracts

| Record | Storage key/persistence | Important behavior |
| --- | --- | --- |
| Legacy single layout | `restaurant-os:tactical:<id>:layout:v1` | Retained for migration; newer library saves do not update this legacy key |
| Named layout library | `restaurant-os:tactical:<id>:layouts:v1` | Version 1; active/baseline IDs; 1–50 entries; validated before writes |
| Scenario snapshots | `restaurant-os:tactical:<id>:scenarios:v1` | Layout, inputs, results and evidence saved independently of library |
| Photo lessons | `restaurant-os:tactical:analyze:lessons:v1` | Global to Tactical browser storage, not restaurant-scoped |
| Photo correction records | `restaurant-os:tactical:analyze:mistakes:v1` | Global to Tactical browser storage; limited recent history |
| Unsaved layout edits, current photo plan, photos and page form state | React memory | Lost on reload unless explicitly saved/exported through the supported flow |

Library migration loads the old valid draft into a new in-memory library and persists on the next explicit write. A corrupt library is preserved and writes are disabled. Scenario recovery retains valid snapshots alongside invalid entries and reports an issue. MongoDB dataset persistence is now implemented with optimistic revision checks. The browser library now supports full JSON backup/restore and stale-tab detection before writes. Corrupt bytes remain preserved and can be downloaded; explicit restore keeps a recovery copy. These checks are not an atomic multi-client database transaction. There is still no end-user account system, automatic browser-editor cloud sync or remote backup service.

### Data foundation backlog

- [x] **DATA-01 · P0:** Centralized business/photo fixture and Zod schema now feed the components and MongoDB API.
- [x] **DATA-02 · P0:** Server-selected dataset boundary propagates identity into HR, Supply and Finance. Interactive restaurant selection remains a later UX task.
- [x] **DATA-03 · P0 mock scope:** Dataset version, synthetic provenance, as-of date, source IDs, ISO dates, USD cents and restaurant identity are validated. Permissioned real-data metadata remains future work.
- [x] **DATA-04 · P0 mock scope:** Synthetic records, editable assumptions and simulated outputs are distinguished; API rejects real-data provenance for this mock contract.
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

- Custom objects have a description-first placement form with editable name, category and dimensions. Manual inputs remain available; a separate purple AI designer can suggest editable metadata and estimated dimensions before explicit placement.
- New object categories use simple vector primitives; they do not yet have distinctive, polished sprites.
- Table graphics now draw up to 12 chair markers from the declared seat count; the capacity label remains authoritative for larger counts. Booth/counter art is illustrative.
- Standalone chairs add capacity independently. A chair can explicitly belong to a table, booth or counter and represent seats already included in that group. Assigned seats cannot exceed group capacity. Assignment requires layout schema version 2; version 1 layouts retain their original counts. Geometry alone never infers ownership. Deleting a group confirms removal of its assigned chair objects; Undo restores them.
- Windows, walls and AC units are regular floor objects. There are no wall attachments, ceiling layers, airflow directions or circulation-path semantics.
- Duplicate copies a **saved** configuration. Save current edits first; switching actions can discard unsaved edits after confirmation.
- The editor names the active save target and saved comparison baseline. Template/blank choices are unsaved replacements of the active configuration; Reset confirms returning to its saved checkpoint. Saving the baseline refreshes new scenario defaults without rewriting historical snapshots.
- The comparison uses saved versions, not every unsaved draft edit. Area/seat includes kitchen and all other room space; it is not measured clearance or comfort.

### Insights implemented today

The deterministic rule finds seating centers within 2 m of AC, windows, doors or kitchen zones. Overlapping footprints produce separate findings. Findings carry object IDs, explanations and either `Suggestion` or `Potential problem`. Inspecting one highlights every affected object and selects the first in the inspector. Overlap findings can preview the nearest non-overlapping 0.25 m grid position for one object. Apply commits one undoable move; Reject changes nothing. Any layout edit invalidates a pending proposal. Results are capped at 20.

The selected-object inspector reports the nearest room-edge gap and shortest Euclidean rectangle-edge gap to another object, with rotation applied. Zero means touching or overlapping. These are not circulation clearance or compliance measures. A separate purple Gemini workflow now interprets review/object context and can propose bounded position changes. There is still no whole-layout optimization, observed table utilization or evidence-supported critical/safety classification. Gray/yellow/red severity styling is not a complete three-level card system yet.

### Floor Plan backlog

- [x] **FP-01 · Manual scope:** Description-first creation, editable category/name/dimensions and manual placement. No AI suggestions claimed.
- [x] **FP-02:** Explicit seat ownership with validated group capacity, version 2 layout storage and backward-compatible version 1 reads. Users still need to declare whether a standalone chair is additional or included.
- [x] **FP-03:** Active/draft/baseline labels, template/blank dirty-state correction and baseline-seat refresh on save; saved snapshots unchanged.
- [ ] **FP-04 · P1:** Add physical semantics only where useful: wall/window anchoring, optional ceiling objects and user-described service paths.
- [x] **FP-05 · Footprint scope:** Selected-object wall and nearest-object gaps with explicit geometry definitions; no walking-clearance or code-compliance claim.
- [ ] **FP-06 · P1:** Provide Spacious/Balanced/Higher-density comparison labels as user preferences, not AI aesthetic scores; show known costs and unknown comfort evidence.
- [ ] **FP-07 · P1:** Add measured operational records and a source panel: arrivals, occupancy, table assignment and actual service intervals where supplied.
- [ ] **FP-08 · P1:** Join interior-review evidence to object/area hypotheses; expose uncertainty and missing observations.
- [x] **FP-09 · Geometry scope:** All affected-object highlights and one-object overlap move preview with explicit apply/reject and undo. Review-linked AI proposals and supported critical severity remain future work.
- [ ] **FP-10 · P2:** Improve new object art, floor composition, library density, mobile controls and restrained motion without replacing the SVG editor.
- [x] **FP-11 · Browser scope:** Whole-library JSON export/import with preview, restaurant validation, 4 MB cap, 50-layout limit, stored-byte download, explicit reload/recovery and preserved prior bytes on replacement.

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
- Standard/more-detail requests use the shared Gemini model (optional configured photo model); the API key remains server-side.
- Bounded streamed JSON bodies, signed session/origin checks, Zod requests, structured draft validation and invalid-import rejection.
- Missing/failed providers return only Something is wrong. Manual sample/blank plans remain separate.
- Strict Gemini results, geometric checks and generic errors; no silent corrective/fallback result on provider failure.
- Sample/blank plan, table and fixture editing, whole-plan rotation, undo/redo, SVG/PNG/JSON export.
- Selection, duplicate-ID, undo-per-drag and entrance-rotation fixes.
- Correction differences generate reusable prompt lessons stored in the browser.

Sources: [photo UI](../../src/features/tactical/frontend/components/analyze-plan.tsx), [canvas](../../src/features/tactical/frontend/components/draft-canvas.tsx), [schemas/checks](../../src/features/tactical/domain/analyze.ts), [backend](../../src/features/tactical/backend/analyze.ts).

### Important limitations

This is a second representation: approximate feet, `tables`/`fixtures`/`door`, separate from the main meter-based `Layout.objects`. Exported photo JSON is not a main-editor layout file. There is no conversion/apply action, calibration workflow, saved named photo library or automatic restoration of the current photo draft.

“Teach it” stores text for future prompts; it does not train the model. Lesson storage is not restaurant-scoped, and storage failures are swallowed by its helpers. Editing dimensions marks objects verified in code, but that should not be interpreted as independent measurement verification.

Photo sample/blank records come from the central fixture. Gemini now shares the structured-output adapter and validates the exact response rather than filling missing coordinates or counts with invented defaults. Schema validity does not guarantee an accurate or geometrically valid room. Some geometric problems remain warnings/checks rather than blocked editing. Current export does not preserve a full provenance record.

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
| Positive/neutral/negative feedback | Purple AI classification implemented for supplied reviews | Imported datasets and integrated sentiment filters remain queued |
| Date ranges and period comparison | Dates stored, filtering/trends missing | Period selector, comparable windows, sample sizes and insufficient-evidence state |
| Author filter/contact | Missing | Optional authorized identity fields; no inferred identities or contacts |
| Dish mentions/menu intelligence | Missing | Stable dish IDs/aliases, evidence-linked mention extraction and polarity |
| Topics and keyword | Working for supplied themes | Classify imported text; preserve original evidence |
| AI researcher | Gemini findings with validated citations, uncertainty and suggested actions | Real review imports and durable analysis history |
| Engagement/platform comparison | Missing | Actual post/engagement records with observation dates |
| Interaction/network analysis | Graph engine and source-linked JSON imports implemented; sample synthetic | Observed public source and message/actor pipeline now available; see ARLEQUIN_TRACK2.md. Graph-only JSON remains supported. |
| Suggested replies | Gemini draft/edit/copy workflow | No publishing integration |

### Implementation backlog

- [ ] **REV-01 · P0:** Extend review schema with dataset/source/provenance; allow missing optional ratings/authors without inventing values.
- [ ] **REV-02 · P0:** CSV/JSON import preview, row-level errors, file/row limits, stable IDs, deduplication and safe persistence.
- [ ] **REV-03 · P0:** Source/date/sentiment/dish/author filters with accurate denominators and empty states.
- [ ] **REV-04 · P0:** Deterministic overview and period comparison over supplied records, including sample sizes and rating-derived labels.
- [x] **REV-05 · Supplied dataset scope:** Server-side Gemini classification with Zod, evidence-ID and exact-quote validation. No fallback output on failure; imported review datasets remain queued.
- [x] **REV-06 · Supplied dataset scope:** Structured findings with evidence, actions, model confidence, limitations and costs instructed to remain unknown unless supplied.
- [ ] **REV-07 · P1:** Dish mention trends and menu opportunities; distinguish review popularity from sales.
- [x] **REV-08 · Copy scope:** Editable Gemini reply drafts and clipboard copy. No posting or file-download action.
- [ ] **REV-09 · P1 conditional:** Social post/engagement ingestion and observed graph analysis when relationship data exists.

**Acceptance:** import an authorized dataset, inspect rejected rows, filter a period/platform, open evidence for a finding, follow its Floor Plan/menu action, and draft a reply without publishing. Every statistic must use the selected dataset rather than the old demo reviews.

## 8. Financial Intelligence

**Priority: P0. Status: dated mock menu report and editable price playground implemented.**

The Report includes assumptions, canonical totals, purple Gemini observations/actions with evidence, comparable prices, raise ideas, expensive-item flags, app economics, slow-seller estimates and a full item table. The Price playground models raises and customer loss for 15 leading dine-in items, with break-even loss, period contribution change, annualized illustration, suggested raises and reset. Experiments survive tab changes, not reloads.

The independent 312-row ledger remains in a collapsible filtered section. Nessie Sandbox retains its own utility entry. The former four finance tabs and capacity slider have been replaced. There is no upload/address onboarding.

The fixture and MongoDB revision 7 contain 24 item-sales rows for a 92-day sample and 65 fictional comparator observations. Subsequent Atlas availability checks failed; the successful save is not evidence of current availability. See [Finance workflow](FINANCE_WORKFLOW.md) for precise formulas, source boundaries, file map, persistence and current verification details.

Contribution excludes labor and fixed costs; supplied per-item costs override generic reference percentages. App scenarios compare against current app prices; slow-seller cuts can have negative outcomes. AI explains canonical metrics and never changes prices. Finance and the advisor share the same report evidence, but unsaved playground edits are local.

### Financial backlog

- [x] **FIN-01 · P0 mock scope:** Validated ledger IDs, dates, descriptions, integer cents, income/expense type, category, channel and source.
- [x] **FIN-02 · P0 mock scope:** Fixture/MongoDB dataset adapters and reconciled selected-record totals/trends. Real financial imports remain pending.
- [x] **FIN-03 · Partial:** Month/channel/type filtering and date sorting. Category/date-range filters and editable audited transactions remain pending.
- [x] **FIN-04 · Partial:** Recorded income/expenses/net difference are labeled distinctly. Cash balance, gross profit and operating profit remain unavailable until their records/definitions exist.
- [x] **FIN-05 · P0 mock scope:** Menu cost, channel fee, packaging, assumed quantity and dated comparison records.
- [x] **FIN-06 · P0 mock scope:** Dine-in/delivery contribution and candidate price/volume experiment.
- [x] **FIN-07 · Deferred:** The finance capacity slider was replaced by the menu report/playground. A deliberate shared Floor Plan/Finance scenario interface remains pending.
- [ ] **FIN-08 · P1:** Persist named pricing/cost/renovation scenarios with model versions and compare them.
- [x] **FIN-09 · Mock scope:** Comparable dish table with source/date/approximation labels. Licensed/current observations are still future work.
- [x] **FIN-10 implementation:** Nessie adapter, protected read endpoint, sandbox cash planner and source export. Approved sandbox records are configured; live authenticated account/transaction retrieval and browser scenario export are verified. Exact sponsor criteria still need verification.

**Next acceptance:** preserve and compare financial experiments across reload, connect intentional shared assumptions, and ingest authorized records without changing source meanings.

## 9. HR

**Priority: P2, synthetic demo only.**

Seven employees come from the central dataset. A dated calendar replaces the table, and compact team cards reveal details on demand. Four AI assessments interpret role coverage, peak demand, labor/sales and workload, with green/yellow/red states and hover/focus evidence. The separate hiring subsection creates editable/copyable role-specific AI drafts; Indeed posting is disabled. See [HR workflow](HR_WORKFLOW.md).

- [x] **HR-01:** Central fixture and selected restaurant identity; seven demo employees.
- [x] **HR-02:** Compact profiles with synthetic contacts/pay/availability.
- [x] **HR-03 · Dated viewing:** Validated start/end minutes, employee/menu references, overlap checks, reconciled hours, calendar/filter and mobile day picker. Breaks, overnight authoring and schedule editing remain open.
- [x] **HR-04 · Demo scope:** Deterministic base labor, item sales, order counts and peak station coverage; explicit exclusions and editable fixture assumptions.
- [x] **HR-05:** AI hiring suggestions with position/requirements input and editable job-description preview/copy.
- [x] **HR-07:** Persisted AI assessment colors, hover explanations and evidence; cached by source/model/task.
- [ ] **HR-08:** Persist owner-edited job descriptions and edit schedules in the UI.
- [ ] **HR-06:** Indeed publishing, real employee data and payroll remain out of scope.

## 10. Supply Management

**Priority: P2, synthetic demo only.**

37 inventory records use a cleaner card layout with stock and expiration at a glance. Search, category and status filters work together. Costs, reorder points and dated delivery details expand on demand. Supplier directory/columns are removed; legacy supplier IDs remain validated for dataset compatibility. Stock status is derived: below 50% of threshold is critical, below threshold is low, above 150% is overstock, otherwise in stock. Mock expiration dates are not inferred food-safety guidance; packaging displays “No expiry listed,” while legacy absent dates show “Not recorded.”

- [x] **SUP-01:** Central inventory fixture and selected restaurant data.
- [x] **SUP-02:** Search, category/status filters, empty-state reset and responsive cards.
- [x] **SUP-03:** Expandable unit costs, reorder thresholds and delivery details.
- [x] **SUP-04:** Derived item totals, below-threshold count and items awaiting delivery.
- [x] **SUP-05:** Validated optional/nullable ISO expiration date, populated fixture and MongoDB.
- [x] **SUP-06:** Supplier presentation removed; no live purchasing integration claimed.
- [ ] Batch-level expiration tracking, stock editing and real inventory ingestion.

## 11. AI Assistant and contextual AI

**Current implementation supersedes the earlier placeholder restriction.** The user’s latest request enabled the advisor and contextual workflows. See [AI_FEATURES.md](AI_FEATURES.md) for the current feature map, purple treatment, access setup, validation, caching and limitations. The original brief’s no-chatbot-first approach is retained through contextual page actions; the advisor now supports a single grounded question at a time.

### Implemented now

- Gemini structured output through one Tactical-local transport; no provider-failure demo substitution.
- Purple AI controls, findings, classifications, drafts, photo estimates and applied AI object/move provenance.
- Evidence-cited floor/review/finance/supply findings; exact review-quote validation; complete classification of the bounded review sample.
- Explicit preview/apply/reject for validated layout moves and editable object suggestions before manual placement.
- Editable review replies and job drafts, copy actions and no publishing.
- Single-turn advisor grounded in current Tactical context, with unavailable data declared.
- Signed workspace access cookie, same-origin actions, bounded request streams, deadlines and local request budgets.
- Ten-minute exact-context/model/prompt cache with visible provenance; changed layout/instructions disable stale reuse.

- [x] **AI-01:** Local structured result/evidence schemas and bounded tasks.
- [x] **AI-02:** Existing evidence/object/menu IDs and verbatim review excerpt validation. This does not guarantee all generated prose is factually correct.
- [x] **AI-03:** Shared Gemini adapter; canonical financial calculations remain TypeScript.
- [x] **AI-04 · Workspace demo scope:** Visible data-sending explanation and user-triggered generation; exact generic errors with no fallback.
- [x] **AI-05 · In-memory scope:** Model/prompt/context-keyed cache and stale-result controls. Durable/account-scoped history is still missing.
- [x] **AI-06 · Updated user scope:** Advisor placeholder replaced by a usable single-turn workflow. No Expansion data or multi-turn memory.

Remaining: production user/role authentication, distributed limits and quotas, durable analysis history, imported review datasets, observed social graphs, and external integrations. The current shared access code is not a full account system.

## 12. Integrations and Expansion coordination

| Service/track | Current Tactical implementation | What is still required |
| --- | --- | --- |
| Gemini | Shared text/vision adapter and Tactical page workflows; live text requests verified | Real-photo accuracy/measurement validation, account-scoped production controls and durable history |
| Capital One Nessie | Live sandbox adapter + cash-planning UI; approved records seeded, account configured, authenticated browser journey verified | Confirm official challenge criteria and prepare any required submission artifacts |
| CoStar | No Tactical adapter | Agreed property/building record handoff with Rain; authorized relevant fields; manual geometry fallback |
| Arlequin Track 2 | Content + actor-connectivity pipeline implemented; public observed source and complete Gemini annotations verified | Submission video/report and explicit sampling/AI limits; no coordination or causal-spread claims |
| Amazon AI | No verified Tactical Amazon integration | Verify challenge/service requirements; Gemini use does not prove eligibility |
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
- Missing/failed photo AI now returns only Something is wrong; no automatic sample fallback. Manual Sample plan remains separate.
- Legacy extra routes redirect to Floor Plan.
- Firefox's restored disabled button state is disabled via `StateButton`; Chrome/Firefox reload behavior has regression coverage.

### Remaining cross-cutting work

| ID | Priority | Work and reason |
| --- | --- | --- |
| QA-01 | Delivered for mocks | Central fixture and server-selected restaurant context; real-data ingestion still pending |
| QA-02 | Delivered for mocks | Ledger reconciliation and canonical capacity math; unsupported average-order metric removed |
| QA-03 | P1 | Separate library persistence/editor actions into tested helpers or hooks; workspace currently carries many responsibilities |
| QA-04 | P1 | Avoid treating a hidden mounted panel as an independently loaded page; consider lazy mounting only with explicit state preservation |
| QA-05 | Partial | Library stale-tab changes block writes and allow explicit reload/export/recovery. Scenario writes still need their own conflict/recovery policy; simultaneous browser writes are not an atomic transaction |
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
| 6 | Contextual AI review findings/replies | Existing server provider, review evidence | Step 2 | Validated citations, generic failure without fallback, copyable human-edited replies |
| 7 | Floor analytics and photo conversion | Main editor, photo draft/schema, insights | Measurement/provenance decisions | Confirmed conversion to new layout; supported operational metrics only |
| 8 | HR/Supply demo completion | Existing pages | Step 1 | Consistent derived totals, fictional contacts/costs and preview-only actions |
| 9 | Conditional sponsor work | Separate adapters | Credentials, permitted datasets, verified requirements | Real end-to-end integration proof, demo/live states separated |
| 10 | Final UX, reliability and release review | Existing tokens and browser tests | Core journeys stable | Keyboard/mobile/reload/error journeys verified, docs match code |

Small corrections such as finance labeling and zero guards can ship alongside the first steps. Do not delay functional review/finance data work for full 3D, NPCs, generic chat, production HR or purchasing.

### Module follow-ups — proposals unless marked implemented

| Proposed module | Purpose |
| --- | --- |
| `domain/restaurant-data.ts` | Dataset/provenance boundaries and normalized restaurant context |
| `domain/review-import.ts` | Bounded import validation and mapping rules |
| `domain/finance.ts` (now implemented) | Record aggregation, channel contribution and pricing math |
| `domain/findings.ts` | Evidence-linked structured finding schema |
| `frontend/data/` fixture manifest or expanded JSON | Editable synthetic restaurant, finance, HR, supply and photo records |
| `frontend/layout-storage.ts` or extracted storage helpers | Named-library persistence/migration separate from rendering |
| `backend/ai/` | Provider adapter and bounded review-analysis workflows, if justified by actual reuse |
| `backend/adapters/` | Nessie/property/review sources only as real integrations are implemented |

Use the existing frontend/domain/backend separation. Do not create empty directories or a large generic framework simply to match this proposal.

## 15. Verification and acceptance journeys

### Last completed code verification

The MongoDB/data increment ran and passed:

- 134 repository unit tests after merging Rain’s latest commits; all passed, including 28 Tactical tests.
- 8 Tactical browser runs: four journeys each in Chromium/Chrome and Firefox, against MongoDB mock data.
- ESLint, TypeScript typecheck and production build.
- Browser journeys cover named-layout save/rename/delete/baseline/metadata, photo selection/invalid import/redirects/mobile navigation, disabled-state reload behavior, and financial filters/pricing with HR/Supply data.

Live Atlas create/read/validate/update and 401/409 behavior were also verified. That earlier verification did not cover AI. Live Gemini text verification is recorded in the latest AI batch below; full accessibility and exhaustive visual testing remain incomplete. The main suite is stronger around geometry/calculations/storage than around newer financial and supporting-page behavior.

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
| Provider integration | Authorized real request, schema-valid response, timeout/error handling and no fabricated fallback |
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
- [x] HR/Supply demo labels and a purple, evidence-linked single-turn advisor.
- [x] Failed/missing AI provider shows only Something is wrong, without fallback results.
- [x] Code checks and the documented browser regression suite passed in the preceding implementation work.

### Still required for the full refinement brief

- [x] Every page consumes a server-selected restaurant/data context with centralized editable fixtures (interactive picker deferred).
- [ ] Review analysis works on authorized imports, not only authored themes.
- [ ] Review trends, menu intelligence and evidence-linked contextual findings work with visible sample sizes.
- [x] Current mock financial indicators reconcile to validated records and explicit formulas.
- [x] Current unsaved pricing experiments model dine-in/delivery costs and demand assumptions.
- [ ] Floor Plan and Finance share deliberate assumptions and scenario connections.
- [ ] Measured operational analytics and richer seating hypotheses are connected where data supports them.
- [ ] HR and Supply contain their remaining requested demo fields and consistent derived values.
- [ ] Responsive, keyboard, reduced-motion and failure/recovery journeys have a complete audit.
- [ ] Conditional external integrations have separate, verifiable proof before being claimed.

**Current next implementation focus (user-prioritized):** continue main floor-plan work: wall/window semantics, deliberate layout preference comparisons, review-linked interior hypotheses, and shared Floor Plan/Finance assumption context. Photos are deferred. REV-01/REV-02, saved pricing scenarios and authenticated cloud synchronization remain queued. DATA-01 through DATA-04 and the mock ledger/unit-economics foundation are delivered.

### Integration check after Rain’s latest push

Merged remote `974622d` while preserving Expansion and shared Mongo helper code. Resolved only package script/dependency declarations; both sets of commands remain available. The combined app passed 134 unit tests, lint, typecheck and production build. The build reports two filesystem-tracing warnings at `src/features/expansion/backend/runs.ts` (dynamic run-storage paths); Rain should review deployment tracing scope. Tactical browser verification above preceded this merge; no Tactical runtime code changed during the merge.

### Main floor-plan improvement batch

Implemented after the user prioritized floor-plan work and deferred photos. Added `frontend/layout-storage.ts`, `components/library-backup.tsx`, seat-ownership validation in `domain/schemas.ts`, geometry helpers in `domain/layout.ts`, inspector/custom-object controls and reversible finding previews. No new dependencies, MongoDB writes, Expansion changes or photo implementation changes.

Focused checks cover legacy/version-2 capacity, invalid ownership, rotated/diagonal gaps, blocked move proposals, stale writes, corrupted backups and storage failures. Browser journeys cover chair assignment and baseline refresh, custom metadata reload, proposal apply/reject/undo, backup recovery and two-tab conflicts. See [floor-plan guide](FLOOR_PLAN_GUIDE.md).

Verification for this floor-plan batch: **140 unit tests**, **16 browser runs** (eight journeys in Chrome and Firefox), lint, typecheck and production build passed. The browser run found and prompted a fix for an import/initial-storage-load race; editing now waits for initialization. The build retains the two previously documented Expansion filesystem-tracing warnings.

### AI implementation batch

Gemini credentials are kept in ignored local environment configuration. Live schema-valid responses were verified for all eight text tasks on synthetic restaurant data. Browser tests distinguish controlled test responses from provider verification. Photo AI shares Gemini and now fails closed rather than silently producing a sample. See the dedicated AI guide for exact boundaries.

AI verification: **147 unit tests**, **24 Chrome/Firefox browser runs**, lint, typecheck and production build passed. Authenticated live review generation succeeded against the running MongoDB-backed app; unauthenticated and post-lock requests returned 401. Desktop/mobile purple rendering was inspected with no horizontal overflow at 390 px. Browser test responses are controlled test fixtures; separate Gemini live calls verified all eight text workflows.

Photo verification: the Gemini photo handler returned a validated estimate from a synthetic floor-plan screenshot. Real-photo measurement accuracy remains unverified. Earlier invalid door-position output correctly returned Something is wrong; the clarified fractional-unit prompt passed.
