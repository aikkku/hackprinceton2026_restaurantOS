"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { Check, ChevronDown, Plus, Redo2, RotateCcw, Save, Search, Settings2, SlidersHorizontal, Sparkles, Undo2, X } from "lucide-react";
import { aiError, proposedAiLayout, type AiResult } from "../../domain/ai";
import { clearFloorPosition, mergeFloorVersions, modernFloor, modernFloorLibrary, sameFloor } from "../../domain/floor-editor";
import { fitsRoom, footprint, furniture, positionObject } from "../../domain/layout";
import { initialLibrary, layoutLibrarySchema, type LayoutLibrary } from "../../domain/layout-library";
import { layoutSchema, objectLimit, roomSchema, type Layout, type LayoutObject, type ObjectKind } from "../../domain/schemas";
import { parseLibraryBackup, writeLibrary } from "../layout-storage";
import { makeId, readSaved } from "../storage";
import { AiAccessControls, AiWorkbench, useAiAccess } from "./ai-workbench";
import { FloorPlan, FurnitureThumbnail } from "./floor-plan";
import { LayoutInspector } from "./layout-inspector";
import { StateButton } from "./state-button";
import "./floor-editor.css";

type Preview = { from: Layout; layout: Layout; ids: string[] };
export type FloorContext = { layout: Layout; library: LayoutLibrary; dirty: boolean };
const palette: ObjectKind[] = ["table_2", "table_4", "booth", "counter", "chair", "cashier_stand", "plant", "divider", "wall", "door", "window", "light", "decoration", "ac", "custom"];
const initialCustom = { name: "Custom object", description: "", category: "equipment" as NonNullable<LayoutObject["category"]>, width: 1, depth: 1 };
const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function FloorEditor({ template, saved, cloud, analysisRequested, onContext }: {
  template: Layout;
  saved: LayoutLibrary;
  cloud: boolean;
  analysisRequested: number;
  onContext: (context: FloorContext) => void;
}) {
  const [library, setLibrary] = useState(() => modernFloorLibrary(saved));
  const [layout, setLayout] = useState(() => modernFloor(saved.entries.find(entry => entry.id === saved.activeId)!.layout));
  const [history, setHistory] = useState<Layout[]>([]);
  const [future, setFuture] = useState<Layout[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<ObjectKind | null>(null);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(initialCustom);
  const [customAi, setCustomAi] = useState<LayoutObject["aiSource"]>();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>();
  const libraryRaw = useRef<string | null>(null);
  const pendingVersion = useRef<{ id: string; layout: Layout } | null>(null);
  const analysisTile = useRef<HTMLDetailsElement>(null);
  const paletteMenu = useRef<HTMLDetailsElement>(null);
  const settingsMenu = useRef<HTMLDetailsElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const access = useAiAccess();
  const key = `restaurant-os:tactical:${template.restaurantId}:layouts:v1`;
  const checkpoint = library.entries.find(entry => entry.id === library.activeId)!.layout;
  const dirty = !sameFloor(layout, checkpoint);
  const selected = layout.objects.find(object => object.id === selectedId);
  const activePreview = preview?.from === layout ? preview : null;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      let versions = modernFloorLibrary(saved);
      try {
        const raw = localStorage.getItem(key);
        libraryRaw.current = raw;
        const oldDraft = raw === null ? readSaved(`restaurant-os:tactical:${template.restaurantId}:layout:v1`, layoutSchema).value : null;
        const browser = raw !== null ? parseLibraryBackup(raw, template.restaurantId)
          : oldDraft?.restaurantId === template.restaurantId ? initialLibrary(oldDraft) : null;
        if (browser) versions = mergeFloorVersions(versions, modernFloorLibrary(browser));
        const lastOpened = localStorage.getItem(`${key}:active`);
        if (versions.entries.some(entry => entry.id === lastOpened)) versions = { ...versions, activeId: lastOpened! };
      } catch {
        setNotice({ message: "Browser versions could not be read.", error: true });
      }
      setLibrary(versions);
      setLayout(versions.entries.find(entry => entry.id === versions.activeId)!.layout);
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [key, saved, template.restaurantId]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      for (const ref of [paletteMenu, settingsMenu]) {
        if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  useEffect(() => { onContext({ layout, library, dirty }); }, [layout, library, dirty, onContext]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!analysisRequested) return;
    const frame = requestAnimationFrame(() => {
      if (analysisTile.current) {
        analysisTile.current.open = true;
        analysisTile.current.scrollIntoView({ block: "nearest" });
        analysisTile.current.querySelector("summary")?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [analysisRequested]);

  function replace(next: Layout) {
    setLayout(next);
    setHistory([]);
    setFuture([]);
    setSelectedId(null);
    setPlacing(null);
    setPreview(null);
    setHighlightedIds([]);
  }

  function commit(next: Layout) {
    const parsed = layoutSchema.safeParse({ ...next, schemaVersion: next.objects.some(object => object.seatOwnerId) ? 2 : next.schemaVersion });
    if (!parsed.success) {
      setNotice({ message: parsed.error.issues[0].message, error: true });
      return false;
    }
    if (sameFloor(layout, parsed.data)) return false;
    setHistory(previous => [...previous.slice(-49), layout]);
    setFuture([]);
    setPreview(null);
    setHighlightedIds([]);
    setNotice(undefined);
    setLayout({ ...parsed.data, updatedAt: new Date().toISOString() });
    return true;
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory(history.slice(0, -1));
    setFuture([layout, ...future]);
    setLayout(previous);
    setPreview(null);
    setHighlightedIds([]);
    setNotice(undefined);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setFuture(future.slice(1));
    setHistory([...history, layout]);
    setLayout(next);
    setPreview(null);
    setHighlightedIds([]);
    setNotice(undefined);
  }

  function openVersion(id: string) {
    const version = library.entries.find(entry => entry.id === id);
    if (!version || id === library.activeId) return;
    if (dirty && !window.confirm("Open this version and discard unsaved changes?")) return;
    setLibrary({ ...library, activeId: id });
    try { localStorage.setItem(`${key}:active`, id); } catch { /* Selection preference is optional. */ }
    replace(version.layout);
    setNotice(undefined);
  }

  async function save() {
    if (saving || !ready || !dirty) return;
    if (library.entries.length >= 50) {
      setNotice({ message: "This restaurant has reached the 50-version limit.", error: true });
      return;
    }
    if (cloud && !access) {
      setNotice({ message: "Unlock the workspace below to save this version to MongoDB.", error: true });
      if (analysisTile.current) analysisTile.current.open = true;
      return;
    }
    setSaving(true);
    const pending = pendingVersion.current;
    const versionToSave = pending && sameFloor(pending.layout, layout)
      ? pending
      : { id: makeId(), layout: { ...layout, updatedAt: new Date().toISOString() } };
    pendingVersion.current = versionToSave;
    const { id, layout: version } = versionToSave;
    let next = { ...library, activeId: id, entries: [...library.entries, { id, layout: version }] };
    try {
      if (cloud) {
        const response = await fetch("/api/tactical/floor-versions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ library: next }),
          signal: AbortSignal.timeout(30_000),
        });
        const result = await response.json();
        if (!response.ok) {
          setNotice({ message: result.error ?? "MongoDB could not save this version.", error: true });
          if (response.status === 401 && analysisTile.current) analysisTile.current.open = true;
          return;
        }
        next = layoutLibrarySchema.parse(result.library);
      } else {
        // A version only appends data, so incorporate any versions another tab has written.
        const raw = localStorage.getItem(key);
        if (raw !== libraryRaw.current && raw !== null) {
          next = { ...mergeFloorVersions(parseLibraryBackup(raw, template.restaurantId), next), activeId: id };
        }
        libraryRaw.current = writeLibrary(localStorage, key, raw, next, template.restaurantId);
      }
      setLayout(version);
      setLibrary(next);
      try { localStorage.setItem(`${key}:active`, id); } catch { /* The version itself has already been saved. */ }
      pendingVersion.current = null;
      setNotice({ message: cloud ? "Version saved to MongoDB." : "Version saved on this device." });
    } catch {
      setNotice({ message: "Could not save the version. Your draft is still open.", error: true });
    } finally { setSaving(false); }
  }

  function select(id: string | null) {
    setSelectedId(id);
    setHighlightedIds([]);
    if (id) setPlacing(null);
  }

  function updateObject(object: LayoutObject) {
    commit({ ...layout, objects: layout.objects.map(item => item.id === object.id ? object : item) });
  }

  function addObject(object: LayoutObject, point?: { x: number; y: number }) {
    if (layout.objects.length >= objectLimit) {
      setNotice({ message: `This plan already has ${objectLimit} objects.`, error: true });
      return;
    }
    const size = footprint(object);
    if (!fitsRoom({ ...object, x: 0, y: 0 }, layout.room)) {
      setNotice({ message: "This object is larger than the room.", error: true });
      return;
    }
    const next = point ? positionObject(object, layout.room, point.x - size.width / 2, point.y - size.depth / 2, false) : clearFloorPosition(layout, object);
    if (!next) {
      setNotice({ message: "No clear spot found. Choose a position on the map.", error: true });
      return;
    }
    if (commit({ ...layout, objects: [...layout.objects, next] })) {
      setPlacing(null);
      setSelectedId(next.id);
    }
  }

  function addFromPalette(kind: ObjectKind, point?: { x: number; y: number }) {
    const { width, depth, seats } = furniture[kind];
    addObject({ id: makeId(), type: kind, x: 0, y: 0, width, depth, rotation: 0, seats: seats || undefined,
      ...(kind === "custom" ? { ...custom, aiSource: customAi } : {}) }, point);
  }

  function choose(kind: ObjectKind) {
    setPlacing(kind);
    setSelectedId(null);
    setQuery("");
    if (paletteMenu.current) paletteMenu.current.open = false;
    requestAnimationFrame(() => map.current?.querySelector<SVGSVGElement>("svg.floor-svg")?.focus({ preventScroll: true }));
  }

  function handleKeys(event: KeyboardEvent<SVGSVGElement>, id = selectedId) {
    if (event.key === "Escape") {
      setPlacing(null);
      setSelectedId(null);
      setPreview(null);
      return;
    }
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      if (key === "z" || key === "y") {
        event.preventDefault();
        if (event.shiftKey || key === "y") redo(); else undo();
      }
      return;
    }
    if (placing && event.key === "Enter") {
      event.preventDefault();
      addFromPalette(placing);
      return;
    }
    const object = layout.objects.find(item => item.id === id);
    if (!object) return;
    const offset = directions[event.key];
    if (offset) {
      event.preventDefault();
      const step = event.shiftKey ? .5 : .1;
      updateObject(positionObject(object, layout.room, object.x + offset[0] * step, object.y + offset[1] * step, false));
    } else if (key === "r") {
      event.preventDefault();
      const rotation = ((object.rotation + (event.shiftKey ? 270 : 90)) % 360) as LayoutObject["rotation"];
      const rotated = { ...object, rotation };
      if (fitsRoom({ ...rotated, x: 0, y: 0 }, layout.room)) updateObject(positionObject(rotated, layout.room, object.x, object.y, false));
      else setNotice({ message: "This object does not fit at that rotation.", error: true });
    } else if (key === "d") {
      event.preventDefault();
      addObject({ ...object, id: makeId(), seatOwnerId: undefined });
    } else if (key === "delete" || key === "backspace") {
      event.preventDefault();
      const objects = layout.objects.filter(item => item.id !== object.id && item.seatOwnerId !== object.id);
      if (commit({ ...layout, objects })) setSelectedId(null);
    }
  }

  function roomSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const room = roomSchema.safeParse({ width: Number(form.get("width")), depth: Number(form.get("depth")) });
    if (!room.success) {
      setNotice({ message: "Room dimensions must be between 1 and 50 meters.", error: true });
      return;
    }
    commit({ ...layout, name: String(form.get("name")).trim() || layout.name, room: room.data });
  }

  function previewMoves(moves: AiResult["moves"], source: { model: string; generatedAt: string }) {
    try {
      const proposed = proposedAiLayout(layout, moves);
      const ids = moves.map(move => move.objectId);
      setPreview({ from: layout, ids, layout: {
        ...proposed,
        objects: proposed.objects.map(object => ids.includes(object.id)
          ? { ...object, aiSource: { model: source.model, generatedAt: source.generatedAt, method: "move" } } : object),
      } });
      focusMap();
    } catch {
      setNotice({ message: aiError, error: true });
    }
  }

  const map = useRef<HTMLDivElement>(null);
  function focusMap() {
    map.current?.scrollIntoView({ block: "nearest" });
    map.current?.querySelector<SVGSVGElement>("svg.floor-svg")?.focus({ preventScroll: true });
  }
  function inspect(ids: string[]) {
    setPlacing(null);
    setSelectedId(ids[0] ?? null);
    setHighlightedIds(ids);
    focusMap();
  }

  return (
    <section className="floor-editor" aria-label="Floor plan editor" aria-busy={!ready || saving} inert={!ready || saving}>
      <div className="floor-studio">
        <div className="floor-topbar">
          <details className="floor-palette" ref={paletteMenu} onToggle={event => {
            if (event.currentTarget.open) searchInput.current?.focus();
          }} onKeyDown={event => {
            if (event.key === "Escape" && paletteMenu.current) {
              paletteMenu.current.open = false;
              paletteMenu.current.querySelector("summary")?.focus();
            }
          }}>
            <summary><Plus size={16} aria-hidden="true" /> Furniture <ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="floor-palette-menu">
              <label className="floor-palette-search"><Search size={15} aria-hidden="true" /><input ref={searchInput} type="search" aria-label="Search furniture" placeholder="Search furniture" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key !== "Enter") return;
                const first = palette.find(kind => furniture[kind].label.toLowerCase().includes(query.trim().toLowerCase()));
                if (first) choose(first);
              }} /></label>
              <ul>
                {palette.filter(kind => furniture[kind].label.toLowerCase().includes(query.trim().toLowerCase())).map(kind =>
                  <li key={kind}><button type="button" onClick={() => choose(kind)}><span className="floor-palette-preview"><FurnitureThumbnail kind={kind} /></span><span>{furniture[kind].label}</span><Plus size={14} aria-hidden="true" /></button></li>)}
                {!palette.some(kind => furniture[kind].label.toLowerCase().includes(query.trim().toLowerCase())) && <li className="floor-palette-empty">No furniture found.</li>}
              </ul>
            </div>
          </details>
          <div className="floor-save-group">
            <span className={`floor-save-indicator ${dirty ? "is-dirty" : ""}`} role="status" aria-label={dirty ? "Unsaved changes" : "Saved version"} title={dirty ? "Unsaved changes" : "Saved version"} />
            <StateButton className="button primary compact" disabled={!ready || saving || !dirty} onClick={() => void save()}><Save size={15} aria-hidden="true" />{saving ? "Saving…" : "Save"}</StateButton>
            <select aria-label="Saved versions" title="Saved versions" value={library.activeId} onChange={event => openVersion(event.target.value)}>
              {library.entries.map((entry, index) => <option key={entry.id} value={entry.id}>{`V${index + 1} · ${entry.layout.name}`}</option>)}
            </select>
            <details className="floor-settings" ref={settingsMenu} onKeyDown={event => {
                if (event.key === "Escape" && settingsMenu.current) {
                  settingsMenu.current.open = false;
                  settingsMenu.current.querySelector("summary")?.focus();
                }
              }}>
              <summary className="floor-settings-toggle" aria-label="Plan settings" title="Plan settings"><Settings2 size={17} aria-hidden="true" /></summary>
              <div className="floor-detail-content floor-settings-menu"><h3>Plan settings</h3>
                <form key={`${layout.name}-${layout.room.width}-${layout.room.depth}`} onSubmit={roomSettings}>
                  <label>Version name<input name="name" maxLength={120} defaultValue={layout.name} required /></label>
                  <div className="inspector-fields">
                    <label>Room width (m)<input name="width" type="number" min="1" max="50" step="any" defaultValue={layout.room.width} required /></label>
                    <label>Room depth (m)<input name="depth" type="number" min="1" max="50" step="any" defaultValue={layout.room.depth} required /></label>
                  </div>
                  <button type="submit" className="button secondary compact">Apply room settings</button>
                </form>
                <div className="button-row">
                  <button className="button quiet compact" onClick={() => { if (commit(modernFloor(template))) setSelectedId(null); }}>Default layout</button>
                  <button className="button quiet compact" onClick={() => { if (commit({ ...layout, name: "Blank layout", objects: [] })) setSelectedId(null); }}>Blank layout</button>
                </div>
                <p>Arrow keys move selected furniture. Shift moves farther. R rotates, D duplicates, Delete removes.</p>
                <Link href="/tactical/analyze">Photo estimate</Link>
              </div>
            </details>
          </div>
        </div>
        <div className="floor-canvas" ref={map}>
          {placing && <div className="floor-placement-chip">
            <FurnitureThumbnail kind={placing} /><span role="status">{furniture[placing].label}</span>
            <button className="icon-button" aria-label="Place in clear spot" title="Place in clear spot" onClick={() => addFromPalette(placing)}><Check size={16} /></button>
            <button className="icon-button" aria-label="Cancel placement" title="Cancel placement" onClick={() => setPlacing(null)}><X size={16} /></button>
          </div>}
          <FloorPlan layout={layout} selectedId={selectedId} placing={Boolean(placing)} highlightedIds={highlightedIds}
            aiPreview={activePreview?.layout.objects.filter(object => activePreview.ids.includes(object.id)) ?? []}
            onKeys={handleKeys} onSelect={select} onMove={updateObject}
            onPlace={(x, y) => { if (placing) addFromPalette(placing, { x, y }); }} />
          <div className="floor-map-tools" role="group" aria-label="Map editing controls">
            <StateButton className="icon-button" aria-label="Undo" title="Undo" disabled={!history.length} onClick={undo}><Undo2 size={17} /></StateButton>
            <StateButton className="icon-button" aria-label="Redo" title="Redo" disabled={!future.length} onClick={redo}><Redo2 size={17} /></StateButton>
            <StateButton className="icon-button" aria-label="Reset draft" title="Reset draft" disabled={!dirty} onClick={() => {
              if (window.confirm("Discard changes since the last saved version?")) replace(checkpoint);
            }}><RotateCcw size={16} /></StateButton>
          </div>
        </div>
      </div>
      <span id="floor-shortcuts" className="floor-screen-reader">Tab to select furniture. Arrow keys move it, Shift moves farther, R rotates, D duplicates and Delete removes. Escape clears the selection.</span>
      {notice && <p role={notice.error ? "alert" : "status"} className={`floor-message ${notice.error ? "warning-message" : ""}`}>{notice.message}</p>}

      <details className="floor-tile floor-seating ai-surface" ref={analysisTile}>
        <summary><span className="floor-ai-icon"><Sparkles size={16} aria-hidden="true" /></span><span>The Seating Problem</span><span className="floor-ai-label">AI</span><ChevronDown className="floor-chevron" size={16} aria-hidden="true" /></summary>
        <AiAccessControls />
        <AiWorkbench compact title="AI seating analysis" description="" request={{ task: "floor", restaurantId: template.restaurantId, layout, layoutVersions: library, question: "" }} onInspect={inspect} onPreview={previewMoves} />
        {activePreview && <div className="floor-placement"><button className="button ai-button compact" onClick={() => commit(activePreview.layout)}>Apply AI layout</button><button className="button ai-button compact" onClick={() => setPreview(null)}>Reject AI layout</button></div>}
      </details>
      {(selected || placing === "custom") && <details className="floor-tile">
        <summary><SlidersHorizontal size={16} aria-hidden="true" /><span>Furniture details</span><span className="floor-selected-name">{selected ? selected.name ?? furniture[selected.type].label : custom.name}</span><ChevronDown className="floor-chevron" size={16} aria-hidden="true" /></summary>
        {placing === "custom" ? <div className="floor-detail-content">
          <label>Object name<input value={custom.name} maxLength={120} onChange={event => setCustom({ ...custom, name: event.target.value })} /></label>
          <label>Description<textarea value={custom.description} maxLength={2000} onChange={event => setCustom({ ...custom, description: event.target.value })} /></label>
          <div className="inspector-fields">
            <label>Width (m)<input type="number" min=".01" step="any" value={custom.width || ""} onChange={event => setCustom({ ...custom, width: Number(event.target.value) })} /></label>
            <label>Depth (m)<input type="number" min=".01" step="any" value={custom.depth || ""} onChange={event => setCustom({ ...custom, depth: Number(event.target.value) })} /></label>
          </div>
          <details><summary>AI furniture designer</summary><AiWorkbench title="AI custom-object designer" description="Describe the item to get suggested dimensions." inputLabel="Describe the object" request={{ task: "custom-object", restaurantId: template.restaurantId, layout, question: "" }} onCustomObject={(object, source) => {
            setCustom(object);
            setCustomAi({ model: source.model, generatedAt: source.generatedAt, method: "object" });
          }} /></details>
        </div> : <LayoutInspector layout={layout} selected={selected} unit="m" onUpdate={updateObject} onNotice={message => setNotice({ message, error: true })} />}
      </details>}

    </section>
  );
}
