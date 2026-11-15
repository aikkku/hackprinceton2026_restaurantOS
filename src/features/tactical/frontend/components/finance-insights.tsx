"use client";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { aiError, aiResultSchema, type AiResult, type AiEvidence } from "../../domain/ai";
import { useAiAccess } from "./ai-workbench";

export function FinanceInsights({ restaurantId, reportKey, active, onEvidence }: { restaurantId: string; reportKey: string; active: boolean; onEvidence: (evidence: AiEvidence[]) => void }) {
  const unlocked = useAiAccess();
  const [result, setResult] = useState<AiResult | null>(null);
  const [evidence, setEvidence] = useState<AiEvidence[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || !unlocked) return;
    const controller = new AbortController();
    async function generate() {
      setPending(true); setError(false); setResult(null);
      try {
        const response = await fetch("/api/tactical/ai", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ task:"finance", restaurantId, question:"Explain this restaurant's dated menu report in plain language. Give three evidence-linked observations with practical next steps. Include unprofitable ideas to avoid. Never invent competitor research." }), signal:AbortSignal.any([controller.signal,AbortSignal.timeout(70_000)]) });
        if (!response.ok) throw new Error(aiError);
        const body=await response.json(); if (!body.ok) throw new Error(aiError);
        const parsed=aiResultSchema.parse(body.result);
        if (!controller.signal.aborted) { setResult(parsed); setEvidence(Array.isArray(body.evidence) ? body.evidence : []); }
      } catch { if (!controller.signal.aborted) setError(true); }
      finally { if (!controller.signal.aborted) setPending(false); }
    }
    void generate(); return () => controller.abort();
  },[active, unlocked, restaurantId, reportKey, attempt]);
  return <section className="finance-insights" aria-label="AI report observations">
    <div className="fin-line"><span className="fin-ai-label"><Sparkles size={14} /> AI interpretation</span>{error && <button className="button ai-button compact" onClick={()=>setAttempt(value=>value+1)}>Retry</button>}</div>
    {!unlocked && <p>Unlock AI above to add observations from these numbers.</p>}
    {pending && <p role="status">Analyzing the supplied report…</p>}
    {error && <p role="alert">{aiError}</p>}
    {result && <><p className="fin-ai-summary">{result.summary}</p><div className="fin-insight-columns"><div><h3>What stood out</h3>{result.findings.map((finding,index)=><article key={index}><h4>{finding.title}</h4><p>{finding.explanation}</p><button className="fin-text-button" onClick={()=>onEvidence(finding.evidenceIds.map(id=>evidence.find(row=>row.id===id) ?? {id,label:id,detail:"Evidence was not returned by this response."}))}>View evidence</button></article>)}</div><div><h3>Things you could try</h3>{result.findings.map((finding,index)=><article key={index}><span className="fin-step">0{index+1}</span><p>{finding.action}</p></article>)}</div></div><details><summary>AI limitations</summary>{result.limitations.map((limit,index)=><p key={index}>{limit}</p>)}</details></>}
  </section>;
}
