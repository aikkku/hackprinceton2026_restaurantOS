"""Worker entry point.

Usage (spawned by the Next.js agent service):

    <venv-python> -m restaurantos_worker.cli run --run-dir <runDir>

Environment names (values never logged):
- EXPANSION_AGENT_RUN_TOKEN      run-scoped tool-bridge bearer token
- EXPANSION_AGENT_BRIDGE_URL     base URL of the Next.js tool bridge
- EXPANSION_AGENT_MODEL          live | scripted | offline
- EXPANSION_AGENT_SCRIPT         script file for scripted mode
- EXPANSION_AGENT_PROVIDER       anthropic | openai (live mode)
- EXPANSION_AGENT_MODEL_ID       provider model id (live mode)
- EXPANSION_AGENT_RUN_TIMEOUT_S  total run deadline (default 900)
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from .orchestrator import Orchestrator


def main() -> int:
    parser = argparse.ArgumentParser(prog="restaurantos-worker")
    sub = parser.add_subparsers(dest="command", required=True)
    run_parser = sub.add_parser("run", help="execute one agent run from a run directory")
    run_parser.add_argument("--run-dir", required=True, help="run directory containing request.json and run.json")
    args = parser.parse_args()
    if args.command != "run":
        parser.error("unknown command")
    orchestrator = Orchestrator(args.run_dir)
    try:
        return asyncio.run(orchestrator.run())
    except KeyboardInterrupt:
        return 130
    except Exception as error:  # noqa: BLE001 — crash-safe honest terminal
        from .orchestrator import _log_worker_error, REDACTED_FAILURE, REDACTED_MESSAGE
        try:
            orchestrator._terminal("failed", REDACTED_FAILURE, REDACTED_MESSAGE)
            orchestrator._emit_terminal("run.failed", {"code": "worker_crashed"})
        except Exception:
            pass  # even the terminal write may be impossible; stale recovery covers it
        _log_worker_error(args.run_dir, error)
        return 3


if __name__ == "__main__":
    sys.exit(main())
