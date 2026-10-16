
from flask import Blueprint, jsonify, request
from backend.database.db import get_connection
from datetime import date, datetime, time, timedelta


airquality_hourly_bp = Blueprint(
    "airquality_hourly",
    __name__,
    url_prefix="/api"
)


def format_datetime(value):
    """Ubah datetime menjadi string agar bisa dikirim sebagai JSON."""
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    return value


@airquality_hourly_bp.route(
    "/air-quality/hourly",
    methods=["GET"]
)
def get_airquality_hourly():

    conn = None
    cursor = None

    try:
        # Validasi tanggal yang diminta frontend.
        selected_date = request.args.get("date")

        if selected_date:
            try:
                target_date = date.fromisoformat(selected_date)
            except ValueError:
                return jsonify({
                    "status": "error",
                    "message": "Format tanggal harus YYYY-MM-DD"
                }), 400
        else:
            target_date = date.today()

        start_datetime = datetime.combine(
            target_date, time.min
        )
        end_datetime = start_datetime + timedelta(days=1)

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        # Ambil hasil agregasi untuk tanggal yang dipilih.
        cursor.execute("""
            SELECT
                hour_start,
                hour_end,
                pm01_avg,
                pm02_avg,
                pm10_avg,
                co2_avg,
                tvoc_avg,
                humidity_avg,
                sample_count,
                calculated_at
            FROM air_quality_hourly
            WHERE hour_start >= %s
              AND hour_start < %s
            ORDER BY hour_start ASC
        """, (start_datetime, end_datetime))

        rows = cursor.fetchall()

        # --------------------------------------------------
        # CADANGAN PERGANTIAN HARI
        # Jika agregat jam 00:00 belum tersedia,
        # gunakan agregat jam 23:00 hari sebelumnya.
        # Nilai sensor tetap berasal dari data sebelumnya,
        # tetapi waktu tampilnya menjadi 00:00 hari baru.
        # --------------------------------------------------

        has_midnight = any(
            row["hour_start"] == start_datetime
            for row in rows
        )

        if not has_midnight:
            previous_day = target_date - timedelta(days=1)

            previous_start = datetime.combine(
                previous_day, time(23, 0)
            )

            previous_end = datetime.combine(
                target_date, time.min
            )

            cursor.execute("""
                SELECT
                    hour_start,
                    hour_end,
                    pm01_avg,
                    pm02_avg,
                    pm10_avg,
                    co2_avg,
                    tvoc_avg,
                    humidity_avg,
                    sample_count,
                    calculated_at
                FROM air_quality_hourly
                WHERE hour_start = %s
                LIMIT 1
            """, (previous_start,))

            previous_row = cursor.fetchone()

            if previous_row:
                # Salin nilai jam sebelumnya, tetapi gunakan
                # timestamp 00:00 untuk tampilan tanggal baru.
                fallback = dict(previous_row)
                fallback["hour_start"] = start_datetime
                fallback["hour_end"] = (
                    start_datetime + timedelta(hours=1)
                )
                fallback["is_fallback"] = True

                rows.insert(0, fallback)

        # Format datetime supaya aman untuk jsonify.
        for row in rows:
            row["hour_start"] = format_datetime(
                row["hour_start"]
            )
            row["hour_end"] = format_datetime(
                row["hour_end"]
            )
            row["calculated_at"] = format_datetime(
                row["calculated_at"]
            )
            row.setdefault("is_fallback", False)

        return jsonify({
            "status": "success",
            "selected_date": target_date.isoformat(),
            "total": len(rows),
            "data": rows
        }), 200

    except Exception as e:
        print("[AirQualityHourly API] Error:", e)

        return jsonify({
            "status": "error",
            "message": "Gagal mengambil data kualitas udara per jam"
        }), 500

    finally:
        if cursor:
            cursor.close()

        if conn:
            conn.close()
