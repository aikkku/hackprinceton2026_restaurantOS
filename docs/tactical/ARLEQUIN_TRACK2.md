# Arlequin Track 2 — Content and connectivity pipeline

Implemented November 14, 2026 against the challenge text supplied by Asilbek in this chat. The requested track is **Social Media Analysis: Combining Content & Connectivity Patterns**. It asks for a pipeline that combines message semantics with actor connectivity; campaign detection, narrative spread and community discovery are example applications, not a mandatory list of detectors.

## What to demonstrate

Open **Tactical → Reviews → Content & connectivity**.

1. Start with the clearly labeled fictional restaurant conversation. Its 40 messages from 17 actors (Nov 1–15, 2026) cover weekend waits, soggy takeaway packaging, app prices and praised dishes, with explicit replies and reposts. Structure separates four customer circles; see the [operations plan](TRACK2_OPERATIONS_PLAN.md). Structural analysis works without API keys.
2. Unlock the existing AI workspace control. Under **Choose data, import or reopen**, use story ID `42302171` and **Load public discussion**. This reads an observed public discussion about tipping through the official Hacker News API. It does not scrape pages, fetch user profiles or load the linked news article.
3. Inspect **Source and sampling evidence**, actor communities and bridge interactions. Open a bridge's source message and its original link. Structural calculations do not depend on Gemini.
4. Choose **Analyze message content with AI**. Each message gets theme labels, a message-tone interpretation and an exact source excerpt. AI selects a span index; deterministic code copies that span from the source. There is no generated-quote fallback.
5. Read **Fix first**. It ranks each AI theme three ways: text only (negative or mixed mentions), connections only (customer groups reached), and combined (negative mentions × groups reached). A badge marks issues whose combined rank differs from the text-only rank. The formulas are in `domain/social-operations.ts`; see the [operations plan](TRACK2_OPERATIONS_PLAN.md). Under **Where to fix it**, each negative issue links to the record it concerns: **Open in Supply** highlights Vented takeaway boxes, and **Open in HR** opens Saturday's schedule. AI picks only the area; code picks the record and shows stored values. Public discussions get rankings but no links. Each row also has a daily timeline (mentions, customer groups reached, restaurant events). Packaging's reads "After Nov 12 · vented takeaway boxes below reorder point…: mentions 1 → 8, customer groups 1 → 4". That reports timing, not cause.
6. Inspect **Where AI themes meet observed connections**. Each theme has message/actor/group counts and explicit same-topic conversation links. **Trace this theme** filters its chronological message timeline. Community and text filters help compare what different structural groups are discussing.
7. Download the analysis report: input dataset, source/provenance, message links, model/time/hash, annotations, calculated groups, bridge edges, joined theme counts and chronology are preserved for inspection.

The fictional sample and public source are separate choices. A failed source load preserves the current dataset and reports the failure. An AI failure shows only **Something is wrong**, with no fabricated results or fixture replacement.

## Requirement-to-implementation map

| Supplied challenge requirement | Implementation | Evidence |
|---|---|---|
| Build your own pipeline | Import/public adapter → validation → actor graph → structural groups → AI message themes → deterministic join → source-linked views/export | Domain, backend and frontend modules listed below |
| Semantic content of messages | Gemini topic/tone annotations, full message coverage, exact source spans, limitations | Purple annotations, themes and exported analysis |
| Connectivity between actors | Explicit reply/repost parent records create directed actor links; absent references are counted, never inferred | Actor graph, bridge records, message IDs and original URLs |
| Look at content and connections together | Topic-by-community counts, same-topic reply/repost paths, cross-group topic links and chronological trace | Joined findings, community table and timeline |
| Freedom of public social/messaging dataset | Official public HN adapter plus platform-independent normalized JSON import | Observed source path tested live; synthetic sample separately labeled |
| Example: identify groups behind a topic | Weighted structural community partition, then AI topic counts per group | Inspect group messages and theme paths |
| Example: map a narrative's progression | Ordered messages and only explicitly supplied same-topic reply/repost paths | No inferred missing hops or claim of causal dissemination |

No Arlequin-specific API/model requirement appears in the supplied text. The implementation uses Gemini and our own graph calculations, not an invented Arlequin service. Prize eligibility and judging remain the organizer's decision.

## Data contract

`domain/social.ts` defines a strict, versioned `SocialDataset`:

- Dataset: stable ID/title, `synthetic` or `observed` provenance.
- Source: name, original URL, retrieval timestamp, collection method and limitations.
- Actors: stable pseudonymous ID and display label. No demographics or private contact fields.
- Messages: stable ID, actor ID, plain text, timestamp, source URL, nullable `replyTo` and `repostOf` IDs.

Limits: 40 actors, 40 messages, 3,000 characters/message, 512 KB import/API body. Duplicate IDs, unknown authors, self/cyclic message references, simultaneous reply+repost fields, later-message parents and unsafe URLs are rejected. Parents outside a bounded sample are allowed but reported as unresolved and omitted from connectivity. Replies by an actor to their own message remain in the text sample but do not become actor self-links.

Importing observed JSON requires a permission attestation. Import and save/reopen stay local to the browser. AI receives data only on explicit generation. Dataset JSON exports can be reimported. Analysis reports contain both input and results for inspection; they are not a second import format. Browser saves preserve the dataset, while report downloads preserve AI outputs. No MongoDB write or shared-contract change is introduced in this increment.

## Public-data adapter

The [official Hacker News API](https://github.com/HackerNews/API) supplies story/comment IDs, authors, timestamps, parent IDs and child IDs. The adapter uses a fixed HTTPS Firebase host, numeric IDs, no redirects, a 25-second overall deadline and a 200 KB cap per response.

It reads the first six root branches in provider order and takes at most five valid comments per branch, depth-first to depth four, with at most 48 item requests. Deleted/dead/unavailable records and their descendant branches are omitted; mismatched parent IDs are rejected from the sample. Source methods/limits travel with the data. Text is stripped to plain text and capped. The root contains the submitted title/text, not the external article.

Names are replaced with thread-scoped hashed IDs and labels such as Participant 1. This is pseudonymization, not anonymization: original source links can reveal the public author. The app does not infer identities or fetch profiles. No real public message bodies are committed as fixtures. The sample is a bounded conversation, **not restaurant-customer data, a random audience sample, or representative market research**. Its order and omissions can change the detected groups.

## Structural analysis

Each included reply/repost contributes a directed actor interaction, with both message IDs retained. For community grouping only, direction is collapsed and repeated interactions become weights. Self-links are excluded. Starting with one group per actor, the algorithm greedily merges the pair with the greatest positive modularity gain at resolution 1; sorted IDs resolve ties. It stops when no positive merge remains. Isolated actors remain singleton groups, and modularity is unavailable when there are no links.

The group quality formula is `Q = Σ(internalWeight / totalWeight − (groupDegree / (2 × totalWeight))²)`. Merge gain is `betweenWeight / totalWeight − degreeA × degreeB / (2 × totalWeight²)`. This follows the documented [modularity definition](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.community.quality.modularity.html) and [greedy community method](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.community.modularity_max.greedy_modularity_communities.html). No NetworkX runtime or new dependency is required.

These are algorithmic structural groups, not verified human communities. Greedy optimization is heuristic and subject to resolution/sample limits. Cross-group interaction counts and unique neighbors are derived from actual included edges; they do not measure influence or intent. Frequent words are simple English token frequencies by message, explicitly distinct from AI semantic labels. SVG placement is illustrative.

## Semantic interpretation and join

The AI schema permits at most six themes and three theme labels per message, plus a tone label and a source-excerpt index. It must cover every message exactly once. Source excerpts are deterministic contiguous spans, bounded to 16 candidates/message; longer text uses evenly distributed candidates. Unknown topic/message IDs, missing/duplicate message annotations and out-of-range excerpt indices fail validation. Code materializes the selected source text and validates exact substring membership. A source span is authentic; whether it supports an assigned theme remains an AI interpretation requiring review.

All input is treated as untrusted text. The prompt forbids following message instructions or inferring identities, coordinated behavior, deception, demographics or business outcomes. The API uses the existing signed workspace cookie, same-origin checks, bounded bodies, one in-flight social AI request per process and the existing AI generation quota. Public source reads have their own six-per-minute process budget. Production user/tenant access and distributed limits are still separate work.

The join is pure TypeScript:

- Topic message count and unique actors come from validated AI labels.
- Topic-by-group counts join each message author to the calculated partition.
- A same-topic conversation path exists only when both messages share a topic and an explicit reply/repost record connects them.
- Cross-group topic paths require those endpoints to belong to different calculated groups.
- The timeline orders source timestamps and preserves source IDs.

Purple identifies AI labels and derived views that depend on them. Structural metrics remain visually separate. Timeline filters do not recompute the full-sample partition. Replacing/importing/reopening the dataset cancels pending work and clears old AI results. Invalid imports preserve the current dataset.

## Files and ownership

| File | Responsibility |
|---|---|
| `src/features/tactical/domain/social.ts` | Dataset/AI schemas, source spans, graph partition, bridge and semantic joins |
| `src/features/tactical/backend/adapters/hacker-news.ts` | Bounded public API collection, text normalization and pseudonymous IDs |
| `src/features/tactical/backend/social-service.ts` | Protected source/AI handlers, quotas, materialization and provenance |
| `src/app/api/tactical/integrations/social/source/route.ts` | Public-source adapter entry point |
| `src/app/api/tactical/integrations/social/analyze/route.ts` | Semantic analysis entry point |
| `src/features/tactical/frontend/components/social-pipeline.tsx` | Import, actor graph, joined themes, source timeline and export |
| `src/features/tactical/frontend/components/social-pipeline.css` | Scoped responsive styling and AI provenance colors |
| `src/features/tactical/frontend/data/demo-social.json` | Single editable fictional conversation dataset |
| `src/features/tactical/social.test.ts` | Domain, adapter, provenance, access/error and empty-case tests |
| `src/features/tactical/frontend/e2e/social.spec.ts` | Joined findings, evidence, imports, save/reopen, failures and narrow layout |

The existing Relationship network tab remains compatible with its earlier graph JSON format. Reviews now offers a separate Content & connectivity tab for message-level analysis. Nessie, Expansion and shared contracts are unchanged by this Track 2 increment.

## Verification and limits

Live source check on [the selected public discussion](https://news.ycombinator.com/item?id=42302171): 23 included messages, 21 actors, 22 explicit links, five calculated groups, four cross-group interactions, zero unresolved references. These counts describe the fetched sample and can change if the source changes.

Live Gemini check: HTTP 200, all 23 messages annotated, six semantic themes validated, exact source spans retained. One theme linked ten messages across five groups with two explicit same-topic cross-group interactions; this is a model-dependent sample finding, not a claim about Juniper Table. Earlier generated-quote mismatches failed closed; indexed source excerpts resolved that reliability issue.

Live authenticated browser check also returned HTTP 200 for the public import and semantic analysis, rendered the joined findings, traced a theme and exported the complete report. Theme labels/counts can vary between generations. A rejected provider/model response still shows the generic error and requires an explicit retry; successful past runs do not guarantee every future generation validates. A narrow-screen overflow with longer generated labels was corrected and verified by replaying that actual saved response at 390 pixels, without another model request.

Validation: 169 unit tests, lint, TypeScript and production build pass. The Tactical browser suite covers 36 Chrome/Firefox checks, including semantic evidence, content/connectivity joins, import permission, source failure preservation, local save/reopen, report download, long-label mobile layout, reduced motion and hydration. Build retains the two pre-existing Expansion filesystem-tracing warnings. No Expansion code or dependencies were changed. Secret scan passed; API credentials and real public message bodies remain outside version control.

Not implemented or claimed: coordination/bot detection, intent/deception assessment, causal diffusion, population reach, sentiment about a person's character, scraping private platforms, an Arlequin API integration, multi-user cloud sync, or a predicted financial benefit. To prepare the submission, record the observed-data journey and include the sample/AI limitations with the exported report. Use another public or permissioned dataset through the same contract if it better matches the team's story.
