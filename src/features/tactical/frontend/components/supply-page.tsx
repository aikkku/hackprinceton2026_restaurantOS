"use client";

import { Package, AlertTriangle, CheckCircle, Truck, RefreshCw } from "lucide-react";
import { useState } from "react";

type StockStatus = "good" | "low" | "critical" | "overstock";

type InventoryItem = {
  id: string;
  name: string;
  category: string;
  supplier: string;
  current: number;
  threshold: number;
  unit: string;
  status: StockStatus;
  lastOrdered: string;
  nextDelivery: string | null;
};

const INVENTORY: InventoryItem[] = [
  { id: "i1", name: "Grass-fed beef tenderloin", category: "Proteins", supplier: "Artisan Farms", current: 24, threshold: 20, unit: "lbs", status: "good", lastOrdered: "Nov 10", nextDelivery: "Nov 16" },
  { id: "i2", name: "Pacific salmon (whole)", category: "Proteins", supplier: "Ocean Fresh Co.", current: 7, threshold: 10, unit: "lbs", status: "low", lastOrdered: "Nov 9", nextDelivery: "Nov 15" },
  { id: "i3", name: "Free-range chicken breast", category: "Proteins", supplier: "Artisan Farms", current: 18, threshold: 15, unit: "lbs", status: "good", lastOrdered: "Nov 10", nextDelivery: "Nov 16" },
  { id: "i4", name: "Ribeye steak 12 oz", category: "Proteins", supplier: "Artisan Farms", current: 10, threshold: 12, unit: "lbs", status: "low", lastOrdered: "Nov 10", nextDelivery: "Nov 15" },
  { id: "i5", name: "Heirloom tomatoes", category: "Produce", supplier: "Sunrise Organics", current: 4, threshold: 8, unit: "lbs", status: "low", lastOrdered: "Nov 11", nextDelivery: "Nov 14" },
  { id: "i6", name: "Local microgreens", category: "Produce", supplier: "Sunrise Organics", current: 1, threshold: 4, unit: "oz", status: "critical", lastOrdered: "Nov 12", nextDelivery: "Nov 14" },
  { id: "i7", name: "Seasonal mixed veg", category: "Produce", supplier: "Sunrise Organics", current: 22, threshold: 15, unit: "lbs", status: "overstock", lastOrdered: "Nov 10", nextDelivery: null },
  { id: "i8", name: "Fresh herbs bundle", category: "Produce", supplier: "Sunrise Organics", current: 6, threshold: 5, unit: "bunches", status: "good", lastOrdered: "Nov 11", nextDelivery: null },
  { id: "i9", name: "House white wine", category: "Beverages", supplier: "Vineyard Select", current: 5, threshold: 12, unit: "bottles", status: "critical", lastOrdered: "Nov 8", nextDelivery: "Nov 15" },
  { id: "i10", name: "House red wine", category: "Beverages", supplier: "Vineyard Select", current: 9, threshold: 12, unit: "bottles", status: "low", lastOrdered: "Nov 8", nextDelivery: "Nov 15" },
  { id: "i11", name: "Craft beer variety", category: "Beverages", supplier: "Local Brewery Co.", current: 36, threshold: 24, unit: "cans", status: "good", lastOrdered: "Nov 7", nextDelivery: null },
  { id: "i12", name: "Specialty coffee beans", category: "Beverages", supplier: "Roastery Direct", current: 2, threshold: 5, unit: "lbs", status: "low", lastOrdered: "Nov 9", nextDelivery: "Nov 16" },
  { id: "i13", name: "Arborio rice", category: "Dry Goods", supplier: "European Imports", current: 12, threshold: 10, unit: "lbs", status: "good", lastOrdered: "Oct 28", nextDelivery: null },
  { id: "i14", name: "Semolina flour", category: "Dry Goods", supplier: "European Imports", current: 25, threshold: 20, unit: "lbs", status: "overstock", lastOrdered: "Oct 28", nextDelivery: null },
  { id: "i15", name: "Premium olive oil", category: "Dry Goods", supplier: "Mediterranean Co.", current: 1.5, threshold: 3, unit: "gal", status: "low", lastOrdered: "Nov 7", nextDelivery: "Nov 15" },
];

const SUPPLIERS = [
  { name: "Artisan Farms", contact: "artisan@artisanfarms.com", phone: "(609) 555-0121", leadDays: 2, notes: "Twice-weekly delivery Mon/Thu" },
  { name: "Ocean Fresh Co.", contact: "orders@oceanfresh.com", phone: "(609) 555-0188", leadDays: 1, notes: "Next-day delivery available" },
  { name: "Sunrise Organics", contact: "hello@sunriseorganics.com", phone: "(609) 555-0145", leadDays: 1, notes: "Daily delivery by 7 AM" },
  { name: "Vineyard Select", contact: "orders@vineyardselect.com", phone: "(609) 555-0162", leadDays: 5, notes: "Weekly delivery Fridays" },
  { name: "Local Brewery Co.", contact: "tap@localbrewery.com", phone: "(609) 555-0174", leadDays: 3, notes: "Bi-weekly delivery" },
  { name: "Roastery Direct", contact: "hi@roasterydirect.com", phone: "(609) 555-0199", leadDays: 3, notes: "Roasted to order" },
  { name: "European Imports", contact: "orders@euroimports.com", phone: "(609) 555-0133", leadDays: 7, notes: "Bulk orders recommended" },
  { name: "Mediterranean Co.", contact: "orders@medco.com", phone: "(609) 555-0155", leadDays: 5, notes: "Free shipping over $200" },
];

const STATUS_CONFIG: Record<StockStatus, { label: string; cls: string; icon: typeof CheckCircle }> = {
  good: { label: "Good", cls: "status-good", icon: CheckCircle },
  low: { label: "Low", cls: "status-low", icon: AlertTriangle },
  critical: { label: "Critical", cls: "status-critical", icon: AlertTriangle },
  overstock: { label: "Overstock", cls: "status-overstock", icon: Package },
};

const CATEGORIES = ["All", ...Array.from(new Set(INVENTORY.map((i) => i.category)))];

export function SupplyPage() {
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
          <p>Juniper Table — inventory and suppliers</p>
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
            <span className="kpi-label">Deliveries pending</span>
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
                  <th>Status</th>
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
        <span><strong>{critical + low} items</strong> need reordering — microgreens and house white wine are critically low.</span>
      </div>

      <p className="section-footnote">Inventory and supplier data is a demo fixture. No real purchasing actions are performed.</p>
    </div>
  );
}
