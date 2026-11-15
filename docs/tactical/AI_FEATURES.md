# Tactical AI workflows

**Connected assistant update (November 15):** `/tactical/ai` now supports saved multi-turn history, typed source/result tools, editable stock/menu previews and purple cross-page navigation. See [Assistant workflow](ASSISTANT_WORKFLOW.md) for current behavior and local-only verification. Other page-specific AI caches retain their existing contracts.

The user’s latest request enables Tactical AI features, replacing the earlier advisor-placeholder restriction. AI features and results use purple. On failure, the interface and API return exactly **Something is wrong**. No generated demo result or rule-based fallback substitutes for a failed provider call.

## Features available

| Location | AI workflow | Controls and boundaries |
| --- | --- | --- |
| Floor Plan | Geometry/review analysis | Cited hypotheses, limitations, priorities and optional validated object moves. Inspect cited objects highlights them purple. Preview is separate from the working layout; Apply commits one undoable change and Reject preserves the draft. |
| Floor Plan | Custom-object designer | Describe equipment/furniture; receive editable name, category and estimated meter dimensions. Use object suggestion fills the manual placement form. Nothing is placed automatically. |
| Customer Reviews | Saved AI filtering | Incremental Gemini topics, sentiment, high-priority decisions and explanations. Persisted per source review in MongoDB; only missing or edited reviews are sent again. See [review workflow](REVIEW_WORKFLOW.md). |
| Customer Reviews | Review reply | Use Draft with AI beneath any review, edit and copy it. Reply remains disabled. No platform posting, invented refunds or compensation commitments. |
| Financial Intelligence | Financial analysis | Three report observations/actions with evidence from canonical dated item sales, comparable prices, delivery and slow-seller calculations. Shares report facts with the advisor. Independent ledger context stays labeled; playground edits are not sent to AI. Existing 10-minute cache, no durable finance artifact. Prices and records never change automatically. |
| Supply Management | None | Inventory-only page. No AI controls, session lookup on entry or dedicated supply task. Inventory facts remain available to explicit questions in the central assistant. |
| HR | Staffing assessment and hiring drafts | Four persisted green/yellow/red assessments grounded in code-calculated coverage, order/menu demand and reviews; hover/focus explanations. Choose a role and edit/copy its AI job description. Purple marks AI. Indeed posting stays disabled. See [HR workflow](HR_WORKFLOW.md). |
| AI Assistant | Restaurant advisor | Single-turn questions grounded in current Tactical data and the working layout. No Expansion data, web research, external tools or conversation memory. |
| Photo editor | Gemini photo estimation | Existing photo interpretation now uses the same Gemini adapter and access boundary. Model output is parsed strictly; failure never loads the sample plan. Explicit manual Sample/Blank controls remain. Photos and estimates still require manual measurement/verification. |

## Purple treatment

`frontend/components/ai.css` defines Tactical-scoped purple ink, surface, border, button and focus tokens. AI controls, findings, review classifications, editable drafts and photo results use those tokens plus text labels, so provenance does not depend on color alone. Deterministic calculations and rule-based layout findings keep their ordinary styling.

Applied AI moves/custom objects carry `aiSource` (model, generatedAt, method). The canvas and inspector retain a purple indication through browser save/reload/export. This records AI origin, not correctness: subsequent manual edits are still user-controlled. Pending AI layout ghosts are purple and never contribute to capacity until applied.

## Local setup

Use ignored `.env.local` or deployment secrets:

```dotenv
GEMINI_API_KEY=YOUR_PRIVATE_GEMINI_KEY
TACTICAL_AI_MODEL=gemini-2.5-flash
# Optional separate photo model; defaults to the main model:
# TACTICAL_AI_PHOTO_MODEL=gemini-2.5-flash
# Optional separate AI access code, at least 32 characters:
# TACTICAL_AI_PASSWORD=YOUR_LONG_RANDOM_WORKSPACE_CODE
```

If `TACTICAL_AI_PASSWORD` is omitted, the existing **TACTICAL_API_TOKEN** is the workspace AI access code. Open the purple **AI workspace** control, enter that code and choose Unlock AI. The provider API key is never entered into the browser. Do not paste either credential into chat or commit it. Rotate the Gemini key shared during setup before deployment and update the ignored environment file. Restart the app after changing secrets.

An eight-hour signed `HttpOnly`, `SameSite=Strict` cookie protects `/api/tactical/ai` and photo analysis; HTTPS also sets Secure. Lock AI clears it. This is one shared workspace credential, not a multi-user account/role system. It does not grant the browser the Mongo admin bearer token through an API response.

## Provider, validation and calculations

The Gemini REST adapter uses `generateContent`, structured JSON output, a 60-second deadline, no redirects, and server-side `x-goog-api-key`. The user-authorized Gemini key is stored locally and omitted from Git. No new SDK dependency is added; Rain’s Anthropic dependency/code remains unchanged.

The provider grammar omits length/range constraints to stay within Gemini’s schema complexity limits. **The complete Zod schema is still enforced after generation.** Truncated/refused/malformed output, invalid evidence IDs, fabricated review excerpts, invalid layout ownership, out-of-bounds/overlapping moves, timeouts, missing keys and provider errors yield the same generic failure. Provider internals are not sent to the browser.

Every finding cites server-built evidence IDs. Review excerpt validation checks an actual substring in the cited review. Each review in the bounded research sample must be classified once. Existing menu IDs are required for dish mentions. Reference validation does not prove that every free-text claim is correct: owners still review interpretations, costs and recommendations.

Layout counts, ledger totals, menu channel contributions, staffing base-cost summaries and supply cost-to-threshold values are computed by TypeScript before prompting. The model is instructed to preserve those meanings, mark unknowns and avoid presenting contribution as profit. No generated financial amount is written into the canonical dataset.

The context contains selected mock business records, not credentials or employee contacts. Reviews/descriptions are treated as untrusted data in the system prompt. Evidence is rendered as text, not HTML. No posting, purchasing, external tool execution or automatic database mutation is available to the model.

## Requests, caching and limits

- `GET/POST/DELETE /api/tactical/ai/session`: session status, unlock and lock.
- `POST /api/tactical/ai`: task, restaurant ID, bounded instructions, optional selected review ID and working layout. The server loads the restaurant dataset and validates ownership.
- `POST /api/tactical/analyze`: existing photo request with the same session and origin checks.
- Non-GET actions require the exact request origin. JSON bodies are streamed and capped (256 KB text tasks, 32 MB photo tasks, 2 KB unlock).
- Text tasks allow two simultaneous requests per handler; photo analysis allows one. A process-wide ceiling of 60 generations/hour and 20 unlock attempts/minute bounds local use.
- Text results are cached for 10 minutes, up to 50 entries, keyed by model, prompt version, selected instructions and the complete provided evidence. Cache provenance is visible; failures are not cached.
- Changed working layouts/questions mark displayed results stale and disable layout/object reuse until regenerated. UI cancellation abandons the request and clears loading state.

These process-local limits/cache are not distributed deployment controls. Before a multi-user deployment, add proper accounts, a distributed limiter, account-scoped quotas and a durable analysis-retention policy. Assistant messages and typed results are stored in `tactical_conversations` in Mongo mode; other feature outputs are not migrated into a common history collection. Explicitly applied layout provenance persists with the browser library.

## Code map

| File | Responsibility |
| --- | --- |
| `domain/ai.ts` | Request/output schemas, evidence validation and geometry-safe proposals |
| `backend/gemini.ts` | Gemini transport, bounded structured output and timeouts |
| `backend/ai-context.ts` | Server evidence catalog, deterministic summaries and task instructions |
| `backend/ai-service.ts` | Authenticated task orchestration, context hash/cache and generic errors |
| `backend/ai-access.ts` | Signed session, streamed input bounds, origin checks and local budget |
| `backend/analyze.ts` | Photo estimation with no fallback and strict output checks |
| `frontend/components/ai-workbench.tsx` | Shared access control and purple generation/evidence/draft UI |
| `frontend/components/ai.css` | Shared Tactical AI appearance |

Provider references: [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [generateContent API](https://ai.google.dev/api/generate-content).

## Remaining product boundaries

Review CSV/JSON imports, production social-provider ingestion and verified sponsor eligibility, real operational records, common durable analysis artifacts and end-user cloud synchronization remain separate work. Photo calibration and conversion to the main editor remain deferred. Adding Gemini does not constitute Nessie, Arlequin, Amazon or CoStar integration.

## Verification in this implementation

- 147 unit tests, 24 Chrome/Firefox browser runs, lint, typecheck and production build passed. The two pre-existing Expansion filesystem-tracing build warnings remain.
- Live Gemini output passed the task schemas/evidence checks for all eight text workflows. Authenticated live review generation was also exercised in the browser against the MongoDB-backed mock dataset. Unlock returned 200, unauthorized access 401, and locking the session restored 401.
- A live photo-handler call returned a schema-valid AI estimate from a synthetic floor-plan screenshot after clarifying that door position is a fraction, not a distance. This verifies transport/schema behavior, not accuracy on real restaurant photographs. Invalid provider output was rejected with the exact generic error.
- Desktop/mobile purple rendering was inspected; the reviewed 390 px page had no horizontal overflow. Controlled browser-test responses are separate from the live-provider verification above.
- No MongoDB business records or Expansion code were changed by the AI implementation. Secrets were scanned out of tracked/nonignored files.

## Network interpretation

Reviews now includes a purple AI network interpretation panel under Relationship network. It sends only the imported/sample graph and source excerpts on explicit request, computes metrics before prompting, validates source references and returns the same generic failure message. Source-linked hypotheses do not imply real customer findings when the input is synthetic. See [sponsor guide](SPONSOR_INTEGRATIONS.md).

## Arlequin message semantics

Reviews → Content & connectivity now classifies each loaded message into AI topics and tone. The model selects a source-excerpt index; code materializes exact source text and joins the labels to deterministic actor communities and explicit reply/repost paths. Full coverage, valid IDs and source indices are required. Failures remain **Something is wrong**. See [Arlequin Track 2](ARLEQUIN_TRACK2.md) for observed-data verification and limitations.

## Connected data and AI proposal

See [Connected data and AI plan](CONNECTED_DATA_AND_AI_PLAN.md) for current persistence gaps, the proposed context/artifact/decision model, MongoDB responsibilities and phased migration. This is a plan, not shipped architecture.

See [Financial Intelligence workflow](FINANCE_WORKFLOW.md) for report sources, formulas and persistence limits.
