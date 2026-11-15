"use client";

import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import type { Operations } from "../../domain/dataset";
import { clockLabel, dateOffset, stations } from "../../domain/workforce";
const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function HrCalendar({ operations }: { operations: Operations }) {
  const workforce = operations.workforce;
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState("All stations");
  const [selectedDay, setSelectedDay] = useState(0);
  if (!workforce) return <p>No dated schedule available.</p>;
  const start = dateOffset(workforce.weekStart, offset * 7);
  const days = Array.from({ length: 7 }, (_, index) => dateOffset(start, index));
  return <section className="hr-calendar" aria-label="Weekly schedule">
    <div className="hr-toolbar">
      <div className="hr-week-nav">
        <CalendarDays size={18} className="hr-calendar-icon" aria-hidden="true" />
        <button className="hr-icon" aria-label="Previous week" onClick={() => setOffset(value => value - 1)}><ChevronLeft size={16} /></button>
        <strong>{dateLabel(start, { month: "short", day: "numeric" })} – {dateLabel(days[6], { month: "short", day: "numeric", year: "numeric" })}</strong>
        <button className="hr-icon" aria-label="Next week" onClick={() => setOffset(value => value + 1)}><ChevronRight size={16} /></button>
        {offset !== 0 && <button className="button quiet compact" onClick={() => setOffset(0)}>Demo week</button>}
      </div>
      <select aria-label="Filter schedule by station" value={filter} onChange={event => setFilter(event.target.value)}><option>All stations</option>{stations.map(station => <option key={station}>{station}</option>)}</select>
    </div>
    <div className="hr-day-picker" aria-label="Choose day">{days.map((day, index) => <button key={day} aria-pressed={index === selectedDay} onClick={() => setSelectedDay(index)}>{dateLabel(day, { weekday: "short" })}<b>{day.slice(-2)}</b></button>)}</div>
    {offset !== 0 && <p className="hr-empty">No shifts saved for this week.</p>}
    <div className="hr-week-scroll" role="region" tabIndex={0} aria-label="Schedule calendar"><div className="hr-week-grid">{days.map((day, index) => {
      const shifts = workforce.shifts.filter(shift => shift.date === day && (filter === "All stations" || workforce.assignments.some(row => row.employeeId === shift.employeeId && row.station === filter))).sort((a, b) => a.startMinute - b.startMinute);
      return <section key={day} className={`hr-day ${index === selectedDay ? "is-selected" : ""}`} aria-label={dateLabel(day, { weekday: "long", month: "long", day: "numeric" })}>
        <header><span>{dateLabel(day, { weekday: "short" })}</span><b>{day.slice(-2)}</b><small>{shifts.length} shifts</small></header>
        <div className="hr-shifts">{shifts.map(shift => {
          const employee = operations.employees.find(row => row.id === shift.employeeId)!;
          const station = workforce.assignments.find(row => row.employeeId === employee.id)!.station;
          return <details className={`hr-shift station-${station.toLowerCase()}`} key={shift.id}>
            <summary><span>{clockLabel(shift.startMinute)}–{clockLabel(shift.endMinute)}</span><strong>{employee.name}</strong><small>{employee.role}<ChevronDown size={10} aria-hidden="true" /></small></summary>
            <p>{station} · {(shift.endMinute - shift.startMinute) / 60} scheduled hours</p>
          </details>;
        })}{!shifts.length && <span className="hr-no-shifts">—</span>}</div>
      </section>;
    })}</div></div>
    <div className="hr-legend">{stations.map(station => <span key={station} className={`station-${station.toLowerCase()}`}><i />{station}</span>)}</div>
  </section>;
}
