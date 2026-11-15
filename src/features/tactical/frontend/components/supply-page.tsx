"use client";

import { Package, AlertTriangle, CheckCircle, Truck, RefreshCw } from "lucide-react";
import type { Operations } from "../../domain/dataset";
import { stockStatus } from "../../domain/finance";
import { useState } from "react";

type StockStatus = "good" | "low" | "critical" | "overstock";

const STATUS_CONFIG: Record<StockStatus, { label: string; cls: string; icon: typeof CheckCircle }> = {
  good: { label: "Good", cls: "status-good", icon: CheckCircle },
  low: { label: "Low", cls: "status-low", icon: AlertTriangle },
  critical: { label: "Critical", cls: "status-critical", icon: AlertTriangle },
  overstock: { label: "Overstock", cls: "status-overstock", icon: Package },
};



export function SupplyPage({ operations, restaurantName }: { operations: Operations; restaurantName: string }) {
  const SUPPLIERS = operations.suppliers;
  const INVENTORY = operations.inventory.map(item => ({ ...item, status: stockStatus(item.current, item.threshold), supplier: SUPPLIERS.find(s => s.id === item.supplierId)!.name }));
  const CATEGORIES = ["All", ...new Set(INVENTORY.map(i => i.category))];
  const [category, setCategory] = useState("All");
  const [tab, setTab] = useState<"inventory" | "suppliers">("inventory");

  const filtered = category === "All" ? INVENTORY : INVENTORY.filter((i) => i.category === category);
  const critical = INVENTORY.filter((i) => i.status === "critical").length;
  const low = INVENTORY.filter((i) => i.status === "low").length;
  const upcoming = INVENTORY.filter((i) => i.nextDelivery !== null).length;

  return (
    <div className="supply-page">
      <div className="section-header">
        <div className="section-icon-wrap"><Package size={20} /></div>
        <div>
          <h2>Supply Management</h2>
          <p>{restaurantName} — inventory and suppliers</p>
        </div>
        <span className="pill">Demo data</span>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-icon"><Package size={16} /></span>
          <div>
            <span className="kpi-value">{INVENTORY.length}</span>
            <span className="kpi-label">Items tracked</span>
          </div>
        </div>
        <div className={`kpi-card ${critical > 0 ? "kpi-card-critical" : ""}`}>
          <span className="kpi-icon"><AlertTriangle size={16} /></span>
          <div>
            <span className="kpi-value">{critical}</span>
            <span className="kpi-label">Critical stock</span>
          </div>
        </div>
        <div className={`kpi-card ${low > 0 ? "kpi-card-warning" : ""}`}>
          <span className="kpi-icon"><AlertTriangle size={16} /></span>
          <div>
            <span className="kpi-value">{low}</span>
            <span className="kpi-label">Low stock</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><Truck size={16} /></span>
          <div>
            <span className="kpi-value">{upcoming}</span>
            <span className="kpi-label">Items awaiting delivery</span>
          </div>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === "inventory" ? "tab-active" : ""}`} onClick={() => setTab("inventory")}>
          <Package size={15} /> Inventory
        </button>
        <button className={`tab-btn ${tab === "suppliers" ? "tab-active" : ""}`} onClick={() => setTab("suppliers")}>
          <Truck size={15} /> Suppliers
        </button>
      </div>

      {tab === "inventory" && (
        <>
          <div className="filter-row">
            {CATEGORIES.map((c) => (
              <button key={c} className={`filter-chip ${category === c ? "filter-chip-active" : ""}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>
          <div className="inventory-table-wrap">
            <table className="inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Supplier</th>
                  <th>Stock</th>
                  <th>Reorder point / unit cost</th><th>Status</th>
                  <th>Next delivery</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const cfg = STATUS_CONFIG[item.status];
                  const pct = Math.min(100, Math.round((item.current / (item.threshold * 1.5)) * 100));
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="item-name">{item.name}</span>
                        <span className="item-category">{item.category}</span>
                      </td>
                      <td className="supplier-cell">{item.supplier}</td>
                      <td>
                        <div className="stock-bar-wrap">
                          <div className="stock-bar"><div className={`stock-fill stock-fill-${item.status}`} style={{ width: `${pct}%` }} /></div>
                          <span className="stock-label">{item.current} {item.unit}</span>
                        </div>
                      </td>
                      <td>{item.threshold} {item.unit} · ${(item.unitCostCents / 100).toFixed(2)} / {item.unit}</td>
                      <td><span className={`status-badge ${cfg.cls}`}>{cfg.label}</span></td>
                      <td className={item.nextDelivery ? "" : "muted"}>{item.nextDelivery ?? "Not scheduled"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "suppliers" && (
        <div className="supplier-grid">
          {SUPPLIERS.map((s) => (
            <div key={s.name} className="supplier-card">
              <div className="supplier-header">
                <span className="supplier-avatar"><Truck size={16} /></span>
                <span className="supplier-name">{s.name}</span>
              </div>
              <dl className="supplier-details">
                <div><dt>Contact</dt><dd>{s.contact}</dd></div>
                <div><dt>Phone</dt><dd>{s.phone}</dd></div>
                <div><dt>Lead time</dt><dd>{s.leadDays} day{s.leadDays !== 1 ? "s" : ""}</dd></div>
                <div><dt>Notes</dt><dd>{s.notes}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="reorder-banner">
        <RefreshCw size={15} />
        <span><strong>{critical + low} items</strong> are below their reorder thresholds across {new Set(INVENTORY.filter(i => i.current < i.threshold).map(i => i.supplierId)).size} suppliers. Rule-based demo summary.</span>
      </div>

      <p className="section-footnote">Inventory and supplier data is a demo fixture. No real purchasing actions are performed.</p>
    </div>
  );
}
