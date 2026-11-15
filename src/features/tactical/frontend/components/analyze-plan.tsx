"use client";

import type { Dataset } from "../../domain/dataset";
import { StateButton } from "./state-button";

import { useEffect, useRef, useState } from "react";
import {
  Camera, ChevronDown, ChevronUp, Download, FileJson, FlipHorizontal2,
  Plus, RotateCw, Trash2, Undo2, Redo2, X, AlertCircle, CheckCircle2,
} from "lucide-react";
import {
  rotatePlan, validateDraft, floorPlanDraftSchema,
  type AnalyzeFacts, type DraftWall, type FloorPlanDraft, type DraftTable, type DraftFixture, type ValidationCheck,
} from "../../domain/analyze";
import { DraftCanvas } from "./draft-canvas";
import {
  loadLessons, saveLessons, loadMistakes, saveMistakes,
  diffPlans, diffScore, diffToLessons, mergeLessons, type Lesson,
} from "../analyze-lessons";
import { useAiAccess } from "./ai-workbench";
import { aiError } from "../../domain/ai";
import "./analyze.css";

type Photo = { id: string; dataUrl: string; tag: string };

const WALL_OPTIONS: Array<{ value: DraftWall; label: string }> = [
  { value: "unknown", label: "Unknown" },
  { value: "N", label: "North" },
  { value: "E", label: "East" },
  { value: "S", label: "South" },
  { value: "W", label: "West" },
];

function emptyFacts(): AnalyzeFacts {
  return { entranceWall: "unknown", cashierWall: "unknown", barWall: "unknown", tableCounts: "", tableSpacing: "", notes: "" };
}

function makeId() { return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }

export function AnalyzePlan({ plans }: { plans: Dataset["photoPlans"] }) {
  const aiUnlocked = useAiAccess();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [facts, setFacts] = useState<AnalyzeFacts>(emptyFacts());
  const [accuracy, setAccuracy] = useState<"standard" | "high">("standard");
  const [status, setStatus] = useState<"idle" | "analyzing" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [fixupMsg, setFixupMsg] = useState("");
  const [draft, setDraft] = useState<FloorPlanDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<FloorPlanDraft | null>(null);
  const [history, setHistory] = useState<FloorPlanDraft[]>([]);
  const [future, setFuture] = useState<FloorPlanDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [showTeachIt, setShowTeachIt] = useState(false);
  const [showLessons, setShowLessons] = useState(false);
  const [correctionsSaved, setCorrectionsSaved] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: "error" | "success" | "info" } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setLessons(loadLessons()));
    return () => cancelAnimationFrame(frame);
  }, []);

  function showToast(text: string, kind: "error" | "success" | "info" = "info") {
    setToast({ text, kind });
    setTimeout(() => setToast(null), 4000);
  }

  function commitDraft(next: FloorPlanDraft) {
    if (!draft) { setDraft(next); return; }
    setHistory((h) => [...h.slice(-49), draft]);
    setFuture([]);
    setDraft(next);
  }

  function undo() {
    const prev = history.at(-1);
    if (!prev || !draft) return;
    setFuture((f) => [...f, draft]);
    setHistory(history.slice(0, -1));
    setDraft(prev);
  }

  function redo() {
    const next = future.at(-1);
    if (!next || !draft) return;
    setHistory((h) => [...h, draft!]);
    setFuture(future.slice(0, -1));
    setDraft(next);
  }

  async function resizePhoto(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async function addFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, 10 - photos.length));
    for (const file of arr) {
      try {
        const dataUrl = await resizePhoto(file);
        setPhotos((prev) => [...prev, { id: makeId(), dataUrl, tag: "" }].slice(0, 10));
      } catch { showToast(`Could not read ${file.name}`, "error"); }
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  async function analyze() {
    if (photos.length < 1) return;
    setStatus("analyzing");
    setStatusMsg("Analyzing photos…");
    setFixupMsg("");
    setCorrectionsSaved(false);
    try {
      const res = await fetch("/api/tactical/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photos: photos.map((p) => p.dataUrl), facts, accuracy, lessons }),
        signal: AbortSignal.timeout(70_000),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || data.source !== "ai") throw new Error(aiError);
      const incoming = floorPlanDraftSchema.parse(data.draft);
      setDraft(incoming);
      setOriginalDraft(incoming);
      setHistory([]);
      setFuture([]);
      setSelectedId(null);
      setStatus("done");
      setStatusMsg(`AI estimate — ${incoming.tables.length} tables. Verify counts and measurements.`);
      if (data.fixupApplied) setFixupMsg("A second pass corrected some issues.");
    } catch {
      setStatus("error");
      setStatusMsg(aiError);
    }
  }

  function loadSample() { resetEditor(plans.sample); }
  function loadBlank() { resetEditor(plans.blank); }

  function resetEditor(plan: FloorPlanDraft) {
    setDraft(plan);
    setOriginalDraft(null);
    setHistory([]);
    setFuture([]);
    setSelectedId(null);
    setStatus("idle");
    setStatusMsg("");
    setFixupMsg("");
    setCorrectionsSaved(false);
  }

  function loadJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (file.size > 1_048_576) { showToast("Choose a plan under 1 MB.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const plan = floorPlanDraftSchema.parse(JSON.parse(reader.result as string));
        resetEditor(plan);
        showToast("Plan loaded.", "success");
      } catch { showToast("Could not read plan file.", "error"); }
    };
    reader.readAsText(file);
  }

  function exportJson() {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "floor-plan.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg() {
    const svgEl = document.querySelector(".draft-svg") as SVGSVGElement | null;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "floor-plan.svg"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPng() {
    const svgEl = document.querySelector(".draft-svg") as SVGSVGElement | null;
    if (!svgEl) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgEl);
    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = svgEl.clientWidth * 2;
      canvas.height = svgEl.clientHeight * 2;
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const pngUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = pngUrl; a.download = "floor-plan.png"; a.click();
        setTimeout(() => URL.revokeObjectURL(pngUrl), 1000);
      }, "image/png");
    };
    img.src = url;
  }

  function rotateWholePlan() {
    if (!draft) return;
    commitDraft(rotatePlan(draft, 90));
  }

  function addTable() {
    if (!draft) return;
    const id = makeId();
    const newTable: DraftTable = {
      id, x: 2, y: 2, shape: "rect", width: 4, depth: 3,
      seats: 4, chairs_visible: 4, is_joined_group: false, confidence: 1, label: "New table", verified: true,
    };
    commitDraft({ ...draft, tables: [...draft.tables, newTable] });
    setSelectedId(id);
  }

  function addFixture(type: "bar" | "cashier") {
    if (!draft) return;
    const id = `${type}-${Date.now()}`;
    const f: DraftFixture = { id, type, x: 2, y: 2, width: type === "bar" ? 12 : 5, depth: 3, stool_count: type === "bar" ? 5 : undefined };
    commitDraft({ ...draft, fixtures: [...draft.fixtures, f] });
    setSelectedId(id);
  }

  function deleteSelected() {
    if (!draft || !selectedId) return;
    if (deleteConfirm !== selectedId) { setDeleteConfirm(selectedId); return; }
    setDeleteConfirm(null);
    const isFixture = draft.fixtures.some((f) => f.id === selectedId);
    const updated = isFixture
      ? { ...draft, fixtures: draft.fixtures.filter((f) => f.id !== selectedId) }
      : { ...draft, tables: draft.tables.filter((t) => t.id !== selectedId) };
    commitDraft(updated);
    setSelectedId(null);
  }

  function duplicateSelected() {
    if (!draft || !selectedId) return;
    const table = draft.tables.find((t) => t.id === selectedId);
    if (table) {
      const newId = makeId();
      commitDraft({ ...draft, tables: [...draft.tables, { ...table, id: newId, x: table.x + 1, y: table.y + 1 }] });
      setSelectedId(newId);
    }
    const fix = draft.fixtures.find((f) => f.id === selectedId);
    if (fix) {
      const newId = makeId();
      commitDraft({ ...draft, fixtures: [...draft.fixtures, { ...fix, id: newId, x: fix.x + 1, y: fix.y + 1 }] });
      setSelectedId(newId);
    }
  }

  function saveCorrections(planWasRight: boolean) {
    if (!draft) return;
    const original = originalDraft ?? draft;
    const diff = diffPlans(original, draft);
    const score = diffScore(diff);
    const newLessons = planWasRight ? [] : diffToLessons(diff);
    const updated = mergeLessons(lessons, newLessons);
    setLessons(updated);
    saveLessons(updated);
    const mistakes = loadMistakes();
    mistakes.unshift({ id: makeId(), score, date: new Date().toISOString(), summary: planWasRight ? "Plan was correct" : `${score} issue(s) corrected` });
    saveMistakes(mistakes.slice(0, 20));
    setCorrectionsSaved(true);
    showToast(planWasRight ? "Great — marked as correct." : `Saved ${newLessons.length} lesson(s) for future runs.`, "success");
  }

  const checks: ValidationCheck[] = draft ? validateDraft(draft, facts) : [];
  const errors = checks.filter((c) => c.kind === "error");
  const warnings = checks.filter((c) => c.kind === "warning");

  const selected = draft ? (draft.tables.find((t) => t.id === selectedId) ?? draft.fixtures.find((f) => f.id === selectedId) ?? null) : null;
  const totalSeats = draft ? draft.tables.reduce((s, t) => s + t.seats, 0) : 0;
  const barStools = draft ? draft.fixtures.filter((f) => f.type === "bar").reduce((s, f) => s + (f.stool_count ?? 0), 0) : 0;

  const analyzeDisabled = !aiUnlocked || photos.length < 1 || status === "analyzing";
  const analyzeTitle = status === "analyzing" ? "Analyzing…" : photos.length < 1 ? "Add at least 1 photo" : undefined;

  return (
    <div className="analyze-root">
      {toast && (
        <div className={`analyze-toast analyze-toast-${toast.kind}`} role="alert">
          {toast.kind === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
          {toast.text}
          <button className="analyze-toast-close" onClick={() => setToast(null)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      )}

      {/* Header actions */}
      <div className="analyze-header-actions">
        <button className="button quiet compact" onClick={loadSample}>Sample plan</button>
        <button className="button quiet compact" onClick={loadBlank}>Blank plan</button>
        <input ref={jsonInputRef} type="file" accept=".json,application/json" hidden onChange={loadJson} />
        <button className="button quiet compact" onClick={() => jsonInputRef.current?.click()}><FileJson size={14} /> Load JSON</button>
      </div>

      <div className="analyze-layout">
        {/* LEFT: photos + facts */}
        <aside className="analyze-left">
          <div className="analyze-card">
            <h3 className="analyze-card-title">Photos</h3>
            <div
              className={`photo-drop-zone ${dragOver ? "is-dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => { setDragOver(false); }}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Camera size={22} />
              <span>Drag photos here or click to choose</span>
              <small>JPG/PNG · up to 10 photos</small>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
            {photos.length > 0 && (
              <div className="photo-thumbnails">
                {photos.map((p) => (
                  <div key={p.id} className="photo-thumb">
                    {/* Local resized previews; no remote image optimization needed. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.dataUrl} alt="Restaurant photo" />
                    <input
                      className="photo-tag"
                      placeholder="Tag (optional)"
                      value={p.tag}
                      onChange={(e) => setPhotos((prev) => prev.map((ph) => ph.id === p.id ? { ...ph, tag: e.target.value } : ph))}
                    />
                    <button className="photo-remove" onClick={() => removePhoto(p.id)} aria-label="Remove photo"><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="analyze-card">
            <h3 className="analyze-card-title">Facts you know <small>(optional)</small></h3>
            <div className="facts-grid">
              {(["entranceWall", "cashierWall", "barWall"] as const).map((key) => (
                <label key={key} className="facts-label">
                  {key === "entranceWall" ? "Entrance wall" : key === "cashierWall" ? "Cashier near" : "Bar along"}
                  <select value={facts[key]} onChange={(e) => setFacts((f) => ({ ...f, [key]: e.target.value as DraftWall }))}>
                    {WALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              ))}
              <label className="facts-label facts-full">
                Table counts (seats:count, e.g. 4:5, 2:2)
                <input value={facts.tableCounts} placeholder="6:1, 4:5, 2:2" onChange={(e) => setFacts((f) => ({ ...f, tableCounts: e.target.value }))} />
              </label>
              <label className="facts-label facts-full">
                Table spacing
                <input value={facts.tableSpacing} placeholder="e.g. about two chair-lengths apart" onChange={(e) => setFacts((f) => ({ ...f, tableSpacing: e.target.value }))} />
              </label>
              <label className="facts-label facts-full">
                Notes
                <textarea value={facts.notes} rows={2} placeholder="e.g. only one 6-seat table, cashier is in the northeast corner" onChange={(e) => setFacts((f) => ({ ...f, notes: e.target.value }))} />
              </label>
            </div>
          </div>

          <div className="analyze-card">
            <h3 className="analyze-card-title">AI detail level</h3>
            <div className="accuracy-picker">
              <label className="accuracy-opt">
                <input type="radio" name="accuracy" value="standard" checked={accuracy === "standard"} onChange={() => setAccuracy("standard")} />
                <span>Standard <small>(faster)</small></span>
              </label>
              <label className="accuracy-opt">
                <input type="radio" name="accuracy" value="high" checked={accuracy === "high"} onChange={() => setAccuracy("high")} />
                <span>More detail <small>(estimates still need checking)</small></span>
              </label>
            </div>
          </div>

          <StateButton className="button ai-button analyze-btn" onClick={() => void analyze()} disabled={analyzeDisabled} title={analyzeTitle}>
            {status === "analyzing" ? "Analyzing…" : "Analyze photos"}
          </StateButton>
          <p className="ai-surface">AI photo analysis sends these photos to Google Gemini. Unlock AI above to enable analysis. Sample and blank plans are manual demos.</p>
          {statusMsg && <p role={status === "error" ? "alert" : "status"} className={`analyze-status ${status === "error" ? "ai-error" : "ai-output"}`}>{statusMsg}</p>}
          {fixupMsg && <p className="analyze-status analyze-status-info">{fixupMsg}</p>}
        </aside>

        {/* CENTER: canvas + toolbar */}
        <div className={`analyze-center ${originalDraft ? "ai-photo-result" : ""}`}>
          {originalDraft && <span className="ai-badge">AI-estimated plan · manual verification required</span>}
          {/* Toolbar */}
          <div className="analyze-toolbar" role="toolbar" aria-label="Plan editor toolbar">
            <StateButton className="button quiet compact" onClick={undo} disabled={!history.length} title="Undo"><Undo2 size={15} /></StateButton>
            <StateButton className="button quiet compact" onClick={redo} disabled={!future.length} title="Redo"><Redo2 size={15} /></StateButton>
            <span className="toolbar-sep" />
            <StateButton className="button quiet compact" onClick={addTable} disabled={!draft}><Plus size={14} /> Table</StateButton>
            <StateButton className="button quiet compact" onClick={() => addFixture("bar")} disabled={!draft}><Plus size={14} /> Bar</StateButton>
            <StateButton className="button quiet compact" onClick={() => addFixture("cashier")} disabled={!draft}><Plus size={14} /> Cashier</StateButton>
            <span className="toolbar-sep" />
            <StateButton className="button quiet compact" onClick={duplicateSelected} disabled={!selectedId}>Duplicate</StateButton>
            <StateButton className="button quiet compact" onClick={rotateWholePlan} disabled={!draft} title="Rotate whole plan 90°"><RotateCw size={14} /> Rotate plan</StateButton>
            <span className="toolbar-sep" />
            <StateButton className={`button compact ${deleteConfirm === selectedId ? "primary" : "quiet"}`} onClick={deleteSelected} disabled={!selectedId}>
              <Trash2 size={14} /> {deleteConfirm === selectedId ? "Confirm delete" : "Delete"}
            </StateButton>
            <span className="toolbar-sep" />
            <StateButton className="button quiet compact" onClick={exportSvg} disabled={!draft}><Download size={14} /> SVG</StateButton>
            <StateButton className="button quiet compact" onClick={exportPng} disabled={!draft}><Download size={14} /> PNG</StateButton>
            <StateButton className="button quiet compact" onClick={exportJson} disabled={!draft}><FileJson size={14} /> JSON</StateButton>
          </div>

          <div className="analyze-canvas-wrap">
            {draft
              ? <DraftCanvas draft={draft} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setDeleteConfirm(null); }} onCommit={commitDraft} />
              : <div className="analyze-empty-canvas">
                <FlipHorizontal2 size={40} />
                <p>Add photos and click <strong>Analyze photos</strong>, or load a sample plan to explore the editor.</p>
              </div>
            }
          </div>

          {draft && draft.questions.length > 0 && (
            <div className="analyze-questions">
              <h4>Questions from analysis</h4>
              <ul>{draft.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
        </div>

        {/* RIGHT: capacity, teach-it, checks, selected, entrance */}
        <aside className="analyze-right">
          {draft && (
            <div className="analyze-card">
              <h3 className="analyze-card-title">Capacity</h3>
              <dl className="capacity-dl">
                <div><dt>Tables</dt><dd>{draft.tables.length}</dd></div>
                <div><dt>Table seats</dt><dd>{totalSeats}</dd></div>
                <div><dt>Bar stools</dt><dd>{barStools}</dd></div>
                <div className="capacity-total"><dt>Total</dt><dd>{totalSeats + barStools}</dd></div>
              </dl>
            </div>
          )}

          {/* Checks */}
          {draft && (
            <div className="analyze-card">
              <h3 className="analyze-card-title">
                Checks
                {errors.length > 0 && <span className="check-badge check-badge-error">{errors.length} error{errors.length > 1 ? "s" : ""}</span>}
                {warnings.length > 0 && <span className="check-badge check-badge-warn">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</span>}
                {checks.length === 0 && <span className="check-badge check-badge-ok">OK</span>}
              </h3>
              {checks.length > 0
                ? <ul className="checks-list">
                  {checks.map((c) => (
                    <li key={c.id} className={`check-item check-${c.kind}`} onClick={() => c.targetId && setSelectedId(c.targetId)} role={c.targetId ? "button" : undefined} tabIndex={c.targetId ? 0 : undefined}>
                      {c.kind === "error" ? <AlertCircle size={13} /> : <AlertCircle size={13} />}
                      {c.message}
                    </li>
                  ))}
                </ul>
                : <p className="checks-ok">No issues found.</p>
              }
            </div>
          )}

          {/* Selected item editor */}
          {selected && (
            <div className="analyze-card">
              <h3 className="analyze-card-title">
                {"shape" in selected ? `Table: ${selected.label}` : selected.type === "bar" ? "Bar" : "Cashier"}
              </h3>
              {"shape" in selected && (
                <SelectedTableEditor table={selected} onUpdate={(updated) => commitDraft({ ...draft!, tables: draft!.tables.map((t) => t.id === updated.id ? updated : t) })} />
              )}
              {"type" in selected && (
                <SelectedFixtureEditor fixture={selected as DraftFixture} onUpdate={(updated) => commitDraft({ ...draft!, fixtures: draft!.fixtures.map((f) => f.id === updated.id ? updated : f) })} />
              )}
            </div>
          )}

          {/* Entrance */}
          {draft && (
            <div className="analyze-card">
              <h3 className="analyze-card-title">Entrance</h3>
              <div className="entrance-fields">
                <label className="facts-label">Wall
                  <select value={draft.door.wall} onChange={(e) => commitDraft({ ...draft, door: { ...draft.door, wall: e.target.value as DraftWall } })}>
                    {WALL_OPTIONS.filter((o) => o.value !== "unknown").concat({ value: "unknown", label: "Unknown" }).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
                <label className="facts-label">Position along wall (0–1)
                  <input type="number" min={0} max={1} step={0.05} value={draft.door.position}
                    onChange={(e) => commitDraft({ ...draft, door: { ...draft.door, position: Math.min(1, Math.max(0, Number(e.target.value))) } })} />
                </label>
              </div>
            </div>
          )}

          {/* Teach-it / Learn from corrections */}
          {draft && (
            <div className="analyze-card">
              <button className="analyze-card-toggle" onClick={() => setShowTeachIt(!showTeachIt)}>
                <span className="analyze-card-title">Teach it</span>
                {showTeachIt ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {showTeachIt && (
                <div className="teach-it-body">
                  <p className="teach-it-note">Edit the plan until it matches your room, then save corrections so the model learns from mistakes.</p>
                  {!correctionsSaved
                    ? <div className="button-row">
                      <button className="button secondary compact" onClick={() => saveCorrections(false)}>Save corrections</button>
                      <button className="button quiet compact" onClick={() => saveCorrections(true)}>Plan was already right</button>
                    </div>
                    : <p className="teach-it-saved"><CheckCircle2 size={14} /> Corrections saved.</p>
                  }
                  <button className="analyze-card-toggle" style={{ marginTop: 8 }} onClick={() => setShowLessons(!showLessons)}>
                    <span style={{ fontSize: ".8rem", fontWeight: 600 }}>{lessons.length} lesson{lessons.length !== 1 ? "s" : ""} stored</span>
                    {showLessons ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {showLessons && (
                    <ul className="lessons-list">
                      {lessons.length === 0 && <li className="lesson-empty">No lessons yet.</li>}
                      {lessons.map((l) => (
                        <li key={l.id} className="lesson-item">
                          <span className="lesson-text">{l.text}</span>
                          <span className="lesson-count">×{l.count}</span>
                          <button className="lesson-delete" onClick={() => { const updated = lessons.filter((x) => x.id !== l.id); setLessons(updated); saveLessons(updated); }} aria-label="Delete lesson"><X size={11} /></button>
                        </li>
                      ))}
                      {lessons.length > 0 && <li><button className="button quiet compact" style={{ width: "100%", marginTop: 4 }} onClick={() => { setLessons([]); saveLessons([]); }}>Reset all lessons</button></li>}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SelectedTableEditor({ table, onUpdate }: { table: DraftTable; onUpdate: (t: DraftTable) => void }) {
  return (
    <div className="selected-fields">
      <label className="facts-label">Shape
        <select value={table.shape} onChange={(e) => onUpdate({ ...table, shape: e.target.value as DraftTable["shape"], verified: true })}>
          <option value="rect">Rectangular</option>
          <option value="square">Square</option>
          <option value="round">Round</option>
        </select>
      </label>
      <label className="facts-label">Seats
        <div className="seat-stepper">
          <button className="icon-button" onClick={() => onUpdate({ ...table, seats: Math.max(1, table.seats - 1), verified: true })}>−</button>
          <span>{table.seats}</span>
          <button className="icon-button" onClick={() => onUpdate({ ...table, seats: table.seats + 1, verified: true })}>+</button>
        </div>
      </label>
      <label className="facts-label">Width (ft)
        <input type="number" min={1} max={30} step={0.5} value={table.width}
          onChange={(e) => onUpdate({ ...table, width: Math.max(1, Number(e.target.value)), verified: true })} />
      </label>
      <label className="facts-label">Depth (ft)
        <input type="number" min={1} max={30} step={0.5} value={table.depth}
          onChange={(e) => onUpdate({ ...table, depth: Math.max(1, Number(e.target.value)), verified: true })} />
      </label>
      <label className="facts-label">Label
        <input value={table.label} maxLength={20} onChange={(e) => onUpdate({ ...table, label: e.target.value })} />
      </label>
      {table.verified && <p className="verified-note"><CheckCircle2 size={12} /> Verified</p>}
    </div>
  );
}

function SelectedFixtureEditor({ fixture, onUpdate }: { fixture: DraftFixture; onUpdate: (f: DraftFixture) => void }) {
  return (
    <div className="selected-fields">
      <label className="facts-label">Width (ft)
        <input type="number" min={1} max={60} step={0.5} value={fixture.width}
          onChange={(e) => onUpdate({ ...fixture, width: Math.max(1, Number(e.target.value)) })} />
      </label>
      <label className="facts-label">Depth (ft)
        <input type="number" min={1} max={20} step={0.5} value={fixture.depth}
          onChange={(e) => onUpdate({ ...fixture, depth: Math.max(1, Number(e.target.value)) })} />
      </label>
      {fixture.type === "bar" && (
        <label className="facts-label">Stools
          <div className="seat-stepper">
            <button className="icon-button" onClick={() => onUpdate({ ...fixture, stool_count: Math.max(0, (fixture.stool_count ?? 0) - 1) })}>−</button>
            <span>{fixture.stool_count ?? 0}</span>
            <button className="icon-button" onClick={() => onUpdate({ ...fixture, stool_count: (fixture.stool_count ?? 0) + 1 })}>+</button>
          </div>
        </label>
      )}
      <label className="facts-label">Wall
        <select value={fixture.wall ?? "unknown"} onChange={(e) => onUpdate({ ...fixture, wall: e.target.value as DraftWall })}>
          {WALL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
}
