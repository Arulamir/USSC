import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import requests
from flask import Flask

from backend.api.smart_office import (
    AC_METERS, LAMP_METERS, merge_minute_power, minute_power_data, smart_office_bp,
)


NOW = datetime(2026, 10, 17, 6, 0, tzinfo=timezone.utc)
URL = "http://100.97.64.86:1880/office1/power"
KEY = "test_only_control_key_1234567890123456789"


def packet(now=NOW):
    stamp = now.isoformat().replace("+00:00", "Z")
    return {
        "type": "office_power", "version": 1, "source_id": "ug65-ussc",
        "sampled_at_utc": stamp, "interval_minutes": 1,
        "records": [{"device_eui": eui, "power_w": 10, "power_w_at": stamp}
                    for eui in sorted(AC_METERS | LAMP_METERS)],
    }


class MinutePowerTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(SMART_OFFICE_SOURCE_ID="ug65-ussc")
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)

    def test_sum_with_zero_and_observation_timestamp(self):
        payload = packet()
        payload["records"][0]["power_w"] = 0
        data = minute_power_data(payload, NOW)
        self.assertEqual(data["ac_power_w"], 30)
        self.assertEqual(data["lamp_power_w"], 40)
        self.assertFalse(data["power_stale"])
        self.assertEqual(data["power_observed_at_utc"], "2026-10-17T06:00:00.000Z")
        self.assertEqual(data["power_quality"]["ac"]["meter_used"], 4)

    def test_old_measurements_remain_visible_without_renewing_their_time(self):
        payload = packet()
        for record in payload["records"]:
            record["power_w_at"] = (NOW - timedelta(minutes=4)).isoformat()
        data = minute_power_data(payload, NOW)
        self.assertEqual(data["ac_power_w"], 40)
        self.assertEqual(data["lamp_power_w"], 40)
        self.assertTrue(data["power_stale"])
        self.assertTrue(data["power_previous"])
        self.assertEqual(data["power_observed_at_utc"], "2026-10-17T05:56:00.000Z")

    def test_old_packet_keeps_readings_but_future_packet_is_rejected(self):
        data = minute_power_data(packet(NOW - timedelta(seconds=151)), NOW)
        self.assertEqual(data["ac_power_w"], 40)
        self.assertTrue(data["power_previous"])
        self.assertTrue(data["power_stale"])
        data = minute_power_data(packet(NOW + timedelta(seconds=1)), NOW)
        self.assertIsNone(data["ac_power_w"])
        self.assertTrue(data["power_stale"])

    def test_partial_missing_future_and_invalid_values(self):
        payload = packet()
        ac = [r for r in payload["records"] if r["device_eui"] in AC_METERS]
        ac[0]["power_w"] = 0
        ac[1]["power_w_at"] = (NOW + timedelta(seconds=1)).isoformat()
        ac[2]["power_w"] = True
        ac[3]["power_w"] = -1
        data = minute_power_data(payload, NOW)
        self.assertEqual(data["ac_power_w"], 0)
        self.assertEqual(data["power_quality"]["ac"]["meter_used"], 1)

    def test_duplicate_meter_is_ambiguous_even_if_one_copy_is_old(self):
        payload = packet()
        first = payload["records"][0]
        payload["records"][1] = {**first, "power_w_at": (NOW - timedelta(minutes=4)).isoformat()}
        data = minute_power_data(payload, NOW)
        self.assertEqual(data["ac_power_w"], 20)

    def test_unexpected_source_interval_or_type_rejected(self):
        for field, value in (("source_id", "other"), ("interval_minutes", 10),
                             ("type", "office_control"), ("version", 2),
                             ("records", {}), ("sampled_at_utc", "invalid")):
            with self.subTest(field=field):
                payload = packet()
                payload[field] = value
                self.assertTrue(minute_power_data(payload, NOW)["power_stale"])

    def test_above_door_meter_excluded(self):
        payload = packet()
        payload["records"][0] = {"device_eui": "24E124148060FAKE", "power_w": 10000,
                                  "power_w_at": NOW.isoformat()}
        self.assertEqual(minute_power_data(payload, NOW)["ac_power_w"], 30)


class MinutePowerBridgeTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(SMART_OFFICE_SOURCE_ID="ug65-ussc",
                               SMART_OFFICE_POWER_URL=URL, OFFICE_CONTROL_KEY=KEY)
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.data = {"ac_power_w": 999, "lamp_power_w": 888,
                     "ac_day_wh": 1234, "illumination": "bright",
                     "sampled_at_utc": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(timespec="milliseconds")}
        self.session_patch = patch("backend.api.smart_office.requests.Session")
        self.factory = self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.session = self.factory.return_value.__enter__.return_value
        self.response = self.session.get.return_value
        self.response.status_code = 200
        self.response.content = b"test"
        self.response.json.return_value = {"status": "success", "data": packet(datetime.now(timezone.utc))}

    def test_read_only_bridge_keeps_energy_and_environment(self):
        data = merge_minute_power(self.data)
        self.assertEqual(data["ac_power_w"], 40)
        self.assertEqual(data["lamp_power_w"], 40)
        self.assertEqual(data["ac_day_wh"], 1234)
        self.assertEqual(data["illumination"], "bright")
        self.assertEqual(data["sampled_at_utc"], self.data["sampled_at_utc"])
        self.session.get.assert_called_once_with(
            URL, headers={"Authorization": "Bearer " + KEY},
            timeout=(2, 2), allow_redirects=False,
        )
        self.assertFalse(self.session.trust_env)
        self.session.post.assert_not_called()

    def test_opt_out_keeps_existing_snapshot_and_does_not_connect(self):
        self.app.config["SMART_OFFICE_POWER_URL"] = ""
        self.assertIs(merge_minute_power(self.data), self.data)
        self.factory.assert_not_called()

    def test_timeout_keeps_snapshot_watts_without_touching_wh(self):
        self.session.get.side_effect = requests.Timeout("private-token")
        data = merge_minute_power(self.data)
        self.assertEqual(data["ac_power_w"], 999)
        self.assertEqual(data["lamp_power_w"], 888)
        self.assertEqual(data["ac_day_wh"], 1234)
        self.assertTrue(data["power_stale"])
        self.assertTrue(data["power_previous"])
        self.assertEqual(data["power_observed_at_utc"], self.data["sampled_at_utc"].replace("+00:00", "Z"))
        self.assertNotIn("private-token", str(data))

    def test_last_minute_zero_survives_timeout_and_an_older_snapshot(self):
        payload = packet(datetime.now(timezone.utc))
        for record in payload["records"]:
            record["power_w"] = 0
        self.response.json.return_value = {"status": "success", "data": payload}
        first = merge_minute_power(self.data)
        self.assertEqual(first["ac_power_w"], 0)
        self.session.get.side_effect = requests.Timeout()
        retained = merge_minute_power(self.data)
        self.assertEqual(retained["ac_power_w"], 0)
        self.assertEqual(retained["lamp_power_w"], 0)
        self.assertEqual(retained["power_observed_at_utc"], first["power_observed_at_utc"])
        self.assertTrue(retained["power_previous"])

    def test_missing_ac_keeps_previous_ac_while_lamps_update(self):
        first = merge_minute_power(self.data)
        payload = packet(datetime.now(timezone.utc))
        payload["records"] = [r for r in payload["records"] if r["device_eui"] in LAMP_METERS]
        for record in payload["records"]:
            record["power_w"] = 20
        self.response.json.return_value = {"status": "success", "data": payload}
        result = merge_minute_power(self.data)
        self.assertEqual(result["ac_power_w"], first["ac_power_w"])
        self.assertEqual(result["lamp_power_w"], 80)
        self.assertTrue(result["power_previous"])

    def test_older_packet_cannot_replace_a_newer_retained_reading(self):
        first = merge_minute_power(self.data)
        payload = packet(datetime.now(timezone.utc) - timedelta(minutes=5))
        for record in payload["records"]:
            record["power_w"] = 200
        self.response.json.return_value = {"status": "success", "data": payload}
        result = merge_minute_power(self.data)
        self.assertEqual(result["ac_power_w"], first["ac_power_w"])
        self.assertEqual(result["power_observed_at_utc"], first["power_observed_at_utc"])
        self.assertTrue(result["power_previous"])

    def test_new_meter_update_is_not_blocked_by_an_older_meter_in_the_group(self):
        now = datetime.now(timezone.utc)
        first_packet = packet(now - timedelta(minutes=2))
        self.response.json.return_value = {"status": "success", "data": first_packet}
        self.assertEqual(merge_minute_power(self.data)["ac_power_w"], 40)
        next_packet = packet(now)
        ac_records = [r for r in next_packet["records"] if r["device_eui"] in AC_METERS]
        ac_records[0]["power_w_at"] = (now - timedelta(minutes=5)).isoformat()
        ac_records[1]["power_w"] = 100
        self.response.json.return_value = {"status": "success", "data": next_packet}
        result = merge_minute_power(self.data)
        self.assertEqual(result["ac_power_w"], 130)
        self.assertEqual(result["power_observed_at_by_group"]["ac"],
                         (now - timedelta(minutes=5)).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    def test_no_previous_reading_stays_unknown_instead_of_becoming_zero(self):
        self.session.get.side_effect = requests.Timeout()
        self.data.update(ac_power_w=None, lamp_power_w=None)
        result = merge_minute_power(self.data)
        self.assertIsNone(result["ac_power_w"])
        self.assertIsNone(result["lamp_power_w"])
        self.assertIsNone(result["power_observed_at_utc"])

    def test_retained_readings_are_isolated_by_source(self):
        merge_minute_power(self.data)
        self.app.config["SMART_OFFICE_SOURCE_ID"] = "different-office"
        self.session.get.side_effect = requests.Timeout()
        result = merge_minute_power(self.data)
        self.assertEqual(result["ac_power_w"], 999)

    def test_redirect_bad_json_and_oversized_packet_are_unavailable(self):
        for mode in ("redirect", "json", "size"):
            with self.subTest(mode=mode):
                self.response.status_code = 302 if mode == "redirect" else 200
                self.response.content = b"x" * (32769 if mode == "size" else 1)
                self.response.json.side_effect = ValueError("private") if mode == "json" else None
                self.assertTrue(merge_minute_power(self.data)["power_stale"])

    def test_non_tailnet_url_wrong_path_or_invalid_key_never_connects(self):
        for url in ("http://127.0.0.1:1880/office1/power", "http://100.97.64.86:1880/office1/control",
                    "http://100.97.64.86:1880/office1/power?token=secret",
                    "http://user:secret@100.97.64.86:1880/office1/power"):
            with self.subTest(url=url):
                self.app.config["SMART_OFFICE_POWER_URL"] = url
                self.assertTrue(merge_minute_power(self.data)["power_stale"])
        self.app.config.update(SMART_OFFICE_POWER_URL=URL, OFFICE_CONTROL_KEY="short")
        self.assertTrue(merge_minute_power(self.data)["power_stale"])
        self.factory.assert_not_called()

    def test_endpoint_merges_power_without_changing_snapshot_query(self):
        self.app.register_blueprint(smart_office_bp)
        row = {"sampled_at_utc": datetime.now(timezone.utc), "interval_minutes": 10,
               "device_samples": [], "ac_hari_wh": 500, "lampu_hari_wh": 50}
        connection = MagicMock()
        connection.cursor.return_value.fetchone.return_value = row
        with patch("backend.api.smart_office.get_connection", return_value=connection):
            response = self.app.test_client().get("/api/smart-office")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["data"]["ac_power_w"], 40)
        self.assertEqual(response.json["data"]["ac_day_wh"], 500)
        self.assertEqual(response.json["data"]["interval_minutes"], 10)
        self.assertEqual(response.json["data"]["power_interval_minutes"], 1)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(connection.cursor.return_value.execute.call_count, 1)


if __name__ == "__main__":
    unittest.main()
