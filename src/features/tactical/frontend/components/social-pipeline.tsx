"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeSocial, socialDatasetSchema, validateSemantics, type SocialDataset, type Semantics } from "../../domain/social";
import { alignmentHeadline, issueAction, issueReason, issueSignals, issueSpread, operationsLinksApply, rankIssues, rankingFormulas, rankingHeadline, restaurantEvents, type IssueSpread, type RankingKey } from "../../domain/social-operations";
import type { Dataset } from "../../domain/dataset";
import type { AssistantTarget } from "../../domain/assistant";
import demo from "../data/demo-social.json";
import { StateButton } from "./state-button";
import { useAiAccess } from "./ai-workbench";
import "./social-pipeline.css";

const sample = socialDatasetSchema.parse(demo);
type Analysis = { semantics: Semantics; model: string; generatedAt: string; datasetHash: string; pipelineVersion: string };
function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
function SpreadStrip({ spread, totalGroups, label }: { spread: IssueSpread; totalGroups: number; label: string }) {
  if (!spread.days.length) return null;
  const width = 600, base = 56, height = 44, step = width / spread.days.length;
  const peak = Math.max(1, ...spread.days.map(day => day.mentions));
  const groupY = (groups: number) => base - (totalGroups ? groups / totalGroups : 0) * height;
  const line = spread.days.map((day, index) => `${index ? "L" : "M"}${index * step},${groupY(day.groupsSoFar)} L${(index + 1) * step},${groupY(day.groupsSoFar)}`).join(" ");
  const x = (date: string) => (spread.days.findIndex(day => day.date === date) + 0.5) * step;
  const first = spread.days[0], last = spread.days.at(-1)!;
  return <div className="social-spread">
    {spread.alignment && <p className="social-spread-headline">{alignmentHeadline(spread.alignment)}</p>}
    <svg viewBox={`0 0 ${width} 72`} role="img" aria-label={`${label}: ${spread.days.reduce((sum, day) => sum + day.mentions, 0)} mentions ${shortDate(first.date)}–${shortDate(last.date)}, customer groups reached ${first.groupsSoFar} → ${last.groupsSoFar} of ${totalGroups}${spread.events.length ? `; ${spread.events.length} restaurant events` : ""}`}>
      {spread.days.map((day, index) => day.mentions > 0 && <rect key={day.date} className="social-spread-bar" x={index * step + step * 0.2} width={step * 0.6} y={base - day.mentions / peak * height} height={day.mentions / peak * height}><title>{`${shortDate(day.date)}: ${day.mentions} mentions, ${day.groupsSoFar} groups reached`}</title></rect>)}
      <path className="social-spread-groups" d={line} />
      {spread.events.map(event => <line key={event.id} data-event={event.id} className={`social-spread-event ${spread.alignment?.event.id === event.id ? "is-aligned" : ""}`} x1={x(event.date)} x2={x(event.date)} y1={4} y2={base}><title>{`${shortDate(event.date)} · ${event.label}`}</title></line>)}
      <text x={0} y={70}>{shortDate(first.date)}</text><text x={width} y={70} textAnchor="end">{shortDate(last.date)}</text>
    </svg>
    <div className="social-spread-legend"><span className="key-mentions">Mentions per day</span><span className="key-groups">Customer groups reached</span>{spread.events.length > 0 && <span className="key-events">Restaurant events</span>}</div>
  </div>;
}
export function SocialPipeline({ restaurantId, dataset: restaurant, onLocate }: { restaurantId: string; dataset?: Dataset; onLocate?: (target: AssistantTarget) => void }) {
  const [dataset, setDataset] = useState<SocialDataset>(sample); const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [storyId, setStoryId] = useState("42302171"); const [permission, setPermission] = useState(false);
  const [topicId, setTopicId] = useState(""); const [groupId, setGroupId] = useState(""); const [query, setQuery] = useState("");
  const [selectedMessage, setSelectedMessage] = useState(""); const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const [pending, setPending] = useState<"source" | "ai" | null>(null); const [aiError, setAiError] = useState(false);
  const controller = useRef<AbortController | null>(null); const generation = useRef(0); const unlocked = useAiAccess();
  useEffect(() => () => controller.current?.abort(), []);
  const storageKey = `restaurantos:tactical:social:v1:${restaurantId}`;
  const metrics = useMemo(() => analyzeSocial(dataset, analysis?.semantics), [dataset, analysis]);
  const issues = useMemo(() => analysis ? rankIssues(issueSignals(dataset, metrics, analysis.semantics)) : [], [dataset, metrics, analysis]);
  const linksApply = Boolean(restaurant && onLocate) && operationsLinksApply(dataset);
  const actions = useMemo(() => {
    if (!analysis || !restaurant || !linksApply) return [];
    const texts = new Map(dataset.messages.map(message => [message.id, message.text]));
    const events = restaurantEvents(restaurant);
    return issues.filter(issue => issue.negativeMentions > 0).map(issue => {
      const meta = analysis.semantics.topics.find(item => item.id === issue.topicId)!;
      const topicMetrics = metrics.topics.find(item => item.id === issue.topicId)!;
      const action = issueAction(meta.area, topicMetrics.messageIds.map(id => texts.get(id)!), restaurant);
      return { issue, action, spread: issueSpread(topicMetrics.timeline, dataset, events, action) };
    });
  }, [analysis, restaurant, linksApply, dataset, issues, metrics]);
  const topic = metrics.topics.find(item => item.id === topicId);
  const groupByActor = new Map(metrics.groups.flatMap(group => group.actors.map(actor => [actor, group.id] as const)));
  const annotations = new Map(analysis?.semantics.annotations.map(item => [item.messageId, item]));
  const filtered = dataset.messages.filter(message => (!topic || topic.messageIds.includes(message.id)) && (!groupId || groupByActor.get(message.actorId) === groupId) && (!query || message.text.toLowerCase().includes(query.toLowerCase()))).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
  const selected = dataset.messages.find(message => message.id === selectedMessage);
  const positions = new Map(metrics.groups.flatMap((group, groupIndex) => group.actors.map((id, index) => {
    const angle = index / group.actors.length * Math.PI * 2;
    const groupAngle = groupIndex / metrics.groups.length * Math.PI * 2 - Math.PI / 2;
    return [id, { x: Math.round(350 + 205 * Math.cos(groupAngle) + 55 * Math.cos(angle)), y: Math.round(220 + 125 * Math.sin(groupAngle) + 45 * Math.sin(angle)), color: groupIndex % 5 }] as const;
  })));
  function cancel() { controller.current?.abort(); controller.current = null; generation.current++; setPending(null); }
  function replace(next: SocialDataset) { cancel(); setDataset(next); setAnalysis(null); setTopicId(""); setGroupId(""); setQuery(""); setSelectedMessage(""); setError(""); setAiError(false); }
  async function loadSource() {
    cancel(); const current = new AbortController(); controller.current = current; setPending("source"); setError(""); setStatus("");
    try {
      const response = await fetch("/api/tactical/integrations/social/source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storyId: Number(storyId) }), signal: current.signal });
      if (!response.ok) throw new Error();
      const data = socialDatasetSchema.parse((await response.json()).dataset);
      if (controller.current !== current) return;
      replace(data); setStatus("Observed public discussion loaded. AI analysis has not run; nothing was saved automatically.");
    } catch { if (!current.signal.aborted) setError("Public discussion could not be loaded. Check the story ID and retry. Current work is unchanged."); }
    finally { if (controller.current === current) setPending(null); }
  }
  async function analyze() {
    cancel(); const current = new AbortController(); controller.current = current; setPending("ai"); setAiError(false); setAnalysis(null); setTopicId("");
    try {
      const response = await fetch("/api/tactical/integrations/social/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(dataset), signal: current.signal });
      if (!response.ok) throw new Error(); const result = await response.json();
      const semantics = validateSemantics(dataset, result.semantics);
      if (controller.current === current) setAnalysis({ ...result, semantics });
    } catch { if (!current.signal.aborted) setAiError(true); }
    finally { if (controller.current === current) setPending(null); }
  }
  async function importFile(file: File | undefined) {
    if (!file) return; cancel(); const version = generation.current; setError(""); setStatus("");
    try {
      if (file.size > 512 * 1024) throw new Error("Use a JSON dataset under 512 KB.");
      const next = socialDatasetSchema.safeParse(JSON.parse(await file.text()));
      if (!next.success) throw new Error(`Invalid conversation: ${next.error.issues[0]?.message}`);
      if (next.data.provenance === "observed" && !permission) throw new Error("Confirm permission before importing observed messages.");
      if (version !== generation.current) return;
      replace(next.data); setStatus("Conversation imported locally. Previous AI results cleared.");
    } catch (cause) { if (version === generation.current) setError(cause instanceof Error && !(cause instanceof SyntaxError) ? cause.message : "Invalid JSON."); }
  }
  function save() { try { localStorage.setItem(storageKey, JSON.stringify(dataset)); setStatus("Conversation saved in this browser. Download the analysis report to retain AI results."); setError(""); } catch { setError("Could not save in this browser. Download the dataset instead."); } }
  function reopen() { try { const raw = localStorage.getItem(storageKey); if (!raw || raw.length > 512 * 1024) throw new Error(); replace(socialDatasetSchema.parse(JSON.parse(raw))); setStatus("Saved conversation reopened. Run AI again to interpret content."); } catch { setError("No valid saved conversation found. Current work is unchanged."); } }
  return <section className="sponsor-tool social-pipeline" aria-label="Content and connectivity pipeline">
    <div className="section-header"><div><h3>What is being said—and who connects the conversation?</h3></div></div>
    <ol className="social-steps"><li>Load messages + relationships</li><li>Calculate actor groups</li><li>Interpret message content</li><li>Join topics to connections</li></ol>
    <details><summary>Choose data, import or reopen</summary><div className="network-import"><p>Use the restaurant conversation, load a public Hacker News story, or import your own normalized messaging JSON. Maximum 40 messages. Public discussion is external context, not evidence about your restaurant’s customers.</p>
      <label>Hacker News story ID<input inputMode="numeric" pattern="[0-9]+" value={storyId} onChange={event => setStoryId(event.target.value)} /></label>
      <StateButton className="button secondary compact" disabled={!unlocked || pending !== null || !/^\d{1,10}$/.test(storyId)} onClick={() => void loadSource()}>Load public discussion</StateButton>
      {!unlocked && <p>Unlock the AI workspace above to enable protected public-source and AI requests.</p>}
      <label className="checkbox"><input type="checkbox" checked={permission} onChange={event => setPermission(event.target.checked)} />I have permission to use imported messages and have removed unnecessary personal details.</label>
      <label>Import conversation JSON<input type="file" accept=".json,application/json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
      <div className="button-row"><button className="button secondary compact" onClick={() => { replace(sample); setStatus("Default conversation loaded. Saved work is unchanged."); }}>Reset conversation</button><button className="button secondary compact" onClick={save}>Save conversation locally</button><button className="button secondary compact" onClick={reopen}>Reopen conversation</button><button className="button secondary compact" onClick={() => downloadJson("tactical-conversation.json", dataset)}>Download conversation JSON</button></div>
    </div></details>
    {pending === "source" && <p role="status">Reading a bounded sample from the official public API…</p>}{pending && <button className="button secondary compact" onClick={cancel}>Cancel pipeline request</button>}{error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <h4>{dataset.title}</h4><div className="network-metrics"><span>{dataset.messages.length} messages</span><span>{dataset.actors.length} actors</span><span>{metrics.links.length} explicit actor interactions</span><span>{metrics.groups.length} calculated groups</span><span>{metrics.crossLinks.length} cross-group interactions</span></div>
    <details><summary>Source and sampling evidence</summary><p>{dataset.source.name} · {dataset.source.retrievedAt}</p><p>{dataset.source.method}</p>{dataset.source.url && <a href={dataset.source.url} target="_blank" rel="noopener noreferrer">Open original discussion</a>}<ul>{dataset.source.limitations.map(item => <li key={item}>{item}</li>)}</ul><p>{metrics.unresolved} references point outside this sample; {metrics.selfReplies} same-author references are excluded from actor links. No missing relationship is inferred.</p></details>
    {!dataset.messages.length && <p>No messages to analyze. Import a conversation or load the sample.</p>}
    <section className="ai-workbench ai-surface" aria-label="AI semantic analysis"><h3>AI message themes and tone</h3><p>Send these {dataset.messages.length} message texts and reply references to Gemini. AI labels every message and supplies an exact source excerpt. Code then joins those labels to the observed actor graph. No messages are published.</p><StateButton className="button ai-button compact" disabled={!unlocked || pending !== null || !dataset.messages.length} onClick={() => void analyze()}>{pending === "ai" ? "Analyzing message content…" : "Analyze message content with AI"}</StateButton>{aiError && <p role="alert">Something is wrong</p>}{analysis && <><p>AI-generated · {analysis.model} · {analysis.generatedAt} · {analysis.semantics.annotations.length}/{dataset.messages.length} messages covered</p><ul>{analysis.semantics.limitations.map(item => <li key={item}>{item}</li>)}</ul></>}</section>
    <h4>Actor communities and conversation bridges</h4>
    <svg className="network-chart social-chart" viewBox="0 0 700 440" role="img" aria-label="Actor connections grouped by calculated community. The table and source messages provide accessible details.">{metrics.links.map(link => { const a = positions.get(link.from)!; const b = positions.get(link.to)!; return <line key={link.messageId} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={groupByActor.get(link.from) !== groupByActor.get(link.to) ? "social-cross-link" : ""} />; })}{dataset.actors.map(actor => { const p = positions.get(actor.id)!; return <g key={actor.id}><circle cx={p.x} cy={p.y} r={9} className={`social-group-${p.color}`} /><text x={p.x} y={p.y + 22} textAnchor="middle">{actor.label.slice(0, 24)}</text><title>{`${actor.label} · ${groupByActor.get(actor.id)}`}</title></g>; })}</svg>
    <p>Groups maximize modularity on weighted, undirected reply/repost connections. Dashed lines cross groups. This is a sample-dependent structural partition, not verified real-world communities or influence. Modularity: {metrics.modularity === null ? "unavailable (no links)" : metrics.modularity.toFixed(3)}. Graph distance has no meaning.</p>
    <div className="transaction-table-wrap"><table className="transaction-table"><caption>Connectivity groups joined with message content</caption><thead><tr><th>Group</th><th>Actors / messages</th><th>Frequent words (derived)</th><th>AI themes</th><th>Inspect</th></tr></thead><tbody>{metrics.groups.map(group => <tr key={group.id}><td>{group.id}</td><td>{group.actors.length} / {group.messageIds.length}</td><td>{group.terms.map(term => `${term.term} (${term.messageCount})`).join(", ") || "No English terms"}</td><td className={analysis ? "social-ai-cell" : ""}>{analysis ? metrics.topics.filter(topic => topic.groups.some(item => item.groupId === group.id && item.count > 0)).map(topic => `${topic.label}: ${topic.groups.find(item => item.groupId === group.id)!.count}`).join("; ") || "Unclassified" : "Run AI analysis"}</td><td><button className="button quiet compact" onClick={() => { setGroupId(group.id); setTopicId(""); setQuery(""); }}>View messages</button></td></tr>)}</tbody></table></div>
    <details><summary>Actors connecting groups · source-linked interactions</summary>{metrics.bridges.filter(actor => actor.crossLinks.length).map(actor => <article key={actor.id}><h4>{actor.label} · {actor.crossLinks.length} cross-group interactions</h4><p>{actor.neighbors} unique neighbors. Counts describe this sample, not influence or intent.</p>{actor.crossLinks.map(link => <button className="button quiet compact" key={link.messageId} onClick={() => setSelectedMessage(link.messageId)}>{link.kind} {link.messageId} → {link.parentId}</button>)}</article>)}{!metrics.crossLinks.length && <p>No cross-group interaction in this sample.</p>}</details>
    {analysis && <section className="ai-surface social-fix-first" aria-label="Fix first">
      <h3>Fix first</h3>
      <p className="social-fix-headline">{rankingHeadline(issues)}</p>
      <div className="transaction-table-wrap"><table className="transaction-table">        <thead><tr><th scope="col">Issue</th><th scope="col">Why</th>{(["content", "connectivity", "combined"] as RankingKey[]).map(key => <th scope="col" className="social-rank" key={key}>{rankingFormulas[key].label}</th>)}<th scope="col" className="social-rank">Messages</th></tr></thead>
        <tbody>{issues.map(issue => { const shift = issue.ranks.content - issue.ranks.combined; return <tr key={issue.topicId} data-issue={issue.topicId}>
          <th scope="row">{issue.label}</th><td>{issueReason(issue)}</td>
          <td className="social-rank">#{issue.ranks.content}</td><td className="social-rank">#{issue.ranks.connectivity}</td>
          <td className="social-rank"><strong>#{issue.ranks.combined}</strong>{shift !== 0 && <span className={`social-rank-shift ${shift > 0 ? "up" : "down"}`}>{shift > 0 ? "↑" : "↓"}{Math.abs(shift)} vs. text only</span>}</td>
          <td className="social-rank"><button className="button ai-button compact" onClick={() => { setTopicId(issue.topicId); setGroupId(""); setQuery(""); }} aria-label={`Trace ${issue.label}`}>Trace</button></td>
        </tr>; })}</tbody></table></div>
      {linksApply ? actions.length > 0 && <div className="social-fix-actions" aria-label="Where to fix it" role="group"><h4>Where to fix it</h4><ol>{actions.map(({ issue, action, spread }) => <li key={issue.topicId} data-action-issue={issue.topicId}>
        <span className="social-fix-issue">#{issue.ranks.combined} {issue.label}</span>
        {action ? <><span className="social-fix-record"><b>{action.page} · {action.record}</b><small>{action.detail}</small></span><button className="button secondary compact" onClick={() => onLocate!(action.target)}>Open in {action.page}</button></>
          : <span className="social-fix-record"><small>No matching record in this restaurant&apos;s data.</small></span>}
        <SpreadStrip spread={spread} totalGroups={issue.totalGroups} label={issue.label} />
      </li>)}</ol></div>
        : null}
    </section>}
    {analysis && <section className="ai-surface social-joined" aria-label="Content connectivity findings"><h3>Where AI themes meet observed connections</h3><p>Counts below are calculated from AI topic labels plus explicit reply/repost records. Same-topic replies show linked discussion; they do not prove adoption or information spread.</p>{metrics.topics.map(item => <article key={item.id}><h4>{item.label}</h4><p>{item.description}</p><p>{item.messageIds.length} messages · {item.actorCount} actors · {item.groups.filter(group => group.count).length} structural groups · {item.crossGroupLinks.length} same-topic cross-group interactions</p><button className="button ai-button compact" onClick={() => { setTopicId(item.id); setGroupId(""); setQuery(""); }}>Trace this theme</button><details><summary>Explicit message paths · {item.conversationLinks.length}</summary>{item.conversationLinks.map(link => <p key={link.messageId}><button className="button ai-button compact" onClick={() => setSelectedMessage(link.messageId)}>{link.parentId} → {link.messageId}</button> · {link.kind} · {link.timestamp}</p>)}{!item.conversationLinks.length && <p>Shared content only; no explicit same-topic message path in this sample.</p>}</details></article>)}</section>}
    <div className="assumption-grid"><label>Theme filter<select value={topicId} onChange={event => setTopicId(event.target.value)}><option value="">All themes</option>{metrics.topics.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Community filter<select value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">All groups</option>{metrics.groups.map(group => <option key={group.id}>{group.id}</option>)}</select></label><label>Search message text<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <p role="status">{filtered.length} of {dataset.messages.length} messages shown in time order. Filters affect the timeline; community calculations use the whole loaded sample.</p>
    {selected && <aside className="sponsor-outcome" aria-label="Selected message evidence"><h4>Selected evidence · {selected.id}</h4><p>{selected.text}</p><p>{selected.timestamp} · {selected.replyTo ? `Replies to ${selected.replyTo}` : selected.repostOf ? `Reposts ${selected.repostOf}` : "No supplied parent"}</p>{selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer">Open original message</a>}<button className="button quiet compact" onClick={() => setSelectedMessage("")}>Close selected evidence</button></aside>}
    <ol className="social-timeline" tabIndex={0} aria-label="Source messages in time order">{filtered.map(message => { const annotation = annotations.get(message.id); return <li key={message.id}><div className="review-meta"><strong>{message.id}</strong><span>{dataset.actors.find(actor => actor.id === message.actorId)?.label} · {groupByActor.get(message.actorId)}</span><time dateTime={message.timestamp}>{message.timestamp}</time></div><p>{message.text}</p><p>{message.replyTo ? `Reply to ${message.replyTo}` : message.repostOf ? `Repost of ${message.repostOf}` : "Root message"}</p>{annotation && <div className="ai-surface social-annotation"><span>AI tone: {annotation.tone} · {annotation.topicIds.map(id => analysis!.semantics.topics.find(topic => topic.id === id)!.label).join(" / ") || "Unclassified"}</span><p>Supporting excerpt: “{annotation.quote}”</p></div>}{message.url && <a href={message.url} target="_blank" rel="noopener noreferrer">View source message</a>}</li>; })}</ol>
    {!filtered.length && <p>No messages match these filters.</p>}
    <button className="button secondary compact" onClick={() => downloadJson("tactical-social-analysis.json", { version: 1, pipeline: "social-v1", dataset, analysis, metrics, exportedAt: new Date().toISOString(), limitations: "Connectivity is observed/synthetic as labeled. AI themes are interpretations; community groups are algorithmic. No coordination, causal diffusion, customer representativeness or business outcome is established." })}>Download analysis report</button>
  </section>;
}
