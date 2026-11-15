"""Replayable JSONL event log with strictly increasing sequence numbers.

One line per event, appended atomically. Readers resume from any sequence
number by scanning once and returning only events with seq > last_seen,
which is what the Next.js SSE bridge uses for reconnect-without-duplicates.
"""

from __future__ import annotations

import os
import threading
import time

from .models import AgentEvent

_LOCK = threading.Lock()


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


class EventLog:
    def __init__(self, path: str):
        self.path = path

    def append(self, event: AgentEvent) -> AgentEvent:
        """Append one validated event; seq is assigned by the log, never the caller."""
        if event.seq != 0:
            raise ValueError("event.seq is assigned by the log")
        with _LOCK:
            last = self._last_seq_unlocked()
            event.seq = last + 1
            if event.ts is None:
                event.ts = _now_iso()
            line = event.model_dump_json() + "\n"
            with open(self.path, "a", encoding="utf-8") as handle:
                handle.write(line)
                handle.flush()
                os.fsync(handle.fileno())
        return event

    def _last_seq_unlocked(self) -> int:
        if not os.path.exists(self.path):
            return 0
        last = 0
        with open(self.path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = AgentEvent.model_validate_json(line)
                except Exception:  # a torn trailing line must never block the run
                    continue
                if event.ts is None:
                    continue
                last = max(last, event.seq)
        return last

    def last_seq(self) -> int:
        with _LOCK:
            return self._last_seq_unlocked()

    def read(self, after_seq: int = 0) -> list[AgentEvent]:
        """Return validated events with seq > after_seq, in order, no duplicates."""
        if not os.path.exists(self.path):
            return []
        events: list[AgentEvent] = []
        seen: set[int] = set()
        with _LOCK:
            with open(self.path, "r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        event = AgentEvent.model_validate_json(line)
                    except Exception:
                        continue
                    if event.ts is None:
                        continue
                    if event.seq > after_seq and event.seq not in seen:
                        seen.add(event.seq)
                        events.append(event)
        events.sort(key=lambda item: item.seq)
        return events

    def read_all(self) -> list[AgentEvent]:
        return self.read(0)


def read_events(path: str, after_seq: int = 0) -> list[AgentEvent]:
    return EventLog(path).read(after_seq)
