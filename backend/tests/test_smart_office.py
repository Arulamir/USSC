import json
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

import mysql.connector
from flask import Flask

from backend.api.smart_office import (
    AC_METERS, ENV_SENSOR, LAMP_METERS, smart_office_bp, snapshot_data,
)


NOW = datetime(2026, 10, 17, 5, 0, tzinfo=timezone.utc)


def stamp(minutes=0):
    return (NOW - timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")


def record(eui, value=100, age=0):
    return {"device_eui": eui, "power_w": value, "power_w_at": stamp(age)}


def snapshot(records=None):
    env = {"device_eui": ENV_SENSOR}
    for field in ("occupancy", "temperature_c", "humidity_pct", "illumination"):
        env[field + "_at"] = stamp()
    return {
        "sampled_at_utc": NOW.replace(tzinfo=None),
        "interval_minutes": 10,
        "occupancy": "occupied", "temperature_c": Decimal("25.2"),
        "humidity_pct": Decimal("61.4"), "illumination": "bright",
        "device_samples": [env] + (records or []),
    }


class SnapshotTests(unittest.TestCase):
    def test_all_meters_and_environment(self):
        records = [record(eui) for eui in AC_METERS]
        records += [record(eui, 30.5) for eui in LAMP_METERS]
        records += [record("ATAS_PINTU", 9999)]
        row = snapshot(records)
        row["device_samples"] = json.dumps(row["device_samples"])
        data = snapshot_data(row, NOW)
        self.assertEqual(data["ac_power_w"], 400)
        self.assertEqual(data["lamp_power_w"], 122)
        self.assertEqual(data["power_quality"]["ac"], {"meter_used": 4, "meter_expected": 4})
        self.assertEqual(data["temperature_c"], 25.2)
        self.assertEqual(data["humidity_pct"], 61.4)
        self.assertEqual(data["occupancy"], "occupied")
        self.assertEqual(data["illumination"], "bright")
        self.assertEqual(data["sampled_at_utc"], "2026-10-17T05:00:00.000Z")
        self.assertFalse(data["stale"])

    def test_partial_counts_zero_and_field_level_quality(self):
        meters = sorted(AC_METERS)
        records = [record(meters[0], 0), record(meters[1], 999, age=31),
                   record(meters[2], None), record(meters[3], 999, age=-1)]
        records[0]["quality"] = "partial"  # Another field can be missing.
        data = snapshot_data(snapshot(records), NOW)
        self.assertEqual(data["ac_power_w"], 0)
        self.assertEqual(data["power_quality"]["ac"]["meter_used"], 1)
        self.assertIsNone(data["lamp_power_w"])
        self.assertEqual(data["power_quality"]["lamp"]["meter_used"], 0)

    def test_duplicate_and_invalid_meter_values_are_excluded(self):
        meters = sorted(AC_METERS)
        records = [record(meters[0]), record(meters[0]), record(meters[1], "NaN"),
                   record(meters[2], -1), record(meters[3], True), {"device_eui": None}]
        data = snapshot_data(snapshot(records), NOW)
        self.assertIsNone(data["ac_power_w"])
        self.assertEqual(data["power_quality"]["ac"]["meter_used"], 0)

    def test_field_freshness_and_null_environment(self):
        row = snapshot()
        env = row["device_samples"][0]
        env["occupancy_at"] = stamp(16)
        env["temperature_c_at"] = stamp(31)
        env["humidity_pct_at"] = stamp(-1)
        env["illumination_at"] = None
        data = snapshot_data(row, NOW)
        for field in ("occupancy", "temperature_c", "humidity_pct", "illumination"):
            self.assertIsNone(data[field])
        row = snapshot()
        row["occupancy"] = None
        row["temperature_c"] = 0
        row["humidity_pct"] = 0
        data = snapshot_data(row, NOW)
        self.assertIsNone(data["occupancy"])
        self.assertEqual(data["temperature_c"], 0)
        self.assertEqual(data["humidity_pct"], 0)

    def test_boundaries_and_utc_normalization(self):
        row = snapshot([record(next(iter(AC_METERS)), 5, age=30)])
        env = row["device_samples"][0]
        env["occupancy_at"] = stamp(15)
        env["temperature_c_at"] = stamp(30)
        data = snapshot_data(row, NOW + timedelta(minutes=30))
        self.assertFalse(data["stale"])
        self.assertEqual(data["ac_power_w"], 5)
        self.assertEqual(data["occupancy"], "occupied")
        self.assertEqual(data["temperature_c"], 25.2)
        self.assertTrue(snapshot_data(row, NOW + timedelta(minutes=30, seconds=1))["stale"])
        self.assertTrue(snapshot_data(row, NOW - timedelta(seconds=1))["stale"])
        row["sampled_at_utc"] = "2026-10-17T12:00:00+07:00"
        self.assertEqual(snapshot_data(row, NOW)["sampled_at_utc"], data["sampled_at_utc"])

    def test_malformed_samples_and_timestamp(self):
        for samples in ("not json", "{}", None):
            row = snapshot()
            row["device_samples"] = samples
            with self.assertRaises(ValueError):
                snapshot_data(row, NOW)
        row = snapshot()
        row["sampled_at_utc"] = "invalid"
        with self.assertRaises(ValueError):
            snapshot_data(row, NOW)

    def test_daily_energy_uses_stored_snapshot_totals_and_preserves_zero(self):
        row = snapshot([record(next(iter(AC_METERS)), 999)])
        row.update(ac_hari_wh=Decimal("1234.567"), lampu_hari_wh=Decimal("0.000"))
        data = snapshot_data(row, NOW)
        self.assertEqual(data["ac_day_wh"], 1234.567)
        self.assertEqual(data["lamp_day_wh"], 0)
        self.assertEqual(data["energy_date_wib"], "2026-10-17")
        self.assertEqual(data["ac_power_w"], 999)

    def test_daily_energy_missing_and_invalid_values_stay_null(self):
        for value in (None, -1, "NaN", True, "bad"):
            row = snapshot()
            row.update(ac_hari_wh=value, lampu_hari_wh=value)
            data = snapshot_data(row, NOW)
            self.assertIsNone(data["ac_day_wh"])
            self.assertIsNone(data["lamp_day_wh"])
        data = snapshot_data(snapshot(), NOW)
        self.assertIsNone(data["ac_day_wh"])
        self.assertIsNone(data["lamp_day_wh"])

    def test_daily_energy_date_follows_snapshot_wib_midnight(self):
        row = snapshot()
        row.update(ac_hari_wh=100, lampu_hari_wh=20)
        row["sampled_at_utc"] = "2026-10-17T16:59:59Z"
        self.assertEqual(snapshot_data(row, NOW)["energy_date_wib"], "2026-10-17")
        row["sampled_at_utc"] = "2026-10-17T17:00:00Z"
        self.assertEqual(snapshot_data(row, NOW)["energy_date_wib"], "2026-10-18")
        row["sampled_at_utc"] = "2026-10-18T00:00:00+07:00"
        self.assertEqual(snapshot_data(row, NOW)["energy_date_wib"], "2026-10-18")

    def test_stale_daily_energy_retains_its_actual_snapshot_date(self):
        row = snapshot()
        row.update(ac_hari_wh=Decimal("987.500"), lampu_hari_wh=0)
        data = snapshot_data(row, NOW + timedelta(days=1))
        self.assertTrue(data["stale"])
        self.assertEqual(data["energy_date_wib"], "2026-10-17")
        self.assertEqual(data["ac_day_wh"], 987.5)
        self.assertEqual(data["lamp_day_wh"], 0)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, SMART_OFFICE_SOURCE_ID="gateway-test")
        self.app.register_blueprint(smart_office_bp)
        self.client = self.app.test_client()
        self.conn = MagicMock()
        self.cursor = self.conn.cursor.return_value
        self.patcher = patch("backend.api.smart_office.get_connection", return_value=self.conn)
        self.connect = self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_empty_snapshot_success_and_cleanup(self):
        self.cursor.fetchone.return_value = None
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, {"status": "success", "data": None})
        sql, params = self.cursor.execute.call_args.args
        self.assertIn("FROM office1", sql)
        self.assertIn("ORDER BY sampled_at_utc DESC", sql)
        self.assertNotIn("office1_device_backup", sql)
        self.assertEqual(params, ("gateway-test",))
        self.cursor.close.assert_called_once()
        self.conn.close.assert_called_once()

    def test_snapshot_response(self):
        self.cursor.fetchone.return_value = snapshot([record(next(iter(AC_METERS)), 0)])
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "success")
        self.assertEqual(response.json["data"]["ac_power_w"], 0)

    def test_snapshot_daily_totals_are_selected_directly_without_sum(self):
        row = snapshot()
        row.update(ac_hari_wh=Decimal("250.125"), lampu_hari_wh=Decimal("12.750"))
        self.cursor.fetchone.return_value = row
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 200)
        data = response.json["data"]
        self.assertEqual(data["ac_day_wh"], 250.125)
        self.assertEqual(data["lamp_day_wh"], 12.75)
        self.assertEqual(data["energy_date_wib"], "2026-10-17")
        sql = self.cursor.execute.call_args.args[0]
        self.assertIn("ac_hari_wh", sql)
        self.assertIn("lampu_hari_wh", sql)
        self.assertNotIn("SUM(", sql.upper())
        self.cursor.fetchone.assert_called_once()
        self.cursor.fetchall.assert_not_called()

    def test_query_failure_sanitized_and_resources_closed(self):
        self.cursor.execute.side_effect = mysql.connector.Error("private-password@db-host")
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private", response.get_data(as_text=True))
        self.cursor.close.assert_called_once()
        self.conn.close.assert_called_once()

    def test_connect_failure_is_503(self):
        self.connect.side_effect = mysql.connector.Error("private-account")
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private-account", response.get_data(as_text=True))

    def test_cursor_failure_closes_connection(self):
        self.conn.cursor.side_effect = mysql.connector.Error("cursor failure")
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 503)
        self.conn.close.assert_called_once()

    def test_invalid_stored_json_is_sanitized_503(self):
        row = snapshot()
        row["device_samples"] = "not-json"
        self.cursor.fetchone.return_value = row
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 503)
        self.cursor.close.assert_called_once()
        self.conn.close.assert_called_once()

    def test_cleanup_failure_still_closes_connection(self):
        self.cursor.fetchone.return_value = None
        self.cursor.close.side_effect = mysql.connector.Error("cleanup failure")
        response = self.client.get("/api/smart-office")
        self.assertEqual(response.status_code, 200)
        self.conn.close.assert_called_once()

    def test_connection_uses_separate_database_configuration(self):
        self.patcher.stop()
        from backend.api.smart_office import get_connection
        self.app.config.update(
            SMART_OFFICE_DB_HOST="office-db", SMART_OFFICE_DB_PORT=3307,
            SMART_OFFICE_DB_USER="reader", SMART_OFFICE_DB_PASSWORD="example-only",
            SMART_OFFICE_DB_NAME="smart_office",
        )
        with self.app.app_context(), patch("backend.api.smart_office.mysql.connector.connect") as connect:
            get_connection()
        connect.assert_called_once_with(
            host="office-db", port=3307, user="reader", password="example-only",
            database="smart_office", connection_timeout=5,
        )


if __name__ == "__main__":
    unittest.main()
