import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_VERSION, bridgeRequestSchema, agentEventSchema, encodeSSE, replayEvents } from "./domain/agent.ts";
import { requiredSalesTool, occupancyRangeToolOutputSchema } from "./domain/tools.ts";
import { marketProviderResultSchema } from "./domain/agent-providers.ts";

const fixture = JSON.parse(readFileSync(new URL("./agent/fixtures/contract.json", import.meta.url), "utf8"));
test("Python/TypeScript shared fixture and existing canonical finance contracts", () => {
  assert.deepEqual(bridgeRequestSchema.parse(fixture.request), fixture.request);
  assert.deepEqual(requiredSalesTool.invoke(fixture.salesInput), fixture.salesOutput);
  assert.deepEqual(occupancyRangeToolOutputSchema.parse(fixture.occupancyOutput), fixture.occupancyOutput);
  assert.throws(() => bridgeRequestSchema.parse({...fixture.request, url: "https://invalid.test"}));
  assert.throws(() => bridgeRequestSchema.parse({...fixture.request, operation: "shell"}));
  assert.throws(() => bridgeRequestSchema.parse({...fixture.request, scope: {...fixture.request.scope, runId: "../other"}}));
  assert.throws(() => marketProviderResultSchema.parse({status:"available", context:[]}));
});
test("SSE replay has stable monotonic IDs, no duplicates and rejects future cursors", () => {
  const events = [1,2,3].map((seq) => agentEventSchema.parse({version:AGENT_VERSION, runId:"synthetic", seq, at:"2026-11-15T00:00:00Z", type:"tool_completed", stage:"finance", message:"Validated tool output."}));
  assert.deepEqual(replayEvents(events, 1).map((event) => event.seq), [2,3]);
  assert.deepEqual(replayEvents(events, 3), []);
  assert.match(encodeSSE(events[1]), /^id: 2\nevent: progress\ndata: /);
  assert.throws(() => replayEvents(events, 4));
  assert.throws(() => replayEvents(events, -1));
});
