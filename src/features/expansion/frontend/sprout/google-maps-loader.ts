"use client";

/**
 * Minimal Google Maps JavaScript API loader (no extra dependency). Only the
 * members this app uses are typed.
 */
export type LatLng = { lat: number; lng: number };
export type Listener = { remove(): void };
export type GMap = {
  panTo(c: LatLng): void; setCenter(c: LatLng): void;
  getZoom(): number | undefined; setZoom(z: number): void;
  fitBounds(b: GBounds, padding?: number): void;
  getBounds(): { contains(c: LatLng): boolean } | undefined | null;
  addListener(event: string, fn: () => void): Listener;
};
export type GBounds = { extend(c: LatLng): void };
export type GMarker = { map: GMap | null; addListener(event: string, fn: () => void): Listener };
export type GCircle = { setMap(m: GMap | null): void };
export type GInfoWindow = { open(o: { map: GMap; anchor?: GMarker }): void; close(): void; setContent(c: HTMLElement): void; setHeaderContent(c: HTMLElement | string): void };
export type MapsApi = {
  Map: new (el: HTMLElement, o: Record<string, unknown>) => GMap;
  Circle: new (o: Record<string, unknown>) => GCircle;
  InfoWindow: new (o?: Record<string, unknown>) => GInfoWindow;
  AdvancedMarkerElement: new (o: { map: GMap; position: LatLng; content: HTMLElement; zIndex?: number; title?: string }) => GMarker;
  LatLngBounds: new () => GBounds;
};

type Importer = { maps: { importLibrary(name: string): Promise<Record<string, unknown>> } };
const CALLBACK = "__sxGoogleMapsReady";
let loading: Promise<MapsApi> | null = null;
const authListeners = new Set<() => void>();
let authFailed = false;

/** Google calls `gm_authFailure` for invalid/unauthorized keys or disabled APIs. */
export function onMapsAuthFailure(fn: () => void): () => void {
  if (authFailed) queueMicrotask(fn);
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export function loadGoogleMaps(key: string): Promise<MapsApi> {
  if (loading) return loading;
  loading = new Promise<MapsApi>((resolve, reject) => {
    const w = window as unknown as Record<string, unknown> & { google?: Importer };
    w.gm_authFailure = () => { authFailed = true; authListeners.forEach(fn => fn()); };
    w[CALLBACK] = async () => {
      try {
        const g = w.google!.maps;
        const [maps, marker, core] = await Promise.all([g.importLibrary("maps"), g.importLibrary("marker"), g.importLibrary("core")]);
        resolve({ Map: maps.Map, Circle: maps.Circle, InfoWindow: maps.InfoWindow, AdvancedMarkerElement: marker.AdvancedMarkerElement, LatLngBounds: core.LatLngBounds } as MapsApi);
      } catch (error) { reject(error); }
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({ key, v: "weekly", loading: "async", callback: CALLBACK, libraries: "maps,marker" })}`;
    script.async = true;
    script.onerror = () => { loading = null; script.remove(); reject(new Error("Google Maps script failed to load.")); };
    document.head.append(script);
  });
  return loading;
}
