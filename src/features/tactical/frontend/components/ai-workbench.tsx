"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { aiError, aiResultSchema, type AiRequest, type AiResult, type AiSuccess } from "../../domain/ai";
import { StateButton } from "./state-button";
import "./ai.css";

const Access = createContext(false);
const AccessControls = createContext<ReactNode>(null);
export function AiAccessControls() { return useContext(AccessControls); }
export function AiAccessProvider({ children, renderControls = true }: { children: ReactNode; renderControls?: boolean }) {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/tactical/ai/session", { signal: controller.signal }).then(response => response.json()).then(data => setUnlocked(data.unlocked === true)).catch(() => {});
    return () => controller.abort();
  }, []);
  async function access(lock = false) {
    setPending(true); setError(false);
    try {
      const response = await fetch("/api/tactical/ai/session", { method: lock ? "DELETE" : "POST", headers: { "Content-Type": "application/json" }, body: lock ? undefined : JSON.stringify({ password }) });
      if (!response.ok) throw new Error(aiError);
      setUnlocked(!lock); setPassword("");
    } catch { setError(true); } finally { setPending(false); }
  }
  const controls = (
    <details className="ai-access ai-surface">
      <summary><Sparkles size={16} aria-hidden="true" /> AI workspace · {unlocked ? "Unlocked" : "Locked"}</summary>
      <p>Purple marks AI controls, interpretations and drafts. Generating sends the selected Tactical context to Google Gemini. Nothing is published or applied automatically.</p>
      {unlocked ? <StateButton className="button ai-button compact" disabled={pending} onClick={() => void access(true)}>Lock AI</StateButton> : <form onSubmit={event => { event.preventDefault(); void access(); }}>
        <label>AI access code<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <p>Use your workspace’s AI access code. It is never saved in browser storage.</p>
        <StateButton className="button ai-button compact" disabled={pending} type="submit">{pending ? "Unlocking…" : "Unlock AI"}</StateButton>
      </form>}
      {error && <p role="alert">{aiError}</p>}
    </details>
  );
  return <Access.Provider value={unlocked}>
    <AccessControls.Provider value={controls}>
      {renderControls && controls}
      {children}
    </AccessControls.Provider>
  </Access.Provider>;
}
export const useAiAccess = () => useContext(Access);

type Props = {
  title: string; description: string; request: AiRequest; inputLabel?: string;
  compact?: boolean;
  onInspect?: (ids: string[]) => void;
  onPreview?: (moves: AiResult["moves"], source: { model: string; generatedAt: string }) => void;
  onCustomObject?: (object: NonNullable<AiResult["customObject"]>, source: { model: string; generatedAt: string }) => void;
};
export function AiWorkbench({ title, description, request, inputLabel = "Instructions for AI (optional)", compact = false, onInspect, onPreview, onCustomObject }: Props) {
  const unlocked = useAiAccess();
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AiSuccess | null>(null);
  const [requestKey, setRequestKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const input = { ...request, question: [request.question, question].filter(Boolean).join("\n").slice(0, 3000) };
  const key = JSON.stringify(input);
  const stale = Boolean(result && key !== requestKey);
  async function generate() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setPending(true); setError(false); setResult(null); setCopied(false);
    try {
      const response = await fetch("/api/tactical/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: AbortSignal.any([current.signal, AbortSignal.timeout(70_000)]) });
      if (!response.ok) throw new Error(aiError);
      const data = await response.json() as AiSuccess;
      if (!data.ok) throw new Error(aiError);
      aiResultSchema.parse(data.result);
      if (controller.current !== current) return;
      setResult(data); setRequestKey(key); setDraft(data.result.draft ?? "");
    } catch { if (!current.signal.aborted) setError(true); }
    finally { if (controller.current === current) setPending(false); }
  }
  return <section className="ai-workbench ai-surface" aria-label={title}>
    {!compact && <div className="ai-heading"><Sparkles size={19} aria-hidden="true" /><h3>{title}</h3><span className="ai-badge">AI</span></div>}
    {description && <p>{description}</p>}
    {!compact && <>
      <label>{inputLabel}<textarea value={question} maxLength={2500} onChange={event => setQuestion(event.target.value)} rows={2} /></label>
      <p className="ai-note">Uses mock restaurant data and, where supplied, the current working layout. AI interpretations and estimated dimensions require review.</p>
    </>}
    {!unlocked && <p>Unlock the AI workspace to generate.</p>}
    <div className="button-row">
      <StateButton className="button ai-button compact" disabled={!unlocked || pending} onClick={() => void generate()}>{pending ? "Generating…" : "Generate with AI"}</StateButton>
      {pending && <button className="button ai-button compact" onClick={() => { controller.current?.abort(); setPending(false); }}>Cancel AI request</button>}
    </div>
    {error && <p className="ai-error" role="alert">{aiError}</p>}
    {result && <div className="ai-result">
      <p className="ai-result-meta">AI-generated · {result.model} · {new Date(result.generatedAt).toLocaleString()} {result.cached ? "· Cached analysis" : ""}</p>
      {stale && <p role="status">Context changed. Generate again before using this suggestion.</p>}
      <p>{result.result.summary}</p>
      {result.result.findings.map((finding, index) => <article className="ai-finding" key={index}>
        <h4>{finding.title}</h4><p className="ai-note">AI priority: {finding.priority} · AI confidence: {finding.confidence}</p>
        <p>{finding.explanation}</p><p><strong>Suggested action:</strong> {finding.action}</p><p><strong>Cost:</strong> {finding.cost}</p>
        <details><summary>Supporting evidence · {finding.evidenceIds.length}</summary>{finding.evidenceIds.map(id => {
          const item = result.evidence.find(source => source.id === id);
          return item ? <div key={id}><strong>{item.label}</strong><pre>{JSON.stringify(JSON.parse(item.detail), null, 2)}</pre></div> : null;
        })}</details>
        {onInspect && finding.evidenceIds.some(id => id.startsWith("object:")) && <StateButton className="button ai-button compact" disabled={stale} onClick={() => onInspect(finding.evidenceIds.filter(id => id.startsWith("object:")).map(id => id.slice(7)))}>Inspect cited objects</StateButton>}
      </article>)}
      {result.result.classifications.length > 0 && <div className="ai-classifications"><h4>AI interpretation of {result.result.classifications.length} supplied reviews</h4>{result.result.classifications.map(row => <article className="ai-finding" key={row.reviewId}>
        <strong>{row.reviewId} · {row.sentiment}</strong><blockquote>{row.quote}</blockquote><p>{row.themes.join(" · ")}</p>
        {row.menuItemIds.length > 0 && <p>Menu mentions: {row.menuItemIds.map(id => result.evidence.find(source => source.id === `menu:${id}`)?.label ?? id).join(", ")}</p>}
      </article>)}</div>}
      {result.result.draft !== null && <div className="ai-draft"><label>Edit AI draft<textarea value={draft} onChange={event => { setDraft(event.target.value); setCopied(false); }} rows={8} maxLength={12000} /></label>
        <button className="button ai-button compact" onClick={async () => { try { await navigator.clipboard.writeText(draft); setCopied(true); } catch { setError(true); } }}>Copy draft</button>{copied && <span role="status"> Copied</span>}<p>Draft only. Review it before sharing; no reply or job is posted.</p>
      </div>}
      {result.result.customObject && <div className="ai-finding"><h4>Suggested object · estimated dimensions</h4><p>{result.result.customObject.name} · {result.result.customObject.width} × {result.result.customObject.depth} m · {result.result.customObject.category}</p><p>{result.result.customObject.description}</p>{onCustomObject && <StateButton className="button ai-button compact" disabled={stale} onClick={() => onCustomObject(result.result.customObject!, result)}>Use object suggestion</StateButton>}</div>}
      {result.result.moves.length > 0 && <div className="ai-finding"><h4>Proposed layout changes</h4>{result.result.moves.map(move => <p key={move.objectId}>{move.objectId}: {move.reason}</p>)}{onPreview && <StateButton className="button ai-button compact" disabled={stale} onClick={() => onPreview(result.result.moves, result)}>Preview AI layout</StateButton>}</div>}
      <details><summary>AI limitations</summary><ul>{result.result.limitations.map((limit, index) => <li key={index}>{limit}</li>)}</ul></details>
    </div>}
  </section>;
}
