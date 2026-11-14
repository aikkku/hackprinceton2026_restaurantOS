"""Private, auditable access to the CoStar kit, Matterport and Vexcel (Python 3.11+).

Install: python -m pip install requests python-dotenv
Run: python data_access.py --help
Keys come from the environment or the .env next to this file; environment wins.
The original datasets/databases are read-only. Normalized CoStar/Matterport caches
go in ./cache/ and JPEGs in ./output/ (all git-ignored). CoStar's legacy v2 SQLite
cache lacks status, rent units and suite-level provenance; it is inspected but
cannot be trusted alone. On the first search, validate against CSV/JSONL and build
a separate, fingerprinted SQLite cache. Subsequent searches use that cache.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
from typing import Any, Iterator, TypedDict

import requests
from dotenv import load_dotenv

DATA_DIR = Path(__file__).resolve().parent / "src/features/expansion/data"
CACHE_DIR = Path("cache")
OUTPUT_DIR = Path("output")
MATTERPORT_URL = "https://api.matterport.com/api/models/graph"
VEXCEL_URL = "https://api.vexcelgroup.com/v2/ortho/extract"
KEY_NAMES = ("MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN", "VEXCEL_API_KEY")
SCHEMA_VERSION = "1"
GEOFENCES: tuple[tuple[tuple[float, float], ...], ...] = (
    ((-119.0134, 33.0945), (-116.8949, 33.0945), (-116.8949, 34.3154), (-119.0134, 34.3154)),
    ((-96.2185, 29.0173), (-94.5758, 29.0173), (-94.5758, 30.3804), (-96.2185, 30.3804)),
    ((-124.7437, 38.0655), (-118.9869, 38.0655), (-118.9869, 41.9596), (-124.7437, 41.9596)),
    ((-88.2145, 30.8016), (-88.3285, 30.132), (-86.2124, 30.2269),
     (-85.5125, 29.6277), (-84.8004, 29.5039), (-84.9062, 30.7876)),
    ((-74.6943406774712, 40.31565454915983), (-74.59812447568899, 40.31565454915983),
     (-74.59812447568899, 40.3713908156042), (-74.6943406774712, 40.3713908156042)),
)


class DataAccessError(RuntimeError):
    """A source/configuration error safe to show without response bodies or secrets."""


class OutsideCoverageError(DataAccessError):
    """The requested image is outside this key's permitted Vexcel coverage (403)."""


class Listing(TypedDict):
    """One offered suite, with exact values nullable and original ranges retained."""

    id: str
    property_id: str
    listing_id: str
    address: str | None
    city: str | None
    state: str | None
    lat: float | None
    lng: float | None
    sqft: float | None
    sqft_min: float | None
    sqft_max: float | None
    asking_rent: float | None
    asking_rent_low: float | None
    asking_rent_high: float | None
    rent_basis: str | None
    availability: str
    previous_use: str | None
    second_gen: bool | None
    matterport_model_id: str | None
    space_use: int | None
    source: str
    evidence: dict[str, Any]


def _keys(names: tuple[str, ...]) -> dict[str, str]:
    """Read only the credentials needed for an operation, without logging values."""
    load_dotenv(Path(__file__).with_name(".env"), override=False, encoding="utf-8-sig")
    missing = [name for name in names if not os.environ.get(name, "").strip()]
    if missing:
        raise DataAccessError("Missing keys: " + ", ".join(missing) + ". Set them in .env or the environment.")
    return {name: os.environ[name].strip() for name in names}


def load_keys() -> dict[str, str]:
    """Load all three API credentials; report every missing variable by name."""
    return _keys(KEY_NAMES)


def _number(value: Any) -> float | None:
    """Return a finite numeric source value, excluding booleans and empty strings."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _positive(value: Any) -> float | None:
    """Return a positive finite value; zero quotes mean no recorded rent."""
    result = _number(value)
    return result if result is not None and result > 0 else None


def _object(value: Any) -> dict[str, Any]:
    """Validate an object boundary without assuming optional source data exists."""
    return value if isinstance(value, dict) else {}


def _kit_dir() -> Path:
    """Resolve an extracted kit passed directly or below the configured data root."""
    candidates = [DATA_DIR, DATA_DIR / "costar-hackathon-kit (1)", DATA_DIR / "costar-hackathon-kit"]
    if DATA_DIR.is_dir():
        candidates.extend(sorted(path for path in DATA_DIR.iterdir() if path.is_dir()))
    for path in candidates:
        if (path / "commercial-properties.csv").is_file():
            return path
    raise DataAccessError("CoStar: commercial-properties.csv not found. Set --data-dir to the data folder or extracted kit.")


def _records(path: Path) -> Iterator[dict[str, Any]]:
    """Stream JSONL objects with bounded, redacted parse errors."""
    try:
        with path.open(encoding="utf-8-sig") as handle:
            for line_number, line in enumerate(handle, 1):
                if not line.strip():
                    continue
                value = json.loads(line)
                if not isinstance(value, dict):
                    raise ValueError("not an object")
                yield value
    except (ValueError, UnicodeError) as error:
        raise DataAccessError(f"CoStar: invalid {path.name} at line {line_number}; no record content logged.") from error
    except OSError as error:
        raise DataAccessError(f"CoStar: cannot read {path.name}; check --data-dir and the extracted kit.") from error


def coStar_properties_with_matterport() -> list[tuple[str, str, str]]:
    """Return each nonempty property/scan/address join; properties can have many scans."""
    try:
        with (_kit_dir() / "commercial-properties.csv").open(encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not {"PropertyId", "MatterportModelId", "Address"}.issubset(reader.fieldnames or []):
                raise DataAccessError("CoStar: commercial-properties.csv has incompatible columns.")
            rows = [(row["PropertyId"].strip(), row["MatterportModelId"].strip(), row["Address"].strip())
                    for row in reader if row.get("PropertyId", "").strip() and row.get("MatterportModelId", "").strip()]
    except (OSError, UnicodeError, csv.Error) as error:
        raise DataAccessError("CoStar: cannot read the property/Matterport CSV.") from error
    print(f"CoStar: CSV property/scan joins ({len(rows)} rows).", file=sys.stderr)
    return rows


def _fingerprint(kit: Path) -> str:
    """Invalidate normalized SQLite when any source file, path or schema changes."""
    files = [kit / "commercial-properties.csv"] + [kit / "data" / f"{name}.jsonl" for name in
            ("commercial-property", "commercial-listing-summary", "location-occupancy", "company-detail")]
    signature = [(str(path.resolve()), path.stat().st_size, path.stat().st_mtime_ns) if path.exists()
                 else (str(path.resolve()), None, None) for path in files]
    return hashlib.sha256(json.dumps([SCHEMA_VERSION, signature]).encode()).hexdigest()


def _history(kit: Path, property_ids: set[str]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """Join historical suite occupancies to company industries, never tenant names."""
    occupancy_file = kit / "data/location-occupancy.jsonl"
    company_file = kit / "data/company-detail.jsonl"
    if not occupancy_file.is_file() or not company_file.is_file():
        return {}
    ended = [row for row in _records(occupancy_file)
             if str(row.get("propertyId")) in property_ids and row.get("toDate")]
    company_ids = {str(row.get("tenantLocationId")) for row in ended if row.get("tenantLocationId")}
    industries = {str(row["id"]): _object(row.get("profile")).get("industryType")
                  for row in _records(company_file) if str(row.get("id")) in company_ids}
    result: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in ended:
        tenant = row.get("tenantLocationId")
        industry = industries.get(str(tenant)) if tenant else row.get("industryType")
        for space in row.get("spaces") or []:
            suite = str(space.get("suite") or "").strip().casefold()
            # Without a suite identifier, a prior tenant elsewhere in the building
            # is not evidence of the offered suite's previous use.
            if suite:
                result.setdefault((str(row.get("propertyId")), suite), []).append(
                    {"id": row.get("id"), "ended": row["toDate"], "industry": industry})
    return result


def _kitchen_hint(*records: dict[str, Any]) -> bool:
    """Recognize positive kitchen/hood/grease-trap notes, excluding simple negations."""
    for record in records:
        for note in record.get("notes") or []:
            text = str(_object(note).get("value") or "")
            for sentence in re.split(r"[.!?;\n]", text):
                if re.search(r"\b(kitchen|hood|grease[ -]?trap)\b", sentence, re.I) and not re.search(
                    r"\b(no|not|without|needs?|requires?|install|potential|possible)\b", sentence, re.I
                ):
                    return True
    return False


def _normalize(kit: Path) -> list[Listing]:
    """Validate source fields before creating one allowlisted result per active suite."""
    properties = {str(row["id"]): row for row in _records(kit / "data/commercial-property.jsonl")}
    scans: dict[str, str] = {}
    for property_id, model_id, _ in coStar_properties_with_matterport():
        scans.setdefault(property_id, model_id)
    history = _history(kit, set(properties))
    results: dict[str, Listing] = {}
    unmatched = 0
    for listing in _records(kit / "data/commercial-listing-summary.jsonl"):
        if listing.get("listingStatus") != 1:
            continue
        lease = _object(listing.get("forLeaseSummary"))
        for space in lease.get("spaces") or []:
            property_id = str(space.get("propertyId"))
            parent = properties.get(property_id)
            if parent is None:
                unmatched += 1
                continue
            address = _object(parent.get("primaryAddress"))
            market = {14: "Houston", 20: "Los Angeles"}.get(address.get("researchMarketId"))
            suite = str(space.get("suite") or "").strip().casefold()
            past = sorted(history.get((property_id, suite), []), key=lambda row: str(row["ended"]), reverse=True)
            # Only the most recently ended known suite tenancy is a previous-use proxy.
            previous = past[0] if past else None
            food = previous is not None and previous["industry"] == 17
            hint = _kitchen_hint(space, listing)
            low, high = _positive(space.get("rateLow")), _positive(space.get("rateHigh"))
            period, measurement, currency = space.get("rateBasis"), lease.get("askingRateMeasurementType"), space.get("monetaryUnit")
            basis = f"USD/SF/{'month' if period == 1 else 'year'}" if period in (1, 2) and measurement == 1 and currency == 1 else None
            exact_rent = low if low is not None and low == high and basis is not None else None
            sf_low, sf_high = _positive(space.get("squareFeetMin")), _positive(space.get("squareFeetMax"))
            exact_sf = sf_low if sf_low is not None and sf_low == sf_high else None
            if (low is not None and high is not None and low > high) or (sf_low is not None and sf_high is not None and sf_low > sf_high):
                raise DataAccessError("CoStar: invalid source rent/area range; no record content logged.")
            street = " ".join(str(address[key]).strip() for key in
                              ("streetNumber", "streetDirection", "streetName", "streetType", "streetSuffix") if address.get(key)) or None
            lat, lng = _number(address.get("latitude")), _number(address.get("longitude"))
            if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
                lat = lng = None
            if space.get("id") is None or listing.get("id") is None:
                raise DataAccessError("CoStar: a listing/space identifier is missing.")
            results[str(space["id"])] = Listing(
                id=str(space["id"]), property_id=property_id, listing_id=str(listing["id"]),
                address=street, city=market or address.get("city"), state=address.get("state"), lat=lat, lng=lng,
                sqft=exact_sf, sqft_min=sf_low, sqft_max=sf_high,
                asking_rent=exact_rent, asking_rent_low=low, asking_rent_high=high, rent_basis=basis,
                availability="active_in_snapshot", previous_use="AccommodationAndFoodServices" if food else
                (f"industry_code_{previous['industry']}" if previous and previous["industry"] is not None else None),
                second_gen=True if food or hint else None, matterport_model_id=scans.get(property_id),
                space_use=space.get("spaceUse"), source="CoStar",
                evidence={"record_date": listing.get("certifiedFreshDate"), "availability": "observed snapshot; current vacancy unverified",
                          "rent_codes": {"period": period, "measurement": measurement, "currency": currency, "service": space.get("serviceType")},
                          "exact_rent": "observed" if exact_rent is not None else "unavailable",
                          "exact_sqft": "observed" if exact_sf is not None else "unavailable",
                          "second_gen": "derived proxy" if food or hint else "unavailable",
                          "occupancy_id": previous["id"] if previous else None,
                          "kitchen_note_hint": hint,
                          "limitations": "Industry 17 also includes accommodation. Notes may describe a building, not this suite. Kitchen, permitted use and condition require inspection; no verified restaurant fit."},
            )
    if unmatched:
        print(f"CoStar: omitted {unmatched} spaces with unresolved property links.", file=sys.stderr)
    return list(results.values())


def _costar_records() -> list[Listing]:
    """Prefer a validated SQLite cache; rebuild atomically from the private kit."""
    kit = _kit_dir()
    fingerprint = _fingerprint(kit)
    identity = hashlib.sha256(str(kit.resolve()).encode()).hexdigest()[:16]
    target = CACHE_DIR / f"costar-{identity}.sqlite"
    if target.is_file():
        try:
            with closing(sqlite3.connect(target.resolve().as_uri() + "?mode=ro", uri=True)) as db:
                if db.execute("SELECT value FROM meta WHERE key='fingerprint'").fetchone() == (fingerprint,):
                    rows = [json.loads(row[0]) for row in db.execute("SELECT payload FROM listings ORDER BY id")]
                    print(f"CoStar: validated SQLite cache ({len(rows)} active snapshot spaces).", file=sys.stderr)
                    return rows
        except (sqlite3.Error, ValueError):
            print("CoStar: normalized cache unreadable; rebuilding from CSV/JSONL.", file=sys.stderr)
    # Inspect the supplied database, but reject its incomplete contract rather
    # than treating its derived second_gen/rent_psf_yr columns as source facts.
    legacy = DATA_DIR / "data/costar.sqlite"
    if legacy.is_file():
        try:
            with closing(sqlite3.connect(legacy.resolve().as_uri() + "?mode=ro", uri=True)) as db:
                db.execute("SELECT space_id FROM spaces LIMIT 1").fetchall()
            print("CoStar: legacy SQLite lacks required provenance; validating CSV/JSONL into a separate cache.", file=sys.stderr)
        except sqlite3.Error:
            print("CoStar: legacy SQLite unavailable; using CSV/JSONL.", file=sys.stderr)
    rows = _normalize(kit)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=target.stem + "-", suffix=".tmp", dir=CACHE_DIR)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with closing(sqlite3.connect(temporary)) as db, db:
            db.execute("CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("INSERT INTO meta VALUES('fingerprint', ?)", (fingerprint,))
            db.execute("CREATE TABLE listings(id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.executemany("INSERT INTO listings VALUES(?, ?)", [(row["id"], json.dumps(row)) for row in rows])
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"CoStar: CSV/JSONL → validated SQLite ({len(rows)} active snapshot spaces).", file=sys.stderr)
    return rows


def coStar_search(city: str | None = None, sf_min: float | None = None, sf_max: float | None = None,
                  retail_only: bool = True) -> list[dict[str, Any]]:
    """Search active snapshot suites, retaining offered ranges overlapping SF filters.

    Exact sqft/rent remain None for divisible/ranged offers. rent_basis preserves
    the quoted period, currency and area unit; asking rent is not occupancy cost.
    second_gen=None means unknown, not evidence that a kitchen is absent.
    """
    for bound in (sf_min, sf_max):
        if bound is not None and (_positive(bound) is None):
            raise DataAccessError("CoStar: SF filters must be finite positive numbers.")
    if sf_min is not None and sf_max is not None and sf_min > sf_max:
        raise DataAccessError("CoStar: sf_min must not exceed sf_max.")
    selected = []
    for row in _costar_records():
        if retail_only and row["space_use"] not in (3, 5):
            continue
        if city and (row["city"] or "").casefold() != city.strip().casefold():
            continue
        if sf_min is not None and (row["sqft_max"] is None or row["sqft_max"] < sf_min):
            continue
        if sf_max is not None and (row["sqft_min"] is None or row["sqft_min"] > sf_max):
            continue
        selected.append(dict(row))
    print(f"CoStar: {len(selected)} matching spaces; active marketing in a dated snapshot does not verify current availability.", file=sys.stderr)
    return selected


def _post(source: str, url: str, **kwargs: Any) -> requests.Response:
    """Send a bounded request without echoing credentials or untrusted error bodies."""
    try:
        return requests.post(url, timeout=(10, 90), allow_redirects=False, **kwargs)
    except requests.RequestException as error:
        raise DataAccessError(f"{source}: network request failed ({type(error).__name__}); check connectivity.") from None


def _http_ok(source: str, response: requests.Response) -> None:
    """Raise a redacted error containing the status and useful authentication hint."""
    if not 200 <= response.status_code < 300:
        hint = " Check the API credentials and access permissions." if response.status_code in (401, 403) else ""
        raise DataAccessError(f"{source}: HTTP {response.status_code}.{hint}")


def matterport_graph(query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute production Matterport GraphQL with HTTP Basic auth; return data only."""
    if not isinstance(query, str) or not query.strip():
        raise DataAccessError("Matterport: a nonempty GraphQL query is required.")
    keys = _keys(KEY_NAMES[:2])
    response = _post("Matterport", MATTERPORT_URL,
                     auth=(keys["MATTERPORT_API_KEY"], keys["MATTERPORT_API_TOKEN"]),
                     json={"query": query, "variables": variables or {}})
    _http_ok("Matterport", response)
    try:
        payload = response.json()
    except ValueError:
        raise DataAccessError("Matterport: invalid JSON response.") from None
    if not isinstance(payload, dict) or payload.get("errors") or not isinstance(payload.get("data"), dict):
        raise DataAccessError("Matterport: GraphQL returned errors or missing data; check the query schema and model access.")
    print("Matterport: production GraphQL response.", file=sys.stderr)
    return payload["data"]


def _atomic_write(path: Path, content: bytes) -> None:
    """Publish a complete local artifact so partial downloads never become cache hits."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=path.name + "-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _model_result(model: Any, model_id: str) -> dict[str, Any]:
    """Validate and allowlist one model; optional address/geolocation stay nullable."""
    if not isinstance(model, dict) or str(model.get("id")) != model_id:
        raise DataAccessError("Matterport: model not found or model ID does not match.")
    address, geo = _object(model.get("address")), _object(model.get("geolocation"))
    lat, lon = _number(geo.get("lat")), _number(geo.get("long"))
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        lat = lon = None
    return {"id": model_id, "name": model.get("name"), "address": address, "lat": lat, "lon": lon}


def matterport_model(model_id: str) -> dict[str, Any]:
    """Fetch/cache a model's basic metadata; this does not measure rooms or seats."""
    if not isinstance(model_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", model_id):
        raise DataAccessError("Matterport: invalid model ID.")
    path = CACHE_DIR / f"matterport-{model_id}.json"
    if path.is_file():
        try:
            result = _model_result(json.loads(path.read_text(encoding="utf-8")), model_id)
            print("Matterport: cached model JSON (snapshot; delete cache to refresh).", file=sys.stderr)
            return result
        except (OSError, ValueError, DataAccessError):
            pass
    # JSON escaping is safe for a GraphQL string literal and avoids schema-specific
    # guesses about the ID scalar type used in variable declarations.
    query = "{ model(id: " + json.dumps(model_id) + ") { id name address { address locality } geolocation { lat long } } }"
    model = matterport_graph(query).get("model")
    result = _model_result(model, model_id)
    _atomic_write(path, json.dumps(model, indent=2).encode())
    return result


def _coordinates(lat: float, lon: float) -> tuple[float, float]:
    """Reject nonfinite or out-of-range WGS84 coordinates before network access."""
    latitude, longitude = _number(lat), _number(lon)
    if latitude is None or longitude is None or not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise DataAccessError("Vexcel: latitude must be -90..90 and longitude -180..180 (finite numbers).")
    return latitude, longitude


def _point_in_polygon(lon: float, lat: float, polygon: tuple[tuple[float, float], ...]) -> bool:
    """Use ray casting for concave polygons, including points on the boundary."""
    inside = False
    previous_x, previous_y = polygon[-1]
    for x, y in polygon:
        cross = (lon - previous_x) * (y - previous_y) - (lat - previous_y) * (x - previous_x)
        if abs(cross) < 1e-12 and min(previous_x, x) <= lon <= max(previous_x, x) and min(previous_y, y) <= lat <= max(previous_y, y):
            return True
        if (y > lat) != (previous_y > lat) and lon < (previous_x - x) * (lat - y) / (previous_y - y) + x:
            inside = not inside
        previous_x, previous_y = x, y
    return inside


def vexcel_in_geofence(lat: float, lon: float) -> bool:
    """Test the five supplied key regions (longitude-latitude polygon order)."""
    lat, lon = _coordinates(lat, lon)
    return any(_point_in_polygon(lon, lat, polygon) for polygon in GEOFENCES)


def _ortho_wkt(lat: float, lon: float, half_meters: float) -> str:
    """Build a closed, locally metric WGS84 square (equirectangular approximation)."""
    half = _positive(half_meters)
    if half is None:
        raise DataAccessError("Vexcel: half_meters must be finite and positive.")
    cosine = math.cos(math.radians(lat))
    if abs(cosine) < 1e-6:
        raise DataAccessError("Vexcel: a local square cannot be constructed at the poles.")
    dy, dx = math.degrees(half / 6378137.0), math.degrees(half / (6378137.0 * cosine))
    if lat - dy < -90 or lat + dy > 90 or lon - dx < -180 or lon + dx > 180:
        raise DataAccessError("Vexcel: requested square crosses a coordinate boundary.")
    corners = [(lon - dx, lat - dy), (lon + dx, lat - dy), (lon + dx, lat + dy), (lon - dx, lat + dy), (lon - dx, lat - dy)]
    return "POLYGON ((" + ", ".join(f"{x:.10f} {y:.10f}" for x, y in corners) + "))"


def vexcel_ortho(lat: float, lon: float, half_meters: float = 70, out_path: str | Path | None = None) -> str:
    """Fetch/cache a Vexcel JPEG square; a remote HTTP 403 raises OutsideCoverageError."""
    lat, lon = _coordinates(lat, lon)
    wkt = _ortho_wkt(lat, lon, half_meters)
    body = {"wkt": wkt, "srid": 4326, "layer": "urban,urban-r,wide-area,urban-g", "crop": "bounding_box",
            "image-format": "jpeg", "destination-dimensions": "1400,1400"}
    identity = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:24]
    path = OUTPUT_DIR / f"vexcel-{identity}.jpg"
    content = path.read_bytes() if path.is_file() else b""
    if content.startswith(b"\xff\xd8\xff") and content.endswith(b"\xff\xd9"):
        print("Vexcel: cached JPEG (snapshot; delete cache to refresh).", file=sys.stderr)
    else:
        if not vexcel_in_geofence(lat, lon):
            raise OutsideCoverageError("Vexcel: outside the supplied key geofence; no imagery requested.")
        keys = _keys(("VEXCEL_API_KEY",))
        response = _post("Vexcel", VEXCEL_URL, headers={"X-API-KEY": keys["VEXCEL_API_KEY"]}, json=body)
        if response.status_code == 403:
            raise OutsideCoverageError("Vexcel: HTTP 403; no imagery permitted here for this key (coverage restriction).")
        _http_ok("Vexcel", response)
        content = response.content
        if not content.startswith(b"\xff\xd8\xff") or not content.endswith(b"\xff\xd9"):
            raise DataAccessError("Vexcel: expected JPEG bytes; response was not a complete JPEG.")
        _atomic_write(path, content)
        print("Vexcel: ortho/extract JPEG response.", file=sys.stderr)
    if out_path is not None:
        destination = Path(out_path)
        if destination.resolve() != path.resolve():
            _atomic_write(destination, content)
        return str(destination.resolve())
    return str(path.resolve())


def main(argv: list[str] | None = None) -> int:
    """Run the requested CLI action; print sanitized errors and audit labels."""
    global DATA_DIR
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR, help="CoStar data root or extracted kit")
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--check", action="store_true", help="Check required key presence (no secrets printed)")
    actions.add_argument("--costar", metavar="CITY", help="Show a few active retail snapshot spaces")
    actions.add_argument("--matterport", metavar="MODEL_ID", help="Fetch/cache a model's metadata")
    actions.add_argument("--vexcel", nargs=2, type=float, metavar=("LAT", "LON"), help="Fetch/cache an aerial JPEG")
    parser.add_argument("--sf-min", type=float)
    parser.add_argument("--sf-max", type=float)
    parser.add_argument("--all-uses", action="store_true", help="Include nonretail offered spaces")
    parser.add_argument("--half-meters", type=float, default=70)
    parser.add_argument("--out-path", type=Path)
    args = parser.parse_args(argv)
    DATA_DIR = args.data_dir
    try:
        if args.check:
            load_keys()
            print("Matterport / Vexcel: all required keys present (values hidden; live access is checked by the API commands).")
        elif args.costar is not None:
            rows = coStar_search(args.costar, args.sf_min, args.sf_max, not args.all_uses)
            print(json.dumps({"source": "CoStar", "matching_spaces": len(rows), "sample": rows[:3]}, indent=2))
        elif args.matterport:
            print(json.dumps({"source": "Matterport", "model": matterport_model(args.matterport)}, indent=2))
        elif args.vexcel:
            print(json.dumps({"source": "Vexcel", "image": vexcel_ortho(*args.vexcel, half_meters=args.half_meters, out_path=args.out_path)}, indent=2))
        return 0
    except OutsideCoverageError as error:
        print(str(error), file=sys.stderr)
        return 0
    except (DataAccessError, OSError, sqlite3.Error) as error:
        message = str(error) if isinstance(error, DataAccessError) else "Local file/cache operation failed; check paths and permissions."
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
