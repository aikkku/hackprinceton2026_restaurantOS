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
| [`src/features/expansion/`](src/features/expansion/) | Rain's feature directory. It currently contains [Expansion guidance](src/features/expansion/AGENTS.md). |

The current path through Tactical is `/tactical` → validate the demo fixture → open the workspace → edit the layout → calculate the seating scenario → inspect evidence or save a snapshot. All demo interactions work without credentials.

## Suggested Expansion layout for Rain

`/expansion` and the filenames below are proposed. Start with the route, a workspace, and a labeled demo fixture. Add files as the related feature is built. [Expansion spec](docs/expansion/EXPANSION_SPEC.md) · [Map and scoring spec](docs/expansion/MAP_AND_SCORING_SPEC.md)

```text
src/
├── app/
│   └── expansion/page.tsx               # /expansion route and page metadata
└── features/
    └── expansion/
        ├── AGENTS.md                    # Existing Expansion guidance
        ├── frontend/
        │   ├── expansion-page.tsx       # Validate demo data and mount the workspace
        │   ├── components/              # Map, area and property inspectors, compare view
        │   └── data/demo-market.json    # Labeled example market, areas, and properties
        ├── domain/
        │   ├── schemas.ts               # Separate schemas for H3 areas and property records
        │   ├── scoring.ts               # Suitability scores, factor weights, and coverage
        │   └── scenario.ts              # Rent normalization and break-even calculations
        ├── backend/                     # Authorized property providers and persistence later
        └── expansion.test.ts            # Tests for scoring, rent units, and missing data
```

The route entry mounts the feature. The frontend owns rendering, selection, and browser state. The domain owns validation and deterministic calculations that frontend and future backend code can both call. When an authorized property provider is available, its backend adapter can normalize records to the same Expansion schemas used by the fixture.

Keep imports within each feature. Coordinate the app shell, design tokens, restaurant identity, evidence and scenario contracts, and any handoff between Tactical and Expansion. Until both owners agree, keep the schemas and calculations used by one feature in that feature's `domain/`. [Game design](docs/GAME_DESIGN.md) · [Shared contract proposal](docs/tactical/SHARED_CONTRACT_PROPOSAL.md)

## Run and verify locally

Use Node.js 22.18 or newer. Run `npm ci` and `npm run dev`, then open `/tactical`. The current verification commands are `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `npm test` currently targets Tactical, so update the script when Expansion tests are added. [Package scripts](package.json)
