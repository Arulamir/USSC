"""Read the Node-RED office1 snapshot without changing its telemetry schema."""

import json
import math
from datetime import datetime, timedelta, timezone

import mysql.connector
from flask import Blueprint, current_app, jsonify


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


def _power(records, allowed, sampled_at):
    values = []
    for eui in allowed:
        # A duplicate meter is ambiguous; never count it twice or pick arbitrarily.
        matches = [record for record in records if _eui(record) == eui]
        if len(matches) != 1:
            continue
        record = matches[0]
        value = _number(record.get("power_w"), maximum=4294967295)
        if value is not None and _fresh(record, "power_w", sampled_at):
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
        return jsonify(status="success", data=snapshot_data(row) if row else None)
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
