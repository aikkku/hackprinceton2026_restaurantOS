"use client";
import { useState } from "react";
import type { Assumptions } from "../../domain/schemas";
import type { Operations } from "../../domain/dataset";
import { channelContribution, summarizeLedger } from "../../domain/finance";
import { simulateSeating } from "../../domain/scenario";

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function FinancePage({ assumptions, operations, restaurantName }: { assumptions: Assumptions; operations: Operations; restaurantName: string }) {
  const [tab, setTab] = useState("overview");
  const [month, setMonth] = useState("");
  const [channel, setChannel] = useState("");
  const [kind, setKind] = useState("");
  const [ascending, setAscending] = useState(false);
  const [seats, setSeats] = useState(6);
  const [priceChange, setPriceChange] = useState(5);
  const [volumeChange, setVolumeChange] = useState(-5);
  const [itemId, setItemId] = useState(operations.menu[0]?.id ?? "");
  const [pricingChannel, setPricingChannel] = useState<"dine-in" | "delivery">("dine-in");
  const months = [...new Set(operations.transactions.map(t => t.date.slice(0, 7)))].sort();
  const rows = operations.transactions.filter(t => (!month || t.date.startsWith(month)) && (!channel || t.channel === channel) && (!kind || t.kind === kind)).sort((a, b) => (ascending ? 1 : -1) * (a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
  const totals = summarizeLedger(rows);
  const capacity = simulateSeating(0, seats, assumptions);
  const item = operations.menu.find(m => m.id === itemId) ?? operations.menu[0];
  const baseline = item ? channelContribution(item, pricingChannel) : null;
  const candidate = item && baseline ? channelContribution(item, pricingChannel, Math.round(baseline.priceCents * (1 + priceChange / 100))) : null;
  const candidateQuantity = item ? Math.round(item.quantity * (1 + volumeChange / 100)) : 0;
  return <section className="finance-page">
    <div className="section-header"><div><h2>Financial Intelligence</h2><p>{restaurantName} · synthetic USD ledger</p></div><span className="pill">Demo data</span></div>
    <div className="tab-bar">{["overview", "transactions", "pricing", "simulator"].map(t => <button className={`tab-btn ${tab === t ? "tab-active" : ""}`} key={t} onClick={() => setTab(t)}>{t === "pricing" ? "Menu Pricing" : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
    <div className="assumption-grid">
      <label>Month<select value={month} onChange={e => setMonth(e.target.value)}><option value="">All months</option>{months.map(m => <option key={m}>{m}</option>)}</select></label>
      <label>Channel<select value={channel} onChange={e => setChannel(e.target.value)}><option value="">All channels</option>{["dine-in", "delivery", "takeaway", "shared"].map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Record type<select value={kind} onChange={e => setKind(e.target.value)}><option value="">Income and expenses</option><option value="income">Income</option><option value="expense">Expenses</option></select></label>
    </div>
    <div className="kpi-row">{[["Recorded income", totals.revenueCents], ["Recorded expenses", totals.expenseCents], ["Income less expenses", totals.netRecordedCents], ["Delivery income", totals.deliveryCents]].map(([label, value]) => <div className="kpi-card" key={label}><div><span className="kpi-value">{money(Number(value))}</span><span className="kpi-label">{label}</span></div></div>)}</div>
    <p className="chart-note">Totals reflect {rows.length} selected synthetic ledger rows. Income less recorded expenses is not verified net profit or cash balance. Service summaries are not individual orders, so average order value is unavailable. No taxes, tips, refunds or opening cash balance are modeled.</p>
    {tab === "overview" && <>
      <div className="chart-panel"><h3>Recorded income by month</h3>{months.map(m => {
        const value = summarizeLedger(rows.filter(r => r.date.startsWith(m))).revenueCents;
        const max = Math.max(1, ...months.map(key => summarizeLedger(rows.filter(r => r.date.startsWith(key))).revenueCents));
        return <div key={m}><span>{m} · {money(value)}</span><progress aria-label={`${m} income`} max={max} value={value} style={{ width: "100%" }} /></div>;
      })}</div>
      <details><summary>Sources and calculations</summary><p>Source: fixture-operations. Revenue is the sum of selected income amounts; expenses are the sum of selected expense amounts. Amounts are stored in integer USD cents. Channel filtering excludes shared expenses unless shared/all is selected; no allocation is assumed. No gross profit is calculated because expense recognition/COGS coverage is not established.</p></details>
      <p className="section-footnote">Nessie remains unconnected. These records are fictional, including when stored in MongoDB.</p>
    </>}
    {tab === "transactions" && <div className="transaction-table-wrap"><button className="button secondary compact" onClick={() => setAscending(v => !v)}>Sort date {ascending ? "descending" : "ascending"}</button>
      <table className="transaction-table"><caption>Selected ledger · {rows.length} records</caption><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Type</th><th>Channel</th><th>Amount</th></tr></thead><tbody>{rows.map(t => <tr key={t.id}><td>{t.date}</td><td>{t.description}</td><td>{t.category}</td><td>{t.kind}</td><td>{t.channel}</td><td>{money(t.amountCents)}</td></tr>)}</tbody></table>{!rows.length && <p>No records match these filters.</p>}</div>}
    {tab === "pricing" && <>
      <div className="pricing-table-wrap"><table className="pricing-table"><caption>Assumed unit economics · excludes labor, tax and fixed costs</caption><thead><tr><th>Item</th><th>Dine-in</th><th>Delivery</th><th>Ingredients</th><th>Packaging</th><th>Delivery commission</th><th>Dine-in contribution</th><th>Delivery contribution</th></tr></thead><tbody>{operations.menu.map(m => <tr key={m.id}><td>{m.name}</td><td>{money(m.dineInPriceCents)}</td><td>{money(m.deliveryPriceCents)}</td><td>{money(m.ingredientCostCents)}</td><td>{money(m.packagingCostCents)}</td><td>{m.deliveryCommissionFraction * 100}%</td><td>{money(channelContribution(m, "dine-in").contributionCents)}</td><td>{money(channelContribution(m, "delivery").contributionCents)}</td></tr>)}</tbody></table></div>
      <h3>Fictional comparable prices</h3><div className="comparison-scroll"><table className="comp-table"><thead><tr><th>Source</th><th>Comparable item</th><th>Price</th><th>Observation date (demo)</th><th>Method</th></tr></thead><tbody>{operations.competitors.map(c => <tr key={c.id}><td>{c.restaurant}</td><td>{c.item}</td><td>{money(c.priceCents)}</td><td>{c.observedOn}</td><td>{c.sourceId} · {c.approximate ? "Approximate" : "Exact"} sample comparison</td></tr>)}</tbody></table></div>
    </>}
    {tab === "simulator" && <>
      <div className="simulator-panel"><h3>Capacity what-if</h3><label>Additional seats: {seats}<input type="range" min={0} max={30} value={seats} onChange={e => setSeats(Number(e.target.value))} /></label>
        <p>Monthly revenue change: {money(capacity.incrementalRevenuePerMonth * 100)} · Contribution: {money(capacity.incrementalContributionPerMonth * 100)} · Payback: {capacity.simplePaybackMonths === null ? "Unavailable" : `${capacity.simplePaybackMonths.toFixed(1)} months`}</p>
        <details><summary>Capacity assumptions</summary><p>{assumptions.turnsPerDay} turns/day × {assumptions.occupancyFraction * 100}% occupancy × ${assumptions.averageCheck} spend × {assumptions.operatingDaysPerMonth} days. Contribution margin {assumptions.incrementalContributionMargin * 100}%; investment ${assumptions.investmentCost}. Uses dataset defaults, not an unsaved Floor Plan experiment. Requires enough extra demand; fixed costs and displacement are excluded.</p></details>
      </div>
      <div className="simulator-panel"><h3>Price and demand experiment</h3>{item && baseline && candidate ? <>
        <div className="assumption-grid"><label>Menu item<select value={item.id} onChange={e => setItemId(e.target.value)}>{operations.menu.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label><label>Pricing channel<select value={pricingChannel} onChange={e => setPricingChannel(e.target.value as "dine-in" | "delivery")}><option value="dine-in">Dine-in</option><option value="delivery">Delivery</option></select></label></div>
        <label>Price change: {priceChange}%<input type="range" min={-50} max={50} value={priceChange} onChange={e => setPriceChange(Number(e.target.value))} /></label>
        <label>Assumed volume change: {volumeChange}%<input type="range" min={-100} max={100} value={volumeChange} onChange={e => setVolumeChange(Number(e.target.value))} /></label>
        <p>Candidate price {money(candidate.priceCents)}; assumed units {item.quantity} → {candidateQuantity}; contribution change {money(candidate.contributionCents * candidateQuantity - baseline.contributionCents * item.quantity)}.</p>
        <details><summary>Pricing calculation</summary><p>Unit contribution = price − ingredients − (delivery percentage commission + packaging for delivery). Period contribution = unit contribution × assumed units. This is a user-defined candidate, not an AI recommendation or guaranteed profit increase. Menu quantities are separate synthetic scenario assumptions, not reconciled item sales from the summary ledger.</p></details>
      </> : <p>Add menu records to the dataset to compare prices.</p>}</div>
    </>}
  </section>;
}
