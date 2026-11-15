"""Run loop: durable state, bounded execution, cancellation and honest terminals.

The orchestrator owns run.json and events.jsonl for the duration of a run.
Every terminal state is written exactly once and never changes afterwards:
completed / completed_with_gaps (all validated outputs persisted),
cancelled (cancel flag observed), failed (redacted error, no source details).
"""

from __future__ import annotations

import asyncio
import json
import os
import traceback
from typing import Any

from .bridge import RunCancelled, ToolBridge
from .eventlog import EventLog
from .models import (
    AgentModelInfo,
    AgentRunRecord,
    AgentRunRequest,
    SearchArtifact,
    StageReport,
    SummaryArtifact,
)
from .planner import Emitter, ProviderUnavailable, build_planner
from .runstate import RunDirectory, iso_now
from .validation import validate_summary_against_search
from .versions import AGENT_RUN_VERSION, ARTIFACT_VERSION

DEFAULT_RUN_TIMEOUT_S = 900.0
MAX_RUN_TIMEOUT_S = 3600.0
STAGE_ORDER = ["readiness", "market", "site_scout", "space_inspector", "finance"]

REDACTED_FAILURE = "model_or_framework_failed"
REDACTED_MESSAGE = "The agent run failed; no provider details were exposed."


def _log_worker_error(run_dir: str, exc: BaseException) -> None:
    try:
        with open(os.path.join(run_dir, "worker.log"), "a", encoding="utf-8") as handle:
            handle.write(f"{iso_now()} {type(exc).__name__}: {getattr(exc, 'code', '')}\n")
            handle.write(traceback.format_exc(limit=4))
    except Exception:
        pass


def load_script(script_path: str | None) -> dict[str, Any] | None:
    if not script_path:
        return None
    with open(script_path, "r", encoding="utf-8") as handle:
        script = json.load(handle)
    if script.get("version") != 1 or not isinstance(script.get("agents"), dict):
        raise ProviderUnavailable("script_invalid", "The scripted model-double script is missing or invalid.")
    return script


class Orchestrator:
    def __init__(self, run_dir: str):
        self.run_dir = run_dir
        self.request = RunDirectory(run_dir, "").read_artifact("request.json", AgentRunRequest)
        self.directory = RunDirectory(run_dir, self.request.runId)
        self.event_log = EventLog(self.directory.path("events.jsonl"))
        self.record: AgentRunRecord = self.directory.read_artifact("run.json", AgentRunRecord)
        self.config = {
            "mode": os.environ.get("EXPANSION_AGENT_MODEL", "live"),
            "provider": os.environ.get("EXPANSION_AGENT_PROVIDER"),
            "model_id": os.environ.get("EXPANSION_AGENT_MODEL_ID"),
            "model_timeout_s": os.environ.get("EXPANSION_AGENT_MODEL_TIMEOUT_S", "90"),
        }
        timeout_raw = os.environ.get("EXPANSION_AGENT_RUN_TIMEOUT_S", str(DEFAULT_RUN_TIMEOUT_S))
        try:
            self.run_timeout_s = min(float(timeout_raw), MAX_RUN_TIMEOUT_S)
        except ValueError:
            self.run_timeout_s = DEFAULT_RUN_TIMEOUT_S
        self.emitter = Emitter(self.request.runId, self.event_log, self._record_update)

    # -- run.json bookkeeping ------------------------------------------------
    def _write_record(self) -> None:
        self.directory.write_artifact("run.json", self.record)

    def _record_update(self, spec: dict[str, Any]) -> None:
        event_type = spec.get("type")
        payload = spec.get("payload") or {}
        self.record.updatedAt = iso_now()
        if event_type == "tool.completed" and isinstance(payload.get("tool"), str):
            tool = payload["tool"]
            self.record.toolCalls[tool] = self.record.toolCalls.get(tool, 0) + 1
        if event_type in ("stage.completed", "stage.incomplete", "unavailable") and payload.get("status") in (
            "completed", "unavailable", "failed",
        ):
            stage = spec.get("stage")
            if stage in STAGE_ORDER:
                self.record.stages[stage] = payload["status"]
        self._write_record()

    # -- terminal writers -----------------------------------------------------
    def _terminal(self, status: str, error_code: str | None = None, error_message: str | None = None) -> None:
        now = iso_now()
        self.record.status = status
        self.record.updatedAt = now
        self.record.completedAt = now if status in ("completed", "completed_with_gaps") else None
        self.record.cancelledAt = now if status == "cancelled" else None
        self.record.error = (
            {"code": error_code, "message": error_message} if error_code and error_message else None
        )
        self._write_record()

    def _emit_terminal(self, event_type: str, payload: dict[str, Any] | None = None) -> None:
        self.emitter({"type": event_type, "stage": None, "payload": payload})

    # -- main ---------------------------------------------------------------
    async def run(self) -> int:
        request = self.request
        directory = self.directory

        if self.record.status not in ("queued", "running"):
            # Terminal runs are immutable: a re-spawned worker exits without
            # touching anything (duplicate-run protection at worker level).
            return 0

        if directory.is_cancelled():
            self._terminal("cancelled")
            self._emit_terminal("run.cancelled", {"reason": "cancel_requested_before_start"})
            return 2

        bridge = ToolBridge(
            base_url=os.environ.get("EXPANSION_AGENT_BRIDGE_URL", ""),
            run_id=request.runId,
            token=os.environ.get("EXPANSION_AGENT_RUN_TOKEN", ""),
            directory=directory,
        )

        model_info = {
            "framework": "deepagents",
            "provider": None,
            "modelId": None,
            "label": "Deep Agents",
        }
        if self.config["mode"] == "scripted":
            model_info = {
                "framework": "deepagents",
                "provider": "scripted-double",
                "modelId": "generic-fake-chat",
                "label": "Deep Agents · deterministic test double (real framework dispatch)",
            }
        else:
            model_info = {
                "framework": "deepagents",
                "provider": self.config["provider"] or "auto-detected",
                "modelId": self.config["model_id"],
                "label": "Deep Agents · live model",
            }

        self.record.status = "running"
        self.record.updatedAt = iso_now()
        self.record.model = AgentModelInfo(**model_info)
        self._write_record()
        self._emit_terminal("run.started", {"mode": self.config["mode"]})

        os.environ["EXPANSION_AGENT_RUN_DIR"] = self.run_dir
        os.environ.setdefault("EXPANSION_AGENT_CITY", request.cityId)

        try:
            script = None
            if self.config["mode"] == "scripted":
                script = load_script(os.environ.get("EXPANSION_AGENT_SCRIPT"))
            if self.config["mode"] == "offline":
                raise ProviderUnavailable(
                    "model_unavailable",
                    "The model provider is unavailable in this environment; the deterministic search path remains available.",
                )
            agent, tracker, summaries, live_info = build_planner(
                request, directory, bridge, self.emitter, script, self.config,
            )
            if live_info is not None:
                self.record.model = AgentModelInfo(
                    framework="deepagents",
                    provider=live_info[0],
                    modelId=live_info[1],
                    label=f"Deep Agents · live {live_info[0]}/{live_info[1]}",
                )
                self._write_record()
        except ProviderUnavailable as error:
            _log_worker_error(self.run_dir, error)
            self._terminal("failed", error.code, error.message)
            self._emit_terminal("run.failed", {"code": error.code})
            return 3

        instruction = (
            "Execute the five-stage scouting run for this profile in dependency order "
            "(readiness, market, site_scout, space_inspector, finance), delegating each "
            "stage to its specialist with the task tool, then call finalize_run once with "
            "the grounded summary."
        )
        try:
            try:
                await asyncio.wait_for(
                    agent.ainvoke(
                        {"messages": [{"role": "user", "content": instruction}]},
                        config={"recursion_limit": 300},
                    ),
                    timeout=self.run_timeout_s,
                )
            except asyncio.TimeoutError:
                _log_worker_error(self.run_dir, asyncio.TimeoutError("run deadline"))
                self._terminal("failed", "run_timeout", "The agent run exceeded its time budget.")
                self._emit_terminal("run.failed", {"code": "run_timeout"})
                return 3
            except asyncio.CancelledError:
                raise
            except RunCancelled:
                raise
        except RunCancelled:
            self._terminal("cancelled")
            self._emit_terminal("run.cancelled", {"reason": "cancel_requested"})
            return 2
        except Exception as error:  # noqa: BLE001 — honest terminal, redacted
            _log_worker_error(self.run_dir, error)
            self._terminal("failed", REDACTED_FAILURE, REDACTED_MESSAGE)
            self._emit_terminal("run.failed", {"code": REDACTED_FAILURE})
            return 3

        if directory.is_cancelled():
            self._terminal("cancelled")
            self._emit_terminal("run.cancelled", {"reason": "cancel_requested"})
            return 2

        return self._complete(tracker, summaries)

    def _complete(self, tracker, summaries: dict[str, Any]) -> int:
        stage_reports: list[StageReport] = []
        for stage in STAGE_ORDER:
            status = tracker.statuses.get(stage, "failed")
            stage_reports.append(StageReport(
                stage=stage,
                status=status,
                digest=tracker.digests.get(stage, "The specialist did not produce a validated result."),
                candidateIds=tracker.candidate_ids.get(stage, []),
                missing=tracker.missing.get(stage, []),
            ))
        summary_text = summaries.get("summary_text")
        if not summary_text:
            summary_text = (
                "The planner finished without a validated final summary; specialist "
                "results below are the validated tool outputs only."
            )
        grounded_ids: list[str] = []
        for ids in (
            tracker.candidate_ids.get("space_inspector"),
            tracker.candidate_ids.get("site_scout"),
        ):
            if ids:
                grounded_ids = list(dict.fromkeys(ids))
                break
        summary = SummaryArtifact(
            artifactVersion=ARTIFACT_VERSION,
            modelVersion=AGENT_RUN_VERSION,
            runId=self.request.runId,
            executionMode=self.request.executionMode,
            terminalStatus="completed_with_gaps"
            if any(item.status != "completed" for item in stage_reports)
            else "completed",
            stageReports=stage_reports,
            summaryText=summary_text,
            missingEvidence=summaries.get("missing_evidence") or [],
            followUps=summaries.get("follow_ups") or [],
            assumptions=summaries.get("assumptions") or [],
            groundedCandidateIds=grounded_ids,
            completedAt=iso_now(),
        )
        self.directory.write_artifact("summary.json", summary)

        # Defense in depth: when a search artifact exists, the persisted
        # summary must ground in it. Without any search there can be no
        # grounded candidate IDs at all.
        try:
            search = self.directory.read_artifact("candidates.json", SearchArtifact)
            validate_summary_against_search(summary, search)
            self.record.datasetId = search.datasetId
            self.record.datasetDate = search.datasetDate
        except FileNotFoundError:
            if summary.groundedCandidateIds:
                _log_worker_error(self.run_dir, ValueError("summary carried ids without a search artifact"))
                self._terminal("failed", REDACTED_FAILURE, REDACTED_MESSAGE)
                self._emit_terminal("run.failed", {"code": "summary_grounding"})
                return 3
        except Exception:
            # A summary that fails cross-artifact validation can never be the
            # completed terminal state; the run is honestly marked failed.
            _log_worker_error(self.run_dir, ValueError("summary grounding check failed"))
            self._terminal("failed", REDACTED_FAILURE, REDACTED_MESSAGE)
            self._emit_terminal("run.failed", {"code": "summary_grounding"})
            return 3

        self.record.stages = {stage: tracker.statuses.get(stage, "failed") for stage in STAGE_ORDER}
        self._terminal(summary.terminalStatus)
        self._emit_terminal("run.completed", {
            "status": summary.terminalStatus,
            "mode": self.request.executionMode,
        })
        return 0
