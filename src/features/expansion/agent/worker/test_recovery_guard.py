"""Phase 5: a server-recovered (terminal) run.json is never overwritten by a late worker."""

from __future__ import annotations

import unittest

from restaurantos_worker.orchestrator import Orchestrator
from restaurantos_worker.testing import make_run_dir, make_tmp_dir, read_events, read_run


class RecoveryGuardTests(unittest.TestCase):
    def test_late_worker_writes_never_replace_a_recovered_terminal(self) -> None:
        base = make_tmp_dir("recovery-")
        directory = make_run_dir(base, "run-guard")
        orchestrator = Orchestrator(str(base))
        # The worker is mid-run (in-memory status "running").
        orchestrator.record.status = "running"
        orchestrator._write_record()
        self.assertEqual(read_run(directory).status, "running")

        # The Next.js server recovers the run as failed (worker exit / stall).
        recovered = read_run(directory)
        recovered.status = "failed"
        recovered.error = {"code": "worker_exited", "message": "Recovered by the server."}
        directory.write_artifact("run.json", recovered)

        # A late progress update, a late "completed" terminal and its event
        # must not change the recovered record or claim success in the log.
        orchestrator._record_update({"type": "tool.completed", "stage": "market", "payload": {"tool": "market.context"}})
        orchestrator._terminal("completed")
        orchestrator._emit_terminal("run.completed", {"status": "completed"})
        final = read_run(directory)
        self.assertEqual(final.status, "failed")
        self.assertEqual(final.error.code if hasattr(final.error, "code") else final.error["code"], "worker_exited")
        self.assertIsNone(final.completedAt)
        self.assertFalse(any(event.type == "run.completed" for event in read_events(directory)))


if __name__ == "__main__":
    unittest.main()
