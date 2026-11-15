"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Sparkles, Send } from "lucide-react";
import { aiError, aiResultSchema } from "../../domain/ai";
import { useAiAccess } from "./ai-workbench";
import { StateButton } from "./state-button";

export function ReviewReply({ restaurantId, reviewId }: { restaurantId: string; reviewId: string }) {
  const unlocked = useAiAccess();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function generate() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setPending(true); setError(false); setCopied(false);
    try {
      const response = await fetch("/api/tactical/ai", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "reply", restaurantId, reviewId, question: "Write a concise, thoughtful public response to this review. Do not promise compensation or claim actions have been taken." }),
        signal: AbortSignal.any([current.signal, AbortSignal.timeout(70_000)]),
      });
      if (!response.ok) throw new Error(aiError);
      const body = await response.json();
      const result = aiResultSchema.parse(body.result);
      if (!body.ok || !result.draft?.trim()) throw new Error(aiError);
      if (!current.signal.aborted) setDraft(result.draft);
    } catch { if (!current.signal.aborted) setError(true); }
    finally { if (!current.signal.aborted) setPending(false); }
  }
  return <div className="review-reply" aria-label={`Reply to ${reviewId}`}>
    <div className="review-reply-actions">
      <StateButton className="button review-ai-button compact" disabled={!unlocked || pending} title={unlocked ? "Generate an editable draft" : "Unlock the AI workspace first"} onClick={() => void generate()}><Sparkles size={14} />{pending ? "Generating…" : draft === null ? "Draft with AI" : "Regenerate"}</StateButton>
      <StateButton className="button quiet compact" disabled title="Direct posting is not connected"><Send size={13} />Reply</StateButton>
    </div>
    {error && <p className="review-ai-error" role="alert">{aiError}</p>}
    {draft !== null && <div className="review-reply-draft">
      <label>AI response draft<textarea aria-label={`AI response draft for ${reviewId}`} value={draft} onChange={event => { setDraft(event.target.value); setCopied(false); }} rows={4} maxLength={8000} /></label>
      <button className="button review-ai-button compact" onClick={async () => {
        try { await navigator.clipboard.writeText(draft); setCopied(true); setError(false); } catch { setError(true); }
      }}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy"}</button>
      {copied && <span className="floor-screen-reader" role="status">Response copied</span>}
    </div>}
  </div>;
}
