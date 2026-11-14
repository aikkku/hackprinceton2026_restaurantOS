# Expansion backend

`local-dataset.ts` imports and queries a dedicated, rebuildable SQLite cache using Node's installed `node:sqlite`. `record-stream.ts` reads JSONL, quoted CSV (including embedded newlines), and top-level JSON arrays incrementally. Its 64 KB read buffer and 8 MB per-record ceiling bound source parsing; the full dataset is never loaded into memory. The kit importer reads the two authoritative commercial JSONL files (or `.json` arrays when exported that way); the repetitive Matterport starter CSV is not a listing source.

Configure these **server-only, git-ignored** values in `.env.local`:

```dotenv
EXPANSION_COSTAR_ROOT="C:/absolute/path/to/costar-hackathon-kit (1)"
EXPANSION_DB_PATH="C:/absolute/path/to/private/expansion.sqlite"
EXPANSION_DATASET_ID="costar-hackathon-local-v1"
# Set only when a dataset release/snapshot date is documented:
# EXPANSION_DATASET_DATE="YYYY-MM-DD"
```

Run `npm run expansion:import` from the repository root to import or rebuild. `npm run expansion:import -- --help` describes configuration. The command loads `.env` and `.env.local`, prints aggregate accepted/rejected/duplicate counts and reason counts only, and never prints records. Use a new cache path: the legacy `costar.sqlite` lacks necessary provenance, original rent units, statuses, and complete property coverage, so it is not reused.

The importer writes separate `properties`, `listings`, and `spaces` tables and an indexed `records` view. Properties use CoStar property IDs; marketing listings retain their own IDs; each offered space uses its verified space ID and its **own** property relationship. A shopping-center listing's parent property must not substitute for a space's property. References outside the supplied property sample are rejected and counted. Duplicate verified identifiers are counted without adding rows. Repeated imports rebuild from source in a transaction into a sibling file and replace the cache only after successful validation. A failed source read preserves the previous cache. The metadata table stores schema version, import time, dataset date (nullable), source limitations, and the aggregate import report.

All normalized records pass Expansion/domain validation. Missing coordinates remain null and are retained in the database but excluded from map responses. Invalid latitude/longitude ranges and negative or reversed rent ranges are rejected. Properties do not borrow building size as offered-suite size. Divisible suite-size ranges and rent ranges remain unknown for exact finance inputs. Source rate lows/highs, original period/measurement/currency/service codes, availability notice/date, marketing status and research recency remain attached to normalized spaces. A zero quoted rate means missing; its original zero is preserved. Unknown or unsupported units never become a canonical USD rent. Monthly USD/SF quotes convert deterministically to USD/SF/year. Both Active and OffMarket are marketing statuses; physical availability remains unknown for either status.

`getMarkets`, `queryLocalDataset`, and `getPropertyDetail` are called only by Next.js route handlers. Query boundaries validate city, ordered viewport (at most five degrees per axis), filters, limit (maximum 200), and offset (maximum 10,000); database inputs use parameters. City metadata lists only markets with mappable records. Responses contain allowlisted normalized fields and relevant evidence, never contacts, photographs, raw notes, credentials, source paths, or raw payloads. Errors distinguish missing configuration, invalid queries, and source failures and redact filesystem details.

Resolution-8 H3 membership is computed during server ingestion. Area counts use all imported source records in the selected cell, independent of a paginated or filtered result page; returned cells accompany returned records and coverage reports cells omitted by pagination. Property counts deduplicate parent properties while offered-space counts remain separate. Mean asking rent is computed only from exact USD/SF/year quotes with a single known, comparable service type; mixed or unknown service types yield null. Composite scores and fictional demographic/competition factors remain unscored. Active marketing is a **dated snapshot**, not verified current vacancy or restaurant suitability.

`backend.test.ts` uses synthetic files and temporary caches with the existing Node test runner. It covers streaming, verified joins, duplicate IDs, reruns, missing/invalid fields, units, unknown availability, bounded/filter queries, aggregate semantics, and source/cache failures. No private records are committed as test fixtures.
