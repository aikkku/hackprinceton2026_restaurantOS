# Financial Intelligence — current workflow

Updated 2026-11-15. Open `/tactical/finance`. The page uses the selected restaurant dataset directly; there is no address/menu/sales-upload onboarding.

## What is implemented

- **Report:** dismissible/reopenable assumptions, period totals, purple AI observations and suggested actions with evidence, price-gap bars, comparable-price table, suggested price tests, expensive-item flags, delivery economics, slow-seller analysis and the full menu contribution table.
- **Price playground:** top 15 items by sample revenue with dine-in sales; editable dollar raises and estimated customers lost per 10% price increase; expected loss, break-even loss, period contribution change and annualized illustration. Suggested raises and reset work. Edits survive switching report/playground tabs, but not a page reload. Experiments never change menu prices.
- **Recorded ledger:** collapsed, independent sample with month/channel/type filters. Its income/expense totals reconcile to its own records; it is not added to the item-sales report.
- **Nessie Sandbox:** existing protected demo/API cash planner remains accessible from the utility button. The report does not treat its sandbox balance as restaurant revenue.
- **AI:** existing protected Gemini endpoint interprets canonical report metrics; Finance and the advisor receive the same report evidence. Purple results expose source details. Failures display `Something is wrong` with retry. No synthetic AI fallback. Finance receives code-derived qualitative directions while the response retains full numeric source evidence. Finance narrative is qualitative: server validation rejects model-written numeric prose; exact figures are rendered from canonical calculations and evidence. This prevents invented numerical calculations from being displayed, but does not make qualitative model interpretation infallible.

## Source of truth and persistence

Editable mock file: `src/features/tactical/frontend/data/demo-restaurant.json`.

`operations.financeReport` contains source ID, explicit synthetic provenance, inclusive start/end dates, item/channel unit counts, historical dine-in/app price snapshots and model assumptions. Menu records supply ingredient costs, packaging and app commission. Comparator records carry source, date and approximation labels. Zod rejects invalid periods, duplicate sales item IDs and unknown menu/source references. This field is optional so legacy datasets still load with an honest empty report.

The default sample covers **2026-08-01 through 2026-10-31: 92 days**, 24 menu items and 29,884 units. The dataset now includes 65 comparison observations across three **fictional** sample restaurants. These are not scraped nearby prices. The item report, historical ledger and HR demand week are independent synthetic samples and must not be reconciled by inventing transactions.

MongoDB's existing `restaurantos.tactical_datasets` document stores the report inside the dataset. This increment saved the report and appended missing comparator IDs to `juniper-table`, reading back **revision 7**, without replacing unrelated fields. Later verification attempts encountered Atlas server-selection/TLS failures; browser verification used explicitly selected demo mode. Do not claim current database availability from the earlier successful write alone.

AI uses the existing process-local 10-minute cache keyed by model, prompt version and supplied context. Prompt version is now v8. There is no new durable finance-AI collection or saved pricing experiment in this increment. The [connected-data plan](CONNECTED_DATA_AND_AI_PLAN.md) remains a proposal for those capabilities.

## Calculations

All canonical arithmetic lives in `domain/finance-report.ts`, with integer-cent input prices and explicit rounding of aggregate monetary results.

```text
revenue = dineInUnits × dineInPrice + pickupUnits × dineInPrice + appUnits × appPrice
appFees = appUnits × appPrice × commission
packaging = (pickupUnits + appUnits) × packagingCost
contribution = revenue − ingredientCost × totalUnits − appFees − packaging

price test loss = min(1, lossPer10PercentRaise × (raise / currentPrice) / 0.10)
candidate units = dineInUnits × (1 − loss)
contribution change = candidateUnits × (newPrice − ingredientCost)
                    − dineInUnits × (oldPrice − ingredientCost)
break-even loss = raise / (oldPrice − ingredientCost + raise)
annualized illustration = period result × 365 / inclusivePeriodDays
```

Break-even loss is unavailable when the starting unit contribution is nonpositive. Invalid inputs do not produce a result. Ingredient cost stays fixed per unit as price changes; the reference's generic food-cost percentage does not override supplied item costs.

Comparable medians use the latest observation per sample restaurant/item. Suggested raises close half a gap below −5%, round to $0.50 and respect the configured cap (default 25%). Their fixed default volume-loss assumption is 5%; the playground has a separate editable loss sensitivity (default 4% per 10% raise).

Delivery scenarios apply hypothetical markups to the dine-in base at unchanged app volume, then subtract supplied commissions. They compare against actual supplied app prices, so a suggested-looking markup may be worse than the current one. The commission-only break-even markup is `fee / (1 − fee)`; packaging/customer loss are additional costs. Zero volume or 100% commission produces unavailable ratios rather than infinity.

Slow sellers fall below the configured share of units (default 0.5%). A cut estimate compares assumed extra spoilage saved (15% of ingredient spend) against lost contribution after assumed switching (35%). This is an illustrative estimate, not measured waste or a recommendation to remove every low-volume item.

Contribution excludes labor, rent, utilities, tax and payment fees. Annualized values assume unchanged pace and are not forecasts or net profit.

## Code map

| Location | Responsibility |
| --- | --- |
| `domain/finance-report.ts` | Report schema, aggregation, comparables, delivery/cut estimates and playground calculation |
| `domain/dataset.ts` | Aggregate validation and cross-reference checks |
| `frontend/components/finance-page.tsx` | Report layout, assumptions, evidence and navigation |
| `frontend/components/finance-report.css` | Scoped responsive styling |
| `frontend/components/finance-insights.tsx` | AI request/loading/error/results and evidence actions |
| `frontend/components/price-playground.tsx` | Editable local price experiments |
| `frontend/components/finance-ledger.tsx` | Independent filtered ledger |
| `backend/ai-context.ts` | Shared canonical finance evidence for Finance/advisor |
| `finance-report.test.ts` | Eight calculation/schema/evidence tests |
| `frontend/e2e/finance-report.spec.ts` | Report, evidence, playground, invalid input and narrow-screen failure journeys |

## Still to implement

- Authorized POS/accounting imports and reconciliation across item sales, ledger and operational periods.
- Real, permissioned comparable-menu observations with matching portion/channel/date context.
- Named pricing scenarios persisted with assumptions, source revision and model version.
- Durable AI artifacts, explicit stale-result handling and cross-page decisions from the centralization proposal.
- Measured demand response, waste data and complete costs before forecasting profit.
- Production identity/tenant authorization beyond the current demo access mechanism.

The user's copied artifact inspired report structure and interactions; this is implemented in the existing Next.js app, not as a separate published artifact. No supplied reference test restaurant/files were assumed to exist.

## Verification for this increment

- Typecheck and production build passed. Build retains existing Expansion file-tracing warnings.
- Unit suite: 252 passed, one pre-existing skip, no failures. Includes numerical narration rejection and qualitative source mapping.
- Full Tactical browser suite: 30 Chrome and 30 Firefox checks passed. Finance/AI checks rerun after the final model-input boundary change.
- Live Gemini returned validated, evidence-linked qualitative findings against the synthetic fixture. Earlier numeric narration errors motivated the stricter model boundary; narrative remains interpretation, not ground truth.
- Desktop and narrow-screen report/playground inspected; assumptions, evidence, suggested raises, reset and tab persistence verified. Mobile tables intentionally scroll within their container.
- MongoDB migration read back revision 7, but later fresh reads failed with server-selection/TLS errors. Explicit demo preview remains usable; no TLS/network protections were weakened.

## Cash calendar addition

Finance now has Report, Price playground and **Cash calendar**, plus the existing Nessie utility. The calendar shares canonical restaurant inputs and provides a separate dated cash scenario; it does not add cash balances to menu revenue. See [Cash calendar](CASH_CALENDAR.md). MongoDB connectivity recovered during this increment: the new mock configuration is saved at revision 8 and live forecast saving/reopening is verified.
