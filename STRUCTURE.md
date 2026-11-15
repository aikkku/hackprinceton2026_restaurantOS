# RestaurantOS repository structure

Asilbek owns **Tactical**, which helps owners improve their existing restaurant. Rain owns **Expansion**, which helps owners evaluate new locations. Both features use the same Next.js app and keep their implementation under `src/features/`. [Repository guidance](AGENTS.md)

## Where things live today

| Path | What to change here |
| --- | --- |
| [`src/app/`](src/app/) | Next.js route entries and root layout. [`page.tsx`](src/app/page.tsx) renders the Sprout welcome page; `/onboarding` is setup and `/register` redirects to it. Direct workspace routes are preserved. [`globals.css`](src/app/globals.css) defines existing app-wide colors, typography, and spacing. |
| [`tactical/frontend/components/onboarding/`](src/features/tactical/frontend/components/onboarding/) | Sprout welcome and three-step demo onboarding, styles and code-native restaurant illustration; brand and tokens are reused from adjacent `sprout/`. `frontend/onboarding-store.ts` saves only basic answers in this tab; file names remain in memory. `domain/onboarding.ts` validates drafts and derives counts; `backend/onboarding.ts` reads the configured mock dataset through `/api/tactical/onboarding` without writing data. |
| [`src/app/tactical/page.tsx`](src/app/tactical/page.tsx) | `/tactical` page metadata; `src/app/tactical/layout.tsx` mounts the persistent Tactical workspace. Six section routes select its visible view. |
| [`tactical/frontend/tactical-page.tsx`](src/features/tactical/frontend/tactical-page.tsx) | Server-loads the validated dataset through backend/load-dataset.ts (explicit demo or MongoDB) and passes it to the workspace. |
| [`tactical/frontend/data/demo-restaurant.json`](src/features/tactical/frontend/data/demo-restaurant.json) | Single editable mock dataset: core restaurant plus HR, supply, finance, photo examples, layout configurations and scenario snapshot. |
| [`tactical/frontend/components/`](src/features/tactical/frontend/components/) | `tactical-workspace.tsx` owns the shared shell. `floor-editor.tsx` owns editing, shortcuts, version selection and seating analysis. `floor-plan.tsx` handles canvas gestures, hit targets and placement warnings. `floor-scene-art.tsx`/`.css` render room materials and furniture details; `floor-editor.css` owns the editor palette/layout. |
| [`tactical/frontend/layout-edit.ts`](src/features/tactical/frontend/layout-edit.ts) | Converts entered furniture measurements and validates the resulting geometry. [`layout-transfer.ts`](src/features/tactical/frontend/layout-transfer.ts) validates imported layout files. |
| [`tactical/frontend/storage.ts`](src/features/tactical/frontend/storage.ts) | Reads browser-saved drafts and scenarios, retains compatible older snapshots, and recovers valid scenarios alongside damaged entries. The workspace saves layouts and scenarios separately in `localStorage`. |
| [`tactical/domain/`](src/features/tactical/domain/) | `layout.ts` handles geometry and seat counts. `layout-library.ts` validates named configurations and derives explicit proximity heuristics. `analyze.ts` validates photo requests/drafts and rotates geometry. `scenario.ts` computes seating and turnover projections and verifies saved results. `reviews.ts` counts supplied review themes and filters their sources. `schemas.ts` validates fixtures, layouts, assumptions, and scenario snapshots. |
| [`tactical/backend/`](src/features/tactical/backend/) | `mongodb.ts`, `load-dataset.ts`, `data-api.ts` and CLI tools own dataset storage/import. `analyze.ts` owns photo AI. Nessie reads live sandbox records through `backend/adapters/nessie.ts`; sponsor services protect bank reads and graph AI interpretation. Full user accounts remain deferred. |
| [`tactical/tactical.test.ts`](src/features/tactical/tactical.test.ts) | Tests fixture evidence links, geometry, capacity, and financial calculations. Adjacent test files cover turnover, review summaries, layout files, precise edits, and saved-data recovery. |
| [`src/features/expansion/`](src/features/expansion/) | Rain's Expansion workspace: `frontend/` owns UI, API loading, fixtures and browser storage; `domain/` owns validation, scoring and finance; `backend/` streams permitted local data into a rebuildable SQLite cache and serves bounded queries. |

Start with the [Tactical documentation index](docs/tactical/README.md) and [detailed implementation inventory](docs/tactical/IMPLEMENTATION_STATUS.md).

The [Sprout redesign plan](docs/tactical/DESIGN_REDESIGN_PLAN.md) maps every page's design changes and functionality-preservation gates. Onboarding, the laptop shell, the detailed Floor Plan scene and Customer Reviews/Social Media are implemented; HR is next. `src/features/tactical/frontend/components/sprout/` contains the shared Tactical tokens, brand and workspace shell. Onboarding reuses those primitives. Rain's existing Expansion design remains under his ownership; its contracts/styles are unchanged.

See [current page guide](docs/tactical/PAGES.md) and [refinement status / remaining work](docs/tactical/IMPLEMENTATION_STATUS.md). `layout-library.tsx` presents saved layout actions and comparisons; the workspace persists them under a restaurant-scoped library key while retaining the old single-draft key for migration.

The current path through Tactical is `/tactical` → validate the demo fixture → open the workspace → edit the layout → calculate the seating scenario → inspect evidence or save a snapshot. All demo interactions work without credentials.

Follow the [Tactical frontend walkthrough](docs/tactical/FRONTEND_WALKTHROUGH.md) to review the editor, customer signals, seating/turnover experiments, and saved comparisons one step at a time.

## Tactical structure for Asilbek and Rain

```text
src/app/tactical/
├── layout.tsx                          # Persistent shell mounts TacticalPage
├── page.tsx                            # Floor Plan route metadata
├── reviews/page.tsx                    # Customer feedback section metadata
├── hr/page.tsx                         # Team demo section metadata
├── supply/page.tsx                     # Inventory/supplier section metadata
├── finance/page.tsx                    # Finance section metadata
├── ai/page.tsx                         # Inactive assistant section metadata
└── {scenarios,decisions,analyze}/page.tsx # Compatibility redirects to Floor Plan
src/app/api/tactical/analyze/route.ts    # Thin re-export of backend handler
src/features/tactical/
├── domain/
│   ├── schemas.ts                      # Core fixture/layout/scenario contracts
│   ├── layout.ts                       # Geometry, palette and capacity
│   ├── layout-library.ts               # Saved configurations and explicit heuristics
│   ├── scenario.ts                     # Canonical seating/turnover arithmetic
│   ├── reviews.ts                      # Deterministic review aggregation/filtering
│   └── analyze.ts                      # Photo draft/request schemas and geometry
├── frontend/
│   ├── tactical-page.tsx               # Validate core fixture, mount workspace
│   ├── storage.ts                      # Legacy layout + saved scenario recovery
│   ├── layout-edit.ts                  # Validated object measurement updates
│   ├── layout-transfer.ts              # Main-layout JSON import validation
│   ├── analyze-lessons.ts              # Browser correction memory for photo prompts
│   ├── data/demo-restaurant.json        # Core editable demo; not yet all demo records
│   ├── components/                     # Workspace, canvases, inspectors, six sections
│   │   ├── tactical-workspace.tsx       # Also currently owns library reads/writes
│   │   ├── state-button.tsx             # Browser-safe dynamic disabled state
│   │   └── *.css                       # Tactical component styling
│   └── e2e/refinement.spec.ts           # Layout, photo and hydration browser journeys
├── backend/
│   ├── analyze.ts                      # Anthropic photo request / labeled fallback
│   └── README.md
└── *.test.ts                           # Unit tests for contracts/calculations/recovery
playwright.tactical.config.ts           # Separate Chrome/Chromium + Firefox suite
```

Section routes select mounted panels inside the workspace; they do not currently own independent page-state components. The main editor stores meters; the photo editor stores a separate approximate-feet draft. No conversion adapter connects the two yet.

All business mocks now live in the validated `demo-restaurant.json` dataset. `domain/dataset.ts` owns the aggregate contract and `domain/finance.ts` owns ledger/contribution arithmetic. `backend/mongodb.ts` uses the shared **restaurantos** database and Tactical-owned **tactical_datasets** collection. API route entries at `/api/tactical/restaurants`, `/api/tactical/restaurants/[restaurantId]/dataset` and `/api/tactical/datasets/validate` expose authenticated list/read/upload/preflight operations. See [MongoDB setup/API guide](docs/tactical/MONGODB_SETUP.md). Existing browser editor storage is not automatically cloud-synchronized.

Rain can follow the same route/frontend/domain/backend boundary without importing Tactical internals. Any shared restaurant, evidence, scenario or action type still needs agreement in the shared-contract proposal.

## Expansion layout for Rain

`/expansion` mounts the scouting workspace with explicit Demo and Local dataset modes, using the same frontend/domain/backend separation as Tactical. [Expansion spec](docs/expansion/EXPANSION_SPEC.md) · [Map and scoring spec](docs/expansion/MAP_AND_SCORING_SPEC.md)

```text
src/
├── app/
│   └── expansion/page.tsx               # /expansion route and page metadata
└── features/
    └── expansion/
        ├── AGENTS.md                    # Existing Expansion guidance
        ├── frontend/
        │   ├── expansion-page.tsx       # Choose mode, load markets and restore browser storage
        │   ├── components/              # Map, area and property inspectors, compare view
        │   │   └── map/scout-map.tsx    # MapLibre layers and geographic fallback
        │   ├── data/demo-market.json    # Labeled example market, areas, and properties
        │   ├── data/demo-market.ts      # Validated, cancellable fixture loader
        │   ├── storage.ts               # Legacy demo and version-2 local snapshots
        │   └── e2e/expansion.spec.ts     # Browser flow and route-isolation checks
        ├── domain/
        │   ├── schemas.ts               # Separate schemas for H3 areas and property records
        │   ├── scoring.ts               # Suitability scores, factor weights, and coverage
        │   ├── scenario.ts              # Rent normalization and break-even calculations
        │   ├── provider.ts              # Injectable fixture-provider interface
        │   └── local-data.ts            # Ingestion and bounded API schemas
        ├── backend/                     # Local streaming ingestion, SQLite, bounded server queries
        ├── data/                        # Existing private-data manifest; never frontend assets
        └── expansion.test.ts            # Tests for scoring, rent units, and missing data
```

The route entry mounts the feature. The frontend owns rendering, selection, cancellable viewport requests, and browser state. The domain owns validation and deterministic calculations used by both frontend and backend. `domain/local-data.ts` validates normalized ingestion records and API queries/responses. `src/app/api/expansion/{markets,query,properties/[id]}/route.ts` are Node route handlers; only the backend reads private source files and SQLite. No second backend service is required.

Expansion's path is `/expansion` → choose Demo or Local dataset → choose a supported market → scout a bounded area/property or lease space → edit cost assumptions → compare, save and restore. Local records are dated snapshots with unknown current availability; unsupported area rankings stay unscored. Expansion styles are scoped to `.expansion-app`; both features inherit existing tokens and Geist. The root now shows Sprout welcome, while direct `/tactical` and `/expansion` routes remain available. No Tactical internals are imported by Expansion. See [implementation notes](docs/expansion/IMPLEMENTATION.md) and the [private-data manifest and import commands](src/features/expansion/data/README.md).

Keep imports within each feature. Coordinate the app shell, design tokens, restaurant identity, evidence and scenario contracts, and any handoff between Tactical and Expansion. Until both owners agree, keep the schemas and calculations used by one feature in that feature's `domain/`. [Game design](docs/GAME_DESIGN.md) · [Shared contract proposal](docs/tactical/SHARED_CONTRACT_PROPOSAL.md)

## Run and verify locally

Use Node.js 22.18 or newer. Run `npm ci` and `npm run dev`, then open `/tactical` or `/expansion`. The verification commands are `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `npm test` runs both features with Node's built-in test runner. Expansion browser tests run with `npm run test:e2e` after `npx playwright install chromium`, or use installed Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. [Package scripts](package.json)

For Tactical browser regressions, build first and run `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.tactical.config.ts`. This config uses port 3057 and Firefox as well as Chrome/Chromium; install the required browsers. The default root Playwright config continues to target Expansion.

### Floor-plan editing increment

`src/features/tactical/frontend/layout-storage.ts` handles full-library backup validation and stale-write/recovery checks; `components/library-backup.tsx` presents preview/apply/export actions. `domain/layout.ts` owns footprint-gap and proposed-move calculations; `domain/schemas.ts` accepts legacy layout v1 and ownership-aware layout v2. All changes stay Tactical-local. See [floor-plan guide](docs/tactical/FLOOR_PLAN_GUIDE.md).

### Tactical AI

`domain/ai.ts` defines validated AI contracts; `backend/gemini.ts`, `ai-context.ts`, `ai-service.ts` and `ai-access.ts` own provider requests, evidence, caching and signed access. Thin routes live at `src/app/api/tactical/ai/` and its `session/` subroute. `frontend/components/ai-workbench.tsx` and `ai.css` centralize purple AI controls/results. Photo analysis shares the Gemini/access boundary. See [AI guide](docs/tactical/AI_FEATURES.md).

## Tactical sponsor workflows

See [sponsor integration guide](docs/tactical/SPONSOR_INTEGRATIONS.md). `domain/nessie.ts` and `domain/network.ts` own contracts and deterministic math; `backend/adapters/nessie.ts` owns provider calls; `backend/{nessie,network}-service.ts` own protected orchestration. Thin endpoints live under `src/app/api/tactical/integrations/`. `frontend/components/{nessie,network}-panel.tsx` provide Finance/Reviews tools. Editable sponsor mocks are separate `frontend/data/demo-nessie.json`, `demo-nessie-customer.json` and `demo-network.json`. Rain’s module and shared integration contracts are unchanged.

## Message content and actor connectivity

The Arlequin Track 2 workflow lives in Tactical: `domain/social.ts` owns message schemas and graph/content joins; `backend/adapters/hacker-news.ts` collects a bounded public conversation; `backend/social-service.ts` validates source/AI requests; thin routes live at `src/app/api/tactical/integrations/social/{source,analyze}/route.ts`. `frontend/components/social-pipeline.tsx` renders Reviews → Content & connectivity, and `frontend/data/demo-social.json` is its editable fictional fixture. See [the complete pipeline and requirement map](docs/tactical/ARLEQUIN_TRACK2.md).

### Saved review intelligence

`domain/review-analysis.ts` validates AI triage; `backend/review-analysis.ts` processes only new/edited reviews, and `review-analysis-store.ts` persists results and leases in the shared database's `tactical_review_analysis` collection. The thin API lives at `src/app/api/tactical/reviews/analysis/route.ts`. Dataset uploads invoke the same processor after saving. `frontend/use-review-analysis.ts` loads and resumes classification; `components/review-insights.tsx` renders AI filters; `components/review-reply.tsx` provides editable/copyable drafts with a disabled posting control. See [review behavior and persistence](docs/tactical/REVIEW_WORKFLOW.md).

## HR calendar, assessments and hiring

`domain/workforce.ts` validates dated shifts and weekly item demand; `domain/hr.ts` calculates staffing/sales metrics and validates AI outputs. `backend/hr-service.ts` handles Gemini and the shared database’s `tactical_hr_analysis` collection behind `src/app/api/tactical/hr/route.ts`. UI is split into `hr-page.tsx` (assessment/team), `hr-calendar.tsx` (schedule), `hr-hiring.tsx` (editable role drafts) and `hr.css`. All editable mock input remains in `frontend/data/demo-restaurant.json`. See [HR workflow, assumptions and remaining work](docs/tactical/HR_WORKFLOW.md).

## Inventory presentation

`frontend/components/supply-page.tsx` and `supply.css` render searchable inventory cards with expiration dates and expandable stock details. `domain/dataset.ts` accepts an optional nullable ISO `operations.inventory[].expirationDate`; the editable fixture supplies mock dates (null for packaging). Supplier records remain a legacy data relationship, with no supplier UI. Floor collision severity uses `domain/floor-editor.ts` → `floor-plan.tsx` and `floor-editor.css`: overlap red, proximity yellow.

## Proposed connected Tactical architecture

[Connected data and AI plan](docs/tactical/CONNECTED_DATA_AND_AI_PLAN.md) describes the current fragmentation, proposed shared context service, durable AI run/artifact/decision storage, frontend invalidation and staged migration. Proposed paths are not yet implemented. Supply Management is now inventory-only with no AI controls or dedicated AI task.

## Financial Intelligence report

`domain/finance-report.ts` owns the optional dated item-sales schema and pure report/playground calculations. `frontend/components/finance-page.tsx` composes `finance-insights.tsx`, `price-playground.tsx`, `finance-ledger.tsx` and existing Nessie tools; `finance-report.css` scopes presentation. `operations.financeReport` in the central demo JSON supplies editable mock sales. `backend/ai-context.ts` exposes the same calculated report to Finance and the advisor. See [finance workflow](docs/tactical/FINANCE_WORKFLOW.md). No Expansion or shared contracts changed.

## Cash calendar

`domain/cash-calendar.ts` owns cash schemas, recurrence and deterministic projections. `backend/cash-calendar-service.ts` owns bank snapshots/forecast persistence and the protected `/api/tactical/cash-calendar` route; `backend/cash-calendar-cli.ts` seeds missing mock data without replacing existing restaurant fields. `frontend/components/cash-calendar.tsx` and `.css` provide the Finance tab. Data lives in `operations.cashCalendar` plus Tactical-only MongoDB collections. See [cash calendar guide](docs/tactical/CASH_CALENDAR.md).

### Customer Reviews presentation

`frontend/components/review-insights.tsx` owns the three-view navigation and review layout. `review-insights.css` scopes Sprout cards, filters, AI treatments and network styling to this page. `network-panel.tsx` retains graph calculations/import/export and presents filters beside the graph; `social-pipeline.tsx` retains the content/connectivity workflow with a keyboard-focusable source timeline. `review-reply.tsx`, the review-analysis hook and backend remain the existing behavior layer. See [review workflow](docs/tactical/REVIEW_WORKFLOW.md).
