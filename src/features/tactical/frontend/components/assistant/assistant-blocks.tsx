"use client";
import { useState } from "react";
import { ArrowUpRight, Check, SlidersHorizontal } from "lucide-react";
import { priceExperiment } from "../../../domain/finance-report";
import type { AssistantBlock, AssistantProposal, AssistantTarget } from "../../../domain/assistant";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(cents / 100);
export function AssistantResult({ block, onLocate }: { block: AssistantBlock; onLocate: (target: AssistantTarget) => void }) {
  if (block.type === "price-test") return <PriceTest block={block}/>;
  return <section className={`assistant-result assistant-result-${block.type}`} aria-label={block.title}>
    <header><h3>{block.title}</h3><span>Source data · calculated</span></header>
    {block.type === "metrics" && <div className="assistant-metrics">{block.items.map(item => <div key={item.label}><small>{item.label}</small><strong>{item.value}</strong></div>)}</div>}
    {block.type === "table" && <div className="assistant-table-scroll" tabIndex={0} role="region" aria-label={`${block.title} table`}><table><thead><tr>{block.columns.map(column => <th key={column}>{column}</th>)}<th><span className="floor-screen-reader">Locate</span></th></tr></thead><tbody>{block.rows.map((row, index) => <tr key={index}>{row.cells.map((cell, column) => <td key={column}>{cell}</td>)}<td>{row.target && <button type="button" className="assistant-locate-icon" aria-label={`Locate ${row.label}`} title={`Locate ${row.label}`} onClick={() => onLocate(row.target!)}><ArrowUpRight size={16}/></button>}</td></tr>)}</tbody></table>{!block.rows.length && <p>No matching records.</p>}</div>}
    {block.type === "chart" && <div className="assistant-stock-chart">{block.rows.map((row, index) => <button key={index} onClick={() => onLocate(row.target)} aria-label={`Locate ${row.label}: ${row.detail}`}><span><b>{row.label}</b><small>{row.detail}</small></span><span className="assistant-chart-track" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, row.value))}%` }}/></span><strong>{row.value.toFixed(0)}%</strong></button>)}{!block.rows.length && <p>No selected items are below their reorder points.</p>}</div>}
    <p className="assistant-result-note">{block.note}</p>
  </section>;
}
function PriceTest({ block }: { block: Extract<AssistantBlock, { type: "price-test" }> }) {
  const [raise, setRaise] = useState(0), [loss, setLoss] = useState(4);
  const result = priceExperiment(block.priceCents, block.costCents, block.units, raise, loss / 100);
  return <section className="assistant-result assistant-price" aria-label={`Price test for ${block.title}`}>
    <header><h3><SlidersHorizontal size={16}/>{block.title}</h3><span>Simulation</span></header>
    <p className="assistant-result-note">{block.period} · {block.units.toLocaleString()} dine-in units · base price {money(block.priceCents)}</p>
    <label>Price increase <output>{money(raise)}</output><input aria-label={`Price increase for ${block.title}`} type="range" min={0} max={block.maxRaiseCents} step={1} value={raise} onChange={event => setRaise(Number(event.target.value))}/></label>
    <label>Customers lost per 10% price rise <output>{loss}%</output><input aria-label="Price test customer loss" type="range" min={0} max={100} step={1} value={loss} onChange={event => setLoss(Number(event.target.value))}/></label>
    <div className="assistant-metrics" role="status"><div><small>New price</small><strong>{money(result.nextPriceCents)}</strong></div><div><small>Period contribution change</small><strong className={result.changeCents < 0 ? "is-negative" : ""}>{result.changeCents > 0 ? "+" : ""}{money(result.changeCents)}</strong></div><div><small>Break-even customer loss</small><strong>{result.breakEvenLoss === null ? "Unavailable" : `${(result.breakEvenLoss * 100).toFixed(1)}%`}</strong></div></div>
    <details><summary>Assumptions & formula</summary><p>{block.note}</p><p>Lost share = chosen loss × (raise ÷ current price) ÷ 10%, capped at 100%. Change = units × [(1 − lost share) × (new price − ingredient cost) − (current price − ingredient cost)]. Ingredient costs stay fixed. This is not a demand forecast.</p></details>
  </section>;
}
export function AssistantChange({ proposal, busy, stale, storage, onApply, onLocate }: { proposal: AssistantProposal; busy: boolean; stale: boolean; storage: string; onApply: (value: number) => void; onLocate: (target: AssistantTarget) => void }) {
  const cents = proposal.unit === "USD cents", scale = cents ? 100 : 1;
  const [value, setValue] = useState(String(proposal.value / scale));
  const number = Number(value) * scale;
  const valid = value.trim() !== "" && Number.isFinite(number) && number >= proposal.min && number <= proposal.max && (!cents || Math.abs(number - Math.round(number)) < .000001);
  const applied = proposal.status === "applied";
  return <section className="assistant-change" aria-label={`Change ${proposal.label}`}>
    <header><span>{applied ? <Check size={16}/> : <SlidersHorizontal size={16}/>} {applied ? "Saved change" : "Review change"}</span><small>{storage === "mongodb" ? "MongoDB" : "Server session"}</small></header>
    <h3>{proposal.label}</h3><p>{proposal.fieldLabel} · currently {cents ? money(proposal.before) : `${proposal.before} ${proposal.unit}`}</p>
    {applied ? <strong>{cents ? money(proposal.value) : `${proposal.value} ${proposal.unit}`}</strong> : <label>{proposal.fieldLabel} ({cents ? "USD" : proposal.unit})<input aria-label={`${proposal.fieldLabel} for ${proposal.label}`} type="number" min={proposal.min / scale} max={proposal.max / scale} step={proposal.step / scale} value={value} disabled={busy || stale} onChange={event => setValue(event.target.value)}/></label>}
    {!applied && <p className="assistant-result-note">{stale ? "The source data changed. Ask for a fresh preview." : "Applies only this field to the shared demo restaurant. No order, payment or live menu update is sent."}</p>}
    {applied ? <button onClick={() => onLocate(proposal.target)} className="button ai-button compact">View updated record <ArrowUpRight size={14}/></button> : <button className="button ai-button compact" disabled={busy || stale || !valid} onClick={() => onApply(cents ? Math.round(number) : number)}>Apply change</button>}
  </section>;
}
