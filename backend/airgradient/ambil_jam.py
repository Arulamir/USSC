
"""
Hourly Average AirGradient
Menghitung rata-rata data sensor setiap jam
dan menyimpannya ke tabel air_quality_hourly.
"""

import time
from datetime import datetime, timedelta

from backend.database.db import get_connection


def hitung_rata_rata_jam(hour_start):
    """Hitung rata-rata untuk satu jam yang sudah selesai."""

    hour_end = hour_start + timedelta(hours=1)

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        # Ambil rata-rata data mentah pada interval satu jam.
        cursor.execute("""
            SELECT
                AVG(pm01),
                AVG(pm02),
                AVG(pm10),
                AVG(co2),
                AVG(tvoc),
                AVG(humidity),
                COUNT(*)
            FROM air_quality
            WHERE timestamp >= %s
              AND timestamp < %s
        """, (hour_start, hour_end))

        row = cursor.fetchone()

        if not row or row[6] == 0:
            print(
                f"[AirHourly] Tidak ada data: {hour_start}"
            )
            return

        pm01_avg, pm02_avg, pm10_avg, co2_avg, \
            tvoc_avg, humidity_avg, sample_count = row

        # Simpan atau perbarui hasil untuk jam tersebut.
        cursor.execute("""
            INSERT INTO air_quality_hourly (
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
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)

            ON DUPLICATE KEY UPDATE
                hour_end = VALUES(hour_end),
                pm01_avg = VALUES(pm01_avg),
                pm02_avg = VALUES(pm02_avg),
                pm10_avg = VALUES(pm10_avg),
                co2_avg = VALUES(co2_avg),
                tvoc_avg = VALUES(tvoc_avg),
                humidity_avg = VALUES(humidity_avg),
                sample_count = VALUES(sample_count),
                calculated_at = VALUES(calculated_at)
        """, (
            hour_start,
            hour_end,
            pm01_avg,
            pm02_avg,
            pm10_avg,
            co2_avg,
            tvoc_avg,
            humidity_avg,
            sample_count,
            datetime.now()
        ))

        conn.commit()

        print(
            f"[AirHourly] Berhasil: {hour_start:%Y-%m-%d %H:%M} | "
            f"PM1={pm01_avg} | PM2.5={pm02_avg} | "
            f"PM10={pm10_avg} | CO2={co2_avg} | "
            f"TVOC={tvoc_avg} | RH={humidity_avg}% | "
            f"Jumlah data={sample_count}"
        )

    except Exception as e:
        if conn:
            conn.rollback()

        print(f"[AirHourly] Error: {e}")

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def proses_jam_selesai():
    """
    Mencari jam yang sudah selesai tetapi belum dihitung.
    Jam tanpa data tidak dibuat sebagai hasil rata-rata.
    """

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor()

        sekarang = datetime.now()
        awal_jam_ini = sekarang.replace(
            minute=0, second=0, microsecond=0
        )

        cursor.execute("""
            SELECT DISTINCT
                DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00')
            FROM air_quality
            WHERE timestamp IS NOT NULL
              AND timestamp < %s
              AND NOT EXISTS (
                  SELECT 1
                  FROM air_quality_hourly h
                  WHERE h.hour_start = DATE_FORMAT(
                      air_quality.timestamp,
                      '%Y-%m-%d %H:00:00'
                  )
              )
            ORDER BY 1
        """, (awal_jam_ini,))

        rows = cursor.fetchall()

        # Tutup koneksi pencarian sebelum menghitung per jam.
        cursor.close()
        cursor = None
        conn.close()
        conn = None

        for row in rows:
            value = row[0]

            if isinstance(value, str):
                hour_start = datetime.strptime(
                    value, "%Y-%m-%d %H:%M:%S"
                )
            else:
                hour_start = value

            hitung_rata_rata_jam(hour_start)

    except Exception as e:
        print(f"[AirHourly] Gagal memproses jam: {e}")

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


def mulai_hourly_average():
    print("[AirHourly] Worker rata-rata per jam dimulai.")

    while True:
        try:
            proses_jam_selesai()
        except Exception as e:
            print(f"[AirHourly] Worker error: {e}")

        time.sleep(60)


if __name__ == "__main__":
    mulai_hourly_average()
