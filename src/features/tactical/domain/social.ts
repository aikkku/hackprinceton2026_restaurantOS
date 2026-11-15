import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/);
const url = z.string().max(2000).refine(value => value === "" || /^https:\/\//.test(value) && URL.canParse(value), "Use an HTTPS source link or leave blank");
export const socialDatasetSchema = z.object({
  version: z.literal(1), id, title: z.string().trim().min(1).max(200), provenance: z.enum(["synthetic", "observed"]),
  source: z.object({ name: z.string().min(1).max(200), url, retrievedAt: z.iso.datetime(), method: z.string().min(10).max(2000), limitations: z.array(z.string().min(1).max(1000)).min(1).max(10) }).strict(),
  actors: z.array(z.object({ id, label: z.string().min(1).max(100) }).strict()).max(40),
  messages: z.array(z.object({ id, actorId: id, text: z.string().trim().min(1).max(3000), timestamp: z.iso.datetime(), url, replyTo: id.nullable(), repostOf: id.nullable() }).strict()).max(40),
}).strict().superRefine((data, ctx) => {
  for (const field of ["actors", "messages"] as const) if (new Set(data[field].map(item => item.id)).size !== data[field].length) ctx.addIssue({ code: "custom", path: [field], message: "Duplicate IDs" });
  const actors = new Set(data.actors.map(actor => actor.id)); const messages = new Map(data.messages.map(message => [message.id, message]));
  for (const message of data.messages) {
    if (!actors.has(message.actorId)) ctx.addIssue({ code: "custom", message: "Message author must exist" });
    if (message.replyTo && message.repostOf) ctx.addIssue({ code: "custom", message: "Use one explicit relationship per message" });
    const parentId = message.replyTo ?? message.repostOf; const parent = parentId ? messages.get(parentId) : undefined;
    if (parent && (parent.id === message.id || Date.parse(parent.timestamp) > Date.parse(message.timestamp))) ctx.addIssue({ code: "custom", message: "Relationships cannot target self or a later message" });
    const seen = new Set([message.id]); let next = parent;
    while (next) { if (seen.has(next.id)) { ctx.addIssue({ code: "custom", message: "Cyclic message references" }); break; } seen.add(next.id); next = messages.get(next.replyTo ?? next.repostOf ?? ""); }
  }
});
export type SocialDataset = z.infer<typeof socialDatasetSchema>;
// Which part of the restaurant a theme concerns. AI picks the area; code picks the exact record (social-operations.ts).
export const issueAreas = ["staffing", "supply", "pricing", "food", "floor", "other"] as const;
export const issueAreaSchema = z.enum(issueAreas);
export type IssueArea = z.infer<typeof issueAreaSchema>;
export const semanticSchema = z.object({
  topics: z.array(z.object({ id, label: z.string().min(1).max(80), description: z.string().min(1).max(300), area: issueAreaSchema }).strict()).max(6),
  annotations: z.array(z.object({ messageId: id, topicIds: z.array(id).max(3), tone: z.enum(["positive", "negative", "mixed", "neutral", "unclear"]), quote: z.string().min(1).max(160) }).strict()).max(40),
  limitations: z.array(z.string().min(1).max(400)).min(1).max(5),
}).strict();
export type Semantics = z.infer<typeof semanticSchema>;
export const semanticModelSchema = semanticSchema.extend({ annotations: z.array(z.object({ messageId: id, topicIds: z.array(id).max(3), tone: z.enum(["positive", "negative", "mixed", "neutral", "unclear"]), excerptIndex: z.number().int().min(0).max(15) }).strict()).max(40) });
// The model chooses a source span by index; code copies its exact text. Never ask an LLM to reproduce quotes.
export function messageExcerpts(text: string) {
  const chunks: string[] = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + 120);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end++;
    const chunk = text.slice(start, end).trim(); if (chunk) chunks.push(chunk); start = end;
  }
  return chunks.length <= 16 ? chunks : Array.from({ length: 16 }, (_, index) => chunks[Math.round(index * (chunks.length - 1) / 15)]);
}
export function materializeSemantics(data: SocialDataset, input: unknown) {
  const raw = semanticModelSchema.parse(input);
  const excerpts = new Map(data.messages.map(message => [message.id, messageExcerpts(message.text)]));
  const annotations = raw.annotations.map(({ excerptIndex, ...annotation }) => {
    const quote = excerpts.get(annotation.messageId)?.[excerptIndex];
    if (!quote) throw new Error("Invalid source excerpt index");
    return { ...annotation, quote };
  });
  return validateSemantics(data, { ...raw, annotations });
}
export function validateSemantics(data: SocialDataset, input: unknown): Semantics {
  const parsed = semanticSchema.parse(input); const messages = new Map(data.messages.map(message => [message.id, message]));
  const topics = new Set(parsed.topics.map(topic => topic.id)); const seen = new Set<string>();
  if (topics.size !== parsed.topics.length) throw new Error("Duplicate topics");
  for (const annotation of parsed.annotations) {
    const message = messages.get(annotation.messageId);
    if (!message || seen.has(message.id) || !message.text.includes(annotation.quote) || new Set(annotation.topicIds).size !== annotation.topicIds.length || annotation.topicIds.some(topic => !topics.has(topic))) throw new Error("Invalid semantic evidence");
    seen.add(message.id);
  }
  if (seen.size !== messages.size) throw new Error("Incomplete message coverage");
  return parsed;
}

export type ActorLink = { from: string; to: string; messageId: string; parentId: string; kind: "reply" | "repost"; timestamp: string };
// Weighted undirected greedy modularity, resolution 1. Direction remains in source links.
// Delta Q = betweenWeight/m - degreeA*degreeB/(2*m*m). Stable sorted tie-breaking.
export function communityPartition(actorIds: string[], links: ActorLink[]) {
  const actors = [...actorIds].sort(); let groups = actors.map(actor => [actor]);
  const degree = new Map(actors.map(actor => [actor, 0]));
  for (const link of links) { degree.set(link.from, degree.get(link.from)! + 1); degree.set(link.to, degree.get(link.to)! + 1); }
  const m = links.length;
  if (!m) return { groups, modularity: null };
  while (groups.length > 1) {
    let best = 1e-12; let merge: [number, number] | null = null;
    const owner = new Map(groups.flatMap((group, index) => group.map(actor => [actor, index] as const)));
    const degrees = groups.map(group => group.reduce((sum, actor) => sum + degree.get(actor)!, 0));
    const weights = groups.map(() => groups.map(() => 0));
    for (const link of links) { const a = owner.get(link.from)!; const b = owner.get(link.to)!; if (a !== b) { weights[a][b]++; weights[b][a]++; } }
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      const gain = weights[a][b] / m - degrees[a] * degrees[b] / (2 * m * m);
      if (gain > best) { best = gain; merge = [a, b]; }
    }
    if (!merge) break;
    const [a, b] = merge; groups[a] = [...groups[a], ...groups[b]].sort(); groups.splice(b, 1);
    groups = groups.sort((a, b) => a[0].localeCompare(b[0]));
  }
  const modularity = groups.reduce((sum, group) => {
    const members = new Set(group); const inside = links.filter(link => members.has(link.from) && members.has(link.to)).length;
    const k = group.reduce((total, actor) => total + degree.get(actor)!, 0);
    return sum + inside / m - (k / (2 * m)) ** 2;
  }, 0);
  return { groups, modularity };
}
const stopwords = new Set("a an and are as at be been but by can could did do does for from had has have he her here him his how i if in is it its just like me more my no not of on one or our out people s she so some than that the their them then there these they this those to too up us was we were what when which who will with would you your".split(" "));
export function contentTerms(texts: string[]) {
  const counts = new Map<string, number>();
  for (const text of texts) for (const word of new Set(text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [])) if (!stopwords.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([term, messageCount]) => ({ term, messageCount }));
}
export function analyzeSocial(input: SocialDataset, semanticInput?: Semantics) {
  const data = socialDatasetSchema.parse(input); const semantics = semanticInput ? validateSemantics(data, semanticInput) : undefined;
  const messages = new Map(data.messages.map(message => [message.id, message]));
  const links: ActorLink[] = []; let unresolved = 0; let selfReplies = 0;
  for (const message of data.messages) {
    const parentId = message.replyTo ?? message.repostOf; if (!parentId) continue;
    const parent = messages.get(parentId); if (!parent) { unresolved++; continue; }
    if (parent.actorId === message.actorId) { selfReplies++; continue; }
    links.push({ from: message.actorId, to: parent.actorId, messageId: message.id, parentId: parent.id, kind: message.repostOf ? "repost" : "reply", timestamp: message.timestamp });
  }
  const partition = communityPartition(data.actors.map(actor => actor.id), links);
  const groups = partition.groups.map((actors, index) => {
    const groupMessages = data.messages.filter(message => actors.includes(message.actorId));
    return { id: `group-${index + 1}`, actors, messageIds: groupMessages.map(message => message.id), terms: contentTerms(groupMessages.map(message => message.text)) };
  });
  const membership = new Map(groups.flatMap(group => group.actors.map(actor => [actor, group.id] as const)));
  const crossLinks = links.filter(link => membership.get(link.from) !== membership.get(link.to));
  const bridges = data.actors.map(actor => ({ ...actor, group: membership.get(actor.id)!, crossLinks: crossLinks.filter(link => link.from === actor.id || link.to === actor.id), neighbors: new Set(links.filter(link => link.from === actor.id || link.to === actor.id).map(link => link.from === actor.id ? link.to : link.from)).size })).sort((a, b) => b.crossLinks.length - a.crossLinks.length || a.id.localeCompare(b.id));
  const topics = (semantics?.topics ?? []).map(topic => {
    const messageIds = new Set(semantics!.annotations.filter(item => item.topicIds.includes(topic.id)).map(item => item.messageId));
    const topicMessages = data.messages.filter(message => messageIds.has(message.id));
    const related = links.filter(link => messageIds.has(link.messageId) && messageIds.has(link.parentId));
    return { ...topic, messageIds: [...messageIds], actorCount: new Set(topicMessages.map(message => message.actorId)).size,
      groups: groups.map(group => ({ groupId: group.id, count: topicMessages.filter(message => membership.get(message.actorId) === group.id).length })),
      conversationLinks: related, crossGroupLinks: related.filter(link => membership.get(link.from) !== membership.get(link.to)),
      timeline: topicMessages.slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id)).map(message => ({ messageId: message.id, timestamp: message.timestamp, groupId: membership.get(message.actorId)! })),
    };
  });
  return { links, unresolved, selfReplies, groups, modularity: partition.modularity, crossLinks, bridges, topics };
}
