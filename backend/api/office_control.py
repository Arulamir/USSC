"""Authenticated bridge to the existing Node-RED office1 control protocol.

An acknowledgement confirms UG65 accepted the command, never the physical
relay state. Request IDs pass through unchanged; this bridge never retries.
"""

import hmac
import ipaddress
import re
from urllib.parse import urlsplit

import requests
from flask import Blueprint, current_app, jsonify, request


office_control_bp = Blueprint("office_control", __name__, url_prefix="/api/smart-office/control")
DEVICES = (
    {"id": "WS502_RUANG_UTAMA", "label": "Lampu Ruang Utama", "group": "lampu"},
    {"id": "WS502_RUANG_MAGANG", "label": "Lampu Ruang Magang", "group": "lampu"},
    {"id": "WS502_BU_DINI", "label": "Lampu Ruang Direktur USSC", "group": "lampu"},
    {"id": "WS502_ALL", "label": "Semua Lampu", "group": "lampu"},
    {"id": "AC_KANTOR", "label": "AC Kantor", "group": "ac"},
)
DEVICE_IDS = frozenset(device["id"] for device in DEVICES)
REQUEST_ID = re.compile(r"[A-Za-z0-9_-]{8,80}\Z")
TAILNET = ipaddress.ip_network("100.64.0.0/10")
DEFAULT_CONTROL_URL = "http://100.97.64.86:1880/office1/control"


def valid_control_url(url):
    """Allow only a literal Tailscale IPv4 and the fixed Node-RED route."""
    if not isinstance(url, str) or any(char.isspace() for char in url):
        return False
    try:
        parsed = urlsplit(url)
        address = ipaddress.ip_address(parsed.hostname or "")
        return (
            parsed.scheme in ("http", "https")
            and address.version == 4 and address in TAILNET
            and parsed.username is None and parsed.password is None
            and parsed.path == "/office1/control"
            and not parsed.query and not parsed.fragment
            and parsed.port in (None, 80, 443, 1880)
        )
    except (ValueError, TypeError):
        return False


def _valid_key(value, minimum=32):
    return (isinstance(value, str) and len(value) >= minimum
            and all(33 <= ord(char) <= 126 for char in value))


def _reply(status, detail, code, request_id=None):
    body = {"status": status, "detail": detail, "physical_state_confirmed": False}
    if request_id:
        body["request_id"] = request_id
    return jsonify(body), code


def _access():
    upstream_key = current_app.config.get("OFFICE_CONTROL_KEY", "")
    operator_key = current_app.config.get("SMART_OFFICE_OPERATOR_KEY", "")
    url = current_app.config.get("SMART_OFFICE_CONTROL_URL", DEFAULT_CONTROL_URL)
    if (not _valid_key(upstream_key) or not _valid_key(operator_key, minimum=8)
            or hmac.compare_digest(upstream_key.encode(), operator_key.encode())
            or not valid_control_url(url)):
        return None, _reply("unavailable", "Kontrol belum dikonfigurasi oleh administrator.", 503)
    authorization = request.headers.get("Authorization", "")
    expected = "Bearer " + operator_key
    if not hmac.compare_digest(authorization.encode(), expected.encode()):
        response, code = _reply("unauthorized", "Kunci operator tidak valid.", 401)
        response.headers["WWW-Authenticate"] = "Bearer"
        return None, (response, code)
    return (url, upstream_key), None


@office_control_bp.after_request
def _no_store(response):
    response.headers["Cache-Control"] = "no-store"
    return response


@office_control_bp.get("/devices")
def devices():
    _, error = _access()
    if error:
        return error
    return jsonify(status="success", devices=list(DEVICES), physical_state_confirmed=False)


@office_control_bp.post("")
def control():
    config, error = _access()
    if error:
        return error
    body = request.get_json(silent=True) if request.is_json else None
    if (not isinstance(body, dict) or set(body) != {"device", "state"}
            or not isinstance(body["device"], str) or body["device"] not in DEVICE_IDS
            or not isinstance(body["state"], str) or body["state"] not in ("on", "off")):
        return _reply("invalid", "JSON harus berisi device yang terdaftar dan state on/off saja.", 400)
    request_id = request.headers.get("X-Request-Id", "")
    if REQUEST_ID.fullmatch(request_id) is None:
        return _reply("invalid", "X-Request-Id wajib berisi 8–80 huruf, angka, underscore atau tanda minus.", 400)
    url, upstream_key = config
    try:
        # Do not inherit HTTP_PROXY/HTTPS_PROXY for the Tailscale connection.
        # requests' default adapter has zero retries; a timeout must be reviewed.
        with requests.Session() as session:
            session.trust_env = False
            upstream = session.post(
                url, json={"device": body["device"], "state": body["state"]},
                headers={"Authorization": "Bearer " + upstream_key, "X-Request-Id": request_id},
                timeout=(3, 12), allow_redirects=False,
            )
    except requests.Timeout:
        return _reply("unknown", "Waktu tunggu habis. Perintah mungkin sudah diterima; periksa perangkat sebelum mengulang. Jangan ulangi otomatis.", 504, request_id)
    except requests.RequestException:
        return _reply("unknown", "Koneksi kontrol gagal. Periksa perangkat sebelum mengulang; jangan ulangi otomatis.", 503, request_id)

    errors = {
        401: "Autentikasi Node-RED ditolak; hubungi administrator.",
        403: "Sumber koneksi server belum diizinkan oleh Node-RED.",
        409: "Request ID sudah digunakan atau perintah masih menunggu balasan. Periksa perangkat sebelum mengulang.",
        429: "Terlalu banyak perintah; tunggu dan periksa perangkat sebelum mencoba lagi.",
        503: "Layanan kontrol atau koneksi MQTT belum siap.",
        504: "UG65 belum memberi balasan. Perintah mungkin sudah dijalankan; periksa perangkat sebelum mengulang. Jangan ulangi otomatis.",
    }
    if upstream.status_code in errors:
        status = "unknown" if upstream.status_code in (409, 504) else "rejected"
        return _reply(status, errors[upstream.status_code], upstream.status_code, request_id)
    if upstream.status_code != 200:
        return _reply("unknown", "Balasan layanan kontrol tidak dapat diverifikasi. Periksa perangkat sebelum mengulang.", 502, request_id)
    try:
        acknowledgement = upstream.json()
    except (ValueError, requests.RequestException):
        acknowledgement = None
    if (not isinstance(acknowledgement, dict)
            or acknowledgement.get("request_id") != request_id
            or acknowledgement.get("device") != body["device"]
            or acknowledgement.get("state") != body["state"]
            or acknowledgement.get("status") != "accepted_by_ug65"
            or acknowledgement.get("physical_state_confirmed") is not False):
        return _reply("unknown", "Balasan UG65 tidak cocok. Periksa perangkat sebelum mengulang; jangan ulangi otomatis.", 502, request_id)
    # Return only these fields: no upstream token, diagnostics or untrusted body.
    return jsonify(
        status="accepted_by_ug65", request_id=request_id,
        device=body["device"], state=body["state"], physical_state_confirmed=False,
        detail="Perintah diterima UG65. Kondisi fisik perangkat belum dikonfirmasi.",
    )
