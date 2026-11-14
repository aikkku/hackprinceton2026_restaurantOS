"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cellToBoundary } from "h3-js";
import type { FeatureCollection, Polygon } from "geojson";
import type { Map as LibreMap, GeoJSONSource } from "maplibre-gl";
import { Expand, RotateCcw } from "lucide-react";
import { scoreArea } from "../../../domain/scoring.ts";
import type {
  Dataset,
  ExpansionProperty,
  Weights,
} from "../../../domain/schemas.ts";
import type { Viewport } from "../../data/local-market.ts";

export type Selection =
  { kind: "area"; id: string } | { kind: "property"; id: string };
type Props = {
  dataset: Dataset;
  cityId: string;
  properties: ExpansionProperty[];
  weights: Weights;
  budget: number;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onViewportChange?: (bounds: Viewport) => void;
};

function palette(element: Element) {
  const style = getComputedStyle(element);
  return ["high", "mid", "low", "unavailable"].map((key) =>
    style.getPropertyValue(`--ros-score-${key}`).trim(),
  );
}

export function ScoutMap({
  dataset,
  cityId,
  properties,
  weights,
  budget,
  selection,
  onSelect,
  onViewportChange,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LibreMap | null>(null);
  const selectRef = useRef(onSelect);
  const viewportRef = useRef(onViewportChange);
  useEffect(() => {
    selectRef.current = onSelect;
    viewportRef.current = onViewportChange;
  }, [onSelect, onViewportChange]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const city = dataset.cities.find((c) => c.id === cityId)!;
  const areas = useMemo(
    () => dataset.areas.filter((a) => a.cityId === cityId),
    [dataset, cityId],
  );
  const features = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: areas.map((area) => {
        const boundary = cellToBoundary(area.h3Index, true);
        const result = scoreArea(area, weights, budget);
        return {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [[...boundary, boundary[0]]],
          },
          properties: {
            id: area.h3Index,
            score: result.score,
            coverage: result.coverage,
            label:
              result.score === null ? "—" : String(Math.round(result.score)),
            selected:
              selection.kind === "area"
                ? selection.id === area.h3Index
                : properties.find((p) => p.id === selection.id)
                    ?.h3Index === area.h3Index,
          },
        };
      }),
    }),
    [areas, weights, budget, selection, properties],
  );
  const latest = useRef({ features, properties, selection });
  useEffect(() => {
    latest.current = { features, properties, selection };
  }, [features, properties, selection]);

  useEffect(() => {
    let disposed = false;
    let map: LibreMap | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const fail = () => {
      if (!disposed) {
        clearTimeout(timer);
        setState("failed");
      }
    };
    async function initialize() {
      try {
        const { Map, NavigationControl, ScaleControl } =
          await import("maplibre-gl");
        if (disposed || !container.current) return;
        setState("loading");
        map = new Map({
          container: container.current,
          style: "https://tiles.openfreemap.org/styles/positron",
          center: city.center,
          zoom: 13,
          minZoom: 11,
          maxZoom: 17,
          maxBounds: [
            [city.bounds[0], city.bounds[1]],
            [city.bounds[2], city.bounds[3]],
          ],
          pitch: 0,
          dragRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.addControl(
          new NavigationControl({ showCompass: false }),
          "bottom-right",
        );
        map.addControl(new ScaleControl({ unit: "imperial" }), "bottom-left");
        timer = setTimeout(fail, 15000);
        map.on("error", fail);
        map.on("load", () => {
          if (disposed || !map) return;
          clearTimeout(timer);
          const host = container.current!.closest(".expansion-app")!;
          const [high, mid, low, unavailable] = palette(host);
          const tokens = getComputedStyle(host);
          const forest = tokens.getPropertyValue("--ros-forest").trim();
          const surface = tokens.getPropertyValue("--ros-surface").trim();
          map.addSource("areas", {
            type: "geojson",
            data: latest.current.features,
          });
          map.addLayer({
            id: "area-fills",
            type: "fill",
            source: "areas",
            paint: {
              "fill-color": [
                "case",
                ["==", ["get", "score"], null],
                unavailable,
                ["step", ["get", "score"], low, 40, mid, 70, high],
              ],
              "fill-opacity": [
                "case",
                ["<", ["get", "coverage"], 1],
                0.28,
                0.45,
              ],
            },
          });
          map.addLayer({
            id: "area-outlines",
            type: "line",
            source: "areas",
            paint: {
              "line-color": ["case", ["get", "selected"], forest, surface],
              "line-width": ["case", ["get", "selected"], 3, 1.4],
            },
          });
          map.addSource("properties", {
            type: "geojson",
            data: propertyFeatures(
              latest.current.properties,
              latest.current.selection,
            ),
          });
          map.addLayer({
            id: "property-pins",
            type: "circle",
            source: "properties",
            paint: {
              "circle-radius": ["case", ["get", "selected"], 12, 9],
              "circle-color": forest,
              "circle-stroke-color": surface,
              "circle-stroke-width": 3,
            },
          });
          map.addLayer({
            id: "property-numbers",
            type: "symbol",
            source: "properties",
            layout: {
              "text-field": ["get", "number"],
              "text-size": 10,
              "text-font": ["Noto Sans Regular"],
              "text-allow-overlap": true,
            },
            paint: { "text-color": surface },
          });
          map.on("click", (event) => {
            if (!map) return;
            const pin = map.queryRenderedFeatures(event.point, {
              layers: ["property-pins"],
            })[0];
            if (pin?.properties?.id) {
              selectRef.current({
                kind: "property",
                id: String(pin.properties.id),
              });
              return;
            }
            const area = map.queryRenderedFeatures(event.point, {
              layers: ["area-fills"],
            })[0];
            if (area?.properties?.id)
              selectRef.current({
                kind: "area",
                id: String(area.properties.id),
              });
          });
          map.on("mousemove", (event) => {
            if (map)
              map.getCanvas().style.cursor = map.queryRenderedFeatures(
                event.point,
                { layers: ["property-pins", "area-fills"] },
              ).length
                ? "pointer"
                : "";
          });
          const queryViewport = () => {
            if (!map || disposed || !viewportRef.current) return;
            const bounds = map.getBounds();
            const next: Viewport = [Math.max(city.bounds[0], bounds.getWest()), Math.max(city.bounds[1], bounds.getSouth()), Math.min(city.bounds[2], bounds.getEast()), Math.min(city.bounds[3], bounds.getNorth())];
            if (next[0] < next[2] && next[1] < next[3]) viewportRef.current(next);
          };
          map.on("moveend", queryViewport);
          queryViewport();
          setState("ready");
        });
      } catch {
        fail();
      }
    }
    void initialize();
    return () => {
      disposed = true;
      clearTimeout(timer);
      mapRef.current = null;
      map?.remove();
    };
  }, [city, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (state !== "ready" || !map) return;
    (map.getSource("areas") as GeoJSONSource | undefined)?.setData(features);
    (map.getSource("properties") as GeoJSONSource | undefined)?.setData(
      propertyFeatures(properties, selection),
    );
  }, [features, properties, selection, state]);

  // Geographic preview survives failed tiles/WebGL and is explicitly not a street map.
  const boundaries = areas.map((a) => cellToBoundary(a.h3Index, true));
  const xs = boundaries.flat().map((p) => p[0]);
  const ys = boundaries.flat().map((p) => p[1]);
  const west = xs.length ? Math.min(...xs) - 0.003 : city.bounds[0];
  const east = xs.length ? Math.max(...xs) + 0.003 : city.bounds[2];
  const south = ys.length ? Math.min(...ys) - 0.003 : city.bounds[1];
  const north = ys.length ? Math.max(...ys) + 0.003 : city.bounds[3];
  const project = (lng: number, lat: number) => [
    ((lng - west) / (east - west)) * 800,
    ((north - lat) / (north - south)) * 600,
  ];

  return (
    <div className="scout-map" aria-label={`${city.name} geographic scouting map`}>
      <div
        className="map-canvas"
        ref={container}
        style={{ visibility: state === "ready" ? "visible" : "hidden" }}
      />
      {state !== "ready" && (
        <div className="map-preview">
          <svg
            viewBox="0 0 800 600"
            aria-label="Geographic preview of H3 areas; use the area and property lists for keyboard selection"
            role="img"
          >
            {areas.map((area, i) => {
              const result = scoreArea(area, weights, budget);
              const selected =
                selection.kind === "area" && selection.id === area.h3Index;
              const points = boundaries[i]
                .map((p) => project(p[0], p[1]).join(","))
                .join(" ");
              return (
                <polygon
                  key={area.h3Index}
                  points={points}
                  onClick={() => onSelect({ kind: "area", id: area.h3Index })}
                  style={{
                    fill: `var(--ros-score-${result.score === null ? "unavailable" : result.score >= 70 ? "high" : result.score >= 40 ? "mid" : "low"})`,
                  }}
                  className={
                    selected ? "preview-cell selected" : "preview-cell"
                  }
                >
                  <title>
                    {area.label} ·{" "}
                    {result.score === null
                      ? "Insufficient data"
                      : Math.round(result.score)}
                  </title>
                </polygon>
              );
            })}
            {properties.map((p, i) => {
              const [x, y] = project(p.longitude, p.latitude);
              return (
                <g
                  key={p.id}
                  onClick={() => onSelect({ kind: "property", id: p.id })}
                  className="preview-pin"
                >
                  <circle cx={x} cy={y} r={selection.id === p.id ? 16 : 13} />
                  <text x={x} y={y + 4} textAnchor="middle">
                    {i + 1}
                  </text>
                  <title>{p.name} · {p.isDemo ? "fictional property" : "local dataset record"}</title>
                </g>
              );
            })}
          </svg>
          <div className="map-notice" role="status">
            {state === "loading" ? (
              "Loading street map… Geographic preview shown."
            ) : (
              <>
                Street map unavailable. Geographic preview only.{" "}
                <button
                  className="text-button"
                  onClick={() => setAttempt((a) => a + 1)}
                >
                  Retry map
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <div className="map-topline">
        <span className="map-tag">
          <span className="status-dot" /> {city.name.toUpperCase()} · H3 / 08
        </span>
        <span className="map-tag">{city.isDemo ? "Fictional data" : "Local snapshot · unscored"}</span>
      </div>
      {state === "ready" && (
        <button
          className="map-recenter"
          title="Recenter map"
          aria-label="Recenter map"
          onClick={() =>
            mapRef.current?.jumpTo({ center: city.center, zoom: 13 })
          }
        >
          <Expand size={17} />
        </button>
      )}
      <div className="map-caption">
        <RotateCcw size={13} /> Explore freely. Every decision is reversible.
      </div>
    </div>
  );
}

function propertyFeatures(
  properties: ExpansionProperty[],
  selection: Selection,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: properties.map((p, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.longitude, p.latitude] },
      properties: {
        id: p.id,
        number: String(i + 1),
        selected: selection.kind === "property" && selection.id === p.id,
      },
    })),
  };
}
