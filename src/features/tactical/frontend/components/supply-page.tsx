"use client";

import { useState } from "react";
import { Search, ChevronDown, Package } from "lucide-react";
import type { Operations } from "../../domain/dataset";
import { stockStatus } from "../../domain/finance";
import "./supply.css";
const statusLabels = { good: "In stock", low: "Low stock", critical: "Critical stock", overstock: "Overstock" };
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function SupplyPage({ operations }: { operations: Operations; restaurantName: string }) {
  const [category, setCategory] = useState("All categories");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All stock");
  const inventory = operations.inventory.map(item => ({ ...item, status: stockStatus(item.current, item.threshold) }));
  const categories = ["All categories", ...new Set(inventory.map(item => item.category))];
  const filtered = inventory.filter(item => (category === "All categories" || item.category === category) && (status === "All stock" || item.status === status) && item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const belowThreshold = inventory.filter(item => item.current < item.threshold).length;
  return <section className="supply-inventory" aria-label="Inventory">
    <header className="supply-heading"><div><span className="supply-eyebrow">SUPPLY MANAGEMENT</span><h2>Everything on hand.</h2></div><span className="pill">Demo inventory</span></header>
    <div className="supply-summary"><span><strong>{inventory.length}</strong> items tracked</span><span><strong>{belowThreshold}</strong> below reorder point</span><span><strong>{inventory.filter(item => item.nextDelivery).length}</strong> awaiting delivery</span></div>
    <div className="supply-filters">
      <label className="supply-search"><Search size={16} aria-hidden="true" /><input aria-label="Search inventory" placeholder="Search inventory…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="Inventory category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Inventory stock status" value={status} onChange={event => setStatus(event.target.value)}><option>All stock</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <p className="supply-result-count" role="status">{filtered.length} {filtered.length === 1 ? "item" : "items"}</p>
    <div className="supply-item-grid">{filtered.map(item => <article className="supply-item" key={item.id} data-inventory-id={item.id}>
      <header><span>{item.category}</span><span className={`supply-stock supply-stock-${item.status}`}><i />{statusLabels[item.status]}</span></header>
      <h3>{item.name}</h3>
      <div className="supply-item-facts"><div><span>On hand</span><strong>{item.current} <small>{item.unit}</small></strong></div><div><span>Expiration</span><strong className="supply-expiration">{item.expirationDate ? <time dateTime={item.expirationDate}>{dateLabel(item.expirationDate)}</time> : item.expirationDate === null ? "No expiry listed" : "Not recorded"}</strong></div></div>
      <details><summary>Stock details<ChevronDown size={14} /></summary><dl><div><dt>Reorder point</dt><dd>{item.threshold} {item.unit}</dd></div><div><dt>Unit cost</dt><dd>${(item.unitCostCents / 100).toFixed(2)} / {item.unit}</dd></div><div><dt>Next delivery</dt><dd>{item.nextDelivery ? dateLabel(item.nextDelivery) : "Not scheduled"}</dd></div><div><dt>Last ordered</dt><dd>{dateLabel(item.lastOrdered)}</dd></div></dl></details>
    </article>)}</div>
    {!filtered.length && <div className="supply-empty"><Package size={24} /><p>{inventory.length ? "No items match your filters." : "No inventory items yet."}</p>{inventory.length > 0 && <button className="button quiet compact" onClick={() => { setQuery(""); setCategory("All categories"); setStatus("All stock"); }}>Clear filters</button>}</div>}
    <p className="supply-note">Mock stock and expiration dates · no purchasing connected.</p>
  </section>;
}
