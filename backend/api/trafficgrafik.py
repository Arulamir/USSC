from flask import Blueprint, jsonify, request

from backend.database.db import get_connection


traffic_grafik_bp = Blueprint(
    "traffic_monitoring",
    __name__,
    url_prefix="/api"
)


@traffic_grafik_bp.route("/traffic-grafik", methods=["GET"])
def traffic_monitoring():

    conn = None
    cursor = None

    try:

        # ==================================================
        # DATABASE
        # ==================================================

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)


        # ==================================================
        # PARAMETER
        # ==================================================

        selected_date = request.args.get("date")
        start_time = request.args.get("start")
        end_time = request.args.get("end")


        # ==================================================
        # DEFAULT DATE
        # ==================================================

        if not selected_date:

            cursor.execute("""
                SELECT CURDATE() AS today
            """)

            today = cursor.fetchone()["today"]

            selected_date = today.strftime(
                "%Y-%m-%d"
            )


        # ==================================================
        # AVAILABLE DATES
        # ==================================================

        cursor.execute("""
            SELECT DISTINCT tanggal
            FROM vehicle_hourly
            ORDER BY tanggal DESC
        """)

        date_rows = cursor.fetchall()

        available_dates = [
            row["tanggal"].strftime("%Y-%m-%d")
            for row in date_rows
        ]


        # ==================================================
        # FILTER JAM
        # ==================================================

        hour_condition = ""
        hour_params = [
            selected_date
        ]


        if start_time:

            hour_condition += """
                AND jam >= HOUR(%s)
            """

            hour_params.append(
                start_time
            )


        if end_time:

            hour_condition += """
                AND jam <= HOUR(%s)
            """

            hour_params.append(
                end_time
            )


        # ==================================================
        # VEHICLE SUMMARY
        #
        # Mengambil data RAW terakhir pada tanggal/filter.
        #
        # Ini tetap untuk menampilkan counter Jetson terakhir.
        # ==================================================

        vehicle_summary_params = [
            selected_date
        ]

        vehicle_time_condition = ""


        if start_time:

            vehicle_time_condition += """
                AND TIME(waktu) >= %s
            """

            vehicle_summary_params.append(
                start_time
            )


        if end_time:

            vehicle_time_condition += """
                AND TIME(waktu) <= %s
            """

            vehicle_summary_params.append(
                end_time
            )


        cursor.execute(f"""
            SELECT
                motor,
                mobil,
                bus,
                truck,
                total
            FROM vehicle_data
            WHERE DATE(waktu) = %s
            {vehicle_time_condition}
            ORDER BY waktu DESC, id DESC
            LIMIT 1
        """, vehicle_summary_params)


        vehicle_summary = cursor.fetchone()


        # ==================================================
        # VEHICLE HOURLY
        #
        # SUDAH HASIL DELTA.
        #
        # TIDAK BOLEH DIKURANGI LAGI.
        # ==================================================

        cursor.execute(f"""
            SELECT
                jam,

                motor_delta AS motor,
                mobil_delta AS mobil,
                bus_delta AS bus,
                truck_delta AS truck,
                total_delta AS total

            FROM vehicle_hourly

            WHERE tanggal = %s

            {hour_condition}

            ORDER BY jam ASC
        """, hour_params)


        hourly_vehicle = cursor.fetchall()


        # ==================================================
        # TAMBAHKAN FIELD KOMPATIBILITAS
        #
        # Frontend lama mungkin masih membaca:
        # previous_total
        # change
        # reduction
        #
        # Sekarang semuanya TIDAK DIPAKAI.
        # ==================================================

        for row in hourly_vehicle:

            row["motor"] = int(
                row["motor"] or 0
            )

            row["mobil"] = int(
                row["mobil"] or 0
            )

            row["bus"] = int(
                row["bus"] or 0
            )

            row["truck"] = int(
                row["truck"] or 0
            )

            row["total"] = int(
                row["total"] or 0
            )

            row["previous_total"] = None
            row["change"] = None
            row["reduction"] = None


        # ==================================================
        # VEHICLE TABLE
        #
        # Tetap menampilkan RAW data Jetson.
        # ==================================================

        cursor.execute(f"""
            SELECT
                waktu AS timestamp,
                motor,
                mobil,
                bus,
                truck,
                total
            FROM vehicle_data
            WHERE DATE(waktu) = %s
            {vehicle_time_condition}
            ORDER BY waktu DESC, id DESC
            LIMIT 20
        """, vehicle_summary_params)


        vehicle_table = cursor.fetchall()


        # ==================================================
        # EMISSION SUMMARY
        #
        # Ambil emission terakhir.
        # ==================================================

        emission_summary_params = [
            selected_date
        ]


        emission_time_condition = ""


        if start_time:

            emission_time_condition += """
                AND TIME(v.waktu) >= %s
            """

            emission_summary_params.append(
                start_time
            )


        if end_time:

            emission_time_condition += """
                AND TIME(v.waktu) <= %s
            """

            emission_summary_params.append(
                end_time
            )


        cursor.execute(f"""
            SELECT
                COALESCE(SUM(motor), 0) AS motor,
                COALESCE(SUM(mobil), 0) AS mobil,
                COALESCE(SUM(bus), 0) AS bus,
                COALESCE(SUM(truck), 0) AS truck,
                COALESCE(SUM(total), 0) AS total

            FROM emission_hourly

            WHERE tanggal = %s

            {hour_condition}
        """, hour_params)

        emission_summary = cursor.fetchone()


        # ==================================================
        # EMISSION HOURLY
        #
        # SUDAH HASIL AKUMULASI EMISI PER JAM.
        #
        # JANGAN SUM emission_data lagi.
        # ==================================================

        cursor.execute(f"""
            SELECT
                jam,
                motor,
                mobil,
                bus,
                truck,
                total

            FROM emission_hourly

            WHERE tanggal = %s

            {hour_condition}

            ORDER BY jam ASC
        """, hour_params)


        hourly_emission = cursor.fetchall()


        # ==================================================
        # FORMAT EMISSION
        # ==================================================

        for row in hourly_emission:

            row["motor"] = float(
                row["motor"] or 0
            )

            row["mobil"] = float(
                row["mobil"] or 0
            )

            row["bus"] = float(
                row["bus"] or 0
            )

            row["truck"] = float(
                row["truck"] or 0
            )

            row["total"] = float(
                row["total"] or 0
            )

            row["previous_total"] = None
            row["change"] = None
            row["reduction"] = None


        # ==================================================
        # EMISSION TABLE
        # ==================================================

        cursor.execute(f"""
            SELECT
                v.waktu AS timestamp,

                e.emission_motor AS motor,
                e.emission_mobil AS mobil,
                e.emission_bus AS bus,
                e.emission_truk AS truck,
                e.emission_total AS total

            FROM emission_data e

            INNER JOIN vehicle_data v
                ON v.id = e.vehicle_id

            WHERE DATE(v.waktu) = %s

            {emission_time_condition}

            ORDER BY v.waktu DESC, v.id DESC

            LIMIT 20
        """, emission_summary_params)


        emission_table = cursor.fetchall()


        # ==================================================
        # FORMAT DATETIME
        # ==================================================

        for row in vehicle_table:

            if row["timestamp"]:

                row["timestamp"] = row[
                    "timestamp"
                ].strftime(
                    "%Y-%m-%d %H:%M:%S"
                )


        for row in emission_table:

            if row["timestamp"]:

                row["timestamp"] = row[
                    "timestamp"
                ].strftime(
                    "%Y-%m-%d %H:%M:%S"
                )


        # ==================================================
        # RESPONSE
        # ==================================================

        return jsonify({

            "status": "success",

            "selected_date": selected_date,

            "start_time": start_time,

            "end_time": end_time,

            "available_dates": available_dates,

            "vehicle": {

                "summary": vehicle_summary,

                "hourly": hourly_vehicle,

                "table": vehicle_table

            },

            "emission": {

                "summary": emission_summary,

                "hourly": hourly_emission,

                "table": emission_table

            }

        })


    except Exception as e:

        print(
            "Traffic Monitoring API Error:",
            e
        )

        return jsonify({

            "status": "error",

            "message": str(e)

        }), 500


    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()