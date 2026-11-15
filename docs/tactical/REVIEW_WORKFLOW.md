# Customer reviews and saved AI filtering

Open `/tactical/reviews`. Reviews still use the synthetic restaurant dataset. Purple identifies AI interpretations and drafts; ratings and counts are calculated from the supplied records.

## Page behavior

- Every review has **Draft with AI**, an editable draft, **Copy**, and **Regenerate**. The existing workspace access code enables generation. The short **Reply** button stays disabled because platform posting is not connected. Nothing is published. Reply drafts are temporary UI state, not database records.
- **High priority** replaces the old fixed mission-evidence filter and badges. It selects reviews that Gemini marked as actionable concerns. Hover over the purple sentiment/theme labels to see the saved explanation, model and processing date. The explanation is also exposed to screen readers on that focusable row. Priority is an interpretation of a review, not a verified fact or safety assessment.
- Theme and sentiment filters use saved AI classifications. Search combines original text, source ID and AI themes. Fixture-authored themes and the historical mission evidence IDs no longer decide the review page's filters.
- Themes and the review list have independent bounded scroll regions, including on narrow screens. The theme region is keyboard-focusable.
- A seating-related high-priority review exposes **Review floor plan**, which opens the expandable seating analysis on Floor Plan.
- Failed generation or classification shows **Something is wrong**. Existing classifications and an already edited reply remain available on a failed retry.

## Incremental processing

`restaurantos.tactical_review_analysis` is a Tactical-owned collection in the same database as `tactical_datasets`. Each completed record stores the exact review source (ID, text, date, rating), themes, sentiment, priority, reason, model, processing time and pipeline version. It never replaces the original restaurant dataset.

The document key hashes restaurant ID, review source and pipeline version. Reading or refreshing unchanged reviews reuses those records, including across server restarts. A new review or a source edit gets a new key; old classifications are excluded from the page. Editing legacy authored themes does not trigger another model call. Changing the model configuration alone does not reinterpret existing reviews; intentionally revise the pipeline version to invalidate classifications globally.

A protected POST processes up to ten missing reviews per request. On the Reviews tab, an unlocked workspace automatically drains pending batches. MongoDB leases and unique document IDs coordinate simultaneous tabs/processes. A failed or cancelled request releases its unfinished claims; an interrupted worker's lease expires after 90 seconds. The pipeline validates exact ID coverage and the fixed topic vocabulary before committing any results from a model response. A partially completed database write can be retried without regenerating rows already saved.

Successful dataset uploads through the existing authenticated dataset PUT automatically process one missing batch. For the normal single new comment, only that comment is sent to Gemini. Larger imports and provider failures can leave pending rows; the next unlocked Reviews visit or **Refresh** resumes them. An AI failure does not roll back a successful dataset upload; the upload response reports `reviewAnalysis.error`. Direct Compass edits and CLI seeds are reconciled on the next Reviews visit. There is no always-running database watcher or background queue.

New reviews may omit `themes`; validation normalizes that field to an empty array. Original review IDs must remain unique. The dataset API still accepts only the current synthetic/demo contract.

## API and files

| Location | Responsibility |
| --- | --- |
| `domain/review-analysis.ts` | Fixed topics, output/storage validation and exact source matching |
| `backend/review-analysis.ts` | Content keys, batched Gemini processing, cached status and route guards |
| `backend/review-analysis-store.ts` | MongoDB records, atomic claims, lease expiry and completion |
| `backend/data-api.ts` | Invokes incremental processing after a successful dataset upload |
| `frontend/use-review-analysis.ts` | Loads saved classifications, processes missing batches and handles retry |
| `frontend/components/review-insights.tsx` | Ratings, AI themes/sentiment/priority filters and review list |
| `frontend/components/review-reply.tsx` | Per-review editable AI drafts, clipboard and disabled Reply control |
| `GET /api/tactical/reviews/analysis?restaurantId=…` | Reads valid cached classifications for the server-selected restaurant; no generation |
| `POST /api/tactical/reviews/analysis` | Same-origin signed workspace session; body `{ "restaurantId": "juniper-table" }`; processes missing records only |

MongoDB must be configured and selected to persist review analysis. Local fixture mode explicitly shows that persistence is unavailable; it never substitutes invented AI labels. Per-review replies continue using the existing protected `/api/tactical/ai` reply task. Neither endpoint accepts database credentials from the browser.

## Verification

Unit coverage checks cache reuse across processor instances, changed/new/removed reviews, concurrent claims, invalid outputs, failed-call retry, endpoint authorization, cross-restaurant isolation and the post-upload hook. Browser coverage checks priority/theme/sentiment combinations, batch completion, cached reloads, failure recovery, copyable editable drafts, disabled posting, independent scrolling and narrow screens. Live Atlas readback confirmed 30 Gemini classifications, nine high-priority reviews and unchanged records on a repeat request. A live review reply was generated and copied through the UI.

Final checks: 181 unit tests, review/AI browser checks in Chrome and Firefox (including actual clipboard-copy interaction), lint, typecheck and production build passed. The build retains two existing Expansion filesystem-tracing warnings.
