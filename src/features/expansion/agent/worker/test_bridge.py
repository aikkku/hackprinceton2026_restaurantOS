"""Tool bridge: bearer auth, unknown-tool rejection, retry policy, retry
budget, cancellation between attempts, and per-call timeout."""

from __future__ import annotations

import unittest
from pathlib import Path

from restaurantos_worker.bridge import BridgeError, RunCancelled, ToolBridge
from restaurantos_worker.runstate import RunDirectory
from restaurantos_worker.testing import FakeBridge, make_run_dir, make_tmp_dir


class BridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(make_tmp_dir("bridge-"))
        self.directory = make_run_dir(self.dir, "bridge-run")
        self.token = "bridge-token"
        self.bridge_server = FakeBridge(self.token, directory=self.directory).start()

    def tearDown(self) -> None:
        self.bridge_server.stop()

    def make_bridge(self, **kwargs) -> ToolBridge:
        return ToolBridge(
            base_url=self.bridge_server.url,
            run_id="bridge-run",
            token=self.token,
            directory=self.directory,
            **kwargs,
        )

    def test_wrong_token_unauthorized(self) -> None:
        bridge = ToolBridge(
            base_url=self.bridge_server.url,
            run_id="bridge-run",
            token="wrong-token",
            directory=self.directory,
        )
        with self.assertRaises(BridgeError) as caught:
            bridge.invoke("market.context", {"cityId": "Houston"})
        self.assertEqual(caught.exception.code, "unauthorized")

    def test_unknown_tool_rejected(self) -> None:
        bridge = self.make_bridge()
        with self.assertRaises(BridgeError) as caught:
            bridge.invoke("evil.shell", {"cmd": "dir"})
        self.assertEqual(caught.exception.code, "invalid_input")

    def test_unknown_tool_name_from_server(self) -> None:
        # The fake bridge also rejects tools it does not implement.
        bridge = self.make_bridge()
        with self.assertRaises(BridgeError) as caught:
            bridge.invoke("scout.search_city", {"cityId": "Houston"})
            bridge.invoke("made.up.tool", {})
        self.assertEqual(caught.exception.code, "invalid_input")

    def test_retry_then_success_within_budget(self) -> None:
        server = FakeBridge(self.token, fail_counts={"market.context": 2}, directory=self.directory).start()
        try:
            bridge = ToolBridge(
                base_url=server.url, run_id="bridge-run", token=self.token,
                directory=self.directory, max_retries=3, retry_backoff_s=0.05,
            )
            output = bridge.invoke("market.context", {"cityId": "Houston"})
            self.assertTrue(output.get("sourced"))
            self.assertEqual(server.calls["market.context"], 3)
        finally:
            server.stop()

    def test_retry_budget_exhausted_honest_error(self) -> None:
        server = FakeBridge(self.token, fail_tools={"market.context": (503, "bridge_busy", "down")}, directory=self.directory).start()
        try:
            bridge = ToolBridge(
                base_url=server.url, run_id="bridge-run", token=self.token,
                directory=self.directory, max_retries=2, retry_backoff_s=0.05,
            )
            with self.assertRaises(BridgeError) as caught:
                bridge.invoke("market.context", {"cityId": "Houston"})
            self.assertEqual(caught.exception.code, "bridge_busy")
            self.assertEqual(server.calls["market.context"], 3)  # 1 + 2 retries
        finally:
            server.stop()

    def test_unreachable_bridge_error(self) -> None:
        server = FakeBridge(self.token).start()
        port = server.port
        server.stop()
        bridge = ToolBridge(
            base_url=f"http://127.0.0.1:{port}", run_id="bridge-run",
            token=self.token, directory=self.directory,
            max_retries=1, retry_backoff_s=0.05,
        )
        with self.assertRaises(BridgeError) as caught:
            bridge.invoke("market.context", {"cityId": "Houston"})
        self.assertEqual(caught.exception.code, "bridge_unreachable")

    def test_cancel_flag_raises_before_call(self) -> None:
        self.directory.mark_cancelled()
        bridge = self.make_bridge()
        with self.assertRaises(RunCancelled):
            bridge.invoke("market.context", {"cityId": "Houston"})
        self.assertEqual(self.bridge_server.calls.get("market.context", 0), 0)

    def test_timeout_raises_honest_error(self) -> None:
        server = FakeBridge(self.token, slow={"scout.search_city": 3.0}, directory=self.directory).start()
        try:
            bridge = ToolBridge(
                base_url=server.url, run_id="bridge-run", token=self.token,
                directory=self.directory, default_timeout_s=0.4,
                max_retries=0,
            )
            with self.assertRaises(BridgeError) as caught:
                bridge.invoke("scout.search_city", {"cityId": "Houston"})
            self.assertIn(caught.exception.code, ("bridge_unreachable", "bridge_failed"))
        finally:
            server.stop()

    def test_bounded_timeout_cap(self) -> None:
        bridge = ToolBridge(
            base_url=self.bridge_server.url, run_id="bridge-run",
            token=self.token, directory=self.directory, default_timeout_s=99999,
        )
        self.assertLessEqual(bridge.default_timeout_s, 240.0)


if __name__ == "__main__":
    unittest.main()
