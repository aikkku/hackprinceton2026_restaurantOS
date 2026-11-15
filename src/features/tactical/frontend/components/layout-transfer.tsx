"use client";

import { StateButton } from "./state-button";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import type { Layout } from "../../domain/schemas";
import { readLayoutFile } from "../layout-transfer";
import "./layout-tools.css";

type Props = {
  layout: Layout;
  onImport: (layout: Layout) => void;
  onNotice: (message: string) => void;
  disabled?: boolean;
};

export function LayoutTransfer({ layout, onImport, onNotice, disabled = false }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const latest = useRef({ restaurantId: layout.restaurantId, onImport, onNotice });

  useEffect(() => {
    latest.current = { restaurantId: layout.restaurantId, onImport, onNotice };
  }, [layout.restaurantId, onImport, onNotice]);

  async function importLayout(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setReading(true);
    try {
      const imported = await readLayoutFile(file, layout.restaurantId);
      if (imported.restaurantId !== latest.current.restaurantId) {
        throw new Error("The active restaurant changed while reading this file. Choose the layout again.");
      }
      latest.current.onImport(imported);
    } catch (cause) {
      latest.current.onNotice(cause instanceof Error ? cause.message : "The file could not be read. Try choosing it again.");
    } finally {
      setReading(false);
    }
  }

  function exportLayout() {
    const file = new Blob([JSON.stringify(layout, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    const name = layout.restaurantId.replace(/[^a-zA-Z0-9_-]/g, "-");
    anchor.href = url;
    anchor.download = `${name || "restaurant"}-layout.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="layout-transfer" aria-label="Layout files">
      <input ref={input} type="file" accept=".json,application/json" aria-label="Import layout JSON file" onChange={importLayout} hidden />
      <StateButton type="button" className="button compact quiet" disabled={disabled || reading} onClick={() => input.current?.click()}>
        <Upload size={14} /> {reading ? "Reading layout…" : "Import layout"}
      </StateButton>
      <StateButton type="button" className="button compact quiet" disabled={disabled || reading} onClick={exportLayout}><Download size={14} /> Export layout</StateButton>
    </div>
  );
}
