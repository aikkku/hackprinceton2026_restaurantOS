# Expansion MVP — implementation notes

## Implemented flow

Open `/expansion` directly; the shared `/` redirect remains `/tactical`. Choose the Houston demo market, scout 19 resolution-8 H3 areas, inspect four fictional spaces, edit an opening scenario, compare two snapshots, save, reload, and restore. Analyst Details exposes sources, units, formulas, missing factors and model versions. The drawer supports Escape and focus return; list controls support keyboard use. Narrow layouts and reduced motion are supported.

The real 2D basemap uses MapLibre with the [OpenFreeMap Positron style](https://openfreemap.org/quick_start/); provider/OSM attribution is retained by MapLibre. It needs network access. On failure or WebGL unavailability, a labeled geographic preview and the area/property lists remain functional. The preview plots genuine H3 geometry but contains no street data. It is not a substitute sponsor integration.

## Data and numerical defaults

- `domain/schemas.ts`: Expansion-local Zod contracts for cities, cells, properties, evidence, scenario inputs/results and snapshots. Coordinates, H3 membership, rent units, unique identifiers, references and consistent demo provenance are validated.
- `domain/scoring.ts` owns area scoring; `domain/scenario.ts` owns rent normalization and financial calculations. Neither imports frontend or backend code.
- `domain/provider.ts`: `ExpansionProvider.load(signal)` boundary. `frontend/data/demo-market.ts` validates the committed fictional `demo-market.json`. Its `authorized` mode is reserved for a future server-backed adapter; the current UI is explicitly a demo. No CoStar, ACS, Places, Matterport, Vexcel, AI or finance API is connected.
- Private incoming datasets remain separate in `data/`, governed by the existing `data/README.md` manifest and ignore rules. They are not imported into frontend bundles. No private records are loaded, published, copied, or modified by this refactor.
- All fixture properties, availability, previous use, rent and market indices are fictional. Markers are placed at H3 cell centers, not verified listing addresses. Evidence dates and unsupported attributes remain unavailable.
- Area model `expansion-area-demo-v1`: weights 30 demand / 25 similarity / 20 competition / 25 cost, editable 0–100. Synthetic favorable indices use identity normalization. Cost fit = clamp(100 × (1 − fictional average area base rent / (2 × monthly budget)), 0, 100). Budget equals a score of 50; twice budget equals 0. This is a disclosed planning convention, not an empirically calibrated model.
- Coverage = available intended weight / total intended weight. Minimum 70%; lower coverage and zero total weight are unscored. Weighted means use available factors only; omitted factors and contributions are disclosed. Different factor sets are not equivalent comparisons. Fictional area rent aggregates are independent demonstration inputs, not derived from the four listing records.
- Default filters: monthly base-rent budget $8,000 and minimum floor area 0. Missing rent/size are excluded; unknown availability remains labeled. No property fit score or permitted-use verification is asserted.
- Finance model `expansion-finance-v1`: annual rent per sq ft × area / 12; occupancy = base rent + pass-throughs; fixed costs = occupancy + other fixed costs; required sales = fixed costs / positive contribution margin. No expected sales are invented.
- Illustrative editable assumptions: $750 monthly pass-throughs, $6,000 other fixed monthly costs, 35% contribution margin, $90,000 initial investment and $25,000 working capital. Source base rent initializes the scenario; edited rent is an assumption. No automatic build-out discount is inferred from previous use.
- Contribution after fixed costs = explicit assumed sales × contribution margin − fixed costs. Investment payback requires positive contribution. Reserves are added to initial cash and excluded from monthly costs and investment payback. Financing, taxes, timing and unmodeled costs are excluded. These are thresholds and scenarios, not demand forecasts or net-profit guarantees.

## Save, compare and failure behavior

Browser key: `restaurantos.expansion.demo.scenarios.v1`. Up to 50 version-1 snapshots preserve restaurant/property identity, inputs, exact results, evidence references, weights, budget, assumptions and model versions. Comparison holds two immutable snapshots and does not modify a listing or baseline.

Reads validate schema/model versions and recompute results before accepting saved data. Invalid storage is preserved and saving is disabled until the user explicitly clears it. Storage write failures preserve the draft and previous in-memory saved state. Saves are browser-local, with no account backup. Loading, source failures with retry, empty filters, unknown fields, invalid assumptions and map errors have explicit UI states. A failed real source must never silently become fixtures.

## Shared setup coordination for Asilbek

Aligned with the committed `STRUCTURE.md` and shared setup from main. Expansion uses the existing Next.js/React/Zod/Lucide versions, Geist font, TypeScript/ESLint configuration, root layout and global tokens. Only H3, MapLibre, GeoJSON types and Playwright are added to the existing manifest/lockfile. Exact resolved versions are in `package-lock.json`; use `npm ci`. Unit tests use the repository's Node test runner for both domains; there is no separate Vitest configuration.

`src/app/expansion/page.tsx` only mounts `frontend/expansion-page.tsx` and supplies route metadata. The page loads/validates demo data, restores browser state and mounts `frontend/components/expansion-workspace.tsx`. Browser storage lives in `frontend/storage.ts`, map rendering in `frontend/components/map/scout-map.tsx`, pure calculations in `domain/`, and future server adapters in `backend/`. These match the documented ownership boundaries.

The shared root route/layout/global stylesheet, Next/TypeScript/ESLint configuration, root guidance, Tactical files and private-data manifest are unchanged from main. Every Expansion CSS selector is scoped to `.expansion-app`, including media rules and generic button/field/card classes. Map-only palette tokens are scoped there and inherited from the same host by MapLibre. The feature header links to `/tactical` without importing Tactical code. Snapshot keys, schema/model versions, demo inputs and calculations are preserved.

Future coordination: a finalized shared `GameShell`, restaurant identity/evidence/scenario contracts, production persistence, map hosting and user-approved domain handoff. No shared API is frozen by this refactor. The previous local implementation is preserved in a Git safety stash labeled `codex: preserve Expansion MVP before STRUCTURE alignment`.

## Validation and demo walkthrough

Automated unit tests cover scoring/coverage and invalid weights, budget-sensitive normalization, rent units, missing/invalid data, margins, payback, reserves, deterministic outputs, fixture mapping/references, cancellation, snapshot round trips, incompatible/corrupt records, tampered results, and write failures. Playwright covers the full user journey, persisted restore, Analyst Details, keyboard area selection, map failure, empty filters, zero weights, corrupt storage, mobile sizing and reduced motion.

Demo: inspect Canopy Corner → Try opening here → see approximately $30,714 required monthly sales → change pass-throughs to $1,000 → enter assumed sales of $50,000 → compare and save → inspect Garden Arcade → try and compare → open Analyst Details → reload and Restore the saved plan. No manual source edits are necessary.

Validation after structural alignment includes both domains' unit tests, lint, typechecking, production build, the complete Expansion browser flow and a client-navigation check for CSS leakage into Tactical. The prior live-map browser check verified street tiles, hex clicks, property-pin clicks and synchronized inspectors; this refactor keeps that behavior and the existing snapshot format.

Verified after reorganization: `npm run lint`, `npm run typecheck`, `npm test` (31 tests: 23 Expansion + 8 Tactical), `npm run build` (both `/tactical` and `/expansion`), and `PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` (5 tests) passed. Git reports no unresolved merge paths; Tactical and the existing shared root configuration have no diff against the fetched main baseline.

## Deferred Stage 2

Inspect incoming data schemas, rights, source dates and geographic coverage before building an authorized server-side provider. Determine defensible real-data normalizations before enabling real area rankings. Add ACS/Places factors and top-ten-cell searches only with working inputs. Matterport/Vexcel-derived measurements require confidence/estimate labels and visible rejection reasons. Up-to-three finalists, grounded explanations, and scheduled daily search/text alerts follow only after their integrations and permissions are established. Shared contracts/persistence and cross-domain navigation remain coordinated work.
