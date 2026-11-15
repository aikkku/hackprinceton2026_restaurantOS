"""Independent Phase 4 adapter. Reuses data_access; never imports the agent worker.

Stdout contains a bounded, sanitized DTO. Provider bodies/credentials are never
returned. Existing helper metadata/coverage/cache semantics are unchanged.
"""
from pathlib import Path
import csv
import hashlib
import json
import os
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT))
import data_access as access  # noqa: E402


def probe(provider: str, property_id: str, latitude: float | None, longitude: float | None) -> dict:
    access.CACHE_DIR = ROOT / "src/features/expansion/data/data/evidence-cache"
    access.OUTPUT_DIR = ROOT / "src/features/expansion/data/data/evidence-images"
    configured_root = os.environ.get("EXPANSION_E2E_COSTAR_ROOT") or os.environ.get("EXPANSION_COSTAR_ROOT")
    if configured_root:
        access.DATA_DIR = Path(configured_root)
    try:
        if provider == "matterport":
            access._keys(("MATTERPORT_API_KEY", "MATTERPORT_API_TOKEN"))
            # Read only enough of the authorized property/model index for one
            # association; a property join does not identify an offered suite.
            model_id = None
            with (access._kit_dir() / "commercial-properties.csv").open(encoding="utf-8-sig", newline="") as handle:
                for row in csv.DictReader(handle):
                    if row.get("PropertyId", "").strip() == property_id:
                        model_id = row.get("MatterportModelId", "").strip() or None
                        if model_id:
                            break
            if not model_id:
                return {"status": "configured", "reason": "No property/model association in the supplied index."}
            model = access.matterport_model(model_id)
            # Comma-separated model IDs permitted for the embedded viewer; "*" permits all.
            allowed = {item.strip() for item in os.environ.get("EXPANSION_MATTERPORT_EMBED_MODELS", "").split(",") if item.strip()}
            return {"status": "verified", "reason": "Model metadata retrieved; offered-suite association and measurements remain unavailable.",
                    "link": {"modelId": model_id, "propertyId": property_id, "candidateId": None, "verifiedAt": None,
                             "reference": "Authorized commercial-properties.csv property/model join", "viewerPermitted": "*" in allowed or model_id in allowed},
                    "model": {"id": model_id, "name": model.get("name"), "capturedAt": None, "measurements": None}}
        if provider == "vexcel":
            if latitude is None or longitude is None:
                return {"status": "unavailable", "reason": "No sourced site coordinates."}
            if not access.vexcel_in_geofence(latitude, longitude):
                return {"status": "outside_coverage", "reason": "Outside the supplied key geofence; no request made."}
            access._keys(("VEXCEL_API_KEY",))
            path = Path(access.vexcel_ortho(latitude, longitude))
            identity = hashlib.sha256(path.read_bytes()).hexdigest()
            return {"status": "verified", "reason": "Permitted JPEG extracted/cached at the sourced site coordinates. Capture date not supplied by the helper.",
                    "imageFile": str(path), "image": {"recordId": identity, "latitude": latitude, "longitude": longitude,
                    "capturedAt": None, "occluded": None, "reviewedVisibleStalls": None, "reviewReference": None}}
        return {"status": "unavailable", "reason": "Unknown provider."}
    except access.OutsideCoverageError:
        return {"status": "outside_coverage", "reason": "Vexcel denied this location (HTTP 403 / coverage restriction)."}
    except access.DataAccessError as error:
        message = str(error)
        return {"status": "denied" if "HTTP 401" in message or "HTTP 403" in message else "unavailable",
                "reason": message if message.startswith("Missing keys:") else "Provider metadata/image access failed; no substitute facts supplied."}
    except (OSError, ValueError):
        return {"status": "unavailable", "reason": "Source index or response unavailable; no substitute facts supplied."}


if __name__ == "__main__":
    provider, property_id = sys.argv[1:3]
    latitude = float(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "null" else None
    longitude = float(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] != "null" else None
    print(json.dumps(probe(provider, property_id, latitude, longitude)))
