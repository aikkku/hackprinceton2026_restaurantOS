"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as LibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FIT_ICON, FIT_LABEL, type Fit } from "./model.ts";
import { propertyScoreLabel, type PropertyScore } from "../../domain/property-score.ts";

export type MapPlace = {
  id: string; name: string; location: string; address: string;
  lat: number | null; lng: number | null; fit: Fit;
  score?: PropertyScore;
  /** Short label inside the pin. */
  price: string;
  /** Full price line for the card, e.g. "$4,875/mo" or "≈ $2.3k–3.4k/mo + building charges". */
  priceLabel: string;
  /** "1,500 sq ft" or "1,200–2,000 sq ft"; empty when unknown. */
  size: string;
  /** First still-open check question, shown as a soft banner. */
  question: string | null;
  image: string | null;
  saved: boolean;
};
type Spot = { key: string; lat: number; lng: number; places: MapPlace[] };

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
  const lead = selectedHere ?? spot.places.reduce((best, p) => (p.score?.score ?? -1) > (best.score?.score ?? -1) ? p : best);
  const score = lead.score ? propertyScoreLabel(lead.score) : "Not scored";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sx-pin sx-score-pin";
  button.dataset.tone = lead.score?.score === null || !lead.score ? "unknown" : lead.score.score >= 8 ? "good" : lead.score.score >= 6 ? "mixed" : "low";
  button.setAttribute("aria-pressed", String(Boolean(selectedHere)));
  const label = spot.places.length > 1
    ? `${spot.places.length} places at one address, ${selectedHere ? "selected" : "best"} fit score ${score}, ${lead.name}`
    : `${lead.name}, fit score ${score}`;
  button.setAttribute("aria-label", label);
  button.title = `${label}. ${lead.score?.includedCount ?? 0} of ${lead.score?.activeCount ?? 0} applicable factors included. Click to inspect${spot.places.length > 1 ? " or cycle through spaces" : ""}.`;
  button.append(document.createTextNode(lead.score?.score !== null && lead.score?.score !== undefined ? lead.score.score.toFixed(1) : "—"));
  if (spot.places.length > 1) {
    const count = document.createElement("small");
    count.className = "sx-pin-count";
    count.textContent = `×${spot.places.length}`;
    button.append(count);
  }
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
    onPick(selectedHere ? spot.places[(index + 1) % spot.places.length].id : lead.id, spot.key);
  });
  return button;
}

/** Simple address card shown next to the clicked pin (DOM for the popup). */
function cardElement(place: MapPlace, onDetails: (id: string) => void, onToggleSave: (id: string) => void, onClose: () => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "sx-map-card";
  // Clicks inside the card never close it via a background/plane handler.
  card.addEventListener("click", (event) => event.stopPropagation());

  // Photo header: the aerial photo we have (if any), else a labeled neutral block.
  const photo = document.createElement("div");
  photo.className = "sx-map-card-photo";
  if (place.image) {
    const img = document.createElement("img");
    img.src = place.image;
    img.alt = `Aerial view around ${place.name}`;
    photo.append(img);
  } else {
    const none = document.createElement("span");
    none.className = "sx-map-card-photo-empty";
    none.textContent = "No aerial photo yet";
    photo.append(none);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "sx-map-card-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";
  close.addEventListener("click", () => onClose());
  photo.append(close);
  card.append(photo);

  const body = document.createElement("div");
  body.className = "sx-map-card-body";
  const eyebrow = document.createElement("span");
  eyebrow.className = "sx-map-card-eyebrow";
  eyebrow.textContent = place.location;
  const name = document.createElement("span");
  name.className = "sx-map-card-name";
  name.textContent = place.name;
  const address = document.createElement("span");
  address.className = "sx-map-card-address";
  address.textContent = place.address;
  const pill = document.createElement("span");
  pill.className = `sx-pill sx-s-${place.fit}`;
  const pillIcon = document.createElement("span");
  pillIcon.className = "sx-pill-icon";
  pillIcon.setAttribute("aria-hidden", "true");
  pillIcon.textContent = FIT_ICON[place.fit];
  pill.append(pillIcon, document.createTextNode(FIT_LABEL[place.fit]));
  const price = document.createElement("span");
  price.className = "sx-map-card-price";
  price.textContent = place.size ? `${place.priceLabel} · ${place.size}` : place.priceLabel;
  body.append(eyebrow, name, address);
  if (place.fit !== "verify") body.append(pill);
  body.append(price);
  const scoreLine = document.createElement("span");
  scoreLine.className = "sx-score";
  scoreLine.textContent = `Fit score ${place.score ? propertyScoreLabel(place.score) : "Not scored"} · ${place.score?.includedCount ?? 0}/${place.score?.activeCount ?? 0} factors`;
  body.append(scoreLine);
  if (place.question) {
    const question = document.createElement("span");
    question.className = "sx-map-card-question";
    question.textContent = place.question;
    body.append(question);
  }

  const actions = document.createElement("span");
  actions.className = "sx-map-card-actions";
  const inspect = document.createElement("button");
  inspect.type = "button";
  inspect.className = "sx-btn sx-btn-primary sx-map-card-inspect";
  inspect.textContent = "Inspect space";
  inspect.addEventListener("click", () => onDetails(place.id));
  const save = document.createElement("button");
  save.type = "button";
  save.className = `sx-btn sx-map-card-save${place.saved ? " sx-map-card-save-on" : ""}`;
  save.setAttribute("aria-pressed", String(place.saved));
  save.setAttribute("aria-label", place.saved ? `Remove ${place.name} from saved` : `Save ${place.name}`);
  const bookmark = document.createElement("span");
  bookmark.className = "sx-map-card-bookmark";
  bookmark.setAttribute("aria-hidden", "true");
  save.append(bookmark, document.createTextNode(place.saved ? "Saved" : "Save"));
  save.addEventListener("click", () => onToggleSave(place.id));
  actions.append(inspect, save);
  body.append(actions);
  card.append(body);
  return card;
}

export function PlacesMap({ places, selectedId, onSelect, onOpen, onToggleSave, center, note }: {
  places: MapPlace[]; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; onToggleSave: (id: string) => void; center: [number, number] | null; note: string;
}) {
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
      const selected = spot.places.find((p) => p.id === selectedId) ?? spot.places[0];
      void import("maplibre-gl").then(({ Popup }) => {
        if (cancelled) return;
        popup = new Popup({ closeButton: false, closeOnClick: false, offset: 46, maxWidth: "320px" })
          .setLngLat([spot.lng, spot.lat])
          .setDOMContent(cardElement(selected, (id) => openRef.current(id), (id) => saveRef.current(id), closeCard))
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
      {state === "fallback" && <FallbackPlane spots={spots} selectedId={selectedId} openSpotKey={openSpotKey} onPick={pick} onOpen={(id) => openRef.current(id)} onToggleSave={(id) => saveRef.current(id)} onCloseCard={closeCard} />}
      {state === "ready" && (
        <div className="sx-map-ctrl">
          <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
          <button type="button" aria-label="Show all places" onClick={fitAll}>⤢</button>
        </div>
      )}
      <div className="sx-map-legend" aria-label="Map legend">
        <span>Fit score 1–10 · higher is better</span><span>×N = spaces at this address · best score shown</span>
      </div>
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
