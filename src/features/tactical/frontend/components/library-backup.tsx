"use client";

import { useState, type ChangeEvent } from "react";
import type { LayoutLibrary } from "../../domain/layout-library";
import { maxLibraryBytes, parseLibraryBackup, downloadJson } from "../layout-storage";
import { StateButton } from "./state-button";

export function LibraryBackup({ library, restaurantId, ready, onRestore, onReload, onExportStored }: {
  library: LayoutLibrary; restaurantId: string; ready: boolean;
  onRestore: (library: LayoutLibrary) => boolean; onReload: () => void; onExportStored: (recovery?: boolean) => void;
}) {
  const [preview, setPreview] = useState<LayoutLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  async function read(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setPreview(null); setError(null); setReading(true);
    try {
      if (file.size > maxLibraryBytes) throw new Error("Library backups must be 4 MB or smaller.");
      setPreview(parseLibraryBackup(await file.text(), restaurantId));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read the library backup."); }
    finally { setReading(false); }
  }
  return <details className="library-backup">
    <summary>Back up or recover saved floor plans</summary>
    <p>Backups include every saved configuration and its baseline. Unsaved draft edits and scenario history are separate: export your current layout before replacing the library.</p>
    <div className="button-row">
      <StateButton className="button secondary compact" disabled={!ready} onClick={() => downloadJson(JSON.stringify(library, null, 2), `${restaurantId}-layouts.json`)}>Export saved library</StateButton>
      <StateButton className="button quiet compact" disabled={!ready} onClick={() => onExportStored()}>Download stored bytes</StateButton>
      <StateButton className="button quiet compact" disabled={!ready} onClick={() => onExportStored(true)}>Download previous library</StateButton>
      <StateButton className="button quiet compact" disabled={!ready} onClick={onReload}>Reload saved library</StateButton>
    </div>
    <label>Import library backup<input type="file" accept=".json,application/json" disabled={!ready || reading} onChange={read} /></label>
    {reading && <p role="status">Reading library…</p>}
    {error && <p className="warning-message" role="alert">{error}</p>}
    {preview && <div className="library-import-preview">
      <h3>Backup preview · {preview.entries.length} configurations</h3>
      <ul>{preview.entries.map(entry => <li key={entry.id}>{entry.layout.name}{entry.id === preview.activeId ? " · Active" : ""}{entry.id === preview.baselineId ? " · Baseline" : ""}</li>)}</ul>
      <p>Applying replaces this browser’s saved library. Its previous stored bytes are retained under the library recovery key. No MongoDB records are changed.</p>
      <div className="button-row">
        <button className="button secondary compact" onClick={() => { if (onRestore(preview)) setPreview(null); }}>Apply library backup</button>
        <button className="button quiet compact" onClick={() => setPreview(null)}>Cancel library import</button>
      </div>
    </div>}
  </details>;
}
