"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { TriangleAlert } from "lucide-react";
import { furniture, footprint, positionObject } from "../../domain/layout";
import { floorWarnings, floorOverlapIds, resizeFromCorner } from "../../domain/floor-editor";
import type { Layout, LayoutObject } from "../../domain/schemas";
import { FurnitureArt, RoomArt, SceneMaterials } from "./floor-scene-art";

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

export function FurnitureThumbnail({ kind }: { kind: LayoutObject["type"] }) {
  const { width, depth, seats } = furniture[kind];
  const materialId = useId();
  return <svg className="floor-furniture-thumbnail" viewBox={`-.15 -.15 ${width + .3} ${depth + .3}`} aria-hidden="true">
    <SceneMaterials id={materialId} />
    <FurnitureArt materialId={materialId} object={{ id: "thumbnail", type: kind, width, depth, seats, x: 0, y: 0, rotation: 0 }} />
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
  const pad = Math.max(.38, scale * .04);

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
      <SceneMaterials id={floorId} />
      <RoomArt width={width} depth={depth} materialId={floorId} />
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
            <FurnitureArt materialId={floorId} object={object} assigned={assigned(object.id)} />
            <rect width={width} height={depth} rx=".06" className={`svg-hit ${selected ? "is-selected" : ""} ${warning ? "is-floor-warning" : ""} ${overlaps.has(object.id) ? "is-floor-overlap" : ""} ${object.aiSource || highlightedIds.includes(object.id) ? "is-ai-highlighted" : ""}`} />
            {selected && <rect data-resize="" className="floor-resize-handle" x={width - handle} y={depth - handle} width={handle} height={handle}><title>Drag to resize</title></rect>}
          </g>
        );
      })}
      {aiPreview.map(object => <g key={object.id} transform={`translate(${object.x} ${object.y})`} pointerEvents="none" className="svg-proposed svg-proposed-ai" aria-label="AI proposed furniture position"><FurnitureArt materialId={floorId} object={object} assigned={assigned(object.id)} /><rect width={footprint(object).width} height={footprint(object).depth} className="svg-proposed-outline" /></g>)}
    </svg>
    {hoveredWarnings && <div className={`floor-hover-warning ${hoveredId && overlaps.has(hoveredId) ? "is-floor-overlap" : ""}`} role="tooltip">
      <TriangleAlert size={15} aria-hidden="true" />
      <div>{hoveredWarnings.map((warning, index) => <p key={`${index}-${warning}`}>{warning}</p>)}</div>
    </div>}
    </>
  );
}
