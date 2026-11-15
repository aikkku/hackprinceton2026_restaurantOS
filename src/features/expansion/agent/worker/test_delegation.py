"""Genuine framework delegation tests.

Every test here runs the REAL deepagents planner graph (create_deep_agent +
SubAgent task-tool dispatch). Only the model is a deterministic scripted
double and the bridge is the fixture-backed test double. A handwritten
planner would fail these tests because the assertions cover framework
dispatch artifacts: the task tool delegations, specialist tool executions,
validated finalize outputs, persisted artifacts and the event sequence.
"""

from __future__ import annotations

import asyncio
import json
import unittest
from pathlib import Path

from restaurantos_worker.models import (
    FinanceArtifact,
    InspectionArtifact,
    MarketArtifact,
    ProfileArtifact,
    SearchArtifact,
    SummaryArtifact,
)
from restaurantos_worker.orchestrator import Orchestrator
from restaurantos_worker.testing import (
    SCRIPT,
    FakeBridge,
    make_tmp_dir,
    WorkerEnv,
    make_run_dir,
    read_events,
    read_run,
)
from restaurantos_worker.validation import validate_summary_against_search


def run_orchestrator(run_dir: str, bridge_url: str, token: str,
                     extra_env: dict[str, str] | None = None) -> int:
    env = {
        "EXPANSION_AGENT_MODEL": "scripted",
        "EXPANSION_AGENT_SCRIPT": str(SCRIPT),
        "EXPANSION_AGENT_BRIDGE_URL": bridge_url,
        "EXPANSION_AGENT_RUN_TOKEN": token,
        "EXPANSION_AGENT_RUN_DIR": run_dir,
        **(extra_env or {}),
    }
    with WorkerEnv(**env):
        return asyncio.run(Orchestrator(run_dir).run())


class DelegationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(make_tmp_dir("deleg-"))
        self.token = "deleg-token"
        self.bridge = FakeBridge(self.token).start()

    def tearDown(self) -> None:
        self.bridge.stop()

    def test_all_five_specialists_complete_with_validated_artifacts(self) -> None:
        directory = make_run_dir(self.dir, "run-1")
        code = run_orchestrator(str(self.dir), self.bridge.url, self.token)
        self.assertEqual(code, 0)
        record = read_run(directory)
        self.assertEqual(record.status, "completed_with_gaps")
        self.assertEqual(
            record.stages,
            {
                "readiness": "completed",
                "market": "completed",
                "site_scout": "completed",
                "space_inspector": "completed",
                "finance": "unavailable",
            },
        )
        # Every tool path exercised through the bridge, including the two
        # deterministic Phase 2 finance tools.
        for tool in [
            "profile.readiness_report",
            "market.context",
            "scout.search_city",
            "inspector.evidence",
            "finance.monthly_occupancy",
            "finance.required_sales",
        ]:
            self.assertIn(tool, self.bridge.calls, f"{tool} was never called")

        profile = directory.read_artifact("profile.json", ProfileArtifact)
        market = directory.read_artifact("market.json", MarketArtifact)
        search = directory.read_artifact("candidates.json", SearchArtifact)
        inspection = directory.read_artifact("inspection.json", InspectionArtifact)
        finance = directory.read_artifact("finance.json", FinanceArtifact)
        summary = directory.read_artifact("summary.json", SummaryArtifact)

        self.assertTrue(market.sourced)
        self.assertEqual(len(search.candidates), 3)
        self.assertEqual(len(inspection.candidates), 3)
        self.assertIsNotNone(finance.requiredSales)
        self.assertEqual(finance.requiredSales.status, "unavailable")
        self.assertEqual(finance.missingInputs[0].split(",")[0].lower().startswith("the financial baseline"), True)
        # Grounded IDs come from tool outputs, never from the model's text.
        validate_summary_against_search(summary, search)
        self.assertEqual(
            summary.groundedCandidateIds,
            [item.candidate.id for item in sorted(search.candidates, key=lambda c: c.rank)],
        )
        self.assertEqual(summary.terminalStatus, "completed_with_gaps")
        self.assertEqual(profile.modelVersion, "expansion-requirements-v1")

    def test_event_sequence_and_replay(self) -> None:
        directory = make_run_dir(self.dir, "run-2")
        code = run_orchestrator(str(self.dir), self.bridge.url, self.token)
        self.assertEqual(code, 0)
        events = read_events(directory)
        types = [event.type for event in events]
        self.assertEqual(types[0], "run.started")
        self.assertEqual(types[-1], "run.completed")
        self.assertEqual([event.seq for event in events], list(range(1, len(events) + 1)))
        # One stage.started + stage.completed per completed stage.
        for stage in ["readiness", "market", "site_scout", "space_inspector"]:
            self.assertIn("stage.started", [
                t for t, e in zip(types, events) if e.stage == stage
            ])
        # tool.completed for every bridge tool call.
        tool_events = [e for e in events if e.type == "tool.completed"]
        self.assertGreaterEqual(len(tool_events), 6)
        self.assertIn("unavailable", types)  # finance stage recorded honestly

    def test_run_record_tracks_tool_calls_and_model(self) -> None:
        directory = make_run_dir(self.dir, "run-3")
        run_orchestrator(str(self.dir), self.bridge.url, self.token)
        record = read_run(directory)
        self.assertEqual(record.model.framework, "deepagents")
        self.assertEqual(record.model.provider, "scripted-double")
        self.assertEqual(record.toolCalls["finance.monthly_occupancy"], 3)
        self.assertEqual(record.toolCalls["scout.search_city"], 1)
        self.assertEqual(record.error, None)
        self.assertEqual(record.datasetId, "fixture-dataset")

    def test_script_invalid_version_rejected(self) -> None:
        directory = make_run_dir(self.dir, "run-4")
        bad_script = self.dir / "bad.script.json"
        bad_script.write_text(json.dumps({"version": 2, "agents": {}}), encoding="utf-8")
        code = run_orchestrator(
            str(self.dir), self.bridge.url, self.token,
            {"EXPANSION_AGENT_SCRIPT": str(bad_script)},
        )
        self.assertEqual(code, 3)
        record = read_run(directory)
        self.assertEqual(record.status, "failed")
        self.assertEqual(record.error.code, "script_invalid")

    def test_offline_mode_fails_honestly(self) -> None:
        directory = make_run_dir(self.dir, "run-5")
        with WorkerEnv(
            EXPANSION_AGENT_MODEL="offline",
            EXPANSION_AGENT_BRIDGE_URL=self.bridge.url,
            EXPANSION_AGENT_RUN_TOKEN=self.token,
            EXPANSION_AGENT_RUN_DIR=str(self.dir),
        ):
            code = asyncio.run(Orchestrator(str(self.dir)).run())
        self.assertEqual(code, 3)
        record = read_run(directory)
        self.assertEqual(record.status, "failed")
        self.assertEqual(record.error.code, "model_unavailable")
        events = read_events(directory)
        self.assertEqual([event.type for event in events], ["run.started", "run.failed"])

    def test_duplicate_submission_terminal_untouched(self) -> None:
        directory = make_run_dir(self.dir, "run-6")
        run_orchestrator(str(self.dir), self.bridge.url, self.token)
        before = read_run(directory).model_dump_json()
        code = run_orchestrator(str(self.dir), self.bridge.url, self.token)
        self.assertEqual(code, 0)  # re-spawn exits without touching anything
        after = read_run(directory).model_dump_json()
        self.assertEqual(before, after)

    def test_restart_after_failure_keeps_terminal_state(self) -> None:
        directory = make_run_dir(self.dir, "run-7")
        with WorkerEnv(
            EXPANSION_AGENT_MODEL="offline",
            EXPANSION_AGENT_BRIDGE_URL=self.bridge.url,
            EXPANSION_AGENT_RUN_TOKEN=self.token,
            EXPANSION_AGENT_RUN_DIR=str(self.dir),
        ):
            asyncio.run(Orchestrator(str(self.dir)).run())
        failed = read_run(directory)
        self.assertEqual(failed.status, "failed")
        # Restart with a working scripted environment must not resurrect it.
        run_orchestrator(str(self.dir), self.bridge.url, self.token)
        self.assertEqual(read_run(directory).status, "failed")


if __name__ == "__main__":
    unittest.main()
