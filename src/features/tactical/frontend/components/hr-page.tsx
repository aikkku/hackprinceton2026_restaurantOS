"use client";

import { Users, Clock, Star, TrendingUp, Calendar, ChevronDown } from "lucide-react";
import { useState } from "react";

type Employee = {
  id: string;
  name: string;
  role: string;
  type: "Full-time" | "Part-time";
  tenure: string;
  rating: "Excellent" | "Good" | "Developing";
  hoursThisWeek: number;
  schedule: (string | null)[];
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const EMPLOYEES: Employee[] = [
  { id: "e1", name: "Sarah Chen", role: "Head Chef", type: "Full-time", tenure: "8 yrs", rating: "Excellent", hoursThisWeek: 42, schedule: ["8–4", "8–4", null, "8–4", "8–4", "8–4", null] },
  { id: "e2", name: "Marcus Torres", role: "Sous Chef", type: "Full-time", tenure: "3 yrs", rating: "Excellent", hoursThisWeek: 40, schedule: [null, "8–4", "8–4", "8–4", "8–4", "8–4", "10–6"] },
  { id: "e3", name: "Lily Nakamura", role: "Host / Hostess", type: "Full-time", tenure: "4 yrs", rating: "Excellent", hoursThisWeek: 38, schedule: ["11–8", null, "11–8", "11–8", "11–8", "11–8", null] },
  { id: "e4", name: "Noah Williams", role: "Bartender", type: "Full-time", tenure: "2 yrs", rating: "Good", hoursThisWeek: 36, schedule: ["4–12", "4–12", null, "4–12", "4–12", "4–12", "4–12"] },
  { id: "e5", name: "Emily Rodriguez", role: "Senior Server", type: "Full-time", tenure: "2 yrs", rating: "Good", hoursThisWeek: 35, schedule: ["11–8", "11–8", "11–8", null, "11–8", "11–8", null] },
  { id: "e6", name: "James Park", role: "Server", type: "Part-time", tenure: "1 yr", rating: "Good", hoursThisWeek: 24, schedule: [null, "5–10", "5–10", "5–10", null, "5–10", "5–10"] },
  { id: "e7", name: "Aisha Johnson", role: "Server", type: "Part-time", tenure: "8 mos", rating: "Developing", hoursThisWeek: 20, schedule: [null, null, "5–10", "5–10", "5–10", "5–10", null] },
  { id: "e8", name: "Tom Mitchell", role: "Busser", type: "Part-time", tenure: "5 mos", rating: "Good", hoursThisWeek: 18, schedule: [null, "5–10", null, "5–10", "5–10", "5–10", "11–4"] },
];

const RATING_COLORS: Record<Employee["rating"], string> = {
  Excellent: "hr-pill-excellent",
  Good: "hr-pill-good",
  Developing: "hr-pill-developing",
};

export function HrPage() {
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
          <p>Juniper Table — demo staff roster</p>
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

      <p className="section-footnote">Staff data is a demo fixture. No real employee information is used.</p>
    </div>
  );
}
