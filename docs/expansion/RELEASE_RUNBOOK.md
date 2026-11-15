# Expansion release runbook (Phase 5)

Status: **prepared and locally verified; not deployed.** No hosted environment exists yet, and the shared MongoDB Atlas cluster could not be reached from the authoring machine (TLS rejected; most likely the Atlas network access list). Read the capability table before you demo or deploy anything. Never paste secret values into this file, tickets or logs.

## 1. Architecture in one paragraph

One long-running **Next.js** server (`next start`) serves the UI and the `/api/expansion/*` routes. For each agent run it spawns a detached **Python Deep Agents worker** (`restaurantos_worker.cli run --run-dir …`) that calls back into the server over the authenticated HTTP **tool bridge** on `EXPANSION_AGENT_BRIDGE_URL`. The worker's working store is a **run directory** on a persistent private volume (`EXPANSION_AGENT_RUNS_DIR/<ownerId>/agent-<runId>/`). **MongoDB** (`restaurantos` database, `expansion_*` collections only) is the durable system of record: profiles/revisions, run mirrors, events, candidate assessments, evidence, scenarios and decision briefs. The private **CoStar SQLite cache** (`EXPANSION_DB_PATH`) lives on the same persistent volume, never in the image or the repository. Serverless hosting cannot run this topology (child processes, local SQLite, persistent disk); use one container/VM.

```
browser ──HTTPS──▶ next start ──spawn──▶ python worker (per run)
   ▲  HttpOnly owner cookie     │  ▲            │
   │                            │  └── tool bridge (per-run bearer token) ◀┘
   │                            ├── /data/runs/<owner>/agent-<run>/  (worker working store)
   │                            ├── /data/expansion.sqlite           (private CoStar cache, read-only)
   │                            └── MongoDB restaurantos.expansion_* (durable records)
```

## 2. Required environment variable names

Values come from your secret store. Template: `deploy/expansion/runtime.env.example`.

| Name | Required | Purpose |
|---|---|---|
| `EXPANSION_SESSION_SECRET` | **yes (production)** | ≥ 32 chars; signs the HttpOnly `expansion_owner` cookie. Missing in production → owner routes return `503 auth_not_configured`. In development a secret is generated once into the git-ignored data dir. |
| `MONGODB_URI` | **yes** for durable storage | Shared Atlas connection (same variable Tactical uses). |
| `MONGODB_DB` | recommended | Database name, default `restaurantos`. (`EXPANSION_MONGODB_DB` overrides for Expansion only.) |
| `EXPANSION_PERSISTENCE` | optional | `mongodb` \| `file` \| `off`. Auto: `mongodb` when `MONGODB_URI` is set, else `file` in development, `off` in production. `file` is a single-host development fallback (`EXPANSION_STORE_DIR`). |
| `EXPANSION_ACCESS_CODE` | recommended for demos | When set, new owner sessions require this code (`POST /api/expansion/session`). |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | for live agent runs | Without one, live runs fail honestly (`provider_not_configured`) and the deterministic search remains available. |
| `EXPANSION_AGENT_PROVIDER`, `EXPANSION_AGENT_MODEL_ID` | optional | Override provider/model (default auto-detect; Gemini → `gemini-2.5-flash`). |
| `EXPANSION_DB_PATH`, `EXPANSION_COSTAR_ROOT`, `EXPANSION_DATASET_ID`, `EXPANSION_DATASET_DATE` | **yes** for local data | Private dataset cache + raw kit location on the persistent volume. |
| `EXPANSION_AGENT_RUNS_DIR` | **yes** (persistent path) | Worker run directories. Must be on persistent storage. |
| `EXPANSION_AGENT_PYTHON` | yes in containers | Worker venv interpreter (default: `src/features/expansion/agent/.venv`). |
| `EXPANSION_AGENT_BRIDGE_URL` | yes | URL the worker uses to reach this server (default `http://127.0.0.1:3000`; must match the port). |
| `EXPANSION_AGENT_RUN_TIMEOUT_S`, `EXPANSION_AGENT_EVIDENCE`, `EXPANSION_AGENT_WORKER_LOG` | optional | Run deadline (default 900 s); `0` disables Phase 4 evidence collection on agent runs; worker stdout/stderr log file. |
| `EXPANSION_SOURCE_NETWORK`, `EXPANSION_VEXCEL_DISPLAY`, `EXPANSION_HEIGHTS_LOOKUP`, `MATTERPORT_API_KEY`, `VEXCEL_API_KEY` | optional, off by default | Live source probes. Only enable with confirmed rights. |

## 3. Setup

```bash
npm ci
```

```bash
python -m venv src/features/expansion/agent/.venv
```

```bash
src/features/expansion/agent/.venv/Scripts/python.exe -m pip install -r src/features/expansion/agent/worker/requirements.lock
```

(Linux/macOS: `.venv/bin/python`. On this Windows machine pip 3.14 can hang; the worker README documents the `uv` fallback.)

### Dataset import (private data; never committed, never baked into images)

1. Copy the permitted CoStar kit to the host's persistent volume out of band (it is git-ignored and must not be uploaded anywhere else).
2. Set `EXPANSION_COSTAR_ROOT`, `EXPANSION_DB_PATH`, `EXPANSION_DATASET_ID`, `EXPANSION_DATASET_DATE`.
3. Build the v2 cache (atomic; an existing cache survives a failed import):

```bash
npm run expansion:import
```

A synthetic dataset for demos/tests is built by `src/features/expansion/frontend/e2e/global-setup.ts` (dataset id `synthetic-e2e-v1`). It is labeled synthetic everywhere and is never evidence about real properties.

### MongoDB migration (`expansion-mongo-v1`, additive, re-runnable)

```bash
npm run expansion:db:migrate
```

Creates (only if missing) these collections with `$jsonSchema` validators, plus indexes, and records `expansion_migrations/expansion-mongo-v1`:

| Collection | Contents | Indexes |
|---|---|---|
| `expansion_profiles` | owner's profile heads (latest revision pointer) | `{ownerId, updatedAt:-1}` |
| `expansion_profile_revisions` | immutable profile revisions (insert-only, content-hashed) | unique `{ownerId, profileId, revisionNumber}`, `{ownerId, revisionId}` |
| `expansion_runs` | run mirror: record, model/version info, terminal artifacts, search metadata | `{ownerId, createdAt:-1}`, `{ownerId, requirementsHash, status}` |
| `expansion_run_events` | replayable run events (insert-only) | unique `{ownerId, runId, seq}`, **TTL 180 days** on `storedAt` |
| `expansion_candidate_assessments` | per-candidate assessments of terminal runs, original order | unique `{ownerId, runId, position}` |
| `expansion_evidence` | immutable source snapshots (investigation refreshes, agent-collected, brief-frozen) | `{ownerId, runId, candidateId, storedAt:-1}` |
| `expansion_scenarios` | finance inputs + deterministic results per compared space per brief | unique `{ownerId, briefId, candidateId}` |
| `expansion_decision_briefs` | immutable decision briefs (`app` or `browser_import`, `runVerified`) | `{ownerId, createdAt:-1}` |

Every document `_id` is `<ownerId>:<localId>` and every query filters by `ownerId`. No other feature's collection is read or written. The Atlas user needs `readWrite` on the database (validators are applied at creation; `collMod` is not required). The app also runs the migration lazily on first use.

## 4. Start and health

```bash
npm run build
```

```bash
npm run start -- -p 3000
```

The worker needs no separate start command: the server spawns one per run. Health:

| Check | Command | Meaning |
|---|---|---|
| Liveness | `curl -s http://127.0.0.1:3000/api/expansion/health` | 200 while the server responds |
| Readiness | `curl -s http://127.0.0.1:3000/api/expansion/health?ready=1` | 200 only when sessions, storage, worker runtime, dataset and run store are usable; 503 with per-check reasons otherwise. Also sweeps stale runs. Never prints secrets or paths. |
| Mongo | `npm run db:check` then `npm run expansion:db:migrate` | connectivity proof + idempotent migration |
| Stale runs after restart | `npm run expansion:recover` | marks dead/never-started/stalled runs `failed` with actionable codes |

Container: `deploy/expansion/Dockerfile` (+ `Dockerfile.dockerignore`) — **prepared, never built or run** (no Docker on the authoring machine).

Build note: `next build` prints Turbopack "dynamic filesystem access causes tracing of the whole project" warnings for the run store/dataset modules. They affect serverless file tracing only; the supported topology is `next start` on a host with the repository, so they are informational.

## 5. Two-minute demo journey

1. Open `/expansion` (enter the access code if the deployment sets one). The browser receives a private, server-issued owner cookie.
2. **Use example restaurant** (fictional Cedar Kitchen) → **Edit requirements** → **Save profile draft**. The toast confirms "saved on this browser and in your private workspace (mongodb|file)".
3. **Continue to the scouting map** → Data mode **Local dataset** → Agent execution mode **Live model** → **Start agent-assisted scouting**. Five specialist stages stream in (readiness, market, site scout, space inspector, finance). A failure shows the honest reason plus **Continue with deterministic search** (separately labeled; never presented as an agent success).
4. **Investigate this run** → per-requirement evidence; revision 0 starts from the Phase 4 source statuses the agent's inspection stage collected (live sources only; unavailable is explicit).
5. Select two or three spaces → compare opening plans side by side → **Save decision brief** (saved in the browser and the private workspace; the server re-verifies the run snapshot against your stored run).
6. Reload the page → open **Saved decision briefs** → **Restore workspace brief** (restores frozen evidence and calculations without contacting providers).
7. Optional: **Import browser copies to your workspace** — explicit, per-item results, browser originals are never deleted.

## 6. Capability and verification matrix (2026-11-15)

| Capability | Status | Evidence |
|---|---|---|
| Owner sessions (signed HttpOnly cookie, server-minted ids, optional access code) | **verified locally** | `persistence.test.ts`; production server issued two distinct owners |
| Ownership on profiles/runs/candidates/events/artifacts/investigations/briefs | **verified locally** | allowed owner 200 / cross-owner 404 / spoofed header 401 / forged cookie 401 (tests) and against the production server (H-006) |
| Worker tool ownership | **verified locally** | token for owner A's run rejected as owner B (test); live worker sends its run's owner id |
| Durable storage via MongoDB repository | **implemented, NOT verified against Atlas** | Atlas TLS-rejects this machine; repository logic verified with memory/file implementations of the same interface |
| File repository (single-host fallback) | **verified locally** | used by the production smoke journey |
| Restore after run-directory loss | **verified locally (test)** | durable artifact/event fallback tests |
| Recovery: worker exit / never started / stall / late worker write | **verified locally** | Node + Python tests; production run with a broken bridge ended `failed` with fallback offered |
| Duplicate submission | **verified locally** | test + route header `X-Expansion-Deduplicated` |
| Live Deep Agents run in the production build | **verified locally (live model, synthetic data)** | 2026-11-15, `next start`: gemini-2.5-flash, `completed_with_gaps`, 4 stages completed + finance honestly unavailable, 16 bridge tool calls; investigated, compared, saved, reloaded and restored (H-006) |
| Phase 4 evidence attached to agent runs | **implemented; sources unavailable on this host** | `evidence.json` holds explicit unavailable statuses unless live probes are enabled |
| Live sources (Matterport, Vexcel, ACS, Heights, OSM) | **not verified** | no permitted live probes run (Phase 4 gate B) |
| Real-data journey | **not run** | private dataset exists locally but the Phase 5 smoke used the synthetic cache |
| Hosted deployment | **not done** | no hosting target/credentials; Dockerfile prepared only |
| Shared RestaurantOS identity | **blocked on coordination** | Expansion-local owner cookie until Tactical/shared identity is agreed |

## 7. Failure recovery

| Symptom | Action |
|---|---|
| Readiness `storage` false (mongodb) | Check `MONGODB_URI`, Atlas network access list (`npm run db:check`). The UI keeps browser copies and says so; nothing is lost. Re-save or use **Import browser copies** once storage is back. |
| Readiness `sessions` false | Set `EXPANSION_SESSION_SECRET` (≥ 32 chars). Rotating it signs everyone out of their owner workspace (data stays, but old cookies no longer map to it) — do not rotate casually. |
| Run stuck `running` | It recovers automatically: worker gone → `failed/worker_exited` after 30 s; never started → `worker_not_started` after 2 min; no progress → `interrupted` (5 min) / `stalled` (20 min). Force a sweep with `npm run expansion:recover` or the readiness URL. |
| Live model outage | Run ends `failed` (`provider_not_configured`, `model_unavailable`, `model_or_framework_failed`, `run_timeout`); user continues with the labeled deterministic search. |
| Worker venv missing | Readiness `worker` false → reinstall the venv (section 3). |
| Dataset missing | Readiness `dataset` false → copy kit to the volume and `npm run expansion:import`. |

## 8. Rollback and restore

- **App rollback:** redeploy the previous image/commit. Phase 5 data is additive: older builds ignore `expansion_*` collections and the owner cookie; their browser-local drafts/briefs are untouched by Phase 5 (originals are never deleted).
- **Schema rollback:** the migration only adds collections/indexes. To remove Phase 5 storage on a **nonproduction** database only: drop the eight `expansion_*` collections and `expansion_migrations`. This deletes durable briefs/profiles — export first.
- **Restore:** use Atlas point-in-time/snapshot restore into a scratch database, set `EXPANSION_MONGODB_DB` to it on a nonproduction instance, open `/api/expansion/health?ready=1`, then restore a saved brief from the UI. **Not exercised** (no reachable Atlas); recorded as a gap.
- **Run store:** run directories are working copies; terminal runs are mirrored to Mongo. Losing `/data/runs` loses only in-flight runs (which recover as failed) — finished runs restore from Mongo.

## 9. Known gaps

- Atlas persistence, migration and restore are unverified from this machine (network access list).
- No hosted deployment or target-environment smoke test exists.
- Identity is Expansion-local (anonymous device-bound owners, optional shared access code); no per-user login or cross-device access until a shared RestaurantOS identity is agreed with the Tactical owner.
- Runs created before Phase 5 under the old `local` session directory are not visible to owners; import their briefs from the browser instead (labeled "run snapshot unverified").
- Live source probes, real-data journey and two-user browser (UI) tests were not run in this phase; the two-owner checks ran at test and API level.
