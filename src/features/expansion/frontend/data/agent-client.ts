import {
  agentCapabilitiesSchema,
  agentRunRecordSchema,
  agentEventSchema,
  financeArtifactSchema,
  searchArtifactSchema,
  summaryArtifactSchema,
  type AgentArtifactName,
  type AgentEvent,
  type AgentRunRecord,
  type ExecutionMode,
} from "../../domain/agent.ts";
import type { RestaurantIntake } from "../../domain/intake.ts";
import type { CandidateFact } from "../../domain/matching.ts";
import type { z } from "zod";

export type AgentCapabilities = z.infer<typeof agentCapabilitiesSchema>;

export class AgentClientError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function request<T>(url: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && body.error &&
      typeof body.error === "object" && "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "The agent request failed.";
    const code =
      body && typeof body === "object" && "error" in body && body.error &&
      typeof body.error === "object" && "code" in body.error &&
      typeof body.error.code === "string"
        ? body.error.code
        : undefined;
    throw new AgentClientError(message, response.status, code);
  }
  return schema.parse(body);
}

export const loadAgentCapabilities = (signal?: AbortSignal): Promise<AgentCapabilities> =>
  request("/api/expansion/agent-capabilities", agentCapabilitiesSchema, signal);

export function createAgentRun(
  body: {
    runId: string;
    cityId: string;
    intake: RestaurantIntake;
    revisionId: string;
    revisionNumber: number;
    facts?: CandidateFact[];
    executionMode?: ExecutionMode;
  },
  signal?: AbortSignal,
): Promise<AgentRunRecord> {
  return postAgentRun(body, signal);
}

async function postAgentRun(
  body: unknown,
  signal?: AbortSignal,
): Promise<AgentRunRecord> {
  const response = await fetch("/api/expansion/agent-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
    cache: "no-store",
  });
  const parsed: unknown = await response.json();
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && parsed.error &&
      typeof parsed.error === "object" && "message" in parsed.error &&
      typeof parsed.error.message === "string"
        ? parsed.error.message
        : "The agent run request failed.";
    throw new AgentClientError(message, response.status);
  }
  return agentRunRecordSchema.parse(parsed);
}

export const getAgentRun = (runId: string, signal?: AbortSignal): Promise<AgentRunRecord> =>
  request(`/api/expansion/agent-runs/${encodeURIComponent(runId)}`, agentRunRecordSchema, signal);

export async function cancelAgentRun(runId: string, signal?: AbortSignal): Promise<AgentRunRecord> {
  const response = await fetch(`/api/expansion/agent-runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal,
    cache: "no-store",
  });
  const parsed: unknown = await response.json();
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed && parsed.error &&
      typeof parsed.error === "object" && "message" in parsed.error &&
      typeof parsed.error.message === "string"
        ? parsed.error.message
        : "The cancel request failed.";
    throw new AgentClientError(message, response.status);
  }
  return agentRunRecordSchema.parse(parsed);
}

export function getAgentArtifact<T extends AgentArtifactName>(runId: string, name: T, signal?: AbortSignal) {
  const schema =
    name === "summary" ? summaryArtifactSchema
    : name === "candidates" ? searchArtifactSchema
    : name === "finance" ? financeArtifactSchema
    : null;
  return request(`/api/expansion/agent-runs/${encodeURIComponent(runId)}/artifacts/${name}`, schema as z.ZodType, signal);
}

export type { AgentEvent, AgentRunRecord };

/**
 * Replayable SSE reader with reconnect-without-duplicates.
 * The server replays from the last seen sequence; this client additionally
 * drops any event whose seq was already applied.
 */
export function openAgentEventStream(
  runId: string,
  options: {
    afterSeq?: number;
    onEvent: (event: AgentEvent, isReplay: boolean) => void;
    onDone: (status: string) => void;
    onDisconnect: () => void;
  },
): { close: () => void; lastSeq: () => number } {
  let controller: AbortController | null = null;
  let closed = false;
  let lastSeq = options.afterSeq ?? 0;
  let reconnects = 0;

  const connect = async (isReconnect: boolean) => {
    if (closed) return;
    controller = new AbortController();
    const url = `/api/expansion/agent-runs/${encodeURIComponent(runId)}/events?after=${lastSeq}`;
    try {
      const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!response.ok || !response.body) {
        if (!closed) scheduleReconnect();
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      while (!closed && !done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const parsed = parseFrame(frame);
          if (parsed === null) continue;
          if (parsed.event === "done") {
            done = true;
            if (typeof parsed.data === "object" && parsed.data !== null && "status" in parsed.data) {
              options.onDone(String(parsed.data.status));
            }
            break;
          }
          const event = safeEvent(parsed.data);
          if (event && event.seq > lastSeq) {
            lastSeq = event.seq;
            options.onEvent(event, isReconnect);
          }
        }
      }
      if (!done && !closed) scheduleReconnect();
    } catch {
      if (!closed) scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnects >= 20) return;
    reconnects += 1;
    options.onDisconnect();
    setTimeout(() => {
      void connect(true);
    }, 1000);
  };

  void connect(false);

  return {
    close() {
      closed = true;
      controller?.abort();
    },
    lastSeq: () => lastSeq,
  };
}

function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
    else if (line.startsWith(":")) continue; // heartbeat comment
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return null;
  }
}

function safeEvent(value: unknown): AgentEvent | null {
  const parsed = agentEventSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
