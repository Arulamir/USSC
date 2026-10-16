import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

import mysql.connector
from flask import Flask

from backend.api.office_history import (
    HistoryUnavailable, WIB, build_history, get_history, office_history_bp,
)
from backend.api.smart_office import AC_METERS, LAMP_METERS


METER = sorted(AC_METERS)[0]
START = datetime(2026, 10, 17, tzinfo=WIB).astimezone(timezone.utc)
NOW = START + timedelta(days=2)


def point(at, value, eui=METER, high=None):
    return {"device_eui": eui, "energy_observed_at_utc": at,
            "energy_min_wh": value, "energy_max_wh": value if high is None else high}


def history(rows, now=NOW):
    return build_history("daily", "2026-10-17", rows, now)


class HistoryCalculationTests(unittest.TestCase):
    def test_distinct_counters_not_repeated_snapshots(self):
        rows = [point(START + timedelta(hours=i), Decimal(100 + i * 20)) for i in range(25)]
        result = history(rows * 5)
        self.assertEqual([row["ac_wh"] for row in result["data"]], [20] * 24)
        self.assertEqual(result["totals"]["ac_wh"], 480)
        self.assertEqual(result["totals"]["ac_status"], "partial")
        self.assertIsNone(result["totals"]["lamp_wh"])
        self.assertEqual(result["data"][0]["ac_detail"]["meter_used"], 1)

    def test_all_meters_complete_and_zero_remains_zero(self):
        rows = [point(START + timedelta(hours=i), i * (0 if eui in AC_METERS else 10), eui)
                for eui in AC_METERS | LAMP_METERS for i in range(25)]
        result = history(rows)
        self.assertEqual(result["totals"]["ac_wh"], 0)
        self.assertEqual(result["totals"]["lamp_wh"], 960)
        self.assertEqual(result["totals"]["ac_status"], "complete")
        self.assertFalse(result["totals"]["ac_partial"])

    def test_interpolation_and_no_double_count_at_shared_boundary(self):
        rows = [point(START - timedelta(minutes=10), 0),
                point(START + timedelta(minutes=10), 20),
                point(START + timedelta(minutes=50), 60),
                point(START + timedelta(minutes=70), 80),
                point(START + timedelta(minutes=110), 120),
                point(START + timedelta(minutes=130), 140)]
        result = history(rows)
        self.assertEqual(result["data"][0]["ac_wh"], 60)
        self.assertEqual(result["data"][1]["ac_wh"], 60)
        self.assertEqual(result["data"][0]["ac_status"], "partial_estimated")
        self.assertEqual(result["totals"]["ac_wh"], 120)

    def test_boundary_tolerance_is_thirty_minutes_both_sides(self):
        rows = [point(START - timedelta(minutes=30), 0), point(START + timedelta(minutes=30), 60),
                point(START + timedelta(minutes=90), 120)]
        self.assertEqual(history(rows)["data"][0]["ac_wh"], 60)
        rows[0] = point(START - timedelta(minutes=31), 0)
        self.assertIsNone(history(rows)["data"][0]["ac_wh"])

    def test_midnight_wib_start_uses_previous_utc_day(self):
        result = history([])
        self.assertEqual(result["data"][0]["start_utc"], "2026-10-16T17:00:00.000Z")
        self.assertEqual(result["data"][-1]["end_utc"], "2026-10-17T17:00:00.000Z")

    def test_counter_reset_even_when_final_value_recovers(self):
        rows = [point(START, 100), point(START + timedelta(minutes=20), 10),
                point(START + timedelta(hours=1), 150)]
        first = history(rows)["data"][0]
        self.assertIsNone(first["ac_wh"])
        self.assertEqual(first["ac_status"], "counter_reset")

    def test_reset_across_interpolated_boundary_is_rejected(self):
        rows = [point(START - timedelta(minutes=10), 100), point(START + timedelta(minutes=10), 5),
                point(START + timedelta(hours=1), 50)]
        self.assertEqual(history(rows)["data"][0]["ac_status"], "counter_reset")

    def test_sql_min_max_conflict_and_duplicate_conflict_excluded(self):
        for rows in ([point(START, 0, high=1), point(START + timedelta(hours=1), 50)],
                     [point(START, 0), point(START, 1), point(START + timedelta(hours=1), 50)]):
            first = history(rows)["data"][0]
            self.assertEqual(first["ac_status"], "conflict")
            self.assertIsNone(first["ac_wh"])

    def test_conflict_inside_bucket_excluded(self):
        rows = [point(START, 0), point(START + timedelta(minutes=30), 20, high=25),
                point(START + timedelta(hours=1), 50)]
        self.assertEqual(history(rows)["data"][0]["ac_status"], "conflict")

    def test_invalid_unknown_and_future_points_ignored(self):
        rows = [point(START, None), point(START, "NaN"), point(START, -1),
                point(START, True), point("bad", 0), point(START, 100, "OTHER"),
                point(NOW + timedelta(days=1), 200)]
        self.assertIsNone(history(rows)["totals"]["ac_wh"])

    def test_ongoing_bucket_latest_counter_and_future_buckets(self):
        now = START + timedelta(hours=2, minutes=20)
        rows = [point(START + timedelta(hours=i), i * 60) for i in range(3)]
        rows += [point(START + timedelta(hours=2, minutes=10), 130), point(now + timedelta(minutes=1), 1000)]
        result = history(rows, now)
        self.assertEqual(result["data"][2]["ac_wh"], 10)
        self.assertTrue(result["data"][2]["in_progress"])
        self.assertEqual(result["data"][2]["end_utc"], "2026-10-16T19:20:00.000Z")
        self.assertEqual(result["data"][3]["ac_status"], "future")
        self.assertIsNone(result["data"][3]["ac_wh"])
        self.assertFalse(result["data"][3]["in_progress"])

    def test_ongoing_bucket_stale_latest_rejected(self):
        result = history([point(START, 0), point(START + timedelta(minutes=10), 10)],
                         START + timedelta(minutes=45))
        self.assertEqual(result["data"][0]["ac_status"], "missing_current")

    def test_week_starts_monday_and_crosses_year(self):
        result = build_history("weekly", "2027-01-01", [], NOW)
        self.assertEqual(result["data"][0]["label"], "2026-12-28")
        self.assertEqual(result["data"][-1]["label"], "2027-01-03")
        self.assertEqual(len(result["data"]), 7)

    def test_month_leap_year_and_yearly_buckets(self):
        result = build_history("monthly", "2024-02-29", [], NOW)
        self.assertEqual(len(result["data"]), 29)
        self.assertEqual(result["end_wib"], "2024-03-01T00:00:00+07:00")
        yearly = build_history("yearly", "2024-08-15", [], NOW)
        self.assertEqual(len(yearly["data"]), 12)
        self.assertEqual(yearly["data"][0]["label"], "2024-01")
        self.assertEqual(yearly["end_wib"], "2025-01-01T00:00:00+07:00")

    def test_default_date_is_wib_and_input_validation(self):
        result = build_history("daily", None, [], START)
        self.assertEqual(result["date"], "2026-10-17")
        for period, selected in (("bad", "2026-01-01"), ("daily", "2026-02-30"),
                                 ("daily", "20261017"), ("yearly", "9999-01-01")):
            with self.assertRaises(ValueError):
                build_history(period, selected, [], NOW)


class HistoryStorageTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config["SMART_OFFICE_SOURCE_ID"] = "office-source"
        self.app.register_blueprint(office_history_bp)
        self.client = self.app.test_client()

    @patch("backend.api.office_history.get_connection")
    def test_parameterized_projection_and_cleanup(self, connection):
        conn = connection.return_value
        cursor = conn.cursor.return_value
        cursor.fetchall.return_value = [point(START, 0), point(START + timedelta(hours=1), 10)]
        with self.app.app_context():
            result = get_history("daily", "2026-10-17", NOW)
        self.assertEqual(result["data"][0]["ac_wh"], 10)
        sql, params = cursor.execute.call_args.args
        self.assertIn("JSON_TABLE", sql)
        self.assertIn("MIN(j.energy_wh)", sql)
        self.assertIn("MAX(j.energy_wh)", sql)
        self.assertIn("max_statement_time=8", sql)
        self.assertIn("t.sampled_at_utc <= %s", sql)
        self.assertEqual(params[0], "office-source")
        self.assertNotIn("office-source", sql)
        self.assertNotIn("ac_hari_wh", sql)
        self.assertLessEqual(params[2], NOW.replace(tzinfo=None))
        cursor.close.assert_called_once()
        conn.close.assert_called_once()

    @patch("backend.api.office_history.get_connection")
    def test_boundary_observation_in_delayed_snapshot_is_included(self, connection):
        cursor = connection.return_value.cursor.return_value
        snapshots = [(START + timedelta(hours=23), point(START + timedelta(hours=23), 0)),
                     (START + timedelta(hours=24), point(START + timedelta(hours=23, minutes=50), 50)),
                     (START + timedelta(hours=24, minutes=40),
                      point(START + timedelta(hours=24, minutes=20), 80))]
        def selected_rows():
            params = cursor.execute.call_args.args[1]
            low, high = params[1].replace(tzinfo=timezone.utc), params[2].replace(tzinfo=timezone.utc)
            return [row for sampled, row in snapshots if low <= sampled <= high]
        cursor.fetchall.side_effect = selected_rows
        with self.app.app_context():
            result = get_history("daily", "2026-10-17", NOW)
        self.assertEqual(result["data"][-1]["ac_wh"], 60)
        self.assertEqual(result["data"][-1]["ac_status"], "partial_estimated")
        params = cursor.execute.call_args.args[1]
        self.assertEqual(params[2], (START + timedelta(hours=25)).replace(tzinfo=None))
        self.assertEqual(params[4], "2026-10-17T17:30:00.000Z")

    @patch("backend.api.office_history.get_connection")
    def test_future_period_does_not_query_database(self, connection):
        with self.app.app_context():
            result = get_history("daily", "2029-01-01", NOW)
        connection.assert_not_called()
        self.assertEqual(result["data"][0]["ac_status"], "future")

    @patch("backend.api.office_history.get_connection")
    def test_query_timeout_sanitized_and_resources_closed(self, connection):
        conn = connection.return_value
        conn.cursor.return_value.execute.side_effect = mysql.connector.Error("secret SQL host password")
        with self.app.app_context(), self.assertRaises(HistoryUnavailable) as error:
            get_history("daily", "2026-10-17", NOW)
        self.assertNotIn("secret", str(error.exception))
        conn.cursor.return_value.close.assert_called_once()
        conn.close.assert_called_once()

    @patch("backend.api.office_history.get_connection")
    def test_connection_failure_and_cursor_failure(self, connection):
        connection.side_effect = mysql.connector.Error("secret")
        with self.app.app_context(), self.assertRaises(HistoryUnavailable):
            get_history("daily", "2026-10-17", NOW)
        connection.side_effect = None
        conn = connection.return_value
        conn.cursor.side_effect = mysql.connector.Error("secret")
        with self.app.app_context(), self.assertRaises(HistoryUnavailable):
            get_history("daily", "2026-10-17", NOW)
        conn.close.assert_called_once()

    @patch("backend.api.office_history.get_connection")
    def test_cleanup_error_does_not_mask_success(self, connection):
        conn = connection.return_value
        conn.cursor.return_value.fetchall.return_value = []
        conn.cursor.return_value.close.side_effect = mysql.connector.Error("cleanup")
        with self.app.app_context():
            self.assertEqual(get_history("daily", "2026-10-17", NOW)["status"], "success")
        conn.close.assert_called_once()

    @patch("backend.api.office_history.get_history")
    def test_route_contract_and_sanitized_error(self, get):
        get.return_value = {"status": "success", "unit": "Wh", "data": []}
        response = self.client.get("/api/smart-office/history?period=weekly&date=2026-10-17")
        self.assertEqual(response.status_code, 200)
        get.assert_called_with("weekly", "2026-10-17")
        get.side_effect = HistoryUnavailable("secret SQL details")
        response = self.client.get("/api/smart-office/history")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("secret", response.get_data(as_text=True))

    def test_route_rejects_invalid_request_before_connection(self):
        response = self.client.get("/api/smart-office/history?period=yearly&date=2026-02-30")
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
