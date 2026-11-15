"use client";

import { useState, type FormEvent } from "react";
import { furniture, hasOverlap, objectClearance, displayLength } from "../../domain/layout";
import type { Layout, LayoutObject } from "../../domain/schemas";
import { applyObjectMeasurements, displayedMeasurement } from "../layout-edit";
import "./layout-tools.css";

type Props = {
  layout: Layout;
  selected: LayoutObject | undefined;
  unit: "m" | "ft";
  onUpdate: (object: LayoutObject) => void;
  onNotice: (message: string) => void;
};

function ObjectForm({ layout, selected, unit, onUpdate, onNotice }: Props & { selected: LayoutObject }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isSeating = furniture[selected.type].seats > 0;
  const overlap = layout.objects.some((object) => object.id !== selected.id && hasOverlap(object, selected));
  const clearance = objectClearance(layout, selected);
  const nearest = layout.objects.find(object => object.id === clearance.nearest?.id);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const object = applyObjectMeasurements(layout, selected, {
        name: String(data.get("objectName") ?? "").trim() || furniture[selected.type].label,
        description: String(data.get("description") ?? ""),
        category: selected.type === "custom" ? String(data.get("category")) as LayoutObject["category"] : undefined,
        seatOwnerId: selected.type === "chair" ? String(data.get("seatOwnerId") ?? "") : undefined,
        x: Number(data.get("x")),
        y: Number(data.get("y")),
        width: Number(data.get("width")),
        depth: Number(data.get("depth")),
        rotation: Number(data.get("rotation")),
        seats: isSeating ? Number(data.get("seats")) : undefined,
      }, unit);
      setError(null);
      setSaved(true);
      onUpdate(object);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Check the dimensions and try again.";
      setError(message);
      setSaved(false);
      onNotice(message);
    }
  }

  return (
    <form className="layout-inspector" onSubmit={submit} onChange={() => setSaved(false)}>
      <h3>{furniture[selected.type].label} details</h3>
      {selected.aiSource && <p className="ai-surface">AI-assisted {selected.aiSource.method === "move" ? "position" : "object"} · {selected.aiSource.model}. Subsequent manual edits remain user-controlled; verify dimensions and placement.</p>}
      <p>Enter the furniture footprint and its position from the room’s top-left corner.</p>
      <label>Object name<input name="objectName" maxLength={120} defaultValue={selected.name ?? furniture[selected.type].label} required /></label>
      <label>Description<textarea name="description" maxLength={2000} defaultValue={selected.description ?? ""} placeholder="Purpose, material, airflow, or other context" /></label>
      {selected.type === "custom" && <label>Object category<select name="category" defaultValue={selected.category ?? "other"}>
        <option value="equipment">Equipment</option><option value="storage">Storage</option><option value="decoration">Decoration</option><option value="other">Other</option>
      </select></label>}
      {selected.type === "chair" && <label>Seat ownership<select name="seatOwnerId" defaultValue={selected.seatOwnerId ?? ""}>
        <option value="">Standalone · adds capacity</option>
        {layout.objects.filter(object => ["table_2", "table_4", "booth", "counter"].includes(object.type)).map(object => <option key={object.id} value={object.id}>Included in {object.name ?? furniture[object.type].label} · {object.id}</option>)}
      </select></label>}
      {isSeating && <p>Tables, booths and counters include their seats. Assigned chairs represent those existing seats and add zero capacity. Standalone chairs add their own seats.</p>}
      <div className="inspector-fields">
        <label>Across ({unit})<input name="x" type="number" min={0} step="any" required defaultValue={displayedMeasurement(selected.x, unit)} /></label>
        <label>Down ({unit})<input name="y" type="number" min={0} step="any" required defaultValue={displayedMeasurement(selected.y, unit)} /></label>
        <label>Furniture width ({unit})<input name="width" type="number" min={0} step="any" required defaultValue={displayedMeasurement(selected.width, unit)} /></label>
        <label>Furniture depth ({unit})<input name="depth" type="number" min={0} step="any" required defaultValue={displayedMeasurement(selected.depth, unit)} /></label>
        <label>Rotation<select name="rotation" defaultValue={selected.rotation}>
          <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
        </select></label>
        {isSeating && <label>Seats<input name="seats" type="number" min={1} max={100} step={1} required defaultValue={selected.seats} /></label>}
      </div>
      {overlap && <p className="inspector-warning">This furniture overlaps another object.</p>}
      <div className="clearance-summary">
        <h4>Measured footprint gaps</h4>
        <p>Nearest room edge: {displayLength(clearance.wallGap, unit).toFixed(2)} {unit}.</p>
        <p>{nearest && clearance.nearest ? `Nearest object: ${nearest.name ?? furniture[nearest.type].label}, ${displayLength(clearance.nearest.gap, unit).toFixed(2)} ${unit}.` : "No other objects to measure."}</p>
        <p>Shortest edge-to-edge distance from the recorded rectangles, including rotation. Zero means touching or overlapping. This is not walking clearance, door swing, comfort or code compliance.</p>
      </div>
      {error && <p className="inspector-warning" role="alert">{error}</p>}
      <div className="button-row">
        <button type="submit" className="button compact secondary">Apply furniture details</button>
        {saved && <span className="inspector-saved" role="status">Applied</span>}
      </div>
    </form>
  );
}

export function LayoutInspector(props: Props) {
  const { selected, unit } = props;
  if (!selected) return null;
  return <ObjectForm key={`${unit}-${JSON.stringify(selected)}`} {...props} selected={selected} />;
}
