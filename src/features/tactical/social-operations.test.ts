import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeSocial, socialDatasetSchema, validateSemantics, type Semantics } from "./domain/social.ts";
import { issueReason, issueSignals, rankIssues, rankingHeadline } from "./domain/social-operations.ts";

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
