# Tactical sponsor workflows

Status: implemented workflows. Arlequin Track 2 requirements were supplied by the user and now have a dedicated content/connectivity pipeline; final prize eligibility remains organizer-controlled. Updated November 14, 2026.

## Capital One / Nessie

Open **Tactical → Finance → Nessie Sandbox**. Start with the labeled local demo, unlock the existing AI workspace session, then choose **Refresh from Nessie**. The server reads a configured sandbox account, deposits and withdrawals. The browser never receives the API key or account number. No UI action moves funds or creates transactions.

With explicit user approval, the seed created exactly one fictional customer, one checking account, two deposits and one withdrawal in the official Nessie sandbox. The account ID is configured in ignored `.env.local`. A live authenticated browser refresh returned HTTP 200, displayed the $25,000 sandbox balance and three source records, recalculated the reserve scenario and exported its JSON successfully. No real funds are involved.

### Configuration and demo creation

In ignored `.env.local` or deployment secrets:

```dotenv
NESSIE_API_KEY=your-sandbox-key
NESSIE_ACCOUNT_ID=your-sandbox-account-id
# Existing TACTICAL_AI_PASSWORD or TACTICAL_API_TOKEN protects the workspace session.
```

Read-only verification:

```sh
node --env-file=.env.local src/features/tactical/backend/nessie-cli.ts check
```

After explicitly approving fictional remote sandbox records:

```sh
node --env-file=.env.local src/features/tactical/backend/nessie-cli.ts --seed-demo
```

The seed uses editable JSON fixtures, creates a fictional customer/checking account and sample deposits/withdrawals, and checks existing names/descriptions before each creation. It never updates or deletes records. Run only one process at a time: Nessie has no idempotency guarantee, so a retry after an ambiguous response must inspect existing records. The script returns the account ID to place in `.env.local`; restart the app afterward. Do not put credentials in source control or submission screenshots.

### Verified API contract

Sources: [official documentation](https://prod.nessieisreal.com/docs), [official OpenAPI document](https://prod.nessieisreal.com/nessie-openapi-spec.yaml), and [getting started](https://prod.nessieisreal.com/getting-started). The published UI/OpenAPI server is `https://prod-api.nessieisreal.com`; older getting-started examples use a different hostname. The adapter deliberately uses the verified production sandbox host.

- `GET /accounts/{id}` → account ID, type, nickname and balance.
- `GET /accounts/{id}/deposits` → deposit ID, date, amount, status and description.
- `GET /accounts/{id}/withdrawals` → corresponding withdrawal records. The official withdrawal schema is generic; our stricter contract has now been confirmed against the created live sample.
- The published contract describes legacy 24-hex IDs, but the live service creates UUIDs. Validation accepts both formats and rejects arbitrary path strings.
- Key travels in the provider-required query parameter. Fixed HTTPS host, no redirects, no URL/error logging, 12-second timeout, 2 MB per response, max 2,000 rows of each type. All three calls must validate; partial success never becomes a simulated replacement.
- Protected same-origin POST `/api/tactical/integrations/nessie` performs read-only provider GETs. Uses the existing signed workspace session. One in-flight request per process; no full user/tenant authorization or distributed rate limiter is claimed.

### Calculations and evidence

Provider amounts are interpreted as USD major units and normalized to integer cents. USD remains an explicit scenario currency assumption because the account contract has no currency field. Only completed deposits/withdrawals enter historical flow totals. These totals exclude purchases, transfers, bills, loans and other transaction types: they are **not a complete cash-flow statement, revenue, profit or balance reconciliation**.

The investment decision uses the returned balance directly, without adding historical deposits again:

- Remaining cash = account balance − proposed investment.
- Reserve cushion = remaining cash − minimum reserve.
- Months until reserve = max(0, cushion) ÷ assumed monthly net cash burn; zero burn is unavailable.
- Credit-card balances cannot be treated as spendable cash, so their scenario is unavailable.

Investment, reserve and burn are editable assumptions. The scenario can be downloaded as JSON with its source snapshot, timestamp, assumptions and results. It does not mutate the restaurant dataset, bank or MongoDB. A live API success means **simulated funds fetched from Nessie**, never real restaurant banking.

## Arlequin Track 2 / relationship analysis

**New complete pipeline:** [Content and connectivity guide](ARLEQUIN_TRACK2.md) maps the supplied challenge to message-level semantic analysis, actor communities, explicit conversation paths and a verified public Hacker News source. Open Reviews → Content & connectivity. The earlier graph-only explorer described below remains supported.

Open **Tactical → Reviews → Relationship network**. Explore the synthetic sample, filter relationship types, select nodes and inspect the exact edge evidence. The circular SVG is illustrative; all information is also available through selects/tables for keyboard and narrow-screen access.

### Input and provenance

`demo-network.json` documents the version-1 JSON contract. Limits: 100 nodes, 300 edges, 300 evidence records, 512 KB imports. Nodes are authors, posts or topics; supported directed relationships are author→post `authored`, `commented`, `liked`, and post→topic `tagged`. Every edge needs an existing evidence record with source, original record ID, timestamp and excerpt; HTTPS source links are optional. Repeated interactions between the same pair/type should be aggregated to a single relationship. Missing endpoints, self-links, invalid node types, duplicate IDs/relationships, unsafe URLs and unsupported versions are rejected.

The default is synthetic and cannot support real customer conclusions. Observed imports require explicit permission confirmation and a provenance statement. “Observed” is user-attested, not independently verified. Use pseudonymous IDs and remove unnecessary personal details. The app does not scrape any social platform or establish permission itself.

Import, save/reopen in browser storage, and JSON export are supported. Browser saves are explicit, one network per restaurant. Import does not upload to MongoDB. New sessions open the labeled sample; choose **Reopen saved network** to restore your saved import. Invalid files preserve current work. A JSON download is the portable backup; multi-user synchronization is not implemented.

### Deterministic graph analysis

- Unique undirected neighbor counts per node (multiple relation types do not inflate degree).
- Connected components and isolated nodes, including nodes left isolated by filtering.
- Unique commenting/liking authors per explicitly tagged topic, deduplicated across posts and relation types.
- Source IDs behind every edge and topic path.

These are sample network metrics, not inferred influence, community detection, population reach, sentiment, sales or causation. Filtering changes the graph being analyzed; node selection changes only the evidence view.

### Optional AI interpretation

The purple panel sends the explicitly selected graph/filter and linked excerpts to Gemini via authenticated `POST /api/tactical/integrations/network`. Server validation and deterministic metrics run before generation. Results contain at most three testable marketing hypotheses with existing source IDs, limitations and model/timestamp. Unknown evidence references fail validation. Quotas share the existing AI budget, with a separate one-request concurrency limit. Context changes clear previous results. All AI failure responses shown to users say **Something is wrong**. Nothing is published automatically.

The graph-only tab is a supporting explorer. The new Content & connectivity tab implements the supplied Track 2 requirement with an observed public-data adapter and joined message semantics/actor connections. No Arlequin-specific API was required by the supplied wording or invented. See the linked guide for evidence and limits.

## File map

| Layer | Files | Responsibility |
|---|---|---|
| Domain | `domain/nessie.ts`, `domain/network.ts` | Zod contracts, bank math, graph algorithms |
| Integration | `backend/adapters/nessie.ts` | Fixed-host Nessie client and source validation |
| Services | `backend/nessie-service.ts`, `backend/network-service.ts` | Auth, origin checks, limits, API orchestration |
| Utility | `backend/nessie-cli.ts` | Explicit seed command and read-only verification |
| Routes | `src/app/api/tactical/integrations/{nessie,network}/route.ts` | Thin Next.js entry points |
| Interface | `frontend/components/{nessie-panel,network-panel}.tsx`, `sponsor-tools.css` | Finance/Reviews sponsor workflows |
| Editable mocks | `frontend/data/demo-{nessie,nessie-customer,network}.json` | Fictional data only; no credentials |
| Validation | `sponsors.test.ts`, `frontend/e2e/sponsors.spec.ts` | Calculations, graph integrity, access/error behavior and browser journeys |

All feature files above are inside `src/features/tactical/` unless an absolute repo-relative prefix is shown. Rain's Expansion module and shared contracts are unchanged. A shared Nessie adapter can be proposed after the co-owner agreement.

## Remaining submission steps

1. Confirm any remaining Capital One submission requirements. Arlequin Track 2 wording is supplied and mapped in ARLEQUIN_TRACK2.md.
2. Live Nessie account/transaction verification and request-to-scenario export are complete. Capture the final submission video if required, keeping keys out of screenshots.
3. Record the implemented Arlequin observed-public-data journey, export a content/connectivity report and include sampling and AI limitations. A different permissioned dataset can be imported if preferred.
4. Confirm whether either challenge requires a specific service/model, graph algorithm, dataset, submission artifact or video. Implement those only once the requirements are known.
5. Production work remains separate: per-user access, durable/multi-user persistence, distributed throttling, broader financial transaction coverage and data deletion policies.

## Verification record

- Lint, TypeScript, all 158 unit tests and production build passed. Build retains the two existing Expansion filesystem-tracing warnings; that module was not edited.
- All 30 Tactical browser checks passed in Chrome and Firefox, including sponsor demos, auth/error handling, evidence, scenario downloads, imports, browser saves, narrow layouts, reduced motion and hydration regressions.
- The user explicitly approved sandbox seeding after the initial approval block. Live checks confirm exactly one customer, one account, two deposits and one withdrawal. The first seed stopped after customer creation because the service returned an undocumented UUID; after updating validation, the retry reused that customer and completed the remaining records. No duplicates were created.
- Authenticated browser verification: unauthorized read HTTP 401, unlocked live read HTTP 200, all three evidence rows displayed, below-reserve scenario checked, JSON export verified and no hydration errors. The returned balance is $25,000; with $4,000 investment, $10,000 reserve and $1,500 assumed monthly burn, the export records $21,000 remaining cash, $11,000 cushion and about 7.3 months to reserve. Historical transactions are not added to the current balance.
- Live Gemini analysis of the fictional graph returned HTTP 200 with three hypotheses and valid linked source IDs. Earlier malformed citations were rejected and surfaced as the generic error; source-ID instructions were tightened before the successful check.
- Browser screenshots were visually checked on desktop and mobile. Repository secret scan passed; `.env.local` stays ignored.

Implementation note: React's SVG `<title>` must receive a single string (not several JSX text children) to avoid hydration mismatch in this setup. Graph coordinates are rounded for stable SSR/browser rendering. Existing finance tests now scope table queries to the Finance page, since Reviews has its own evidence tables. ChatOverflow was unavailable in this environment (no CLI or local instructions), so no external field note was published.
