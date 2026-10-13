from flask import Blueprint, request, jsonify

from backend.database.db import get_connection
from backend.emisi.service import proses_emisi


traffic_bp = Blueprint("traffic", __name__)


@traffic_bp.route("/api/traffic", methods=["POST"])
def traffic():

    conn = None
    cursor = None

    try:

        # =====================================================
        # AMBIL JSON
        # =====================================================

        data = request.get_json()

        if not data:
            return jsonify({
                "status": "error",
                "message": "JSON tidak ditemukan"
            }), 400


        # =====================================================
        # DATA DARI JETSON
        # =====================================================

        motor = int(data.get("motorcycle", 0) or 0)
        mobil = int(data.get("car", 0) or 0)
        bus = int(data.get("bus", 0) or 0)
        truck = int(data.get("truck", 0) or 0)

        camera_id = data.get("camera_id")


        # =====================================================
        # TOTAL RAW DARI JETSON
        # =====================================================

        total = int(
            data.get(
                "total",
                motor + mobil + bus + truck
            ) or 0
        )


        # =====================================================
        # VALIDASI COUNTER
        # =====================================================

        motor = max(motor, 0)
        mobil = max(mobil, 0)
        bus = max(bus, 0)
        truck = max(truck, 0)
        total = max(total, 0)


        # =====================================================
        # DATABASE
        # =====================================================

        conn = get_connection()

        cursor = conn.cursor(dictionary=True)


        # =====================================================
        # 1. SIMPAN DATA RAW DARI JETSON
        #
        # vehicle_data = DATA ASLI
        # Jangan diubah menjadi delta.
        # =====================================================

        cursor.execute("""
            INSERT INTO vehicle_data
            (
                camera_id,
                motor,
                mobil,
                bus,
                truck,
                total
            )
            VALUES
            (%s, %s, %s, %s, %s, %s)
        """, (
            camera_id,
            motor,
            mobil,
            bus,
            truck,
            total
        ))


        vehicle_id = cursor.lastrowid


        # =====================================================
        # WAKTU DATA
        #
        # Menggunakan waktu database saat data diterima.
        # =====================================================

        cursor.execute("""
            SELECT
                waktu,
                DATE(waktu) AS tanggal,
                HOUR(waktu) AS jam
            FROM vehicle_data
            WHERE id = %s
        """, (vehicle_id,))

        waktu_data = cursor.fetchone()

        if not waktu_data:
            raise Exception(
                "Waktu vehicle_data tidak ditemukan"
            )


        waktu = waktu_data["waktu"]
        tanggal = waktu_data["tanggal"]
        jam = int(waktu_data["jam"])


        # =====================================================
        # 2. CARI COUNTER SEBELUMNYA
        #
        # HARUS:
        # - kamera sama
        # - tanggal sama
        # - data sebelum vehicle_id sekarang
        #
        # Jadi data tanggal sebelumnya tidak ikut dibandingkan.
        # =====================================================

        cursor.execute("""
            SELECT
                motor,
                mobil,
                bus,
                truck,
                total
            FROM vehicle_data
            WHERE camera_id = %s
              AND DATE(waktu) = %s
              AND id < %s
            ORDER BY waktu DESC, id DESC
            LIMIT 1
        """, (
            camera_id,
            tanggal,
            vehicle_id
        ))

        previous = cursor.fetchone()


        # =====================================================
        # 3. HITUNG DELTA
        # =====================================================

        if previous is None:

            # =================================================
            # DATA PERTAMA PADA HARI TERSEBUT
            #
            # Baseline = 0
            # =================================================

            previous_motor = 0
            previous_mobil = 0
            previous_bus = 0
            previous_truck = 0

        else:

            previous_motor = int(
                previous["motor"] or 0
            )

            previous_mobil = int(
                previous["mobil"] or 0
            )

            previous_bus = int(
                previous["bus"] or 0
            )

            previous_truck = int(
                previous["truck"] or 0
            )


        # =====================================================
        # DELTA MASING-MASING JENIS
        # =====================================================

        motor_delta = motor - previous_motor
        mobil_delta = mobil - previous_mobil
        bus_delta = bus - previous_bus
        truck_delta = truck - previous_truck


        # =====================================================
        # JIKA COUNTER JETSON RESET DI TENGAH HARI
        #
        # Contoh:
        #
        # sebelumnya = 500
        # sekarang   = 10
        #
        # Jangan menghasilkan -490.
        # Anggap counter mulai lagi dari 0.
        # =====================================================

        if motor_delta < 0:
            motor_delta = motor

        if mobil_delta < 0:
            mobil_delta = mobil

        if bus_delta < 0:
            bus_delta = bus

        if truck_delta < 0:
            truck_delta = truck


        # =====================================================
        # TOTAL DELTA
        #
        # JANGAN menggunakan:
        #
        # total_jetson - total_sebelumnya
        #
        # Kita hitung dari masing-masing jenis kendaraan.
        # =====================================================

        total_delta = (
            motor_delta
            + mobil_delta
            + bus_delta
            + truck_delta
        )


        # =====================================================
        # 4. SIMPAN DELTA
        # =====================================================

        cursor.execute("""
            INSERT INTO vehicle_delta
            (
                vehicle_id,
                camera_id,
                tanggal,
                waktu,
                jam,
                motor_delta,
                mobil_delta,
                bus_delta,
                truck_delta,
                total_delta
            )
            VALUES
            (
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
        """, (
            vehicle_id,
            camera_id,
            tanggal,
            waktu,
            jam,
            motor_delta,
            mobil_delta,
            bus_delta,
            truck_delta,
            total_delta
        ))


        # =====================================================
        # 5. UPDATE VEHICLE HOURLY
        #
        # Satu jam = akumulasi semua DELTA yang masuk
        # pada jam tersebut.
        # =====================================================

        cursor.execute("""
            INSERT INTO vehicle_hourly
            (
                camera_id,
                tanggal,
                jam,

                motor_cumulative,
                mobil_cumulative,
                bus_cumulative,
                truck_cumulative,
                total_cumulative,

                motor_delta,
                mobil_delta,
                bus_delta,
                truck_delta,
                total_delta
            )
            VALUES
            (
                %s, %s, %s,

                %s, %s, %s, %s, %s,

                %s, %s, %s, %s, %s
            )

            ON DUPLICATE KEY UPDATE

                motor_cumulative = VALUES(motor_cumulative),
                mobil_cumulative = VALUES(mobil_cumulative),
                bus_cumulative = VALUES(bus_cumulative),
                truck_cumulative = VALUES(truck_cumulative),
                total_cumulative = VALUES(total_cumulative),

                motor_delta = motor_delta + VALUES(motor_delta),
                mobil_delta = mobil_delta + VALUES(mobil_delta),
                bus_delta = bus_delta + VALUES(bus_delta),
                truck_delta = truck_delta + VALUES(truck_delta),
                total_delta = total_delta + VALUES(total_delta)
        """, (
            camera_id,
            tanggal,
            jam,

            motor,
            mobil,
            bus,
            truck,
            total,

            motor_delta,
            mobil_delta,
            bus_delta,
            truck_delta,
            total_delta
        ))


        # =====================================================
        # 6. HITUNG EMISI BERDASARKAN DELTA
        #
        # BUKAN counter kumulatif.
        # =====================================================

        hasil_emisi = proses_emisi(
            vehicle_id=vehicle_id,
            camera_id=camera_id,
            tanggal=tanggal,
            jam=jam,

            motor=motor_delta,
            mobil=mobil_delta,
            bus=bus_delta,
            truck=truck_delta,

            conn=conn,
            cursor=cursor
        )


        # =====================================================
        # COMMIT
        # =====================================================

        conn.commit()


        # =====================================================
        # LOG
        # =====================================================

        print("")
        print("==========================================")
        print("TRAFFIC DATA")
        print("==========================================")
        print(f"Camera       : {camera_id}")
        print(f"Vehicle ID   : {vehicle_id}")
        print(f"Date         : {tanggal}")
        print(f"Hour         : {jam:02d}:00")
        print("")
        print("RAW COUNTER")
        print(f"Motor        : {motor}")
        print(f"Mobil        : {mobil}")
        print(f"Bus          : {bus}")
        print(f"Truck        : {truck}")
        print(f"Total        : {total}")
        print("")
        print("DELTA")
        print(f"Motor        : +{motor_delta}")
        print(f"Mobil        : +{mobil_delta}")
        print(f"Bus          : +{bus_delta}")
        print(f"Truck        : +{truck_delta}")
        print(f"Total        : +{total_delta}")
        print("==========================================")
        print("")


        # =====================================================
        # RESPONSE
        # =====================================================

        return jsonify({
            "status": "success",

            "vehicle_id": vehicle_id,

            "camera_id": camera_id,

            "date": str(tanggal),

            "hour": jam,

            "raw": {
                "motor": motor,
                "mobil": mobil,
                "bus": bus,
                "truck": truck,
                "total": total
            },

            "delta": {
                "motor": motor_delta,
                "mobil": mobil_delta,
                "bus": bus_delta,
                "truck": truck_delta,
                "total": total_delta
            },

            "emission": hasil_emisi

        }), 200


    except Exception as e:

        if conn:
            conn.rollback()

        print(
            "ERROR /api/traffic:",
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