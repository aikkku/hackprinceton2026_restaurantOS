"""Cross-language contract tests: committed fixtures round-trip through the
Python Pydantic models; invalid fixtures are rejected. The TypeScript side
runs the same fixtures through its Zod schemas in agent.test.ts."""

from __future__ import annotations

import os
import unittest
from pathlib import Path

import pydantic

from restaurantos_worker.models import (
    AgentEvent,
    FinanceArtifact,
    InspectionArtifact,
    MarketArtifact,
    ProfileArtifact,
    SearchArtifact,
    SummaryArtifact,
)
from restaurantos_worker.testing import FIXTURES
from restaurantos_worker.validation import GroundingError, validate_summary_against_search

VALID = {
    "profile.sample.json": ProfileArtifact,
    "market.sample.json": MarketArtifact,
    "candidates.sample.json": SearchArtifact,
    "inspection.sample.json": InspectionArtifact,
    "finance.sample.json": FinanceArtifact,
    "summary.sample.json": SummaryArtifact,
}
INVALID = {
    "finance-negative-number.json": FinanceArtifact,
    "profile-revision-mismatch.json": ProfileArtifact,
    "summary-invalid-status.json": SummaryArtifact,
}


class ContractTests(unittest.TestCase):
    def test_valid_fixtures_parse(self) -> None:
        for name, model in VALID.items():
            with self.subTest(name=name):
                with open(FIXTURES / "contracts" / name, "r", encoding="utf-8") as handle:
                    model.model_validate_json(handle.read())

    def test_event_fixture_parses_in_order(self) -> None:
        path = FIXTURES / "contracts" / "events.sample.jsonl"
        with open(path, "r", encoding="utf-8") as handle:
            events = [AgentEvent.model_validate_json(line) for line in handle if line.strip()]
        self.assertEqual([event.seq for event in events], list(range(1, len(events) + 1)))
        self.assertEqual(events[0].type, "run.started")
        self.assertEqual(events[-1].type, "run.completed")

    def test_invalid_fixtures_rejected(self) -> None:
        for name, model in INVALID.items():
            with self.subTest(name=name):
                with open(FIXTURES / "invalid" / name, "r", encoding="utf-8") as handle:
                    with self.assertRaises(pydantic.ValidationError):
                        model.model_validate_json(handle.read())

    def test_invalid_event_type_rejected(self) -> None:
        path = FIXTURES / "invalid" / "event-bad-type.jsonl"
        with open(path, "r", encoding="utf-8") as handle:
            with self.assertRaises(pydantic.ValidationError):
                AgentEvent.model_validate_json(handle.read())

    def test_unknown_candidate_ids_rejected_cross_artifact(self) -> None:
        with open(FIXTURES / "contracts" / "candidates.sample.json", "r", encoding="utf-8") as handle:
            search = SearchArtifact.model_validate_json(handle.read())
        with open(FIXTURES / "invalid" / "summary-unknown-candidate-id.json", "r", encoding="utf-8") as handle:
            summary = SummaryArtifact.model_validate_json(handle.read())
        with self.assertRaises(GroundingError):
            validate_summary_against_search(summary, search)

    def test_valid_summary_grounds_against_search(self) -> None:
        with open(FIXTURES / "contracts" / "candidates.sample.json", "r", encoding="utf-8") as handle:
            search = SearchArtifact.model_validate_json(handle.read())
        with open(FIXTURES / "contracts" / "summary.sample.json", "r", encoding="utf-8") as handle:
            summary = SummaryArtifact.model_validate_json(handle.read())
        validate_summary_against_search(summary, search)

    def test_versions_are_pinned_literals(self) -> None:
        profile = ProfileArtifact.model_validate_json(
            (FIXTURES / "contracts" / "profile.sample.json").read_text(encoding="utf-8")
        )
        self.assertEqual(profile.artifactVersion, "expansion-agent-artifact-v1")
        self.assertEqual(profile.modelVersion, "expansion-requirements-v1")
        self.assertEqual(profile.intakeSchemaVersion, "1.0")


if __name__ == "__main__":
    unittest.main()
