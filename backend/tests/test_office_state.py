import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import requests
from flask import Flask

from backend.api.office_control import office_control_bp
from backend.api.office_state import METERS, StateUnavailable, device_states

NOW = datetime(2026, 11, 3, 3, 0, tzinfo=timezone.utc)


def stamp(now=NOW):
    return now.isoformat().replace("+00:00", "Z")


def packet():
    return {"type": "office_device_states", "version": 1, "source_id": "ug65-ussc",
            "served_at_utc": stamp(), "relays": {
                "type": "office_relay_state", "version": 1, "source_id": "ug65-ussc",
                "sampled_at_utc": stamp(), "records": [{"device_eui": eui,
                    "switch_1": "on", "switch_2": "on", "switch_1_at_utc": stamp(),
                    "switch_2_at_utc": stamp()} for eui in sorted(METERS)]}, "ac": None}


class DeviceStateTests(unittest.TestCase):
    def test_all_on_requires_all_reported_channels(self):
        data = device_states(packet(), now=NOW)
        for target in ("WS502_RUANG_UTAMA", "WS502_RUANG_MAGANG", "WS502_BU_DINI", "WS502_ALL"):
            self.assertEqual(data[target]["state"], "on")
            self.assertEqual(data[target]["source"], "ws502_relay")
            self.assertFalse(data[target]["stale"])
        self.assertIsNone(data["AC_KANTOR"]["state"])

    def test_real_off_and_mixed_are_distinct_from_missing(self):
        payload = packet()
        record = next(r for r in payload["relays"]["records"] if r["device_eui"] == "24E1247710633F88")
        record.update(switch_1="off", switch_2="off")
        data = device_states(payload, now=NOW)
        self.assertEqual(data["WS502_RUANG_MAGANG"]["state"], "off")
        self.assertEqual(data["WS502_ALL"]["state"], "mixed")
        record["switch_2"] = "on"
        self.assertEqual(device_states(payload, now=NOW)["WS502_RUANG_MAGANG"]["state"], "mixed")
        record["switch_2"] = None
        self.assertIsNone(device_states(payload, now=NOW)["WS502_RUANG_MAGANG"]["state"])

    def test_director_lamp_is_on_when_either_channel_is_on(self):
        for first, second, expected in (
                ("on", "on", "on"), ("on", "off", "on"),
                ("off", "on", "on"), ("off", "off", "off"),
                ("on", None, "on"), (None, "on", "on"),
                ("off", None, None), (None, "off", None), (None, None, None)):
            with self.subTest(first=first, second=second):
                payload = packet()
                record = next(r for r in payload["relays"]["records"]
                              if r["device_eui"] == "24E1247710638799")
                record.update(switch_1=first, switch_2=second)
                data = device_states(payload, now=NOW)
                self.assertEqual(data["WS502_BU_DINI"]["state"], expected)
                if {first, second} == {"on", "off"}:
                    self.assertEqual(data["WS502_ALL"]["state"], "mixed")

    def test_director_on_preserves_the_on_channel_time_and_staleness(self):
        payload = packet()
        record = next(r for r in payload["relays"]["records"]
                      if r["device_eui"] == "24E1247710638799")
        old = stamp(NOW - timedelta(hours=1))
        record.update(switch_1="off", switch_2="on", switch_2_at_utc=old)
        data = device_states(payload, now=NOW)["WS502_BU_DINI"]
        self.assertEqual(data["state"], "on")
        self.assertEqual(data["observed_at_utc"], old.replace("Z", ".000Z"))
        self.assertTrue(data["stale"])

    def test_old_observation_keeps_state_and_original_time(self):
        payload = packet()
        old = stamp(NOW - timedelta(hours=1))
        for record in payload["relays"]["records"]:
            record.update(switch_1_at_utc=old, switch_2_at_utc=old)
        data = device_states(payload, now=NOW)
        self.assertEqual(data["WS502_ALL"]["state"], "on")
        self.assertTrue(data["WS502_ALL"]["stale"])
        self.assertEqual(data["WS502_ALL"]["observed_at_utc"], old.replace("Z", ".000Z"))

    def test_stale_relay_packet_is_marked_even_with_recent_channel_times(self):
        payload = packet()
        payload["relays"]["sampled_at_utc"] = stamp(NOW - timedelta(minutes=3))
        for record in payload["relays"]["records"]:
            record.update(switch_1_at_utc=stamp(NOW - timedelta(minutes=3)),
                          switch_2_at_utc=stamp(NOW - timedelta(minutes=3)))
        self.assertTrue(device_states(payload, now=NOW)["WS502_ALL"]["stale"])

    def test_missing_duplicate_and_future_channels_do_not_confirm_on(self):
        for mode in ("missing", "duplicate", "future", "numeric", "invalid"):
            with self.subTest(mode=mode):
                payload = packet()
                record = next(r for r in payload["relays"]["records"] if r["device_eui"] == "24E1247710630110")
                if mode == "missing": payload["relays"]["records"].remove(record)
                elif mode == "duplicate": payload["relays"]["records"].append(dict(record))
                elif mode == "future": record["switch_1_at_utc"] = stamp(NOW + timedelta(seconds=1))
                elif mode == "numeric": record["switch_1"] = 1
                else: record["switch_1"] = "invalid"
                if mode == "duplicate":
                    with self.assertRaises(StateUnavailable): device_states(payload, now=NOW)
                else: self.assertIsNone(device_states(payload, now=NOW)["WS502_RUANG_UTAMA"]["state"])

    def test_ir_state_is_explicitly_tasmota_not_relay_or_measured_power(self):
        payload = packet()
        payload["ac"] = {"state": "off", "source": "tasmota_ir_sent", "observed_at_utc": stamp()}
        data = device_states(payload, now=NOW)["AC_KANTOR"]
        self.assertEqual(data["state"], "off")
        self.assertEqual(data["source"], "tasmota_ir_sent")
        payload["ac"]["online"] = False
        self.assertTrue(device_states(payload, now=NOW)["AC_KANTOR"]["stale"])
        for source in ("power_w", "command_ack", "ws502_relay", "unknown"):
            payload["ac"]["source"] = source
            self.assertIsNone(device_states(payload, now=NOW)["AC_KANTOR"]["state"])

    def test_monitoring_accepts_three_minute_clock_skew_without_changing_time(self):
        for seconds in (17, 180):
            payload = packet()
            future = stamp(NOW + timedelta(seconds=seconds))
            payload["served_at_utc"] = future
            payload["relays"]["sampled_at_utc"] = future
            for record in payload["relays"]["records"]:
                record.update(switch_1_at_utc=future, switch_2_at_utc=future)
            payload["ac"] = {"state": "on", "source": "tasmota_ir_sent", "observed_at_utc": future}
            states = device_states(payload, now=NOW)
            self.assertEqual(states["WS502_ALL"]["state"], "on")
            self.assertEqual(states["AC_KANTOR"]["state"], "on")
            self.assertEqual(states["AC_KANTOR"]["observed_at_utc"], future.replace("Z", ".000Z"))
        payload["relays"]["sampled_at_utc"] = stamp(NOW + timedelta(seconds=181))
        with self.assertRaises(StateUnavailable): device_states(payload, now=NOW)

    def test_invalid_source_version_or_served_time_rejected(self):
        for field, value in (("type", "other"), ("version", 2), ("source_id", "other"),
                             ("served_at_utc", stamp(NOW + timedelta(seconds=181))),
                             ("served_at_utc", stamp(NOW - timedelta(minutes=3)))):
            payload = packet(); payload[field] = value
            with self.assertRaises(StateUnavailable): device_states(payload, now=NOW)


class DeviceStateEndpointTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(OFFICE_CONTROL_KEY="upstream-" + "x" * 32,
                               SMART_OFFICE_OPERATOR_KEY="operator-test",
                               SMART_OFFICE_SOURCE_ID="ug65-ussc",
                               SMART_OFFICE_CONTROL_URL="http://100.97.64.86:1880/office1/control")
        self.app.register_blueprint(office_control_bp)
        self.client = self.app.test_client()
        self.headers = {"Authorization": "Bearer operator-test"}

    @patch("backend.api.office_state.requests.Session")
    def test_authenticated_get_reads_only_sanitized_status(self, factory):
        session = factory.return_value.__enter__.return_value
        response = session.get.return_value
        response.status_code = 200; response.content = b"test"
        data = packet(); data["served_at_utc"] = stamp(datetime.now(timezone.utc))
        response.json.return_value = {"status": "success", "data": data, "secret": "never-return"}
        result = self.client.get("/api/smart-office/control/states", headers=self.headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json["states"]["WS502_ALL"]["state"], "on")
        self.assertFalse(result.json["physical_state_confirmed"])
        self.assertNotIn("never-return", result.get_data(as_text=True))
        self.assertEqual(result.headers["Cache-Control"], "no-store")
        self.assertFalse(session.trust_env)
        session.get.assert_called_once_with("http://100.97.64.86:1880/office1/state",
            headers={"Authorization": "Bearer " + self.app.config["OFFICE_CONTROL_KEY"]},
            timeout=(2, 2), allow_redirects=False)
        session.post.assert_not_called()

    @patch("backend.api.office_state.requests.Session")
    def test_anonymous_and_bad_configuration_never_connect(self, factory):
        self.assertEqual(self.client.get("/api/smart-office/control/states").status_code, 401)
        self.app.config["SMART_OFFICE_CONTROL_URL"] = "http://127.0.0.1:1880/office1/control"
        self.assertEqual(self.client.get("/api/smart-office/control/states", headers=self.headers).status_code, 503)
        factory.assert_not_called()

    @patch("backend.api.office_state.requests.Session")
    def test_timeout_redirect_oversize_or_malformed_never_become_off(self, factory):
        session = factory.return_value.__enter__.return_value
        response = session.get.return_value
        for mode in ("timeout", "redirect", "oversize", "json"):
            session.get.side_effect = requests.Timeout("private-token") if mode == "timeout" else None
            response.status_code = 302 if mode == "redirect" else 200
            response.content = b"x" * (32769 if mode == "oversize" else 1)
            response.json.side_effect = ValueError("private-token") if mode == "json" else None
            result = self.client.get("/api/smart-office/control/states", headers=self.headers)
            self.assertEqual(result.status_code, 503)
            self.assertNotIn("private-token", result.get_data(as_text=True))
            self.assertNotIn("states", result.json)
        session.post.assert_not_called()


if __name__ == "__main__": unittest.main()
