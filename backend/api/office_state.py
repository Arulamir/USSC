"""Read device relay reports and explicitly unconfirmed Tasmota IR state."""

from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import requests

from .smart_office import _utc


ROOMS = {
    "WS502_RUANG_UTAMA": ("24E1247710630110", "24E124771063F466"),
    "WS502_RUANG_MAGANG": ("24E1247710633F88",),
    "WS502_BU_DINI": ("24E1247710638799",),
}
METERS = frozenset(eui for meters in ROOMS.values() for eui in meters)
GROUPS = {**ROOMS, "WS502_ALL": tuple(sorted(METERS))}
MAX_REPORT_AGE = timedelta(minutes=30)
MAX_FUTURE_SKEW = timedelta(minutes=3)


class StateUnavailable(Exception):
    pass


def device_states(packet, source_id="ug65-ussc", now=None):
    now = _utc(now) if now is not None else datetime.now(timezone.utc)
    empty = {"state": None, "source": None, "observed_at_utc": None, "stale": True}
    result = {key: dict(empty) for key in (*GROUPS, "AC_KANTOR")}
    if (not isinstance(packet, dict) or packet.get("type") != "office_device_states"
            or packet.get("version") != 1 or packet.get("source_id") != source_id):
        raise StateUnavailable()
    served = _utc(packet.get("served_at_utc"))
    if served is None or served > now + MAX_FUTURE_SKEW or now - served > timedelta(seconds=150):
        raise StateUnavailable()
    relays = packet.get("relays")
    observations = {}
    if isinstance(relays, dict):
        sampled = _utc(relays.get("sampled_at_utc"))
        records = relays.get("records")
        if (relays.get("type") != "office_relay_state" or relays.get("version") != 1
                or relays.get("source_id") != source_id or sampled is None or sampled > now + MAX_FUTURE_SKEW
                or not isinstance(records, list) or len(records) > 4):
            raise StateUnavailable()
        for eui in METERS:
            matches = [row for row in records if isinstance(row, dict) and row.get("device_eui") == eui]
            if len(matches) != 1:
                continue
            for channel in (1, 2):
                row = matches[0]
                value = row.get(f"switch_{channel}")
                stamp = _utc(row.get(f"switch_{channel}_at_utc"))
                if value in ("on", "off") and stamp is not None and stamp <= sampled and stamp <= now + MAX_FUTURE_SKEW:
                    observations[(eui, channel)] = (value, stamp)
        for target, meters in GROUPS.items():
            values = [observations.get((eui, channel)) for eui in meters for channel in (1, 2)]
            if target == "WS502_BU_DINI":
                # The director's lamp is ON when either relay channel reports ON.
                # Both channels must explicitly report OFF before showing OFF.
                reported_on = [value for value in values if value and value[0] == "on"]
                if reported_on:
                    values = reported_on
            if not all(values):
                continue
            states = {value[0] for value in values}
            oldest = min(value[1] for value in values)
            result[target] = {
                "state": next(iter(states)) if len(states) == 1 else "mixed",
                "source": "ws502_relay",
                "observed_at_utc": oldest.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "stale": now - oldest > MAX_REPORT_AGE or now - sampled > timedelta(seconds=150),
            }
    ac = packet.get("ac")
    if isinstance(ac, dict):
        stamp = _utc(ac.get("observed_at_utc"))
        if (ac.get("state") in ("on", "off")
                and ac.get("source") in ("tasmota_ir_sent", "tasmota_ir_received")
                and stamp is not None and stamp <= now + MAX_FUTURE_SKEW):
            result["AC_KANTOR"] = {
                "state": ac["state"], "source": ac["source"],
                "observed_at_utc": stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                "stale": now - stamp > MAX_REPORT_AGE or ac.get("online") is False,
            }
    return result


def read_device_states(control_url, key, source_id):
    # Caller already validates the fixed Tailscale control URL and operator auth.
    url = urlsplit(control_url)._replace(path="/office1/state").geturl()
    try:
        with requests.Session() as session:
            session.trust_env = False
            response = session.get(url, headers={"Authorization": "Bearer " + key},
                                   timeout=(2, 2), allow_redirects=False)
            if response.status_code != 200 or len(response.content) > 32768:
                raise StateUnavailable()
            body = response.json()
            if not isinstance(body, dict) or body.get("status") != "success":
                raise StateUnavailable()
            return device_states(body.get("data"), source_id)
    except (requests.RequestException, ValueError, TypeError, OverflowError) as exc:
        raise StateUnavailable() from exc
