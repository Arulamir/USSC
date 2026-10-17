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

    def test_republishing_old_measurements_does_not_renew_them(self):
        payload = packet()
        for record in payload["records"]:
            record["power_w_at"] = (NOW - timedelta(minutes=4)).isoformat()
        data = minute_power_data(payload, NOW)
        self.assertIsNone(data["ac_power_w"])
        self.assertIsNone(data["lamp_power_w"])
        self.assertTrue(data["power_stale"])

    def test_old_or_future_packet_is_unavailable(self):
        for difference in (timedelta(seconds=-151), timedelta(seconds=1)):
            with self.subTest(difference=difference):
                data = minute_power_data(packet(NOW + difference), NOW)
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
                     "sampled_at_utc": "2026-10-17T05:50:00Z"}
        self.session_patch = patch("backend.api.smart_office.requests.Session")
        self.factory = self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.session = self.factory.return_value.__enter__.return_value
        self.response = self.session.get.return_value
        self.response.status_code = 200
        self.response.content = b"test"
        self.response.json.return_value = {"status": "success", "data": packet(datetime.now(timezone.utc))}

    def test_read_only_bridge_keeps_energy_and_environment(self):
        payload = self.response.json.return_value['data']
        for record in payload['records']:
            if record['device_eui'] in AC_METERS:
                at = datetime.fromisoformat(payload['sampled_at_utc'].replace('Z', '+00:00'))
                record['energy_points'] = [
                    {'at': (at - timedelta(minutes=1)).isoformat(), 'wh': 1000},
                    {'at': at.isoformat(), 'wh': 1015},
                ]
        data = merge_minute_power(self.data)
        self.assertEqual(data['ac_minute_wh'], 60)
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

    def test_timeout_clears_old_watts_without_touching_wh(self):
        self.session.get.side_effect = requests.Timeout("private-token")
        data = merge_minute_power(self.data)
        self.assertIsNone(data["ac_power_w"])
        self.assertEqual(data["ac_day_wh"], 1234)
        self.assertTrue(data["power_stale"])
        self.assertNotIn("private-token", str(data))

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
