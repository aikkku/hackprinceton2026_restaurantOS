"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Send, Sparkles } from "lucide-react";
import { hiringDraftSchema, type HiringDraft } from "../../domain/hr";
import { hiringRoles } from "../../domain/workforce";
import { aiError } from "../../domain/ai";
import { useAiAccess } from "./ai-workbench";

export function HrHiring({ restaurantId }: { restaurantId: string }) {
  const unlocked = useAiAccess();
  const [role, setRole] = useState<(typeof hiringRoles)[number]>("Server");
  const [requirements, setRequirements] = useState("");
  const [draft, setDraft] = useState<HiringDraft | null>(null);
  const [sourceKey, setSourceKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const input = JSON.stringify({ restaurantId, task: "hire", role, requirements });
  const stale = Boolean(draft && input !== sourceKey);
  async function generate() {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setPending(true); setError(false); setCopied(false);
    try {
      const response = await fetch("/api/tactical/hr", { method: "POST", headers: { "Content-Type": "application/json" }, body: input, signal: AbortSignal.any([current.signal, AbortSignal.timeout(90_000)]) });
      if (!response.ok) throw new Error(aiError);
      const body = await response.json();
      const result = hiringDraftSchema.parse(body.result);
      if (!body.ok || result.role !== role) throw new Error(aiError);
      if (!current.signal.aborted) { setDraft(result); setSourceKey(input); }
    } catch { if (!current.signal.aborted) setError(true); }
    finally { if (!current.signal.aborted) setPending(false); }
  }
  function edit<K extends keyof HiringDraft>(key: K, value: HiringDraft[K]) { setDraft(previous => previous ? { ...previous, [key]: value } : previous); setCopied(false); }
  return <section className="hr-hiring" aria-label="Hire employees">
    <div className="hr-hiring-brief">
      <span className="hr-eyebrow"><Sparkles size={14} /> AI hiring assistant</span>
      <h3>Find your next teammate</h3><p>Build a role around your team, busiest shifts and customer feedback.</p>
      <label htmlFor="hr-hiring-position">Position<select id="hr-hiring-position" value={role} onChange={event => setRole(event.target.value as typeof role)}>{hiringRoles.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Your requirements<textarea rows={4} maxLength={3000} value={requirements} onChange={event => setRequirements(event.target.value)} placeholder="Availability, experience, responsibilities…" /></label>
      <button className="button ai-button" disabled={!unlocked || pending} title={!unlocked ? "Unlock the AI workspace first" : undefined} onClick={() => void generate()}><Sparkles size={15} />{pending ? "Drafting…" : draft ? "Update with AI" : "Draft with AI"}</button>
      {error && <p role="alert">{aiError}</p>}
    </div>
    <div className={`hr-job ${draft ? "has-draft" : ""}`}>
      {!draft ? <div className="hr-job-empty"><Sparkles size={28} /><h3>A job description that fits</h3><p>Choose a position to get an editable AI draft.</p></div> : <>
        <div className="hr-toolbar"><span className="hr-eyebrow"><Sparkles size={14} /> Editable AI draft</span><span className="pill">{draft.role}</span></div>
        {stale && <p role="status">Your brief changed. Update the draft to match.</p>}
        <label>Job title<input maxLength={160} value={draft.title} onChange={event => edit("title", event.target.value)} /></label>
        <div className="hr-form-row"><label>Employment<select value={draft.employmentType} onChange={event => edit("employmentType", event.target.value as HiringDraft["employmentType"])}><option>Part-time</option><option>Full-time</option></select></label><label>Hours / week<input type="number" min={1} max={40} value={draft.hoursPerWeek} onChange={event => edit("hoursPerWeek", Number(event.target.value))} /></label></div>
        <label>Pay estimate<input maxLength={160} value={draft.pay} onChange={event => edit("pay", event.target.value)} /></label>
        <label>Schedule<input maxLength={600} value={draft.schedule} onChange={event => edit("schedule", event.target.value)} /></label>
        <label>About the role<textarea rows={3} maxLength={1200} value={draft.summary} onChange={event => edit("summary", event.target.value)} /></label>
        <label>Responsibilities<textarea rows={4} value={draft.responsibilities.join("\n")} onChange={event => edit("responsibilities", event.target.value.split("\n"))} /></label>
        <label>Requirements<textarea rows={3} value={draft.requirements.join("\n")} onChange={event => edit("requirements", event.target.value.split("\n"))} /></label>
        <details className="hr-job-reason"><summary>AI rationale</summary><p>{draft.reason}</p><p>{draft.limitation}</p><small>Evidence: {draft.evidenceIds.join(" · ")}</small></details>
      </>}
      <div className="hr-job-actions"><button className="button ai-button compact" disabled={!draft || stale || !hiringDraftSchema.safeParse(draft).success} onClick={async () => {
        if (!draft) return;
        try { await navigator.clipboard.writeText(`${draft.title}\n${draft.employmentType} · ${draft.hoursPerWeek} hours/week\n${draft.pay}\n${draft.schedule}\n\n${draft.summary}\n\nResponsibilities\n${draft.responsibilities.map(row => `• ${row}`).join("\n")}\n\nRequirements\n${draft.requirements.map(row => `• ${row}`).join("\n")}`); setCopied(true); } catch { setError(true); }
      }}><Copy size={14} />{copied ? "Copied" : "Copy draft"}</button><button className="button quiet compact" disabled title="Demo only — Indeed posting is not connected"><Send size={14} />Post to Indeed</button></div>
    </div>
  </section>;
}
