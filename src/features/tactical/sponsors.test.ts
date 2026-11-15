import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeNetwork, networkSchema } from "./domain/network.ts";
import { cashPlan, nessieFlows, nessieIdSchema, nessieSnapshotSchema } from "./domain/nessie.ts";
import { readNessie } from "./backend/adapters/nessie.ts";
import { createNessieHandler } from "./backend/nessie-service.ts";
import { createNetworkHandler } from "./backend/network-service.ts";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./frontend/data/${name}.json`, import.meta.url), "utf8"));
const graph = networkSchema.parse(fixture("demo-network"));
const bank = nessieSnapshotSchema.parse(fixture("demo-nessie"));
const request = (body?: unknown) => new Request("http://localhost/api/tactical/integrations/network", { method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

test("network sample has valid evidence, deterministic unique neighbors and topic engagement", () => {
  const result = analyzeNetwork(graph);
  assert.equal(result.nodeCount, 8); assert.equal(result.edgeCount, 8); assert.equal(result.components.length, 1);
  assert.equal(result.topics.find(topic => topic.id === "t:local")?.engagedAuthors, 3);
  assert.equal(result.topics.find(topic => topic.id === "t:brunch")?.engagedAuthors, 2);
  const repeated = structuredClone(graph); repeated.edges.push({ id: "e:9", from: "a:one", to: "p:brunch", relation: "liked", evidenceId: "s:comment" });
  assert.equal(analyzeNetwork(repeated).ranked.find(node => node.id === "a:one")?.degree, 1);
  assert.equal(analyzeNetwork(repeated).topics.find(topic => topic.id === "t:brunch")?.engagedAuthors, 2);
});
test("network rejects orphan, duplicate, backwards, self and unsafe source relations", () => {
  for (const change of [
    (value: typeof graph) => { value.edges[0].evidenceId = "missing"; },
    (value: typeof graph) => { value.edges[0].from = "missing"; },
    (value: typeof graph) => { value.edges.push({ ...value.edges[0], id: "duplicate" }); },
    (value: typeof graph) => { value.nodes.push(value.nodes[0]); },
    (value: typeof graph) => { value.edges[0].from = "p:brunch"; value.edges[0].to = "a:restaurant"; },
    (value: typeof graph) => { value.edges[0].to = value.edges[0].from; },
    (value: typeof graph) => { value.evidence[0].url = "javascript:alert(1)"; },
  ]) { const input = structuredClone(graph); change(input); assert.equal(networkSchema.safeParse(input).success, false); }
});
test("empty, disconnected and filtered networks do not infer missing connections", () => {
  assert.equal(analyzeNetwork({ ...graph, nodes: [], edges: [], evidence: [] }).components.length, 0);
  const result = analyzeNetwork({ ...graph, edges: [] });
  assert.equal(result.components.length, 8); assert.equal(result.isolated, 8); assert.ok(result.topics.every(topic => topic.engagedAuthors === 0));
});
test("bank flow totals exclude pending records and cash plan does not double-count historical deposits", () => {
  assert.deepEqual(nessieFlows(bank), { depositCents: 450000, withdrawalCents: 90000, netCents: 360000, excluded: 1 });
  assert.deepEqual(cashPlan(bank, { investmentCents: 400000, reserveCents: 1000000, monthlyBurnCents: 150000 }), { balanceCents: 2500000, remainingCents: 2100000, cushionCents: 1100000, runwayMonths: 1100000 / 150000 });
});
test("cash plans cover zero burn, exhausted cash, credit cards and invalid assumptions", () => {
  assert.equal(cashPlan(bank, { investmentCents: 0, reserveCents: 0, monthlyBurnCents: 0 })?.runwayMonths, null);
  const deficit = cashPlan(bank, { investmentCents: 3000000, reserveCents: 0, monthlyBurnCents: 10000 });
  assert.equal(deficit?.remainingCents, -500000); assert.equal(deficit?.runwayMonths, 0);
  assert.equal(cashPlan({ ...bank, account: { ...bank.account, type: "Credit Card" } }, { investmentCents: 0, reserveCents: 0, monthlyBurnCents: 1 }), null);
  for (const invalid of [-1, NaN, Infinity, .5]) assert.throws(() => cashPlan(bank, { investmentCents: invalid, reserveCents: 0, monthlyBurnCents: 0 }));
});
test("bank schema rejects duplicate source rows, unknown status and invalid dates", () => {
  assert.equal(nessieSnapshotSchema.safeParse({ ...bank, deposits: [bank.deposits[0], bank.deposits[0]] }).success, false);
  assert.equal(nessieSnapshotSchema.safeParse({ ...bank, withdrawals: [{ ...bank.withdrawals[0], status: "paid" }] }).success, false);
  assert.equal(nessieSnapshotSchema.safeParse({ ...bank, withdrawals: [{ ...bank.withdrawals[0], transaction_date: "2026-02-30" }] }).success, false);
});
test("Nessie adapter reads verified paths, strips extraneous fields and retains sandbox provenance", async () => {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const parsed = new URL(String(url)); paths.push(parsed.pathname);
    assert.equal(parsed.origin, "https://prod-api.nessieisreal.com"); assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    return Response.json(parsed.pathname.endsWith("deposits") ? bank.deposits : parsed.pathname.endsWith("withdrawals") ? bank.withdrawals : { ...bank.account, account_number: "sensitive-field" });
  };
  const data = await readNessie({ key: "test", accountId: bank.account._id, fetcher });
  assert.equal(paths.length, 3); assert.equal(data.source, "nessie-sandbox"); assert.equal("account_number" in data.account, false);
});
test("Nessie fails closed for malformed responses, wrong account, HTTP errors and missing configuration", async () => {
  const base = { key: "test", accountId: bank.account._id };
  for (const fetcher of [async () => Response.json({ malformed: true }), async () => new Response("private provider failure", { status: 401 })]) await assert.rejects(readNessie({ ...base, fetcher }));
  const wrongAccount: typeof fetch = async url => Response.json(String(url).includes("deposits?") ? bank.deposits : String(url).includes("withdrawals?") ? bank.withdrawals : { ...bank.account, _id: "000000000000000000000099" });
  await assert.rejects(readNessie({ ...base, fetcher: wrongAccount }));
  await assert.rejects(readNessie({ key: "", accountId: "" }));
});
test("Nessie accepts live-service UUIDs and legacy IDs without accepting arbitrary paths", async () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  const fetcher: typeof fetch = async url => Response.json(String(url).includes("deposits?") ? bank.deposits.map(row => ({ ...row, _id: row._id === bank.deposits[0]._id ? uuid : row._id })) : String(url).includes("withdrawals?") ? [] : { ...bank.account, _id: uuid });
  const data = await readNessie({ key: "test", accountId: uuid, fetcher });
  assert.equal(data.account._id, uuid); assert.equal(data.deposits[0]._id, uuid);
  assert.equal(nessieIdSchema.safeParse(bank.account._id).success, true);
  for (const invalid of ["../customers", "account?key=other", "anything", "", "123e4567-e89b-42d3-a456"]) assert.equal(nessieIdSchema.safeParse(invalid).success, false);
});
test("Nessie route protects reads, prevents cross-origin requests and redacts provider failures", async () => {
  let reads = 0; const read = async () => { reads++; return bank; };
  assert.equal((await createNessieHandler({ read, authorize: () => false })(request())).status, 401); assert.equal(reads, 0);
  const foreign = new Request("http://localhost/api/tactical/integrations/nessie", { method: "POST", headers: { origin: "https://evil.example" } });
  assert.equal((await createNessieHandler({ read, authorize: () => true })(foreign)).status, 403); assert.equal(reads, 0);
  const response = await createNessieHandler({ read: async () => { throw new Error("secret"); }, authorize: () => true })(request());
  assert.equal(response.status, 503); assert.equal((await response.text()).includes("secret"), false); assert.equal(response.headers.get("cache-control"), "no-store");
});
test("network AI checks permission, evidence references, limits and generic errors", async () => {
  const handler = createNetworkHandler({ authorize: () => false }); assert.equal((await handler(request(graph))).status, 401);
  const invalid = createNetworkHandler({ authorize: () => true, budget: () => true, generate: async () => ({ summary: "test", hypotheses: [{ action: "test", rationale: "test", evidenceIds: ["missing"] }], limitations: ["test"] }) as never });
  const response = await invalid(request(graph)); assert.equal(response.status, 503); assert.equal((await response.json()).error, "Something is wrong");
  const limited = createNetworkHandler({ authorize: () => true, budget: () => false }); assert.equal((await limited(request(graph))).status, 429);
  assert.equal((await invalid(request({ ...graph, edges: [] }))).status, 422);
});
