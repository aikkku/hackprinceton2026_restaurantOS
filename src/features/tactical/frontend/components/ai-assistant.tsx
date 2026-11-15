"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowUpRight, Check, History, MessageSquare, Plus, Sparkles, X } from "lucide-react";
import { z } from "zod";
import { conversationSchema, assistantSuggestions, type Conversation, type ConversationSummary, type AssistantTarget } from "../../domain/assistant";
import { datasetSchema, type Dataset } from "../../domain/dataset";
import type { Layout } from "../../domain/schemas";
import type { LayoutLibrary } from "../../domain/layout-library";
import { useAiAccess } from "./ai-workbench";
import { AssistantResult, AssistantChange } from "./assistant/assistant-blocks";
import "./assistant/assistant.css";
const responseSchema = z.object({ ok: z.literal(true), thread: conversationSchema.optional(), threads: z.array(z.object({ id: z.uuid(), title: z.string(), updatedAt: z.string(), revision: z.number() })).optional(), storage: z.enum(["mongodb", "session"]), dataset: datasetSchema, datasetRevision: z.number().int(), replayed: z.boolean().optional() });

export function AiAssistant({ dataset, layout, layoutVersions, active, onDataset, onLocate }: { dataset: Dataset; layout: Layout; layoutVersions: LayoutLibrary; active: boolean; onDataset: (data: Dataset, revision: number) => void; onLocate: (target: AssistantTarget) => void }) {
  const unlocked = useAiAccess(), restaurantId = dataset.profile.id;
  const [threads, setThreads] = useState<ConversationSummary[]>([]), [thread, setThread] = useState<Conversation | null>(null);
  const [draft, setDraft] = useState(""), [pending, setPending] = useState(""), [error, setError] = useState("");
  const [storage, setStorage] = useState<"mongodb" | "session">("session"), [historyOpen, setHistoryOpen] = useState(true), [loaded, setLoaded] = useState(false), [revision, setRevision] = useState(0);
  const request = useRef<AbortController | null>(null), end = useRef<HTMLDivElement>(null), generation = useRef(0);
  const unsent = useRef<{ threadId: string; messageId: string; text: string } | null>(null);
  const selectionKey = `restaurantos:assistant:last:${restaurantId}`;
  const remember = useCallback((id: string) => { try { localStorage.setItem(selectionKey, id); } catch { /* Server history remains available. */ } }, [selectionKey]);
  const accept = useCallback((body: z.infer<typeof responseSchema>) => {
    setStorage(body.storage); setRevision(body.datasetRevision); onDataset(body.dataset, body.datasetRevision);
    if (body.thread) { setThread(body.thread); remember(body.thread.id); setThreads(previous => [{ id: body.thread!.id, title: body.thread!.title, updatedAt: body.thread!.updatedAt, revision: body.thread!.revision }, ...previous.filter(row => row.id !== body.thread!.id)].slice(0, 30)); }
  }, [onDataset, remember]);
  useEffect(() => {
    if (!active || !unlocked || loaded) return;
    const controller = new AbortController();
    async function load() {
      setPending("history"); setError("");
      try {
        const response = await fetch(`/api/tactical/assistant?restaurantId=${encodeURIComponent(restaurantId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = responseSchema.parse(await response.json());
        setThreads(body.threads ?? []); accept(body);
        let selected = ""; try { selected = localStorage.getItem(selectionKey) ?? ""; } catch {}
        const id = body.threads?.find(row => row.id === selected)?.id ?? body.threads?.[0]?.id;
        if (id) { const response = await fetch(`/api/tactical/assistant?restaurantId=${encodeURIComponent(restaurantId)}&threadId=${id}`, { signal: controller.signal }); if (!response.ok) throw new Error(); accept(responseSchema.parse(await response.json())); }
        setLoaded(true);
      } catch { if (!controller.signal.aborted) setError("Something is wrong"); }
      finally { if (!controller.signal.aborted) setPending(""); }
    }
    void load(); return () => controller.abort();
  }, [active, unlocked, loaded, restaurantId, accept, selectionKey]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (active) end.current?.scrollIntoView({ block: "nearest" }); }, [active, thread?.messages.length, pending]);
  async function open(id: string) {
    if (pending) return;
    const seq = ++generation.current; request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setPending("history"); setError("");
    try { const response = await fetch(`/api/tactical/assistant?restaurantId=${encodeURIComponent(restaurantId)}&threadId=${id}`, { signal: controller.signal }); if (!response.ok) throw new Error(); const body = responseSchema.parse(await response.json()); if (seq === generation.current) { accept(body); setDraft(""); unsent.current = null; } }
    catch { if (!controller.signal.aborted) setError("Something is wrong"); }
    finally { if (seq === generation.current) setPending(""); }
  }
  async function send(text = draft) {
    if (pending || !unlocked || !text.trim() || !loaded || (thread?.messages.length ?? 0) >= 60) return;
    const message = unsent.current?.text === text && (!thread || unsent.current.threadId === thread.id) ? unsent.current : { threadId: thread?.id ?? crypto.randomUUID(), messageId: crypto.randomUUID(), text };
    unsent.current = message; setDraft(text); setPending("message"); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/tactical/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "message", restaurantId, ...message, layout, layoutVersions }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(85_000)]) });
      if (!response.ok) throw new Error();
      const body = responseSchema.parse(await response.json()); accept(body); setDraft(""); unsent.current = null;
      const answer = body.thread?.messages.at(-1); if (answer?.navigate && answer.targets.length === 1 && !body.replayed) onLocate(answer.targets[0]);
    } catch { if (!controller.signal.aborted) setError("Something is wrong"); }
    finally { setPending(""); }
  }
  async function apply(messageId: string, proposalId: string, value: number) {
    if (pending || !thread) return; setPending("apply"); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const response = await fetch("/api/tactical/assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", restaurantId, threadId: thread.id, messageId, proposalId, value }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      if (response.status === 409) { setError("The data changed. Ask for a fresh preview before applying."); return; }
      if (!response.ok) throw new Error(); accept(responseSchema.parse(await response.json()));
    } catch { if (!controller.signal.aborted) setError("Something is wrong"); }
    finally { setPending(""); }
  }
  return <section className={`assistant-chat ${historyOpen ? "with-history" : ""}`} aria-label="AI restaurant advisor">
    {historyOpen && <aside className="assistant-history" aria-label="Chat history"><header><span><History size={16}/>Your chats</span><button aria-label="Hide chat history" onClick={() => setHistoryOpen(false)}><X size={16}/></button></header><button className="assistant-new-chat" disabled={!!pending} onClick={() => { setThread(null); setDraft(""); setError(""); unsent.current = null; remember(""); }}><Plus size={16}/>New chat</button><div className="assistant-thread-list">{threads.map(row => <button key={row.id} disabled={!!pending} aria-current={thread?.id === row.id ? "true" : undefined} onClick={() => void open(row.id)}><MessageSquare size={14}/><span>{row.title}<small>{new Date(row.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small></span></button>)}{loaded && !threads.length && <p>Your conversations will appear here.</p>}</div><small className="assistant-storage">{storage === "mongodb" ? "Saved to MongoDB · latest 30 chats" : "Server session · resets on restart"}</small></aside>}
    <div className="assistant-conversation">
      <header className="assistant-chat-header"><div>{!historyOpen && <button aria-label="Show chat history" onClick={() => setHistoryOpen(true)}><History size={18}/></button>}<span className="assistant-avatar"><Sparkles size={19}/></span><div><strong>Sprout assistant</strong><small>{dataset.profile.name}</small></div></div><span className="assistant-save-state">{pending ? "Working…" : thread ? <><Check size={13}/>{storage === "mongodb" ? "Saved" : "Session saved"}</> : "Connected to your data"}</span></header>
      <div className="assistant-messages" role="log" aria-label="Conversation messages" aria-live="polite" tabIndex={0}>
        {!thread && !pending && <div className="assistant-welcome"><span><Sparkles size={28}/></span><h2>What would you like to work on?</h2><p>Find an answer, test an idea, or update your restaurant.</p><div className="assistant-suggestions">{assistantSuggestions(dataset).map((suggestion, index) => <button key={suggestion} disabled={!unlocked || !loaded} onClick={() => void send(suggestion)}><span>{["Find a record", "Understand stock", "Try a price change", "Explore feedback"][index]}</span>{suggestion}<ArrowUpRight size={16}/></button>)}</div></div>}
        {thread?.messages.map(message => <article key={message.id} className={`assistant-message from-${message.role}`} aria-label={message.role === "user" ? "Your message" : "Assistant response"}>
          <div className="assistant-message-label">{message.role === "assistant" ? <><Sparkles size={14}/>Sprout</> : "You"}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</time></div>
          <p className="assistant-message-text">{message.text}</p>
          {message.role === "assistant" && <><div className="assistant-tools">{message.blocks.map((block, index) => <AssistantResult key={index} block={block} onLocate={onLocate}/>)}{message.proposals.map(proposal => <AssistantChange key={proposal.id} proposal={proposal} busy={!!pending || !unlocked} stale={proposal.datasetRevision !== revision} storage={storage} onApply={value => void apply(message.id, proposal.id, value)} onLocate={onLocate}/>)}</div>{message.targets.length > 0 && <div className="assistant-targets">{message.targets.slice(0, 4).map(target => <button key={`${target.kind}:${target.id}`} onClick={() => onLocate(target)}><ArrowUpRight size={13}/>{target.label}</button>)}</div>}<small className="assistant-source">AI interpretation · source revision {message.datasetRevision}{message.datasetRevision !== revision ? " · historical snapshot" : ""}</small></>}
        </article>)}
        {pending === "message" && <><article className="assistant-message from-user"><div className="assistant-message-label">You</div><p className="assistant-message-text">{draft}</p></article><div className="assistant-thinking" role="status"><Sparkles size={16}/>Checking your restaurant data…</div></>}
        {pending === "history" && <p className="assistant-thinking" role="status">Loading saved conversations…</p>}
        <div ref={end}/>
      </div>
      <footer className="assistant-compose-area">
        {!unlocked && <p className="assistant-access-note">Unlock the AI workspace above to open saved chats and use the assistant.</p>}
        {error && <div className="assistant-error" role="alert">{error}{!loaded && <button onClick={() => { setError(""); setLoaded(false); void openHistoryRetry(); }}>Retry</button>}</div>}
        <form className="assistant-composer" onSubmit={event => { event.preventDefault(); void send(); }}><textarea aria-label="Ask your restaurant advisor" placeholder="Ask about your restaurant…" value={draft} maxLength={3000} rows={2} disabled={!unlocked || !!pending} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }}/><button aria-label="Send message" disabled={!unlocked || !loaded || !!pending || !draft.trim() || (thread?.messages.length ?? 0) >= 60}><ArrowUp size={19}/></button></form>
        <p className="assistant-compose-note">{(thread?.messages.length ?? 0) >= 60 ? "This chat is full. Start a new chat to continue." : "AI can make mistakes. Sources and calculations stay linked. Changes need Apply."}</p>
      </footer>
    </div>
  </section>;
  async function openHistoryRetry() {
    // Reset through a fresh mount-independent load attempt.
    setPending("history");
    try { const response = await fetch(`/api/tactical/assistant?restaurantId=${encodeURIComponent(restaurantId)}`); if (!response.ok) throw new Error(); const body = responseSchema.parse(await response.json()); setThreads(body.threads ?? []); accept(body); setLoaded(true); setError(""); } catch { setError("Something is wrong"); } finally { setPending(""); }
  }
}
