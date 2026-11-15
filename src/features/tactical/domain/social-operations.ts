import type { Semantics, SocialDataset, analyzeSocial } from "./social.ts";

// Pure, deterministic issue ranking: AI supplies topics and tone; everything here is counted from source records.
type SocialAnalysis = ReturnType<typeof analyzeSocial>;
export type RankingKey = "content" | "connectivity" | "combined";
export type IssueSignals = {
  topicId: string; label: string;
  mentions: number; negativeMentions: number; negativeShare: number;
  groupsReached: number; totalGroups: number; crossGroupLinks: number;
  pickedUp: number; newGroupsLast7d: number;
};
export type RankedIssue = IssueSignals & { scores: Record<RankingKey, number>; ranks: Record<RankingKey, number> };

const DAY = 86_400_000;
const isNegative = (tone: Semantics["annotations"][number]["tone"]) => tone === "negative" || tone === "mixed";

export function issueSignals(data: SocialDataset, analysis: SocialAnalysis, semantics: Semantics): IssueSignals[] {
  const tone = new Map(semantics.annotations.map(item => [item.messageId, item.tone]));
  const sampleEnd = Math.max(...data.messages.map(message => Date.parse(message.timestamp)));
  return analysis.topics.map(topic => {
    const ids = new Set(topic.messageIds);
    const firstSeen = new Map<string, number>();
    for (const item of topic.timeline) if (!firstSeen.has(item.groupId)) firstSeen.set(item.groupId, Date.parse(item.timestamp));
    const negativeMentions = topic.messageIds.filter(id => isNegative(tone.get(id)!)).length;
    return {
      topicId: topic.id, label: topic.label,
      mentions: topic.messageIds.length, negativeMentions,
      negativeShare: topic.messageIds.length ? negativeMentions / topic.messageIds.length : 0,
      groupsReached: topic.groups.filter(group => group.count > 0).length, totalGroups: analysis.groups.length,
      crossGroupLinks: topic.crossGroupLinks.length,
      pickedUp: analysis.links.filter(link => ids.has(link.parentId)).length,
      newGroupsLast7d: [...firstSeen.values()].filter(time => time > sampleEnd - 7 * DAY).length,
    };
  });
}

// Formulas were fixed before the demo fixture was written. Do not tune them to a dataset.
export const rankingFormulas: Record<RankingKey, { label: string; formula: string }> = {
  content: { label: "Text only", formula: "Negative or mixed mentions" },
  connectivity: { label: "Connections only", formula: "Customer groups reached, then cross-group replies/reposts" },
  combined: { label: "Fix first", formula: "Negative or mixed mentions × customer groups reached, then cross-group replies/reposts" },
};
const orderings: Record<RankingKey, (issue: IssueSignals) => number[]> = {
  content: issue => [issue.negativeMentions, issue.mentions],
  connectivity: issue => [issue.groupsReached, issue.crossGroupLinks],
  combined: issue => [issue.negativeMentions * issue.groupsReached, issue.crossGroupLinks, issue.negativeMentions],
};

export function rankIssues(signals: IssueSignals[]): RankedIssue[] {
  const ranks = new Map(signals.map(issue => [issue.topicId, {} as Record<RankingKey, number>]));
  for (const key of Object.keys(orderings) as RankingKey[]) {
    const sorted = signals.slice().sort((a, b) => {
      const x = orderings[key](a), y = orderings[key](b);
      for (let index = 0; index < x.length; index++) if (x[index] !== y[index]) return y[index] - x[index];
      return a.label.localeCompare(b.label) || a.topicId.localeCompare(b.topicId);
    });
    sorted.forEach((issue, index) => { ranks.get(issue.topicId)![key] = index + 1; });
  }
  return signals
    .map(issue => ({ ...issue, scores: { content: issue.negativeMentions, connectivity: issue.groupsReached, combined: issue.negativeMentions * issue.groupsReached }, ranks: ranks.get(issue.topicId)! }))
    .sort((a, b) => a.ranks.combined - b.ranks.combined);
}

export function issueReason(issue: IssueSignals) {
  return [
    `${issue.negativeMentions} of ${issue.mentions} mentions negative or mixed`,
    `reached ${issue.groupsReached} of ${issue.totalGroups} customer groups`,
    `${issue.crossGroupLinks} cross-group ${issue.crossGroupLinks === 1 ? "reply/repost" : "replies/reposts"}`,
    `${issue.newGroupsLast7d} new ${issue.newGroupsLast7d === 1 ? "group" : "groups"} in the sample's last 7 days`,
  ].join(" · ");
}

// One sentence comparing the two rankings. Only claims a difference that the numbers show.
export function rankingHeadline(issues: RankedIssue[]) {
  const top = (key: RankingKey) => issues.find(issue => issue.ranks[key] === 1);
  const content = top("content"), combined = top("combined");
  if (!content || !combined || !combined.negativeMentions) return "No negative issue to prioritize in this sample.";
  if (content.topicId === combined.topicId) return `${combined.label} leads on both mentions and reach.`;
  return `Mentions alone point to ${content.label}. Counting how far issues spread across customer groups puts ${combined.label} first.`;
}
