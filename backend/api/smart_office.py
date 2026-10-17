"""Read the Node-RED office1 snapshot without changing its telemetry schema."""

import json
import math
from datetime import datetime, timedelta, timezone
from threading import Lock
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
LAST_POWER_LOCK = Lock()


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
    if observed_at is None:
        return False
    age = sampled_at - observed_at
    return age >= timedelta(0) and (max_age is None or age <= max_age)


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


def _power_observed_at(records, allowed, sampled_at, max_age=MAX_AGE, newest=False):
    times = []
    for eui in allowed:
        matches = [record for record in records if _eui(record) == eui]
        if len(matches) != 1:
            continue
        record = matches[0]
        if (_number(record.get("power_w"), maximum=4294967295) is not None
                and _fresh(record, "power_w", sampled_at, max_age)):
            times.append(_utc(record["power_w_at"]))
    stamp = (max(times) if newest else min(times)) if times else None
    return stamp.isoformat(timespec="milliseconds").replace("+00:00", "Z") if stamp else None


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
        "lamp_power_observed_at_utc": _power_observed_at(records, LAMP_METERS, sampled_at),
        "power_observed_at_by_group": {
            "ac": _power_observed_at(records, AC_METERS, sampled_at),
            "lamp": _power_observed_at(records, LAMP_METERS, sampled_at),
        },
        "power_updated_at_by_group": {
            "ac": _power_observed_at(records, AC_METERS, sampled_at, newest=True),
            "lamp": _power_observed_at(records, LAMP_METERS, sampled_at, newest=True),
        },
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


def interval_ac_energy(records, sampled_at, now):
    """Actual differences between the latest two 10- or 20-minute reports.

    No interpolation, division by ten, or active-power conversion. Small radio
    timing variations are allowed. Only meters with matching report durations
    are summed, so ten-minute Wh is never mixed with twenty-minute Wh.
    """
    result = {"ac_interval_wh": None, "ac_interval_stale": True,
              "ac_interval_minutes": None,
              "ac_interval_start_utc": None, "ac_interval_end_utc": None,
              "ac_interval_quality": {"meter_used": 0, "meter_expected": 4,
                                      "estimated": False, "intervals": []}}
    intervals = []
    for eui in sorted(AC_METERS):
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
        (start, previous), (end, latest) = sorted(points.items())[-2:]
        seconds = (end - start).total_seconds()
        period = next((minutes for minutes in (10, 20)
                       if abs(seconds - minutes * 60) <= 90), None)
        if (period is None or latest < previous
                or now - end > timedelta(minutes=period + 5)
                or sampled_at - end > timedelta(minutes=period + 5)):
            continue
        intervals.append({"device_eui": eui, "wh": latest - previous,
                          "start_utc": start.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                          "end_utc": end.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                          "duration_seconds": seconds,
                          "report_interval_minutes": period})
    if intervals:
        # Use the largest group with the same duration; ties prefer the group
        # with the newest observed end, then the longer reporting period.
        groups = {period: [item for item in intervals
                           if item["report_interval_minutes"] == period]
                  for period in {item["report_interval_minutes"] for item in intervals}}
        period = max(groups, key=lambda key: (
            len(groups[key]), max(item["end_utc"] for item in groups[key]), key))
        intervals = groups[period]
        result.update(
            ac_interval_wh=round(sum(item["wh"] for item in intervals), 3),
            ac_interval_minutes=period,
            ac_interval_stale=False,
            ac_interval_start_utc=min(item["start_utc"] for item in intervals),
            ac_interval_end_utc=min(item["end_utc"] for item in intervals),
            ac_interval_quality={"meter_used": len(intervals), "meter_expected": 4,
                                 "estimated": False, "intervals": intervals},
        )
    return result


def minute_power_data(packet, now=None):
    """Use genuine meter observation times, never the minute publish time as age."""
    now = _utc(now) if now is not None else datetime.now(timezone.utc)
    data = {
        "ac_power_w": None, "lamp_power_w": None,
        "power_quality": {group: {"meter_used": 0, "meter_expected": 4}
                          for group in ("ac", "lamp")},
        "power_interval_minutes": 1, "power_stale": True,
        "power_previous": False,
        "power_sampled_at_utc": None, "power_observed_at_utc": None,
        "lamp_power_observed_at_utc": None,
        "lamp_power_previous": False,
        "power_observed_at_by_group": {"ac": None, "lamp": None},
        "power_updated_at_by_group": {"ac": None, "lamp": None},
    }
    data.update(interval_ac_energy([], now, now))
    if not isinstance(packet, dict):
        return data
    sampled_at = _utc(packet.get("sampled_at_utc"))
    records = packet.get("records")
    if (packet.get("type") != "office_power" or packet.get("version") != 1
            or packet.get("source_id") != current_app.config.get("SMART_OFFICE_SOURCE_ID", "ug65-ussc")
            or packet.get("interval_minutes") != 1 or sampled_at is None
            or sampled_at > now
            or not isinstance(records, list) or len(records) > 8):
        return data
    records = [record for record in records if isinstance(record, dict)]
    # Interval Wh uses actual meter reports; minute transport does not renew them.
    if now - sampled_at <= POWER_PACKET_MAX_AGE:
        data.update(interval_ac_energy(records, sampled_at, now))
    # Keep valid old readings, but never renew their original observation time.
    duplicates = {_eui(record) for record in records
                  if sum(_eui(other) == _eui(record) for other in records) > 1}
    records = [record for record in records if _eui(record) not in duplicates
               and _fresh(record, "power_w", sampled_at, None)]
    ac, ac_quality = _power(records, AC_METERS, now, None)
    lamp, lamp_quality = _power(records, LAMP_METERS, now, None)
    observed = [_utc(record.get("power_w_at")) for record in records
                if _eui(record) in AC_METERS | LAMP_METERS
                and _number(record.get("power_w"), maximum=4294967295) is not None
                and _fresh(record, "power_w", now, None)]
    previous = (now - sampled_at > POWER_PACKET_MAX_AGE
                or any(now - stamp > POWER_MAX_AGE for stamp in observed))
    data.update(
        ac_power_w=ac, lamp_power_w=lamp,
        power_quality={"ac": ac_quality, "lamp": lamp_quality},
        power_stale=previous or ac is None or lamp is None,
        power_previous=previous and bool(observed),
        power_sampled_at_utc=sampled_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        power_observed_at_utc=min(observed).isoformat(timespec="milliseconds").replace("+00:00", "Z") if observed else None,
        lamp_power_observed_at_utc=_power_observed_at(records, LAMP_METERS, now, None),
        power_observed_at_by_group={
            "ac": _power_observed_at(records, AC_METERS, now, None),
            "lamp": _power_observed_at(records, LAMP_METERS, now, None),
        },
        power_updated_at_by_group={
            "ac": _power_observed_at(records, AC_METERS, now, None, newest=True),
            "lamp": _power_observed_at(records, LAMP_METERS, now, None, newest=True),
        },
    )
    lamp_at = _utc(data["lamp_power_observed_at_utc"])
    data["lamp_power_previous"] = lamp_at is not None and (
        now - sampled_at > POWER_PACKET_MAX_AGE or now - lamp_at > POWER_MAX_AGE)
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
    minute = minute_power_data(packet)
    result = {**data, **minute}
    now = datetime.now(timezone.utc)
    scope = (current_app.config.get("SMART_OFFICE_SOURCE_ID", "ug65-ussc"),
             current_app.config.get("SMART_OFFICE_DB_HOST"),
             current_app.config.get("SMART_OFFICE_DB_NAME"))
    # Separate AC/lamp values so one missing group cannot erase the other.
    # The database seeds a new process; this cache bridges later feed failures.
    with LAST_POWER_LOCK:
        cache = current_app.extensions.setdefault("smart_office_last_power", {}).setdefault(scope, {})
        for group in ("ac", "lamp"):
            field = group + "_power_w"
            candidates = []
            for priority, (source, reading) in enumerate((
                    ("snapshot", data), ("previous", cache.get(group, {})), ("minute", minute))):
                value = _number(reading.get(field), maximum=4294967295)
                stamp = (reading.get("power_observed_at_by_group") or {}).get(group)
                if source == "snapshot" and "power_observed_at_by_group" not in reading:
                    stamp = reading.get("sampled_at_utc")
                observed_at = _utc(stamp)
                updated = (reading.get("power_updated_at_by_group") or {}).get(group) or stamp
                updated_at = _utc(updated)
                if (value is not None and observed_at is not None and observed_at <= now
                        and updated_at is not None and updated_at <= now):
                    quality = (reading.get("power_quality") or {}).get(group, {"meter_used": 0, "meter_expected": 4})
                    candidates.append((updated_at, priority, source, value, stamp, quality, updated))
            if not candidates:
                continue
            # A new reading on any meter must update the total even when another
            # meter still contributes an older retained value.
            _, _, source, value, stamp, quality, updated = max(candidates, key=lambda item: item[:2])
            result[field] = value
            result["power_quality"][group] = dict(quality)
            result["power_observed_at_by_group"][group] = stamp
            result["power_updated_at_by_group"][group] = updated
            if source != "minute":
                result["power_previous"] = True
                result["power_stale"] = True
                if group == "lamp":
                    result["lamp_power_previous"] = True
            cache[group] = {field: value, "power_quality": {group: dict(quality)},
                            "power_observed_at_by_group": {group: stamp},
                            "power_updated_at_by_group": {group: updated}}
    stamps = [_utc(stamp) for stamp in result["power_observed_at_by_group"].values() if _utc(stamp)]
    result["power_observed_at_utc"] = min(stamps).isoformat(timespec="milliseconds").replace("+00:00", "Z") if stamps else None
    result["lamp_power_observed_at_utc"] = result["power_observed_at_by_group"]["lamp"]
    return result


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
