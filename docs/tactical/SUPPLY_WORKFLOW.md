# Supply Management

Open `/tactical/supply`. This is a read-only inventory workspace backed by the same validated mock restaurant used by Finance and HR. No AI, supplier directory, purchase submission or stock editing is exposed here.

## Current page

- Three derived summary cards show tracked items, items below their reorder point and items with a delivery date. The current fixture has 37 items, 18 below reorder point and 23 with a delivery date. “Awaiting delivery” follows the existing recorded-date rule; it is not a live shipment status.
- Search by item name and combine category and stock-status filters. Clear filters is available whenever a filter is active, including when matching items remain. The result count reports matching versus total items.
- Inventory cards use the Sprout palette, category icons, explicit stock-status badges, quantities with units and prominent expiration dates.
- Stock details expands to show reorder quantity, unit cost, next delivery and last ordered date. Keyboard users can focus and activate the disclosure.
- An empty result offers guidance to adjust or clear filters. An empty inventory is distinct from a search with no matches.

## Meaning and limits

Stock status is computed by the existing `stockStatus` function: critical below half the reorder threshold, low below threshold, overstock above 1.5 times threshold, and in stock otherwise. Summary and status arithmetic remains deterministic.

Expiration is displayed exactly from the supplied date. `null` means **No expiry listed**; an absent field means **Not recorded**. Neither means fresh or expired. The page does not infer shelf life, label food safe, calculate expiry alerts or alter recorded dates as time passes. Batch-level tracking and date-relative alerts require separate work.

The dates and quantities are fictional. Cost and delivery records remain available to the existing cash forecast; collapsing details does not delete or change them. No database migration or data upload was introduced by the redesign.

## Files

| File | Responsibility |
| --- | --- |
| `frontend/components/supply-page.tsx` | Summary, search/filter state, item cards, disclosures and empty states |
| `frontend/components/supply.css` | Page-scoped Sprout presentation and status tokens |
| `domain/finance.ts` | Existing stock-status thresholds |
| `domain/dataset.ts` | Inventory schema and references |
| `frontend/data/demo-restaurant.json` | Editable synthetic inventory |
| `frontend/e2e/supply.spec.ts` | Filtering, dates, keyboard details and zero AI requests |

## November 15 redesign verification

299 unit tests passed with one existing skip. All 16 focused Supply, shell and cross-page browser checks passed in Chromium/Firefox. Lint, typecheck and production build passed with existing Expansion warnings. Manual laptop review used the configured restaurant dataset and checked search and expanded costs/delivery details. Existing narrow-screen fallbacks remain; dedicated mobile design is deferred.

Field note: keep the complete inventory as the source for summary counts, then apply view filters to cards. Reset should be reachable for matching results as well as empty results. Category icons are decorative; keep the text category and status label for accessibility. ChatOverflow was unavailable in this environment, so this note is recorded locally.
