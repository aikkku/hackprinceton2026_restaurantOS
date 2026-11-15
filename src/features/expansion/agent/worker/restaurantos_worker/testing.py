"""Deterministic test doubles shared by the worker test suite.

The fake bridge implements the exact HTTP contract of the TypeScript tool
bridge (POST /api/expansion/agent-tools with a bearer token) using committed
fixture data. It is a labeled test double: tests that must exercise the real
TypeScript bridge run through the Node integration test and the Playwright
browser journey instead.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .models import (
    AgentEvent,
    AgentRunRecord,
    AgentRunRequest,
    MarketArtifact,
    SearchArtifact,
    FinanceArtifact,
    InspectionArtifact,
    ProfileArtifact,
)
from .runstate import RunDirectory

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


def workspace_tmp() -> Path:
    """Workspace-scoped temp base so test runs never litter the repo root
    (platform temp dirs can be redirected or restricted for child processes)."""
    path = Path(__file__).resolve().parents[2] / ".tmp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def make_tmp_dir(prefix: str) -> Path:
    return Path(tempfile.mkdtemp(prefix=prefix, dir=str(workspace_tmp())))


def fixture(name: str) -> dict[str, Any]:
    with open(FIXTURES / "contracts" / name, "r", encoding="utf-8") as handle:
        return json.load(handle)


def fixture_profile() -> ProfileArtifact:
    return ProfileArtifact.model_validate(fixture("profile.sample.json"))


def make_run_dir(base: Path, run_id: str, execution_mode: str = "scripted") -> RunDirectory:
    directory = RunDirectory(str(base), run_id)
    profile = fixture_profile()
    request = AgentRunRequest(
        requestVersion="expansion-agent-run-v1",
        runId=run_id,
        sessionId="test-session",
        cityId=profile.cityId,
        executionMode=execution_mode,
        createdAt="2026-11-14T12:00:00.000Z",
        datasetId=None,
        datasetDate=None,
        profile=profile,
    )
    directory.write_artifact("request.json", request)
    directory.write_artifact("profile.json", profile)
    record = AgentRunRecord(
        version="expansion-agent-run-v1",
        runId=run_id,
        sessionId="test-session",
        status="queued",
        executionMode=execution_mode,
        createdAt="2026-11-14T12:00:00.000Z",
        updatedAt="2026-11-14T12:00:00.000Z",
        completedAt=None,
        cancelledAt=None,
        cityId=profile.cityId,
        datasetId=None,
        datasetDate=None,
        profile={"revisionId": profile.revisionId, "revisionNumber": profile.revisionNumber},
        requirementsHash="test-hash",
        model=None,
        toolCalls={},
        stages={
            "readiness": "not_run",
            "market": "not_run",
            "site_scout": "not_run",
            "space_inspector": "not_run",
            "finance": "not_run",
        },
        error=None,
    )
    directory.write_artifact("run.json", record)
    return directory


class BridgeDependencyError(Exception):
    """Mirrors the TS bridge's 409 conflict for unmet stage dependencies."""


class FakeBridge:
    """Threaded HTTP server implementing the TS bridge contract from fixtures."""

    def __init__(self, token: str, *, slow: dict[str, float] | None = None,
                 fail_tools: dict[str, tuple[int, str, str]] | None = None,
                 fail_counts: dict[str, int] | None = None,
                 directory: RunDirectory | None = None):
        self.token = token
        self.slow = slow or {}
        self.fail_tools = fail_tools or {}
        self.fail_counts = fail_counts or {}
        self.directory = directory
        self.calls: dict[str, int] = {}
        self._lock = threading.Lock()
        self._handler = self._make_handler()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "FakeBridge":
        self.thread.start()
        return self

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()

    def _make_handler(self) -> type[BaseHTTPRequestHandler]:
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:  # silence
                return

            def do_POST(self) -> None:
                if self.path != "/api/expansion/agent-tools":
                    self._reply(404, {"ok": False, "error": {"code": "not_found", "message": "unknown route"}})
                    return
                if self.headers.get("Authorization") != f"Bearer {outer.token}":
                    self._reply(401, {"ok": False, "error": {"code": "unauthorized", "message": "bad token"}})
                    return
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}")
                with outer._lock:
                    outer.calls[body.get("tool", "?")] = outer.calls.get(body.get("tool", "?"), 0) + 1
                slow = outer.slow.get(body.get("tool"), 0)
                if slow:
                    time.sleep(slow)
                failed = outer.fail_tools.get(body.get("tool"))
                tool_name = body.get("tool", "")
                with outer._lock:
                    remaining = outer.fail_counts.get(tool_name, 0)
                    if remaining > 0:
                        outer.fail_counts[tool_name] = remaining - 1
                        failed = (503, "bridge_busy", "transient failure injected by the test double")
                if failed:
                    status, code, message = failed
                    self._reply(status, {"ok": False, "error": {"code": code, "message": message}})
                    return
                try:
                    output = outer.dispatch(body)
                    self._reply(200, {"ok": True, "output": output})
                except BridgeDependencyError as error:
                    self._reply(409, {"ok": False, "error": {"code": "conflict", "message": str(error)}})
                except Exception as error:  # noqa: BLE001
                    self._reply(400, {"ok": False, "error": {"code": "invalid_input", "message": str(error)}})

            def _reply(self, status: int, payload: dict[str, Any]) -> None:
                data = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        return Handler

    # -- deterministic tool behavior -----------------------------------------
    def run_dir(self) -> RunDirectory:
        if self.directory is not None:
            return self.directory
        return RunDirectory(os.environ.get("EXPANSION_AGENT_RUN_DIR", ""), "")

    def dispatch(self, body: dict[str, Any]) -> dict[str, Any]:
        tool = body["tool"]
        if tool == "profile.readiness_report":
            profile = self.run_dir().read_artifact("profile.json", ProfileArtifact)
            unknown = [r for r in profile.requirements.requirements if r.state == "unknown"]
            known = [r for r in profile.requirements.requirements if r.state == "known"]
            return {
                "modelVersion": "expansion-readiness-tool-v1",
                "intakeSchemaVersion": "1.0",
                "requirementsModelVersion": "expansion-requirements-v1",
                "revisionId": profile.revisionId,
                "revisionNumber": profile.revisionNumber,
                "followUpQuestions": [q.model_dump() for q in profile.followUpQuestions],
                "completeness": {
                    "known": [r.id for r in known],
                    "unknown": [r.id for r in unknown],
                    "missing": [
                        {"requirementId": r.id, "label": r.label, "neededFor": r.note or "search completeness"}
                        for r in unknown
                    ],
                },
                "tacticalReport": None,
                "note": "No agreed Tactical report was provided for this run; readiness covers the Expansion profile only and never invents a readiness score.",
            }
        if tool == "market.context":
            data = fixture("market.sample.json")
            artifact = MarketArtifact.model_validate({**data, "runId": body["runId"]})
            self.run_dir().write_artifact("market.json", artifact)
            return {
                "modelVersion": "expansion-market-tool-v1",
                "cityId": artifact.cityId,
                "sourced": artifact.sourced,
                "dataset": artifact.dataset.model_dump() if artifact.dataset else None,
                "sourceCapabilities": [c.model_dump() for c in artifact.sourceCapabilities],
                "unavailableReasons": artifact.unavailableReasons,
            }
        if tool == "scout.search_city":
            data = fixture("candidates.sample.json")
            search = SearchArtifact.model_validate({**data, "runId": body["runId"]})
            self.run_dir().write_artifact("candidates.json", search)
            return {
                "modelVersion": "expansion-search-v1",
                "matchingModelVersion": "expansion-matching-v1",
                "requirementsModelVersion": "expansion-requirements-v1",
                "cityId": search.cityId,
                "datasetId": search.datasetId,
                "datasetDate": search.datasetDate,
                "searchedAt": search.searchedAt,
                "cancelled": False,
                "counts": search.counts.model_dump(),
                "candidateIds": [c.candidate.id for c in search.candidates],
                "topCandidates": [
                    {
                        "id": c.candidate.id,
                        "name": c.candidate.name,
                        "group": c.group,
                        "rank": c.rank,
                        "serviceInclusion": "unknown",
                        "topAssessment": {
                            "requirementId": c.assessments[0].requirementId,
                            "status": c.assessments[0].status,
                            "reasonCode": c.assessments[0].reasonCode,
                            "reason": c.assessments[0].reason,
                        },
                    }
                    for c in sorted(search.candidates, key=lambda item: item.rank)
                ],
                "excluded": [e.model_dump() for e in search.excluded],
                "excludedTruncated": search.excludedTruncated,
            }
        if tool == "inspector.evidence":
            if not os.path.exists(self.run_dir().path("candidates.json")):
                raise BridgeDependencyError("The site scout has not produced candidates yet.")
            search = self.run_dir().read_artifact("candidates.json", SearchArtifact)
            requested = list((body.get("input") or {}).get("candidateIds") or [])
            by_id = {item.candidate.id: item for item in search.candidates}
            inspected, not_found = [], []
            for candidate_id in requested:
                assessed = by_id.get(candidate_id)
                if assessed is None:
                    not_found.append(candidate_id)
                    continue
                gaps = [a for a in assessed.assessments if a.status != "pass"]
                inspected.append({
                    "candidateId": assessed.candidate.id,
                    "name": assessed.candidate.name,
                    "candidate": assessed.candidate.model_dump(),
                    "assessments": [a.model_dump() for a in assessed.assessments],
                    "gaps": [a.model_dump() for a in gaps],
                    "verificationTasks": [
                        "Verify suite kitchen equipment with the landlord or a walkthrough."
                        if a.reasonCode == "kitchen_unverified"
                        else "Confirm customer parking rights for the suite in the lease."
                        if a.reasonCode == "parking_unverified"
                        else "Verify this requirement with an independent source."
                        for a in gaps
                    ],
                })
            artifact = InspectionArtifact(
                artifactVersion="expansion-agent-artifact-v1",
                modelVersion="expansion-inspection-tool-v1",
                runId=body["runId"],
                inspectedAt="2026-11-14T12:02:00.000Z",
                candidates=inspected,
                notFoundIds=not_found,
            )
            self.run_dir().write_artifact("inspection.json", artifact)
            return {"modelVersion": "expansion-inspection-tool-v1", "inspected": inspected, "notFoundIds": not_found}
        if tool == "finance.monthly_occupancy":
            if not (self.run_dir().path("candidates.json") and os.path.exists(self.run_dir().path("candidates.json"))):
                raise BridgeDependencyError("The site scout has not produced candidates yet.")
            candidate_id = (body.get("input") or {}).get("candidateId")
            data = fixture("finance.sample.json")
            for entry in data["occupancy"]:
                if entry["candidateId"] == candidate_id:
                    return entry
            raise ValueError(f"Unknown candidate {candidate_id}")
        if tool == "finance.required_sales":
            data = fixture("finance.sample.json")
            return data["requiredSales"]
        raise ValueError(f"Unknown tool {tool}")


def run_dir_env(directory: RunDirectory) -> dict[str, str]:
    return {"EXPANSION_AGENT_RUN_DIR": directory.run_dir}


class WorkerEnv:
    """Scoped environment for one worker run; restores previous values."""

    def __init__(self, **values: str | None):
        self.values = values
        self.previous: dict[str, str | None] = {}

    def __enter__(self) -> "WorkerEnv":
        for name, value in self.values.items():
            self.previous[name] = os.environ.get(name)
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        return self

    def __exit__(self, *args: Any) -> None:
        for name, value in self.previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


SCRIPT = Path(__file__).resolve().parent.parent / "fixtures" / "cedar-kitchen-run.script.json"


def read_run(directory: RunDirectory) -> AgentRunRecord:
    return directory.read_artifact("run.json", AgentRunRecord)


def read_events(directory: RunDirectory) -> list[AgentEvent]:
    from .eventlog import read_events

    return read_events(directory.path("events.jsonl"))
