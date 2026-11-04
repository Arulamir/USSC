import json
import unittest
from unittest.mock import patch

from flask import Flask
import requests

from backend.api import office_summary as summary


def report(ac=1000000000, lamp=500000000, partial=False):
    return {"date": "2025-01-01", "generated_at_utc": "2025-02-01T00:00:00Z",
            "totals": {"ac_wh": ac, "lamp_wh": lamp,
                       "ac_status": "partial" if partial else "complete",
                       "lamp_status": "unavailable" if lamp is None else "complete",
                       "ac_available_buckets": 10, "lamp_available_buckets": 0 if lamp is None else 10},
            "data": [{"ac_status": "complete", "lamp_status": "complete", "in_progress": False}] * 10}


class MonthlySummaryTests(unittest.TestCase):
    def setUp(self):
        summary._cache.clear()
        summary._next_generation = 0
        self.app = Flask(__name__)
        self.app.config.update(GROQ_API_KEY="private-test-key", GROQ_SUMMARY_MODEL="qwen/qwen3.8-27b")
        self.app.register_blueprint(summary.office_summary_bp)
        self.client = self.app.test_client()

    def test_energy_and_emission_conversions_match_worked_example(self):
        facts = summary.monthly_facts(report())
        self.assertEqual(facts["total_kwh"], 1500000)
        self.assertEqual(facts["emissions_kg_co2"], 1305000)
        self.assertEqual(facts["emissions_t_co2"], 1305)
        self.assertEqual(facts["factor"]["reference_year"], 2019)

    def test_partial_and_missing_do_not_become_complete_or_zero(self):
        facts = summary.monthly_facts(report(ac=1000, lamp=None, partial=True))
        self.assertEqual(facts["total_kwh"], 1)
        self.assertEqual(facts["emissions_kg_co2"], .87)
        self.assertIsNone(facts["lamp_kwh"])
        self.assertTrue(facts["partial"])
        self.assertIn("subtotal", summary.coverage_sentence(facts))
        facts = summary.monthly_facts(report(ac=None, lamp=None))
        self.assertIsNone(facts["total_kwh"])
        self.assertIsNone(facts["emissions_kg_co2"])

    def test_real_zero_stays_zero(self):
        facts = summary.monthly_facts(report(ac=0, lamp=0))
        self.assertEqual(facts["total_kwh"], 0)
        self.assertEqual(facts["emissions_kg_co2"], 0)

    @patch.object(summary, "get_history")
    def test_invalid_or_future_month_does_not_query_database(self, history):
        for month in ("2025-13", "2025-1", "1969-12", "9999-12", "bad", "2025-01-01"):
            self.assertEqual(self.client.get('/api/smart-office/summary', query_string={"month": month}).status_code, 400)
        history.assert_not_called()

    @patch.object(summary, "qwen_summary", return_value="Satu. Dua. Tiga. Empat.")
    @patch.object(summary, "get_history", return_value=report())
    def test_cached_summary_coalesces_provider_and_database_usage(self, history, qwen):
        first = self.client.get('/api/smart-office/summary?month=2025-01')
        second = self.client.get('/api/smart-office/summary?month=2025-01')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json["mode"], "qwen")
        self.assertFalse(first.json["cached"])
        self.assertTrue(second.json["cached"])
        self.assertEqual(second.headers["Cache-Control"], "no-store")
        history.assert_called_once()
        qwen.assert_called_once()
        self.assertNotIn("private-test-key", first.get_data(as_text=True))
        self.assertEqual(self.client.get('/api/smart-office/summary?month=2025-02').status_code, 429)

    @patch.object(summary, "qwen_summary", side_effect=requests.Timeout("private-test-key"))
    @patch.object(summary, "get_history", return_value=report())
    def test_provider_failure_retains_calculated_facts_without_exposing_errors(self, history, qwen):
        response = self.client.get('/api/smart-office/summary?month=2025-01')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["mode"], "calculated")
        self.assertEqual(response.json["facts"]["emissions_t_co2"], 1305)
        self.assertNotIn("private-test-key", response.get_data(as_text=True))

    @patch.object(summary, "qwen_summary")
    @patch.object(summary, "get_history", return_value=report(None, None))
    def test_no_data_never_calls_provider(self, history, qwen):
        response = self.client.get('/api/smart-office/summary?month=2025-01')
        self.assertEqual(response.json["mode"], "no_data")
        self.assertIsNone(response.json["facts"]["total_kwh"])
        qwen.assert_not_called()

    @patch.object(summary, "get_history", side_effect=summary.HistoryUnavailable("private database details"))
    def test_database_failure_is_sanitized(self, history):
        response = self.client.get('/api/smart-office/summary?month=2025-01')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private database", response.get_data(as_text=True))

    @patch.object(summary.requests, "Session")
    def test_prompt_uses_only_aggregates_and_never_reference_prose_or_credentials(self, factory):
        session = factory.return_value.__enter__.return_value
        response = session.post.return_value
        response.status_code = 200
        response.content = b"ok"
        response.json.return_value = {"choices": [{"finish_reason": "stop", "message": {"content": json.dumps({
            "sentences": ["Energi tercatat.", "Emisi diperkirakan.", "Gunakan energi seperlunya."]})}}]}
        text = summary.qwen_summary(summary.monthly_facts(report()), "private-test-key", "qwen/qwen3.8-27b")
        self.assertIn("Perhitungan mengikuti", text)
        args = session.post.call_args
        prompt = args.kwargs["json"]["messages"][0]["content"]
        for forbidden in ("private-test-key", "Worked example", "Indonesia publishes", "device_eui", "switch_1", "FAKTOR EMISI"):
            self.assertNotIn(forbidden, prompt)
        self.assertEqual(args.args[0], "https://api.groq.com/openai/v1/chat/completions")
        self.assertFalse(args.kwargs["allow_redirects"])
        self.assertFalse(session.trust_env)
        response.json.return_value["choices"][0]["finish_reason"] = "length"
        with self.assertRaises(ValueError):
            summary.qwen_summary(summary.monthly_facts(report()), "private-test-key", "qwen/qwen3.8-27b")


if __name__ == '__main__':
    unittest.main()
