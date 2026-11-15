"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FIT_ICON, FIT_LABEL, type Fit } from "./model.ts";

export type MapPlace = { id: string; name: string; subtitle: string; lat: number | null; lng: number | null; fit: Fit; price: string; saved: boolean };
type Spot = { key: string; lat: number; lng: number; places: MapPlace[] };

const FIT_ORDER: Fit[] = ["meets", "verify", "other", "fails"];
const bestFit = (places: MapPlace[]) => FIT_ORDER.find((fit) => places.some((p) => p.fit === fit)) ?? "other";

/** Group listings that share a map position so they never hide each other. */
function toSpots(places: MapPlace[]): Spot[] {
  const spots = new Map<string, Spot>();
  for (const place of places) {
    if (place.lat === null || place.lng === null) continue;
    const key = `${place.lat.toFixed(5)},${place.lng.toFixed(5)}`;
    const spot = spots.get(key) ?? { key, lat: place.lat, lng: place.lng, places: [] };
    spot.places.push(place);
    spots.set(key, spot);
  }
  return [...spots.values()];
}

function pinElement(spot: Spot, selectedId: string | null, onPick: (id: string, spotKey: string) => void): HTMLButtonElement {
  const selectedHere = spot.places.find((p) => p.id === selectedId);
  const lead = selectedHere ?? spot.places[0];
  const fit = spot.places.length > 1 ? bestFit(spot.places) : lead.fit;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `sx-pin${!selectedHere && fit === "fails" ? " sx-pin-dim" : ""}`;
  button.setAttribute("aria-pressed", String(Boolean(selectedHere)));
  const label = spot.places.length > 1
    ? `${spot.places.length} places at one address${selectedHere ? `, showing ${selectedHere.name}` : ""}`
    : `${lead.name}, ${lead.price}, ${FIT_LABEL[lead.fit]}`;
  button.setAttribute("aria-label", label);
  const dot = document.createElement("span");
  dot.className = `sx-dot sx-s-${fit}`;
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = FIT_ICON[fit];
  button.append(dot, document.createTextNode(spot.places.length > 1 && !selectedHere ? `${spot.places.length} places` : lead.price));
  if (spot.places.some((p) => p.saved)) {
    const saved = document.createElement("span");
    saved.className = "sx-pin-saved";
    saved.setAttribute("aria-hidden", "true");
    button.append(saved);
  }
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    // Clicking a shared address cycles through the places there.
    const index = selectedHere ? spot.places.indexOf(selectedHere) : -1;
    onPick(spot.places[(index + 1) % spot.places.length].id, spot.key);
  });
  return button;
}

/** Simple address info card shown next to the clicked pin (DOM for the popup). */
function cardElement(spot: Spot, selectedId: string | null, onDetails: (id: string) => void, onClose: () => void): HTMLElement {
  const selected = spot.places.find((p) => p.id === selectedId) ?? spot.places[0];
  const card = document.createElement("div");
  card.className = "sx-map-card";
  // Clicks inside the card never close it via a background/plane handler.
  card.addEventListener("click", (event) => event.stopPropagation());
  const close = document.createElement("button");
  close.type = "button";
  close.className = "sx-map-card-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", () => onClose());
  card.append(close);
  const name = document.createElement("span");
  name.className = "sx-map-card-name";
  name.textContent = selected.name;
  const sub = document.createElement("span");
  sub.className = "sx-map-card-sub";
  sub.textContent = selected.subtitle;
  const row = document.createElement("span");
  row.className = "sx-map-card-row";
  const dot = document.createElement("span");
  dot.className = `sx-dot sx-s-${selected.fit}`;
  dot.setAttribute("aria-hidden", "true");
  dot.textContent = FIT_ICON[selected.fit];
  const fit = document.createElement("span");
  fit.textContent = FIT_LABEL[selected.fit];
  const price = document.createElement("span");
  price.textContent = selected.price;
  row.append(dot, fit, price);
  card.append(name, sub, row);
  if (spot.places.length > 1) {
    const more = document.createElement("span");
    more.className = "sx-map-card-more";
    more.textContent = `${spot.places.length - 1} more ${spot.places.length - 1 === 1 ? "place" : "places"} at one address — tap the pin to switch.`;
    card.append(more);
  }
  const details = document.createElement("button");
  details.type = "button";
  details.className = "sx-map-card-btn";
  details.setAttribute("aria-label", `Open details for ${selected.name}`);
  details.textContent = "See details ›";
  details.addEventListener("click", () => onDetails(selected.id));
  card.append(details);
  return card;
}

export function PlacesMap({ places, selectedId, onSelect, onOpen, center, note }: {
  places: MapPlace[]; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; center: [number, number] | null; note: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const selectRef = useRef(onSelect);
  const openRef = useRef(onOpen);
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
      markers.current = spots.map((spot) => new Marker({ element: pinElement(spot, selectedId, pick), anchor: "bottom", offset: [0, -6] }).setLngLat([spot.lng, spot.lat]).addTo(map));
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
      void import("maplibre-gl").then(({ Popup }) => {
        if (cancelled) return;
        popup = new Popup({ closeButton: false, closeOnClick: false, offset: 44, maxWidth: "300px" })
          .setLngLat([spot.lng, spot.lat])
          .setDOMContent(cardElement(spot, selectedId, (id) => openRef.current(id), closeCard))
          .addTo(map);
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
      {state === "fallback" && <FallbackPlane spots={spots} selectedId={selectedId} openSpotKey={openSpotKey} onPick={pick} onOpen={(id) => openRef.current(id)} onCloseCard={closeCard} />}
      {state === "ready" && (
        <div className="sx-map-ctrl">
          <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
          <button type="button" aria-label="Show all places" onClick={fitAll}>⤢</button>
        </div>
      )}
      <div className="sx-map-legend" aria-label="Map legend">
        {(["meets", "verify", "fails"] as const).map((fit) => <span key={fit}><span className={`sx-dot sx-s-${fit}`} aria-hidden="true">{FIT_ICON[fit]}</span>{FIT_LABEL[fit]}</span>)}
      </div>
      <p className="sx-map-note">{state === "fallback" ? "Map tiles couldn’t load. Pins show relative positions only." : note}{missing ? ` · ${missing} without a map location` : ""}</p>
    </div>
  );
}

function FallbackPlane({ spots, selectedId, openSpotKey, onPick, onOpen, onCloseCard }: {
  spots: Spot[]; selectedId: string | null; openSpotKey: string | null; onPick: (id: string, spotKey: string) => void; onOpen: (id: string) => void; onCloseCard: () => void;
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
      const card = document.createElement("div");
      card.className = "sx-plane-card";
      card.style.left = `${maxLng === minLng ? 50 : 12 + ((cardSpot.lng - minLng) / (maxLng - minLng)) * 76}%`;
      card.style.top = `${maxLat === minLat ? 50 : 16 + ((maxLat - cardSpot.lat) / (maxLat - minLat)) * 68}%`;
      card.append(cardElement(cardSpot, selectedId, onOpen, onCloseCard));
      node.append(card);
    }
  }, [spots, selectedId, openSpotKey, onPick, onOpen, onCloseCard]);
  return <><div className="sx-map-grid" aria-hidden="true" /><div ref={host} style={{ position: "absolute", inset: 0 }} onClick={() => onCloseCard()} /></>;
}
