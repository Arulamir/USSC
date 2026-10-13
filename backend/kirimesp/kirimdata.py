import time
from backend.kirimesp.sendesp import connect_mqtt, publish_monitoring
from backend.database.db import get_connection

# =====================================================
# KONFIGURASI
# =====================================================

INTERVAL = 30  # kirim setiap 30 detik


# =====================================================
# AMBIL DATA CCTV TERBARU
# =====================================================

def get_latest_traffic():

    conn = None
    cursor = None

    try:

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                v.waktu,
                v.motor,
                v.mobil,
                v.bus,
                v.truck,
                v.total,

                e.emission_motor,
                e.emission_mobil,
                e.emission_bus,
                e.emission_truk,
                e.emission_total

            FROM vehicle_data v

            LEFT JOIN emission_data e
                ON e.vehicle_id = v.id

            ORDER BY v.id DESC

            LIMIT 1
        """)

        row = cursor.fetchone()

        if row is None:

            return {
                "traffic": {
                    "motor": 0,
                    "mobil": 0,
                    "bus": 0,
                    "truk": 0,
                    "total": 0,
                },

                "emission": {
                    "motor": 0,
                    "mobil": 0,
                    "bus": 0,
                    "truk": 0,
                    "total": 0
                }
            }

        return {

            "traffic": {
                "waktu": str(row["waktu"]),
                "motor": row["motor"] or 0,

                "mobil": row["mobil"] or 0,

                "bus": row["bus"] or 0,

                "truk": row["truck"] or 0,

                "total": row["total"] or 0,

            },

            "emission": {

                "motor": float(
                    row["emission_motor"] or 0
                ),

                "mobil": float(
                    row["emission_mobil"] or 0
                ),

                "bus": float(
                    row["emission_bus"] or 0
                ),

                "truk": float(
                    row["emission_truk"] or 0
                ),

                "total": float(
                    row["emission_total"] or 0
                )

            }

        }

    except Exception as e:

        print("ERROR MONITORING:", e)

        return None

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()



def get_latest_air_quality():

    conn = None
    cursor = None

    try:

        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT

                pm01,
                pm02,
                pm10,

                temperature,
                humidity,

                co2,

                tvoc,
                nox_index,

                wifi

            FROM air_quality

            ORDER BY id DESC

            LIMIT 1
        """)

        row = cursor.fetchone()

        if row is None:

            return {
                "pm1": 0,
                "pm25": 0,
                "pm10": 0,
                "temperature": 0,
                "humidity": 0,
                "co2": 0,
                "tvoc": 0,
                "nox": 0,
                "wifi_rssi": 0
            }

        return {

            # PM
            "pm1": row["pm01"] or 0,
            "pm25": row["pm02"] or 0,
            "pm10": row["pm10"] or 0,

            # Temperatur
            "temperature":
                row["temperature"] or 0,

            # Humidity
            "humidity":
                row["humidity"] or 0,

            # CO2
            "co2":
                row["co2"] or 0,

            # TVOC
            "tvoc":
                row["tvoc"] or 0,

            # NOx
            "nox":
                row["nox_index"] or 0,

            # WiFi
            "wifi_rssi":
                row["wifi"] or 0
        }

    except Exception as e:

        print("ERROR AIRGRADIENT:", e)

        return {
            "pm1": 0,
            "pm25": 0,
            "pm10": 0,
            "temperature": 0,
            "humidity": 0,
            "co2": 0,
            "tvoc": 0,
            "nox": 0,
            "wifi_rssi": 0
        }

    finally:

        if cursor:
            cursor.close()

        if conn:
            conn.close()


# =====================================================
# BUAT DATA MONITORING
# =====================================================

def get_monitoring_data():

    traffic_data = get_latest_traffic()

    air_quality = get_latest_air_quality()

    data = {

        "traffic": traffic_data["traffic"],

        "emission": traffic_data["emission"],

        "air_quality": air_quality

    }

    return data


# =====================================================
# MAIN
# =====================================================

def main():

    # print()
    # print("========================================")
    # print(" MQTT MONITORING SERVICE")
    # print("========================================")


    # =================================================
    # CONNECT EMQX
    # =================================================

    if not connect_mqtt():

        print("MQTT gagal terhubung.")

        return


    # print()
    # print("MQTT Monitoring aktif.")
    # print("Menunggu data database...")
    # print()


    # =================================================
    # LOOP
    # =================================================

    while True:

        try:

            data = get_monitoring_data()


            # print()
            # print("========================================")
            # print("DATA MONITORING")
            # print("========================================")

            # print(data)


            # =============================================
            # PUBLISH
            # =============================================

            publish_monitoring(data)


            time.sleep(INTERVAL)


        except KeyboardInterrupt:

            print()
            print("MQTT Monitoring dihentikan.")

            break


        except Exception as e:

            print(
                "ERROR MQTT MONITORING:",
                e
            )

            time.sleep(INTERVAL)


# =====================================================
# RUN
# =====================================================

if __name__ == "__main__":

    main()