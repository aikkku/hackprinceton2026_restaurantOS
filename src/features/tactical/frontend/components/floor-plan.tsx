"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { furniture, footprint, positionObject } from "../../domain/layout";
import { floorWarnings, floorOverlapIds, resizeFromCorner } from "../../domain/floor-editor";
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

/** Draw in room units so a wider table gains seats without stretching its chairs. */
export function FurnitureArt({ object, assigned = 0 }: { object: LayoutObject; assigned?: number }) {
  const { type, rotation, width: w, depth: d } = object;
  const size = footprint(object);
  const count = Math.max(0, (object.seats ?? 0) - assigned);
  const tables = type === "table_2" || type === "table_4";
  const chairDepth = Math.min(.24, d * .24);
  const markers = (rows: number, top: number, bottom = top) => Array.from({ length: count }, (_, index) => {
    const row = index % rows;
    const slots = Math.ceil((count - row) / rows);
    const chairWidth = Math.min(.34, w / (slots + 1) * .72);
    const x = (Math.floor(index / rows) + 1) * w / (slots + 1) - chairWidth / 2;
    const y = row ? bottom : top;
    return <g key={index} data-chair-marker="">
      <rect className="svg-chair" x={x} y={y} width={chairWidth} height={chairDepth} rx={Math.min(.065, chairDepth / 3)} />
      <path className="svg-chair-seam" d={`M${x + chairWidth * .16} ${y + chairDepth * (row ? .75 : .25)}h${chairWidth * .68}`} />
    </g>;
  });
  const tableY = chairDepth + .035;
  const tableHeight = Math.max(.05, d - 2 * tableY);
  return (
    <g className="floor-furniture-art" transform={`translate(${size.width / 2} ${size.depth / 2}) rotate(${rotation}) translate(${-w / 2} ${-d / 2})`}>
      {tables && <>
        {markers(2, 0, d - chairDepth)}
        <rect className="svg-table" x={w * .08} y={tableY} width={w * .84} height={tableHeight} rx={Math.min(.13, tableHeight / 3)} />
        <rect className="svg-table-inlay" x={w * .08 + .045} y={tableY + .035} width={Math.max(.02, w * .84 - .09)} height={Math.max(.02, tableHeight - .07)} rx={Math.min(.09, tableHeight / 4)} />
        <circle className="svg-pot" cx={w / 2} cy={d / 2} r={Math.min(.075, d * .07)} />
        <circle className="svg-leaf" cx={w / 2} cy={d / 2} r={Math.min(.05, d * .05)} />
      </>}
      {type === "booth" && <>
        <rect className="svg-booth-base" x={w * .025} y={d * .025} width={w * .95} height={d * .95} rx={Math.min(.12, d * .1)} />
        <rect className="svg-booth-seat" x={w * .06} y={d * .07} width={w * .88} height={d * .22} rx={.07} />
        <rect className="svg-booth-seat" x={w * .06} y={d * .71} width={w * .88} height={d * .22} rx={.07} />
        <rect className="svg-table" x={w * .08} y={d * .33} width={w * .84} height={d * .34} rx={.07} />
        {markers(2, d * .08, d * .73)}
      </>}
      {type === "counter" && <>
        {markers(1, d - chairDepth)}
        <rect className="svg-table" x={w * .02} y={d * .03} width={w * .96} height={d * .63} rx={.09} />
        <path className="svg-table-inlay" d={`M${w * .07} ${d * .12}H${w * .93}`} />
      </>}
      {type === "cashier_stand" && <>
        <rect className="svg-cashier" x={w * .025} y={d * .025} width={w * .95} height={d * .95} rx={.08} />
        <rect className="svg-register-base" x={w * .29} y={d * .2} width={w * .42} height={d * .6} rx={.035} />
        <rect className="svg-register-screen" x={w * .32} y={d * .25} width={w * .36} height={d * .31} rx={.025} />
        <path className="svg-register-key" d={`M${w * .36} ${d * .68}h${w * .08}m${w * .06} 0h${w * .08}`} />
      </>}
      {type === "door" && <>
        <path className="svg-door-swing" d={`M${w * .05} ${d * .9}Q${w * .05} ${d * .06} ${w * .9} ${d * .06}`} />
        <path className="svg-door-line" d={`M${w * .05} ${d * .9}H${w * .95}M${w * .05} ${d * .9}V${d * .06}`} />
      </>}
      {(type === "divider" || type === "wall") && <>
        <rect className="svg-divider" x={0} y={0} width={w} height={d} rx={Math.min(.05, d / 4)} />
        <path className="svg-divider-inlay" d={`M${w * .03} ${d / 2}H${w * .97}`} />
      </>}
      {type === "chair" && <>
        <rect className="svg-chair" x={w * .1} y={d * .1} width={w * .8} height={d * .8} rx={Math.min(.1, w * .2)} />
        <path className="svg-chair-seam" d={`M${w * .22} ${d * .3}H${w * .78}`} />
      </>}
      {type === "window" && <>
        <rect className="svg-window" width={w} height={d} rx={.025} />
        <path className="svg-window-line" d={`M0 ${d / 2}H${w}M${w / 3} 0V${d}M${w * 2 / 3} 0V${d}`} />
      </>}
      {(type === "light" || type === "decoration") && <>
        <ellipse className="svg-pot" cx={w / 2} cy={d / 2} rx={w * .44} ry={d * .44} />
        <ellipse className="svg-lamp" cx={w / 2} cy={d / 2} rx={w * .3} ry={d * .3} />
      </>}
      {(type === "ac" || type === "custom") && <>
        <rect className="svg-equipment" x={w * .02} y={d * .02} width={w * .96} height={d * .96} rx={Math.min(.08, d * .15)} />
        {type === "ac" && <path className="svg-window-line" d={`M${w * .1} ${d * .4}H${w * .9}M${w * .1} ${d * .65}H${w * .9}`} />}
      </>}
      {type === "plant" && <>
        <ellipse className="svg-pot" cx={w * .5} cy={d * .5} rx={w * .4} ry={d * .4} />
        {[0, 60, 120, 180, 240, 300].map(angle => <ellipse key={angle} className={angle % 120 ? "svg-leaf-light" : "svg-leaf"} cx={w * .5} cy={d * .3} rx={w * .14} ry={d * .28} transform={`rotate(${angle} ${w / 2} ${d / 2})`} />)}
      </>}
    </g>
  );
}

export function FurnitureThumbnail({ kind }: { kind: LayoutObject["type"] }) {
  const { width, depth, seats } = furniture[kind];
  return <svg className="floor-furniture-thumbnail" viewBox={`-.15 -.15 ${width + .3} ${depth + .3}`} aria-hidden="true">
    <FurnitureArt object={{ id: "thumbnail", type: kind, width, depth, seats, x: 0, y: 0, rotation: 0 }} />
  </svg>;
}

export function FloorPlan({ layout, selectedId, placing, highlightedIds, aiPreview, onKeys, onSelect, onPlace, onMove }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [preview, setPreview] = useState<LayoutObject | null>(null);
  const floorId = useId();
  const { width, depth } = layout.room;
  const scale = Math.max(width, depth * 1.35);
  const pad = scale * .075;

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
    setHoveredId(id);
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (position) onMove(position);
  }

  const objects = layout.objects.map(object => preview?.id === object.id ? preview : object);
  const warnings = floorWarnings(objects);
  const overlaps = floorOverlapIds(objects);
  const assigned = (id: string) => objects.reduce((count, object) => count + (object.seatOwnerId === id ? object.seats ?? 0 : 0), 0);

  const hoveredWarnings = !placing && hoveredId ? warnings.get(hoveredId) : undefined;

  return (
    <>
    <svg
      ref={svg}
      role="group"
      aria-label="Floor plan canvas"
      tabIndex={0}
      aria-describedby="floor-shortcuts"
      onKeyDown={event => {
        if (event.key === "Escape" && drag.current) {
          const pointerId = drag.current.pointerId;
          drag.current = null;
          setPreview(null);
          if (event.currentTarget.hasPointerCapture(pointerId)) event.currentTarget.releasePointerCapture(pointerId);
        }
        onKeys(event, (event.target as Element).closest<SVGGElement>("[data-object]")?.dataset.object);
      }}
      className={`floor-svg ${placing ? "is-placing" : ""}`}
      viewBox={`${-pad} ${-pad} ${width + pad * 2} ${depth + pad * 2}`}
      onPointerDown={pointerDown}
      onPointerMove={(event) => {
        if (drag.current?.pointerId === event.pointerId) setPreview(dragPosition(event));
      }}
      onPointerUp={(event) => finishDrag(event, true)}
      onPointerLeave={() => { if (!drag.current) setHoveredId(null); }}
      onPointerCancel={(event) => finishDrag(event, false)}
      onLostPointerCapture={(event) => finishDrag(event, false)}
    >
      <defs>
        <pattern id={floorId} width="3" height=".45" patternUnits="userSpaceOnUse">
          <rect width="3" height=".45" className="svg-floor" />
          <path d="M0 .45H3M1.5 0V.45" className="floor-board-line" />
        </pattern>
      </defs>
      <rect x={-.12} y={-.12} width={width + .24} height={depth + .24} rx=".1" className="floor-wall-outer" />
      <rect width={width} height={depth} rx=".025" fill={`url(#${floorId})`} className="svg-wall" />
      {objects.map(object => {
        const { width, depth } = footprint(object);
        const selected = selectedId === object.id;
        const warning = warnings.get(object.id);
        const name = object.name ?? furniture[object.type].label;
        const handle = Math.min(.19, width / 3, depth / 3);
        return (
          <g key={object.id} role="button" tabIndex={0} aria-pressed={selected} data-object={object.id}
            transform={`translate(${object.x} ${object.y})`} className="svg-object"
            onPointerEnter={() => setHoveredId(object.id)}
            onPointerLeave={() => { if (!drag.current) setHoveredId(null); }}
            onFocus={() => onSelect(object.id)}
            aria-label={warning ? `${name}: ${warning.join(". ")}` : name}>
            <title>{warning ? `${name} · ${warning.join(" · ")}` : name}</title>
            <FurnitureArt object={object} assigned={assigned(object.id)} />
            <rect width={width} height={depth} rx=".06" className={`svg-hit ${selected ? "is-selected" : ""} ${warning ? "is-floor-warning" : ""} ${overlaps.has(object.id) ? "is-floor-overlap" : ""} ${object.aiSource || highlightedIds.includes(object.id) ? "is-ai-highlighted" : ""}`} />
            {selected && <rect data-resize="" className="floor-resize-handle" x={width - handle} y={depth - handle} width={handle} height={handle}><title>Drag to resize</title></rect>}
          </g>
        );
      })}
      {aiPreview.map(object => <g key={object.id} transform={`translate(${object.x} ${object.y})`} pointerEvents="none" className="svg-proposed svg-proposed-ai" aria-label="AI proposed furniture position"><FurnitureArt object={object} assigned={assigned(object.id)} /><rect width={footprint(object).width} height={footprint(object).depth} className="svg-proposed-outline" /></g>)}
    </svg>
    {hoveredWarnings && <div className={`floor-hover-warning ${hoveredId && overlaps.has(hoveredId) ? "is-floor-overlap" : ""}`} role="tooltip">
      <TriangleAlert size={15} aria-hidden="true" />
      <div>{hoveredWarnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div>
    </div>}
    </>
  );
}
