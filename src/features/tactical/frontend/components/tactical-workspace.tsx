"use client";

import type { Dataset } from "../../domain/dataset";
import { StateButton } from "./state-button";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Armchair, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ClipboardList, Copy, DoorOpen, Grid2X2,
  LayoutGrid, PanelTop, Plus, RotateCcw, RotateCw, Save, Sofa, Sprout, Table2, Trash2,
  Undo2, Redo2, ZoomIn, ZoomOut, Utensils, UtensilsCrossed,
} from "lucide-react";
import {
  displayLength, fitsRoom, footprint, furniture, gridStep, hasOverlap, layoutCounts, overlappingIds,
  positionObject, roundLength, toMeters, suggestClearPosition,
} from "../../domain/layout";
import { simulateSeating, simulateTurnover, scenarioAction } from "../../domain/scenario";
import {
  modelVersion, objectLimit, roomSchema, layoutSchema, type ScenarioSettings, type Assumptions, type Layout, type LayoutObject,
  type ObjectKind, type Scenario,
} from "../../domain/schemas";
import { loadDemoStorage, makeId, readScenarios } from "../storage";
import { initialLibrary, layoutInsights, type LayoutLibrary } from "../../domain/layout-library";
import { LayoutLibraryPanel } from "./layout-library";
import { LibraryBackup } from "./library-backup";
import { parseLibraryBackup, writeLibrary, downloadJson } from "../layout-storage";
import { FloorPlan } from "./floor-plan";
import { AnalysisDialog, ReviewEvidence, ScenarioPanel } from "./scenario-panel";
import { LayoutInspector } from "./layout-inspector";
import { LayoutTransfer } from "./layout-transfer";
import { ReviewInsights } from "./review-insights";
import { AnalyzePlan } from "./analyze-plan";
import { HrPage } from "./hr-page";
import { SupplyPage } from "./supply-page";
import { FinancePage } from "./finance-page";
import { AiAssistant } from "./ai-assistant";
import { AiAccessProvider, AiWorkbench } from "./ai-workbench";
import { proposedAiLayout, aiError } from "../../domain/ai";
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
  chair: Armchair, wall: Grid2X2, window: PanelTop, light: Plus, decoration: Sprout, ac: PanelTop, custom: Plus,
};

const objectKinds = Object.keys(furniture) as ObjectKind[];

export function TacticalWorkspace({ fixture, dataSource, revision }: { fixture: Dataset; dataSource: string; revision: number | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.split("/")[2] ?? "floor";
  const pages = [
    ["/tactical", "Floor Plan"],
    ["/tactical/reviews", "Customer Reviews & Social Media"],
    ["/tactical/hr", "HR"],
    ["/tactical/supply", "Supply Management"],
    ["/tactical/finance", "Financial Intelligence"],
    ["/tactical/ai", "AI Assistant"],
  ];
  const [library, setLibrary] = useState<LayoutLibrary>(initialLibrary(fixture.layout));
  const libraryKey = `restaurant-os:tactical:${fixture.profile.id}:layouts:v1`;
  const [libraryWritable, setLibraryWritable] = useState(true);
  const libraryRaw = useRef<string | null | undefined>(undefined);
  const [aiHighlights, setAiHighlights] = useState(false);
  const [aiPreview, setAiPreview] = useState<{ from: Layout; layout: Layout; ids: string[] } | null>(null);
  const [customAiSource, setCustomAiSource] = useState<LayoutObject["aiSource"]>();
  const [replyReviewId, setReplyReviewId] = useState(fixture.reviews[0]?.id ?? "");
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const [proposal, setProposal] = useState<{ object: LayoutObject; from: Layout } | null>(null);
  const [customDraft, setCustomDraft] = useState({ name: "Custom object", description: "", category: "equipment" as NonNullable<LayoutObject["category"]>, width: 1, depth: 1 });
  const [layout, setLayout] = useState(fixture.layout);
  const [checkpoint, setCheckpoint] = useState(fixture.layout);
  const [savedLayout, setSavedLayout] = useState<Layout | null>(null);
  const [history, setHistory] = useState<Layout[]>([]);
  const [future, setFuture] = useState<Layout[]>([]);
  const [zoom, setZoom] = useState(1);
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
  const [formDefaults, setFormDefaults] = useState<{
    baselineSeats: number; inputs: Assumptions; action?: "seating" | "turnover"; targetTurnsPerDay?: number;
  }>({ baselineSeats: layoutCounts(fixture.layout).seats, inputs: fixture.assumptions });
  const evidenceDialog = useRef<HTMLDialogElement>(null);
  const editorTitle = useRef<HTMLHeadingElement>(null);
  const scenarioSection = useRef<HTMLDivElement>(null);
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
      try {
        const raw = localStorage.getItem(libraryKey);
        libraryRaw.current = raw;
        const recovered = raw !== null ? parseLibraryBackup(raw, fixture.profile.id) : initialLibrary(stored.layout.value ?? fixture.layout);
        if (recovered.entries.some(entry => entry.layout.restaurantId !== fixture.profile.id)) throw new Error("Wrong restaurant");
        setLibrary(recovered);
        const active = recovered.entries.find(entry => entry.id === recovered.activeId)!.layout;
        setLayout(active); setCheckpoint(active); setSavedLayout(active);
        setFormDefaults({ baselineSeats: layoutCounts(recovered.entries.find(entry => entry.id === recovered.baselineId)!.layout).seats, inputs: fixture.assumptions });
      } catch {
        setLibraryWritable(false);
        setNotice({ text: "Saved layout library could not be read. It has been preserved; export your open draft before repairing browser storage.", warning: true });
      }

      if (stored.layout.issue || stored.scenarios.issue) {
        setNotice({ text: "Some saved demo work could not be read. You can continue with the available layout and scenarios.", warning: true });
      }
      setLoaded(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [fixture, libraryKey]);

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if ((event.key === libraryKey || event.key === null) && event.storageArea === localStorage && localStorage.getItem(libraryKey) !== libraryRaw.current) {
        setLibraryWritable(false);
        setNotice({ text: "Another tab changed the saved library. Your open draft is preserved. Export it, then reload the saved library before saving.", warning: true });
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [libraryKey]);

  const selected = layout.objects.find((object) => object.id === selectedId);
  const counts = layoutCounts(layout);
  const originalSeats = layoutCounts(library.entries.find(entry => entry.id === library.baselineId)!.layout).seats;
  const activeEntry = library.entries.find(entry => entry.id === library.activeId)!;
  const baselineEntry = library.entries.find(entry => entry.id === library.baselineId)!;
  const activeProposal = proposal?.from === layout ? proposal.object : null;
  const insights = layoutInsights(layout);
  const overlaps = overlappingIds(layout.objects);
  const evidence = fixture.reviews.filter((review) => fixture.mission.evidenceIds.includes(review.id));
  const isDirty = layout.name !== checkpoint.name
    || JSON.stringify(layout.room) !== JSON.stringify(checkpoint.room)
    || JSON.stringify(layout.objects) !== JSON.stringify(checkpoint.objects);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDirty]);

  function commit(next: Layout) {
    const valid = layoutSchema.safeParse({ ...next, schemaVersion: next.objects.some(object => object.seatOwnerId) ? 2 : next.schemaVersion });
    if (!valid.success) {
      setNotice({ text: valid.error.issues[0].message, warning: true });
      return false;
    }
    setFuture([]);
    setHistory((previous) => [...previous.slice(-49), layout]);
    setLayout({ ...valid.data, updatedAt: new Date().toISOString() });
    setProposal(null);
    setNotice(null);
    return true;
  }

  function changeLayout(next: Layout, baseline: Layout) {
    setLayout(next);
    setCheckpoint(baseline);
    setHistory([]);
    setFuture([]);
    setSelectedId(null);
    setPlacing(null);
    setHighlightedIds([]);
    setProposal(null);
    setNotice(null);
    setRoomFormVersion((version) => version + 1);
  }

  function openLayout(mode: "template" | "blank" | "saved") {
    if (isDirty && !window.confirm("Switch layouts and discard your unsaved changes?")) return;
    const room = mode === "saved" ? savedLayout : fixture.layout;
    if (!room) return;
    const next = mode === "blank" ? { ...room, name: "Blank floor plan", objects: [], updatedAt: new Date().toISOString() } : room;
    changeLayout(next, mode === "saved" ? next : activeEntry.layout);
    resetScenario();
  }

  function undo() {
    setProposal(null);
    const previous = history.at(-1);
    if (!previous) return;
    setLayout(previous);
    setFuture((items) => [...items, layout]);
    setHistory(history.slice(0, -1));
    setSelectedId(previous.objects.some(({ id }) => id === selectedId) ? selectedId : null);
    setNotice(null);
    setRoomFormVersion((version) => version + 1);
  }

  function redo() {
    setProposal(null);
    const next = future.at(-1);
    if (!next) return;
    setHistory((items) => [...items, layout]);
    setFuture(future.slice(0, -1));
    setLayout(next);
    setSelectedId(null);
    setNotice(null);
    setRoomFormVersion((version) => version + 1);
  }

  function importLayout(imported: Layout) {
    if (isDirty && !window.confirm("Import this layout and replace your unsaved changes?")) return;
    commit(imported);
    setSelectedId(null);
    setPlacing(null);
    setRoomFormVersion((version) => version + 1);
  }

  function persistLibrary(next: LayoutLibrary) {
    if (!loaded || !libraryWritable) return false;
    try {
      if (libraryRaw.current === undefined) throw new Error("Read saved storage before writing.");
      libraryRaw.current = writeLibrary(localStorage, libraryKey, libraryRaw.current, next, fixture.profile.id);
      setLibrary(next);
      return true;
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "Could not save layout library. Your existing library and open draft are unchanged.", warning: true });
      return false;
    }
  }

  function applyLibrary(next: LayoutLibrary) {
    setLibrary(next); setLibraryWritable(true);
    const active = next.entries.find(entry => entry.id === next.activeId)!.layout;
    changeLayout(active, active); setSavedLayout(active);
    setScenario(null); setScenarioNotice(null);
    setFormDefaults({ baselineSeats: layoutCounts(next.entries.find(entry => entry.id === next.baselineId)!.layout).seats, inputs: fixture.assumptions });
    setFormVersion(value => value + 1);
  }

  function reloadLibrary() {
    if (isDirty && !window.confirm("Reload saved configurations and discard your open edits? Export the current layout first to keep them.")) return;
    try {
      const raw = localStorage.getItem(libraryKey);
      libraryRaw.current = raw;
      applyLibrary(raw === null ? initialLibrary(fixture.layout) : parseLibraryBackup(raw, fixture.profile.id));
      setNotice({ text: "Saved library reloaded from this browser." });
    } catch { setLibraryWritable(false); setNotice({ text: "Stored library could not be read. Download its bytes for recovery, or import a valid backup. Your open draft is preserved.", warning: true }); }
  }

  function restoreLibrary(next: LayoutLibrary) {
    if (!window.confirm("Replace this browser’s entire saved library and open draft with the previewed backup? Export your work first to keep it.")) return false;
    try {
      if (libraryRaw.current === undefined) throw new Error("Browser storage could not be read. Reload before importing a backup.");
      libraryRaw.current = writeLibrary(localStorage, libraryKey, libraryRaw.current, next, fixture.profile.id, true);
      applyLibrary(next);
      setNotice({ text: "Library restored in this browser. The previous stored bytes were retained for recovery." });
      return true;
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : "Could not restore the library. Existing work is preserved.", warning: true }); return false; }
  }

  function libraryAction(action: "open" | "rename" | "duplicate" | "delete" | "baseline", id: string, name = "") {
    const entry = library.entries.find(item => item.id === id)!;
    if ((action === "open" || action === "duplicate" || action === "delete" || action === "rename") && isDirty && !window.confirm("Continue and discard unsaved edits? Save draft first to retain them.")) return;
    let next = library;
    if (action === "open") next = { ...library, activeId: id };
    if (action === "baseline") next = { ...library, baselineId: id };
    if (action === "rename") {
      if (!name) { setNotice({ text: "Enter a configuration name first.", warning: true }); return; }
      next = { ...library, entries: library.entries.map(item => item.id === id ? { ...item, layout: { ...item.layout, name } } : item) };
    }
    if (action === "duplicate") {
      if (library.entries.length >= 50) { setNotice({ text: "Library limit: 50 configurations. Export a backup, then remove an unused configuration.", warning: true }); return; }
      const newId = makeId();
      next = { ...library, activeId: newId, entries: [...library.entries, { id: newId, layout: { ...entry.layout, name: name || `${entry.layout.name} copy` } }] };
    }
    if (action === "delete") {
      if (library.entries.length < 2 || !window.confirm(`Delete saved layout “${entry.layout.name}”?`)) return;
      const entries = library.entries.filter(item => item.id !== id);
      next = { ...library, entries, activeId: library.activeId === id ? entries[0].id : library.activeId, baselineId: library.baselineId === id ? entries[0].id : library.baselineId };
    }
    if (!persistLibrary(next)) return;
    if (action !== "baseline") {
      const active = next.entries.find(item => item.id === next.activeId)!.layout;
      changeLayout(active, active); setSavedLayout(active);
    }
    setScenario(null);
    setFormDefaults({ baselineSeats: layoutCounts(next.entries.find(item => item.id === next.baselineId)!.layout).seats, inputs: fixture.assumptions });
    setFormVersion(v => v + 1);
  }

  function saveLayout() {
    if (!storage.current) return;
    try {
      if (!persistLibrary({ ...library, entries: library.entries.map(entry => entry.id === library.activeId ? { ...entry, layout } : entry) })) return;
      setSavedLayout(layout);
      setCheckpoint(layout);
      if (library.activeId === library.baselineId) {
        setScenario(null);
        setFormDefaults({ baselineSeats: layoutCounts(layout).seats, inputs: fixture.assumptions });
        setFormVersion(value => value + 1);
        setScenarioNotice("Saved baseline updated. New scenarios use its seat count; previously saved results are unchanged.");
      }
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
    const name = String(values.get("name") ?? "").trim();
    if (!name) {
      setNotice({ text: "Enter a layout name.", warning: true });
      return;
    }
    if (room.data.width !== layout.room.width || room.data.depth !== layout.room.depth || name !== layout.name) {
      commit({ ...layout, name, room: room.data });
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
    return { id: makeId(), type: kind, width, depth, seats: seats || undefined, x: 0, y: 0, rotation: 0, ...(kind === "custom" ? { ...customDraft, aiSource: customAiSource } : {}) };
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
    if (!commit({ ...layout, objects: [...layout.objects, next] })) return;
    setSelectedId(next.id);
    setPlacing(null);
  }

  function moveObject(object: LayoutObject) {
    const existing = layout.objects.find(({ id }) => object.id === id);
    if (!existing || JSON.stringify(existing) === JSON.stringify(object)) return;
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

  function previewScenario(baselineSeats: number, assumptions: Assumptions, settings: ScenarioSettings) {
    if (settings.action === "seating" && overlaps.size) return;
    setScenarioNotice(null);
    setScenario({
      id: makeId(),
      schemaVersion: 1,
      modelVersion: settings.action === "turnover" ? "turnover-v1" : modelVersion,
      ...settings,
      createdAt: new Date().toISOString(),
      missionTitle: fixture.mission.title,
      evidence,
      layout,
      baselineSeats,
      assumptions,
      result: settings.action === "turnover"
        ? simulateTurnover(baselineSeats, settings.targetTurnsPerDay ?? assumptions.turnsPerDay, assumptions)
        : simulateSeating(baselineSeats, counts.seats, assumptions),
    });
  }

  function saveScenario() {
    if (!scenario || !storage.current) return;
    setScenarioNotice(null);
    try {
      const key = storage.current.scenariosKey;
      const previouslySaved = readScenarios(key, fixture.profile.id).value;
      const saved = [scenario, ...previouslySaved.filter((item) => item.id !== scenario.id)];
      window.localStorage.setItem(key, JSON.stringify(saved));
      setSavedScenarios(saved);
    } catch {
      setScenarioNotice("Browser storage is unavailable. Your scenario is still open here.");
    }
  }

  function openScenario(saved: Scenario) {
    router.push("/tactical");
    setScenarioNotice(null);
    setScenario(saved);
    setFormDefaults({ baselineSeats: saved.baselineSeats, inputs: saved.assumptions, action: scenarioAction(saved), targetTurnsPerDay: saved.targetTurnsPerDay });
    setFormVersion((version) => version + 1);
  }

  function deleteScenario(id: string) {
    if (!storage.current || !window.confirm("Delete this saved scenario from this browser?")) return;
    try {
      const key = storage.current.scenariosKey;
      const current = readScenarios(key, fixture.profile.id).value;
      const next = current.filter((item) => item.id !== id);
      window.localStorage.setItem(key, JSON.stringify(next));
      setSavedScenarios(next);
      setScenarioNotice(null);
    } catch {
      setScenarioNotice("Could not delete the scenario. Browser storage is unavailable.");
    }
  }

  function trySeating() {
    router.push("/tactical");
    resetScenario();
    setPlacing("table_2");
    editorTitle.current?.focus();
  }

  function tryTurnover() {
    router.push("/tactical");
    setPlacing(null);
    setScenarioNotice(null);
    setScenario(null);
    setFormDefaults({ baselineSeats: originalSeats, inputs: fixture.assumptions, action: "turnover" });
    setFormVersion((version) => version + 1);
    setTimeout(() => scenarioSection.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }), 80);
  }

  function loadScenarioLayout(saved: Scenario) {
    if (isDirty && !window.confirm("Load the scenario layout and discard your unsaved changes?")) return;
    changeLayout(saved.layout, checkpoint);
    openScenario(saved);
    router.push("/tactical");
    editorTitle.current?.focus();
  }

  return (
    <div className="tactical-workspace">
      <header className="app-bar">
        <div className="app-bar-inner">
          <a className="brand" href="/tactical"><span className="brand-icon"><UtensilsCrossed size={19} /></span>RestaurantOS</a>
          <nav className="workspace-switch" aria-label="Workspace">
            <span className="current-mode" aria-current="page">Manage restaurant</span>
            <Link href="/expansion" onClick={(event) => {
              if (isDirty && !window.confirm("Leave Tactical and discard unsaved layout changes?")) event.preventDefault();
            }}>Explore expansion</Link>
          </nav>
          <span className="demo-badge">Demo · {dataSource}{revision !== null ? ` · revision ${revision}` : ""}</span>
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

        <nav className="workspace-links" aria-label="Tactical sections">
          {pages.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>{label}</Link>)}
        </nav>
        <AiAccessProvider>
        <div hidden={section !== "floor" && section !== "scenarios" && section !== "decisions"}>
        <LayoutLibraryPanel library={library} assumptions={fixture.assumptions} disabled={!loaded || !libraryWritable} onAction={libraryAction} />
        <section className="panel layout-library"><LibraryBackup library={library} restaurantId={fixture.profile.id} ready={loaded}
          onRestore={restoreLibrary} onReload={reloadLibrary} onExportStored={(recovery = false) => {
            try {
              const raw = localStorage.getItem(recovery ? `${libraryKey}:recovery` : libraryKey);
              if (raw === null) { setNotice({ text: recovery ? "No previous library recovery copy is stored in this browser." : "No library has been saved in this browser yet.", warning: true }); return; }
              downloadJson(raw, `${fixture.profile.id}-${recovery ? "previous" : "stored"}-library.json`);
            }
            catch { setNotice({ text: "Browser storage could not be read; export your open draft instead.", warning: true }); }
          }} /></section>
        <div className="editor-grid" inert={!loaded}>
          <section className="panel floor-panel" aria-labelledby="editor-title">
            <div className="floor-heading">
              <div>
                <h2 id="editor-title" ref={editorTitle} tabIndex={-1}>Floor plan</h2>
                <p>{layout.name}</p>
              </div>
              <span className={`pill ${isDirty ? "pill-warm" : ""}`}>{isDirty ? "Unsaved changes" : "Matches saved configuration"}</span>
            </div>
            <div className="draft-context">
              <p>Editing: <strong>{activeEntry.layout.name}</strong> · {counts.seats} draft seats. Save draft replaces this active configuration.</p>
              <p>Comparison baseline: <strong>{baselineEntry.layout.name}</strong> · {originalSeats} saved seats. {library.activeId === library.baselineId ? "Saving this draft also updates the baseline for new scenarios." : "Saving this alternative leaves the baseline unchanged."}</p>
              <p>Capacity counts each seating group’s included seats plus unassigned chairs. Assign chairs in furniture details when they represent seats already included in a group.</p>
            </div>
            <div className="layout-options" aria-label="Layout options">
              <button className="button compact quiet" onClick={() => openLayout("template")}>Demo template</button>
              <button className="button compact quiet" onClick={() => openLayout("blank")}><Plus size={14} /> Blank layout</button>
              <StateButton className="button compact quiet" onClick={() => openLayout("saved")} disabled={!savedLayout}>Open saved draft</StateButton>
            </div>
            <LayoutTransfer layout={layout} onImport={importLayout} disabled={!loaded}
              onNotice={(text) => setNotice({ text, warning: true })} />
            <div className="scene-controls" aria-label="Floor plan view">
              <span>Top-down view</span>
              <div className="button-row">
                <StateButton className="icon-button" aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))}><ZoomOut size={17} /></StateButton>
                <output aria-label="Zoom level">{zoom * 100}%</output>
                <StateButton className="icon-button" aria-label="Zoom in" disabled={zoom === 3} onClick={() => setZoom(Math.min(3, zoom + 0.5))}><ZoomIn size={17} /></StateButton>
                <button className="button compact quiet" onClick={() => setZoom(1)}>Fit room</button>
              </div>
            </div>
            <div className="scene-scroll" tabIndex={0} role="region" aria-label="Floor plan canvas. Scroll to pan when zoomed.">
              <div className="scene" style={{ width: `${zoom * 100}%` }}>
                <FloorPlan layout={layout} zoom={zoom} unit={unit} selectedId={selectedId} placing={placing} snap={snap} overlaps={overlaps} highlightedIds={highlightedIds} proposedObject={activeProposal} aiPreview={aiPreview?.from === layout ? aiPreview.layout.objects.filter(object => aiPreview.ids.includes(object.id)) : []} aiHighlights={aiHighlights} onSelect={id => { setSelectedId(id); setHighlightedIds([]); }}
                  onPlace={(x, y) => { if (placing) addObject(newObject(placing), x, y); }} onMove={moveObject} />
              </div>
            </div>
            {aiPreview?.from === layout && <div className="ai-surface" role="status"><h3>AI layout preview</h3><p>Purple outlines show proposed positions. The draft has not changed. Geometric validation does not establish comfort or compliance.</p><div className="button-row"><button className="button ai-button compact" onClick={() => { commit(aiPreview.layout); setAiPreview(null); }}>Apply AI layout</button><button className="button ai-button compact" onClick={() => setAiPreview(null)}>Reject AI layout</button></div></div>}
            {activeProposal && <div className="move-preview" role="status">
              <h3>Proposed move · {activeProposal.name ?? furniture[activeProposal.type].label}</h3>
              <p>Dashed preview: {displayLength(activeProposal.x, unit).toFixed(2)} {unit} across, {displayLength(activeProposal.y, unit).toFixed(2)} {unit} down. Nearest available grid position with no footprint overlap. No walking clearance or comfort is guaranteed. Nothing has moved yet.</p>
              <div className="button-row">
                <button className="button secondary compact" onClick={() => { moveObject(activeProposal); setProposal(null); }}>Apply suggested move</button>
                <button className="button quiet compact" onClick={() => setProposal(null)}>Reject suggested move</button>
              </div>
            </div>}
            {placing && <div className="placement">
              <p role="status">Click the floor to place: {furniture[placing].label}.</p>
              {placing === "custom" && <div className="custom-object-form">
                <label>New object description<textarea value={customDraft.description} maxLength={2000} placeholder="A large refrigerator next to the kitchen entrance" onChange={event => setCustomDraft({ ...customDraft, description: event.target.value })} /></label>
                <label>New object name<input value={customDraft.name} maxLength={120} onChange={event => setCustomDraft({ ...customDraft, name: event.target.value })} /></label>
                <label>Custom category<select value={customDraft.category} onChange={event => setCustomDraft({ ...customDraft, category: event.target.value as typeof customDraft.category })}><option value="equipment">Equipment</option><option value="storage">Storage</option><option value="decoration">Decoration</option><option value="other">Other</option></select></label>
                <div className="inspector-fields">
                  <label>New object width ({unit})<input type="number" min="0.01" step="any" value={Number(displayLength(customDraft.width, unit).toFixed(4))} onChange={event => setCustomDraft({ ...customDraft, width: toMeters(Number(event.target.value), unit) })} /></label>
                  <label>New object depth ({unit})<input type="number" min="0.01" step="any" value={Number(displayLength(customDraft.depth, unit).toFixed(4))} onChange={event => setCustomDraft({ ...customDraft, depth: toMeters(Number(event.target.value), unit) })} /></label>
                </div>
                <p>Manual dimensions and category. The description is saved as context; it does not generate geometry or an AI prediction.</p>
              </div>}
              <div className="button-row">
                <button className="button compact secondary" onClick={() => addObject(newObject(placing))}>Place in clear spot</button>
                <button className="button compact quiet" onClick={() => setPlacing(null)}>Cancel</button>
              </div>
            </div>}
            <div className="floor-tools">
              <label className="checkbox"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap to grid</label>
              <div className="button-row">
                <StateButton className="button quiet compact" disabled={!history.length} onClick={undo}><Undo2 size={15} /> Undo</StateButton>
                <StateButton className="button quiet compact" disabled={!future.length} onClick={redo}><Redo2 size={15} /> Redo</StateButton>
                <StateButton className="button quiet compact" disabled={!isDirty} onClick={() => { if (window.confirm("Discard draft changes and return to the saved editing checkpoint?")) changeLayout(checkpoint, checkpoint); }}><RotateCcw size={14} /> Reset draft</StateButton>
                <StateButton className="button primary compact" disabled={!loaded || !libraryWritable} onClick={saveLayout}><Save size={15} /> Save draft</StateButton>
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
              <button className="button primary mission-action" onClick={trySeating}>{fixture.mission.action} <ArrowRight size={16} /></button>
              <button className="button secondary mission-action" onClick={tryTurnover}>Try faster turnover <ArrowRight size={16} /></button>
              <details className="mission-details">
                <summary>Why this mission?</summary>
                {fixture.mission.priority && <p>Demo priority · {fixture.mission.priority}</p>}
                {fixture.mission.applicability && <p>{fixture.mission.applicability}</p>}
                {fixture.mission.missingData?.length ? <>
                  <h3>Still needed</h3>
                  <ul>{fixture.mission.missingData.map((item) => <li key={item}>{item}</li>)}</ul>
                </> : <p>Customer demand and usable space need verification.</p>}
              </details>
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
                  {layout.objects.map((object, index) => <option key={object.id} value={object.id}>{object.name ?? furniture[object.type].label} {index + 1}{overlaps.has(object.id) ? " (overlap)" : ""}</option>)}
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
                    const linked = layout.objects.filter(object => object.seatOwnerId === selected.id);
                    if (linked.length && !window.confirm(`Delete this seating group and its ${linked.length} assigned chair objects? Undo can restore the group.`)) return;
                    commit({ ...layout, objects: layout.objects.filter(object => object.id !== selected.id && object.seatOwnerId !== selected.id) });
                    setSelectedId(null);
                  }}><Trash2 size={16} /></button>
                </div>
              </div>}
              <LayoutInspector layout={layout} selected={selected} unit={unit} onUpdate={moveObject}
                onNotice={(text) => setNotice({ text, warning: true })} />
              <details className="room-details">
                <summary>Room dimensions</summary>
                <div className="room-unit">
                  <label>Units <select value={unit} onChange={(event) => setUnit(event.target.value === "ft" ? "ft" : "m")}>
                    <option value="m">Meters</option><option value="ft">Feet</option>
                  </select></label>
                </div>
                <form key={`${roomFormVersion}-${unit}`} onSubmit={resizeRoom}>
                  <label className="layout-name">Layout name<input name="name" maxLength={120} required defaultValue={layout.name} /></label>
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

        <AiWorkbench title="AI floor-plan analysis" description="Connect the working layout with supplied customer feedback. Review hypotheses, evidence and optional proposed positions before applying changes." request={{ task: "floor", restaurantId: fixture.profile.id, layout, question: "" }}
          onInspect={ids => { setAiHighlights(true); setHighlightedIds(ids); setSelectedId(ids[0]); editorTitle.current?.focus(); }}
          onPreview={(moves, source) => {
            try { const proposed = proposedAiLayout(layout, moves); setAiPreview({ from: layout, ids: moves.map(move => move.objectId), layout: { ...proposed, objects: proposed.objects.map(object => moves.some(move => move.objectId === object.id) ? { ...object, aiSource: { model: source.model, generatedAt: source.generatedAt, method: "move" } } : object) } }); setProposal(null); editorTitle.current?.focus(); }
            catch { setNotice({ text: aiError, warning: true }); }
          }} />
        <AiWorkbench title="AI custom-object designer" description="Describe furniture or equipment. AI suggests editable metadata and estimated dimensions; you decide where to place it." inputLabel="Describe the object" request={{ task: "custom-object", restaurantId: fixture.profile.id, layout, question: "" }} onCustomObject={(object, source) => { setCustomDraft(object); setCustomAiSource({ model: source.model, generatedAt: source.generatedAt, method: "object" }); setPlacing("custom"); editorTitle.current?.focus(); }} />
        <section className="panel layout-library"><h2>Layout insights</h2><p>Rule-based hypotheses from your geometry. Inspect a finding to highlight all affected objects; the first opens in the inspector. No observed seating preferences or safety assessment are available.</p>
          {highlightedIds.length > 0 && <button className="button quiet compact" onClick={() => setHighlightedIds([])}>Clear object highlights</button>}
          {insights.length ? insights.map(insight => <details className="layout-finding" key={insight.id}><summary>{insight.severity} · {insight.title}</summary><p>{insight.explanation}</p><div className="button-row"><button className="button secondary compact" onClick={() => { setSelectedId(insight.objectIds[0]); setAiHighlights(false); setHighlightedIds(insight.objectIds); setPlacing(null); editorTitle.current?.scrollIntoView({ block: "start" }); editorTitle.current?.focus({ preventScroll: true }); }}>Inspect affected objects</button>
            {insight.id.startsWith("overlap-") && <button className="button secondary compact" onClick={() => {
              const object = suggestClearPosition(layout, insight.objectIds[0]);
              if (!object) { setNotice({ text: "No separate grid position is available for this object. Resize or rearrange furniture manually.", warning: true }); editorTitle.current?.focus(); return; }
              setProposal({ object, from: layout }); setAiHighlights(false); setHighlightedIds(insight.objectIds); setSelectedId(object.id); setPlacing(null); editorTitle.current?.focus();
            }}>Preview a clear position</button>}
          </div></details>) : <p>No proximity or overlap findings. This does not establish that the layout is optimal.</p>}
        </section>
        <details className="panel layout-library"><summary>Estimate a separate draft from photos</summary><p>Photo estimates require manual measurements and verification. This separate draft does not change your saved restaurant layout.</p><AnalyzePlan plans={fixture.photoPlans} /></details>
        <div className="scenario-inline" ref={scenarioSection} tabIndex={-1}>
          <div className="scenario-inline-header">
            <h2>Scenarios</h2>
            <p>Simulate layout and turnover changes to see projected outcomes.</p>
          </div>
          <ScenarioPanel key={formVersion} defaultAction={formDefaults.action} defaultTargetTurnsPerDay={formDefaults.targetTurnsPerDay}
            defaults={formDefaults.inputs} baselineSeats={formDefaults.baselineSeats} draftSeats={counts.seats}
            scenario={scenario} saved={savedScenarios} isSaved={savedScenarios.some(({ id }) => scenario?.id === id)} overlaps={overlaps.size > 0}
            layoutChanged={Boolean(scenario && scenario.layout.updatedAt !== layout.updatedAt)} notice={scenarioNotice}
            onSimulate={previewScenario} onDelete={deleteScenario} onSave={saveScenario} onOpen={openScenario} onLoadLayout={loadScenarioLayout}
            onReset={resetScenario} formVersion={formVersion} />
        </div>
        </div>
        <div hidden={section !== "reviews"}>
        <AiWorkbench title="AI review researcher" description="Interpret supplied reviews, extract themes and menu mentions, and suggest evidence-linked improvements. Counts and quoted excerpts stay tied to the supplied sample." request={{ task: "reviews", restaurantId: fixture.profile.id, question: "" }} />
        <label className="ai-review-select">Review for an AI reply<select value={replyReviewId} onChange={event => setReplyReviewId(event.target.value)}>{fixture.reviews.map(review => <option key={review.id} value={review.id}>{review.id} · {review.text.slice(0, 80)}</option>)}</select></label>
        <AiWorkbench title="AI review reply" description="Generate a response to the selected review, edit it and copy it. Nothing is published." request={{ task: "reply", restaurantId: fixture.profile.id, reviewId: replyReviewId, question: "" }} />
        <ReviewInsights reviews={fixture.reviews} mission={fixture.mission} onTrySeating={trySeating} />
        </div>
        <div hidden={section !== "hr"}>
          <AiWorkbench title="AI job-description draft" description="Describe a role, schedule and requirements, or paste a draft to improve. Missing details remain placeholders. No Indeed posting is created." inputLabel="Role, requirements or draft" request={{ task: "job", restaurantId: fixture.profile.id, question: "" }} />
          <HrPage operations={fixture.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "supply"}>
          <AiWorkbench title="AI supply advisor" description="Explain stock issues and code-calculated costs to reach reorder thresholds. These are planning suggestions, not purchase orders." request={{ task: "supply", restaurantId: fixture.profile.id, question: "" }} />
          <SupplyPage operations={fixture.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "finance"}>
          <AiWorkbench title="AI financial analysis" description="Explain the full supplied ledger and menu contribution calculations. This uses the dataset totals, not the filters or unsaved price experiment below." request={{ task: "finance", restaurantId: fixture.profile.id, question: "" }} />
          <FinancePage assumptions={fixture.assumptions} operations={fixture.operations} restaurantName={fixture.profile.name} />
        </div>
        <div hidden={section !== "ai"}>
          <AiAssistant restaurantId={fixture.profile.id} layout={layout} />
        </div>
        </AiAccessProvider>
        <footer className="workspace-footer"><Armchair size={16} /> Demo layouts and scenarios are saved in this browser.</footer>
      </main>
      <AnalysisDialog dialogRef={evidenceDialog} title="Mission evidence"><ReviewEvidence reviews={evidence} /></AnalysisDialog>
    </div>
  );
}
