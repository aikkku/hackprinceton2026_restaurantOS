"""Explicit synthetic provider tests; no live source calls or private records."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("phase4_source_probe", ROOT / "src/features/expansion/backend/source_probe.py")
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class SourceProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="phase4-provider-")
        self.root = Path(self.temp.name)
        (self.root / "commercial-properties.csv").write_text("PropertyId,MatterportModelId,Address\n1,syntheticModel,Synthetic building\n", encoding="utf-8")
        self.env = patch.dict(probe.os.environ, {"EXPANSION_COSTAR_ROOT": str(self.root), "EXPANSION_E2E_COSTAR_ROOT": ""})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_property_metadata_is_not_suite_measurement(self):
        with patch.object(probe.access, "_keys"), patch.object(probe.access, "matterport_model", return_value={"id": "syntheticModel", "name": "Synthetic model"}):
            result = probe.probe("matterport", "1", None, None)
        self.assertEqual(result["status"], "verified")
        self.assertIsNone(result["link"]["candidateId"])
        self.assertIsNone(result["model"]["measurements"])
        self.assertIsNone(result["model"]["capturedAt"])
        self.assertFalse(result["link"]["viewerPermitted"])

    def test_missing_model_link_does_not_contact_matterport(self):
        with patch.object(probe.access, "_keys"), patch.object(probe.access, "matterport_model") as model:
            self.assertEqual(probe.probe("matterport", "2", None, None)["status"], "configured")
            model.assert_not_called()

    def test_vexcel_outside_geofence_and_missing_coordinates_make_no_request(self):
        with patch.object(probe.access, "vexcel_ortho") as fetch:
            self.assertEqual(probe.probe("vexcel", "1", 0, 0)["status"], "outside_coverage")
            self.assertEqual(probe.probe("vexcel", "1", None, None)["status"], "unavailable")
            fetch.assert_not_called()

    def test_vexcel_denial_is_a_gap_without_payload(self):
        with patch.object(probe.access, "_keys"), patch.object(probe.access, "vexcel_ortho", side_effect=probe.access.OutsideCoverageError("Synthetic denied payload")):
            result = probe.probe("vexcel", "1", 29.76, -95.36)
        self.assertEqual(result["status"], "outside_coverage")
        self.assertNotIn("payload", str(result))


if __name__ == "__main__":
    unittest.main()
