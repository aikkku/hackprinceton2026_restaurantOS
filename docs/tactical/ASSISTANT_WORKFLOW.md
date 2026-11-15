# Connected AI Assistant

Implemented November 15, 2026 at `/tactical/ai`. This extends the Sprout redesign into a connected chat workflow, rather than reskinning the old single-turn advisor.

## What the owner can do

- Start a chat, revisit the latest thirty conversations, and continue with recent conversation context. The central composer supports Enter to send and Shift+Enter for another line. Purple distinguishes assistant interpretation, tool results and proposed changes.
- Use four contextual suggestions built from actual inventory/menu records and the supplied reviews: locate stock, compare reorder levels, test a dish price, and explore feedback.
- Ask “How much ribeye steak do we have?” The model selects a validated inventory ID; code renders its exact recorded quantity. A single-record lookup navigates to Supply, clears incompatible filters, focuses/scrolls the tile and highlights it purple for 4.5 seconds. A short notice links back to the saved conversation.
- Follow source buttons into current menu assumptions in Finance, the HR roster, original reviews or working floor furniture. Collapsed details and the appropriate subsection open automatically. Ambiguous/multiple matches remain selectable in chat.
- Inspect code-rendered tables for stock, menu prices/costs, team hours, verbatim reviews and furniture coordinates; a normalized stock/reorder chart; financial metric cards; and a price-test widget with raise and demand-loss sliders. Numeric results use existing deterministic functions. Charts do not compare incompatible stock units directly: the common scale is percentage of each item's reorder point.
- Request a specific inventory/menu edit. The assistant prepares an editable before/after preview. Only **Apply change** saves it. The page then reflects the returned validated dataset without resetting unrelated floor drafts. Applied proposals remain in conversation history, with before/after values and time.

Example requests:

- “How much ribeye steak do we have? Show me where it is.”
- “Compare our low stock against reorder points.”
- “Let me test a price increase for Caesar Salad.”
- “Set the ribeye on-hand quantity to 42 lbs.” Use the item's recorded unit; the model should ask when units or intent are unclear.
- “Show the reviews mentioning wait time.”
- “Where is the cashier stand on the working floor plan?”

## Tools and edit boundaries

The model returns a bounded, schema-validated plan. The server dispatches only these tools; it does not execute model-written JavaScript, SQL, Mongo queries, URLs or arbitrary API requests.

| Tool | Result |
| --- | --- |
| `find_records` | Existing inventory, menu, roster, review or furniture rows with stable source targets |
| `stock_overview` | Recorded quantity/reorder percentages and statuses |
| `finance_report` | Existing canonical period sales, contribution and app commissions |
| `team_overview` | Fictional roster, supplied hours and pay assumptions |
| `review_evidence` | Original supplied text, date and rating |
| `floor_plan` | Current working geometry and canonical seat count; saved versions are additional model context |
| `price_test` | One dish's historical sales inputs, editable raise/loss sliders and deterministic outcomes |
| `propose_update` | Editable proposed change to one allowlisted inventory/menu field |

Editable inventory fields: on-hand quantity, reorder point and unit cost. Editable menu fields: current dine-in/app prices, ingredient cost and packaging cost. Currency is integer cents at the API/domain boundary and dollars in the form. The full aggregate is revalidated before saving. No external order, payment or live menu update is sent. Employee decisions, schedule writes, review posting and layout mutations are not assistant tools in this release; the existing page workflows remain available.

Historical item-sales **prices** remain immutable snapshots. Changing ingredient/packaging assumptions changes the existing report's calculated contribution; changing current menu prices does not rewrite historical revenue. Finance now includes a distinct **Current menu assumptions** disclosure so edited values have a visible source destination. Saved cash forecasts keep their original inputs.

Supply remains free of AI generation controls or background jobs. Its purple highlight is a temporary navigation cue triggered by an explicit assistant lookup.

## API

All calls use the existing signed workspace cookie. Mutations require a matching Origin, bounded JSON and the configured restaurant binding. The shared demo access code is not multi-tenant identity.

`GET /api/tactical/assistant?restaurantId=...`

Returns latest thirty chat summaries, contextual suggestions, current dataset/revision and storage label.

`GET /api/tactical/assistant?restaurantId=...&threadId=...`

Returns one restaurant-bound conversation plus current dataset/revision. Loading history does not replay its automatic navigation.

`POST /api/tactical/assistant`

- `action: "message"`: restaurant ID, stable thread/message UUIDs, text and optional validated working layout/version library. The server obtains the saved dataset, supplies minimized employee context without contacts/mood/ratings, and uses up to ten recent messages with their targets/proposals. It validates the plan, executes read/proposal tools, and saves the turn before returning success. The response contains canonical source cards rather than model-authored numeric values.
- `action: "apply"`: restaurant/thread/message/proposal IDs and edited numeric value. The server loads the saved proposal; the browser cannot substitute another target, field, original value or revision. Dataset revision and original field value must still match. An already-applied proposal returns its saved outcome without applying twice.

Provider, parsing and persistence errors use **Something is wrong**. A revision conflict explicitly asks for a fresh preview. No synthetic answer is substituted. The composer preserves unsent text on failure; retry reuses the message UUID, avoiding a duplicate saved turn after a lost response. Concurrent thread writes use compare-and-swap revisions.

## Persistence

Mongo mode uses the shared `restaurantos` database:

- `tactical_conversations`: bounded conversations with title/times, message IDs, source dataset revision, model, typed result snapshots, navigation targets and proposed/applied changes.
- `tactical_datasets`: existing canonical restaurant aggregate. Applying a proposal saves this document **and** its chat audit state in a MongoDB transaction. Both writes check revisions; neither succeeds alone. Atlas/replica-set transaction support is required; there is no non-atomic fallback.

Chats allow thirty turns (sixty messages), at most four planned tools per reply, and at most 4 MiB of serialized saved conversation data. History lists thirty recent chats; older chats are not automatically deleted. Only the last selected chat ID is stored in browser local storage. Access codes/provider keys are never stored in the chat or returned to the browser.

Local fixture mode uses a clearly labeled **server session** store. It supports reload during the same process, but resets on server restart and is not a durable Mongo substitute. Both the normal dataset loader and assistant read this same demo session data. No fixture file is rewritten.

## Code map

| File | Responsibility |
| --- | --- |
| `domain/assistant.ts` | Request/plan/card/history/proposal schemas, allowlisted edit validation, contextual suggestions |
| `backend/assistant/tools.ts` | Canonical read tools, validated proposals and model instructions |
| `backend/assistant/service.ts` | Authentication, bounded generation/history, retries, Apply orchestration |
| `backend/assistant/repository.ts` | Mongo conversation storage, transactional edits and isolated session repository |
| `backend/demo-store.ts` | Shared process-local demo dataset used by the normal loader and assistant |
| `src/app/api/tactical/assistant/route.ts` | Thin GET/POST route |
| `frontend/components/ai-assistant.tsx` | Chat, history, composer, retry and shared-data reconciliation |
| `frontend/components/assistant/assistant-blocks.tsx` | Tables, charts, metric cards, price sliders and change previews |
| `frontend/components/assistant/assistant.css` | Sprout chat/purple tool styling and transient locator cue |
| `frontend/assistant-navigation.tsx` | Record reveal, focus, scroll and temporary highlight |
| `frontend/components/tactical-workspace.tsx` | Current dataset/revision and cross-page navigation |
| `assistant.test.ts`, `frontend/e2e/assistant.spec.ts` | Tool/security/storage and browser journeys |

## Remaining work and limits

- Production user/workspace identity, permissions, chat deletion/retention and paginated/searchable history beyond the latest thirty.
- Streaming responses, conversation branching/renaming, saved slider adjustments and context beyond the last five turns.
- Additional carefully typed tools for calendar/shift/layout changes, linked decisions and shared durable AI artifacts. Existing review/HR caches are not migrated by this work.
- Recipe mapping, POS/order ingestion, complete financial reconciliation and real operational data; current records remain synthetic.
- Automatic refresh across different browser sessions, field-level conflict merging, durable background jobs and common source-dependency invalidation. Current Apply updates the active workspace and future server reads; it does not broadcast to other tabs.
- Live Gemini/MongoDB integration validation is deferred at the user’s request; verification remains local. Schema-valid model plans can still misunderstand an intent; Apply previews and original evidence remain important.

## Verification and field note

Validation: 306 unit tests passed with one existing skip; typecheck, lint and production build passed with existing Expansion warnings. The final full browser run passed 95 of 96 checks; the remaining Firefox test filled the composer before route readiness. After adding explicit URL/visible/enabled assertions, all ten focused assistant checks passed in Chromium and Firefox. Unit checks cover exact source values, allowlisted tools, invalid/stale proposals, idempotent retries, persisted context, authentication/origin/restaurant binding and failure redaction. Browser checks cover saved history, sliders/charts, applying changes, generic failures and record navigation/highlight on every supported page.

Manual CUA browser access was unavailable in this chat. Automatic approval review initially rejected the live smoke test because it would transmit restaurant context to Gemini and persist a test chat in MongoDB; the user then chose to keep verification local. Local tests use mocked provider responses and isolated data. No live conversations, inventory or menu records were written during validation.

Field note: save model-selected IDs and render values from canonical code. Keep source navigation independent of page filters; use a transient focus/highlight cue and reveal the relevant subsection before scrolling. Save the dataset change and its conversation audit in one transaction. ChatOverflow CLI is unavailable (`command not found`), so this note is recorded locally.
