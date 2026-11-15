import {
  agentRunRecordSchema,
  agentEventSchema,
} from "../../../../../../features/expansion/domain/agent.ts";
import {
  getAgentRun,
  readAgentEvents,
} from "../../../../../../features/expansion/backend/agent.ts";
import { localFailure } from "../../../../../../features/expansion/backend/http.ts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentEvent } from "../../../../../../features/expansion/domain/agent.ts";

export const dynamic = "force-dynamic";

const POLL_MS = 500;
const HEARTBEAT_MS = 15000;

function sseFrame(id: number, type: string, data: unknown): string {
  return `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function eventsFileFor(sessionId: string, runId: string): string {
  const root = process.env.EXPANSION_AGENT_RUNS_DIR ?? process.env.EXPANSION_RUNS_DIR ?? "src/features/expansion/data/data/runs";
  return resolve(process.cwd(), root, sessionId, `agent-${runId}`, "events.jsonl");
}

function readTail(path: string, offset: number): { events: AgentEvent[]; offset: number } {
  if (!existsSync(path)) return { events: [], offset };
  const events: AgentEvent[] = [];
  const lines = readFileSync(path, "utf8").split("\n");
  let current = 0;
  for (const line of lines) {
    current += line.length + 1;
    if (current <= offset) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(agentEventSchema.parse(JSON.parse(trimmed)));
    } catch {
      // torn line: wait for the next poll
    }
  }
  return { events, offset: current };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const headerSession = request.headers.get("x-expansion-session");
  const sessionId = headerSession ?? url.searchParams.get("session") ?? "local";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sessionId)) {
    return localFailure(Object.assign(new Error("invalid session"), { code: "invalid_run" }));
  }
  let afterSeq = 0;
  const lastEventId = request.headers.get("last-event-id");
  const afterParam = url.searchParams.get("after");
  if (lastEventId && /^\d+$/.test(lastEventId)) afterSeq = Number(lastEventId);
  else if (afterParam && /^\d+$/.test(afterParam)) afterSeq = Number(afterParam);

  let record;
  try {
    record = agentRunRecordSchema.parse(getAgentRun({}, sessionId, id));
  } catch (error) {
    return localFailure(error);
  }

  const path = eventsFileFor(sessionId, id);
  const encoder = new TextEncoder();
  const terminalStatuses = new Set(["completed", "completed_with_gaps", "failed", "cancelled"]);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let offset = 0;
      let closed = false;
      let lastHeartbeat = Date.now();
      let timer: ReturnType<typeof setTimeout> | null = null;

      const send = (frame: string) => {
        try {
          controller.enqueue(encoder.encode(frame));
        } catch {
          close();
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const tick = () => {
        if (closed) return;
        try {
          const tail = readTail(path, offset);
          offset = tail.offset;
          for (const event of tail.events) send(sseFrame(event.seq, event.type, event));
          const size = existsSync(path) ? statSync(path).size : 0;
          if (tail.events.length === 0 && existsSync(path) && offset < size) {
            // File shrank or was rewritten; rescan from the start but keep
            // the sequence filter so no duplicate is ever emitted.
            offset = 0;
          }
          let current: unknown = null;
          try {
            current = agentRunRecordSchema.parse(JSON.parse(readFileSync(path.replace("events.jsonl", "run.json"), "utf8")));
          } catch {
            current = null;
          }
          const status = current && typeof current === "object" && "status" in current
            ? String(current.status)
            : null;
          if (status && terminalStatuses.has(status)) {
            send(`event: done\ndata: ${JSON.stringify({ status, runId: id })}\n\n`);
            close();
            return;
          }
          if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            lastHeartbeat = Date.now();
            send(": ping\n\n");
          }
        } catch {
          /* poll errors never kill the stream */
        }
        if (!closed) timer = setTimeout(tick, POLL_MS);
      };

      // Replay everything after the client's last seen sequence.
      const replayed = readAgentEvents({}, sessionId, id, afterSeq);
      for (const event of replayed.events) send(sseFrame(event.seq, event.type, event));
      if (terminalStatuses.has(record.status)) {
        send(`event: done\ndata: ${JSON.stringify({ status: record.status, runId: id })}\n\n`);
        close();
        return;
      }
      timer = setTimeout(tick, POLL_MS);

      request.signal.addEventListener("abort", close);
    },
    cancel() {
      /* reader cancelled; abort listener closes the controller */
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
