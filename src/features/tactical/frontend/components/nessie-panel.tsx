"use client";
import { useRef, useState, useEffect } from "react";
import { cashPlan, cashPlanSchema, nessieFlows, nessieSnapshotSchema, type NessieSnapshot } from "../../domain/nessie";
import demo from "../data/demo-nessie.json";
import { useAiAccess } from "./ai-workbench";
import { StateButton } from "./state-button";
import "./sponsor-tools.css";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const defaultSnapshot = nessieSnapshotSchema.parse(demo);
export function NessiePanel() {
  const unlocked = useAiAccess();
  const [snapshot, setSnapshot] = useState<NessieSnapshot | null>(defaultSnapshot);
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [investment, setInvestment] = useState("4000"); const [reserve, setReserve] = useState("10000"); const [burn, setBurn] = useState("1500");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const values = [investment, reserve, burn];
  const valid = values.every(value => /^\d+(\.\d{1,2})?$/.test(value));
  const assumptions = cashPlanSchema.safeParse({ investmentCents: Math.round(Number(investment) * 100), reserveCents: Math.round(Number(reserve) * 100), monthlyBurnCents: Math.round(Number(burn) * 100) });
  const plan = snapshot && valid && assumptions.success ? cashPlan(snapshot, assumptions.data) : null;
  const flows = snapshot ? nessieFlows(snapshot) : null;
  async function refresh() {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setPending(true); setError(""); setSnapshot(null);
    try {
      const response = await fetch("/api/tactical/integrations/nessie", { method: "POST", signal: current.signal });
      if (!response.ok) throw new Error("Nessie is unavailable. Check the server configuration and retry. Demo data is available separately.");
      const data = await response.json(); const parsed = nessieSnapshotSchema.parse(data.snapshot);
      if (parsed.source !== "nessie-sandbox") throw new Error("Invalid source");
      if (controller.current === current) setSnapshot(parsed);
    } catch { if (!current.signal.aborted) setError("Nessie is unavailable. Check the server configuration and retry. Demo data is available separately."); }
    finally { if (controller.current === current) setPending(false); }
  }
  function exportScenario() {
    if (!snapshot || !plan || !assumptions.success) return;
    const payload = { version: 1, savedAt: new Date().toISOString(), snapshot, assumptions: assumptions.data, result: plan, limitations: "Sandbox USD; deposits/withdrawals only, not a complete ledger. Burn and reserve are user assumptions. No real bank funds move." };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tactical-cash-scenario.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <section className="sponsor-tool fin-bank" aria-label="Nessie sandbox finance">
    <div className="section-header"><div><h3>Can the cash cushion support this investment?</h3><p>Capital One Nessie · sandbox cash planning</p></div><span className="pill">{snapshot?.source === "nessie-sandbox" ? "Live API · simulated funds" : snapshot ? "Local demo · no API call" : "No snapshot loaded"}</span></div>
    <p>Compare an equipment or seating investment with a minimum reserve. This is a deterministic scenario, not AI or real banking.</p>
    <div className="button-row"><StateButton className="button primary compact" disabled={!unlocked || pending} onClick={() => void refresh()}>{pending ? "Reading Nessie…" : "Refresh from Nessie"}</StateButton><StateButton className="button secondary compact" disabled={pending} onClick={() => { setSnapshot(defaultSnapshot); setError(""); }}>Use local demo</StateButton></div>
    {!unlocked && <p>Unlock the AI workspace above to enable protected sandbox reads. The same workspace session protects both tools.</p>}
    {error && <p role="alert">{error}</p>}
    {snapshot && flows && <>
      <p className="section-footnote">{snapshot.account.nickname} · {snapshot.account.type} · snapshot {snapshot.fetchedAt}. USD is the scenario currency assumption.</p>
      <div className="kpi-row">{[["Sandbox balance", Math.round(snapshot.account.balance * 100)], ["Completed deposits", flows.depositCents], ["Completed withdrawals", flows.withdrawalCents]].map(([label, value]) => <div className="kpi-card" key={label}><div><span className="kpi-value">{money(Number(value))}</span><span className="kpi-label">{label}</span></div></div>)}</div>
      <p>All returned deposit/withdrawal dates · {flows.excluded} pending, cancelled or recurring records excluded. Deposits are not necessarily sales; withdrawals are not necessarily expenses. These flows do not reconcile the account balance.</p>
      <div className="assumption-grid">{[["Proposed investment (USD)", investment, setInvestment], ["Minimum reserve (USD)", reserve, setReserve], ["Assumed monthly net cash burn (USD)", burn, setBurn]].map(([label, value, setter]) => <label key={String(label)}>{String(label)}<input type="number" min="0" max="1000000000" step="0.01" value={String(value)} onChange={event => (setter as (value: string) => void)(event.target.value)} /></label>)}</div>
      {(!valid || !assumptions.success) && <p role="alert">Enter nonnegative USD amounts up to 1 billion, with at most two decimal places.</p>}
      {snapshot.account.type === "Credit Card" && <p role="status">Cash planning is unavailable for credit-card balances. Select a Checking or Savings account in server configuration.</p>}
      {plan && <div className={`sponsor-outcome ${plan.cushionCents < 0 ? "is-below" : "is-within"}`} role="status"><h4>{plan.cushionCents >= 0 ? "Within the assumed cash reserve" : "Below the assumed cash reserve"}</h4><p>Cash after investment: <strong>{money(plan.remainingCents)}</strong> · above/below reserve: <strong>{money(plan.cushionCents)}</strong></p><p>Months until reserve at assumed burn: {plan.runwayMonths === null ? "Unavailable (zero burn)" : plan.runwayMonths.toFixed(1)}. This is not a profitability or lending recommendation.</p><button className="button secondary compact" onClick={exportScenario}>Download cash scenario</button></div>}
      <details><summary>View banking evidence and formulas</summary><p>Source: {snapshot.source}. Account ID: {snapshot.account._id}. GET /accounts/:id, /deposits and /withdrawals. No purchases, transfers, bills, loans, taxes or future inflows are included. Current balance is used directly; historical flows are not added again. USD cents = round(provider amount × 100). Cash after investment = balance − investment. Cushion = cash after investment − reserve. Months = max(0, cushion) ÷ assumed monthly net cash burn; zero burn is unavailable.</p><div className="transaction-table-wrap" role="region" tabIndex={0} aria-label="Bank source records"><table className="transaction-table"><caption>Source records · provider IDs retained</caption><thead><tr><th>Date</th><th>Type / status</th><th>Description / evidence ID</th><th>USD</th></tr></thead><tbody>{(["deposits", "withdrawals"] as const).flatMap(kind => snapshot[kind].map(row => <tr key={`${kind}:${row._id}`}><td>{row.transaction_date}</td><td>{kind} · {row.status}</td><td>{row.description}<br /><small>{row._id}</small></td><td>{money(Math.round(row.amount * 100))}</td></tr>))}</tbody></table></div>{!snapshot.deposits.length && !snapshot.withdrawals.length && <p>No deposit or withdrawal records were returned.</p>}</details>
    </>}
  </section>;
}
