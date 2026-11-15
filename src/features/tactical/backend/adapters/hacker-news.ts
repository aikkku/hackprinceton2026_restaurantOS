import { createHash } from "node:crypto";
import { z } from "zod";
import { socialDatasetSchema, type SocialDataset } from "../../domain/social.ts";

const itemSchema = z.object({ id: z.number().int().positive(), type: z.string(), by: z.string().optional(), time: z.number().int().nonnegative().optional(), title: z.string().optional(), text: z.string().optional(), parent: z.number().int().optional(), kids: z.array(z.number().int().positive()).optional(), deleted: z.boolean().optional(), dead: z.boolean().optional() });
export function plainHnText(html: string) {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return html.replace(/<[^>]*>/g, " ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
    if (!code.startsWith("#")) return entities[code.toLowerCase()] ?? match;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : " ";
  }).replace(/\s+/g, " ").trim().slice(0, 3000);
}
export async function loadHackerNews(storyId: number, { fetcher = fetch, signal }: { fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<SocialDataset> {
  z.number().int().positive().max(2_000_000_000).parse(storyId);
  const timeout = AbortSignal.any([AbortSignal.timeout(25_000), ...(signal ? [signal] : [])]); let requests = 0; let skipped = 0;
  const get = async (id: number) => {
    requests++;
    const response = await fetcher(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { signal: timeout, redirect: "error", cache: "no-store" });
    if (!response.ok || !response.body) throw new Error("Public source unavailable");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 200_000) { await reader.cancel(); throw new Error("Source record too large"); } chunks.push(value); }
    const raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (raw === null) return null;
    const item = itemSchema.parse(raw); if (item.id !== id) throw new Error("Source ID mismatch"); return item;
  };
  const root = await get(storyId);
  if (!root || root.type !== "story" || root.dead || root.deleted || !root.by || root.time === undefined || !root.title) throw new Error("Select an available public story");
  const actors = new Map<string, SocialDataset["actors"][number]>(); const messages: SocialDataset["messages"] = [];
  function add(item: z.infer<typeof itemSchema>, text: string, parent: number | null) {
    const actorId = `hn:${createHash("sha256").update(`${storyId}:${item.by}`).digest("hex").slice(0, 16)}`;
    if (!actors.has(actorId)) actors.set(actorId, { id: actorId, label: `Participant ${actors.size + 1}` });
    messages.push({ id: `hn:${item.id}`, actorId, text, timestamp: new Date(item.time! * 1000).toISOString(), url: `https://news.ycombinator.com/item?id=${item.id}`, replyTo: parent === null ? null : `hn:${parent}`, repostOf: null });
  }
  add(root, plainHnText(`${root.title} ${root.text ?? ""}`), null);
  const seen = new Set([root.id]);
  for (const child of (root.kids ?? []).slice(0, 6)) {
    let accepted = 0; const stack = [{ id: child, parent: root.id, depth: 1 }];
    while (stack.length && accepted < 5 && requests < 48) {
      const next = stack.pop()!; if (seen.has(next.id)) continue; seen.add(next.id);
      const item = await get(next.id);
      if (!item || item.type !== "comment" || item.deleted || item.dead || !item.by || item.time === undefined || item.parent !== next.parent || !plainHnText(item.text ?? "")) { skipped++; continue; }
      add(item, plainHnText(item.text!), item.parent); accepted++;
      if (next.depth < 4) for (const id of (item.kids ?? []).slice(0, 5).reverse()) stack.push({ id, parent: item.id, depth: next.depth + 1 });
    }
  }
  return socialDatasetSchema.parse({ version: 1, id: `hn-story-${storyId}`, title: root.title.slice(0, 200), provenance: "observed", actors: [...actors.values()], messages,
    source: { name: "Hacker News official public API", url: `https://news.ycombinator.com/item?id=${storyId}`, retrievedAt: new Date().toISOString(),
      method: "Observed story and parent-linked comments via the official Firebase API. First six ranked top-level branches; depth-first up to five available comments per branch, depth four, at most 48 item reads. Actor names replaced with thread-scoped pseudonyms; source links retain attribution.",
      limitations: [`Bounded, nonrandom sample: ${messages.length} messages; ${skipped} unavailable/deleted/dead/invalid records skipped. Descendants of skipped records are omitted.`, "Comments are public discussion, not this restaurant's customers or representative market research. Source links can reveal public account names; pseudonyms are not anonymization.", "Message text is plain text, truncated at 3,000 characters. Root content is the submitted title/text, not the linked article. Replies indicate conversation, not endorsement or causal diffusion."] } });
}
