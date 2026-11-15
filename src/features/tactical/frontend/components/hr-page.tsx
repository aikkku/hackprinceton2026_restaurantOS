"use client";

import { Users, Clock, Star, TrendingUp, Calendar, ChevronDown } from "lucide-react";
import type { Operations } from "../../domain/dataset";
import { useState } from "react";

type Employee = Operations["employees"][number];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const RATING_COLORS: Record<Employee["rating"], string> = {
  Excellent: "hr-pill-excellent",
  Good: "hr-pill-good",
  Developing: "hr-pill-developing",
};

export function HrPage({ operations, restaurantName }: { operations: Operations; restaurantName: string }) {
  const EMPLOYEES = operations.employees;
  const [expanded, setExpanded] = useState<string | null>(null);

  const fullTime = EMPLOYEES.filter((e) => e.type === "Full-time").length;
  const totalHours = EMPLOYEES.reduce((s, e) => s + e.hoursThisWeek, 0);
  const excellent = EMPLOYEES.filter((e) => e.rating === "Excellent").length;

  return (
    <div className="hr-page">
      <div className="section-header">
        <div className="section-icon-wrap"><Users size={20} /></div>
        <div>
          <h2>Team</h2>
          <p>{restaurantName} — demo staff roster</p>
        </div>
        <span className="pill">Demo data</span>
      </div>

      <div className="kpi-row">
        <div className="kpi-card">
          <span className="kpi-icon"><Users size={16} /></span>
          <div>
            <span className="kpi-value">{EMPLOYEES.length}</span>
            <span className="kpi-label">Total staff</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><Clock size={16} /></span>
          <div>
            <span className="kpi-value">{fullTime} / {EMPLOYEES.length - fullTime}</span>
            <span className="kpi-label">Full / part-time</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><TrendingUp size={16} /></span>
          <div>
            <span className="kpi-value">{totalHours} hrs</span>
            <span className="kpi-label">Scheduled this week</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="kpi-icon"><Star size={16} /></span>
          <div>
            <span className="kpi-value">{excellent} of {EMPLOYEES.length}</span>
            <span className="kpi-label">Excellent ratings</span>
          </div>
        </div>
      </div>

      <div className="hr-section-title"><Calendar size={16} />This week&apos;s schedule</div>
      <div className="schedule-table-wrap">
        <table className="schedule-table">
          <thead>
            <tr>
              <th>Employee</th>
              {DAYS.map((d) => <th key={d}>{d}</th>)}
              <th>Hrs</th>
            </tr>
          </thead>
          <tbody>
            {EMPLOYEES.map((emp) => (
              <tr key={emp.id}>
                <td>
                  <span className="emp-name">{emp.name}</span>
                  <span className="emp-role">{emp.role}</span>
                </td>
                {emp.schedule.map((shift, i) => (
                  <td key={i} className={shift ? "shift-cell" : "off-cell"}>{shift ?? "—"}</td>
                ))}
                <td className="hours-cell">{emp.hoursThisWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hr-section-title"><Users size={16} />Staff profiles</div>
      <div className="employee-list">
        {EMPLOYEES.map((emp) => (
          <div key={emp.id} className="employee-card">
            <button
              className="employee-card-header"
              onClick={() => setExpanded(expanded === emp.id ? null : emp.id)}
              aria-expanded={expanded === emp.id}
            >
              <div className="emp-avatar">{emp.name.split(" ").map((n) => n[0]).join("")}</div>
              <div className="emp-info">
                <span className="emp-name">{emp.name}</span>
                <span className="emp-role">{emp.role} · {emp.type}</span>
              </div>
              <span className={`pill ${RATING_COLORS[emp.rating]}`}>{emp.rating}</span>
              <ChevronDown size={16} className={`chevron ${expanded === emp.id ? "chevron-open" : ""}`} />
            </button>
            {expanded === emp.id && (
              <div className="employee-detail">
                <dl className="emp-detail-grid">
                  <div><dt>Contact</dt><dd>{emp.email}</dd></div>
                  <div><dt>Hourly rate (assumed)</dt><dd>${(emp.hourlyRateCents / 100).toFixed(2)}</dd></div>
                  <div><dt>Availability</dt><dd>{emp.availability}</dd></div>
                  <div><dt>Self-reported mood (fictional)</dt><dd>{emp.mood}</dd></div>
                  <div><dt>Tenure</dt><dd>{emp.tenure}</dd></div>
                  <div><dt>Employment</dt><dd>{emp.type}</dd></div>
                  <div><dt>Hours this week</dt><dd>{emp.hoursThisWeek} hrs</dd></div>
                  <div><dt>Performance</dt><dd>{emp.rating}</dd></div>
                </dl>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="section-footnote">Estimated scheduled base labor: ${(EMPLOYEES.reduce((sum, emp) => sum + emp.hoursThisWeek * emp.hourlyRateCents, 0) / 100).toFixed(2)}. Excludes overtime premiums, taxes and benefits.</p>
      <p className="section-footnote">Staff data is a demo fixture. No real employee information is used.</p>
    </div>
  );
}
