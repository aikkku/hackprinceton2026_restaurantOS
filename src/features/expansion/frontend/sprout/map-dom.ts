"use client";

import { FIT_ICON, FIT_LABEL, type Fit } from "./model.ts";
import { propertyScoreLabel, type PropertyScore } from "../../domain/property-score.ts";

/** DOM builders shared by the Google map and the MapLibre fallback. */
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
/** Gap between the pin point and the card's top-left corner (card opens down-right). */
export const CARD_GAP = 10;
/** Space kept clear inside the map: top, right, bottom (legend), left. */
const CARD_MARGIN = { top: 16, right: 16, bottom: 64, left: 16 };

/**
 * Pixels to pan the map so `card` sits fully inside `frame`, as [dx, dy] for
 * panBy (positive moves the view right/down). [0, 0] when it already fits.
 */
export function panToFit(card: DOMRect, frame: DOMRect): [number, number] {
  const axis = (lo: number, hi: number, min: number, max: number) =>
    hi - lo > max - min ? lo - min : lo < min ? lo - min : hi > max ? hi - max : 0;
  return [
    axis(card.left, card.right, frame.left + CARD_MARGIN.left, frame.right - CARD_MARGIN.right),
    axis(card.top, card.bottom, frame.top + CARD_MARGIN.top, frame.bottom - CARD_MARGIN.bottom),
  ];
}

export type Spot = { key: string; lat: number; lng: number; places: MapPlace[] };

/** Group listings that share a map position so they never hide each other. */
export function toSpots(places: MapPlace[]): Spot[] {
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

export function pinElement(spot: Spot, selectedId: string | null, onPick: (id: string, spotKey: string) => void): HTMLButtonElement {
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
export function cardElement(place: MapPlace, onDetails: (id: string) => void, onToggleSave: (id: string) => void, onClose: () => void): HTMLElement {
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
