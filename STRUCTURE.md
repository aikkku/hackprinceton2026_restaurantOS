# RestaurantOS repository structure

Asilbek owns **Tactical**, which helps owners improve their existing restaurant. Rain owns **Expansion**, which helps owners evaluate new locations. Both features use the same Next.js app and keep their implementation under `src/features/`. [Repository guidance](AGENTS.md)

## Where things live today

| Path | What to change here |
| --- | --- |
| [`src/app/`](src/app/) | Next.js route entries and root layout. [`page.tsx`](src/app/page.tsx) redirects `/` to `/tactical`. [`globals.css`](src/app/globals.css) defines app-wide colors, typography, and spacing. |
| [`src/app/tactical/page.tsx`](src/app/tactical/page.tsx) | `/tactical` entry point and page metadata. Hands rendering off to the Tactical feature. |
| [`tactical/frontend/tactical-page.tsx`](src/features/tactical/frontend/tactical-page.tsx) | Loads the demo JSON, validates it, and passes it to the workspace. |
| [`tactical/frontend/data/demo-restaurant.json`](src/features/tactical/frontend/data/demo-restaurant.json) | Edit the example restaurant, starting layout, reviews, seating mission, and default assumptions here. |
| [`tactical/frontend/components/`](src/features/tactical/frontend/components/) | `tactical-workspace.tsx` owns editor state and the mission flow. `floor-plan.tsx` renders the SVG floor plan and handles pointer interaction. `scenario-panel.tsx` owns the simulation form, results, and analysis drawer. `tactical.css` styles the feature. |
| [`tactical/frontend/storage.ts`](src/features/tactical/frontend/storage.ts) | Reads and validates browser-saved drafts and scenarios. The workspace saves them separately in `localStorage`. |
| [`tactical/domain/`](src/features/tactical/domain/) | `layout.ts` handles geometry and seat counts. `scenario.ts` computes the seating projection. `schemas.ts` validates fixtures, layouts, assumptions, and scenario snapshots. |
| [`tactical/backend/`](src/features/tactical/backend/) | Reserved for server-side data access, actions, and integrations. Tactical currently uses fixture data and browser storage. |
| [`tactical/tactical.test.ts`](src/features/tactical/tactical.test.ts) | Tests fixture evidence links, geometry, capacity, and financial calculations. |
| [`src/features/expansion/`](src/features/expansion/) | Rain's Expansion workspace: `frontend/` owns UI, API loading, fixtures and browser storage; `domain/` owns validation, scoring and finance; `backend/` streams permitted local data into a rebuildable SQLite cache and serves bounded queries. |

The current path through Tactical is `/tactical` → validate the demo fixture → open the workspace → edit the layout → calculate the seating scenario → inspect evidence or save a snapshot. All demo interactions work without credentials.

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
