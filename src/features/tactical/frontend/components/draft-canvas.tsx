"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { FloorPlanDraft, DraftTable, DraftFixture } from "../../domain/analyze";

type Props = {
  draft: FloorPlanDraft;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCommit: (draft: FloorPlanDraft) => void;
};

type DragState = {
  kind: "move";
  id: string;
  isFixture: boolean;
  startX: number; startY: number;
  origX: number; origY: number;
  pointerId: number;
};

const CHAIR_W = 0.8;
const CHAIR_D = 0.5;
const CHAIR_GAP = 0.4;
const PAD = 2.5;

function chairPositions(t: DraftTable): Array<{ x: number; y: number; angle: number }> {
  const n = t.seats;
  if (n === 0) return [];

  if (t.shape === "round") {
    const r = Math.max(t.width, t.depth) / 2 + CHAIR_GAP + CHAIR_D / 2;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: t.width / 2 + r * Math.cos(a), y: t.depth / 2 + r * Math.sin(a), angle: (a * 180) / Math.PI + 90 };
    });
  }

  const positions: Array<{ x: number; y: number; angle: number }> = [];
  const topBottom = Math.ceil(n / 2);
  const top = Math.ceil(topBottom / 2);
  const bottom = topBottom - top;
  const sides = n - top - bottom;
  const left = Math.ceil(sides / 2);
  const right = sides - left;

  const spread = (count: number, length: number, gap: number, axis: "x" | "y", fixedOther: number, angle: number) => {
    if (count <= 0) return;
    for (let i = 0; i < count; i++) {
      const offset = length / (count + 1) * (i + 1);
      positions.push(axis === "x"
        ? { x: offset, y: fixedOther, angle }
        : { x: fixedOther, y: offset, angle });
    }
  };

  spread(top, t.width, CHAIR_GAP, "x", -(CHAIR_GAP + CHAIR_D / 2), 0);
  spread(bottom, t.width, CHAIR_GAP, "x", t.depth + CHAIR_GAP + CHAIR_D / 2, 180);
  spread(left, t.depth, CHAIR_GAP, "y", -(CHAIR_GAP + CHAIR_D / 2), 270);
  spread(right, t.depth, CHAIR_GAP, "y", t.width + CHAIR_GAP + CHAIR_D / 2, 90);
  return positions;
}

function TableEl({ table, selected, onPointerDown }: { table: DraftTable; selected: boolean; onPointerDown: (e: PointerEvent<SVGGElement>) => void }) {
  const low = table.confidence < 0.5;
  const fill = table.is_joined_group ? "#e8d5a8" : "#f3e3c3";

  return (
    <g data-id={table.id} transform={`translate(${table.x} ${table.y})`} onPointerDown={onPointerDown} style={{ cursor: "grab", touchAction: "none" }}>
      {chairPositions(table).map((c, i) => (
        <rect key={i} x={c.x - CHAIR_W / 2} y={c.y - CHAIR_D / 2} width={CHAIR_W} height={CHAIR_D} rx={0.15}
          transform={`rotate(${c.angle} ${c.x} ${c.y})`} fill="#8b6a44" opacity={0.85} />
      ))}
      {table.shape === "round"
        ? <ellipse cx={table.width / 2} cy={table.depth / 2} rx={table.width / 2} ry={table.depth / 2}
          fill={fill} stroke={selected ? "#2563eb" : low ? "#c0392b" : "#7a5c2e"}
          strokeWidth={selected ? 0.25 : 0.15} strokeDasharray={low ? "0.6 0.3" : undefined} />
        : <rect width={table.width} height={table.depth} rx={0.2}
          fill={fill} stroke={selected ? "#2563eb" : low ? "#c0392b" : "#7a5c2e"}
          strokeWidth={selected ? 0.25 : 0.15} strokeDasharray={low ? "0.6 0.3" : undefined} />
      }
      {selected && <>
        <rect width={table.width} height={table.depth} rx={0.2} fill="#2563eb22" />
      </>}
      {low && (
        <g transform={`translate(${table.width - 1.1} -0.4)`}>
          <circle r={0.55} fill="#f59e0b" />
          <text textAnchor="middle" dominantBaseline="central" fontSize={0.65} fill="white" fontWeight="bold">?</text>
        </g>
      )}
      <text x={table.width / 2} y={table.depth / 2 - 0.3} textAnchor="middle" dominantBaseline="central" fontSize={0.75} fill="#5c3d1e" fontWeight="600">{table.label}</text>
      <text x={table.width / 2} y={table.depth / 2 + 0.55} textAnchor="middle" dominantBaseline="central" fontSize={0.6} fill="#7a5c2e">{table.seats} seats</text>
    </g>
  );
}

function FixtureEl({ fixture, selected, onPointerDown }: { fixture: DraftFixture; selected: boolean; onPointerDown: (e: PointerEvent<SVGGElement>) => void }) {
  const isBar = fixture.type === "bar";
  const fill = isBar ? "#c9a77c" : "#b8c4d6";
  const stroke = selected ? "#2563eb" : "#6b7280";

  const stools = fixture.stool_count ?? 0;
  const stoolPositions = isBar && stools > 0 ? Array.from({ length: stools }, (_, i) => ({
    x: (fixture.width / (stools + 1)) * (i + 1),
    y: fixture.depth + CHAIR_GAP + 0.4,
  })) : [];

  return (
    <g data-id={fixture.id} transform={`translate(${fixture.x} ${fixture.y})`} onPointerDown={onPointerDown} style={{ cursor: "grab", touchAction: "none" }}>
      {stoolPositions.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={0.45} fill="#a07840" opacity={0.9} />
      ))}
      <rect width={fixture.width} height={fixture.depth} rx={0.2}
        fill={fill} stroke={stroke} strokeWidth={selected ? 0.25 : 0.12}
        strokeDasharray={selected ? undefined : undefined} />
      {selected && <rect width={fixture.width} height={fixture.depth} rx={0.2} fill="#2563eb22" />}
      <text x={fixture.width / 2} y={fixture.depth / 2} textAnchor="middle" dominantBaseline="central" fontSize={0.75} fill="#374151" fontWeight="600">
        {isBar ? "Bar" : "Cashier"}
      </text>
      {isBar && stools > 0 && <text x={fixture.width / 2} y={fixture.depth / 2 + 0.75} textAnchor="middle" fontSize={0.6} fill="#6b7280">{stools} stools</text>}
    </g>
  );
}

function DoorEl({ draft }: { draft: FloorPlanDraft }) {
  const { wall, position } = draft.door;
  const W = draft.room.width;
  const D = draft.room.depth;
  const doorW = 3.5;
  const swingR = doorW;

  let x = 0, y = 0, angle = 0;
  if (wall === "S" || wall === "unknown") { x = W * position - doorW / 2; y = D; angle = 0; }
  else if (wall === "N") { x = W * position - doorW / 2; y = 0; angle = 180; }
  else if (wall === "W") { x = 0; y = D * position - doorW / 2; angle = 90; }
  else if (wall === "E") { x = W; y = D * position - doorW / 2; angle = 270; }

  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <line x1={0} y1={0} x2={doorW} y2={0} stroke="#374151" strokeWidth={0.4} strokeLinecap="round" />
      <path d={`M 0 0 A ${swingR} ${swingR} 0 0 1 ${swingR * Math.cos(-Math.PI / 2)} ${swingR * Math.sin(-Math.PI / 2) * -1}`}
        fill="none" stroke="#9ca3af" strokeWidth={0.15} strokeDasharray="0.4 0.2" />
      <text x={doorW / 2} y={-0.6} textAnchor="middle" fontSize={0.75} fill="#374151" fontWeight="500">
        {draft.door.label}
      </text>
    </g>
  );
}

function Compass({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={2.2} fill="white" fillOpacity={0.85} stroke="#d1d5db" strokeWidth={0.1} />
      <line x1={0} y1={-1.5} x2={0} y2={1.5} stroke="#6b7280" strokeWidth={0.15} />
      <line x1={-1.5} y1={0} x2={1.5} y2={0} stroke="#6b7280" strokeWidth={0.15} />
      <polygon points="0,-1.4 0.5,0 -0.5,0" fill="#b4532a" />
      <polygon points="0,1.4 0.5,0 -0.5,0" fill="#9ca3af" />
      <text x={0} y={-1.8} textAnchor="middle" fontSize={0.7} fill="#374151" fontWeight="700">N</text>
    </g>
  );
}

export function DraftCanvas({ draft, selectedId, onSelect, onCommit }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const W = draft.room.width;
  const D = draft.room.depth;
  const vw = W + PAD * 2;
  const vd = D + PAD * 2;
  const captionId = useId();

  function roomPt(e: PointerEvent<SVGSVGElement>) {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x - PAD, y: pt.y - PAD };
  }

  function startDrag(e: PointerEvent<SVGGElement>, id: string, isFixture: boolean) {
    e.stopPropagation();
    onSelect(id);
    const pt = roomPt(e as unknown as PointerEvent<SVGSVGElement>);
    if (!pt) return;
    const item = isFixture ? draft.fixtures.find((f) => f.id === id) : draft.tables.find((t) => t.id === id);
    if (!item) return;
    (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind: "move", id, isFixture, startX: pt.x, startY: pt.y, origX: item.x, origY: item.y, pointerId: e.pointerId };
  }

  function onPointerMove(e: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const pt = roomPt(e);
    if (!pt) return;
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const nx = Math.max(0, drag.origX + dx);
    const ny = Math.max(0, drag.origY + dy);

    const updated = drag.isFixture
      ? { ...draft, fixtures: draft.fixtures.map((f) => f.id === drag.id ? { ...f, x: nx, y: ny } : f) }
      : { ...draft, tables: draft.tables.map((t) => t.id === drag.id ? { ...t, x: nx, y: ny } : t) };
    onCommit(updated);
  }

  function onPointerUp(e: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null;
  }

  function onCanvasClick() {
    if (!dragRef.current) onSelect(null);
  }

  function onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
    if (!selectedId) return;
    const step = e.shiftKey ? 1 : 0.25;
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    const isFixture = draft.fixtures.some((f) => f.id === selectedId);
    const updated = isFixture
      ? { ...draft, fixtures: draft.fixtures.map((f) => f.id === selectedId ? { ...f, x: Math.max(0, f.x + dx), y: Math.max(0, f.y + dy) } : f) }
      : { ...draft, tables: draft.tables.map((t) => t.id === selectedId ? { ...t, x: Math.max(0, t.x + dx), y: Math.max(0, t.y + dy) } : t) };
    onCommit(updated);
  }

  const totalSeats = draft.tables.reduce((s, t) => s + t.seats, 0);
  const barStools = draft.fixtures.filter((f) => f.type === "bar").reduce((s, f) => s + (f.stool_count ?? 0), 0);

  return (
    <svg
      ref={svgRef}
      role="img"
      aria-labelledby={captionId}
      tabIndex={0}
      className="draft-svg"
      viewBox={`0 0 ${vw} ${vd}`}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onCanvasClick}
      onKeyDown={onKeyDown}
      style={{ display: "block", width: "100%", outline: "none" }}
    >
      <title id={captionId}>Analyzed restaurant floor plan</title>

      {/* Room background */}
      <rect x={PAD} y={PAD} width={W} height={D} fill="#fffdf8" stroke="#94a3b8" strokeWidth={0.3} />
      {/* Subtle grid */}
      <defs>
        <pattern id="analyze-grid" width={5} height={5} patternUnits="userSpaceOnUse" patternTransform={`translate(${PAD} ${PAD})`}>
          <path d="M5 0L0 0 0 5" fill="none" stroke="#e5e7eb" strokeWidth={0.08} />
        </pattern>
      </defs>
      <rect x={PAD} y={PAD} width={W} height={D} fill="url(#analyze-grid)" />

      <g transform={`translate(${PAD} ${PAD})`}>
        <DoorEl draft={draft} />
        {draft.fixtures.map((f) => (
          <FixtureEl key={f.id} fixture={f} selected={selectedId === f.id}
            onPointerDown={(e) => startDrag(e, f.id, true)} />
        ))}
        {draft.tables.map((t) => (
          <TableEl key={t.id} table={t} selected={selectedId === t.id}
            onPointerDown={(e) => startDrag(e, t.id, false)} />
        ))}
      </g>

      {/* Compass */}
      <Compass x={vw - PAD + 0.5} y={PAD - 0.5} />

      {/* Top-left label */}
      <text x={PAD} y={PAD - 1.3} fontSize={0.8} fill="#6f685d" fontStyle="italic">Estimated from photos</text>

      {/* Capacity summary at bottom */}
      <text x={PAD} y={vd - 0.5} fontSize={0.75} fill="#6f685d">
        {draft.tables.length} tables · {totalSeats} seats{barStools > 0 ? ` · ${barStools} bar stools` : ""} · total {totalSeats + barStools}
      </text>
    </svg>
  );
}
