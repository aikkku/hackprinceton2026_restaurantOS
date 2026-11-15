"""Run-scoped durable state: cancel flag, heartbeat and atomic JSON writes.

The run directory is owned by the worker while a run is active. Every file is
written atomically (temp + rename) and every artifact is validated by its
Pydantic model before it lands on disk. A cancelled flag written by the
Next.js cancel route is honored before and after every tool call and model
step.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any, TypeVar

from pydantic import BaseModel

M = TypeVar("M", bound=BaseModel)


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


def atomic_write_text(path: str, content: str) -> None:
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    temporary = f"{path}.tmp-{os.getpid()}"
    with open(temporary, "w", encoding="utf-8") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    # On Windows the destination may be held briefly by a concurrent reader
    # (the Next.js SSE/status readers); retry the replace for a short window.
    attempts = 0
    while True:
        try:
            os.replace(temporary, path)
            return
        except PermissionError:
            attempts += 1
            if attempts >= 10:
                raise
            time.sleep(0.05 * attempts)


def atomic_write_json(path: str, model: M) -> M:
    atomic_write_text(path, model.model_dump_json(indent=2))
    return model


class RunDirectory:
    """Files under one run dir: request.json, run.json, artifacts, events."""

    def __init__(self, run_dir: str, run_id: str):
        self.run_dir = run_dir
        self.run_id = run_id
        os.makedirs(run_dir, exist_ok=True)

    # -- paths --------------------------------------------------------------
    def path(self, name: str) -> str:
        return os.path.join(self.run_dir, name)

    @property
    def cancel_flag(self) -> str:
        return self.path("run.cancel")

    @property
    def heartbeat_file(self) -> str:
        return self.path("run.worker.json")

    # -- cancellation -------------------------------------------------------
    def is_cancelled(self) -> bool:
        return os.path.exists(self.cancel_flag)

    def mark_cancelled(self) -> None:
        atomic_write_text(self.cancel_flag, json.dumps({"cancelledAt": _now_iso()}))

    def heartbeat(self) -> None:
        atomic_write_text(
            self.heartbeat_file,
            json.dumps({"pid": os.getpid(), "updatedAt": _now_iso()}),
        )

    # -- validated artifact persistence -------------------------------------
    def read_artifact(self, name: str, model: type[M]) -> M:
        path = self.path(name)
        if not os.path.exists(path):
            raise FileNotFoundError(f"artifact {name} missing in run {self.run_id}")
        with open(path, "r", encoding="utf-8") as handle:
            return model.model_validate_json(handle.read())

    def write_artifact(self, name: str, model: M) -> M:
        path = self.path(name)
        atomic_write_json(path, model)
        return model

    def write_json(self, name: str, payload: dict[str, Any]) -> None:
        atomic_write_text(self.path(name), json.dumps(payload, indent=2))


def iso_now() -> str:
    return _now_iso()
