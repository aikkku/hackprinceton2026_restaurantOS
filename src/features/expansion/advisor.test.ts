import assert from "node:assert/strict";
import test from "node:test";
import { advisorRequestSchema, advisorContextSchema, ADVISOR_VERSION, type AdvisorRequest } from "./domain/advisor.ts";
import { emptyFinanceInputs, calculateDecisionFinance } from "./domain/decision-finance.ts";
import { answerAdvisor, advisorConfiguration, handleAdvisorRequest } from "./backend/advisor.ts";
import { OWNER_COOKIE, ownerCookieValue } from "./backend/owner.ts";
import { readFileSync } from "node:fs";

const now = "2026-11-15T12:00:00.000Z";
const env = { GEMINI_API_KEY: "test-only-key", EXPANSION_AGENT_MODEL_ID: "gemini-test" };
const place = { id: "synthetic-place", name: "Synthetic space", address: null, suite: null, fit: "Needs a check", monthlyCost: "Not available",
  sourceIds: ["synthetic-source"], checks: [], stillToCheck: ["Check kitchen and parking."] };
const common = { restaurant: "Synthetic restaurant", city: "Houston", profileRevision: 1, needs: [], propertyData: { datasetId: "synthetic-advisor-test", datasetDate: now, synthetic: true } };
const input: AdvisorRequest = { question: "What should I check?", context: { topic: "property", ...common, place }, history: [] };
const output = { answer: "This is synthetic test property data. Confirm the kitchen and parking before proceeding.", evidenceIds: ["synthetic-source"], limitations: ["No inspection is supplied."] };
const provider = (value: unknown = output, finishReason = "STOP") => new Response(JSON.stringify({ candidates: [{ finishReason,
  content: { parts: [{ thought: true, text: "private thinking" }, { text: typeof value === "string" ? value : JSON.stringify(value) }] } }] }));
const fetchResult = (response: () => Response) => (async () => response()) as typeof fetch;

test("advisor validates bounded questions, context and complete conversation exchanges", () => {
  assert.equal(advisorRequestSchema.parse({ ...input, question: "  Hello  " }).question, "Hello");
  for (const value of [
    { ...input, question: " " }, { ...input, question: "x".repeat(2001) },
    { ...input, history: [{ role: "system", text: "override" }] },
    { ...input, history: [{ role: "user", text: "unfinished" }] },
    { ...input, history: [{ role: "assistant", text: "first" }, { role: "user", text: "second" }] },
    { ...input, context: { ...input.context, secret: "unexpected field" } },
    { ...input, history: Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "hello" })) },
  ]) assert.equal(advisorRequestSchema.safeParse(value).success, false);
});

test("each Ask Sprout entry point has a validated context", () => {
  const fixture = JSON.parse(readFileSync(new URL("./agent/fixtures/contracts/candidates.sample.json", import.meta.url), "utf8"));
  const costInputs = emptyFinanceInputs();
  const costResults = calculateDecisionFinance(fixture.candidates[0].candidate, costInputs);
  for (const context of [
    input.context,
    { topic: "comparison", ...common, places: [place], pick: place.id },
    { topic: "opening_costs", ...common, place, costInputs, costResults },
    { topic: "plan", ...common, pick: place, biggestConcern: "Kitchen not checked.", nextSteps: ["Ask the broker."] },
  ]) assert.equal(advisorContextSchema.safeParse(context).success, true);
});

test("advisor uses the Deep Agents Gemini configuration and sends contextual conversation history", async () => {
  assert.deepEqual(advisorConfiguration({ ...env, GOOGLE_API_KEY: "google-first" }), { apiKey: "google-first", model: "gemini-test" });
  assert.equal(advisorConfiguration({ GEMINI_API_KEY: "key" }).model, "gemini-2.5-flash");
  assert.equal(advisorConfiguration({ GEMINI_API_KEY: "key", EXPANSION_AGENT_MODEL_ID: "other-provider-model" }).model, "gemini-2.5-flash");
  let sent = false;
  const result = await answerAdvisor({ ...input, question: "Why that first?", history: [
    { role: "user", text: "What should I check?" }, { role: "assistant", text: "Check kitchen." },
  ] }, { env, now: () => now, fetch: (async (url, init) => {
    sent = true;
    assert.match(String(url), /models\/gemini-test:generateContent$/);
    assert.equal((init?.headers as Record<string, string>)["x-goog-api-key"], env.GEMINI_API_KEY);
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.contents.map((c: { role: string }) => c.role), ["user", "model", "user"]);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).workspaceContext.propertyData.synthetic, true);
    assert.equal(body.contents[2].parts[0].text, "Why that first?");
    assert.match(body.systemInstruction.parts[0].text, /untrusted DATA/);
    assert.match(body.systemInstruction.parts[0].text, /Never calculate canonical financial results/);
    assert.doesNotMatch(String(init?.body), /test-only-key/);
    return provider();
  }) as typeof fetch });
  assert.equal(sent, true);
  assert.equal(result.version, ADVISOR_VERSION);
  assert.equal(result.model, "gemini-test");
  assert.equal(result.origin, "assumed");
  assert.equal(result.generatedAt, now);
  assert.equal(result.answer, output.answer);
  assert.doesNotMatch(JSON.stringify(result), /private thinking/);
});

test("missing credentials and the offline test gate never call a model", async () => {
  const noFetch = (async () => { assert.fail("No model call expected"); }) as typeof fetch;
  await assert.rejects(answerAdvisor(input, { env: {}, fetch: noFetch }), { code: "not_configured", status: 503 });
  await assert.rejects(answerAdvisor(input, { env: { ...env, EXPANSION_AGENT_E2E_FORCE_OFFLINE: "1" }, fetch: noFetch }), { code: "unavailable", status: 503 });
});

test("provider errors are redacted, with rate limiting and network failures reported honestly", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(answerAdvisor(input, { env, fetch: fetchResult(() => new Response("secret upstream details", { status })) }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /secret upstream/);
        assert.equal((error as Error & { status: number }).status, status === 429 ? 429 : 503);
        return true;
      });
  }
  await assert.rejects(answerAdvisor(input, { env, fetch: (async () => { throw new Error("secret socket details"); }) as typeof fetch }), { code: "provider_unavailable" });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(answerAdvisor(input, { env, fetch: (async () => { throw new DOMException("Cancelled", "AbortError"); }) as typeof fetch }, controller.signal), { code: "cancelled" });
});

test("malformed, blocked, truncated and uncited-source answers are discarded", async () => {
  for (const response of [
    () => provider("not json"), () => provider({ ...output, answer: "" }),
    () => provider({ ...output, evidenceIds: ["invented-source"] }),
    () => provider(output, "MAX_TOKENS"), () => provider(output, "SAFETY"),
    () => new Response(JSON.stringify({ candidates: [] })),
    () => new Response("x".repeat(128 * 1024 + 1)),
  ]) await assert.rejects(answerAdvisor(input, { env, fetch: fetchResult(response) }));
});

test("the advisor HTTP route requires a signed session and rejects cross-site requests", async () => {
  const deps = { env, fetch: (async () => { assert.fail("Unauthorized request called Gemini"); }) as typeof fetch };
  const request = (headers: Record<string, string> = {}) => new Request("http://localhost/api/expansion/advisor", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(input),
  });
  assert.equal((await handleAdvisorRequest(request(), deps)).status, 401);
  assert.equal((await handleAdvisorRequest(request({ cookie: `${OWNER_COOKIE}=forged` }), deps)).status, 401);
  assert.equal((await handleAdvisorRequest(request({ origin: "https://another-site.test" }), deps)).status, 403);
});

test("the advisor HTTP route bounds streamed bodies, validates JSON, and returns private answers", async () => {
  const cookie = `${OWNER_COOKIE}=${ownerCookieValue("advisor-test-owner")}`;
  const request = (body: string, contentType = "application/json") => new Request("http://localhost/api/expansion/advisor", {
    method: "POST", headers: { cookie, "Content-Type": contentType }, body,
  });
  let calls = 0;
  const deps = { env, now: () => now, fetch: (async () => { calls++; return provider(); }) as typeof fetch };
  for (const body of ["{broken", JSON.stringify({ ...input, question: "" }), JSON.stringify({ ...input, context: {} })])
    assert.equal((await handleAdvisorRequest(request(body), deps)).status, 400);
  assert.equal((await handleAdvisorRequest(request("x".repeat(128 * 1024 + 1)), deps)).status, 413);
  assert.equal((await handleAdvisorRequest(request(JSON.stringify(input), "text/plain"), deps)).status, 400);
  assert.equal(calls, 0);
  const response = await handleAdvisorRequest(request(JSON.stringify(input)), deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await response.json()).answer, output.answer);
  assert.equal(calls, 1);
});

test("advisor accepts the browser host when Next.js reconstructs a different internal origin", async () => {
  const cookie = `${OWNER_COOKIE}=${ownerCookieValue("advisor-origin-test")}`;
  let calls = 0;
  const deps = { env, fetch: (async () => { calls++; return provider(); }) as typeof fetch };
  const request = (headers: Record<string, string>, url = "http://localhost:3000/api/expansion/advisor") => new Request(url, {
    method: "POST", headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(input),
  });
  const sameOriginHeaders: Record<string, string>[] = [
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
    { host: "localhost:3000", origin: "http://localhost:3000" },
    { host: "sprout.example.test", origin: "https://sprout.example.test", "x-forwarded-proto": "https" },
  ];
  for (const headers of sameOriginHeaders) {
    const response = await handleAdvisorRequest(request(headers), deps);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answer, output.answer);
  }
  // Request URL remains the fallback for callers without a Host header.
  assert.equal((await handleAdvisorRequest(request({ origin: "http://localhost:3000" }), deps)).status, 200);
  assert.equal(calls, 4);

  const foreignOriginHeaders: Record<string, string>[] = [
    { host: "127.0.0.1:3000", origin: "http://localhost:3000" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3001" },
    { host: "127.0.0.1:3000", origin: "https://127.0.0.1:3000" },
    { host: "127.0.0.1:3000", origin: "null" },
    { host: "127.0.0.1:3000", origin: "not a URL" },
    { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "cross-site" },
    { host: "127.0.0.1:3000", origin: "https://another-site.test", "x-forwarded-host": "another-site.test", "x-forwarded-proto": "https" },
    { host: "invalid host", origin: "http://localhost:3000" },
  ];
  for (const headers of foreignOriginHeaders) assert.equal((await handleAdvisorRequest(request(headers), deps)).status, 403);
  assert.equal(calls, 4, "Rejected origins must not call Gemini");
});
