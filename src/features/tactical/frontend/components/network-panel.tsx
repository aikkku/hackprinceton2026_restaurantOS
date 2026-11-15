"use client";
import { useEffect, useRef, useState } from "react";
import { analyzeNetwork, networkSchema, networkInterpretationSchema, type Network, type NetworkInterpretation } from "../../domain/network";
import demo from "../data/demo-network.json";
import { useAiAccess } from "./ai-workbench";
import { StateButton } from "./state-button";
import "./sponsor-tools.css";

const defaultGraph = networkSchema.parse(demo);
export function NetworkPanel({ restaurantId }: { restaurantId: string }) {
  const [graph, setGraph] = useState<Network>(defaultGraph); const [relation, setRelation] = useState("");
  const [focusedEvidence, setFocusedEvidence] = useState<string[]>([]);
  const [selected, setSelected] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [permission, setPermission] = useState(false);
  const [ai, setAi] = useState<{ result: NetworkInterpretation; model: string; generatedAt: string } | null>(null);
  const [pending, setPending] = useState(false); const [aiError, setAiError] = useState(false);
  const controller = useRef<AbortController | null>(null); const unlocked = useAiAccess();
  useEffect(() => () => controller.current?.abort(), []);
  const storageKey = `restaurantos:tactical:network:v1:${restaurantId}`;
  const visible: Network = { ...graph, edges: graph.edges.filter(edge => !relation || edge.relation === relation) };
  const metrics = analyzeNetwork(visible);
  const selectedEdges = visible.edges.filter(edge => (!selected || edge.from === selected || edge.to === selected) && (!focusedEvidence.length || focusedEvidence.includes(edge.evidenceId)));
  const evidenceIds = new Set(selectedEdges.map(edge => edge.evidenceId));
  const positions = new Map(graph.nodes.map((node, index) => {
    const angle = (index / Math.max(1, graph.nodes.length)) * Math.PI * 2 - Math.PI / 2;
    return [node.id, { x: Math.round((350 + 230 * Math.cos(angle)) * 100) / 100, y: Math.round((210 + 150 * Math.sin(angle)) * 100) / 100 }];
  }));
  function resetAi() { controller.current?.abort(); controller.current = null; setPending(false); setAi(null); setAiError(false); }
  function replaceGraph(next: Network) { resetAi(); setGraph(next); setFocusedEvidence([]); setRelation(""); setSelected(""); setError(""); }
  async function importFile(file: File | undefined) {
    if (!file) return;
    setError(""); setMessage("");
    try {
      if (file.size > 512 * 1024) throw new Error("Use a JSON file under 512 KB.");
      const result = networkSchema.safeParse(JSON.parse(await file.text()));
      if (!result.success) throw new Error(`Invalid network: ${result.error.issues.slice(0, 3).map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      if (result.data.provenance === "observed" && !permission) throw new Error("Confirm permission before importing observed relationship data.");
      replaceGraph(result.data); setMessage("Imported locally. Save in this browser to reopen later. Nothing was uploaded.");
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof SyntaxError) ? cause.message : "Invalid JSON file."); }
  }
  function save() { try { localStorage.setItem(storageKey, JSON.stringify(graph)); setMessage("Network saved in this browser."); setError(""); } catch { setError("Browser storage is unavailable or full. Download a JSON backup instead."); } }
  function reopen() { try { const raw = localStorage.getItem(storageKey); if (!raw) throw new Error(); replaceGraph(networkSchema.parse(JSON.parse(raw))); setMessage("Reopened the saved browser network."); } catch { setError("No valid saved network was found. Current work is unchanged."); } }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tactical-network.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  async function interpret() {
    resetAi(); const current = new AbortController(); controller.current = current; setPending(true);
    try {
      const response = await fetch("/api/tactical/integrations/network", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(visible), signal: current.signal });
      if (!response.ok) throw new Error();
      const data = await response.json(); const result = networkInterpretationSchema.parse(data.result);
      if (controller.current === current) setAi({ result, model: data.model, generatedAt: data.generatedAt });
    } catch { if (!current.signal.aborted) setAiError(true); }
    finally { if (controller.current === current) setPending(false); }
  }
  return <section className="sponsor-tool" aria-label="Relationship network">
    <div className="section-header"><div><h3>From conversations to connected evidence</h3><p>{graph.provenance === "synthetic" ? "Restaurant conversations" : graph.name}</p></div></div>
    <details><summary>Import, save and export a network</summary><div className="network-import"><p>{graph.permission}</p><p>Download the sample to see the versioned JSON format. Supply pseudonymous authors, posts, explicit topics and source records. Each relationship needs its own evidence link. No scraping occurs. Imports stay in this browser unless you explicitly request AI analysis.</p>
      <label className="checkbox"><input type="checkbox" checked={permission} onChange={event => setPermission(event.target.checked)} />I have permission to use this observed dataset and have removed unnecessary personal details.</label>
      <label>Import network JSON<input type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <div className="button-row"><button className="button secondary compact" onClick={save}>Save network locally</button><button className="button secondary compact" onClick={reopen}>Reopen saved network</button><button className="button secondary compact" onClick={download}>Download network JSON</button><button className="button quiet compact" onClick={() => { replaceGraph(defaultGraph); setMessage("Default network loaded. Saved browser data was not changed."); }}>Reset network</button></div>
    </div></details>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <div className="review-network-workspace"><aside className="review-network-controls"><div className="assumption-grid"><label>Relationship filter<select value={relation} onChange={event => { resetAi(); setFocusedEvidence([]); setRelation(event.target.value); }}><option value="">All relationships</option>{["authored", "commented", "liked", "tagged"].map(kind => <option key={kind}>{kind}</option>)}</select></label><label>Inspect node<select value={selected} onChange={event => { setSelected(event.target.value); setFocusedEvidence([]); }}><option value="">All nodes</option>{graph.nodes.map(node => <option key={node.id} value={node.id}>{node.label} · {node.kind}</option>)}</select></label></div>
    <div className="network-metrics"><span>{metrics.nodeCount} nodes</span><span>{metrics.edgeCount} relationships</span><span>{metrics.components.length} connected components</span><span>{metrics.isolated} isolated nodes</span></div>
    </aside><figure className="review-network-figure">{!graph.nodes.length ? <p>No nodes in this dataset. Import a network to begin.</p> : <svg className="network-chart" viewBox="0 0 700 420" role="img" aria-label="Relationship graph. Use the node selector and table below for all details.">{visible.edges.map(edge => { const a = positions.get(edge.from)!; const b = positions.get(edge.to)!; return <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} opacity={selected && edge.from !== selected && edge.to !== selected ? .15 : .7} />; })}{graph.nodes.map(node => { const p = positions.get(node.id)!; return <g key={node.id}><circle cx={p.x} cy={p.y} r={selected === node.id ? 12 : 8} className={`node-${node.kind} ${selected === node.id ? "node-selected" : ""}`} /><text x={p.x} y={p.y + 26} textAnchor="middle">{node.label.length > 23 ? `${node.label.slice(0, 20)}…` : node.label}</text><title>{`${node.label} · ${node.kind}`}</title></g>; })}</svg>}
    <figcaption>Authors: green · posts: orange · topics: blue. Layout is illustrative; proximity has no analytical meaning. Metrics use the relationship filter; node selection only narrows the evidence shown.</figcaption></figure></div>
    <div className="transaction-table-wrap"><table className="transaction-table"><caption>Derived topic engagement · unique commenting or liking authors in this sample</caption><thead><tr><th>Topic</th><th>Tagged posts</th><th>Engaged authors</th><th>Evidence</th></tr></thead><tbody>{metrics.topics.map(topic => <tr key={topic.id}><td>{topic.label}</td><td>{topic.posts}</td><td>{topic.engagedAuthors}</td><td><StateButton className="button quiet compact" disabled={!topic.evidenceIds.length} onClick={() => { setSelected(""); setFocusedEvidence(topic.evidenceIds); }}>Browse {topic.evidenceIds.length} source records below</StateButton><small>{topic.evidenceIds.join(", ") || "No linked evidence"}</small></td></tr>)}</tbody></table></div>
    <details><summary>Node connections and network method</summary><p>Degree counts unique neighbors, ignoring direction and multiple relation kinds. Components use undirected connectivity, including isolated nodes. A connected component is not a detected social community. Topic engagement follows explicit post→topic tags and author→post likes/comments, counting each author once per topic. It does not measure influence, reach, purchases or sentiment.</p><table className="transaction-table"><thead><tr><th>Node</th><th>Kind</th><th>Neighbors</th></tr></thead><tbody>{metrics.ranked.map(node => <tr key={node.id}><td><button className="button quiet compact" onClick={() => { setSelected(node.id); setFocusedEvidence([]); }}>{node.label}</button></td><td>{node.kind}</td><td>{node.degree}</td></tr>)}</tbody></table></details>
    <details><summary>Relationship evidence · {selectedEdges.length} edges</summary><div className="network-evidence">{focusedEvidence.length > 0 && <button className="button quiet compact" onClick={() => setFocusedEvidence([])}>Clear topic evidence filter</button>}{selectedEdges.map(edge => <p key={edge.id}><strong>{edge.id}</strong>: {graph.nodes.find(node => node.id === edge.from)?.label} → {edge.relation} → {graph.nodes.find(node => node.id === edge.to)?.label} · source {edge.evidenceId}</p>)}{graph.evidence.filter(item => evidenceIds.has(item.id)).map(item => <article key={item.id}><strong>{item.id} · {item.source}</strong><p>{item.excerpt}</p><small>{item.recordId} · {item.observedAt}</small>{item.url && <p><a href={item.url} target="_blank" rel="noopener noreferrer">Open source record</a></p>}</article>)}{!selectedEdges.length && <p>No relationships match this selection.</p>}</div></details>
    <section className="ai-workbench ai-surface" aria-label="AI network interpretation"><h3>AI network interpretation</h3><p>Send the filtered graph and source excerpts to Gemini for cautious marketing hypotheses. Calculated counts remain deterministic. </p>
      {!unlocked && <p>Unlock the AI workspace above to generate.</p>}
      <StateButton className="button ai-button compact" disabled={!unlocked || pending || !visible.edges.length} onClick={() => void interpret()}>{pending ? "Interpreting…" : "Interpret network with AI"}</StateButton>
      {pending && <button className="button ai-button compact" onClick={resetAi}>Cancel AI request</button>}
      {aiError && <p role="alert">Something is wrong</p>}
      {ai && <div className="ai-result"><p>AI-generated · {ai.model} · {ai.generatedAt}</p><p>{ai.result.summary}</p>{ai.result.hypotheses.map((item, index) => <article key={index}><h4>{item.action}</h4><p>{item.rationale}</p><details><summary>Supporting evidence</summary>{item.evidenceIds.map(id => <p key={id}><strong>{id}</strong> · {graph.evidence.find(source => source.id === id)?.excerpt}</p>)}</details></article>)}<ul>{ai.result.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
    </section>
    <p className="section-footnote">Arlequin candidate · restaurant relationship explorer. This tab explores supplied relationship records. Open Content & connectivity for the Arlequin Track 2 pipeline: message themes, actor communities, source-linked conversation paths and a public-data importer.</p>
  </section>;
}
