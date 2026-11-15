# RestaurantOS repository structure

Asilbek owns **Tactical**, which helps owners improve their existing restaurant. Rain owns **Expansion**, which helps owners evaluate new locations. Both features use the same Next.js app and keep their implementation under `src/features/`. [Repository guidance](AGENTS.md)

## Where things live today

| Path | What to change here |
| --- | --- |
| [`src/app/`](src/app/) | Next.js route entries and root layout. [`page.tsx`](src/app/page.tsx) redirects `/` to `/tactical`. [`globals.css`](src/app/globals.css) defines app-wide colors, typography, and spacing. |
| [`src/app/tactical/page.tsx`](src/app/tactical/page.tsx) | `/tactical` page metadata; `src/app/tactical/layout.tsx` mounts the persistent Tactical workspace. Six section routes select its visible view. |
| [`tactical/frontend/tactical-page.tsx`](src/features/tactical/frontend/tactical-page.tsx) | Server-loads the validated dataset through backend/load-dataset.ts (explicit demo or MongoDB) and passes it to the workspace. |
| [`tactical/frontend/data/demo-restaurant.json`](src/features/tactical/frontend/data/demo-restaurant.json) | Single editable mock dataset: core restaurant plus HR, supply, finance, photo examples, layout configurations and scenario snapshot. |
| [`tactical/frontend/components/`](src/features/tactical/frontend/components/) | `tactical-workspace.tsx` coordinates editing, undo/redo, and saves. `floor-plan.tsx` renders the zoomable SVG scene. `layout-inspector.tsx` edits furniture measurements, and `layout-transfer.tsx` imports/exports layout JSON. `scenario-panel.tsx` owns previews and analyst details, `scenario-comparison.tsx` compares saved options, and `review-insights.tsx` explores review themes. Component CSS files use the Tactical tokens. |
| [`tactical/frontend/layout-edit.ts`](src/features/tactical/frontend/layout-edit.ts) | Converts entered furniture measurements and validates the resulting geometry. [`layout-transfer.ts`](src/features/tactical/frontend/layout-transfer.ts) validates imported layout files. |
| [`tactical/frontend/storage.ts`](src/features/tactical/frontend/storage.ts) | Reads browser-saved drafts and scenarios, retains compatible older snapshots, and recovers valid scenarios alongside damaged entries. The workspace saves layouts and scenarios separately in `localStorage`. |
| [`tactical/domain/`](src/features/tactical/domain/) | `layout.ts` handles geometry and seat counts. `layout-library.ts` validates named configurations and derives explicit proximity heuristics. `analyze.ts` validates photo requests/drafts and rotates geometry. `scenario.ts` computes seating and turnover projections and verifies saved results. `reviews.ts` counts supplied review themes and filters their sources. `schemas.ts` validates fixtures, layouts, assumptions, and scenario snapshots. |
| [`tactical/backend/`](src/features/tactical/backend/) | `mongodb.ts`, `load-dataset.ts`, `data-api.ts` and CLI tools own dataset storage/import. `analyze.ts` owns photo AI. Account persistence and sponsor adapters remain deferred. |
| [`tactical/tactical.test.ts`](src/features/tactical/tactical.test.ts) | Tests fixture evidence links, geometry, capacity, and financial calculations. Adjacent test files cover turnover, review summaries, layout files, precise edits, and saved-data recovery. |
| [`src/features/expansion/`](src/features/expansion/) | Rain's Expansion workspace: `frontend/` owns UI, API loading, fixtures and browser storage; `domain/` owns validation, scoring and finance; `backend/` streams permitted local data into a rebuildable SQLite cache and serves bounded queries. |

Start with the [Tactical documentation index](docs/tactical/README.md) and [detailed implementation inventory](docs/tactical/IMPLEMENTATION_STATUS.md).

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

Expansion's path is `/expansion` → choose Demo or Local dataset → choose a supported market → scout a bounded area/property or lease space → edit cost assumptions → compare, save and restore. Local records are dated snapshots with unknown current availability; unsupported area rankings stay unscored. Expansion styles are scoped to `.expansion-app`; both features inherit existing tokens and Geist. The root redirect remains `/tactical`. No Tactical internals are imported by Expansion. See [implementation notes](docs/expansion/IMPLEMENTATION.md) and the [private-data manifest and import commands](src/features/expansion/data/README.md).

Keep imports within each feature. Coordinate the app shell, design tokens, restaurant identity, evidence and scenario contracts, and any handoff between Tactical and Expansion. Until both owners agree, keep the schemas and calculations used by one feature in that feature's `domain/`. [Game design](docs/GAME_DESIGN.md) · [Shared contract proposal](docs/tactical/SHARED_CONTRACT_PROPOSAL.md)

## Run and verify locally

Use Node.js 22.18 or newer. Run `npm ci` and `npm run dev`, then open `/tactical` or `/expansion`. The verification commands are `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `npm test` runs both features with Node's built-in test runner. Expansion browser tests run with `npm run test:e2e` after `npx playwright install chromium`, or use installed Chrome with `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. [Package scripts](package.json)

For Tactical browser regressions, build first and run `PLAYWRIGHT_CHANNEL=chrome npx playwright test --config playwright.tactical.config.ts`. This config uses port 3057 and Firefox as well as Chrome/Chromium; install the required browsers. The default root Playwright config continues to target Expansion.
