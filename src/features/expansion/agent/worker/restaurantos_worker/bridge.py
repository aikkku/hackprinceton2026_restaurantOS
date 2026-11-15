"""Narrow authenticated bridge to the TypeScript tool boundary.

The worker never performs matching or financial arithmetic itself: every
canonical tool call crosses this bridge to the Next.js route
``POST /api/expansion/agent-tools`` with a run-scoped bearer token. The bridge
is bounded: one allowlisted tool per request, JSON only, per-call timeouts, a
retry budget for transient failures, and cancellation honored between
attempts.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any, Callable

from .runstate import RunDirectory


class BridgeError(Exception):
    """A tool-bridge failure. `code` matches the TypeScript error envelope."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class RunCancelled(Exception):
    """Raised when the run's cancel flag is set."""


RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
RETRYABLE_NETWORK = (urllib.error.URLError, TimeoutError, ConnectionError, OSError)

DEFAULT_TIMEOUT_S = 60.0
MAX_TIMEOUT_S = 240.0


class ToolBridge:
    def __init__(
        self,
        base_url: str,
        run_id: str,
        token: str,
        directory: RunDirectory,
        *,
        default_timeout_s: float = DEFAULT_TIMEOUT_S,
        max_retries: int = 2,
        retry_backoff_s: float = 0.8,
        total_retry_budget_s: float = 30.0,
    ):
        if not base_url or "://" not in base_url:
            raise BridgeError("bridge_config", "The tool bridge URL is invalid.")
        if not run_id or not token:
            raise BridgeError("bridge_config", "The run id and tool token are required.")
        self.base_url = base_url.rstrip("/")
        self.run_id = run_id
        self.token = token
        self.directory = directory
        self.default_timeout_s = min(default_timeout_s, MAX_TIMEOUT_S)
        self.max_retries = max_retries
        self.retry_backoff_s = retry_backoff_s
        self.total_retry_budget_s = total_retry_budget_s
        # Phase 5: the owner id the server bound to this run (request.json).
        # The server verifies the token inside that owner's run directory.
        self.session_id: str | None = None

    def cancelled_check(self) -> None:
        if self.directory.is_cancelled():
            raise RunCancelled(f"run {self.run_id} was cancelled")

    def invoke(self, tool: str, input_payload: dict[str, Any], timeout_s: float | None = None) -> Any:
        """Invoke one allowlisted TypeScript tool. Returns the parsed output.

        Raises BridgeError with a stable code on failure; RunCancelled when the
        run is cancelled. Retries only transient failures within a budget.
        """
        self.cancelled_check()
        if not tool or not isinstance(tool, str) or len(tool) > 120:
            raise BridgeError("invalid_input", "Invalid tool name.")
        timeout = min(timeout_s or self.default_timeout_s, MAX_TIMEOUT_S)
        envelope: dict[str, Any] = {"runId": self.run_id, "tool": tool, "input": input_payload}
        if self.session_id:
            envelope["sessionId"] = self.session_id
        body = json.dumps(envelope).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/expansion/agent-tools",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
            },
        )
        deadline = time.monotonic() + self.total_retry_budget_s
        attempts = 0
        while True:
            self.cancelled_check()
            attempts += 1
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    raw = response.read()
                try:
                    payload = json.loads(raw.decode("utf-8"))
                except json.JSONDecodeError as error:
                    raise BridgeError("bridge_failed", "The tool bridge returned invalid JSON.") from error
                if not isinstance(payload, dict) or "ok" not in payload:
                    raise BridgeError("bridge_failed", "The tool bridge returned an invalid envelope.")
                if payload["ok"] is True:
                    return payload.get("output")
                error = payload.get("error") or {}
                raise BridgeError(
                    str(error.get("code") or "bridge_failed"),
                    str(error.get("message") or "The tool failed."),
                )
            except urllib.error.HTTPError as error:
                code = getattr(error, "code", 0)
                server_code = "bridge_failed"
                message = f"Tool bridge HTTP {code}."
                try:
                    parsed = json.loads(error.read().decode("utf-8") or "{}")
                    if isinstance(parsed, dict) and isinstance(parsed.get("error"), dict):
                        server_code = str(parsed["error"].get("code") or server_code)
                        message = str(parsed["error"].get("message") or message)
                except Exception:
                    pass
                if server_code == "bridge_failed" and code in (401, 403):
                    server_code = "unauthorized"
                bridge_error = BridgeError(server_code, message)
                if code not in RETRYABLE_STATUS or attempts > self.max_retries or time.monotonic() > deadline:
                    raise bridge_error
                self._backoff(attempts, deadline)
            except RETRYABLE_NETWORK as error:
                if attempts > self.max_retries or time.monotonic() > deadline:
                    raise BridgeError("bridge_unreachable", f"The tool bridge is unreachable: {error.__class__.__name__}.") from error
                self._backoff(attempts, deadline)

    def _backoff(self, attempts: int, deadline: float) -> None:
        wait = self.retry_backoff_s * (2 ** (attempts - 1))
        if time.monotonic() + wait > deadline:
            raise BridgeError("bridge_failed", "The tool bridge retry budget was exhausted.")
        time.sleep(wait)
        self.cancelled_check()


def cancel_checker(directory: RunDirectory) -> Callable[[], None]:
    def check() -> None:
        if directory.is_cancelled():
            raise RunCancelled(f"run {directory.run_id} was cancelled")

    return check
