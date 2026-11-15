"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Sprout } from "lucide-react";
import { MAX_HISTORY_MESSAGES, MAX_QUESTION_LENGTH, type AdvisorContext, type AdvisorRequest, type AdvisorResponse } from "../../domain/advisor.ts";
import { askAdvisor } from "../data/advisor-client.ts";
import "./ask.css";

export type AskContext = { question: string; context: AdvisorContext };
type Exchange = { question: string; response: AdvisorResponse };

export function AskDrawer({ ask, onClose }: { ask: AskContext; onClose: () => void }) {
  const drawer = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(ask.question);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState("");

  const answer = useCallback(async (input: AdvisorRequest, signal: AbortSignal) => {
    try {
      const response = await askAdvisor(input, signal);
      if (signal.aborted) return;
      setExchanges(old => [...old, { question: input.question, response }]);
      setPendingQuestion(null);
      setError("");
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : "Sprout couldn’t answer. Please retry.");
    } finally { if (!signal.aborted) setPending(false); }
  }, []);

  useEffect(() => {
    const active = new AbortController();
    controller.current = active;
    void Promise.resolve().then(() => {
      if (!active.signal.aborted) return answer({ question: ask.question, context: ask.context, history: [] }, active.signal);
    });
    return () => { controller.current?.abort(); };
  }, [ask, answer]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    drawer.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const focusable = drawer.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, summary, a[href]");
      if (!focusable?.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const log = transcript.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [exchanges, pending, error]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || value.length > MAX_QUESTION_LENGTH || pending) return;
    const history = exchanges.flatMap(exchange => [
      { role: "user" as const, text: exchange.question }, { role: "assistant" as const, text: exchange.response.answer },
    ]).slice(-MAX_HISTORY_MESSAGES);
    const active = new AbortController();
    controller.current = active;
    setQuestion(""); setPendingQuestion(value); setPending(true); setError("");
    void answer({ question: value, context: ask.context, history }, active.signal);
  };

  return (
    <>
      <button type="button" className="sx-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside ref={drawer} className="sx-drawer sx-ask-drawer" role="dialog" aria-modal="true" aria-labelledby="sx-ask-title" aria-describedby="sx-ask-description">
        <div className="sx-row sx-ask-heading">
          <span className="sx-ask-avatar" aria-hidden="true"><Sprout size={22} /></span>
          <h2 id="sx-ask-title">Ask Sprout</h2>
          <button type="button" className="sx-btn sx-btn-secondary" onClick={onClose}>Close</button>
        </div>
        <p id="sx-ask-description" className="sx-small sx-muted">Ask anything, with your current place and plan as context. Questions and context are sent to Google Gemini. This conversation lasts until you close it.</p>
        {ask.context.propertyData.synthetic && <p className="sx-notice sx-small">This workspace uses synthetic test property data.</p>}
        <div ref={transcript} className="sx-ask-transcript" role="log" aria-label="Conversation with Sprout" aria-live="polite" aria-relevant="additions text">
          {exchanges.map((exchange, index) => <div className="sx-ask-exchange" key={index}>
            <div className="sx-ask-message sx-ask-user"><strong>You</strong><p>{exchange.question}</p></div>
            <div className="sx-ask-message sx-ask-answer"><strong>Sprout</strong><p>{exchange.response.answer}</p>
              {exchange.response.limitations.length > 0 && <ul className="sx-small sx-muted">{exchange.response.limitations.map((line, i) => <li key={i}>{line}</li>)}</ul>}
              <small className="sx-muted">AI interpretation · {exchange.response.model}</small>
              {exchange.response.evidenceIds.length > 0 && <details className="sx-small"><summary>Evidence referenced</summary><ul>{exchange.response.evidenceIds.map(id => <li key={id}>{id}</li>)}</ul></details>}
            </div>
          </div>)}
          {pendingQuestion && <div className="sx-ask-message sx-ask-user"><strong>You</strong><p>{pendingQuestion}</p></div>}
          {pending && <p className="sx-small sx-muted" role="status">Sprout is thinking…</p>}
        </div>
        <div className="sx-ask-compose">
          {error && <div className="sx-notice sx-notice-bad sx-small" role="alert"><p>{error}</p>
            {pendingQuestion && <button type="button" className="sx-btn sx-btn-text" onClick={() => send(pendingQuestion)}>Retry answer</button>}
          </div>}
          <form onSubmit={event => { event.preventDefault(); send(question); }}>
            <label className="sx-sr" htmlFor="sx-ask-question">Your question</label>
            <textarea id="sx-ask-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={MAX_QUESTION_LENGTH}
              placeholder="Ask a follow-up or any question…" rows={2} onKeyDown={event => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(question); }
              }} />
            <button type="submit" className="sx-btn sx-btn-primary" disabled={pending || !question.trim()} aria-label="Send question"><ArrowUp size={20} /></button>
          </form>
          <details className="sx-small sx-muted"><summary>Context sent to Sprout</summary><pre>{JSON.stringify(ask.context, null, 2)}</pre></details>
        </div>
      </aside>
    </>
  );
}
