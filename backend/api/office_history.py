"""WIB energy history derived from distinct per-meter cumulative counters.

The Node-RED snapshot can repeat the same observation for many rows. Its daily
totals are therefore never summed here. This ports the supplied report helper's
boundary interpolation, reset rejection and partial-meter quality semantics.
"""

from bisect import bisect_left, bisect_right
from calendar import monthrange
from datetime import date as calendar_date, datetime, time, timedelta, timezone

import mysql.connector
from flask import Blueprint, current_app, jsonify, request

from .smart_office import AC_METERS, LAMP_METERS, MAX_AGE, _number, _utc, get_connection


office_history_bp = Blueprint("office_history", __name__, url_prefix="/api")
WIB = timezone(timedelta(hours=7))
PERIODS = ("daily", "weekly", "monthly", "yearly")
METERS = tuple(sorted(AC_METERS | LAMP_METERS))


class HistoryUnavailable(RuntimeError):
    """Storage errors with no database details exposed to clients."""


def _stamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _windows(period, selected_date, now):
    if period not in PERIODS:
        raise ValueError("Periode harus daily, weekly, monthly, atau yearly.")
    if selected_date is None:
        selected_date = now.astimezone(WIB).date().isoformat()
    if not isinstance(selected_date, str) or len(selected_date) != 10:
        raise ValueError("Tanggal harus berformat YYYY-MM-DD.")
    try:
        chosen = calendar_date.fromisoformat(selected_date)
    except ValueError as error:
        raise ValueError("Tanggal harus berformat YYYY-MM-DD.") from error
    # The extra boundary day and look-behind must remain representable too.
    if chosen.year < 1970 or chosen.year > 9998:
        raise ValueError("Tahun harus antara 1970 dan 9998.")
    start = datetime.combine(chosen, time(), WIB)
    if period == "daily":
        bounds = [start + timedelta(hours=i) for i in range(25)]
        labels = [f"{i:02d}:00" for i in range(24)]
    elif period == "weekly":
        start -= timedelta(days=chosen.weekday())
        bounds = [start + timedelta(days=i) for i in range(8)]
        labels = [value.date().isoformat() for value in bounds[:-1]]
    elif period == "monthly":
        start = start.replace(day=1)
        bounds = [start + timedelta(days=i) for i in range(monthrange(chosen.year, chosen.month)[1] + 1)]
        labels = [value.date().isoformat() for value in bounds[:-1]]
    else:
        bounds = [datetime(chosen.year, month, 1, tzinfo=WIB) for month in range(1, 13)]
        bounds.append(datetime(chosen.year + 1, 1, 1, tzinfo=WIB))
        labels = [f"{chosen.year}-{month:02d}" for month in range(1, 13)]
    if bounds[-1] - bounds[0] > timedelta(days=366):
        raise ValueError("Rentang riwayat terlalu besar.")
    windows = [(label, first.astimezone(timezone.utc), last.astimezone(timezone.utc))
               for label, first, last in zip(labels, bounds, bounds[1:])]
    return selected_date, bounds, windows


def _points(rows, now):
    groups = {}
    for row in rows:
        eui = row.get("device_eui")
        eui = eui.upper() if isinstance(eui, str) else ""
        if eui not in METERS:
            continue
        observed = _utc(row.get("energy_observed_at_utc"))
        low = _number(row.get("energy_min_wh"))
        high = _number(row.get("energy_max_wh"))
        if observed is None or observed > now or low is None or high is None:
            continue
        values = groups.setdefault(eui, {})
        old = values.get(observed)
        values[observed] = (observed, low,
                            low != high or bool(old and (old[2] or old[1] != low)))
    return {eui: (sorted(values), [values[key] for key in sorted(values)])
            for eui, values in groups.items()}


def _boundary(times, points, target, live):
    before_index = bisect_right(times, target) - 1
    after_index = bisect_left(times, target)
    before = points[before_index] if before_index >= 0 else None
    after = points[after_index] if after_index < len(points) else None
    if before is None or target - before[0] > MAX_AGE:
        return {"error": "missing_current" if live else "missing_baseline"}
    if before[2]:
        return {"error": "conflict"}
    if live or before[0] == target:
        return {"value": before[1], "first": before_index, "last": before_index, "estimated": False}
    if after is None or after[0] - target > MAX_AGE:
        return {"error": "missing_baseline"}
    if after[2]:
        return {"error": "conflict"}
    if after[1] < before[1]:
        return {"error": "counter_reset"}
    ratio = (target - before[0]).total_seconds() / (after[0] - before[0]).total_seconds()
    return {"value": before[1] + (after[1] - before[1]) * ratio,
            "first": before_index, "last": after_index, "estimated": True}


def _meter(group, start, end, live):
    if group is None:
        return None, "missing_current"
    times, points = group
    first = _boundary(times, points, start, False)
    last = _boundary(times, points, end, live)
    if first.get("error") or last.get("error"):
        return None, first.get("error") or last["error"]
    if live and times[last["last"]] < start:
        return None, "missing_current"
    relevant = points[first["first"]:last["last"] + 1]
    if any(point[2] for point in relevant):
        return None, "conflict"
    if any(right[1] < left[1] for left, right in zip(relevant, relevant[1:])):
        return None, "counter_reset"
    delta = last["value"] - first["value"]
    if delta < 0:
        return None, "counter_reset"
    return delta, "estimated" if first["estimated"] or last["estimated"] else "complete"


def _total(euis, groups, start, end, live, future):
    values, excluded, estimated = [], [], False
    for eui in sorted(euis):
        value, status = (None, "future") if future else _meter(groups.get(eui), start, end, live)
        if value is None:
            excluded.append({"device_eui": eui, "reason": status})
        else:
            values.append(value)
            estimated |= status == "estimated"
    detail = {"meter_used": len(values), "meter_expected": len(euis), "excluded": excluded}
    if not values:
        priority = ("future", "conflict", "counter_reset", "missing_current", "missing_baseline")
        return None, next(reason for reason in priority if any(item["reason"] == reason for item in excluded)), detail
    status = "partial_estimated" if estimated else "partial"
    if not excluded:
        status = "estimated" if estimated else "complete"
    return round(sum(values), 3), status, detail


def build_history(period, selected_date, rows, now=None):
    """Pure report builder; rows use the grouped SQL column aliases below."""
    now = datetime.now(timezone.utc) if now is None else _utc(now)
    if now is None:
        raise ValueError("Waktu tidak valid.")
    selected_date, bounds, windows = _windows(period, selected_date, now)
    groups = _points(rows, now)
    data = []
    for label, start, scheduled_end in windows:
        future = start >= now
        live = not future and now < scheduled_end
        end = min(scheduled_end, now) if live else scheduled_end
        ac, ac_status, ac_detail = _total(AC_METERS, groups, start, end, live, future)
        lamp, lamp_status, lamp_detail = _total(LAMP_METERS, groups, start, end, live, future)
        data.append({"label": label, "start_utc": _stamp(start), "end_utc": _stamp(end),
                     "ac_wh": ac, "lamp_wh": lamp, "ac_status": ac_status, "lamp_status": lamp_status,
                     "ac_detail": ac_detail, "lamp_detail": lamp_detail,
                     "in_progress": live})
    totals = {"bucket_count": len(data)}
    for key in ("ac", "lamp"):
        available = [row for row in data if row[key + "_wh"] is not None]
        non_future = [row for row in data if row[key + "_status"] != "future"]
        partial = bool(available) and (len(available) < len(non_future) or any(
            row[key + "_status"].startswith("partial") for row in available))
        estimated = any("estimated" in row[key + "_status"] for row in available)
        status = "unavailable" if not available else (
            "partial_estimated" if partial and estimated else "partial" if partial else
            "estimated" if estimated else "complete")
        totals.update({key + "_wh": round(sum(row[key + "_wh"] for row in available), 3) if available else None,
                       key + "_available_buckets": len(available), key + "_status": status,
                       key + "_partial": partial})
    return {"status": "success", "period": period, "date": selected_date,
            "start_wib": bounds[0].isoformat(), "end_wib": bounds[-1].isoformat(),
            "generated_at_utc": _stamp(now), "unit": "Wh", "data": data, "totals": totals}


def get_history(period="daily", selected_date=None, now=None):
    """Read only projected counters with a bounded MariaDB statement timeout."""
    now = datetime.now(timezone.utc) if now is None else _utc(now)
    if now is None:
        raise ValueError("Waktu tidak valid.")
    selected_date, _, windows = _windows(period, selected_date, now)
    start, end = windows[0][1] - MAX_AGE, min(windows[-1][2] + MAX_AGE, now)
    # Observation timestamps precede their enclosing snapshots. A counter just
    # after a historical boundary may first arrive in the next 10/15-minute
    # snapshot, so its snapshot needs a separate lag allowance. The producer
    # rejects observations later than sampled_at, making start-30 sufficient.
    snapshot_end = min(end + MAX_AGE, now)
    if windows[0][1] >= now:
        return build_history(period, selected_date, [], now)
    conn = cursor = None
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        placeholders = ",".join(["%s"] * len(METERS))
        cursor.execute("""
            SET STATEMENT max_statement_time=8 FOR
            SELECT UPPER(j.device_eui) AS device_eui,
                   j.energy_at AS energy_observed_at_utc,
                   MIN(j.energy_wh) AS energy_min_wh, MAX(j.energy_wh) AS energy_max_wh
            FROM office1 AS t
            JOIN JSON_TABLE(t.device_samples, '$[*]' COLUMNS(
                device_eui CHAR(16) PATH '$.device_eui',
                energy_wh DECIMAL(20,3) PATH '$.energy_wh' NULL ON EMPTY NULL ON ERROR,
                energy_at VARCHAR(32) PATH '$.energy_wh_at' NULL ON EMPTY NULL ON ERROR
            )) AS j ON TRUE
            WHERE t.source_id = %s AND t.sampled_at_utc >= %s AND t.sampled_at_utc <= %s
              AND j.energy_at >= %s AND j.energy_at <= %s
              AND UPPER(j.device_eui) IN (""" + placeholders + """) AND j.energy_wh IS NOT NULL
            GROUP BY UPPER(j.device_eui), j.energy_at
            ORDER BY device_eui, energy_observed_at_utc
        """, (current_app.config.get("SMART_OFFICE_SOURCE_ID", "ug65-ussc"),
               start.replace(tzinfo=None), snapshot_end.replace(tzinfo=None), _stamp(start), _stamp(end), *METERS))
        return build_history(period, selected_date, cursor.fetchall(), now)
    except (mysql.connector.Error, ValueError, TypeError, OverflowError) as error:
        current_app.logger.warning("Smart office history could not be read")
        raise HistoryUnavailable("Riwayat smart office belum tersedia.") from error
    finally:
        for resource in (cursor, conn):
            if resource is not None:
                try:
                    resource.close()
                except mysql.connector.Error:
                    current_app.logger.warning("Smart office history connection cleanup failed")


@office_history_bp.route("/smart-office/history", methods=["GET"])
def history_route():
    try:
        return jsonify(get_history(request.args.get("period", "daily"), request.args.get("date")))
    except ValueError as error:
        return jsonify(status="error", message=str(error)), 400
    except HistoryUnavailable:
        return jsonify(status="error", message="Riwayat smart office belum tersedia."), 503
