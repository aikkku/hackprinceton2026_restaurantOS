# Real Houston neighborhood data

The live app uses official City of Houston **Super Neighborhood** polygons. These planning areas differ from informal area names. The boundary service is the source referenced by the City's own “Locate My SN” application, linked from https://www.houstontx.gov/superneighborhoods/index.html.

- Boundary source: https://mycity2.houstontx.gov/gisweb02/rest/services/HoustonMap/Administrative_Boundary/MapServer/3
- Definition/method version: `houston-official-super-neighborhoods-v1`; WGS84 point-in-polygon with holes and multipart polygons. Shared/overlapping boundaries and outside-coverage addresses are not assigned a guessed name.
- Public source polygons are cached locally for 24 hours in the git-ignored `data/data/official-neighborhoods.json`. Actual retrieval time is recorded; the service supplies no publication/update date, so that remains null.
- The preference picker shows **only the top eight** areas by count of active-snapshot Retail/Office-Retail offered spaces in the imported CoStar dataset. Counts are actual geospatial joins. This ranks listing coverage in this sample, not citywide popularity or business success. Unknown/Flex uses are excluded from this ranking.
- All official polygons remain available internally to identify the actual neighborhood of any returned property, including areas outside the eight preference choices. No property is relabeled to the nearest featured area.
- Old “Heights” and “Montrose” preferences match their explicit official equivalents, “GREATER HEIGHTS” and “NEARTOWN - MONTROSE.” Other informal area names are not guessed into boundaries. The setup screen asks owners to select from the sourced top eight.
- Property/list/map/compare labels, requirement assessments, agent inspections, and the fit-score neighborhood factor share this geographic evidence. Facts derived by this specific official boundary method are eligible for membership assessment; AI guesses remain excluded.
- The old manual `EXPANSION_HEIGHTS_LOOKUP` mechanism is retired. No example neighborhood list is substituted on source failure. Synthetic source examples remain isolated to explicitly synthetic test listings. Saved plans retain their frozen historical evidence.

Population and income are real Census ACS five-year **tract** estimates, not measured Super Neighborhood totals or predictions of restaurant sales. Existing adapters retain the release, geography, units, margins of error, retrieved time and Census link. Server-side Census credentials never reach the browser. Restaurant counts are bounded live OpenStreetMap queries with ODbL attribution; failures remain unavailable and never become zero or a sample count.

## Live verification, November 15, 2026

The City query returned 88 official polygons. A coordinate join assigned 148 of the existing 190 property candidates; 42 had no unique match. The eight preference counts were Downtown 28, Midtown 15, Neartown–Montrose 10, Eldridge/West Oaks 7, Greenway/Upper Kirby 7, Washington Avenue Coalition/Memorial Park 7, Clear Lake 6 and Greater Eastwood 6.

A live Census request for the existing Mitchell Road example returned tract 2217.01, Harris County, Texas, ACS 2023: population 5,238 (90% MOE ±1,476) and median household income $42,078 in 2023 dollars (90% MOE ±$38,403). This property has no unique City Super Neighborhood match; the app does not fabricate one. The two configured public Overpass instances were unreachable during this check (connection refusal/timeout); nearby restaurant data was reported unavailable.

Focused tests cover polygon holes, multipart geometry, boundary ambiguity, coordinate validation, official aliases, synthetic isolation, derived-evidence eligibility in matching/scoring, and idempotent source merging. The full browser suite/build is intentionally not required for this bounded change.
