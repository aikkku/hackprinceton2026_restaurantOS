# Deep Agents in RestaurantOS — how it was implemented

This explains the Phase 3 Deep Agents integration: what each part does and
how it was built. Specific, no fluff. Deep Agents = the real LangChain
`deepagents` Python framework; "agent" here means the planner + five
specialists that run inside it.

## The idea in one paragraph

The owner clicks **Agent-assisted scouting** in `/expansion`. The Next.js app
creates a run folder, then starts an **isolated Python worker** that builds a
real `deepagents` planner. The planner delegates five jobs — readiness,
market, site scout, space inspector, finance — to five specialists through
the framework's own `task` tool. Specialists do their work by calling the
**same TypeScript tools from Phase 2** (search, matching, finance) over an
authenticated HTTP bridge — the model never does the math and can only write
explanatory text. Every result is validated and saved as versioned files in
the run folder, every step is appended to an event log, and the browser shows
the live stages over SSE. If no model is available, the run fails honestly
and the deterministic Phase 2 search stays available.

```
Browser (agent panel)
   │  POST /api/expansion/agent-runs        (create run + spawn worker)
   ▼
Next.js run service  ──spawns──▶  Python worker (detached process)
   ▲                                    │ deepagents planner
   │  tool calls (HTTP + bearer token)  ▼
Tool bridge (TS) ◀──────────────── 5 specialists
   │  searchOfferedSpaces / assessCandidates /
   │  monthlyOccupancy / requiredSales / readiness / market
   ▼
run folder: request.json profile.json run.json events.jsonl
            market.json candidates.json inspection.json finance.json summary.json
   ▲
   │  SSE (replayable) + artifact routes
Browser (live stage rows → grounded results)
```

## The parts, one by one

### 1. Cross-language contracts (so TS and Python always agree)

Both sides define the same shapes and reject anything else (unknown fields,
unknown versions, invalid numbers, unknown candidate IDs).

- TypeScript (Zod): `src/features/expansion/domain/agent.ts` — the run
  record, the six artifact schemas, the event schema, and the tool DTOs.
  Versions: `expansion-agent-run-v1`, `expansion-agent-artifact-v1`,
  `expansion-agent-event-v1`.
- Python (Pydantic): `agent/worker/restaurantos_worker/models.py` — the
  mirror of the same shapes, plus a cross-artifact check in `validation.py`
  (a summary may only reference candidate IDs that exist in the search
  artifact).
- Proof they match: committed JSON fixtures in `agent/fixtures/contracts/`
  (valid) and `agent/fixtures/invalid/` (must be rejected). Both test suites
  parse the same files.

### 2. The run service (Next.js side)

`src/features/expansion/backend/agent.ts`:

- `createAgentRun(...)` — validates the profile (same rules as Phase 2),
  makes the run idempotent (same requirements hash ⇒ same run), writes
  `request.json` + `profile.json`, generates a random per-run token, writes
  its hash, and spawns the worker. A failed spawn marks the run failed
  honestly.
- `getAgentRun(...)` — reads the worker-owned `run.json`; a running run that
  stops updating for 5 minutes recovers as `failed (interrupted)`.
- `cancelAgentRun(...)` — writes a `run.cancel` flag (the worker checks it at
  every step); terminal runs can never change status (409).
- `verifyToolToken(...)` / `invokeAgentTool(...)` — the bridge itself
  (part 3).
- `agentCapabilities(...)` — is the worker installed? is a model key present?
  (used by the UI).

`src/features/expansion/backend/worker.ts` — finds the venv Python
(`EXPANSION_AGENT_PYTHON` override), spawns
`python -m restaurantos_worker.cli run --run-dir <folder>` detached with no
pipes (HTTP only), and maps execution mode → worker mode.

### 3. The tool bridge (the only door from the model to the app)

`POST /api/expansion/agent-tools` with a `Authorization: Bearer <run token>`.
Only these six tools exist; everything else is `unknown_tool`:

| Tool | What it does (in TypeScript) |
|---|---|
| `profile.readiness_report` | Completeness from the profile: known/unknown requirements + follow-up questions. Never a score; Tactical report = `null` unless one is agreed later. |
| `market.context` | Dataset id/date/counts + source capabilities (CoStar snapshot, Matterport, Vexcel, geography, ACS, competition) with explicit unavailable reasons. |
| `scout.search_city` | Phase 2 `searchOfferedSpaces` + `assessCandidates` for the run's city; writes `candidates.json`; returns counts + candidate IDs. |
| `inspector.evidence` | For up to 20 candidate IDs from this run: suite facts, assessments, gaps, and deterministic verification tasks; writes `inspection.json`. |
| `finance.monthly_occupancy` | Phase 2 occupancy normalization for one candidate; inclusion derived by TS; invented "extras" are rejected. |
| `finance.required_sales` | Only accepts the numbers derived from the run's profile snapshot (computed by TS from the financial baseline); anything else returns the honest unavailable result. |

Binding rules: tool calls are bound to the run's session, city, profile
revision and candidate IDs. Paths, URLs, foreign IDs and model-proposed
finance numbers are rejected at this boundary.

### 4. The Python worker

`src/features/expansion/agent/worker/restaurantos_worker/`:

| File | What it does |
|---|---|
| `versions.py` | The version constants (same strings as TS). |
| `models.py` | Pydantic mirrors of all contracts (part 1). |
| `eventlog.py` | Appends validated events to `events.jsonl` with strictly increasing `seq`; readers can resume from any seq without duplicates. |
| `runstate.py` | Run folder access, the cancel flag, heartbeat file, and atomic writes (temp + rename with bounded retries for Windows reader locks). |
| `bridge.py` | HTTP client for the tool bridge: bearer auth, per-call timeouts, retries only for transient errors (429/5xx/network) within a budget, cancellation checked between attempts. |
| `planner.py` | The actual Deep Agents: `create_deep_agent(...)` with five `SubAgent`s (each with its own tools + `finalize_*` tool), the prompts, the model factory (`live`/`scripted`), and the specialist tool functions. |
| `orchestrator.py` | The run loop: start → run the graph with a deadline → write the terminal state exactly once (completed / completed_with_gaps / cancelled / failed, redacted). Assembles `summary.json` from the validated stage results + the planner's text, then re-runs the grounding check. |
| `cli.py` | Entry point; crash-safe (any unexpected crash still writes an honest failed state). |
| `testing.py` | Test doubles: a fake HTTP bridge built from the committed fixtures + run-dir helpers. |

The five specialists (framework `SubAgent` names):

1. **readiness** — calls `profile_readiness`, then `finalize_readiness`
   (missing data + follow-ups; no score).
2. **market** — calls `market_context`, then `finalize_market` (sourced
   context or explicit unavailable reasons).
3. **site_scout** — calls `search_city`, then `finalize_scout` (candidate
   IDs validated against `candidates.json`).
4. **space_inspector** — calls `list_candidates` (reads the saved IDs), then
   `inspect_candidates`, then `finalize_inspection` (facts, gaps,
   verification tasks).
5. **finance** — calls `evaluate_finance` (worker-side; it calls the two
   finance tools for the top candidates and the profile snapshot, then
   writes `finance.json`), then `finalize_finance` (text only — numbers live
   in the artifact).

The planner composes the result by calling `finalize_run` once; its text is
the summary, while candidate IDs and numbers always come from tool outputs.
Dependencies are enforced: inspection and finance fail clearly if the site
scout has not produced candidates yet.

### 5. Events and SSE (live progress, replayable)

- Worker writes every step to `events.jsonl`: `run.started`, `stage.started`,
  `tool.completed`, `stage.completed`, `unavailable`, `stage.incomplete`,
  `run.completed`, `run.cancelled`, `run.failed` — each with `seq`, stage and
  a small payload (no private data).
- `GET /api/expansion/agent-runs/:id/events` replays everything after the
  client's last seen seq (`Last-Event-ID` header or `?after=`), then tails the
  file; sends `: ping` heartbeats and a `done` frame when the run is terminal.
- Browser client: `frontend/data/agent-client.ts` — `openAgentEventStream`
  reconnects automatically and drops any duplicate seq, so a dropped
  connection never duplicates results.

### 6. The UI

`src/features/expansion/frontend/components/agent-run.tsx` (wired into
`expansion-workspace.tsx` above the untouched deterministic search):

- idle: start button + execution mode (live / scripted test model);
- running: the five stage rows update in real time from SSE, with a cancel
  button;
- done: the mode badge, the grounded summary (digests, missing evidence,
  follow-ups, assumptions), deterministic finance results, grounded candidate
  cards, and the same requirement inspector as Phase 2;
- failed: honest error + **Continue with deterministic search** when the
  model was unavailable (the Phase 2 path stays separate and labeled).

### 7. Test and execution modes

| Mode | How | Used for |
|---|---|---|
| `scripted` | The real deepagents graph, but each agent's model is a deterministic `GenericFakeChatModel` reading the committed script `agent/worker/fixtures/cedar-kitchen-run.script.json`. Labeled "scripted test model" in the UI. | Worker tests, the Node↔Python integration test, the Playwright journey. |
| `live` | A real provider: `anthropic` / `openai` / `google` (Gemini), auto-detected from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` / `GEMINI_API_KEY`; `EXPANSION_AGENT_PROVIDER` and `EXPANSION_AGENT_MODEL_ID` override; temperature 0. | The bounded live proof. |
| `offline` | The worker fails immediately with `model_unavailable` (also forced for e2e "live" requests via `EXPANSION_AGENT_E2E_FORCE_OFFLINE=1`). | The outage journey. |

### 8. The six run artifacts

| File | Written by | Contents |
|---|---|---|
| `profile.json` | Next.js at creation | Validated intake + normalized requirements + follow-ups + finance inputs derived from the baseline. |
| `market.json` | Tool bridge (`market.context`) | Sourced dataset info + source capabilities + unavailable reasons. |
| `candidates.json` | Tool bridge (`scout.search_city`) | The full Phase 2 search + assessment report (counts, assessed candidates, excluded). |
| `inspection.json` | Tool bridge (`inspector.evidence`) | Per inspected candidate: facts, assessments, gaps, verification tasks. |
| `finance.json` | Worker (`evaluate_finance`) | Occupancy results per top candidate + required-sales result (or missing inputs). |
| `summary.json` | Worker (`finalize_run` + orchestrator) | Stage reports, grounded candidate IDs, summary text, missing evidence, follow-ups, assumptions. |

Every artifact is schema-validated before it is written or read; the summary
must ground in the search artifact (no invented IDs).

## How each part was verified

- **Framework dispatch is real**: the worker tests (`agent/worker/test_*.py`,
  46 tests) run the genuine `deepagents` graph with scripted doubles and
  assert all five delegations, validated finalize outputs, artifact
  persistence and the event sequence.
- **Cross-language contracts**: the committed fixtures round-trip through
  Zod (`agent.test.ts`) and Pydantic (`test_contracts.py`); invalid fixtures
  are rejected by both.
- **Real TS↔Python loop**: `agent-integration.test.ts` spawns the actual
  worker against a real local bridge over the seeded synthetic dataset and
  asserts the terminal run, events and artifacts.
- **Browser**: `frontend/e2e/agent-run.spec.ts` — start → live stage events →
  grounded results → inspection → cancel → model outage → deterministic
  fallback (Playwright runs with `EXPANSION_AGENT_DEFAULT_MODE=scripted`).
- **Safety**: injection, malformed output, refusal, invented IDs, unknown
  subagents, wrong tokens, timeout/retry budgets, cancel mid-tool, duplicate
  submission, restart after failure (`test_safety.py`,
  `test_cancel_timeout.py`, `test_bridge.py`).
- **Live proof** (the required gate): `node src/features/expansion/agent/live-proof.ts`
  with labeled synthetic data. Passed 2026-11-15T03:04Z on
  deepagents 0.7.38 / langgraph 1.2.22 / langchain-google-genai 4.5.0,
  gemini-2.5-flash: all five roles ran (4 completed, finance honestly
  unavailable — the fictional baseline is missing), 7 bridge tool calls,
  terminal `completed_with_gaps`, validated artifacts. Recorded in
  `docs/expansion/DECISIONS.md` (H-004a).

## Commands

```powershell
# Node gates
npm run lint
npm run typecheck
npm test
npm run build
PLAYWRIGHT_CHANNEL=chrome npm run test:e2e

# Python worker tests
$env:PYTHONPATH = "$PWD\src\features\expansion\agent\worker"
src\features\expansion\agent\.venv\Scripts\python.exe -m unittest discover -s src\features\expansion\agent\worker -p "test_*.py"

# Bounded live proof (with a provider key present, e.g. GEMINI_API_KEY in .env.local)
node src/features/expansion/agent/live-proof.ts
```

Worker setup and the full environment-name table:
`src/features/expansion/agent/worker/README.md`.

## How this compares with the HackPrinceton workshop repo

The workshop material is
[langchain-samples/hack-princeton-intro-to-deep-agents](https://github.com/langchain-samples/hack-princeton-intro-to-deep-agents).
We did **not** copy from it, but it teaches the exact framework we run, so a
side-by-side is useful.

**Same API, same versions.** The workshop pins `deepagents>=0.7`,
`langchain>=1.3.14`, `langgraph>=1.2.14`, `langchain-core>=1.8.0`; our worker
locks `deepagents==0.7.38`, `langchain==1.5.0`, `langgraph==1.2.22`,
`langchain-core==1.8.0` — all compatible. We both use
`create_deep_agent(model=…, tools=…, subagents=[…], system_prompt=…)`,
subagents described by `name` / `description` / `system_prompt` / `tools`, and
delegation through the framework's `task(subagent_type, description)` tool.

**Where we deliberately differ:**

| Topic | Workshop (agent.py / notebooks) | RestaurantOS worker |
|---|---|---|
| Purpose | Research agent demo; filesystem, planning, HITL, skills, backends | Production scouting planner with 5 domain specialists |
| Model | `init_chat_model`, default `anthropic:claude-haiku-5-5`, one key env | Direct provider classes, auto-detection (Anthropic/OpenAI/Google, incl. `GEMINI_API_KEY`), temperature 0, `EXPANSION_AGENT_PROVIDER`/`MODEL_ID` overrides |
| Tools | Filesystem tools + `web_research` (arbitrary web) | Only 6 allowlisted bridge tools, bound to one run — no filesystem/web/shell access (safety-first) |
| Subagents | One `research-agent` | Five specialists, each with a validated `finalize_*` tool so numbers/IDs always come from tool outputs |
| Planning | `TodoListMiddleware` (`write_todos`) | Planner system prompt with a one-at-a-time delegation rule (the framework's task tool is auto-provided with subagents) |
| Human control | `interrupt_on={"write_file": True, …}` (HITL approvals) | No file-write tools exist, so HITL is moot; control = run cancellation + terminal immutability |
| Serving | `langgraph dev` server + LangGraph SDK (threads, streaming) | Detached per-run CLI worker + JSONL events + our own replayable SSE (works inside Next.js) |
| State/backends | LangGraph checkpointer/backends | Plain run folders with validated artifacts (D-025); durable mirroring is Phase 5's job |
| Testing | Not covered | Scripted deterministic model double inside the real graph (46 worker tests + Node↔Python integration + Playwright) |

**Bottom line:** we used the framework exactly the way the workshop teaches
(planner + subagents + `task` tool), then replaced the demo-friendly parts
(web research, filesystem, HITL, LangGraph server) with the parts RestaurantOS
actually needs (bounded authenticated tools, validated artifacts, durable
runs, SSE into Next.js, honest model-outage fallback).


### Candidate market context returned to the agent (2026-11-15)

`inspector.evidence` now returns an optional, independently versioned
`marketContext` (`expansion-inspection-market-context-v1`) on each inspected
candidate and preserves it in `inspection.json`. The TypeScript and Python
contracts accept historical entries without this extension (or with null);
existing artifact envelope versions and deterministic assessments are unchanged.
Deploy the server and Python worker together; an older worker cannot read this
new field.

The bridge projects only non-synthetic ACS and OSM observations from the same
candidate's collected snapshot: evidence IDs, provider record IDs, source and
retrieval dates, origin, geographic scope, details, limitations and reference
URLs. Images, raw source responses and property AI estimates are excluded from
this public market context. Inspector/planner instructions require explaining
this evidence and its gaps in the final tradeoff summary. No numeric ranking or
financial input is inferred from it.

ACS is pinned 2019–2023 containing-tract population/median household income with
margins of error, not population within a restaurant's catchment radius. OSM is a
bounded count of mapped restaurant objects within 500 m, not verified unique
competitors or same-cuisine matching. Public calls still require
`EXPANSION_SOURCE_NETWORK=1` and a non-demo candidate. The existing collection
limit of three candidates and 20-second overall budget remain; skipped, disabled,
failed and timed-out context is returned as explicit gaps. New searches receive
this extension; historical completed runs are not rewritten. Map overlays are a
separate feature.

Validation uses labeled test responses and the shared cross-language inspection
fixture, including success, disabled sources and source failure. It does not
establish live ACS/OSM availability or a live model's analysis quality.

The location detail page now shows this evidence in an always-visible **Around
this location** section: containing-tract population and household income, nearby
restaurant objects within 500 m, source dates/retrieval dates, explicit test-data
labels, source links and limitations. A dedicated refresh action reuses the
existing investigation source endpoint. Saved plans display their frozen evidence
and disable refresh. When a full source snapshot has never been checked, the
page can display the same candidate's persisted inspection market context; a
newer source check takes precedence. No extra demographic or competitive score
is calculated by the page.
