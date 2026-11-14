# Expansion — local data (git-ignored)

This folder holds the real Expansion datasets. The actual data files are **git-ignored**
(see the repo root `.gitignore`) because they are large, restricted, or derived — so they do
**not** clone to another machine. This README is the tracked manifest: any clone shows exactly
what belongs here and how to obtain it.

| Path | What it is | Size | How to obtain |
|---|---|---|---|
| `costar-hackathon-kit (1)/` | CoStar hackathon dataset (JSONL + CSVs) | ~404 MB | CoStar keys card in the track Discord (zip + password). Restricted — do not commit. |
| `data/` | Working data from the old RestaurantOS backend: `costar.sqlite` (kit cache), `store.json`, `cache/`, `images/` (Vexcel chips), `runs/` | ~18 MB | Derived / regenerable — rebuild the SQLite from the kit, or re-run the old backend. |
| `quickstart/` | Matterport index of ~15k scans (`models_index.csv`) + two Matterport tutorial notebooks | ~2.6 MB | Matterport quickstart (`setup.ps1` downloads it). |
| `output/restaurants.csv` | One-off export of CoStar food tenancies | ~0.3 MB | `extract_restaurants.py` in the old repo. |

## To reproduce on another machine

1. `git clone` this repo — this README is present, the data files are not.
2. Get the **CoStar kit** from the hackathon card and place it at `costar-hackathon-kit (1)/`.
3. Get **models_index.csv** from the Matterport quickstart (or re-run the quickstart download).
4. `data/` and `output/` are derived; regenerate from the kit if needed.

Keep credentials in `.env` (git-ignored); never commit them.

## Inspected source and coverage (2026-11-14)

The extracted kit's `index.md`, model documentation, geography/leasing concepts,
JSON Schemas and enum tables were inspected alongside small bounded record samples.
The kit is a **Matterport-capture property sample**, not a complete city inventory.
The source documentation identifies all supplied properties as inside Houston or
Los Angeles city limits; research-market IDs 14/20 identify the two source groups.

| Source / verified relation | Coverage |
|---|---|
| `commercial-properties.csv` → property `id` | 13,147 scan rows, 3,339 distinct properties; scan rows are not listings |
| `data/commercial-property.jsonl` | 3,339 properties: Houston 1,758; Los Angeles 1,581 |
| `data/commercial-listing-summary.jsonl` | 1,022 marketing listings, including sale/off-market records; 3,955 nested lease spaces |
| `forLeaseSummary.spaces[].propertyId` → property `id` | 3,719 linked spaces accepted: Houston 2,431; Los Angeles 1,288 |
| Unresolved space/property links | 236 rejected; never substituted with the parent listing's property |
| Source types | 2,765 multifamily, 289 office, 122 industrial, 65 retail, plus other property types; no inferred restaurant suitability |

The legacy `data/costar.sqlite` has schema version 2 and a filtered 513-space cache
plus tenancy data. It lacks original units and complete provenance and contains
inferred restaurant attributes. The new adapter leaves it intact and builds a
separate `data/expansion.sqlite`. All 7,058 accepted property/space records in the
current import have source coordinates. Properties and spaces remain distinct;
the number of map records is not a count of unique buildings or vacant premises.

Rent measurement code 1 means square feet; period codes 1/2 mean month/year;
currency code 1 means USD. Source zero rates mean no quote. Original low/high values
and codes are retained. Exact USD/SF/month quotes convert to USD/SF/year. Ranged
quotes and divisible suite areas remain null for exact finance initialization;
the inspector shows the source range and users can supply rent assumptions.
Building GBA/RBA is not offered-suite area. Active marketing does not establish
vacancy, permitted use, restaurant suitability, or current availability.

No kit-wide release date is documented. Properties have no general record date;
listing `certifiedFreshDate` describes research recency and remains listing-specific.
Import time is stored separately. Never turn a file modification time, latest
listing date, or import date into an invented dataset observation date.

The kit has no standalone redistribution license in the inspected documentation.
This implementation uses the user-supplied restricted dataset for local hackathon
evaluation and makes no public redistribution or sponsor-eligibility claim. Only
allowlisted normalized commercial attributes are served locally. Contacts, free
text notes, residential records, attachments and photos are excluded. Keep source
files, caches and browser artifacts private; review actual sponsor terms before
publishing data beyond this authorized local workflow.

## Configure, import and rebuild

From the repository root, create git-ignored `.env.local` settings:

```dotenv
EXPANSION_COSTAR_ROOT="C:/absolute/path/to/costar-hackathon-kit (1)"
EXPANSION_DB_PATH="C:/absolute/path/to/this/repo/src/features/expansion/data/data/expansion.sqlite"
EXPANSION_DATASET_ID="costar-hackathon-local-v1"
# Optional only if documented by the source:
# EXPANSION_DATASET_DATE="YYYY-MM-DD"
```

Use a dedicated cache path under the ignored `data/` directory. Do not point at the
old cache or commit a database placed elsewhere. Server environment variables have
no `NEXT_PUBLIC_` prefix. Existing environment values take precedence over env files.

```powershell
npm ci
npm run expansion:import -- --help
npm run expansion:import
npm run dev
```

The same import command rebuilds atomically and is rerunnable without duplicates.
It streams authoritative JSONL records (also supports incremental JSON-array source
exports) into indexed SQLite; the generic reader also supports quoted CSV. It never
loads a whole source file into memory. Aggregate accepted, rejected, duplicate and
warning counts print to the terminal. The current import reports 3,339 properties,
1,022 marketing listings, 3,719 spaces, 236 unresolved-link rejections, 0 duplicates,
1,634 missing-rent warnings and 14 unknown-period warnings. Warnings describe fields
kept unknown; they are not additional rejected records. A failed rebuild preserves
the previous cache. Source records and private paths are absent from API errors.

Open `/expansion`, choose **Local dataset**, then choose a city. Demo remains an
explicit separate mode. If the database is absent or unavailable, the UI explains
the failure and offers retry; it never substitutes fictional records into local mode.
See [backend details](../backend/README.md) and
[implementation notes](../../../../docs/expansion/IMPLEMENTATION.md).

## Standalone three-layer Python helper

The repository-root `data_access.py` exposes local CoStar search, Matterport
GraphQL/model metadata, and Vexcel aerial JPEG extraction. It runs independently
of the Next.js app, using Python 3.11+, `requests` and `python-dotenv` only.
Install those two packages in a local Python environment. This workspace has an
ignored `.venv`; run its `Scripts/python.exe` on Windows.

Set `MATTERPORT_API_KEY`, `MATTERPORT_API_TOKEN`, and `VEXCEL_API_KEY` in the
repository-root `.env` or environment. Existing environment values take precedence.
The supplied SDK key is stored locally as `MATTERPORT_SDK_KEY`; the helper does
not embed the SDK or expose credentials to the frontend. `--check` checks key
presence; the individual API commands verify actual access without printing keys.

```powershell
.\.venv\Scripts\python.exe data_access.py --check
.\.venv\Scripts\python.exe data_access.py --matterport zvKHR9DHNjJ
.\.venv\Scripts\python.exe data_access.py --vexcel 34.0935 -118.3171
.\.venv\Scripts\python.exe data_access.py --vexcel 40.343 -74.655
.\.venv\Scripts\python.exe data_access.py --costar houston --sf-min 1800 --sf-max 2500
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_data_access.py
```

Use `--data-dir` for another data root or the extracted kit itself. The helper
leaves both existing databases untouched. Because the legacy v2 SQLite omits
status/unit/provenance fields, the first search validates the CSV/JSONL and creates
a separate fingerprinted SQLite in `./cache/`; repeated searches read SQLite.
Source file changes invalidate that cache. Matterport JSON also lives in
`./cache/`; Vexcel JPEGs live in `./output/`. Both folders are ignored. Delete
individual model/image cache files to refresh their snapshots. `--out-path` copies
an image to another explicitly selected local path while retaining the cache.

Search results distinguish exact values from offered ranges: `sqft` and
`asking_rent` are null for ranges, while the original min/max fields remain
available. Rent basis preserves USD/SF/month versus USD/SF/year; it does not
include unquoted operating expenses. SF filters match intersecting offered ranges.
Only active marketed suites in the snapshot are returned; this does not establish
current vacancy. Missing property joins are excluded, never replaced with the
listing's parent property. A property's first CSV scan is a property-level link,
not a verified scan of its offered suite.

Second-generation hints are derived proxies from the most recently ended matching
suite tenancy's industry or positive kitchen/hood/grease-trap notes. A current
tenant or an unrelated suite is not a previous tenant. Industry 17 also includes
accommodation, and a note may describe the building rather than the suite. Unknown
history stays null; no kitchen condition or restaurant approval is verified.
Vexcel checks the five supplied polygons; remote HTTP 403 is reported as no
permitted imagery without a traceback. Neither images nor Matterport metadata
produce inferred parking counts, seating measurements or financial projections.
