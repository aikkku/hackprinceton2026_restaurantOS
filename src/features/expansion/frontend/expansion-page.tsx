"use client";

import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { fixtureProvider } from "./data/demo-market.ts";
import { loadMarkets, LocalDataError } from "./data/local-market.ts";
import type { ExpansionProvider } from "../domain/provider.ts";
import type { Dataset, Scenario } from "../domain/schemas.ts";
import { decodeScenarios, MODE_STORAGE_KEY, storageKeyFor } from "./storage.ts";
import { ExpansionHeader } from "./components/expansion-header";
import { ExpansionWorkspace } from "./components/expansion-workspace";
import "./components/expansion.css";

export default function ExpansionPage({ provider = fixtureProvider }: { provider?: ExpansionProvider }) {
  const [mode, setMode] = useState<"demo" | "local">("demo");
  const [initialized, setInitialized] = useState(false);
  const [loaded, setLoaded] = useState<{ mode: "demo" | "local"; dataset: Dataset; saved: Scenario[]; storageError: string | null } | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void Promise.resolve().then(() => {
      try { if (localStorage.getItem(MODE_STORAGE_KEY) === "local") setMode("local"); } catch { /* Storage is optional. */ }
      setInitialized(true);
    });
  }, []);
  function changeMode(next: "demo" | "local") {
    try { localStorage.setItem(MODE_STORAGE_KEY, next); } catch { /* Mode remains usable without storage. */ }
    setError(null);
    setMode(next);
  }
  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    const load = mode === "demo" ? provider.load(controller.signal) : loadMarkets(controller.signal).then((result) => ({
      cities: result.cities, areas: [], properties: [], evidence: result.evidence, metadata: result.metadata,
    }));
    load.then((dataset) => {
      if (controller.signal.aborted) return;
      let saved: Scenario[] = [];
      let storageError: string | null = null;
      try {
        saved = decodeScenarios(localStorage.getItem(storageKeyFor(mode)));
        if (saved.some((snapshot) => snapshot.isDemo !== (mode === "demo"))) throw new Error("Wrong data mode");
      } catch {
        saved = [];
        storageError = `Saved ${mode === "demo" ? "demo" : "local dataset"} scenarios could not be read. Existing storage has been preserved. Clear saved ${mode === "demo" ? "demo" : "local"} data to start again.`;
      }
      setError(null);
      setLoaded({ mode, dataset, saved, storageError });
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError({ message: failure instanceof Error ? failure.message : "The scouting data could not load.", code: failure instanceof LocalDataError ? failure.code : undefined });
    });
    return () => controller.abort();
  }, [provider, attempt, mode, initialized]);

  if (!loaded || loaded.mode !== mode)
    return <div className="expansion-app">
      <ExpansionHeader mode={mode} onModeChange={changeMode} />
      <main className="startup" role={error ? "alert" : "status"}>
        <Compass size={32} />
        <h1>{error ? error.code === "not_configured" ? "Local dataset is not configured." : "The scouting data could not load." : "Preparing your scouting map…"}</h1>
        <p>{error ? error.message : mode === "demo" ? "Loading explicitly fictional demo fixtures." : "Reading supported markets from the local dataset snapshot."}</p>
        {error && <button className="primary" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Retry data</button>}
        {mode === "local" && <p className="small-note">Local snapshots are dated records. They do not verify current availability.</p>}
      </main>
    </div>;
  if (!loaded.dataset.cities.length) return <div className="expansion-app">
    <ExpansionHeader mode={mode} onModeChange={changeMode} />
    <main className="startup"><Compass size={32} /><h1>No supported markets in this snapshot.</h1><p>No records with usable market geography were returned.</p><button className="primary" onClick={() => setAttempt((value) => value + 1)}>Retry data</button></main>
  </div>;
  return <ExpansionWorkspace key={mode} dataset={loaded.dataset} initialSaved={loaded.saved}
    initialStorageError={loaded.storageError} mode={mode} onModeChange={changeMode} />;
}
