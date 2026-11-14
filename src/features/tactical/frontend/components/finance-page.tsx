"use client";

import { DollarSign, TrendingUp, Users, Percent, ExternalLink, Info } from "lucide-react";
import { useState } from "react";
import type { Assumptions } from "../../domain/schemas";

type Props = {
  assumptions: Assumptions;
};

const MONTHLY_REVENUE = [
  { month: "Jun", revenue: 48200 },
  { month: "Jul", revenue: 52100 },
  { month: "Aug", revenue: 55800 },
  { month: "Sep", revenue: 51300 },
  { month: "Oct", revenue: 53700 },
  { month: "Nov", revenue: 38400, partial: true },
];

const TRANSACTIONS = [
  { id: "txn-001", date: "Nov 14", time: "7:48 PM", party: 4, check: 162.40, type: "Dine-in" },
  { id: "txn-002", date: "Nov 14", time: "7:21 PM", party: 2, check: 93.60, type: "Dine-in" },
  { id: "txn-003", date: "Nov 14", time: "7:10 PM", party: 2, check: 48.20, type: "Delivery" },
  { id: "txn-004", date: "Nov 14", time: "6:55 PM", party: 6, check: 241.80, type: "Dine-in" },
  { id: "txn-005", date: "Nov 14", time: "6:30 PM", party: 2, check: 87.00, type: "Dine-in" },
  { id: "txn-006", date: "Nov 14", time: "6:12 PM", party: 3, check: 72.50, type: "Delivery" },
  { id: "txn-007", date: "Nov 14", time: "5:48 PM", party: 4, check: 155.20, type: "Dine-in" },
  { id: "txn-008", date: "Nov 14", time: "5:30 PM", party: 2, check: 83.60, type: "Dine-in" },
  { id: "txn-009", date: "Nov 14", time: "5:10 PM", party: 1, check: 32.40, type: "Delivery" },
  { id: "txn-010", date: "Nov 13", time: "9:05 PM", party: 4, check: 178.00, type: "Dine-in" },
];

const MENU_PRICING = [
  { item: "House Burger", category: "Mains", dineIn: 18, delivery: 23, margin: "~62%", popular: true },
  { item: "Salmon Fillet", category: "Mains", dineIn: 28, delivery: 34, margin: "~55%", popular: true },
  { item: "Pasta Primavera", category: "Mains", dineIn: 22, delivery: 27, margin: "~65%", popular: false },
  { item: "Ribeye Steak 12 oz", category: "Mains", dineIn: 45, delivery: 54, margin: "~48%", popular: true },
  { item: "Caesar Salad", category: "Starters", dineIn: 14, delivery: 18, margin: "~72%", popular: false },
  { item: "Mushroom Soup", category: "Starters", dineIn: 10, delivery: 13, margin: "~70%", popular: false },
  { item: "Tiramisu", category: "Desserts", dineIn: 9, delivery: 12, margin: "~68%", popular: true },
  { item: "Craft Cocktail", category: "Beverages", dineIn: 14, delivery: 16, margin: "~80%", popular: false },
];

const COMPETITORS = [
  { name: "The Garden Table", avgCheck: 42, cuisine: "American", distance: "0.4 mi", rating: 4.3 },
  { name: "Birch & Vine", avgCheck: 55, cuisine: "New American", distance: "0.6 mi", rating: 4.6 },
  { name: "Corner Bistro", avgCheck: 31, cuisine: "American Casual", distance: "0.3 mi", rating: 4.1 },
];

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const decimal2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function FinancePage({ assumptions }: Props) {
  const [tab, setTab] = useState<"overview" | "transactions" | "pricing" | "simulator">("overview");

  const maxRev = Math.max(...MONTHLY_REVENUE.map((m) => m.revenue));
  const lastFull = MONTHLY_REVENUE.filter((m) => !m.partial).at(-1)!;
  const covers = Math.round(lastFull.revenue / assumptions.averageCheck);

  const [simSeats, setSimSeats] = useState(6);
  const simCovers = simSeats * assumptions.turnsPerDay * assumptions.occupancyFraction * assumptions.operatingDaysPerMonth;
  const simRevenue = simCovers * assumptions.averageCheck;
  const simContribution = simRevenue * assumptions.incrementalContributionMargin;
  const payback = simContribution > 0 ? assumptions.investmentCost / simContribution : null;

  return (
    <div className="finance-page">
      <div className="section-header">
        <div className="section-icon-wrap"><DollarSign size={20} /></div>
        <div>
          <h2>Financial Intelligence</h2>
          <p>Juniper Table — demo financial overview</p>
        </div>
        <span className="pill">Demo data</span>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-icon"><DollarSign size={16} /></span>
          <div>
            <span className="kpi-value">{currency.format(lastFull.revenue)}</span>
            <span className="kpi-label">Monthly revenue (Oct)</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><Users size={16} /></span>
          <div>
            <span className="kpi-value">{covers.toLocaleString()}</span>
            <span className="kpi-label">Estimated covers</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><TrendingUp size={16} /></span>
          <div>
            <span className="kpi-value">${decimal2.format(assumptions.averageCheck)}</span>
            <span className="kpi-label">Average check (assumed)</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><Percent size={16} /></span>
          <div>
            <span className="kpi-value">{Math.round(assumptions.incrementalContributionMargin * 100)}%</span>
            <span className="kpi-label">Contribution margin</span>
          </div>
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-btn ${tab === "overview" ? "tab-active" : ""}`} onClick={() => setTab("overview")}>Overview</button>
        <button className={`tab-btn ${tab === "transactions" ? "tab-active" : ""}`} onClick={() => setTab("transactions")}>Transactions</button>
        <button className={`tab-btn ${tab === "pricing" ? "tab-active" : ""}`} onClick={() => setTab("pricing")}>Menu Pricing</button>
        <button className={`tab-btn ${tab === "simulator" ? "tab-active" : ""}`} onClick={() => setTab("simulator")}>Simulator</button>
      </div>

      {tab === "overview" && (
        <div className="finance-overview">
          <div className="chart-panel">
            <div className="chart-heading">
              <h3>Monthly revenue — 2026</h3>
              <span className="pill">Modeled · assumed avg check</span>
            </div>
            <div className="bar-chart">
              {MONTHLY_REVENUE.map((m) => {
                const pct = (m.revenue / maxRev) * 100;
                return (
                  <div key={m.month} className="bar-col">
                    <span className="bar-value">{currency.format(m.revenue)}</span>
                    <div className={`bar ${m.partial ? "bar-partial" : ""}`} style={{ height: `${pct}%` }} />
                    <span className="bar-label">{m.month}{m.partial ? "*" : ""}</span>
                  </div>
                );
              })}
            </div>
            <p className="chart-note">* November is a partial month (through Nov 14). Revenue computed from estimated covers × assumed average check.</p>
          </div>

          <div className="competitor-panel">
            <h3>Nearby competitors</h3>
            <p className="muted">Average check comparison — demo estimates.</p>
            <table className="comp-table">
              <thead><tr><th>Restaurant</th><th>Cuisine</th><th>Avg check</th><th>Rating</th></tr></thead>
              <tbody>
                <tr className="own-row">
                  <td><strong>Juniper Table</strong></td>
                  <td>American</td>
                  <td><strong>${decimal2.format(assumptions.averageCheck)}</strong></td>
                  <td>—</td>
                </tr>
                {COMPETITORS.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name} <span className="muted">{c.distance}</span></td>
                    <td>{c.cuisine}</td>
                    <td>${c.avgCheck}</td>
                    <td>{c.rating} ★</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="nessie-banner">
            <div className="nessie-icon">
              <ExternalLink size={16} />
            </div>
            <div>
              <strong>Capital One Nessie Integration</strong>
              <p>Connect the Nessie sandbox API to populate real transaction history, cash flow, and merchant analytics. Transactions above are fixture data.</p>
            </div>
            <span className="pill pill-warm">Placeholder</span>
          </div>
        </div>
      )}

      {tab === "transactions" && (
        <div className="transactions-panel">
          <div className="chart-heading">
            <h3>Recent transactions</h3>
            <span className="pill">Fixture data · not real POS</span>
          </div>
          <div className="transaction-table-wrap">
            <table className="transaction-table">
              <thead>
                <tr><th>Time</th><th>Party</th><th>Check</th><th>Type</th></tr>
              </thead>
              <tbody>
                {TRANSACTIONS.map((t) => (
                  <tr key={t.id}>
                    <td><span className="txn-date">{t.date}</span> <span className="muted">{t.time}</span></td>
                    <td>{t.party} guest{t.party !== 1 ? "s" : ""}</td>
                    <td className="txn-amount">${decimal2.format(t.check)}</td>
                    <td><span className={`type-badge ${t.type === "Delivery" ? "type-delivery" : "type-dinein"}`}>{t.type}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="chart-note">Transaction data is a demo fixture. Connect the Nessie API for live transaction history.</p>
        </div>
      )}

      {tab === "pricing" && (
        <div className="pricing-panel">
          <div className="chart-heading">
            <h3>Dine-in vs. delivery pricing</h3>
            <span className="pill">Assumed markup</span>
          </div>
          <p className="muted" style={{ marginBottom: 16 }}>Third-party delivery platforms typically add 20–30% to cover commission fees. Dine-in contribution margin is higher.</p>
          <div className="pricing-table-wrap">
            <table className="pricing-table">
              <thead>
                <tr><th>Item</th><th>Category</th><th>Dine-in</th><th>Delivery</th><th>Markup</th><th>Margin</th></tr>
              </thead>
              <tbody>
                {MENU_PRICING.map((m) => {
                  const markup = Math.round(((m.delivery - m.dineIn) / m.dineIn) * 100);
                  return (
                    <tr key={m.item}>
                      <td>{m.item}{m.popular && <span className="popular-tag">Popular</span>}</td>
                      <td className="muted">{m.category}</td>
                      <td>${m.dineIn}</td>
                      <td>${m.delivery}</td>
                      <td className={markup > 25 ? "markup-high" : "markup-normal"}>+{markup}%</td>
                      <td>{m.margin}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pricing-insight">
            <Info size={15} />
            <span>High delivery markup on Caesar Salad (+29%) may reduce conversion on delivery platforms. Consider reducing markup on popular items to improve order volume.</span>
          </div>
        </div>
      )}

      {tab === "simulator" && (
        <div className="simulator-panel">
          <div className="chart-heading">
            <h3>Capacity revenue simulator</h3>
            <span className="pill">Modeled · simplified what-if</span>
          </div>
          <p className="muted">Estimate the incremental revenue impact of adding seats to Juniper Table. Uses your current operating assumptions.</p>

          <div className="sim-control">
            <label className="sim-label">
              Additional seats: <strong>{simSeats}</strong>
              <input type="range" min={1} max={30} value={simSeats} onChange={(e) => setSimSeats(Number(e.target.value))} />
            </label>
          </div>

          <div className="sim-results">
            <div className="sim-result-card">
              <span className="sim-result-label">Additional covers / month</span>
              <span className="sim-result-value">{Math.round(simCovers)}</span>
            </div>
            <div className="sim-result-card">
              <span className="sim-result-label">Incremental revenue / month</span>
              <span className="sim-result-value">{currency.format(simRevenue)}</span>
            </div>
            <div className="sim-result-card">
              <span className="sim-result-label">Incremental contribution / month</span>
              <span className="sim-result-value">{currency.format(simContribution)}</span>
            </div>
            <div className="sim-result-card">
              <span className="sim-result-label">Simple payback (months)</span>
              <span className="sim-result-value">{payback !== null ? decimal2.format(payback) : "—"}</span>
            </div>
          </div>

          <div className="sim-assumptions">
            <h4>Assumptions used</h4>
            <dl className="assumption-grid">
              <div><dt>Turns / day</dt><dd>{assumptions.turnsPerDay}</dd></div>
              <div><dt>Occupancy</dt><dd>{Math.round(assumptions.occupancyFraction * 100)}%</dd></div>
              <div><dt>Average check</dt><dd>${assumptions.averageCheck}</dd></div>
              <div><dt>Operating days</dt><dd>{assumptions.operatingDaysPerMonth}/mo</dd></div>
              <div><dt>Contribution margin</dt><dd>{Math.round(assumptions.incrementalContributionMargin * 100)}%</dd></div>
              <div><dt>Investment cost</dt><dd>{currency.format(assumptions.investmentCost)}</dd></div>
            </dl>
            <p className="sim-caveat">Simplified incremental-capacity model. Assumes extra demand exists to fill added seats. Does not account for displacement, table-size mix, permits, or demand uncertainty.</p>
          </div>
        </div>
      )}

      <p className="section-footnote">Financial data is a demo fixture unless otherwise noted. All revenue figures are simulated.</p>
    </div>
  );
}
