"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Ask Sprout" hand-off. Expansion has no connected advisor yet, so this
 * drawer shows exactly the question and the checked context an advisor
 * would receive — never a generated answer.
 */
export type AskContext = { question: string; context: unknown };

export function AskDrawer({ ask, onClose }: { ask: AskContext; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(ask.context, null, 2);
  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <button type="button" className="sx-backdrop" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <aside className="sx-drawer" role="dialog" aria-modal="true" aria-labelledby="sx-ask-title">
        <div className="sx-row" style={{ justifyContent: "space-between" }}>
          <h2 id="sx-ask-title" style={{ fontSize: 20 }}>Sprout’s advisor gets this</h2>
          <button ref={close} type="button" className="sx-btn sx-btn-secondary" onClick={onClose}>Close</button>
        </div>
        <p className="sx-small sx-muted">The advisor isn’t connected in Expansion yet. This is the question and the checked facts it would receive, so nothing it says could go beyond them.</p>
        <p className="sx-strong">“{ask.question}”</p>
        <pre>{text}</pre>
        <div><button type="button" className="sx-btn sx-btn-text" onClick={() => { void navigator.clipboard?.writeText(`${ask.question}\n\n${text}`).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? "Copied" : "Copy question and facts"}</button></div>
      </aside>
    </>
  );
}
