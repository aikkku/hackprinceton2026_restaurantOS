"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { furniture, footprint, positionObject } from "../../domain/layout";
import { floorWarnings, resizeFromCorner } from "../../domain/floor-editor";
import type { Layout, LayoutObject } from "../../domain/schemas";

type Props = {
  layout: Layout;
  selectedId: string | null;
  placing: boolean;
  highlightedIds: string[];
  aiPreview: LayoutObject[];
  onKeys: (event: KeyboardEvent<SVGSVGElement>, objectId?: string) => void;
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
  resizing: boolean;
};

function FurnitureArt({ object, assigned = 0 }: { object: LayoutObject; assigned?: number }) {
  const { type, rotation } = object;
  const size = footprint(object);
  const swap = rotation === 90 || rotation === 270;
  const scale = swap ? [size.depth, size.width] : [size.width, size.depth];
  const tables = type === "table_2" || type === "table_4";
  const count = Math.max(0, (object.seats ?? 0) - assigned);
  const markers = (rows: number, top: number, bottom = top) => Array.from({ length: count }, (_, index) => {
    const row = index % rows;
    const slots = Math.ceil((count - row) / rows);
    const x = (Math.floor(index / rows) + 1) / (slots + 1);
    const halfWidth = Math.min(.09, .3 / slots, .14 / object.width);
    return <rect key={index} data-chair-marker="" className="svg-chair" x={x - halfWidth} y={row ? bottom : top} width={halfWidth * 2} height=".14" rx=".035" />;
  });
  return (
    <g transform={`translate(${size.width / 2} ${size.depth / 2}) rotate(${rotation}) scale(${scale.join(" ")}) translate(-0.5 -0.5)`}>
      {tables && <>
        {markers(2, .035, .825)}
        <rect className="svg-furniture-shadow" x=".21" y=".25" width=".6" height=".57" rx=".1" />
        <rect className="svg-table" x=".2" y=".19" width=".6" height=".57" rx=".1" />
        <circle className="svg-plate" cx=".5" cy=".48" r=".075" />
      </>}
      {type === "booth" && <>
        <rect className="svg-booth-base" x=".03" y=".06" width=".94" height=".87" rx=".12" />
        <rect className="svg-booth-seat" x=".11" y=".14" width=".78" height=".22" rx=".08" />
        <rect className="svg-booth-seat" x=".11" y=".64" width=".78" height=".22" rx=".08" />
        <rect className="svg-table" x=".22" y=".32" width=".56" height=".35" rx=".07" />
        {markers(2, .155, .68)}
      </>}
      {type === "counter" && <>
        {markers(1, .66)}
        <rect className="svg-table" x=".02" y=".1" width=".96" height=".48" rx=".09" />
        <rect className="svg-plate" x=".12" y=".22" width=".18" height=".21" rx=".03" />
      </>}
      {type === "cashier_stand" && <>
        <rect className="svg-cashier" x=".02" y=".08" width=".96" height=".84" rx=".09" />
        <rect className="svg-appliance" x=".27" y=".23" width=".42" height=".45" rx=".07" />
        <path className="svg-register" d="M.34 .39H.62M.37 .54h.03m.09 0h.03m.06 0h.03" />
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

export function FloorPlan({ layout, selectedId, placing, highlightedIds, aiPreview, onKeys, onSelect, onPlace, onMove }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [preview, setPreview] = useState<LayoutObject | null>(null);
  const floorId = useId();
  const { width, depth } = layout.room;
  const scale = Math.max(width, depth * 1.35);
  const pad = scale * .035;

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
    const target = event.target as Element;
    const hit = target.closest<SVGGElement>("[data-object]");
    const id = hit?.dataset.object ?? null;
    (hit ?? event.currentTarget).focus({ preventScroll: true });
    onSelect(id);
    const object = layout.objects.find((item) => item.id === id);
    if (!object) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: object.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
      offsetX: point.x - object.x, offsetY: point.y - object.y,
      resizing: target.hasAttribute("data-resize"),
    };
  }

  function dragPosition(event: PointerEvent<SVGSVGElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.pointerId !== event.pointerId
      || Math.hypot(gesture.clientX - event.clientX, gesture.clientY - event.clientY) < 3) return null;
    const point = roomPoint(event);
    const object = layout.objects.find((item) => item.id === gesture.id);
    if (!point || !object) return null;
    if (gesture.resizing) {
      const bounds = footprint(object);
      return resizeFromCorner(layout, object, bounds.width + point.x - object.x - gesture.offsetX, bounds.depth + point.y - object.y - gesture.offsetY);
    }
    return positionObject(object, layout.room, point.x - gesture.offsetX, point.y - gesture.offsetY, false);
  }

  function finishDrag(event: PointerEvent<SVGSVGElement>, commit: boolean) {
    if (drag.current?.pointerId !== event.pointerId) return;
    const position = commit ? dragPosition(event) : null;
    drag.current = null;
    setPreview(null);
    if (position) onMove(position);
  }

  const objects = layout.objects.map(object => preview?.id === object.id ? preview : object);
  const warnings = floorWarnings(objects);
  const assigned = (id: string) => objects.reduce((count, object) => count + (object.seatOwnerId === id ? object.seats ?? 0 : 0), 0);

  return (
    <svg
      ref={svg}
      role="group"
      aria-label="Floor plan canvas"
      tabIndex={0}
      aria-describedby="floor-shortcuts"
      onKeyDown={event => onKeys(event, (event.target as Element).closest<SVGGElement>("[data-object]")?.dataset.object)}
      className={`floor-svg ${placing ? "is-placing" : ""}`}
      viewBox={`${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`}
      onPointerDown={pointerDown}
      onPointerMove={(event) => {
        if (drag.current?.pointerId === event.pointerId) setPreview(dragPosition(event));
      }}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => finishDrag(event, false)}
    >
      <defs>
        <pattern id={floorId} width="1" height=".5" patternUnits="userSpaceOnUse">
          <rect width="1" height=".5" className="svg-floor" />
          <rect x=".5" y=".25" width=".5" height=".25" className="svg-tile" />
        </pattern>
      </defs>
      <rect width={width} height={depth} rx=".04" fill={`url(#${floorId})`} className="svg-wall" />
      {objects.map(object => {
        const { width, depth } = footprint(object);
        const selected = selectedId === object.id;
        const warning = warnings.get(object.id);
        const name = object.name ?? furniture[object.type].label;
        const handle = Math.min(.19, width / 3, depth / 3);
        return (
          <g key={object.id} role="button" tabIndex={0} aria-pressed={selected} data-object={object.id}
            transform={`translate(${object.x} ${object.y})`} className="svg-object"
            onFocus={() => onSelect(object.id)}
            aria-label={warning ? `${name}: ${warning.join(". ")}` : name}>
            <title>{warning ? `${name} · ${warning.join(" · ")}` : name}</title>
            <FurnitureArt object={object} assigned={assigned(object.id)} />
            <rect width={width} height={depth} rx=".06" className={`svg-hit ${selected ? "is-selected" : ""} ${warning ? "is-floor-warning" : ""} ${object.aiSource || highlightedIds.includes(object.id) ? "is-ai-highlighted" : ""}`} />
            {selected && <rect data-resize="" className="floor-resize-handle" x={width - handle} y={depth - handle} width={handle} height={handle}><title>Drag to resize</title></rect>}
          </g>
        );
      })}
      {aiPreview.map(object => <g key={object.id} transform={`translate(${object.x} ${object.y})`} pointerEvents="none" className="svg-proposed svg-proposed-ai" aria-label="AI proposed furniture position"><FurnitureArt object={object} assigned={assigned(object.id)} /><rect width={footprint(object).width} height={footprint(object).depth} className="svg-proposed-outline" /></g>)}
    </svg>
  );
}
