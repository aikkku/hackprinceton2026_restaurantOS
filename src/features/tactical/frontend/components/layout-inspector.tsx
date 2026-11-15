"use client";

import { useState, type FormEvent } from "react";
import { furniture } from "../../domain/layout";
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
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const object = applyObjectMeasurements(layout, selected, {
        name: String(data.get("objectName") ?? "").trim() || furniture[selected.type].label,
        description: String(data.get("description") ?? ""),
        category: selected.type === "custom" ? String(data.get("category")) as LayoutObject["category"] : undefined,
        seatOwnerId: selected.type === "chair" ? String(data.get("seatOwnerId") ?? "") : undefined,
        x: displayedMeasurement(selected.x, unit),
        y: displayedMeasurement(selected.y, unit),
        width: Number(data.get("width")),
        depth: Number(data.get("depth")),
        rotation: selected.rotation,
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
      {selected.aiSource && <p className="ai-surface">AI-assisted {selected.aiSource.method === "move" ? "position" : "object"} · {selected.aiSource.model}. Subsequent manual edits remain user-controlled; verify dimensions and placement.</p>}
      <label>Object name<input name="objectName" maxLength={120} defaultValue={selected.name ?? furniture[selected.type].label} required /></label>
      <label>Description<textarea name="description" maxLength={2000} defaultValue={selected.description ?? ""} placeholder="Purpose, material, airflow, or other context" /></label>
      {selected.type === "custom" && <label>Object category<select name="category" defaultValue={selected.category ?? "other"}>
        <option value="equipment">Equipment</option><option value="storage">Storage</option><option value="decoration">Decoration</option><option value="other">Other</option>
      </select></label>}
      {selected.type === "chair" && <label>Seat ownership<select name="seatOwnerId" defaultValue={selected.seatOwnerId ?? ""}>
        <option value="">Standalone · adds capacity</option>
        {layout.objects.filter(object => ["table_2", "table_4", "booth", "counter"].includes(object.type)).map(object => <option key={object.id} value={object.id}>Included in {object.name ?? furniture[object.type].label} · {object.id}</option>)}
      </select></label>}
      <div className="inspector-fields">
        <label>Furniture width ({unit})<input name="width" type="number" min={.01} step="any" required defaultValue={displayedMeasurement(selected.width, unit)} /></label>
        <label>Furniture depth ({unit})<input name="depth" type="number" min={.01} step="any" required defaultValue={displayedMeasurement(selected.depth, unit)} /></label>
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
