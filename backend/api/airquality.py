from flask import Blueprint, jsonify, request
from backend.database.db import get_connection
from datetime import date


airquality_bp = Blueprint(
    "airquality",
    __name__,
    url_prefix="/api"
)


@airquality_bp.route("/airquality", methods=["GET"])
def get_airquality():

    conn = None
    cursor = None

    try:

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        # ==================================================
        # PARAMETER
        # ==================================================

        selected_date = request.args.get("date")
        start_time = request.args.get("start")
        end_time = request.args.get("end")

        # ==================================================
        # TANGGAL TERSEDIA
        # ==================================================

        cursor.execute("""
            SELECT DISTINCT DATE(timestamp) AS tanggal
            FROM air_quality
            WHERE timestamp IS NOT NULL
            ORDER BY tanggal DESC
        """)

        date_rows = cursor.fetchall()

        available_dates = [
            row["tanggal"].strftime("%Y-%m-%d")
            for row in date_rows
        ]

        # ==================================================
        # DEFAULT TANGGAL
        # ==================================================
        # Jika frontend tidak mengirim tanggal,
        # gunakan TANGGAL HARI INI.
        #
        # JANGAN menggunakan available_dates[0]
        # karena itu akan mengambil data terakhir
        # yang tersedia di database.
        # ==================================================

        if not selected_date:
            selected_date = date.today().strftime("%Y-%m-%d")

        # ==================================================
        # QUERY DATA
        # ==================================================

        sql = """
            SELECT
                id,
                serialno,
                location_name,
                model,
                firmware,
                timestamp,

                pm01,
                pm02,
                pm10,

                temperature,
                humidity,

                co2,
                tvoc,
                tvoc_index,
                nox_index,

                wifi

            FROM air_quality

            WHERE DATE(timestamp) = %s
        """

        params = [selected_date]

        # ==================================================
        # FILTER WAKTU
        # ==================================================

        if start_time:

            sql += """
                AND TIME(timestamp) >= %s
            """

            params.append(start_time)

        if end_time:

            sql += """
                AND TIME(timestamp) <= %s
            """

            params.append(end_time)

        # ==================================================
        # ORDER
        # ==================================================

        sql += """
            ORDER BY timestamp ASC
        """

        cursor.execute(sql, params)

        rows = cursor.fetchall()

        # ==================================================
        # FORMAT DATETIME
        # ==================================================

        for row in rows:

            if row["timestamp"]:

                row["timestamp"] = row["timestamp"].strftime(
                    "%Y-%m-%d %H:%M:%S"
                )

        # ==================================================
        # LATEST
        # ==================================================

        if rows:

            latest = rows[-1]

        else:

            # Tidak ada data pada tanggal yang dipilih
            latest = {
                "pm01": 0,
                "pm02": 0,
                "pm10": 0,
                "temperature": 0,
                "humidity": 0,
                "co2": 0,
                "tvoc": 0,
                "tvoc_index": 0,
                "nox_index": 0
            }

        # ==================================================
        # RESPONSE
        # ==================================================

        return jsonify({

            "status": "success",

            "selected_date": selected_date,

            "start_time": start_time,

            "end_time": end_time,

            "available_dates": available_dates,

            "total": len(rows),

            "latest": latest,

            "history": rows

        })

    except Exception as e:

        print("Air Quality API Error:", e)

        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()