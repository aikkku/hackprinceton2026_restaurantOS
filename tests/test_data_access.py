"""Offline contract, normalization and error-path checks for data_access.py."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch
from uuid import uuid4

import requests

import data_access as access


class DataAccessTests(unittest.TestCase):
    """Use tiny labeled fixtures and mocked HTTP; no private data or API calls."""

    def setUp(self) -> None:
        """Isolate source files, caches, output and credentials for every test."""
        temporary_root = Path(__file__).resolve().parents[1] / "cache/tests"
        temporary_root.mkdir(parents=True, exist_ok=True)
        self.root = temporary_root / uuid4().hex
        # Inherit workspace permissions: Python 3.14 TemporaryDirectory's private
        # Windows ACL omits the desktop sandbox identity.
        self.root.mkdir()
        self.addCleanup(self.cleanup_fixture)
        self.kit = self.root / "kit"
        (self.kit / "data").mkdir(parents=True)
        self.addCleanup(patch.stopall)
        patch.object(access, "DATA_DIR", self.kit).start()
        patch.object(access, "CACHE_DIR", self.root / "cache").start()
        patch.object(access, "OUTPUT_DIR", self.root / "output").start()
        patch.object(access, "load_dotenv").start()
        patch.dict(os.environ, {}, clear=True).start()
        self.stderr = StringIO()
        self.stdout = StringIO()
        stderr_redirect = redirect_stderr(self.stderr)
        stdout_redirect = redirect_stdout(self.stdout)
        stderr_redirect.__enter__()
        stdout_redirect.__enter__()
        self.addCleanup(stderr_redirect.__exit__, None, None, None)
        self.addCleanup(stdout_redirect.__exit__, None, None, None)
        self.keys = {name: "test-only-placeholder" for name in access.KEY_NAMES}

    def cleanup_fixture(self) -> None:
        """Delete only this test's verified, generated directory in cache/tests."""
        temporary_root = Path(__file__).resolve().parents[1] / "cache/tests"
        assert self.root.resolve().is_relative_to(temporary_root.resolve())
        shutil.rmtree(self.root)

    def write_jsonl(self, name: str, rows: list[dict]) -> None:
        """Write explicit fixture records to a local source stream."""
        (self.kit / "data" / f"{name}.jsonl").write_text(
            "\n".join(json.dumps(row) for row in rows), encoding="utf-8")

    def fixture(self) -> None:
        """Create active/off-market, range, unit, missing-link and tenancy cases."""
        (self.kit / "commercial-properties.csv").write_text(
            'PropertyId,MatterportModelId,Address,City,State\n'
            '1,fixtureScan,"1 Demo St, Suite A",Houston,TX\n'
            '1,otherScan,"1 Demo St, Suite A",Houston,TX\n'
            '2,,2 Demo St,Los Angeles,CA\n', encoding="utf-8")
        self.write_jsonl("commercial-property", [
            {"id": 1, "primaryAddress": {"researchMarketId": 14, "city": "HOUSTON", "state": "TX",
                "streetNumber": "1", "streetName": "Demo", "streetType": "St", "latitude": 29.7, "longitude": -95.3}},
            {"id": 2, "primaryAddress": {"researchMarketId": 20, "state": "CA"}},
        ])
        base = {"propertyId": 1, "spaceUse": 5, "rateLow": 2.5, "rateHigh": 2.5,
                "rateBasis": 1, "monetaryUnit": 1, "squareFeetMin": 1500, "squareFeetMax": 1500}
        self.write_jsonl("commercial-listing-summary", [
            {"id": 100, "listingStatus": 1, "forLeaseSummary": {"askingRateMeasurementType": 1, "spaces": [
                {**base, "id": 11, "suite": "A"},
                {**base, "id": 12, "suite": "B", "spaceUse": 3, "rateBasis": 2,
                 "rateLow": 20, "rateHigh": 30, "squareFeetMin": 1000, "squareFeetMax": 2500},
                {**base, "id": 13, "spaceUse": 1, "rateBasis": 0, "rateLow": 0, "rateHigh": 0},
                {**base, "id": 14, "propertyId": 999},
                {**base, "id": 15, "propertyId": 2, "monetaryUnit": 0},
            ]}},
            {"id": 200, "listingStatus": 3, "forLeaseSummary": {"spaces": [{**base, "id": 21}]}},
        ])
        self.write_jsonl("location-occupancy", [
            {"id": 41, "propertyId": 1, "tenantLocationId": 7, "industryType": 0,
             "toDate": "2020-01-01", "spaces": [{"suite": "a"}]},
            {"id": 42, "propertyId": 1, "tenantLocationId": 8, "industryType": 17,
             "toDate": "2021-01-01", "spaces": [{"suite": "B"}]},
            {"id": 43, "propertyId": 2, "tenantLocationId": 7, "spaces": [{"suite": "A"}]},
        ])
        self.write_jsonl("company-detail", [{"id": 7, "profile": {"industryType": 17}},
                                             {"id": 8, "profile": {"industryType": 5}}])

    def response(self, status: int = 200, payload: dict | None = None, content: bytes | None = None) -> requests.Response:
        """Build an HTTP response without creating a live connection."""
        response = requests.Response()
        response.status_code = status
        response._content = content if content is not None else json.dumps(payload or {}).encode()
        return response

    def test_missing_keys_lists_all_names_without_values(self) -> None:
        """All absent credentials are actionable while supplied values stay hidden."""
        with self.assertRaises(access.DataAccessError) as caught:
            access.load_keys()
        for name in access.KEY_NAMES:
            self.assertIn(name, str(caught.exception))
        os.environ.update(self.keys)
        self.assertEqual(access.load_keys(), self.keys)
        self.assertEqual(access.load_dotenv.call_args.kwargs["override"], False)

    def test_costar_normalization_and_safe_history(self) -> None:
        """Exact units, source joins and suite-specific historical industries survive."""
        self.fixture()
        rows = {row["id"]: row for row in access.coStar_search("hOuStOn")}
        self.assertEqual(set(rows), {"11", "12"})
        exact = rows["11"]
        self.assertEqual((exact["sqft"], exact["asking_rent"], exact["rent_basis"]), (1500, 2.5, "USD/SF/month"))
        self.assertEqual(exact["availability"], "active_in_snapshot")
        self.assertEqual(exact["matterport_model_id"], "fixtureScan")
        self.assertTrue(exact["second_gen"])
        self.assertEqual(rows["12"]["previous_use"], "industry_code_5")
        self.assertIsNone(rows["12"]["second_gen"])
        self.assertIsNone(rows["12"]["asking_rent"])
        self.assertIsNone(rows["12"]["sqft"])
        self.assertEqual(rows["12"]["asking_rent_high"], 30)
        self.assertEqual(access.coStar_properties_with_matterport()[0][2], "1 Demo St, Suite A")

    def test_costar_unknowns_all_uses_and_range_filters(self) -> None:
        """Unknown currency/rates remain null; size ranges use intersection semantics."""
        self.fixture()
        rows = {row["id"]: row for row in access.coStar_search(retail_only=False)}
        self.assertEqual(set(rows), {"11", "12", "13", "15"})
        self.assertIsNone(rows["13"]["asking_rent"])
        self.assertIsNone(rows["15"]["asking_rent"])
        self.assertIsNone(rows["15"]["lat"])
        self.assertEqual(len(access.coStar_search("houston", 1400, 1600)), 2)
        self.assertEqual(access.coStar_search("unknown city"), [])
        for bounds in ((2000, 1000), (float("nan"), None), (-1, None)):
            with self.assertRaises(access.DataAccessError):
                access.coStar_search(sf_min=bounds[0], sf_max=bounds[1])

    def test_sqlite_cache_hit_invalidation_and_corrupt_fallback(self) -> None:
        """Repeat reads avoid parsing; changed sources or broken caches rebuild."""
        self.fixture()
        first = access.coStar_search()
        with patch.object(access, "_normalize", side_effect=AssertionError("unexpected source read")):
            self.assertEqual(sorted(access.coStar_search(), key=lambda row: row["id"]), sorted(first, key=lambda row: row["id"]))
        source = self.kit / "data/commercial-listing-summary.jsonl"
        source.write_text(source.read_text() + "\n", encoding="utf-8")
        with patch.object(access, "_normalize", wraps=access._normalize) as normalizer:
            access.coStar_search()
            normalizer.assert_called_once()
        next((self.root / "cache").glob("costar-*.sqlite")).write_bytes(b"broken fixture")
        self.assertEqual(len(access.coStar_search()), 3)

    def test_invalid_and_missing_source_errors_are_redacted(self) -> None:
        """Malformed JSONL does not expose its contents in a user-facing error."""
        self.fixture()
        (self.kit / "data/commercial-property.jsonl").write_text("private invalid fixture", encoding="utf-8")
        with self.assertRaises(access.DataAccessError) as caught:
            access.coStar_search()
        self.assertNotIn("private invalid fixture", str(caught.exception))
        self.assertIn("line 1", str(caught.exception))

    def test_kitchen_notes_do_not_promote_simple_negations(self) -> None:
        """A missing or proposed hood is not evidence of an existing installation."""
        for text in ("No kitchen", "Requires hood installation", "Potential grease trap"):
            self.assertFalse(access._kitchen_hint({"notes": [{"value": text}]}))
        self.assertTrue(access._kitchen_hint({"notes": [{"value": "Existing kitchen and hood."}]}))

    def test_matterport_auth_variables_and_cache(self) -> None:
        """Basic auth and variables reach the API; repeat model requests stay offline."""
        os.environ.update(self.keys)
        model = {"id": "fixtureScan", "name": "Demo", "address": {"locality": "Demo"}, "geolocation": {"lat": 34, "long": -118}}
        with patch.object(access.requests, "post", return_value=self.response(payload={"data": {"model": model}})) as post:
            self.assertEqual(access.matterport_graph("query", {"id": "fixtureScan"})["model"], model)
            self.assertEqual(post.call_args.kwargs["auth"], (self.keys["MATTERPORT_API_KEY"], self.keys["MATTERPORT_API_TOKEN"]))
            self.assertEqual(post.call_args.kwargs["json"]["variables"], {"id": "fixtureScan"})
            self.assertFalse(post.call_args.kwargs["allow_redirects"])
            result = access.matterport_model("fixtureScan")
            self.assertEqual(result["lon"], -118)
        with patch.object(access.requests, "post", side_effect=AssertionError("unexpected network")):
            self.assertEqual(access.matterport_model("fixtureScan"), result)

    def test_matterport_http_graphql_and_invalid_model_errors(self) -> None:
        """HTTP and GraphQL errors fail rather than returning partial/synthetic data."""
        os.environ.update(self.keys)
        for response in (self.response(401), self.response(payload={"errors": [{"message": "private body"}]}),
                         self.response(payload={"data": {"model": None}}), self.response(content=b"invalid JSON")):
            with patch.object(access.requests, "post", return_value=response):
                with self.assertRaises(access.DataAccessError) as caught:
                    access.matterport_model("fixtureScan")
                self.assertNotIn("private body", str(caught.exception))
        with self.assertRaises(access.DataAccessError):
            access.matterport_model("../unsafe")

    def test_network_exception_is_sanitized(self) -> None:
        """A connection exception cannot echo a URL or a credential in its message."""
        with patch.object(access.requests, "post", side_effect=requests.ConnectionError("private credential")):
            with self.assertRaises(access.DataAccessError) as caught:
                access._post("Matterport", access.MATTERPORT_URL)
            self.assertNotIn("private credential", str(caught.exception))

    def test_all_geofences_and_nonrectangular_gulf_coast(self) -> None:
        """All five regions work, with actual polygon edges rather than bounding boxes."""
        for lat, lon in ((34.0935, -118.3171), (29.7, -95.3), (40, -122), (30.3, -87), (40.343, -74.655)):
            self.assertTrue(access.vexcel_in_geofence(lat, lon))
        for lat, lon in ((0, 0), (40.7, -74), (29.6, -88.2)):
            self.assertFalse(access.vexcel_in_geofence(lat, lon))
        self.assertTrue(access.vexcel_in_geofence(33.0945, -119.0134))
        with self.assertRaises(access.DataAccessError):
            access.vexcel_in_geofence(float("nan"), 0)

    def test_vexcel_polygon_request_cache_and_custom_copy(self) -> None:
        """Send a closed metric square; cache by all request parameters and copy output."""
        os.environ.update(self.keys)
        jpeg = b"\xff\xd8\xff\xe0fixture\xff\xd9"
        with patch.object(access.requests, "post", return_value=self.response(content=jpeg)) as post:
            first = access.vexcel_ortho(34.0935, -118.3171)
            body = post.call_args.kwargs["json"]
            self.assertTrue(body["wkt"].startswith("POLYGON (("))
            corners = body["wkt"][10:-2].split(", ")
            self.assertEqual(len(corners), 5)
            self.assertEqual(corners[0], corners[-1])
            self.assertEqual(post.call_args.kwargs["headers"], {"X-API-KEY": self.keys["VEXCEL_API_KEY"]})
            self.assertEqual(Path(first).read_bytes(), jpeg)
        with patch.object(access.requests, "post", side_effect=AssertionError("unexpected network")):
            custom = access.vexcel_ortho(34.0935, -118.3171, out_path=self.root / "copy.jpg")
            self.assertEqual(Path(custom).read_bytes(), jpeg)
        with patch.object(access.requests, "post", return_value=self.response(content=jpeg)):
            self.assertNotEqual(access.vexcel_ortho(34.0935, -118.3171, half_meters=80), first)

    def test_vexcel_403_other_errors_and_invalid_jpeg(self) -> None:
        """Coverage restrictions are distinct from server errors and invalid image data."""
        os.environ.update(self.keys)
        with patch.object(access.requests, "post", return_value=self.response(403)):
            with self.assertRaisesRegex(access.OutsideCoverageError, "403"):
                access.vexcel_ortho(34.0935, -118.3171)
            self.assertEqual(access.main(["--vexcel", "34.0935", "-118.3171"]), 0)
        for response in (self.response(500), self.response(content=b"not a jpeg")):
            with patch.object(access.requests, "post", return_value=response):
                with self.assertRaises(access.DataAccessError):
                    access.vexcel_ortho(34.0935, -118.3171)
        self.assertFalse((self.root / "output").exists())

    def test_vexcel_rejects_outside_and_invalid_input_without_network(self) -> None:
        """Local input/coverage failures should not consume any API requests."""
        with patch.object(access.requests, "post", side_effect=AssertionError("unexpected network")):
            with self.assertRaises(access.OutsideCoverageError):
                access.vexcel_ortho(0, 0)
            for lat, lon, half in ((100, 0, 70), (34, -118, 0), (34, -118, float("inf"))):
                with self.assertRaises(access.DataAccessError):
                    access.vexcel_ortho(lat, lon, half)


if __name__ == "__main__":
    unittest.main()
