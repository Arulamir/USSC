import unittest
from unittest.mock import MagicMock, patch

import requests
from flask import Flask

from backend.api.office_control import DEVICE_IDS, office_control_bp, valid_control_url


OPERATOR_KEY = "testop08"
UPSTREAM_KEY = "nodered-key-" + "n" * 32
CONTROL_URL = "http://100.97.64.86:1880/office1/control"
REQUEST_ID = "test-request-1234"
BODY = {"device": "AC_KANTOR", "state": "off"}


class OfficeControlTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(
            TESTING=True, OFFICE_CONTROL_KEY=UPSTREAM_KEY,
            SMART_OFFICE_OPERATOR_KEY=OPERATOR_KEY,
            SMART_OFFICE_CONTROL_URL=CONTROL_URL,
        )
        self.app.register_blueprint(office_control_bp)
        self.client = self.app.test_client()
        self.headers = {"Authorization": "Bearer " + OPERATOR_KEY, "X-Request-Id": REQUEST_ID}
        self.session_patch = patch("backend.api.office_control.requests.Session")
        self.session_factory = self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.session = self.session_factory.return_value.__enter__.return_value
        self.upstream = MagicMock(status_code=200)
        self.upstream.json.return_value = dict(
            BODY, request_id=REQUEST_ID, status="accepted_by_ug65", physical_state_confirmed=False,
        )
        self.session.post.return_value = self.upstream

    def post(self, **kwargs):
        return self.client.post("/api/smart-office/control", headers=self.headers,
                                **({"json": BODY} | kwargs))

    def assert_no_secrets(self, response):
        content = response.get_data(as_text=True)
        self.assertNotIn(OPERATOR_KEY, content)
        self.assertNotIn(UPSTREAM_KEY, content)
        self.assertNotIn("100.97.64.86", content)
        self.assertFalse(response.json["physical_state_confirmed"])
        self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_anonymous_and_wrong_operator_cannot_control_or_list(self):
        for path in ("/api/smart-office/control", "/api/smart-office/control/devices"):
            for token in (None, "wrong", UPSTREAM_KEY, "é" * 32):
                with self.subTest(path=path, token=token):
                    headers = {} if token is None else {"Authorization": "Bearer " + token}
                    response = (self.client.get(path, headers=headers) if path.endswith("devices")
                                else self.client.post(path, headers=headers, json=BODY))
                    self.assertEqual(response.status_code, 401)
                    self.assert_no_secrets(response)
        self.session_factory.assert_not_called()

    def test_configuration_fails_closed(self):
        for config in ({"OFFICE_CONTROL_KEY": ""}, {"OFFICE_CONTROL_KEY": "x" * 31},
                       {"SMART_OFFICE_OPERATOR_KEY": "short07"},
                       {"OFFICE_CONTROL_KEY": UPSTREAM_KEY, "SMART_OFFICE_OPERATOR_KEY": UPSTREAM_KEY},
                       {"OFFICE_CONTROL_KEY": "x" * 32 + "\r\nInjected: yes"},
                       {"OFFICE_CONTROL_KEY": "é" * 32},
                       {"SMART_OFFICE_CONTROL_URL": "http://127.0.0.1:1880/office1/control"}):
            with self.subTest(config=list(config)):
                old = {key: self.app.config[key] for key in config}
                self.app.config.update(config)
                response = self.post()
                self.assertEqual(response.status_code, 503)
                self.assert_no_secrets(response)
                self.app.config.update(old)
        self.session_factory.assert_not_called()

    def test_lists_exact_supported_targets_without_status_claim(self):
        response = self.client.get("/api/smart-office/control/devices", headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual({device["id"] for device in response.json["devices"]}, DEVICE_IDS)
        self.assertEqual(len(response.json["devices"]), 5)
        self.assertIn("WS502_RUANG_UTAMA", DEVICE_IDS)
        self.assertNotIn("WS502_RUANG_UTAMA_A", DEVICE_IDS)
        self.assertNotIn("WS502_RUANG_UTAMA_B", DEVICE_IDS)
        self.assert_no_secrets(response)
        self.session_factory.assert_not_called()

    def test_invalid_json_targets_and_states_never_forward(self):
        for body in (None, [], "on", {}, {"device": "other", "state": "on"},
                     {"device": [], "state": "on"}, {"device": "AC_KANTOR", "state": {}},
                     {"device": "AC_KANTOR", "state": "ON"}, dict(BODY, url=CONTROL_URL)):
            with self.subTest(body=body):
                self.assertEqual(self.post(json=body).status_code, 400)
        response = self.client.post("/api/smart-office/control", headers=self.headers,
                                    data='{"device":"AC_KANTOR","state":"off"}',
                                    content_type="text/plain")
        self.assertEqual(response.status_code, 400)
        self.session_factory.assert_not_called()

    def test_request_id_required_and_restricted(self):
        for value in ("", "short", "x" * 81, "a.b.c.d.e", "spaces not valid"):
            with self.subTest(value=value):
                self.headers["X-Request-Id"] = value
                self.assertEqual(self.post().status_code, 400)
        self.session_factory.assert_not_called()

    def test_accepted_forwards_exact_protocol_and_does_not_claim_physical_success(self):
        # The response must strip even secrets accidentally returned by Node-RED.
        self.upstream.json.return_value.update(key=UPSTREAM_KEY, diagnostic=CONTROL_URL)
        response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "accepted_by_ug65")
        self.assert_no_secrets(response)
        self.assertFalse(self.session.trust_env)
        self.session.post.assert_called_once_with(
            CONTROL_URL, json=BODY,
            headers={"Authorization": "Bearer " + UPSTREAM_KEY, "X-Request-Id": REQUEST_ID},
            timeout=(3, 12), allow_redirects=False,
        )

    def test_duplicate_request_id_preserved_for_nodered_idempotency(self):
        for _ in range(2):
            self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.session.post.call_count, 2)
        for call in self.session.post.call_args_list:
            self.assertEqual(call.kwargs["headers"]["X-Request-Id"], REQUEST_ID)

    def test_timeout_or_network_error_never_retries(self):
        for exception, expected_code in ((requests.Timeout("secret " + UPSTREAM_KEY), 504),
                                         (requests.ConnectionError(CONTROL_URL), 503)):
            with self.subTest(exception=type(exception).__name__):
                self.session.post.reset_mock()
                self.session.post.side_effect = exception
                response = self.post()
                self.assertEqual(response.status_code, expected_code)
                self.assertEqual(response.json["status"], "unknown")
                self.assertIn("jangan ulangi otomatis", response.json["detail"].lower())
                self.assert_no_secrets(response)
                self.session.post.assert_called_once()

    def test_upstream_error_status_preserved_bodies_sanitized(self):
        for code in (401, 403, 409, 429, 503, 504):
            with self.subTest(code=code):
                self.upstream.status_code = code
                self.upstream.json.return_value = {"error": UPSTREAM_KEY + CONTROL_URL}
                response = self.post()
                self.assertEqual(response.status_code, code)
                self.assert_no_secrets(response)

    def test_non_200_or_redirect_never_accepted(self):
        for code in (201, 202, 301, 302, 307, 500):
            with self.subTest(code=code):
                self.upstream.status_code = code
                response = self.post()
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json["status"], "unknown")
                self.assert_no_secrets(response)

    def test_malformed_or_mismatched_ack_never_accepted(self):
        correct = dict(self.upstream.json.return_value)
        for ack in (None, [], "okay", {}, dict(correct, request_id="another-request"),
                    dict(correct, device="WS502_ALL"), dict(correct, state="on"),
                    dict(correct, status="success"), dict(correct, physical_state_confirmed=True)):
            with self.subTest(ack=ack):
                self.upstream.json.return_value = ack
                response = self.post()
                self.assertEqual(response.status_code, 502)
                self.assert_no_secrets(response)
        self.upstream.json.side_effect = ValueError("invalid json " + UPSTREAM_KEY)
        self.assertEqual(self.post().status_code, 502)


class ControlURLTests(unittest.TestCase):
    def test_allow_only_fixed_route_on_tailnet_literal(self):
        for url in (CONTROL_URL, "https://100.97.64.86/office1/control"):
            self.assertTrue(valid_control_url(url), url)
        for url in (None, "", "file:///office1/control", "http://localhost:1880/office1/control",
                    "http://127.0.0.1:1880/office1/control", "http://192.168.1.1/office1/control",
                    "http://169.254.169.254/office1/control", "http://8.8.8.8/office1/control",
                    "http://100.97.64.86:1880/admin", CONTROL_URL + "?url=http://localhost",
                    CONTROL_URL + "#fragment", "http://user:pass@100.97.64.86:1880/office1/control",
                    "http://100.97.64.86:5000/office1/control", CONTROL_URL + "\n",
                    "http://100.97.64.86:bad/office1/control"):
            self.assertFalse(valid_control_url(url), url)


if __name__ == "__main__":
    unittest.main()
