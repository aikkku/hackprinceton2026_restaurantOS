"""Timeout, cancellation mid-run and partial provider/bridge failure."""

from __future__ import annotations

import asyncio
import threading
import time
import unittest

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


class CancelTimeoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = make_tmp_dir("cancel-")
        self.token = "cancel-token"

    def test_cancellation_mid_tool(self) -> None:
        bridge = FakeBridge(self.token, slow={"scout.search_city": 2.0}).start()
        try:
            directory = make_run_dir(self.dir, "run-1")
            env = WorkerEnv(
                EXPANSION_AGENT_MODEL="scripted",
                EXPANSION_AGENT_SCRIPT=str(SCRIPT),
                EXPANSION_AGENT_BRIDGE_URL=bridge.url,
                EXPANSION_AGENT_RUN_TOKEN=self.token,
                EXPANSION_AGENT_RUN_DIR=str(self.dir),
            )
            env.__enter__()

            def cancel_soon() -> None:
                time.sleep(0.5)
                directory.mark_cancelled()

            thread = threading.Thread(target=cancel_soon, daemon=True)
            thread.start()
            code = asyncio.run(Orchestrator(str(self.dir)).run())
            thread.join(timeout=5)
            env.__exit__(None, None, None)

            self.assertEqual(code, 2)
            record = read_run(directory)
            self.assertEqual(record.status, "cancelled")
            self.assertIsNotNone(record.cancelledAt)
            self.assertIsNone(record.completedAt)
            events = read_events(directory)
            self.assertEqual(events[-1].type, "run.cancelled")
            # Terminal immutability: cancellation can never flip back.
            for _ in range(3):
                asyncio.run(Orchestrator(str(self.dir)).run())
            self.assertEqual(read_run(directory).status, "cancelled")
        finally:
            bridge.stop()

    def test_cancel_before_start(self) -> None:
        bridge = FakeBridge(self.token).start()
        try:
            directory = make_run_dir(self.dir, "run-2")
            directory.mark_cancelled()
            env = WorkerEnv(
                EXPANSION_AGENT_MODEL="scripted",
                EXPANSION_AGENT_SCRIPT=str(SCRIPT),
                EXPANSION_AGENT_BRIDGE_URL=bridge.url,
                EXPANSION_AGENT_RUN_TOKEN=self.token,
                EXPANSION_AGENT_RUN_DIR=str(self.dir),
            )
            env.__enter__()
            try:
                code = asyncio.run(Orchestrator(str(self.dir)).run())
            finally:
                env.__exit__(None, None, None)
            self.assertEqual(code, 2)
            record = read_run(directory)
            self.assertEqual(record.status, "cancelled")
            events = read_events(directory)
            self.assertEqual(events[-1].type, "run.cancelled")
        finally:
            bridge.stop()

    def test_run_timeout_budget(self) -> None:
        bridge = FakeBridge(self.token, slow={"scout.search_city": 6.0}).start()
        try:
            directory = make_run_dir(self.dir, "run-3")
            env = WorkerEnv(
                EXPANSION_AGENT_MODEL="scripted",
                EXPANSION_AGENT_SCRIPT=str(SCRIPT),
                EXPANSION_AGENT_BRIDGE_URL=bridge.url,
                EXPANSION_AGENT_RUN_TOKEN=self.token,
                EXPANSION_AGENT_RUN_DIR=str(self.dir),
                EXPANSION_AGENT_RUN_TIMEOUT_S="2",
            )
            env.__enter__()
            try:
                code = asyncio.run(Orchestrator(str(self.dir)).run())
            finally:
                env.__exit__(None, None, None)
            self.assertEqual(code, 3)
            record = read_run(directory)
            self.assertEqual(record.status, "failed")
            self.assertEqual(record.error.code, "run_timeout")
            events = read_events(directory)
            self.assertEqual(events[-1].type, "run.failed")
            self.assertEqual(events[-1].payload["code"], "run_timeout")
        finally:
            bridge.stop()

    def test_partial_bridge_failure_fails_run_honestly(self) -> None:
        bridge = FakeBridge(
            self.token,
            fail_tools={"market.context": (503, "source_failure", "market source down")},
        ).start()
        try:
            directory = make_run_dir(self.dir, "run-4")
            env = WorkerEnv(
                EXPANSION_AGENT_MODEL="scripted",
                EXPANSION_AGENT_SCRIPT=str(SCRIPT),
                EXPANSION_AGENT_BRIDGE_URL=bridge.url,
                EXPANSION_AGENT_RUN_TOKEN=self.token,
                EXPANSION_AGENT_RUN_DIR=str(self.dir),
            )
            env.__enter__()
            try:
                code = asyncio.run(Orchestrator(str(self.dir)).run())
            finally:
                env.__exit__(None, None, None)
            self.assertEqual(code, 3)
            record = read_run(directory)
            self.assertEqual(record.status, "failed")
            self.assertEqual(record.error.code, "model_or_framework_failed")
        finally:
            bridge.stop()

    def test_run_without_token_never_touches_bridge(self) -> None:
        bridge = FakeBridge(self.token).start()
        try:
            directory = make_run_dir(self.dir, "run-5")
            env = WorkerEnv(
                EXPANSION_AGENT_MODEL="scripted",
                EXPANSION_AGENT_SCRIPT=str(SCRIPT),
                EXPANSION_AGENT_BRIDGE_URL=bridge.url,
                EXPANSION_AGENT_RUN_TOKEN="wrong-token",
                EXPANSION_AGENT_RUN_DIR=str(self.dir),
            )
            env.__enter__()
            try:
                code = asyncio.run(Orchestrator(str(self.dir)).run())
            finally:
                env.__exit__(None, None, None)
            self.assertEqual(code, 3)
            self.assertEqual(sum(bridge.calls.values()), 0)
            self.assertEqual(read_run(directory).status, "failed")
        finally:
            bridge.stop()


if __name__ == "__main__":
    unittest.main()
