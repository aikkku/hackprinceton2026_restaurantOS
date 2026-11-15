"""Event log: strict sequence numbers, replay after a sequence, no duplicates."""

from __future__ import annotations

import unittest
from pathlib import Path

from restaurantos_worker.eventlog import EventLog
from restaurantos_worker.models import AgentEvent
from restaurantos_worker.testing import make_tmp_dir


def event(type_: str, stage: str | None = None) -> AgentEvent:
    return AgentEvent(
        eventVersion="expansion-agent-event-v1",
        seq=0,
        runId="run-1",
        type=type_,
        stage=stage,
        payload=None,
    )


class EventLogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = make_tmp_dir("events-")
        self.log = EventLog(str(self.dir / "events.jsonl"))

    def test_sequence_strictly_increasing(self) -> None:
        first = self.log.append(event("run.started"))
        second = self.log.append(event("stage.started", "readiness"))
        third = self.log.append(event("run.completed"))
        self.assertEqual((first.seq, second.seq, third.seq), (1, 2, 3))
        self.assertEqual(self.log.last_seq(), 3)

    def test_replay_after_seq_excludes_seen(self) -> None:
        self.log.append(event("run.started"))
        self.log.append(event("stage.started", "readiness"))
        self.log.append(event("run.completed"))
        tail = self.log.read(after_seq=1)
        self.assertEqual([item.seq for item in tail], [2, 3])
        tail2 = self.log.read(after_seq=3)
        self.assertEqual(tail2, [])

    def test_replay_never_duplicates(self) -> None:
        for index in range(5):
            self.log.append(event("tool.completed", "readiness"))
        seen = self.log.read(after_seq=0)
        self.assertEqual(len(seen), 5)
        again = self.log.read(after_seq=2)
        self.assertEqual(len(again), 3)
        self.assertEqual(len({item.seq for item in [*seen, *again]}), 5)

    def test_torn_trailing_line_skipped(self) -> None:
        self.log.append(event("run.started"))
        with open(self.log.path, "a", encoding="utf-8") as handle:
            handle.write('{"eventVersion": "expansion-agent-event-v1", "seq": 2, "ru')
        self.assertEqual(self.log.last_seq(), 1)
        tail = self.log.read(after_seq=0)
        self.assertEqual([item.seq for item in tail], [1])

    def test_caller_cannot_assign_seq(self) -> None:
        forged = event("run.started")
        forged.seq = 99
        with self.assertRaises(ValueError):
            self.log.append(forged)


if __name__ == "__main__":
    unittest.main()
