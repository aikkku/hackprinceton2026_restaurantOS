# Nearby restaurants (Google Places)

The place detail page shows **up to 20 nearby restaurants** from Google Places API (New) Nearby Search. This is not a complete competitor census. Census remains the source for residents and income, and the OpenStreetMap count remains a separate, labeled card.

## Request
- `POST places:searchNearby`, `includedTypes: ["restaurant"]`, 500 m circle around the listing's sourced coordinates, `rankPreference: DISTANCE`, `maxResultCount: 20`.
- Field mask: `id, displayName, location, formattedAddress, types, primaryType, googleMapsUri`. These fields bill as Nearby Search Pro.
- Server key: `GOOGLE_PLACES_API_KEY`, or `GOOGLE_MAPS_API_KEY` if that's unset. Restrict it to Places API (New). It never reaches the browser.
- Calls are gated by `EXPANSION_SOURCE_NETWORK=1`. Synthetic listings and listings without coordinates never call Google.

## What is calculated (deterministic, `domain/nearby-restaurants.ts`)
- Straight-line distance from the listing, sorting, nearest and median distance, counts per Google type, and whether the 20-result cap was reached.
- "Same cuisine type" compares the owner's cuisine words with Google's reported type only, never the restaurant's name.

## Storage policy
Google's terms forbid storing or caching Places content (place IDs are the exception): https://developers.google.com/maps/documentation/places/web-service/policies
- `GET /api/expansion/investigations/{runId}/nearby-restaurants?candidateId=` returns live results with `Cache-Control: private, no-store`.
- Nothing is written to `SourceSnapshot` evidence, agent artifacts, durable records or saved plans. The evidence provider enum has no Google entry, and a test enforces this.
- A saved plan reloads the list live each time it is opened.

## AI explanation
- `POST` on the same route re-fetches from Google on the server. The client never supplies the content being explained.
- Gemini receives only the place IDs, names, types and distances from this result, plus the deterministic summary and the owner's cuisine. Addresses are not sent.
- Output is schema-validated. It is rejected if it cites a place ID outside the results, or uses any number (digits or "two"–"twenty") that wasn't already computed or quoted from a name.
- It's labeled "AI interpretation" (`origin: assumed`), is never stored, and doesn't change scores or financial calculations.
- The deep-agent worker's inspection artifacts are persisted, so Google content is deliberately not added there.

## Failure handling
`status` is one of `ok`, `not_configured`, `denied` (includes invalid key), `rate_limited`, `timeout`, `unavailable` (network, HTTP 5xx or malformed payload), `synthetic` or `no_coordinates`. Failures show the reason and never substitute a list. An empty `ok` result is shown as "Google returned no restaurants". That is not proof of no competition.

## Not done yet: competitor map pins
Google's policy requires Places results shown on a map to use a Google map. That means replacing the MapLibre map in `places-map.tsx` with the Maps JavaScript API and adding a separate, HTTP-referrer-restricted browser key. Until then, results appear only as a list, with Google Maps links.

## Live verification, November 15, 2026
- A downtown Houston point (29.7604, −95.3698) returned 20 restaurants (cap reached). The nearest was 3 m, the median 47 m, and one matched "Mexican".
- 14829 Bellaire Blvd in the app returned 20 (nearest 42 m, median 416 m). One matched "Mediterranean" (Tahini Plus). The explanation passed the grounding check.
- An open-ocean point returned an empty list. An invalid key was reported as `denied`.
