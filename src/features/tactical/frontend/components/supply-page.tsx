"use client";

import { useCallback, useState } from "react";
import { Search, ChevronDown, Package, Boxes, Truck, TriangleAlert, CalendarDays, Beef, Carrot, Milk, Coffee, Wheat, Croissant, SprayCan } from "lucide-react";
import type { Operations } from "../../domain/dataset";
import { stockStatus } from "../../domain/finance";
import { useAssistantLocation } from "../assistant-navigation";
import "./supply.css";
const statusLabels = { good: "In stock", low: "Low stock", critical: "Critical stock", overstock: "Overstock" };
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
const categoryIcons: Record<string, typeof Package> = { Proteins: Beef, Produce: Carrot, Dairy: Milk, Beverages: Coffee, "Dry Goods": Wheat, Bakery: Croissant, Cleaning: SprayCan };

export function SupplyPage({ operations }: { operations: Operations; restaurantName: string }) {
  const [category, setCategory] = useState("All categories");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All stock");
  useAssistantLocation("inventory", useCallback(() => { setCategory("All categories"); setQuery(""); setStatus("All stock"); }, []));
  const inventory = operations.inventory.map(item => ({ ...item, status: stockStatus(item.current, item.threshold) }));
  const categories = ["All categories", ...new Set(inventory.map(item => item.category))];
  const filtered = inventory.filter(item => (category === "All categories" || item.category === category) && (status === "All stock" || item.status === status) && item.name.toLowerCase().includes(query.trim().toLowerCase()));
  const belowThreshold = inventory.filter(item => item.current < item.threshold).length;
  const hasFilters = Boolean(query || category !== "All categories" || status !== "All stock");
  function clearFilters() { setQuery(""); setCategory("All categories"); setStatus("All stock"); }
  return <section className="supply-inventory" aria-label="Inventory">
    <header className="supply-heading"><h2>Everything on hand.</h2><span className="pill">Demo inventory</span></header>
    <div className="supply-summary" aria-label="Inventory summary">
      <div className="supply-summary-card supply-summary-total"><span className="supply-summary-icon"><Boxes size={20} aria-hidden="true" /></span><div><span>Items tracked</span><strong>{inventory.length}</strong></div></div>
      <div className="supply-summary-card"><span className="supply-summary-icon"><TriangleAlert size={20} aria-hidden="true" /></span><div><span>Below reorder point</span><strong>{belowThreshold}</strong></div></div>
      <div className="supply-summary-card"><span className="supply-summary-icon"><Truck size={20} aria-hidden="true" /></span><div><span>Awaiting delivery</span><strong>{inventory.filter(item => item.nextDelivery).length}</strong></div></div>
    </div>
    <div className="supply-filters">
      <label className="supply-search"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search inventory" placeholder="Search inventory…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <select aria-label="Inventory category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Inventory stock status" value={status} onChange={event => setStatus(event.target.value)}><option>All stock</option>{Object.entries(statusLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    <div className="supply-results-heading"><p className="supply-result-count" role="status">{filtered.length} of {inventory.length} items</p>{hasFilters && <button className="button quiet compact" onClick={clearFilters}>Clear filters</button>}</div>
    <div className="supply-item-grid">{filtered.map(item => {
      const Icon = categoryIcons[item.category] ?? Package;
      return <article className="supply-item" key={item.id} data-inventory-id={item.id} data-assistant-key={`inventory:${item.id}`}>
      <header><span className="supply-category"><Icon size={15} aria-hidden="true" />{item.category}</span><span className={`supply-stock supply-stock-${item.status}`}><i aria-hidden="true" />{statusLabels[item.status]}</span></header>
      <h3>{item.name}</h3>
      <div className="supply-item-facts"><div><span>On hand</span><strong>{item.current} <small>{item.unit}</small></strong></div><div className="supply-expiration-block"><span><CalendarDays size={12} aria-hidden="true" />Expiration</span><strong className="supply-expiration">{item.expirationDate ? <time dateTime={item.expirationDate}>{dateLabel(item.expirationDate)}</time> : item.expirationDate === null ? "No expiry listed" : "Not recorded"}</strong></div></div>
      <details><summary>Stock details<ChevronDown size={14} aria-hidden="true" /></summary><dl><div><dt>Reorder point</dt><dd>{item.threshold} {item.unit}</dd></div><div><dt>Unit cost</dt><dd>${(item.unitCostCents / 100).toFixed(2)} / {item.unit}</dd></div><div><dt>Next delivery</dt><dd>{item.nextDelivery ? dateLabel(item.nextDelivery) : "Not scheduled"}</dd></div><div><dt>Last ordered</dt><dd>{dateLabel(item.lastOrdered)}</dd></div></dl></details>
    </article>; })}</div>
    {!filtered.length && <div className="supply-empty"><span><Package size={28} aria-hidden="true" /></span><h3>{inventory.length ? "No items match your filters." : "No inventory items yet."}</h3>{inventory.length > 0 && <p>Try another search or clear the filters above.</p>}</div>}
    <p className="supply-note">Mock stock and expiration dates · no purchasing connected.</p>
  </section>;
}
