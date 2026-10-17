"""Read the Node-RED office1 snapshot without changing its telemetry schema."""

import json
import math
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import mysql.connector
import requests
from flask import Blueprint, current_app, jsonify

from .office_control import _valid_key, valid_control_url


smart_office_bp = Blueprint("smart_office", __name__, url_prefix="/api")
AC_METERS = frozenset((
    "24E124148060C6A0", "24E12414806031FC",
    "24E124148060D73E", "24E1241480609886",
))
LAMP_METERS = frozenset((
    "24E1247710630110", "24E124771063F466",
    "24E1247710633F88", "24E1247710638799",
))
ENV_SENSOR = "24E124443F431957"
MAX_AGE = timedelta(minutes=30)
POWER_MAX_AGE = timedelta(minutes=3)
POWER_PACKET_MAX_AGE = timedelta(seconds=150)


def _utc(value):
    """MariaDB DATETIME values and offset-less stored strings represent UTC."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _number(value, minimum=0, maximum=None):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    if not math.isfinite(number) or number < minimum:
        return None
    if maximum is not None and number > maximum:
        return None
    return number


def _fresh(record, field, sampled_at, max_age=MAX_AGE):
    observed_at = _utc(record.get(field + "_at"))
    return observed_at is not None and timedelta(0) <= sampled_at - observed_at <= max_age


def _eui(record):
    value = record.get("device_eui")
    return value.upper() if isinstance(value, str) else ""


def _power(records, allowed, sampled_at, max_age=MAX_AGE):
    values = []
    for eui in allowed:
        # A duplicate meter is ambiguous; never count it twice or pick arbitrarily.
        matches = [record for record in records if _eui(record) == eui]
        if len(matches) != 1:
            continue
        record = matches[0]
        value = _number(record.get("power_w"), maximum=4294967295)
        if value is not None and _fresh(record, "power_w", sampled_at, max_age):
            values.append(value)
    return (round(sum(values), 3) if values else None,
            {"meter_used": len(values), "meter_expected": len(allowed)})


def snapshot_data(row, now=None):
    """Keep nulls and evaluate each field at the stored snapshot's UTC time."""
    sampled_at = _utc(row.get("sampled_at_utc"))
    if sampled_at is None:
        raise ValueError("Invalid snapshot timestamp")
    records = row.get("device_samples")
    if isinstance(records, (str, bytes, bytearray)):
        records = json.loads(records)
    if not isinstance(records, list):
        raise ValueError("Invalid device_samples")
    records = [record for record in records if isinstance(record, dict)]
    ac_power, ac_quality = _power(records, AC_METERS, sampled_at)
    lamp_power, lamp_quality = _power(records, LAMP_METERS, sampled_at)
    sensors = [record for record in records if _eui(record) == ENV_SENSOR]
    sensor = sensors[0] if len(sensors) == 1 else {}
    now = _utc(now) if now is not None else datetime.now(timezone.utc)
    data = {
        "sampled_at_utc": sampled_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "interval_minutes": row.get("interval_minutes"),
        "stale": now < sampled_at or now - sampled_at > MAX_AGE,
        "ac_power_w": ac_power,
        "lamp_power_w": lamp_power,
        "ac_day_wh": _number(row.get("ac_hari_wh")),
        "lamp_day_wh": _number(row.get("lampu_hari_wh")),
        "energy_date_wib": (sampled_at + timedelta(hours=7)).date().isoformat(),
        "power_quality": {"ac": ac_quality, "lamp": lamp_quality},
    }
    # The writer has already validated occupancy and environment values. Verify
    # observation times as well, so migration-pending rows cannot revive old data.
    for field, valid, max_age in (
        ("occupancy", ("occupied", "vacant"), timedelta(minutes=15)),
        ("illumination", ("bright", "dim"), MAX_AGE),
        ("temperature_c", None, MAX_AGE),
        ("humidity_pct", None, MAX_AGE),
    ):
        value = row.get(field)
        if not _fresh(sensor, field, sampled_at, max_age):
            value = None
        if valid is not None:
            value = value if value in valid else None
        else:
            value = _number(value, -100 if field == "temperature_c" else 0,
                            150 if field == "temperature_c" else 100)
        data[field] = value
    return data


def minute_ac_energy(records, sampled_at, now):
    """Counter differences over one common 60-second window, never active W.

    Interpolate only between genuine observations at most 90 seconds apart.
    A 10-minute counter change must never masquerade as one minute of energy.
    """
    result = {"ac_minute_wh": None, "ac_minute_stale": True,
              "ac_minute_start_utc": None, "ac_minute_end_utc": None,
              "ac_minute_quality": {"meter_used": 0, "meter_expected": 4,
                                    "estimated": False}}
    series = []
    for eui in AC_METERS:
        matches = [r for r in records if _eui(r) == eui]
        if len(matches) != 1:
            continue
        raw = matches[0].get("energy_points")
        if not isinstance(raw, list) or not 2 <= len(raw) <= 16:
            continue
        points = {}
        invalid = False
        for point in raw:
            if not isinstance(point, dict):
                invalid = True
                break
            at = _utc(point.get("at"))
            value = _number(point.get("wh"), maximum=4294967295)
            if (at is None or value is None or at > sampled_at or at > now
                    or at in points and points[at] != value):
                invalid = True
                break
            points[at] = value
        if invalid or len(points) < 2:
            continue
        ordered = sorted(points.items())
        # After a reset only the new monotonic segment can be used.
        reset = max((i for i in range(1, len(ordered))
                     if ordered[i][1] < ordered[i - 1][1]), default=0)
        ordered = ordered[reset:]
        if (len(ordered) < 2 or now - ordered[-1][0] > POWER_MAX_AGE
                or sampled_at - ordered[-1][0] > POWER_MAX_AGE):
            continue
        if _minute_counter_delta(ordered, ordered[-1][0]) is not None:
            series.append(ordered)
    if not series:
        return result
    end = min(points[-1][0] for points in series)
    values = [_minute_counter_delta(points, end) for points in series]
    values = [value for value in values if value is not None]
    if not values:
        return result
    result.update(
        ac_minute_wh=round(sum(value[0] for value in values), 3),
        ac_minute_stale=False,
        ac_minute_start_utc=(end - timedelta(minutes=1)).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        ac_minute_end_utc=end.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        ac_minute_quality={"meter_used": len(values), "meter_expected": 4,
                           "estimated": any(value[1] for value in values)},
    )
    return result


def _minute_counter_delta(points, end):
    start = end - timedelta(minutes=1)
    if points[0][0] > start or points[-1][0] < end:
        return None
    # Even exact boundary readings cannot hide a long gap inside the window.
    for (at, _), (next_at, _) in zip(points, points[1:]):
        if at < end and next_at > start and next_at - at > timedelta(seconds=90):
            return None

    def boundary(target):
        for at, value in points:
            if at == target:
                return value, False
        for (at, value), (next_at, next_value) in zip(points, points[1:]):
            if at < target < next_at:
                fraction = (target - at) / (next_at - at)
                return value + (next_value - value) * fraction, True
        return None

    left, right = boundary(start), boundary(end)
    if left is None or right is None:
        return None
    return max(0, right[0] - left[0]), left[1] or right[1]


def minute_power_data(packet, now=None):
    """Use genuine meter observation times, never the minute publish time as age."""
    now = _utc(now) if now is not None else datetime.now(timezone.utc)
    data = {
        "ac_power_w": None, "lamp_power_w": None,
        "power_quality": {group: {"meter_used": 0, "meter_expected": 4}
                          for group in ("ac", "lamp")},
        "power_interval_minutes": 1, "power_stale": True,
        "power_sampled_at_utc": None, "power_observed_at_utc": None,
        "lamp_power_observed_at_utc": None,
    }
    data.update(minute_ac_energy([], now, now))
    if not isinstance(packet, dict):
        return data
    sampled_at = _utc(packet.get("sampled_at_utc"))
    records = packet.get("records")
    if (packet.get("type") != "office_power" or packet.get("version") != 1
            or packet.get("source_id") != current_app.config.get("SMART_OFFICE_SOURCE_ID", "ug65-ussc")
            or packet.get("interval_minutes") != 1 or sampled_at is None
            or not timedelta(0) <= now - sampled_at <= POWER_PACKET_MAX_AGE
            or not isinstance(records, list) or len(records) > 8):
        return data
    records = [record for record in records if isinstance(record, dict)]
    data.update(minute_ac_energy(records, sampled_at, now))
    # Both checks matter: a retained MQTT packet and a cached meter reading can
    # independently be stale. Re-publishing never renews power_w_at.
    duplicates = {_eui(record) for record in records
                  if sum(_eui(other) == _eui(record) for other in records) > 1}
    records = [record for record in records if _eui(record) not in duplicates
               and _fresh(record, "power_w", sampled_at, POWER_MAX_AGE)]
    ac, ac_quality = _power(records, AC_METERS, now, POWER_MAX_AGE)
    lamp, lamp_quality = _power(records, LAMP_METERS, now, POWER_MAX_AGE)
    observed = [_utc(record.get("power_w_at")) for record in records
                if _eui(record) in AC_METERS | LAMP_METERS
                and _number(record.get("power_w"), maximum=4294967295) is not None
                and _fresh(record, "power_w", now, POWER_MAX_AGE)]
    lamp_observed = [_utc(record.get("power_w_at")) for record in records
                     if _eui(record) in LAMP_METERS
                     and _number(record.get("power_w"), maximum=4294967295) is not None
                     and _fresh(record, "power_w", now, POWER_MAX_AGE)]
    data.update(
        ac_power_w=ac, lamp_power_w=lamp,
        power_quality={"ac": ac_quality, "lamp": lamp_quality},
        power_stale=ac is None and lamp is None,
        power_sampled_at_utc=sampled_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        power_observed_at_utc=min(observed).isoformat(timespec="milliseconds").replace("+00:00", "Z") if observed else None,
        lamp_power_observed_at_utc=min(lamp_observed).isoformat(timespec="milliseconds").replace("+00:00", "Z") if lamp_observed else None,
    )
    return data


def merge_minute_power(data):
    """Optional read-only Tailscale feed; never write minute rows into office1."""
    url = current_app.config.get("SMART_OFFICE_POWER_URL", "")
    if data is None or not url:
        return data
    packet = None
    key = current_app.config.get("OFFICE_CONTROL_KEY", "")
    try:
        parsed = urlsplit(url)
        allowed = (parsed.path == "/office1/power" and valid_control_url(
            parsed._replace(path="/office1/control").geturl()))
        if allowed and _valid_key(key):
            with requests.Session() as session:
                session.trust_env = False
                response = session.get(
                    url, headers={"Authorization": "Bearer " + key},
                    timeout=(2, 2), allow_redirects=False,
                )
                if response.status_code == 200 and len(response.content) <= 32768:
                    body = response.json()
                    if isinstance(body, dict) and body.get("status") == "success":
                        packet = body.get("data")
    except (requests.RequestException, ValueError, TypeError):
        current_app.logger.warning("Smart office minute power could not be read")
    # If the minute feed is enabled but unavailable, do not disguise an old
    # database snapshot as a fresh minute reading. Environment/Wh stay intact.
    return {**data, **minute_power_data(packet)}


def get_connection():
    config = current_app.config
    return mysql.connector.connect(
        host=config["SMART_OFFICE_DB_HOST"],
        port=config["SMART_OFFICE_DB_PORT"],
        user=config["SMART_OFFICE_DB_USER"],
        password=config["SMART_OFFICE_DB_PASSWORD"],
        database=config["SMART_OFFICE_DB_NAME"],
        connection_timeout=5,
    )


@smart_office_bp.route("/smart-office", methods=["GET"])
def get_smart_office():
    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT sampled_at_utc, interval_minutes, occupancy, temperature_c,
                   humidity_pct, illumination, device_samples, ac_hari_wh, lampu_hari_wh
            FROM office1
            WHERE source_id = %s
            ORDER BY sampled_at_utc DESC, inserted_at_utc DESC, batch_id DESC
            LIMIT 1
        """, (current_app.config.get("SMART_OFFICE_SOURCE_ID", "ug65-ussc"),))
        row = cursor.fetchone()
        data = snapshot_data(row) if row else None
        response = jsonify(status="success", data=merge_minute_power(data))
        response.headers["Cache-Control"] = "no-store"
        return response
    except (mysql.connector.Error, ValueError, TypeError, OverflowError):
        # Never put connection exceptions (host, account, SQL) in the response.
        current_app.logger.warning("Smart office snapshot could not be read")
        return jsonify(status="error", message="Data smart office belum tersedia."), 503
    finally:
        for resource in (cursor, conn):
            if resource is not None:
                try:
                    resource.close()
                except mysql.connector.Error:
                    current_app.logger.warning("Smart office connection cleanup failed")
