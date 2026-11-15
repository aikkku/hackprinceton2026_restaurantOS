import type { IssueArea, Semantics, SocialDataset, analyzeSocial } from "./social.ts";
import type { AssistantTarget } from "./assistant.ts";
import type { Dataset } from "./dataset.ts";
import { workforceMetrics } from "./hr.ts";

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

// ---- Step 3: route an issue to the operations record it concerns ----
// AI chose the area. Code chooses the record by matching words customers actually wrote, and shows only stored values.
export type IssueAction = { area: IssueArea; target: AssistantTarget; page: string; record: string; detail: string };

const generic = new Set("and the with of for each house fresh local premium".split(" "));
const stem = (word: string) => word.length > 3 ? word.replace(/(es|s)$/, "") : word;
const words = (text: string) => (text.toLowerCase().match(/[a-z]+/g) ?? []).map(stem);
const nameTokens = (name: string) => words(name).filter(word => word.length >= 3 && !generic.has(word));
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function matchInventory(texts: string[], dataset: Dataset): IssueAction | null {
  const vocabulary = new Set(texts.flatMap(words));
  const best = dataset.operations.inventory
    .map(item => ({ item, score: new Set(nameTokens(item.name).filter(token => vocabulary.has(token))).size, short: item.current < item.threshold }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.short) - Number(a.short) || a.item.current / a.item.threshold - b.item.current / b.item.threshold || a.item.id.localeCompare(b.item.id))[0];
  if (!best) return null;
  const { item } = best;
  return { area: "supply", page: "Supply", record: item.name, target: { page: "supply", kind: "inventory", id: item.id, label: item.name },
    detail: `${item.current} of ${item.threshold} ${item.unit} on hand${best.short ? " (below threshold)" : ""}${item.nextDelivery ? ` · next delivery ${item.nextDelivery}` : ""}` };
}

function matchMenu(area: IssueArea, texts: string[], dataset: Dataset): IssueAction | null {
  const messages = texts.map(text => new Set(words(text)));
  const best = dataset.operations.menu.map(item => {
    const tokens = nameTokens(item.name); const head = tokens.at(-1);
    return { item, messages: head ? messages.filter(set => set.has(head)).length : 0, tokens: tokens.filter(token => messages.some(set => set.has(token))).length };
  }).filter(row => row.messages > 0)
    .sort((a, b) => b.messages - a.messages || b.tokens - a.tokens || a.item.id.localeCompare(b.item.id))[0];
  if (!best) return null;
  const { item } = best;
  return { area, page: "Finance", record: item.name, target: { page: "finance", kind: "menu", id: item.id, label: item.name },
    detail: `${money(item.dineInPriceCents)} dine-in · ${money(item.deliveryPriceCents)} delivery app · named in ${best.messages} ${best.messages === 1 ? "message" : "messages"}` };
}

function matchStaffingDay(texts: string[], dataset: Dataset): IssueAction | null {
  let days: ReturnType<typeof workforceMetrics>["days"];
  try { days = workforceMetrics(dataset).days; } catch { return null; }
  const target = dataset.operations.workforce!.assumptions.targetOrdersPerFloorHour;
  const messages = texts.map(text => new Set(words(text)));
  const named = (date: string) => {
    const day = weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
    const weekend = day === "saturday" || day === "sunday";
    return messages.filter(set => set.has(stem(day)) || (weekend && set.has("weekend"))).length;
  };
  const best = days.filter(day => day.peakOrdersPerFloorHour !== null)
    .map(day => ({ day, named: named(day.date) }))
    .sort((a, b) => b.named - a.named || b.day.peakOrdersPerFloorHour! - a.day.peakOrdersPerFloorHour! || a.day.date.localeCompare(b.day.date))[0];
  if (!best) return null;
  const { day } = best;
  const label = new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return { area: "staffing", page: "HR", record: label, target: { page: "hr", kind: "day", id: day.date, label: `${label} schedule` },
    detail: `${day.peakOrders} peak orders · ${day.peakOrdersPerFloorHour} per floor-staff hour (target ${target})${best.named ? ` · day named in ${best.named} ${best.named === 1 ? "message" : "messages"}` : " · busiest day in the schedule; no weekday named by guests"}` };
}

export function issueAction(area: IssueArea, texts: string[], dataset: Dataset): IssueAction | null {
  if (area === "supply") return matchInventory(texts, dataset);
  if (area === "food" || area === "pricing") return matchMenu(area, texts, dataset);
  if (area === "staffing") return matchStaffingDay(texts, dataset);
  if (area === "floor") return { area, page: "Floor Plan", record: "Seating layout", detail: "Open the floor plan to review seating and waiting space", target: { page: "floor", kind: "overview", id: "floor", label: "Floor plan" } };
  return null;
}

// Public discussions (Hacker News) are not this restaurant's customers, so they get rankings but no operations links.
export const operationsLinksApply = (data: SocialDataset) => !data.id.startsWith("hn-story-");

// ---- Step 4: line up an issue's spread with dated restaurant events ----
export type RestaurantEvent = { id: string; date: string; area: IssueArea; label: string; recordId: string | null; source: "logged" | "schedule" };
export type SpreadDay = { date: string; mentions: number; groupsSoFar: number };
export type Window = { mentions: number; groups: number };
export type Alignment = { event: RestaurantEvent; days: number; before: Window; after: Window };
export type IssueSpread = { days: SpreadDay[]; events: RestaurantEvent[]; alignment: Alignment | null };

const dayOf = (timestamp: string) => timestamp.slice(0, 10);
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

// Logged owner events plus schedule days where the floor ran above its orders-per-staff-hour target.
export function restaurantEvents(dataset: Dataset): RestaurantEvent[] {
  const logged: RestaurantEvent[] = (dataset.operations.events ?? []).map(event => ({ ...event, recordId: event.recordId ?? null, source: "logged" }));
  let strain: RestaurantEvent[] = [];
  try {
    const target = dataset.operations.workforce!.assumptions.targetOrdersPerFloorHour;
    strain = workforceMetrics(dataset).days.filter(day => day.peakOrdersPerFloorHour !== null && day.peakOrdersPerFloorHour > target)
      .map(day => ({ id: `floor-strain-${day.date}`, date: day.date, area: "staffing", label: `Floor at ${day.peakOrdersPerFloorHour} peak orders per staff hour (target ${target})`, recordId: day.date, source: "schedule" }));
  } catch { strain = []; }
  return [...logged, ...strain].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

// Equal windows before and after each event (up to 7 days, clipped to the sample). An event aligns only if
// mentions rose and the issue reached more customer groups than before, and more than one (0 → 1 is not spread).
// This reports timing, never cause.
export function issueSpread(timeline: { timestamp: string; groupId: string }[], data: SocialDataset, events: RestaurantEvent[], action: IssueAction | null): IssueSpread {
  if (!data.messages.length) return { days: [], events: [], alignment: null };
  const stamps = data.messages.map(message => dayOf(message.timestamp)).sort();
  const start = stamps[0], end = stamps.at(-1)!;
  const seen = new Set<string>();
  const days = Array.from({ length: daysBetween(start, end) + 1 }, (_, index) => {
    const date = addDays(start, index); const today = timeline.filter(item => dayOf(item.timestamp) === date);
    for (const item of today) seen.add(item.groupId);
    return { date, mentions: today.length, groupsSoFar: seen.size };
  });
  const relevant = action ? events.filter(event => event.area === action.area && event.date >= start && event.date <= end
    && (event.source !== "logged" || !event.recordId || event.recordId === action.target.id)) : [];
  const count = (from: string, to: string): Window => {
    const items = timeline.filter(item => { const date = dayOf(item.timestamp); return date >= from && date <= to; });
    return { mentions: items.length, groups: new Set(items.map(item => item.groupId)).size };
  };
  const candidates = relevant.flatMap(event => {
    const length = Math.min(7, daysBetween(event.date, end) + 1, daysBetween(start, event.date));
    if (length < 1) return [];
    const before = count(addDays(event.date, -length), addDays(event.date, -1)), after = count(event.date, addDays(event.date, length - 1));
    return after.mentions > before.mentions && after.groups > Math.max(before.groups, 1) ? [{ event, days: length, before, after }] : [];
  }).sort((a, b) => (b.after.groups - b.before.groups) - (a.after.groups - a.before.groups) || (b.after.mentions - b.before.mentions) - (a.after.mentions - a.before.mentions) || a.event.date.localeCompare(b.event.date));
  return { days, events: relevant, alignment: candidates[0] ?? null };
}

export function alignmentHeadline(alignment: Alignment) {
  const date = new Date(`${alignment.event.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `After ${date} · ${alignment.event.label}: mentions ${alignment.before.mentions} → ${alignment.after.mentions}, customer groups ${alignment.before.groups} → ${alignment.after.groups} (${alignment.days} days before vs. after)`;
}
