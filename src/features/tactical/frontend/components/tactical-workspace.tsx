"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Armchair, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardList, Copy, DoorOpen, Grid2X2,
  LayoutGrid, PanelTop, Plus, RotateCcw, RotateCw, Save, Sofa, Sprout, Table2, Trash2,
  Undo2, Utensils, UtensilsCrossed,
} from "lucide-react";
import {
  displayLength, fitsRoom, footprint, furniture, gridStep, hasOverlap, layoutCounts, overlappingIds,
  positionObject, roundLength, toMeters,
} from "../../domain/layout";
import { simulateSeating } from "../../domain/scenario";
import {
  modelVersion, objectLimit, roomSchema, type Assumptions, type Fixture, type Layout, type LayoutObject,
  type ObjectKind, type Scenario,
} from "../../domain/schemas";
import { loadDemoStorage, makeId, readSaved, savedScenariosSchema } from "../storage";
import { FloorPlan } from "./floor-plan";
import { AnalysisDialog, ReviewEvidence, ScenarioPanel } from "./scenario-panel";
import "./tactical.css";

const objectIcons = {
  table_2: Table2,
  table_4: LayoutGrid,
  booth: Sofa,
  counter: PanelTop,
  kitchen_zone: Utensils,
  door: DoorOpen,
  divider: Grid2X2,
  plant: Sprout,
};

const objectKinds = Object.keys(furniture) as ObjectKind[];

export function TacticalWorkspace({ fixture }: { fixture: Fixture }) {
  const [layout, setLayout] = useState(fixture.layout);
  const [checkpoint, setCheckpoint] = useState(fixture.layout);
  const [savedLayout, setSavedLayout] = useState<Layout | null>(null);
  const [history, setHistory] = useState<Layout[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<ObjectKind | null>(null);
  const [unit, setUnit] = useState<"m" | "ft">("m");
  const [snap, setSnap] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warning?: boolean } | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [roomFormVersion, setRoomFormVersion] = useState(0);
  const [scenarioNotice, setScenarioNotice] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [savedScenarios, setSavedScenarios] = useState<Scenario[]>([]);
  const [formDefaults, setFormDefaults] = useState({ baselineSeats: layoutCounts(fixture.layout).seats, inputs: fixture.assumptions });
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const editorTitle = useRef<HTMLHeadingElement>(null);
  const storage = useRef<Pick<ReturnType<typeof loadDemoStorage>, "layoutKey" | "scenariosKey"> | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const stored = loadDemoStorage(fixture.profile.id);
      storage.current = stored;
      if (stored.layout.value) {
        setSavedLayout(stored.layout.value);
        setLayout(stored.layout.value);
        setCheckpoint(stored.layout.value);
      }
      if (stored.scenarios.value) setSavedScenarios(stored.scenarios.value);
      if (stored.layout.issue || stored.scenarios.issue) {
        setNotice({ text: "Some saved demo work could not be read. You can continue with the available layout and scenarios.", warning: true });
      }
      setLoaded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [fixture.profile.id]);

  const selected = layout.objects.find((object) => object.id === selectedId);
  const counts = layoutCounts(layout);
  const originalSeats = layoutCounts(fixture.layout).seats;
  const overlaps = overlappingIds(layout.objects);
  const evidence = fixture.reviews.filter((review) => fixture.mission.evidenceIds.includes(review.id));
  const isDirty = layout !== checkpoint;

  function commit(next: Layout) {
    setHistory((previous) => [...previous.slice(-49), layout]);
    setLayout({ ...next, updatedAt: new Date().toISOString() });
    setNotice(null);
  }

  function changeLayout(next: Layout, baseline: Layout) {
    setLayout(next);
    setCheckpoint(baseline);
    setHistory([]);
    setSelectedId(null);
    setPlacing(null);
    setNotice(null);
    setRoomFormVersion((version) => version + 1);
  }

  function openLayout(mode: "template" | "blank" | "saved") {
    if (isDirty && !window.confirm("Switch layouts and discard your unsaved changes?")) return;
    const room = mode === "saved" ? savedLayout : fixture.layout;
    if (!room) return;
    const next = mode === "blank" ? { ...room, name: "Blank floor plan", objects: [], updatedAt: new Date().toISOString() } : room;
    changeLayout(next, next);
    resetScenario();
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setLayout(previous);
    setHistory(history.slice(0, -1));
    setSelectedId(previous.objects.some(({ id }) => id === selectedId) ? selectedId : null);
    setNotice(null);
    setRoomFormVersion((version) => version + 1);
  }

  function saveLayout() {
    if (!storage.current) return;
    try {
      window.localStorage.setItem(storage.current.layoutKey, JSON.stringify(layout));
      setSavedLayout(layout);
      setCheckpoint(layout);
      setNotice({ text: "Layout draft saved in this browser." });
    } catch {
      setNotice({ text: "Browser storage is unavailable. Your draft is still open here.", warning: true });
    }
  }

  function resizeRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const dimensions = { width: Number(values.get("width")), depth: Number(values.get("depth")) };
    const length = (value: number, current: number) => value === Number(displayLength(current, unit).toFixed(4))
      ? current
      : roundLength(toMeters(value, unit));
    const room = roomSchema.safeParse({ width: length(dimensions.width, layout.room.width), depth: length(dimensions.depth, layout.room.depth) });
    if (!room.success) {
      setNotice({ text: "Use a room width and depth between 1 and 50 meters (about 3.28–164.04 feet).", warning: true });
      return;
    }
    if (layout.objects.some((object) => !fitsRoom(object, room.data))) {
      setNotice({ text: "Move or remove furniture outside the proposed room before resizing.", warning: true });
      return;
    }
    if (room.data.width !== layout.room.width || room.data.depth !== layout.room.depth) {
      commit({ ...layout, room: room.data });
      setRoomFormVersion((version) => version + 1);
    } else {
      setNotice(null);
    }
  }

  function objectFits(object: LayoutObject) {
    const size = footprint(object);
    if (fitsRoom({ ...object, x: 0, y: 0 }, layout.room)) return true;
    setNotice({ text: `This object needs ${size.width} × ${size.depth} m of floor space.`, warning: true });
    return false;
  }

  function newObject(kind: ObjectKind): LayoutObject {
    const { width, depth, seats } = furniture[kind];
    return { id: makeId(), type: kind, width, depth, seats: seats || undefined, x: 0, y: 0, rotation: 0 };
  }

  function addObject(object: LayoutObject, x?: number, y?: number) {
    if (layout.objects.length >= objectLimit) {
      setNotice({ text: `This draft already contains ${objectLimit} objects.`, warning: true });
      return;
    }
    if (!objectFits(object)) return;
    let next: LayoutObject | undefined;
    if (x !== undefined && y !== undefined) {
      const size = footprint(object);
      next = positionObject(object, layout.room, x - size.width / 2, y - size.depth / 2, snap);
    } else {
      for (let y = 0; y < layout.room.depth && !next; y += gridStep) {
        for (let x = 0; x < layout.room.width && !next; x += gridStep) {
          const candidate = positionObject(object, layout.room, x, y, snap);
          if (layout.objects.every((existing) => !hasOverlap(candidate, existing))) next = candidate;
        }
      }
      if (!next) {
        setNotice({ text: "No clear spot found. Move some furniture or choose a position on the floor plan.", warning: true });
        return;
      }
    }
    commit({ ...layout, objects: [...layout.objects, next] });
    setSelectedId(next.id);
    setPlacing(null);
  }

  function moveObject(object: LayoutObject) {
    const existing = layout.objects.find(({ id }) => object.id === id);
    if (!existing || (existing.x === object.x && existing.y === object.y && existing.rotation === object.rotation)) return;
    commit({ ...layout, objects: layout.objects.map((item) => item.id === object.id ? object : item) });
  }

  function nudge(x: number, y: number) {
    if (!selected) return;
    moveObject(positionObject(selected, layout.room, selected.x + x, selected.y + y, false));
  }

  function rotate() {
    if (!selected) return;
    const rotated = { ...selected, rotation: ((selected.rotation + 90) % 360) as LayoutObject["rotation"] };
    if (objectFits(rotated)) moveObject(positionObject(rotated, layout.room, selected.x, selected.y, false));
  }

  function handleListKeys(event: KeyboardEvent<HTMLSelectElement>) {
    if (!event.altKey) return;
    const offsets: Record<string, [number, number]> = {
      ArrowUp: [0, -gridStep], ArrowDown: [0, gridStep], ArrowLeft: [-gridStep, 0], ArrowRight: [gridStep, 0],
    };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    nudge(...offset);
  }

  function resetScenario() {
    setScenarioNotice(null);
    setScenario(null);
    setFormDefaults({ baselineSeats: originalSeats, inputs: fixture.assumptions });
    setFormVersion((version) => version + 1);
  }

  function previewScenario(baselineSeats: number, assumptions: Assumptions) {
    if (overlaps.size) return;
    setScenarioNotice(null);
    setScenario({
      id: makeId(),
      schemaVersion: 1,
      modelVersion,
      createdAt: new Date().toISOString(),
      missionTitle: fixture.mission.title,
      evidence,
      layout,
      baselineSeats,
      assumptions,
      result: simulateSeating(baselineSeats, counts.seats, assumptions),
    });
  }

  function saveScenario() {
    if (!scenario || !storage.current) return;
    setScenarioNotice(null);
    try {
      const key = storage.current.scenariosKey;
      const previouslySaved = readSaved(key, savedScenariosSchema).value ?? savedScenarios;
      const saved = [scenario, ...previouslySaved.filter((item) => item.id !== scenario.id)];
      window.localStorage.setItem(key, JSON.stringify(saved));
      setSavedScenarios(saved);
    } catch {
      setScenarioNotice("Browser storage is unavailable. Your scenario is still open here.");
    }
  }

  function openScenario(saved: Scenario) {
    setScenarioNotice(null);
    setScenario(saved);
    setFormDefaults({ baselineSeats: saved.baselineSeats, inputs: saved.assumptions });
    setFormVersion((version) => version + 1);
  }

  function loadScenarioLayout(saved: Scenario) {
    if (isDirty && !window.confirm("Load the scenario layout and discard your unsaved changes?")) return;
    changeLayout(saved.layout, checkpoint);
    openScenario(saved);
    editorTitle.current?.focus();
  }

  return (
    <div className="tactical-workspace">
      <header className="app-bar">
        <div className="app-bar-inner">
          <a className="brand" href="/tactical"><span className="brand-icon"><UtensilsCrossed size={19} /></span>RestaurantOS</a>
          <span className="current-mode" aria-current="page">Manage restaurant</span>
          <span className="demo-badge">Demo</span>
        </div>
      </header>
      <main className="workspace-main">
        <div className="restaurant-heading">
          <div><h1>{fixture.profile.name}</h1><p>{fixture.profile.cuisine} · {fixture.profile.location}</p></div>
          <dl className="summary-stats">
            <div><dt>Draft seats</dt><dd>{counts.seats}</dd></div>
            <div><dt>Tables</dt><dd>{counts.tables}</dd></div>
          </dl>
        </div>

        <div className="editor-grid">
          <section className="panel floor-panel" aria-labelledby="editor-title">
            <div className="floor-heading">
              <div>
                <h2 id="editor-title" ref={editorTitle} tabIndex={-1}>Floor plan</h2>
                <p>{layout.name}</p>
              </div>
              <span className={`pill ${isDirty ? "pill-warm" : ""}`}>{isDirty ? "Unsaved changes" : savedLayout === layout ? "Saved draft" : "Layout draft"}</span>
            </div>
            <div className="layout-options" aria-label="Layout options">
              <button className="button compact quiet" onClick={() => openLayout("template")} disabled={!loaded}>Demo template</button>
              <button className="button compact quiet" onClick={() => openLayout("blank")} disabled={!loaded}><Plus size={14} /> Blank layout</button>
              <button className="button compact quiet" onClick={() => openLayout("saved")} disabled={!loaded || !savedLayout}>Open saved draft</button>
            </div>
            <div className="scene">
              <FloorPlan layout={layout} unit={unit} selectedId={selectedId} placing={placing} snap={snap} overlaps={overlaps} onSelect={setSelectedId}
                onPlace={(x, y) => { if (placing) addObject(newObject(placing), x, y); }} onMove={moveObject} />
            </div>
            {placing && <div className="placement">
              <p role="status">Click the floor to place: {furniture[placing].label}.</p>
              <div className="button-row">
                <button className="button compact secondary" onClick={() => addObject(newObject(placing))}>Place in clear spot</button>
                <button className="button compact quiet" onClick={() => setPlacing(null)}>Cancel</button>
              </div>
            </div>}
            <div className="floor-tools">
              <label className="checkbox"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap to grid</label>
              <div className="button-row">
                <button className="button quiet compact" disabled={!history.length} onClick={undo}><Undo2 size={15} /> Undo</button>
                <button className="button quiet compact" disabled={!isDirty} onClick={() => changeLayout(checkpoint, checkpoint)}><RotateCcw size={14} /> Reset draft</button>
                <button className="button primary compact" disabled={!loaded} onClick={saveLayout}><Save size={15} /> Save draft</button>
              </div>
            </div>
            {overlaps.size > 0 && <p className="warning-message floor-notice" role="status">Overlapping objects are outlined. Move them apart to preview the scenario.</p>}
            {notice && <p className={`floor-notice ${notice.warning ? "warning-message" : "success-message"}`} role="status">{notice.text}</p>}
          </section>

          <div className="editor-sidebar">
            <section className="panel mission-panel" aria-labelledby="mission-title">
              <div className="mission-top"><span className="section-icon"><ClipboardList size={18} /></span><span className="pill pill-warm">Seating mission</span></div>
              <h2 id="mission-title">{fixture.mission.title}</h2>
              <p>{fixture.mission.summary}</p>
              <button className="text-button" onClick={() => evidenceDialog.current?.showModal()}>Read {evidence.length} cited reviews <ArrowRight size={15} /></button>
              <button className="button primary mission-action" onClick={() => { setPlacing("table_2"); editorTitle.current?.focus(); }}>{fixture.mission.action} <ArrowRight size={16} /></button>
            </section>

            <section className="panel furniture-panel" aria-labelledby="furniture-title">
              <h2 id="furniture-title">Furniture</h2>
              <div className="palette">
                {objectKinds.map((kind) => {
                  const Icon = objectIcons[kind];
                  return <button className="palette-item" key={kind} type="button" aria-pressed={placing === kind} onClick={() => setPlacing(placing === kind ? null : kind)}>
                    <Icon size={17} /><span>{furniture[kind].label}</span>
                  </button>;
                })}
              </div>
              <label className="object-picker">Select furniture
                <select value={selected?.id ?? ""} onKeyDown={handleListKeys} onChange={(event) => { setSelectedId(event.target.value || null); setPlacing(null); }}>
                  <option value="">{layout.objects.length ? "Choose an object" : "No furniture placed"}</option>
                  {layout.objects.map((object, index) => <option key={object.id} value={object.id}>{furniture[object.type].label} {index + 1}{overlaps.has(object.id) ? " (overlap)" : ""}</option>)}
                </select>
              </label>
              {selected && <div className="object-controls">
                <p>{displayLength(selected.x, unit).toFixed(2)} {unit} across · {displayLength(selected.y, unit).toFixed(2)} {unit} down · {selected.rotation}°</p>
                <div className="button-row nudge-buttons">
                  <button className="icon-button" aria-label="Nudge left" title="Nudge left" onClick={() => nudge(-gridStep, 0)}><ArrowLeft size={17} /></button>
                  <button className="icon-button" aria-label="Nudge up" title="Nudge up" onClick={() => nudge(0, -gridStep)}><ArrowUp size={17} /></button>
                  <button className="icon-button" aria-label="Nudge down" title="Nudge down" onClick={() => nudge(0, gridStep)}><ArrowDown size={17} /></button>
                  <button className="icon-button" aria-label="Nudge right" title="Nudge right" onClick={() => nudge(gridStep, 0)}><ArrowRight size={17} /></button>
                  <button className="icon-button" aria-label="Rotate" title="Rotate 90 degrees" onClick={rotate}><RotateCw size={17} /></button>
                  <button className="icon-button" aria-label="Duplicate" title="Duplicate" onClick={() => addObject({ ...selected, id: makeId() })}><Copy size={16} /></button>
                  <button className="icon-button danger" aria-label="Delete" title="Delete" onClick={() => {
                    commit({ ...layout, objects: layout.objects.filter(({ id }) => id !== selected.id) });
                    setSelectedId(null);
                  }}><Trash2 size={16} /></button>
                </div>
              </div>}
              <details className="room-details">
                <summary>Room dimensions</summary>
                <div className="room-unit">
                  <label>Units <select value={unit} onChange={(event) => setUnit(event.target.value === "ft" ? "ft" : "m")}>
                    <option value="m">Meters</option><option value="ft">Feet</option>
                  </select></label>
                </div>
                <form key={`${roomFormVersion}-${unit}`} onSubmit={resizeRoom}>
                  <div className="room-fields">
                    <label>Width ({unit})<input type="number" name="width" step="any" min="0.01" required defaultValue={Number(displayLength(layout.room.width, unit).toFixed(4))} /></label>
                    <label>Depth ({unit})<input type="number" name="depth" step="any" min="0.01" required defaultValue={Number(displayLength(layout.room.depth, unit).toFixed(4))} /></label>
                  </div>
                  <button className="button compact secondary" type="submit">Apply dimensions</button>
                </form>
              </details>
            </section>
          </div>
        </div>

        <ScenarioPanel defaults={formDefaults.inputs} baselineSeats={formDefaults.baselineSeats} draftSeats={counts.seats}
          scenario={scenario} saved={savedScenarios} isSaved={savedScenarios.some(({ id }) => scenario?.id === id)} overlaps={overlaps.size > 0}
          layoutChanged={Boolean(scenario && scenario.layout.updatedAt !== layout.updatedAt)} notice={scenarioNotice}
          onSimulate={previewScenario} onSave={saveScenario} onOpen={openScenario} onLoadLayout={loadScenarioLayout}
          onReset={resetScenario} formVersion={formVersion} />
        <footer className="workspace-footer"><Armchair size={16} /> Demo layouts and scenarios are saved in this browser.</footer>
      </main>
      <AnalysisDialog dialogRef={evidenceDialog} title="Mission evidence"><ReviewEvidence reviews={evidence} /></AnalysisDialog>
    </div>
  );
}
