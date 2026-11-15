import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSocial, communityPartition, materializeSemantics, messageExcerpts, socialDatasetSchema, validateSemantics, type ActorLink, type Semantics } from "./domain/social.ts";
import { loadHackerNews, plainHnText } from "./backend/adapters/hacker-news.ts";
import { createSocialAnalysisHandler, createSocialSourceHandler } from "./backend/social-service.ts";

const sample = socialDatasetSchema.parse(JSON.parse(readFileSync(new URL("./frontend/data/demo-social.json", import.meta.url), "utf8")));
const semantics: Semantics = { topics: [{ id: "clarity", label: "Clear expectations", description: "Messages about setting expectations." }], annotations: sample.messages.map(message => ({ messageId: message.id, topicIds: ["clarity"], tone: "neutral", quote: message.text.slice(0, 50) })), limitations: ["Fictional test labels, not live AI."] };
const modelResult = { ...semantics, annotations: semantics.annotations.map(({ messageId, topicIds, tone }) => ({ messageId, topicIds, tone, excerptIndex: 0 })) };
const request = (data: unknown) => new Request("http://localhost/api/tactical/integrations/social/analyze", { method: "POST", headers: { origin: "http://localhost", "Content-Type": "application/json" }, body: JSON.stringify(data) });

test("social contract rejects invented authors, duplicate records, cycles and impossible chronology", () => {
  for (const mutate of [
    (data: typeof sample) => { data.messages[0].actorId = "absent"; },
    (data: typeof sample) => { data.messages.push(data.messages[0]); },
    (data: typeof sample) => { data.messages[0].replyTo = "m2"; },
    (data: typeof sample) => { data.messages[0].replyTo = "m1"; },
    (data: typeof sample) => { data.messages[1].repostOf = "m1"; },
    (data: typeof sample) => { data.messages[0].url = "javascript:alert(1)"; },
  ]) { const input = structuredClone(sample); mutate(input); assert.equal(socialDatasetSchema.safeParse(input).success, false); }
  const cycle = structuredClone(sample); cycle.messages[0].timestamp = cycle.messages[1].timestamp; cycle.messages[0].replyTo = "m2"; assert.equal(socialDatasetSchema.safeParse(cycle).success, false);
});
test("missing parents and same-author replies are counted but never fabricated into actor links", () => {
  const data = structuredClone(sample); data.messages[1].replyTo = "outside-sample"; data.messages[2].actorId = data.messages[1].actorId;
  const result = analyzeSocial(data); assert.equal(result.unresolved, 1); assert.equal(result.selfReplies, 1);
  assert.ok(result.links.every(link => link.from !== link.to && link.parentId !== "outside-sample"));
});
test("greedy modularity separates two dense groups joined by a single bridge", () => {
  const links: ActorLink[] = [["a", "b"], ["b", "c"], ["a", "c"], ["d", "e"], ["e", "f"], ["d", "f"], ["c", "d"]].map(([from, to], index) => ({ from, to, messageId: `m${index}`, parentId: `p${index}`, kind: "reply", timestamp: "2026-11-14T00:00:00Z" }));
  const result = communityPartition(["a", "b", "c", "d", "e", "f"], links);
  assert.deepEqual(result.groups, [["a", "b", "c"], ["d", "e", "f"]]); assert.ok(Math.abs(result.modularity! - 5 / 14) < 1e-10);
  assert.deepEqual(communityPartition(["f", "c", "b", "d", "e", "a"], links.slice().reverse()), result);
});
test("empty and isolated actor samples have no invented communities or interaction evidence", () => {
  const empty = analyzeSocial({ ...sample, actors: [], messages: [] }); assert.equal(empty.groups.length, 0); assert.equal(empty.modularity, null);
  const unlinked = analyzeSocial({ ...sample, messages: sample.messages.map(message => ({ ...message, replyTo: null, repostOf: null })) });
  assert.equal(unlinked.groups.length, sample.actors.length); assert.equal(unlinked.links.length, 0); assert.equal(unlinked.modularity, null);
});
test("semantic validation requires complete coverage, exact quotes and valid topic references", () => {
  assert.deepEqual(validateSemantics(sample, semantics), semantics);
  for (const mutate of [
    (data: Semantics) => { data.annotations.pop(); },
    (data: Semantics) => { data.annotations[0].quote = "Invented quote"; },
    (data: Semantics) => { data.annotations[0].topicIds = ["invented"]; },
    (data: Semantics) => { data.annotations[0].messageId = "absent"; },
    (data: Semantics) => { data.annotations[1] = data.annotations[0]; },
    (data: Semantics) => { data.topics.push(data.topics[0]); },
  ]) { const data = structuredClone(semantics); mutate(data); assert.throws(() => validateSemantics(sample, data)); }
});
test("joint metrics trace actual same-topic paths and deduplicate actors without creating semantic edges", () => {
  const connected = analyzeSocial(sample, semantics); const topic = connected.topics[0];
  assert.equal(topic.actorCount, sample.actors.length); assert.equal(topic.messageIds.length, sample.messages.length); assert.equal(topic.conversationLinks.length, connected.links.length);
  assert.equal(topic.crossGroupLinks.length, connected.crossLinks.length);
  const disconnected = analyzeSocial({ ...sample, messages: sample.messages.map(message => ({ ...message, replyTo: null, repostOf: null })) }, semantics);
  assert.equal(disconnected.topics[0].messageIds.length, sample.messages.length); assert.equal(disconnected.topics[0].conversationLinks.length, 0);
  assert.deepEqual(topic.timeline.map(item => item.messageId), sample.messages.map(message => message.id));
});
test("model-selected excerpt indices are materialized from the source without generated quotations", () => {
  const result = materializeSemantics(sample, modelResult);
  assert.equal(result.annotations[0].quote, messageExcerpts(sample.messages[0].text)[0]);
  for (const item of result.annotations) assert.ok(sample.messages.find(message => message.id === item.messageId)!.text.includes(item.quote));
  const invalid = structuredClone(modelResult); invalid.annotations[0].excerptIndex = 15; assert.throws(() => materializeSemantics(sample, invalid));
  const long = "A long source sentence. ".repeat(150); assert.equal(messageExcerpts(long).length, 16); assert.ok(messageExcerpts(long).every(quote => long.includes(quote)));
});
test("HN text is plain text and bounded, with safe numeric entity handling", () => {
  assert.equal(plainHnText('<p>Fees &amp; tips</p><p>&#x27;Clear&#39; &#99999999;</p>'), "Fees & tips 'Clear'");
  assert.equal(plainHnText("a".repeat(5000)).length, 3000);
});
test("HN importer uses observed parent links, pseudonyms and explicit sampling limits", async () => {
  const records: Record<number, unknown> = {
    1: { id: 1, type: "story", title: "Public test thread", by: "person-one", time: 100, kids: [2, 4, 5] },
    2: { id: 2, type: "comment", by: "person-two", time: 101, parent: 1, text: "Menu fees", kids: [3] },
    3: { id: 3, type: "comment", by: "person-one", time: 102, parent: 2, text: "Clear prices" },
    4: { id: 4, type: "comment", deleted: true },
    5: { id: 5, type: "comment", by: "third", time: 103, parent: 999, text: "Wrong parent" },
  };
  const fetcher: typeof fetch = async (input, options) => { const url = new URL(String(input)); assert.equal(url.hostname, "hacker-news.firebaseio.com"); assert.equal(options?.redirect, "error"); return Response.json(records[Number(url.pathname.match(/(\d+)\.json/)![1])]); };
  const result = await loadHackerNews(1, { fetcher });
  assert.equal(result.provenance, "observed"); assert.equal(result.messages.length, 3); assert.equal(result.actors.length, 2);
  assert.equal(result.messages[2].replyTo, "hn:2"); assert.equal(result.messages[2].actorId, result.messages[0].actorId);
  assert.equal(JSON.stringify(result).includes("person-one"), false); assert.equal(analyzeSocial(result).links.length, 2);
  assert.ok(result.source.limitations[0].includes("2 unavailable"));
});
test("HN failure never substitutes a synthetic dataset", async () => {
  await assert.rejects(loadHackerNews(1, { fetcher: async () => new Response("", { status: 503 }) }));
  await assert.rejects(loadHackerNews(1, { fetcher: async () => Response.json(null) }));
  await assert.rejects(loadHackerNews(-1));
});
test("social endpoints authenticate, reject invalid output and redact errors", async () => {
  let calls = 0;
  const load = async () => { calls++; return sample; };
  assert.equal((await createSocialSourceHandler({ load, authorize: () => false })(request({ storyId: 1 }))).status, 401); assert.equal(calls, 0);
  const source = createSocialSourceHandler({ load, authorize: () => true }); assert.equal((await source(request({ storyId: 1 }))).status, 200);
  const bad = createSocialAnalysisHandler({ authorize: () => true, budget: () => true, generate: async () => ({ ...semantics, annotations: [] }) as never });
  const response = await bad(request(sample)); assert.equal(response.status, 503); assert.equal((await response.json()).error, "Something is wrong");
  const good = createSocialAnalysisHandler({ authorize: () => true, budget: () => true, generate: async () => modelResult as never });
  const success = await good(request(sample)); assert.equal(success.status, 200); const body = await success.json(); assert.equal(body.semantics.annotations.length, sample.messages.length); assert.match(body.datasetHash, /^[a-f0-9]{64}$/);
  assert.equal((await createSocialAnalysisHandler({ authorize: () => false })(request(sample))).status, 401);
  assert.equal((await createSocialAnalysisHandler({ authorize: () => true, budget: () => false })(request(sample))).status, 429);
  const foreign = new Request("http://localhost/api/tactical/integrations/social/source", { method: "POST", headers: { origin: "https://outside.example" } });
  assert.equal((await source(foreign)).status, 403);
});
