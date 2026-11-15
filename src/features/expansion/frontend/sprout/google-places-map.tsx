"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NearbyRestaurant, NearbyRestaurantsResult } from "../../domain/nearby-restaurants.ts";
import { loadNearbyRestaurants } from "../data/investigation-client.ts";
import { loadGoogleMaps, onMapsAuthFailure, type GCircle, type GInfoWindow, type GMap, type GMarker, type MapsApi } from "./google-maps-loader.ts";
import { cardElement, pinElement, toSpots } from "./map-dom.ts";
import type { PlacesMapProps } from "./places-map.tsx";

const meters = (m: number) => m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;

function restaurantPin(r: NearbyRestaurant, onPick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sx-rest-pin";
  const label = `${r.name}, ${r.typeLabel}, ${meters(r.distanceMeters)} away (Google)`;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.addEventListener("click", (event) => { event.stopPropagation(); onPick(); });
  return button;
}

function restaurantCard(r: NearbyRestaurant): HTMLElement {
  const body = document.createElement("div");
  body.className = "sx-rest-card";
  const meta = document.createElement("span");
  meta.textContent = `${r.typeLabel} · ${meters(r.distanceMeters)} from the selected place`;
  const link = document.createElement("a");
  link.href = r.googleMapsUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = "Open in Google Maps";
  body.append(meta, link);
  return body;
}

/**
 * Listings plus, for the selected listing, live Google Places restaurants.
 * Restaurant data stay in memory for the current selection only.
 */
export function GooglePlacesMap({ places, selectedId, onSelect, onOpen, onToggleSave, note, runId, cuisine, browserKey, mapId, onFail }: PlacesMapProps & { browserKey: string; mapId: string; onFail: (reason: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const apiRef = useRef<MapsApi | null>(null);
  const mapRef = useRef<GMap | null>(null);
  const infoRef = useRef<GInfoWindow | null>(null);
  const lastPick = useRef(0);
  const selectRef = useRef(onSelect);
  const openRef = useRef(onOpen);
  const saveRef = useRef(onToggleSave);
  const failRef = useRef(onFail);
  const [ready, setReady] = useState(false);
  const [openSpotKey, setOpenSpotKey] = useState<string | null>(null);
  const [showNearby, setShowNearby] = useState(true);
  const [nearby, setNearby] = useState<{ id: string; result: NearbyRestaurantsResult | null; error: string } | null>(null);
  const spots = useMemo(() => toSpots(places), [places]);
  const selectedSpot = spots.find((s) => s.places.some((p) => p.id === selectedId)) ?? null;
  const missing = places.filter((p) => p.lat === null || p.lng === null).length;
  useEffect(() => { selectRef.current = onSelect; openRef.current = onOpen; saveRef.current = onToggleSave; failRef.current = onFail; }, [onSelect, onOpen, onToggleSave, onFail]);
  const closeCard = () => setOpenSpotKey(null);
  const pick = (id: string, spotKey: string) => { lastPick.current = Date.now(); selectRef.current(id); setOpenSpotKey(spotKey); };

  useEffect(() => {
    let disposed = false;
    const fail = (reason: string) => { if (!disposed) failRef.current(reason); };
    const offAuth = onMapsAuthFailure(() => fail("Google Maps rejected the browser key"));
    const timeout = setTimeout(() => { if (!mapRef.current) fail("Google Maps took too long to load"); }, 12_000);
    loadGoogleMaps(browserKey).then((api) => {
      if (disposed || !container.current) return;
      clearTimeout(timeout);
      apiRef.current = api;
      const map = new api.Map(container.current, {
        center: { lat: 29.76, lng: -95.37 }, zoom: 11.5, mapId,
        disableDefaultUI: true, clickableIcons: false, gestureHandling: "greedy",
      });
      // Pins/cards stop DOM propagation, but Google may still emit a map click.
      map.addListener("click", () => { if (Date.now() - lastPick.current > 300) closeCard(); });
      mapRef.current = map;
      setReady(true);
    }).catch(() => fail("Google Maps could not load"));
    return () => { disposed = true; offAuth(); clearTimeout(timeout); mapRef.current = null; };
  }, [browserKey, mapId]);

  // Listing pins.
  useEffect(() => {
    const api = apiRef.current, map = mapRef.current;
    if (!ready || !api || !map) return;
    const markers: GMarker[] = spots.map((spot) => new api.AdvancedMarkerElement({
      map, position: { lat: spot.lat, lng: spot.lng }, content: pinElement(spot, selectedId, pick),
      zIndex: spot.places.some((p) => p.id === selectedId) ? 1000 : undefined,
    }));
    return () => markers.forEach((m) => { m.map = null; });
  }, [spots, selectedId, ready]);

  // Address card above the picked pin (same DOM as the MapLibre popup).
  useEffect(() => {
    const api = apiRef.current, map = mapRef.current;
    const spot = openSpotKey === null ? null : spots.find((s) => s.key === openSpotKey) ?? null;
    if (!ready || !api || !map || !spot) return;
    const wrap = document.createElement("div");
    wrap.className = "sx-gmap-card";
    wrap.append(cardElement(spot.places.find((p) => p.id === selectedId) ?? spot.places[0], (id) => openRef.current(id), (id) => saveRef.current(id), closeCard));
    const marker = new api.AdvancedMarkerElement({ map, position: { lat: spot.lat, lng: spot.lng }, content: wrap, zIndex: 3000 });
    return () => { marker.map = null; };
  }, [openSpotKey, selectedId, spots, ready]);

  // Live nearby restaurants for the selected listing (one request per selection).
  useEffect(() => {
    if (!showNearby || !selectedId || !selectedSpot) return;
    const controller = new AbortController();
    loadNearbyRestaurants(runId, selectedId, cuisine, controller.signal)
      .then((result) => setNearby({ id: selectedId, result, error: "" }))
      .catch((error: unknown) => { if (!controller.signal.aborted) setNearby({ id: selectedId, result: null, error: error instanceof Error ? error.message : "Nearby restaurants could not load." }); });
    return () => controller.abort();
  }, [showNearby, selectedId, selectedSpot, runId, cuisine]);
  const current = showNearby && nearby && nearby.id === selectedId ? nearby : null;
  const restaurants = current?.result?.status === "ok" ? current.result.restaurants : [];

  useEffect(() => {
    const api = apiRef.current, map = mapRef.current;
    if (!ready || !api || !map || !selectedSpot || !current || current.result?.status !== "ok") return;
    const circle: GCircle = new api.Circle({
      map, center: { lat: selectedSpot.lat, lng: selectedSpot.lng }, radius: current.result.source.radiusMeters, clickable: false,
      strokeColor: "#1F3D2B", strokeOpacity: 0.55, strokeWeight: 1.5, fillColor: "#1F3D2B", fillOpacity: 0.05,
    });
    const info = infoRef.current ?? (infoRef.current = new api.InfoWindow({ maxWidth: 260 }));
    const markers = current.result.restaurants.map((r) => {
      const marker = new api.AdvancedMarkerElement({ map, position: { lat: r.latitude, lng: r.longitude }, title: r.name, zIndex: 500,
        content: restaurantPin(r, () => {
          lastPick.current = Date.now();
          info.setHeaderContent(r.name);
          info.setContent(restaurantCard(r));
          info.open({ map, anchor: marker });
        }) });
      return marker;
    });
    return () => { circle.setMap(null); markers.forEach((m) => { m.map = null; }); info.close(); };
  }, [current, selectedSpot, ready]);

  const fitAll = () => {
    const api = apiRef.current, map = mapRef.current;
    if (!api || !map || !spots.length) return;
    if (spots.length === 1) { map.setCenter({ lat: spots[0].lat, lng: spots[0].lng }); map.setZoom(14); return; }
    const bounds = new api.LatLngBounds();
    spots.forEach((s) => bounds.extend({ lat: s.lat, lng: s.lng }));
    map.fitBounds(bounds, 80);
    const once = map.addListener("idle", () => { once.remove(); if ((map.getZoom() ?? 0) > 15) map.setZoom(15); });
  };
  useEffect(() => { if (ready) fitAll(); /* first fit only */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  useEffect(() => {
    const map = mapRef.current;
    if (ready && map && selectedSpot && !map.getBounds()?.contains({ lat: selectedSpot.lat, lng: selectedSpot.lng })) map.panTo({ lat: selectedSpot.lat, lng: selectedSpot.lng });
  }, [selectedSpot, ready]);

  const status = !showNearby ? "Nearby restaurants hidden"
    : !selectedSpot ? "Select a place to see restaurants within 500 m"
    : !current ? "Finding nearby restaurants…"
    : current.error ? current.error
    : current.result?.status !== "ok" ? current.result?.message ?? "Nearby restaurants unavailable"
    : restaurants.length ? `${restaurants.length} nearest restaurants within 500 m${current.result.summary?.capReached ? " (Google’s limit, more may exist)" : ""}`
    : "Google returned no restaurants within 500 m";

  return (
    <div className="sx-map" aria-label="Map of places">
      <div ref={container} className="sx-map-canvas" />
      {ready && (
        <div className="sx-map-ctrl">
          <button type="button" aria-label="Zoom in" onClick={() => { const m = mapRef.current; if (m) m.setZoom((m.getZoom() ?? 12) + 1); }}>+</button>
          <button type="button" aria-label="Zoom out" onClick={() => { const m = mapRef.current; if (m) m.setZoom((m.getZoom() ?? 12) - 1); }}>−</button>
          <button type="button" aria-label="Show all places" onClick={fitAll}>⤢</button>
        </div>
      )}
      <div className="sx-map-nearby" role="status" aria-live="polite">
        <span>{status}</span>
        <button type="button" className="sx-btn-text" aria-pressed={showNearby} onClick={() => setShowNearby((v) => !v)}>{showNearby ? "Hide" : "Show restaurants"}</button>
      </div>
      <div className="sx-map-legend" aria-label="Map legend">
        <span>Fit score 1–10 · higher is better</span><span>×N = spaces at this address</span>
        {restaurants.length > 0 && <span><i className="sx-rest-pin sx-rest-pin-key" aria-hidden="true" /> Restaurant (Google) · up to 20</span>}
      </div>
      <p className="sx-map-note">{note}{missing ? ` · ${missing} without a map location` : ""}</p>
    </div>
  );
}
