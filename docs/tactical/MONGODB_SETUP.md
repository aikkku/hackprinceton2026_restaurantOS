# Shared MongoDB setup and Tactical data API

## Shared database, separate ownership

Use **one database: `restaurantos`** for the whole application. `MONGODB_URI` and `MONGODB_DB` are shared server configuration names. Tactical owns **`tactical_datasets`**, **`tactical_review_analysis`** and **`tactical_hr_analysis`**. Rain can add Expansion collections inside the same database later; this implementation does not alter his data adapters or import his records.

The verified Tactical Mongo connection helper lives in Tactical backend for now. Rain’s latest merged work also adds `src/lib/mongodb.ts`; it is preserved unchanged. Coordinate with Rain before consolidating the two clients, including the IPv4 setting verified here and the shared database name. Both can use the same Atlas URI; no second database is required. The existing frontend/domain/backend structure is retained.

## What is ready

- One editable fixture: `src/features/tactical/frontend/data/demo-restaurant.json`.
- Zod dataset contract: `src/features/tactical/domain/dataset.ts`.
- Fictional profile, main floor plan, named-layout configuration, scenario snapshot, reviews/mission, assumptions, employees, suppliers, inventory, menu costs/prices, ledger, competitor observations and photo examples.
- All records are **mock data**, even after being stored in MongoDB. The API deliberately requires `isDemo: true` and synthetic provenance. Do not upload real staff or banking data through this demo contract.
- Stable string IDs, ISO dates, integer USD cents for operational financial records, source references, same-restaurant validation and duplicate-ID checks.
- Finance derives its chart, totals and table from one ledger; menu unit contribution uses explicit costs/fees. HR and Supply use the same fixture instead of component-local arrays.
- Local demo works without a database. Choosing Mongo mode is explicit and never silently falls back after a database failure.

## Setup checklist

The local connection, access permissions, seed and API round trip are verified. The remaining local action is to rotate the password shared in chat and update `.env.local`. The checklist below is also for additional machines and deployments.

1. In Atlas, allow the development computer's current IP in **Network Access** and verify the cluster is available. For deployment, configure the actual deployment egress/private connectivity separately.
2. Give the app database user `readWrite` access to `restaurantos` (or appropriately scoped collection permissions).
3. Rotate the password supplied in chat, then update the local/deployed URI. Do not commit credentials or paste the replacement into documentation/chat.
4. Set the following values in ignored `.env.local` locally and the deployment's secret settings in production:

```dotenv
MONGODB_URI=mongodb+srv://USER:URL_ENCODED_PASSWORD@CLUSTER_HOST/
MONGODB_DB=restaurantos
TACTICAL_API_TOKEN=GENERATE_A_RANDOM_VALUE_AT_LEAST_32_CHARACTERS_LONG
TACTICAL_DATA_SOURCE=demo
TACTICAL_RESTAURANT_ID=juniper-table
TACTICAL_API_BASE_URL=http://127.0.0.1:3000
```

A local `.env.local` was prepared during implementation with the supplied connection settings and a generated admin token. It is ignored by Git and has restrictive file permissions. Secrets are not included in any fixture or browser bundle. Change the API base URL to the port your app actually uses (for example 3047).

Generate a token locally with `node -e 'console.log(require("node:crypto").randomBytes(48).toString("hex"))'` if setting up another machine. Do not use any `NEXT_PUBLIC_` prefix for Mongo credentials or the API token.

## Dataset storage design

Each restaurant is a bounded document in `restaurantos.tactical_datasets`:

```text
_id: restaurant slug (unique MongoDB primary key)
revision: positive integer maintained by the server
updatedAt: server-generated ISO datetime
dataset:
  datasetVersion: 1
  isDemo: true
  provenance: synthetic source/as-of/description
  profile / layout / reviews / mission / assumptions
  layoutConfigurations / scenarioSnapshots
  operations: currency / employees / suppliers / inventory / menu /
              transactions / competitors
  photoPlans: sample / blank / fallback
```

The aggregate is intentionally capped at **1 MB through the API/CLI**, well below MongoDB's document limit. One document lets all related fixture records change atomically without a multi-document transaction. `_id` provides uniqueness. No cross-feature collection is dropped, renamed or rewritten. There are no Mongo operator payloads from clients; uploads are schema-parsed data.

This is a bounded hackathon dataset store, not an unlimited POS ledger. Before importing large real datasets, split high-volume records into restaurant-scoped collections, design indexes/pagination/retention, and migrate the contract explicitly. UI-selected filters currently work on the bounded loaded dataset.

## Local preparation and seed

Use Node >=22.18 (the current workspace uses Node 24 through mise).

```sh
npm run tactical:data:validate
npm run tactical:data:export
npm run tactical:data:seed
```

- `validate` checks the full fixture and request size without connecting.
- `export` produces `/tmp/restaurantos-dataset-upload.json`, an API request envelope with `expectedRevision: 0` and the dataset.
- `seed` loads `.env.local` and inserts the fixture into MongoDB only if its restaurant ID does not exist. Re-running seed preserves the existing document; it does not reset changed database data.
- Each command optionally accepts a dataset JSON path after `--`.

Seed uses the same repository/schema as the APIs. No live write is reported successful unless Atlas acknowledges it. A failed connection leaves demo mode available.

## Protected endpoints

Every endpoint below requires `Authorization: Bearer <TACTICAL_API_TOKEN>`. Missing/short server token configuration returns 503; a wrong/missing request token returns 401. Do not put this admin token in frontend code or persistent browser storage.

| Method/path | Purpose | Body/result |
| --- | --- | --- |
| `GET /api/tactical/restaurants` | List available dataset summaries | Sorted by ID; capped at 100 records; no pagination yet |
| `GET /api/tactical/restaurants/:id/dataset` | Retrieve one stored dataset | `_id`, `revision`, `updatedAt`, `dataset`, `source: mongodb` |
| `POST /api/tactical/datasets/validate` | Validate an upload without writing | `{ expectedRevision, dataset }`; returns validation status |
| `PUT /api/tactical/restaurants/:id/dataset` | Create or atomically replace one dataset | `{ expectedRevision, dataset }` |

Create uses `expectedRevision: 0` and returns 201. An existing restaurant conflicts rather than being overwritten. Update uses the exact revision returned by GET and returns 200 with the next revision. Two concurrent updates cannot both replace the same revision: the stale one returns **409**. Fetch, review and explicitly retry after a conflict; do not silently retry with a newer revision.

The URL restaurant ID must match `dataset.profile.id`. IDs must be lowercase slugs. Uploads require `application/json`; the request stream is counted and canceled above 1 MB, regardless of Content-Length. Invalid JSON returns 400, wrong media type 415, invalid dataset 422, missing record 404, database/configuration or invalid stored data 503. DB errors are redacted; they do not expose connection strings. Responses are not cached.

## Use the API without exposing tokens in shell arguments

Start the app, set `TACTICAL_API_BASE_URL` in `.env.local`, then:

```sh
npm run tactical:api -- validate
npm run tactical:api -- list
npm run tactical:api -- get juniper-table
npm run tactical:api -- upload
```

The CLI reads the token from the environment and sends it as an authorization header. `upload` without a revision attempts create-only. To update a dataset you have reviewed:

```sh
npm run tactical:api -- upload /absolute/path/to/dataset.json 1
```

Replace `1` with the revision from GET. The file is the **dataset itself**, not the export command's envelope. `validate` also takes a dataset file path. The separate exported envelope is for an authorized API client such as Postman; use its environment/secret storage for the token. The CLI refuses non-HTTPS remote origins and does not follow redirects with credentials.

The API token is one administrative credential for this mock dataset service, not end-user authentication or per-user authorization. Add authentication, roles, audit trails and rate limits before serving real business data. The current browser UI can display only the explicitly synthetic contract and does not offer direct admin writes.

## Load MongoDB data into the UI

After a successful seed/upload, set:

```dotenv
TACTICAL_DATA_SOURCE=mongodb
TACTICAL_RESTAURANT_ID=juniper-table
```

Restart the Next.js server or redeploy. Tactical server-loads the selected restaurant and shows `MongoDB · mock data` plus its revision. The six sections use that profile and operations dataset. Mongo connection failures show a dataset-unavailable screen rather than silently switching to local records. `demo` mode continues using the editable local fixture.

**Persistence boundary:** working editor saves and scenario saves remain browser-local. The dataset includes validated `layoutConfigurations` and `scenarioSnapshots` ready for API upload, but there is no automatic browser-to-Mongo synchronization yet. Uploaded configurations/snapshots are available through the dataset API; do not confuse their presence in the database with a completed editor sync workflow. Existing local drafts remain intact when changing server data modes. Use a new browser context or explicitly review/reset saved work when comparing seed geometry with a local draft.

## Verification and remaining work

Automated API tests use an injected in-memory repository to verify auth, bounded bodies, validation, create/read/update, stale-revision rejection and error redaction. They do not prove a real Atlas connection. Browser tests exercise finance filters/pricing and centralized HR/Supply data alongside editor/hydration journeys.

Live Atlas verification succeeded after selecting IPv4 in the Mongo client; TLS verification remains enabled. The fixture was seeded as revision 1 and a same-data authenticated API update produced revision 2. GET, validation, update, unauthorized rejection (401) and stale revision rejection (409) were verified against Atlas. Both-browser UI tests passed in MongoDB mode. Initial default address-family selection produced TLS/server-selection errors in this environment.

Remaining: editor/cloud synchronization with proper user auth; review CSV/JSON ingestion; saved pricing scenarios; larger normalized collections when record volume warrants them; agreed shared connection ownership with Rain. No Nessie, CoStar or social-provider integration is implied by using MongoDB.

Driver reference: [MongoDB Node driver replacement operations](https://www.mongodb.com/docs/drivers/node/current/crud/update/replace/).

## Saved review analysis

`tactical_review_analysis` stores validated per-review Gemini classifications and short-lived processing leases. Review source hashes isolate restaurants and preserve cached results across reloads. New/edited comments are processed on authenticated dataset upload and reconciled by the unlocked Reviews page; no database watcher runs. Initial and bulk processing uses batches of ten. Dataset PUT responses include `reviewAnalysis.pending` or `reviewAnalysis.error` after a successful data save, so an AI outage does not falsely report that the dataset failed to save. See [review workflow](REVIEW_WORKFLOW.md) for exact limits, retry and endpoints. New source reviews can omit legacy authored themes.

## HR analysis records

`tactical_hr_analysis` caches schema-validated staffing assessments and original hiring drafts by restaurant, source context, task, requirements, model and prompt version. The central dataset includes seven demo employees and optional structured `operations.workforce` shifts/demand. Owner-edited job descriptions are not yet persisted. See [HR workflow](HR_WORKFLOW.md).
