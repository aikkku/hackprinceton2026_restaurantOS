# Expansion — local dataset implementation

## User journey

`/expansion` retains the existing scouting workspace. Choose **Demo** or **Local dataset**, choose a supported city, inspect an H3 area and a property/lease space, edit a financial scenario, compare two plans, save, reload and restore. Mode selection is remembered in this browser. Demo remains explicitly fictional and works without the private kit.

Local mode reads only normalized data from Next.js Node route handlers. It has cancellable, debounced viewport/filter requests, bounded pagination, selected-record details, loading/retry/empty/error states, an accessible area/property list, mobile layout and reduced motion. The network/WebGL map failure fallback remains a labeled geographic preview. OpenFreeMap/OSM attribution remains visible; street tiles require network access. No private files or credentials are imported by frontend modules.

The source banner, city selector, map, inspectors and analysis use returned metadata. Coverage distinguishes unique properties, offered spaces and returned map records. Query counts describe matching records within the requested bounds; displayed cells accompany the returned page. They are not complete-city inventory, vacancy or demand counts. Unknown rent and suite area remain visible in local mode, and starting a scenario with unknown base rent requires an explicit user assumption.

## Inspected data and actual import

The source is the local restricted CoStar hackathon kit, with a Matterport-capture sample for Houston and Los Angeles. Its index, model/concept documentation, enum tables, schemas, file metadata and bounded record samples establish the mapping. The legacy schema-2 SQLite cache has only a filtered space subset and inferred restaurant attributes; it remains untouched. The new dedicated cache is rebuildable from the authoritative commercial property and listing JSONL files.

| City | Properties | Linked offered spaces | Mappable records |
|---|---:|---:|---:|
| Houston | 1,758 | 2,431 | 4,189 |
| Los Angeles | 1,581 | 1,288 | 2,869 |
| Total | 3,339 | 3,719 | 7,058 |

The kit also contains 1,022 marketing listings and 3,955 nested spaces. Import rejects 236 spaces whose own property relationship is outside the supplied property sample. It does not substitute a shopping-center listing's parent property. Rebuilding twice produced identical accepted/rejected counts and no duplicate rows. The current import reports 1,634 missing-rent warnings and 14 unknown-period warnings. A warning preserves an unknown field; it does not reject an otherwise valid record.

This is not a restaurant-space inventory: most source properties are multifamily; other classes include office, industrial and retail. No previous restaurant use, suitability, kitchen, parking or permitted use is inferred. Contacts, free text notes, residential data, photographs, tours, tenancy analysis and inferred attributes from the old cache are excluded.

No kit-wide dataset release date is documented. General property dates remain null; listing research recency stays listing-specific. Import time is separate. Active marketing is a dated source status, not verified current physical availability. The inspected documentation does not establish a public redistribution license; this is authorized local evaluation, with restricted files and generated caches kept out of Git. No sponsor eligibility certification is asserted.

## Architecture and commands

- `domain/schemas.ts`: additive local metadata, property provenance, H3 metrics and version-2 snapshot schemas; version-1 demo snapshots remain readable.
- `domain/local-data.ts`: normalized ingestion schema, strict bounded query parser, response schemas and limits.
- `domain/scoring.ts`: fictional demo scoring remains unchanged; real composite scores always remain null, including after weight changes.
- `domain/scenario.ts`: existing deterministic rent and financial calculations are reused unchanged.
- `backend/record-stream.ts`: incremental JSONL, quoted CSV and top-level JSON-array reader; 64 KB reads, 8 MB record limit.
- `backend/local-dataset.ts`: separate indexed property/listing/space tables, validation, H3 membership, atomic rebuild, parameterized queries and permitted projections.
- `backend/import-local.ts`: aggregate-only CLI import/rebuild report.
- `backend/http.ts`: sanitized private/no-store JSON response/error helpers.
- `src/app/api/expansion/markets/route.ts`: supported-city coverage and source metadata.
- `src/app/api/expansion/query/route.ts`: validated city, bounds, filters and pagination; at most 200 records/cells and offset 10,000, viewport at most five degrees per axis.
- `src/app/api/expansion/properties/[id]/route.ts`: selected normalized property or lease-space detail and relevant evidence.
- `frontend/data/local-market.ts`: schema-validated HTTP access with AbortSignal support.
- `frontend/components/expansion-workspace.tsx`: existing workspace adapted for async data, selection, scenarios and comparisons.
- `frontend/storage.ts`: separate browser-local snapshot keys and reproducibility validation.

Configure the ignored `.env.local` as described in the [data manifest](../../src/features/expansion/data/README.md). Use Node 22.18 or later; this computer uses Node 24.14.1. No production dependency was added: SQLite uses `node:sqlite`, and parsing uses Node streams.

```powershell
npm ci
npm run expansion:import -- --help
npm run expansion:import
npm run dev
```

The same import command rebuilds; a failed rebuild preserves the previous cache. Server-only settings are `EXPANSION_COSTAR_ROOT`, `EXPANSION_DB_PATH`, optional `EXPANSION_DATASET_ID` and an optional **documented** `EXPANSION_DATASET_DATE`. No `NEXT_PUBLIC_` data configuration is used. See [backend details](../../src/features/expansion/backend/README.md).

## Numerical and provenance rules

Source USD/SF/year rents normalize with exact suite area / 12. USD/SF/month quotes convert to annual rates while preserving original period, measurement, currency and service codes and original low/high values. Zero rates mean missing. Unsupported units, ranged asking rents and divisible suite areas do not silently become exact financial inputs. Building GBA/RBA does not become rentable-suite area. Base rent excludes pass-throughs.

H3 resolution 8 is computed server-side. Areas show unique source-property counts and offered-space counts, independently of frontend filters/page size. Mean asking rent uses only exact annual USD/SF quotes with one known service basis; mixed/unknown service types remain unaggregated. No ACS/Places inputs exist, so demographic, similarity, competition and composite suitability stay unavailable. Coverage requirements are unchanged.

Every editable financial field is an assumption, including rent overrides. Existing illustrative defaults are labeled: pass-throughs $750/month, other fixed costs $6,000/month, contribution margin 35%, investment $90,000 and reserves $25,000. Missing base rent starts blank. Required sales = fixed monthly costs / positive contribution margin. Assumed sales are optional; no expected demand is invented. Payback requires positive contribution and excludes working capital, financing, taxes and unmodeled costs.

## Snapshots and failures

Legacy demo key: `restaurantos.expansion.demo.scenarios.v1`. Local key: `restaurantos.expansion.local.scenarios.v2`. Local snapshots retain dataset identity/date, embedded normalized property evidence, source IDs, inputs, exact deterministic results, assumptions and model versions. A restored planning scenario uses its recorded evidence; a refreshed inspector may show the current imported record separately. If a selected source cannot be reached, the embedded evidence is explicitly labeled as dated saved evidence. It is not silently refreshed or replaced by a fixture.

Reads validate provenance, schema/model versions and recomputed results. Corrupt/mixed storage is preserved and saving stays disabled until explicitly cleared. Failed writes preserve drafts. Storage is browser-local with no account backup. Initial local mode still requires supported-market metadata from its configured cache; complete offline access to snapshots before metadata loads is not implemented.

API states distinguish invalid queries (400), absent/unmappable records (404), missing configuration (503) and source/cache failures (503 with a distinct code). Empty results return success with zero counts. Error messages expose no local paths or source payloads. A failed real source never becomes Demo automatically.

## Verification

Synthetic Node tests cover ingestion mapping/relations, deduplication and reruns, invalid/missing fields, geography, unsupported units, streaming formats, query limits/filter semantics, service-compatible aggregates, corrupt/missing caches, atomic failure preservation, finance, unscored real areas, legacy/local snapshot compatibility and storage errors. Existing Tactical tests remain included.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
$env:PLAYWRIGHT_CHANNEL='chrome'
$env:EXPANSION_E2E_LOCAL='1'
npm run test:e2e
```

Browser coverage includes the real configured API journey through supported-city selection, keyboard area inspection, two property scenarios, comparison, save, reload and restore; synthetic tests cover unknown rent, query/source failure with retry, saved evidence fallback and mobile/reduced-motion behavior. Existing demo flows, map-failure fallback, corruption handling and Tactical style/navigation isolation remain covered. The optional real-data test skips unless `EXPANSION_E2E_LOCAL=1`; it uses the ignored local database, never a committed private fixture.

Verified on this computer: lint, typecheck, all 51 Node tests (including 8 Tactical tests), the production build and all 11 Chrome browser tests pass. Direct HTTP checks confirmed bounded 200-record responses, invalid query/city/viewport rejection, empty availability results, detail 404 and private/no-store headers. A live-map check confirmed source pins, synchronized pin/list/inspector selection and a new bounded request after panning. Desktop/mobile screenshots showed no horizontal overflow. Private dataset/cache/env/screenshot files are ignored; no restricted data is tracked. Concurrent `.gitignore` changes were preserved.

AI, Matterport/Vexcel analysis, alerts, live availability and production/account persistence remain deferred. The root redirect, root styling, Tactical modules and shared contract proposal are untouched.
