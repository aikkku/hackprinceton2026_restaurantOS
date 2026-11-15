import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSocial, socialDatasetSchema, validateSemantics, type Semantics } from "./domain/social.ts";
import { alignmentHeadline, issueAction, issueReason, issueSignals, issueSpread, operationsLinksApply, rankIssues, rankingHeadline, restaurantEvents } from "./domain/social-operations.ts";
import { datasetSchema } from "./domain/dataset.ts";

const read = (name: string) => JSON.parse(readFileSync(new URL(`./frontend/data/${name}`, import.meta.url), "utf8"));
const sample = socialDatasetSchema.parse(read("demo-social.json"));
const recorded = validateSemantics(sample, read("demo-social-semantics.json"));
const ranked = (data = sample, semantics: Semantics = recorded) => rankIssues(issueSignals(data, analyzeSocial(data, semantics), semantics));
const byId = (issues: ReturnType<typeof ranked>) => new Map(issues.map(issue => [issue.topicId, issue]));

test("signals on the demo fixture match a hand count", () => {
  const issues = byId(ranked());
  assert.deepEqual(
    Object.fromEntries([...issues].map(([id, issue]) => [id, [issue.mentions, issue.negativeMentions, issue.groupsReached, issue.crossGroupLinks, issue.newGroupsLast7d]])),
    { wait: [16, 16, 1, 0, 0], packaging: [10, 10, 4, 2, 3], pricing: [6, 3, 2, 0, 1], food: [10, 0, 3, 0, 2] },
  );
  assert.ok([...issues.values()].every(issue => issue.totalGroups === 4));
  // The flat-box thread is replied to inside the delivery group and reposted into two others.
  assert.ok(issues.get("packaging")!.pickedUp >= 2);
});

test("text-only, connections-only and combined rankings disagree in the expected way", () => {
  const issues = byId(ranked());
  const order = (key: "content" | "connectivity" | "combined") => [...issues.values()].sort((a, b) => a.ranks[key] - b.ranks[key]).map(issue => issue.topicId);
  assert.deepEqual(order("content"), ["wait", "packaging", "pricing", "food"]);
  assert.deepEqual(order("connectivity"), ["packaging", "food", "pricing", "wait"]);
  assert.deepEqual(order("combined"), ["packaging", "wait", "pricing", "food"]);
  assert.equal(issues.get("packaging")!.scores.combined, 40); assert.equal(issues.get("wait")!.scores.combined, 16);
  assert.equal(rankingHeadline(ranked()), "Mentions alone point to Weekend table wait. Counting how far issues spread across customer groups puts Soggy takeaway packaging first.");
  assert.match(issueReason(issues.get("packaging")!), /^10 of 10 mentions negative or mixed · reached 4 of 4 customer groups · 2 cross-group replies\/reposts · 3 new groups/);
});

test("rankings are deterministic and independent of topic order", () => {
  const reversed = { ...recorded, topics: recorded.topics.slice().reverse() };
  assert.deepEqual(ranked(sample, reversed).map(issue => [issue.topicId, issue.ranks]), ranked().map(issue => [issue.topicId, issue.ranks]));
});

test("unlinked or all-positive samples never produce NaN or a false priority", () => {
  const unlinked = { ...sample, messages: sample.messages.map(message => ({ ...message, replyTo: null, repostOf: null })) };
  for (const issue of ranked(unlinked)) for (const value of [issue.negativeShare, issue.scores.combined, issue.crossGroupLinks]) assert.ok(Number.isFinite(value));
  const positive: Semantics = { ...recorded, annotations: recorded.annotations.map(item => ({ ...item, tone: "positive" })) };
  const issues = ranked(sample, positive);
  assert.ok(issues.every(issue => issue.negativeMentions === 0 && issue.scores.combined === 0));
  assert.equal(rankingHeadline(issues), "No negative issue to prioritize in this sample.");
  assert.equal(rankingHeadline([]), "No negative issue to prioritize in this sample.");
});

const restaurant = datasetSchema.parse(read("demo-restaurant.json"));
const topicTexts = (id: string) => sample.messages.filter(message => recorded.annotations.find(item => item.messageId === message.id)!.topicIds.includes(id)).map(message => message.text);
const action = (id: string) => issueAction(recorded.topics.find(topic => topic.id === id)!.area, topicTexts(id), restaurant);

test("each demo issue routes to the operations record customers describe, with stored values only", () => {
  const packaging = action("packaging")!;
  assert.deepEqual(packaging.target, { page: "supply", kind: "inventory", id: "i34", label: "Vented takeaway boxes" });
  assert.equal(packaging.detail, "22 of 60 each on hand (below threshold) · next delivery 2026-11-18");
  // Tuesday has the highest load per floor-staff hour, but guests describe weekend nights; Saturday is named most.
  const wait = action("wait")!;
  assert.deepEqual(wait.target, { page: "hr", kind: "day", id: "2026-11-14", label: "Sat, Nov 14 schedule" });
  assert.match(wait.detail, /^61 peak orders · 10\.17 per floor-staff hour \(target 6\) · day named in \d+ messages$/);
  assert.equal(action("food")!.record, "Braised Short Rib");
  assert.equal(action("pricing")!.target.page, "finance");
});

test("routing fails closed: unknown words, other areas, missing workforce and public discussions get no link", () => {
  assert.equal(issueAction("supply", ["The music was too loud tonight."], restaurant), null);
  assert.equal(issueAction("food", ["Nothing about any dish here."], restaurant), null);
  assert.equal(issueAction("other", topicTexts("packaging"), restaurant), null);
  const noWorkforce = { ...restaurant, operations: { ...restaurant.operations, workforce: undefined } };
  assert.equal(issueAction("staffing", topicTexts("wait"), noWorkforce), null);
  const quiet = issueAction("staffing", ["Service felt slow."], restaurant)!;
  assert.equal(quiet.target.id, "2026-11-10"); assert.match(quiet.detail, /no weekday named by guests$/);
  assert.equal(issueAction("floor", [], restaurant)!.target.page, "floor");
  assert.equal(operationsLinksApply(sample), true); assert.equal(operationsLinksApply({ ...sample, id: "hn-story-42302171" }), false);
});

const spreadFor = (id: string, dataset = restaurant) => {
  const analysis = analyzeSocial(sample, recorded);
  return issueSpread(analysis.topics.find(topic => topic.id === id)!.timeline, sample, restaurantEvents(dataset), issueAction(recorded.topics.find(topic => topic.id === id)!.area, topicTexts(id), dataset));
};

test("restaurant events combine the logged stock event with floor-strain schedule days", () => {
  const events = restaurantEvents(restaurant);
  assert.deepEqual(events.filter(event => event.source === "logged").map(event => [event.date, event.recordId]), [["2026-11-12", "i34"]]);
  // Every demo week day except Wednesday (5.17) is above the target of 6 orders per floor-staff hour.
  assert.deepEqual(events.filter(event => event.source === "schedule").map(event => event.date), ["2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  assert.deepEqual(restaurantEvents({ ...restaurant, operations: { ...restaurant.operations, workforce: undefined, events: undefined } }), []);
});

test("packaging spread aligns with the boxes event; contained wait-time complaints never align", () => {
  const packaging = spreadFor("packaging");
  assert.equal(packaging.days.length, 15); assert.equal(packaging.days.at(-1)!.groupsSoFar, 4);
  assert.deepEqual(packaging.events.map(event => event.id), ["event-vented-boxes-low"]);
  assert.deepEqual(packaging.alignment && { id: packaging.alignment.event.id, days: packaging.alignment.days, before: packaging.alignment.before, after: packaging.alignment.after },
    { id: "event-vented-boxes-low", days: 4, before: { mentions: 1, groups: 1 }, after: { mentions: 8, groups: 4 } });
  assert.equal(alignmentHeadline(packaging.alignment!), "After Nov 12 · Vented takeaway boxes below reorder point; delivery orders packed in flat boxes: mentions 1 → 8, customer groups 1 → 4 (4 days before vs. after)");
  const wait = spreadFor("wait");
  assert.equal(wait.events.length, 6); assert.equal(wait.alignment, null);
  assert.equal(spreadFor("pricing").alignment, null); assert.deepEqual(spreadFor("pricing").events, []);
});

test("events outside the sample, for other records, or without data never align", () => {
  const moved = { ...restaurant, operations: { ...restaurant.operations, events: [{ id: "late", date: "2026-11-20", area: "supply" as const, label: "Late", recordId: "i34" }, { id: "other", date: "2026-11-12", area: "supply" as const, label: "Other item", recordId: "i35" }] } };
  assert.equal(spreadFor("packaging", moved).alignment, null); assert.deepEqual(spreadFor("packaging", moved).events, []);
  assert.deepEqual(issueSpread([], { ...sample, messages: [] }, restaurantEvents(restaurant), null), { days: [], events: [], alignment: null });
});
