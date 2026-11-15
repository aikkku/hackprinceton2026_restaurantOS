# Deep Agents worker (Phase 3)

The isolated Python worker for RestaurantOS Expansion. It runs the genuine
`deepagents` planner (LangChain) with five specialists (readiness, market,
site_scout, space_inspector, finance) and calls the deterministic TypeScript
tool bridge over HTTP. Matching and financial arithmetic stay in TypeScript.

## Layout

- `restaurantos_worker/` — the worker package (models, bridge, event log,
  run state, planner/specialists, orchestrator, CLI).
- `fixtures/cedar-kitchen-run.script.json` — the deterministic scripted
  model double used by tests/e2e (labeled synthetic; real framework dispatch).
- `test_*.py` — `unittest`-discoverable worker/contract suites.
- `requirements.txt` (direct deps) and `requirements.lock` (frozen pins).

## One-time setup (Windows)

```powershell
python -m venv .venv            # Python >= 3.11 (developed on 3.14.3)
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

If `pip` fails on Python 3.14 (observed pip 25.3 index-parsing hang), use the
`uv` binary instead:

```powershell
.\.tools\uv.exe pip install --python .venv\Scripts\python.exe -r requirements.txt
```

## Run the worker test suite

```powershell
$env:PYTHONPATH = "$PWD\src\features\expansion\agent\worker"
src\features\expansion\agent\.venv\Scripts\python.exe -m unittest discover -s src\features\expansion\agent\worker -p "test_*.py"
```

## Worker execution model

The Next.js agent service (`src/features/expansion/backend/agent.ts`) spawns
one detached worker per run:

```
<venv-python> -m restaurantos_worker.cli run --run-dir <runsDir>/<session>/agent-<runId>
```

Environment names (values are never logged):

| Name | Meaning |
|---|---|
| `EXPANSION_AGENT_RUN_TOKEN` | run-scoped tool-bridge bearer token |
| `EXPANSION_AGENT_BRIDGE_URL` | base URL of the Next.js tool bridge |
| `EXPANSION_AGENT_MODEL` | `live` \| `scripted` \| `offline` |
| `EXPANSION_AGENT_SCRIPT` | script file for scripted mode |
| `EXPANSION_AGENT_PROVIDER` | `anthropic` \| `openai` \| `google` (auto-detected from key envs when unset) |
| `EXPANSION_AGENT_MODEL_ID` | provider model id (live mode; defaults: `claude-sonnet-4-5`, `gpt-4o-mini`, `gemini-2.5-flash`) |
| `EXPANSION_AGENT_RUN_TIMEOUT_S` | total run deadline (default 900) |

Provider keys read by name only: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GOOGLE_API_KEY` (alias `GEMINI_API_KEY` also satisfies the google provider).
Values are never logged or persisted.

Run-scoped files: `request.json`, `profile.json` (server-written), `run.json`,
`events.jsonl`, `run.worker.json`, `finance.json`, `summary.json`
(worker-owned), `market.json`, `candidates.json`, `inspection.json`
(server-written by the tool bridge), `run.cancel` (cancel route), `tool.token.sha256`.
