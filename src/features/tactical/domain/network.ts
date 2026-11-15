import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9:_-]{1,100}$/);
export const networkSchema = z.object({
  version: z.literal(1), name: z.string().trim().min(1).max(150), provenance: z.enum(["synthetic", "observed"]),
  permission: z.string().trim().min(10).max(1000),
  nodes: z.array(z.object({ id: identifier, kind: z.enum(["author", "post", "topic"]), label: z.string().trim().min(1).max(100) }).strict()).max(100),
  edges: z.array(z.object({ id: identifier, from: identifier, to: identifier, relation: z.enum(["authored", "commented", "liked", "tagged"]), evidenceId: identifier }).strict()).max(300),
  evidence: z.array(z.object({ id: identifier, source: z.string().trim().min(1).max(200), recordId: z.string().trim().min(1).max(200), observedAt: z.iso.datetime(), excerpt: z.string().trim().min(1).max(1000), url: z.string().max(2000).refine(value => value === "" || /^https:\/\//.test(value) && URL.canParse(value), "Use an HTTPS evidence URL or leave blank") }).strict()).max(300),
}).strict().superRefine((graph, ctx) => {
  for (const field of ["nodes", "edges", "evidence"] as const) if (new Set(graph[field].map(item => item.id)).size !== graph[field].length) ctx.addIssue({ code: "custom", path: [field], message: "IDs must be unique" });
  const nodes = new Map(graph.nodes.map(node => [node.id, node])); const sources = new Set(graph.evidence.map(item => item.id)); const relations = new Set<string>();
  graph.edges.forEach((edge, index) => {
    const from = nodes.get(edge.from); const to = nodes.get(edge.to);
    if (!from || !to || edge.from === edge.to || !sources.has(edge.evidenceId)) ctx.addIssue({ code: "custom", path: ["edges", index], message: "Edges require two different existing nodes and source evidence" });
    const validTypes = edge.relation === "tagged" ? from?.kind === "post" && to?.kind === "topic" : from?.kind === "author" && to?.kind === "post";
    if (!validTypes) ctx.addIssue({ code: "custom", path: ["edges", index], message: "Invalid relationship direction or node kinds" });
    const key = `${edge.from}|${edge.to}|${edge.relation}`;
    if (relations.has(key)) ctx.addIssue({ code: "custom", path: ["edges", index], message: "Duplicate relationship; aggregate repeated comments into one relationship" });
    relations.add(key);
  });
});
export type Network = z.infer<typeof networkSchema>;
export function analyzeNetwork(input: Network) {
  const graph = networkSchema.parse(input);
  const neighbors = new Map(graph.nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of graph.edges) { neighbors.get(edge.from)!.add(edge.to); neighbors.get(edge.to)!.add(edge.from); }
  const visited = new Set<string>(); const components: string[][] = [];
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    const members: string[] = []; const queue = [node.id]; visited.add(node.id);
    for (let i = 0; i < queue.length; i++) { const id = queue[i]; members.push(id); for (const neighbor of neighbors.get(id)!) if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); } }
    components.push(members.sort());
  }
  const ranked = graph.nodes.map(node => ({ ...node, degree: neighbors.get(node.id)!.size, evidenceIds: [...new Set(graph.edges.filter(edge => edge.from === node.id || edge.to === node.id).map(edge => edge.evidenceId))] })).sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  const topics = graph.nodes.filter(node => node.kind === "topic").map(topic => {
    const tagEdges = graph.edges.filter(edge => edge.relation === "tagged" && edge.to === topic.id);
    const posts = new Set(tagEdges.map(edge => edge.from));
    const interactions = graph.edges.filter(edge => posts.has(edge.to) && ["commented", "liked"].includes(edge.relation));
    return { ...topic, posts: posts.size, engagedAuthors: new Set(interactions.map(edge => edge.from)).size, evidenceIds: [...new Set([...tagEdges, ...interactions].map(edge => edge.evidenceId))] };
  }).sort((a, b) => b.engagedAuthors - a.engagedAuthors || a.id.localeCompare(b.id));
  return { nodeCount: graph.nodes.length, edgeCount: graph.edges.length, components, isolated: ranked.filter(node => node.degree === 0).length, ranked, topics };
}
export const networkInterpretationSchema = z.object({ summary: z.string().min(1).max(1200), hypotheses: z.array(z.object({ action: z.string().min(1).max(700), rationale: z.string().min(1).max(1000), evidenceIds: z.array(identifier).min(1).max(10) })).max(3), limitations: z.array(z.string().min(1).max(600)).min(1).max(5) });
export type NetworkInterpretation = z.infer<typeof networkInterpretationSchema>;
