"use client";

import { useId, useRef, useState, type PointerEvent } from "react";
import { furniture, displayLength, footprint, gridStep, positionObject } from "../../domain/layout";
import type { Layout, LayoutObject, ObjectKind } from "../../domain/schemas";

type Props = {
  layout: Layout;
  zoom?: number;
  unit: "m" | "ft";
  selectedId: string | null;
  placing: ObjectKind | null;
  snap: boolean;
  overlaps: Set<string>;
  highlightedIds?: string[];
  proposedObject?: LayoutObject | null;
  aiPreview?: LayoutObject[];
  aiHighlights?: boolean;
  onSelect: (id: string | null) => void;
  onPlace: (x: number, y: number) => void;
  onMove: (object: LayoutObject) => void;
};

type Drag = {
  id: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  offsetX: number;
  offsetY: number;
};

function FurnitureArt({ object }: { object: LayoutObject }) {
  const { type, rotation } = object;
  const size = footprint(object);
  const swap = rotation === 90 || rotation === 270;
  const scale = swap ? [size.depth, size.width] : [size.width, size.depth];
  const tables = type === "table_2" || type === "table_4";
  return (
    <g transform={`translate(${size.width / 2} ${size.depth / 2}) rotate(${rotation}) scale(${scale.join(" ")}) translate(-0.5 -0.5)`}>
      {tables && <>
        {Array.from({ length: Math.min(object.seats ?? 0, 12) }, (_, index) => {
          const side = index % 4;
          const countOnSide = Math.ceil((Math.min(object.seats ?? 0, 12) - side) / 4);
          const offset = (Math.floor(index / 4) + 1) / (countOnSide + 1);
          return <rect key={index} className="svg-chair" x={side === 0 ? .01 : side === 2 ? .8 : offset - .09} y={side === 1 ? .01 : side === 3 ? .8 : offset - .09} width=".18" height=".18" rx=".05" />;
        })}
        <rect className="svg-furniture-shadow" x=".21" y=".25" width=".6" height=".57" rx=".1" />
        <rect className="svg-table" x=".2" y=".19" width=".6" height=".57" rx=".1" />
        <circle className="svg-plate" cx=".5" cy=".48" r=".075" />
      </>}
      {type === "booth" && <>
        <rect className="svg-booth-base" x=".03" y=".06" width=".94" height=".87" rx=".12" />
        <rect className="svg-booth-seat" x=".11" y=".14" width=".78" height=".22" rx=".08" />
        <rect className="svg-booth-seat" x=".11" y=".64" width=".78" height=".22" rx=".08" />
        <rect className="svg-table" x=".22" y=".32" width=".56" height=".35" rx=".07" />
      </>}
      {type === "counter" && <>
        <circle className="svg-chair" cx=".23" cy=".75" r=".14" />
        <circle className="svg-chair" cx=".5" cy=".75" r=".14" />
        <circle className="svg-chair" cx=".77" cy=".75" r=".14" />
        <rect className="svg-table" x=".02" y=".1" width=".96" height=".48" rx=".09" />
        <rect className="svg-plate" x=".12" y=".22" width=".18" height=".21" rx=".03" />
      </>}
      {type === "kitchen_zone" && <>
        <rect className="svg-kitchen" x=".02" y=".02" width=".96" height=".96" rx=".08" />
        <rect className="svg-appliance" x=".09" y=".13" width=".82" height=".23" rx=".04" />
        <rect className="svg-appliance" x=".09" y=".39" width=".21" height=".45" rx=".035" />
        <circle className="svg-burner" cx=".2" cy=".245" r=".055" />
        <circle className="svg-burner" cx=".34" cy=".245" r=".055" />
        <path className="svg-kitchen-detail" d="M.49 .24H.8M.55 .59H.81M.55 .7H.81" />
      </>}
      {type === "door" && <>
        <rect className="svg-door" x=".05" y=".56" width=".9" height=".37" rx=".12" />
        <path className="svg-arrow" d="M.5 .7V.16M.36 .33L.5 .13L.64 .33" />
      </>}
      {type === "divider" && <rect className="svg-divider" x=".02" y=".13" width=".96" height=".74" rx=".12" />}
      {["chair", "wall", "window", "light", "decoration", "ac", "custom"].includes(type) && <>
        <rect x=".03" y=".03" width=".94" height=".94" rx=".09" className={type === "chair" ? "svg-chair" : type === "wall" ? "svg-divider" : "svg-appliance"} />
        <text x=".5" y=".55" textAnchor="middle" fontSize=".16" fill="currentColor">{type === "ac" ? "AC" : type === "window" ? "Window" : type === "light" ? "Light" : type === "custom" ? "Custom" : ""}</text>
      </>}
      {type === "plant" && <>
        <circle className="svg-pot" cx=".5" cy=".54" r=".41" />
        <circle className="svg-leaf" cx=".42" cy=".4" r=".26" />
        <circle className="svg-leaf-light" cx=".65" cy=".53" r=".22" />
        <circle className="svg-leaf" cx=".44" cy=".67" r=".18" />
      </>}
    </g>
  );
}

export function FloorPlan({ layout, zoom = 1, unit, selectedId, placing, snap, overlaps, highlightedIds = [], proposedObject, aiPreview = [], aiHighlights = false, onSelect, onPlace, onMove }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<LayoutObject | null>(null);
  const gridId = useId();
  const { width, depth } = layout.room;
  const scale = Math.max(width, depth * 1.35);
  const pad = scale * 0.061;
  const fontSize = scale * 0.026;

  function roomPoint(event: PointerEvent<SVGSVGElement>) {
    const transform = svg.current?.getScreenCTM();
    return transform ? new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse()) : null;
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || drag.current) return;
    const point = roomPoint(event);
    if (!point || point.x < 0 || point.y < 0 || point.x > width || point.y > depth) return;
    if (placing) {
      onPlace(point.x, point.y);
      return;
    }
    const id = (event.target as Element).closest("[data-object]")?.getAttribute("data-object") ?? null;
    onSelect(id);
    const object = layout.objects.find((item) => item.id === id);
    if (!object) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: object.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      offsetX: point.x - object.x, offsetY: point.y - object.y,
    };
  }

  function dragPosition(event: PointerEvent<SVGSVGElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId
      || Math.hypot(gesture.clientX - event.clientX, gesture.clientY - event.clientY) < 3) return null;
    const point = roomPoint(event);
    const object = layout.objects.find((item) => item.id === gesture.id);
    if (!point || !object) return null;
    return positionObject(object, layout.room, point.x - gesture.offsetX, point.y - gesture.offsetY, snap);
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>, commit: boolean) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const position = commit ? dragPosition(event) : null;
    drag.current = null;
    setPreview(null);
    if (position) onMove(position);
  }

  const format = (value: number) => `${displayLength(value, unit).toFixed(1)} ${unit}`;

  return (
    <svg
      ref={svg}
      role="img"
      aria-label="Top-down restaurant floor plan. Use the furniture list for keyboard selection."
      className={`floor-svg ${placing ? "is-placing" : ""}`}
      style={{ height: `calc(var(--floor-height) * ${zoom})` }}
      viewBox={`${-pad * 1.3} ${-pad * 1.2} ${width + pad * 2} ${depth + pad * 2.1}`}
      onPointerDown={pointerDown}
      onPointerMove={(event) => {
        if (drag.current?.pointerId === event.pointerId) setPreview(dragPosition(event));
      }}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => finishDrag(event, false)}
    >
      <defs>
        <pattern id={gridId} width={gridStep * 4} height={gridStep * 2} patternUnits="userSpaceOnUse">
          <rect width={gridStep * 4} height={gridStep * 2} className="svg-floor" />
          <rect x={gridStep * 2} y={gridStep} width={gridStep * 2} height={gridStep} className="svg-tile" />
          <path d="M0 0H1M0 0V.25M0 .25H1M.5 .25V.5" className="svg-grid" />
        </pattern>
      </defs>
      <path d={`M0 ${-pad / 2}H${width}M0 ${-pad * .65}v${pad * .3}m${width} 0v${-pad * .3}M${-pad / 2} 0V${depth}M${-pad * .65} 0h${pad * .3}m0 ${depth}h${-pad * .3}`} className="svg-ruler" />
      <text x={width / 2} y={-pad * .64} textAnchor="middle" fontSize={fontSize} className="svg-label">{format(width)}</text>
      <text transform={`translate(${-pad * .64} ${depth / 2}) rotate(-90)`} textAnchor="middle" fontSize={fontSize} className="svg-label">{format(depth)}</text>
      <rect x="0.08" y="0.14" width={width} height={depth} className="svg-room-shadow" />
      <rect width={width} height={depth} fill={`url(#${gridId})`} className="svg-wall" />
      {layout.objects.map((storedObject) => {
        const object = preview?.id === storedObject.id ? preview : storedObject;
        const { width, depth } = footprint(object);
        const selected = selectedId === object.id;
        const warning = overlaps.has(object.id);
        return (
          <g key={object.id} data-object={object.id} transform={`translate(${object.x} ${object.y})`} className="svg-object" aria-label={object.name ?? furniture[object.type].label}>
            <FurnitureArt object={object} />
            <rect width={width} height={depth} rx=".08" className={`svg-hit ${selected ? "is-selected" : ""} ${warning ? "is-overlap" : ""} ${highlightedIds.includes(object.id) ? "is-highlighted" : ""} ${object.aiSource || (aiHighlights && highlightedIds.includes(object.id)) ? "is-ai-highlighted" : ""}`} />
            {object.seats && <text x={width / 2} y={depth * .62} textAnchor="middle" className="svg-seat-label" fontSize={Math.min(.22, width / 3)} pointerEvents="none">{object.seatOwnerId ? "+0" : `${object.seats} seats`}</text>}
          </g>
        );
      })}
      {proposedObject && <g transform={`translate(${proposedObject.x} ${proposedObject.y})`} pointerEvents="none" className="svg-proposed" aria-label="Proposed furniture position">
        <FurnitureArt object={proposedObject} />
        <rect width={footprint(proposedObject).width} height={footprint(proposedObject).depth} className="svg-proposed-outline" />
      </g>}
      {aiPreview.map(object => <g key={object.id} transform={`translate(${object.x} ${object.y})`} pointerEvents="none" className="svg-proposed svg-proposed-ai" aria-label="AI proposed furniture position"><FurnitureArt object={object} /><rect width={footprint(object).width} height={footprint(object).depth} className="svg-proposed-outline" /></g>)}
    </svg>
  );
}
