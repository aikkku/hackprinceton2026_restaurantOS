"use client";
import { useState } from "react";
import type { Operations } from "../../domain/dataset";
import { summarizeLedger } from "../../domain/finance";
const money=(cents:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(cents/100);
export function FinanceLedger({ operations }: { operations: Operations }) {
  const [month,setMonth]=useState(""); const [channel,setChannel]=useState(""); const [kind,setKind]=useState("");
  const rows=operations.transactions.filter(row=>(!month||row.date.startsWith(month))&&(!channel||row.channel===channel)&&(!kind||row.kind===kind)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  const totals=summarizeLedger(rows);
  return <details className="fin-details fin-ledger"><summary>Recorded ledger · separate sample</summary><p>This historical ledger is separate from the item-sales report above. These totals are not added to report revenue. Income less recorded expenses is not verified net profit or cash balance.</p>
    <div className="fin-ledger-filters"><label>Month<select aria-label="Month" value={month} onChange={event=>setMonth(event.target.value)}><option value="">All months</option>{[...new Set(operations.transactions.map(row=>row.date.slice(0,7)))].sort().map(value=><option key={value}>{value}</option>)}</select></label><label>Channel<select aria-label="Channel" value={channel} onChange={event=>setChannel(event.target.value)}><option value="">All channels</option>{["dine-in","delivery","takeaway","shared"].map(value=><option key={value}>{value}</option>)}</select></label><label>Record type<select aria-label="Record type" value={kind} onChange={event=>setKind(event.target.value)}><option value="">Income and expenses</option><option value="income">Income</option><option value="expense">Expenses</option></select></label></div>
    <p>{rows.length} rows · Income {money(totals.revenueCents)} · Expenses {money(totals.expenseCents)} · Difference {money(totals.netRecordedCents)}</p><div className="fin-table-scroll" role="region" tabIndex={0} aria-label="Recorded transactions"><table className="fin-table transaction-table"><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Channel</th><th>Amount</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.date}</td><td>{row.description}</td><td>{row.kind}</td><td>{row.channel}</td><td>{money(row.amountCents)}</td></tr>)}</tbody></table>{!rows.length&&<p>No records match these filters.</p>}</div>
  </details>;
}
