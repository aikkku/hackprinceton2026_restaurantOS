import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSocial, socialDatasetSchema, validateSemantics, type Semantics } from "./domain/social.ts";
import { issueAction, issueReason, issueSignals, operationsLinksApply, rankIssues, rankingHeadline } from "./domain/social-operations.ts";
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
