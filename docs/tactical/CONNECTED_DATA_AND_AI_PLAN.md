# Connected restaurant data and AI — implementation plan

**Date:** November 15, 2026
**Scope:** Tactical. This is a proposal, not a claim that the architecture below is implemented. No Expansion migration or shared-contract change is authorized by this document.
**Product direction:** Keep the separate pages, but make them different views of the same restaurant, evidence and decisions. One database does not mean one giant document or one giant AI prompt.

## Implementation update — November 15, 2026

The [connected assistant](ASSISTANT_WORKFLOW.md) implements a bounded part of CEN-04: Mongo conversation/result snapshots, recent multi-turn context, shared active-workspace dataset reconciliation, validated inventory/menu changes with transactional audit, and source navigation. `tactical_conversations` now exists in code; the larger contexts/runs/artifacts/events architecture below remains a proposal. No legacy HR/review cache migration or Expansion change is included. Live integration verification for the new assistant is still pending approval.

## 1. The experience we want

An owner should be able to start with a high-priority review, inspect the related seating concern, try a floor-plan change, and ask about its staffing or financial implications without re-entering context. Each page should know which restaurant, period, saved layout and pending change it is discussing.

For example:

1. A new review mentions a long wait. Reviews classifies this one new record and saves the interpretation.
2. An existing seating concern links that review to other relevant feedback and the current saved layout. This is a hypothesis, not proof that the floor plan caused the wait.
3. Opening the concern in Floor Plan highlights its evidence. The owner previews a proposed move in a draft.
4. Code calculates the capacity difference. HR can compare that explicitly selected proposal with the same week's demand and staffing; Finance can calculate an optional projection using explicit assumptions.
5. The owner saves a layout version or dismisses the suggestion. The decision and resulting version are linked to the original concern.
6. The assistant can later answer “Why did we change this?” using the saved sources, result and decision, rather than generating a new explanation from memory.

This must not bring back a standalone scenarios page or clutter every page with a generic chat box. Comparisons belong inside the concern or assistant discussion when relevant. A saved change is an action taken, not evidence that it improved the business.

**Supply Management stays AI-free:** inventory, stock status, expiration dates, search and filters only. No supply advisor, AI unlock control, supply-generation endpoint task, or automatic inventory-analysis job. Inventory facts may inform an explicit question in the central assistant; this does not create a separate supply AI feature.

## 2. What actually exists today

| Area | Current source / persistence | Connection still missing |
| --- | --- | --- |
| Restaurant facts | `demo-restaurant.json` or `restaurantos.tactical_datasets`; one validated aggregate with revision-checked writes | No shared frontend invalidation layer; a mounted page can retain old server props after another page saves |
| Floor Plan | Saved library in the dataset in Mongo mode; browser storage in local mode; working draft in component state | Current draft reaches the assistant, but there is no durable link from an AI concern to its accepted layout version |
| Review filtering | `tactical_review_analysis`, per-review source hashes, generation leases and incremental processing | Other AI workflows do not consistently reuse the saved classifications |
| HR | `tactical_hr_analysis`, source/model/task hashes for overview and original hiring draft | Separate context builder and cache; owner-edited job drafts are not persisted |
| Floor, replies, finance, assistant | `ai-service.ts` keeps a bounded ten-minute process cache; results and edits live in the browser | No durable common run history, conversation history, editable-draft storage or cross-page result IDs |
| Social/network analysis | Separate source adapters and analysis endpoints; social datasets can be saved locally, outputs are transient | Conversation records and their semantic/network results are not part of the restaurant's persistent evidence catalog |
| Nessie | Sandbox fetch/preview/export in Finance | A sandbox snapshot must remain distinct from the restaurant ledger; no common snapshot registry |
| Photo estimation | Separate photo workflow and browser correction memory | Low-priority future integration; no need to resume photo work in this increment |
| Inventory | Dataset records, including mock expiration dates | Read/write consistency should improve with the rest of the dataset; no AI work is needed |

Shared pieces already worth keeping: Zod contracts, deterministic calculations, the Gemini adapter, same-origin/session checks, purple AI styling, generic failure text and the current frontend/domain/backend boundaries.

Important mismatch: the general advisor mostly sees raw review data and authored fixture themes, while Reviews uses newer persisted AI classifications. HR has dated item-demand metrics that the general advisor does not receive in the same form. A shared JSON file alone does not solve either problem.

## 3. Organize information into four layers

| Layer | Contains | Authority |
| --- | --- | --- |
| Source records | Profile, layout versions, reviews, dated shifts, menu prices/costs, inventory, ledger records, imported social records | Validated supplied data; mark synthetic/observed/assumed provenance |
| Calculated facts | Seats, overlap pairs, staffing hours, item sales, contribution and stock thresholds | Pure versioned code, with units and period |
| AI interpretations | Review labels, staffing explanations, seating hypotheses, financial narratives, response/job drafts | Model output with evidence and limitations; never promoted to measured facts |
| Owner decisions | Edited drafts, accepted/rejected proposals, saved layouts and notes | Explicit owner actions, linked to the relevant source and analysis versions |

An AI summary must not overwrite a customer quote or become a new sales record. An accepted staffing suggestion is still a plan, not an actual hire. An accepted layout proposal does not establish additional realized revenue.

## 4. Shared restaurant context, assembled on the server

Introduce a Tactical-local `RestaurantContextService`. It resolves restaurant access and requested scope, reads canonical records, computes the relevant metrics, and adds current validated analysis artifacts where useful. Existing endpoints become adapters around it rather than independently reconstructing the restaurant.

A context manifest should include:

- Restaurant ID and authorized workspace/owner scope.
- Dataset revision plus the exact source versions used.
- Reporting window, timezone and currency; explicit unavailable periods.
- Selected saved layout ID, or an immutable temporary draft snapshot/hash with its saved base version.
- Canonical metrics with calculation version, units, formulas/assumption references and provenance.
- Evidence references and the limited source excerpts supplied to the model.
- Referenced AI artifact IDs, labeled as interpretations with their own source versions.
- Coverage: included/available records, omitted sources, stale inputs and unavailable joins.
- Context schema version and a canonical content hash.

There should be one context service with several small projections, not an unrestricted prompt containing everything:

| Workflow | Context projection |
| --- | --- |
| Review triage | New/edited review, restaurant identity and permitted theme/menu vocabulary |
| Review reply | Selected review, approved business response guidance and relevant current classification |
| Seating concern | Selected saved/draft coordinates, geometry metrics, relevant review evidence and current seating concern |
| HR assessment / hiring | Aggregate role coverage, shifts, dated demand, menu mix and service feedback; no employee contact details, mood or performance ratings |
| Financial analysis | Selected period/channel, matching ledger/item metrics and explicit projection assumptions |
| Assistant | Relevant projections selected by the question and active concern; show missing data rather than silently widening scope |
| Social analysis | Explicitly selected conversation dataset and its observed edges; do not identify review authors as social accounts without supplied links |

### Fix the joins before asking AI to connect them

- Use stable IDs for restaurant, review, menu item, employee, shift, inventory item, layout version and furniture object. Furniture IDs remain stable across layout versions.
- Evidence references need `{ restaurantId, entityType, entityId, versionOrHash, sourceId }`. Local names such as `version:1` are display aliases, not durable identities.
- Connect dated demand items to `menuItemId`, shifts to `employeeId`, and review mentions to menu items only when supported by the review text. AI-created links carry provenance and uncertainty.
- Menu-to-inventory consumption needs a recipe mapping: ingredient inventory ID, quantity/unit per dish, yield and effective date. We do **not** currently have that mapping. Populate explicit editable mock recipes before calculating ingredient consumption; never infer precise recipes from menu names.
- Seat count does not tell us table turns, occupancy or staff capacity. Those remain explicit assumptions unless supplied measurements exist.
- HR's synthetic weekly item sales and Finance's separate historical ledger are not currently reconciled. Pick one canonical dated mock order/item source for future demand metrics, then derive views from it. Preserve ledger revenue as a separate recorded measure until reconciled; do not add both into one sales total.
- Supply expiration is currently one date per inventory item. Batch quantities and batch expiration dates require a future stock-lot model; do not pretend the single date covers multiple deliveries.

## 5. MongoDB: what to save

Continue using the existing **`restaurantos`** database. Keep new collections Tactical-owned until Rain agrees on any shared contract. A database shared by both modes does not grant either module permission to alter the other's records.

### Recommended initial collections

| Collection | What it saves | Why / lifecycle |
| --- | --- | --- |
| `tactical_datasets` (existing) | Current validated restaurant aggregate and revision | Keep as the canonical write model initially; do not normalize every array in the first refactor |
| `tactical_data_revisions` (new) | Immutable bounded source snapshots or patches with reconstructible base revisions | Reproduce past evidence after the current dataset changes; retain versions referenced by saved analyses/decisions |
| `tactical_ai_contexts` (new) | Versioned input manifest, dependency hashes, calculation outputs and the exact minimized context supplied | Deduplicate identical contexts and support explanation/replay; exclude credentials and unnecessary personal data |
| `tactical_ai_runs` (new) | Task, actor/scope, context ID, prompt/model/schema versions, status, attempt, lease, timings, usage if provided, safe failure category and artifact IDs | One durable execution history; supports queue, retry, deduplication and restart recovery |
| `tactical_ai_artifacts` (new) | Typed validated results, evidence links, parent run, generated/owner-edited revisions and lifecycle | Reusable results for all pages, rather than separate incompatible feature caches |
| `tactical_decisions` (new) | A concern's evidence, related artifacts, owner notes, proposal states and accepted action/version references | Connect Reviews → Floor Plan → HR/Finance → assistant without duplicating findings |
| `tactical_conversations` (new) | Bounded conversation metadata and messages with run/artifact/context references | Durable assistant history; split messages into a separate collection if size requires it |
| `tactical_events` (new) | Durable change events and processing receipts/outbox state | Reliably invalidate/recompute downstream results after a source write |

Add `tactical_source_snapshots` **later**, when moving social imports and finance sandbox snapshots out of local/transient storage. Store source kind, permission/provenance, fetch time and normalized source records separately from AI annotations. Large files/images belong in object storage with an authorized reference, checksum and retention policy, not inside prompts or oversized MongoDB documents.

### What an AI artifact should contain

Illustrative contract only; implement Zod schemas before API migration:

```ts
type AiArtifact = {
  id: string;
  restaurantId: string;
  kind: "review-triage" | "review-reply" | "seating-concern"
    | "layout-proposal" | "hr-assessment" | "hiring-draft"
    | "finance-analysis" | "advisor-answer" | "social-analysis";
  runId: string;
  contextId: string;
  concernId?: string;
  subject: { entityType: string; entityId: string };
  schemaVersion: number;
  content: unknown; // Replace with a discriminated, kind-specific Zod contract.
  evidenceRefs: EvidenceRef[];
  origin: "ai-generated" | "owner-edited";
  parentArtifactId?: string;
  freshness: "current" | "stale" | "unverifiable";
  lifecycle: "draft" | "accepted" | "dismissed" | "superseded";
  createdAt: string;
};
```

Owner edits create a new revision linked to the generated draft; preserve both. Accept/reject state is not the same thing as freshness. A historically accepted proposal can later be stale for new decisions while remaining a valid record of what the owner chose.

Save provider/model identity, prompt-template version, calculator version and validated output. Retain approved versioned prompt templates in code; store the context and template version needed to reconstruct an input. Do not store hidden model reasoning, raw credential-bearing errors, session cookies or API keys. Persist short user-facing rationale and cited evidence, not chain-of-thought.

### What stays out of MongoDB

Hover state, current selection, open panels, drag frames, temporary filters and undo history are UI state. Keep local draft recovery as a convenience, clearly distinguished from a saved server version. A working draft used for an AI request gets one bounded immutable context snapshot for that request; do not write every pointer movement.

Store neither “AI profit” nor an unsupported business success score. Reusable projections store assumptions and calculator version alongside their deterministic result. A status color can be persisted only as part of its dated, evidence-linked interpretation.

### Queries, indexes and retention

- Include restaurant and authorized workspace scope in every query. Never trust a client-supplied restaurant ID as authorization.
- Unique run key: scope + restaurant + task + normalized parameters + relevant context hash + model/prompt/output/calculator versions. Separate explicit reruns from reuse with a new attempt identifier.
- Index runs by restaurant/status/createdAt, artifacts by restaurant/kind/subject/freshness, decisions by restaurant/status, conversations by restaurant/updatedAt, and events by processing state/createdAt.
- Index dependencies so a changed review or layout can find affected contexts/artifacts; do not scan every historical run on every write.
- Enforce bounded payloads, pagination and revision-checked owner edits. Add usage/cost metadata only when the provider supplies trustworthy values; mark estimates separately.
- Proposed retention defaults: discard temporary contexts and safe failure diagnostics after 30 days unless referenced by saved history; retain accepted decisions, their evidence and owner-edited drafts until owner deletion. Confirm these defaults before implementation. TTL only unreferenced expiring records; never delete evidence still needed by a decision.
- Before real multi-user data, add authenticated user/workspace membership and object-level authorization. The current shared AI access code is a demo gate, not tenant isolation.

### Existing AI collections

Do not delete `tactical_review_analysis` or `tactical_hr_analysis` immediately. Initially adapt their current records into common artifact reads. Move new writes one workflow at a time, with a feature flag and a clear single writer. Migrate valid history idempotently using a legacy-source key.

Legacy caches may not contain a complete reconstructible input manifest. Preserve their provenance and mark them `unverifiable` when needed; do not manufacture an exact historical context. Keep old readers available for rollback until parity is verified. Old in-memory outputs cannot be recovered after restart.

## 6. One AI execution path, with typed tasks

Keep the existing Gemini adapter. Add a common orchestration service around it:

1. Authorize actor/restaurant and validate the task payload.
2. Resolve the saved version or explicitly supplied working draft.
3. Build the relevant context and immutable dependency manifest.
4. Reuse a current compatible artifact, or atomically claim a generation job.
5. Call the provider with the minimized projection and task-specific structured schema.
6. Validate evidence references, quote spans, role identity, proposed geometry and numeric references using code.
7. Persist the run and validated artifact before reporting durable success.
8. Link it to its concern/conversation and notify the relevant page views.

Generic infrastructure does not mean a generic untyped result. A reply, geometry proposal and HR assessment need different schemas and validators. The provider must not execute arbitrary database queries or mutate restaurant facts.

If persistence fails after generation, show `Something is wrong`; do not claim the result was saved. Keep a recoverable run/attempt identifier so retry can avoid duplicate writes where possible. The UI remains generic on failures; internal diagnostics use safe categories and correlation IDs.

Use a MongoDB-backed lease for cross-process deduplication, with expiry, attempt limits and bounded retry. Start with the app's server routes plus a small worker/process for queued work; a separate microservice, vector database or agent platform is unnecessary for this phase. A completed job stores its output atomically with completion metadata, or uses an idempotent repairable sequence.

## 7. Refresh only what changed

| Change | Recompute / invalidate | Do not do |
| --- | --- | --- |
| One new/edited review | Triage that review; mark linked concerns and relevant summaries stale | Reclassify unchanged reviews |
| Saved layout changes | Recalculate geometry; invalidate seating artifacts depending on that layout; mark linked projections stale | Rewrite review classifications or analyze every drag frame |
| Working draft changes | Mark the displayed proposal/result out of date using the draft hash | Change saved restaurant data automatically |
| Shift/demand/pay assumptions change | Recalculate staffing metrics; invalidate relevant HR/hiring/projection outputs | Infer individual performance from operational data |
| Menu price/cost changes | Recalculate selected-period unit economics; invalidate dependent financial interpretation | Recount review sentiment without a dependency change |
| Inventory changes | Refresh stock/expiration UI and deterministic summaries; mark explicit assistant answers using those records stale | Start a supply AI job |
| Owner edits a reply/job draft | Save a new editable revision; preserve original model output | Regenerate or overwrite owner text automatically |
| Model/prompt/schema version changes | New generations use a new compatibility key | Erase historical accepted decisions |

A dependency becomes stale when a referenced record changes or a relevant query's membership changes. For example, a new review can change a weekly review summary even though that review was absent from its previous dependency list. Store projection/scope dependencies as well as individual record references.

Source write and event creation must be reliable together. Use a transaction when supported by the deployment, or a single-document outbox plus an idempotent dispatcher/reconciler. Do not rely on an unawaited server callback surviving a request. AI failure never rolls back a valid review upload.

Automatic work is limited to requested incremental review triage and already-enabled HR assessment refresh. Broader seating, hiring and financial generation stays user-triggered initially. Coalesce bursts, bound concurrency, expose pending state and reuse results rather than sending every page mount to Gemini. Changes to derived AI artifacts must not create an endless recomputation loop; define an acyclic dependency graph and only follow declared edges.

## 8. Make the frontend feel connected

Introduce a Tactical workspace data provider keyed by restaurant. It owns the current saved dataset revision, selected saved layout, working draft hash, active concern, and shared artifact query state. Components remain responsible for local editing interactions.

- After a successful write, reconcile the returned revision and invalidate affected queries. Preserve unrelated unsaved forms.
- Deep-link to concern, artifact, review and layout IDs; browser back/forward should preserve meaningful context.
- Floor Plan shows the same saved seating concern that Reviews links to, not a freshly generated disconnected summary.
- HR and Finance can open a proposal's context explicitly. Show “Saved plan” versus “Unsaved draft”; do not silently mix their metrics.
- The central assistant can reference saved analyses and owner decisions. Conversation history is bounded; any compressed summary cites source message/artifact IDs and is labeled derived, not permanent truth.
- A single evidence component opens the original record/version from any page. A single AI result component supplies purple provenance, generated time, freshness, limitations and next action.
- Review replies and hiring drafts retain owner edits across navigation/reload once saved. Show a small save state, not another large feature panel.
- Supply has no AI interface. It simply reflects the same current inventory records used elsewhere.

Cache or browser storage is never an independent canonical database. A 409 conflict should preserve the local draft and offer reload/rebase; do not silently overwrite a newer record.

## 9. Proposed code organization

All paths below are proposed additions or migrations, not existing guarantees:

```text
src/features/tactical/
  domain/
    context.ts                # Context manifest, source and metric references
    ai-artifact.ts            # Typed outputs, provenance and freshness
    decision.ts               # Concerns, proposals and owner action links
    events.ts                 # Typed data-change events/dependencies
    ...existing calculators and feature schemas
  backend/
    context/service.ts        # Server context assembly
    context/projections/      # Reviews, seating, HR, finance, assistant
    ai/orchestrator.ts        # Common validated execution path
    ai/tasks/                 # Task prompts, schemas and validators
    repositories/             # Mongo implementations, not UI imports
    jobs/                     # Leases, outbox, retry and recovery
    ...existing adapters
  frontend/
    workspace-data.tsx        # Shared revision/query state and invalidation
    components/evidence/      # Cross-page source inspection
    components/ai/            # Shared provenance/result/freshness UI
    ...existing page components
src/app/api/tactical/
  ...thin routes calling the above services
```

Keep current endpoints as compatibility adapters during migration. Proposed common APIs are `POST /ai/runs`, `GET /ai/runs/:id`, artifact/draft reads and revision-checked edits, concern reads/decisions and conversation messages. The client sends intent and IDs, not an arbitrary canonical context assembled from stale browser data. Unsaved layout payloads are the explicit validated exception.

## 10. Delivery order and completion checks

| Phase | Deliverable | Complete when |
| --- | --- | --- |
| **CEN-01 · Foundations** | Stable evidence references, context manifest, shared reporting-period rules and a canonical dated mock demand source | Two pages requesting the same scope receive identical code-calculated facts; incompatible ledger/sample periods are explicit; fixtures validate |
| **CEN-02 · Durable AI results** | Common run/artifact/context repositories; adapt review + HR reads and migrate writes behind flags | Reload/server restart reuses results; duplicate concurrent requests generate once; stale evidence is identifiable; migration reruns safely |
| **CEN-03 · First connected journey** | High-priority review → seating concern → preview → saved layout → recorded decision → assistant explanation | All steps link the same IDs and evidence; no re-entry of context; saved and draft geometry remain distinct; failure leaves source data intact |
| **CEN-04 · Drafts and assistant continuity** | Persist edited replies/jobs and bounded assistant history; shared frontend invalidation | Edits survive navigation/reload, never become model facts, and conflict handling preserves local text |
| **CEN-05 · HR/Finance connections** | Shared dated metrics, selected-proposal context, explicit deterministic projections | HR and Finance agree on the same period's inputs; projections cite assumptions; no added-seat demand or causal impact is invented |
| **CEN-06 · Reliable refresh** | Outbox/worker, projection dependencies, safe retries, usage ceilings and stale indicators | Review upload succeeds during AI outage; retries recover after restart; an unrelated inventory edit causes zero model calls |
| **CEN-07 · Optional evidence adapters** | Persist selected social and Nessie snapshots; later photo context | Source permissions/provenance remain visible; sandbox balances never merge with the operating ledger; no identity links are guessed |

Start with CEN-01 through CEN-03. A single demonstrable connected journey is more valuable than moving every file or adding all proposed collections at once. Run existing Tactical tests throughout; add cross-page, restart, concurrent-write, stale-input, access-isolation and exact metric tests as their behavior is introduced.

## 11. Migration, rollout and boundaries

1. Export a private backup, record current dataset/analysis revisions, and inventory browser-only data worth retaining.
2. Add compatible schemas/indexes and repositories; do not change current page behavior yet.
3. Backfill only recoverable legacy results with an idempotent source identifier. Compare source hashes, counts, subject IDs and citation resolution.
4. Move one task's reads/writes behind a feature flag. Maintain a single authoritative writer for that task, with an explicit rollback path; avoid permanent dual writes.
5. Run the review → seating → decision journey against demo data and then the existing Mongo mock restaurant.
6. Retire legacy caches/endpoints only after parity and recovery tests pass. Keep referenced historical evidence for accepted decisions.

Rain's Expansion code is outside this migration. Agree first on restaurant identity, workspace ownership, evidence envelope and any feasibility handoff. Share an interface or an explicit exported snapshot, not direct imports of Tactical collections. Do not force Expansion's existing persistence into this design as part of Tactical cleanup.

## 12. Decisions to review before the larger implementation

Recommended defaults: keep the current restaurant aggregate for now; unify result/context storage first; use one central assistant plus contextual actions; preserve explicit Apply/Save; keep inventory AI-free; defer recipes, live POS, vector search and cross-domain persistence changes.

Before implementation reaches real multi-user or production data, agree on authentication/ownership, history retention/deletion, and the authoritative order/reporting-period contract. No credentials or additional services are needed to review this plan. The next concrete implementation should be **CEN-01**, followed by durable artifacts and the review-to-floor-plan journey.
