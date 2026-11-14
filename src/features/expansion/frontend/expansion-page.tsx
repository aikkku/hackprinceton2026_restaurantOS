"use client";

import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { fixtureProvider } from "./data/demo-market.ts";
import type { ExpansionProvider } from "../domain/provider.ts";
import type { Dataset, Scenario } from "../domain/schemas.ts";
import { decodeScenarios, STORAGE_KEY } from "./storage.ts";
import { ExpansionHeader } from "./components/expansion-header";
import { ExpansionWorkspace } from "./components/expansion-workspace";
import "./components/expansion.css";

export default function ExpansionPage({
  provider = fixtureProvider,
}: {
  provider?: ExpansionProvider;
}) {
  const [loaded, setLoaded] = useState<{
    dataset: Dataset;
    saved: Scenario[];
    storageError: string | null;
  } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    provider
      .load(controller.signal)
      .then((dataset) => {
        if (controller.signal.aborted) return;
        let saved: Scenario[] = [];
        let storageError: string | null = null;
        try {
          saved = decodeScenarios(localStorage.getItem(STORAGE_KEY));
          if (
            saved.some(
              (s) =>
                !dataset.properties.some(
                  (p) => p.id === s.propertyId && p.cityId === s.cityId,
                ) ||
                s.sourceIds.some(
                  (id) => !dataset.evidence.some((e) => e.id === id),
                ),
            )
          )
            throw new Error("Unknown saved evidence");
        } catch {
          saved = [];
          storageError =
            "Saved demo scenarios could not be read. Existing storage has been preserved. Clear saved demo data to start again.";
        }
        setLoaded({ dataset, saved, storageError });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [provider, attempt]);

  if (!loaded)
    return (
      <div className="expansion-app">
        <ExpansionHeader />
        <main className="startup" role="status">
          <Compass size={32} />
          <h1>
            {error
              ? "The scouting data could not load."
              : "Preparing your scouting map…"}
          </h1>
          <p>
            {error
              ? "No replacement records have been substituted."
              : "Loading explicitly fictional Houston fixtures."}
          </p>
          {error && (
            <button
              className="primary"
              onClick={() => {
                setError(false);
                setAttempt((a) => a + 1);
              }}
            >
              Retry data
            </button>
          )}
        </main>
      </div>
    );
  return (
    <ExpansionWorkspace
      dataset={loaded.dataset}
      initialSaved={loaded.saved}
      initialStorageError={loaded.storageError}
    />
  );
}
