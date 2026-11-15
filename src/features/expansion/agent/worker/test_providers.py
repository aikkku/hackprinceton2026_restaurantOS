"""Live-provider model construction: honest provider_not_configured errors,
auto-detection from the environment, and the three supported providers."""

from __future__ import annotations

import os
import unittest

from restaurantos_worker.planner import ProviderUnavailable, make_live_model


class ProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.previous = {
            name: os.environ.get(name)
            for name in ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"]
        }
        for name in self.previous:
            os.environ.pop(name, None)

    def tearDown(self) -> None:
        for name, value in self.previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    def test_no_key_anywhere_reports_provider_not_configured(self) -> None:
        with self.assertRaises(ProviderUnavailable) as caught:
            make_live_model({})
        self.assertEqual(caught.exception.code, "provider_not_configured")
        self.assertIn("GOOGLE_API_KEY", caught.exception.message)

    def test_auto_detection_prefers_anthropic_then_openai_then_google(self) -> None:
        os.environ["GOOGLE_API_KEY"] = "test-google-key"
        model = make_live_model({})
        self.assertIn("GenerativeAI", type(model).__name__)
        self.assertEqual(model.model, "gemini-2.5-flash")

        os.environ["OPENAI_API_KEY"] = "test-openai-key"
        model = make_live_model({})
        self.assertIn("OpenAI", type(model).__name__)

        os.environ["ANTHROPIC_API_KEY"] = "test-anthropic-key"
        model = make_live_model({})
        self.assertIn("Anthropic", type(model).__name__)

    def test_explicit_provider_with_missing_key_is_honest(self) -> None:
        with self.assertRaises(ProviderUnavailable) as caught:
            make_live_model({"provider": "google"})
        self.assertEqual(caught.exception.code, "provider_not_configured")
        self.assertIn("GOOGLE_API_KEY", caught.exception.message)

    def test_google_model_id_override(self) -> None:
        os.environ["GOOGLE_API_KEY"] = "test-google-key"
        model = make_live_model({"provider": "google", "model_id": "gemini-2.5-pro"})
        self.assertEqual(model.model, "gemini-2.5-pro")

    def test_gemini_alias_key_detected(self) -> None:
        # GEMINI_API_KEY alone satisfies the google provider (owner-set name).
        os.environ["GEMINI_API_KEY"] = "test-gemini-key"
        model = make_live_model({})
        self.assertIn("GenerativeAI", type(model).__name__)
        self.assertEqual(model.model, "gemini-2.5-flash")
        # GOOGLE_API_KEY takes precedence when both exist.
        os.environ["GOOGLE_API_KEY"] = "test-google-key"
        model = make_live_model({})
        self.assertEqual(model.google_api_key.get_secret_value(), "test-google-key")

    def test_explicit_google_provider_accepts_gemini_alias(self) -> None:
        os.environ["GEMINI_API_KEY"] = "test-gemini-key"
        model = make_live_model({"provider": "google"})
        self.assertEqual(model.google_api_key.get_secret_value(), "test-gemini-key")

    def test_unknown_provider_rejected(self) -> None:
        os.environ["GOOGLE_API_KEY"] = "test-google-key"
        with self.assertRaises(ProviderUnavailable) as caught:
            make_live_model({"provider": "made-up"})
        self.assertEqual(caught.exception.code, "provider_not_configured")


if __name__ == "__main__":
    unittest.main()
