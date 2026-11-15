# Cash calendar — Capital One Nessie

Implemented 2026-11-15. Open **Financial Intelligence → Cash calendar**. This is a deterministic ninety-day cash scenario; it does not invoke AI or move funds.

## Owner workflow

1. The populated local bank fixture opens immediately. A persistent source label distinguishes it from live Nessie sandbox reads.
2. Inspect starting cash, lowest projected closing balance and the reserve cushion. Click the low-point metric to select that day.
3. Use Month or Agenda, previous/next month and Start. Select a day for opening cash, estimated receipts, planned payments and closing cash. Event disclosures show source IDs, calculation assumptions and links to HR/Supply/Finance.
4. Assumptions edits reserve, sales pace, payout lag, payroll load, payment labels/dates/cadence/amounts, inclusion and explicit bank-bill matching. Add payment creates another editable future obligation. Applying these edits changes only the working forecast.
5. Unlock the existing workspace session and Refresh bank data for the configured Nessie account. No provider credentials enter the browser. Refresh failure retains the previous snapshot, marks it stale and never silently switches to a demo.
6. Save forecast records its original bank snapshot, configuration, immutable numeric source inputs, model version and input hash. Choose a saved version to reproduce it. In demo mode saves are browser-local and the latest restores after reload; in MongoDB mode choose from the cloud version dropdown after unlock. The interface shows the storage destination.

## Data and calculation

`operations.cashCalendar` in the central `demo-restaurant.json` contains the editable sample bank snapshot, scheduled sample bill, eight obligations, and defaults. It is optional for legacy datasets. `tactical:cash:seed` adds it without replacing existing data or owner edits and creates an opening forecast only when none exists.

- **Starting cash:** snapshot balance, normalized to integer USD cents. Credit-card balances are rejected as cash.
- **Period:** the next UTC calendar day through ninety days after the snapshot. Same-day movements and historical receivables are not assumed. Historical deposits and withdrawals are never added to the balance again.
- **Payouts:** `(item report revenue − supplied app commissions) / inclusive report days × chosen pace`, rounded to cents, then shifted by the chosen calendar-day lag. The model starts estimating newly earned receipts after the snapshot, not unpaid historical receipts. It does not infer payment-provider settlement records. Missing sales data shows an explicit warning; zero-volume/zero-pace generates no payout events.
- **Payroll:** the supplied HR weekly hours × rates, plus an editable estimated payroll load, repeated on planned payment dates. This is not an actual payroll/tax statement or a new schedule forecast.
- **Supply:** explicitly selected purchase quantities × current inventory unit costs. No automatic replenishment or supplier order. The default sample includes only selected inventory items, not every future ingredient purchase.
- **Other payments:** fixed owner-editable assumptions. The default includes rent, utilities, insurance, POS/software, equipment replacement and a repair.
- **Bank bills:** pending and recurring records only. The explicit upcoming date is authoritative; later recurring payments use the specified monthly day, clamped to month-end. Completed/cancelled bills are excluded. Missing/overdue one-time dates are flagged and excluded rather than silently moved.
- **Duplicates:** an explicit `bankBillId` match replaces a manual obligation with that bill, including its completed/cancelled state. A missing match blocks the forecast until corrected. No fuzzy amount/name matching. Deposits/withdrawals are historical evidence only, not a second future-payment stream. Transfers and purchases are not automatically projected.
- **Closing cash:** opening cash + expected inflows − planned/scheduled outflows. Green means at/above reserve; yellow means nonnegative but below reserve; red means negative. Status describes daily closing cash, not intraday solvency or complete financial health.

These are synthetic, incomplete planning assumptions. Card processing fees, refunds, tax remittances, unpaid historical settlements and unlisted obligations are not supplied. The menu report, HR sample week and historical ledger remain separate samples; the forecast explicitly combines selected assumptions rather than claiming reconciliation. Saved forecasts are not updated when source data changes.

## API and persistence

`/api/tactical/cash-calendar` uses the existing signed workspace cookie, same-origin mutation checks, bounded JSON, restaurant binding and schema validation. Production multi-tenant identity remains future work.

- `GET ?restaurantId=...`: latest twenty saved forecasts, most recent first.
- `POST {action:"refresh", restaurantId}`: read the configured sandbox account/deposits/withdrawals/bills, store a server-owned bank snapshot and return its ID. Failure of any required read fails the refresh.
- `POST {action:"save", restaurantId, name, bankSnapshotId, config}`: load the bank snapshot server-side, recompute canonical inputs/validate the forecast, and save the version. The client cannot upload an arbitrary bank balance and label it as a verified Nessie response. `bankSnapshotId:"demo"` uses the configured dataset's explicit local fixture.

MongoDB uses the existing shared `restaurantos` database with Tactical-owned collections:

| Collection | Stored data |
| --- | --- |
| `tactical_datasets` | Default cash-calendar configuration and synthetic data, alongside existing restaurant fields |
| `tactical_bank_snapshots` | Server-read Nessie snapshots, IDs and restaurant binding; no API keys or account numbers |
| `tactical_cash_forecasts` | Named immutable bank/config/input snapshots, model version, source-input hash and save time |

Only the latest twenty forecast versions are listed, but older MongoDB records are not deleted automatically. Retention/deletion policy and tenant-level permissions are future production work. Demo mode uses bounded process memory for bank snapshot IDs and browser storage for saved forecasts; the UI never claims those are MongoDB saves.

## Nessie contract and verification

The adapter keeps the existing investment tool's three-call contract intact and adds a calendar-specific fourth read: `GET /accounts/{id}/bills`. Official schema source: [Nessie OpenAPI](https://prod.nessieisreal.com/nessie-openapi-spec.yaml). Each response is bounded and schema-validated, with fixed HTTPS host, no redirects and no provider URL/error logging. Legacy IDs and live UUIDs are accepted.

The configured live account read succeeded with a checking balance of $25,000, two deposits, one withdrawal and **zero bills**. Scheduled-bill rendering is therefore exercised with explicitly synthetic fixtures and adapter tests, not falsely claimed as observed live bills. The data migration saved `juniper-table` revision **8**, including its opening cash forecast. No remote bank records were created for this increment.

## Files

- `domain/cash-calendar.ts`: schemas, UTC recurrence, source input mapping and pure forecast calculations.
- `backend/adapters/nessie.ts`: existing account reader plus `readNessieCash`.
- `backend/cash-calendar-service.ts`: protected API and MongoDB/in-memory stores.
- `backend/cash-calendar-cli.ts`: non-destructive seed utility.
- `src/app/api/tactical/cash-calendar/route.ts`: thin route.
- `frontend/components/cash-calendar.tsx` and `.css`: responsive calendar, agenda, settings, daily evidence and version controls.
- `cash-calendar.test.ts`: accounting, dates, missing data, matching, API access and snapshot isolation tests.
- `frontend/e2e/cash-calendar.spec.ts`: save/reopen, settings, explicit refresh/failure, narrow screen and keyboard journeys.

## Remaining work

Real bank/POS/payroll integrations, verified settlement timing, complete purchase/tax/refund coverage, editable inventory quantities in the calendar, source-change comparisons, authentication per business, notification delivery and automated reconciliation are not included. No automatic payments or bank transfers are supported.

## Validation record

- Typecheck, lint (one pre-existing Expansion warning), and production build passed. Existing Expansion tracing warnings remain.
- Repository unit suite: 268 passed, one pre-existing skip. Tactical browser suite: 66 checks passed across Chrome and Firefox.
- A live authenticated browser refresh loaded the configured Nessie sandbox snapshot, saved `Nessie cash plan` to MongoDB, and reopened it after reload with the original inputs and balance.
- Desktop month view and mobile agenda were visually inspected. The narrow-screen day breakdown is a dismissible bottom panel with keyboard Escape support; daily financial details do not require scrolling past a whole month.
- Rain's latest Expansion changes were fast-forwarded before final verification; no Expansion-owned implementation was edited by this task.
