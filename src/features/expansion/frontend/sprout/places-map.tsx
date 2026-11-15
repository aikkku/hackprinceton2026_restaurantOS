"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CARD_GAP, cardElement, panToFit, pinElement, toSpots, type MapPlace, type Spot } from "./map-dom.ts";
import type { MapsBrowserConfig } from "../../backend/maps-config.ts";
import { GooglePlacesMap } from "./google-places-map.tsx";

export type { MapPlace } from "./map-dom.ts";

export type PlacesMapProps = {
  places: MapPlace[]; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; onToggleSave: (id: string) => void; center: [number, number] | null; note: string;
  /** Run and owner cuisine for the Google nearby-restaurant layer. */
  runId: string; cuisine: string | null;
};

/**
 * Google map when a browser key is configured. Otherwise (or if Google fails
 * to load) the MapLibre map shows listings only: Google Places results are
 * never drawn on a non-Google map.
 */
export function PlacesMap(props: PlacesMapProps) {
  const [config, setConfig] = useState<MapsBrowserConfig | null | "loading">("loading");
  const [googleFailed, setGoogleFailed] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/expansion/maps-config", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() as Promise<MapsBrowserConfig> : null)
      .then(next => setConfig(next))
      .catch(() => { if (!controller.signal.aborted) setConfig(null); });
    return () => controller.abort();
  }, []);
  if (config === "loading") return <div className="sx-map" aria-label="Map of places" aria-busy="true" />;
  if (config?.browserKey && !googleFailed) return <GooglePlacesMap {...props} browserKey={config.browserKey} mapId={config.mapId} onFail={setGoogleFailed} />;
  const why = googleFailed || config?.reason || "Google map settings unavailable";
  return <LibrePlacesMap {...props} note={`${props.note} · ${why}; nearby restaurants are listed on each place’s page`} />;
}

function LibrePlacesMap({ places, selectedId, onSelect, onOpen, onToggleSave, center, note }: PlacesMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const selectRef = useRef(onSelect);
  const openRef = useRef(onOpen);
  const saveRef = useRef(onToggleSave);
  const [state, setState] = useState<"loading" | "ready" | "fallback">("loading");
  // The address card's spot: set by a pin click, cleared by background/close.
  const [openSpotKey, setOpenSpotKey] = useState<string | null>(null);
  const spots = useMemo(() => toSpots(places), [places]);
  const bounds = useMemo(() => {
    if (!spots.length) return null;
    const lats = spots.map((s) => s.lat), lngs = spots.map((s) => s.lng);
    return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as const;
  }, [spots]);
  const missing = places.filter((p) => p.lat === null || p.lng === null).length;
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { openRef.current = onOpen; }, [onOpen]);
  useEffect(() => { saveRef.current = onToggleSave; }, [onToggleSave]);
  const closeCard = () => setOpenSpotKey(null);
  const pick = (id: string, spotKey: string) => { selectRef.current(id); setOpenSpotKey(spotKey); };

  useEffect(() => {
    let disposed = false;
    let map: LibreMap | undefined;
    const timeout = setTimeout(() => { if (!disposed && state === "loading") setState("fallback"); }, 9000);
    void (async () => {
      try {
        const { Map } = await import("maplibre-gl");
        if (disposed || !container.current) return;
        const start = center ?? (bounds ? [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2] as [number, number] : [-95.37, 29.76] as [number, number]);
        map = new Map({ container: container.current, style: "https://tiles.openfreemap.org/styles/positron", center: start, zoom: 11.5, attributionControl: { compact: true } });
        map.on("load", () => { if (!disposed) { clearTimeout(timeout); setState("ready"); } });
        map.on("error", (event) => { if (!disposed && !map?.loaded() && (event as { error?: { status?: number } }).error) setState("fallback"); });
        mapRef.current = map;
      } catch {
        if (!disposed) setState("fallback");
      }
    })();
    return () => { disposed = true; clearTimeout(timeout); markers.current.forEach((m) => m.remove()); markers.current = []; map?.remove(); mapRef.current = null; };
    // The map instance is created once; pins and camera update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    let cancelled = false;
    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled) return;
      markers.current.forEach((m) => m.remove());
      markers.current = spots.map((spot) => {
        // MapLibre owns positioning on the wrapper; the button's relative
        // positioning (for its pointer) must not override the marker layout.
        const anchor = document.createElement("div");
        anchor.className = "sx-map-marker";
        anchor.setAttribute("role", "presentation");
        anchor.append(pinElement(spot, selectedId, pick));
        return new Marker({ element: anchor, anchor: "bottom", offset: [0, -6], subpixelPositioning: true })
          .setLngLat([spot.lng, spot.lat]).addTo(map);
      });
    });
    return () => { cancelled = true; };
  }, [spots, selectedId, state]);

  // Address info card: a MapLibre popup anchored to the picked spot. Closing
  // the card (×, background click, or picking elsewhere) just clears the key.
  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    let cancelled = false;
    let popup: { remove: () => void } | null = null;
    const spot = openSpotKey === null ? null : spots.find((s) => s.key === openSpotKey) ?? null;
    if (spot) {
      const selected = spot.places.find((p) => p.id === selectedId) ?? spot.places[0];
      void import("maplibre-gl").then(({ Popup }) => {
        if (cancelled) return;
        // Card opens down-right of the pin; pan just enough to keep it all in view.
        const opened = new Popup({ closeButton: false, closeOnClick: false, anchor: "top-left", offset: [CARD_GAP, CARD_GAP], maxWidth: "320px" })
          .setLngLat([spot.lng, spot.lat])
          .setDOMContent(cardElement(selected, (id) => openRef.current(id), (id) => saveRef.current(id), closeCard))
          .addTo(map);
        popup = opened;
        const [dx, dy] = panToFit(opened.getElement().getBoundingClientRect(), map.getContainer().getBoundingClientRect());
        if (dx || dy) map.panBy([dx, dy]);
      });
    }
    const onBackgroundClick = () => closeCard();
    map.on("click", onBackgroundClick);
    return () => {
      cancelled = true;
      map.off("click", onBackgroundClick);
      try { popup?.remove(); } catch { /* already removed */ }
    };
  }, [openSpotKey, selectedId, spots, state]);

  const fitAll = () => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) map.easeTo({ center: [bounds[0], bounds[1]], zoom: 14 });
    else map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 80, maxZoom: 15 });
  };
  useEffect(() => { if (state === "ready") fitAll(); /* first fit only */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    const map = mapRef.current;
    const spot = spots.find((s) => s.places.some((p) => p.id === selectedId));
    if (state === "ready" && map && spot && !map.getBounds().contains([spot.lng, spot.lat])) map.easeTo({ center: [spot.lng, spot.lat] });
  }, [selectedId, spots, state]);

  return (
    <div className="sx-map" aria-label="Map of places">
      {state !== "fallback" && <div ref={container} className="sx-map-canvas" />}
      {state === "fallback" && <FallbackPlane spots={spots} selectedId={selectedId} openSpotKey={openSpotKey} onPick={pick} onOpen={(id) => openRef.current(id)} onToggleSave={(id) => saveRef.current(id)} onCloseCard={closeCard} />}
      {state === "ready" && (
        <div className="sx-map-ctrl">
          <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
          <button type="button" aria-label="Show all places" onClick={fitAll}>⤢</button>
        </div>
      )}
      <p className="sx-map-note">{state === "fallback" ? "Map tiles couldn’t load. Pins show relative positions only." : note}{missing ? ` · ${missing} without a map location` : ""}</p>
    </div>
  );
}

function FallbackPlane({ spots, selectedId, openSpotKey, onPick, onOpen, onToggleSave, onCloseCard }: {
  spots: Spot[]; selectedId: string | null; openSpotKey: string | null; onPick: (id: string, spotKey: string) => void; onOpen: (id: string) => void; onToggleSave: (id: string) => void; onCloseCard: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    node.replaceChildren();
    if (!spots.length) return;
    const lats = spots.map((s) => s.lat), lngs = spots.map((s) => s.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    for (const spot of spots) {
      const wrap = document.createElement("div");
      wrap.className = "sx-plane-pin";
      wrap.style.left = `${maxLng === minLng ? 50 : 12 + ((spot.lng - minLng) / (maxLng - minLng)) * 76}%`;
      wrap.style.top = `${maxLat === minLat ? 50 : 16 + ((maxLat - spot.lat) / (maxLat - minLat)) * 68}%`;
      wrap.append(pinElement(spot, selectedId, onPick));
      node.append(wrap);
    }
    // The address card sits above its pin in the same relative layout.
    const cardSpot = openSpotKey === null ? null : spots.find((s) => s.key === openSpotKey) ?? null;
    if (cardSpot) {
      const selected = cardSpot.places.find((p) => p.id === selectedId) ?? cardSpot.places[0];
      const card = document.createElement("div");
      card.className = "sx-plane-card";
      card.style.left = `${maxLng === minLng ? 50 : 12 + ((cardSpot.lng - minLng) / (maxLng - minLng)) * 76}%`;
      card.style.top = `${maxLat === minLat ? 50 : 16 + ((maxLat - cardSpot.lat) / (maxLat - minLat)) * 68}%`;
      card.append(cardElement(selected, onOpen, onToggleSave, onCloseCard));
      node.append(card);
    }
  }, [spots, selectedId, openSpotKey, onPick, onOpen, onToggleSave, onCloseCard]);
  return <><div className="sx-map-grid" aria-hidden="true" /><div ref={host} style={{ position: "absolute", inset: 0 }} onClick={() => onCloseCard()} /></>;
}
