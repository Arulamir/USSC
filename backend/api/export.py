"""
=========================================================
USSC - API EXPORT & RIWAYAT DATA HARIAN
Mendukung pemeriksaan riwayat dan pengunduhan data (CSV / ZIP)
untuk 3 sub-proyek: Lalu Lintas & Emisi, Kualitas Udara, dan Monitoring Banjir.
=========================================================
"""
import csv
import io
import zipfile
from datetime import datetime
from flask import Blueprint, jsonify, request, Response
from backend.database.db import get_connection

export_bp = Blueprint("export", __name__, url_prefix="/api/export")


def _is_valid_date(date_str):
    """Validasi format tanggal YYYY-MM-DD."""
    if not date_str:
        return False
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
        return True
    except ValueError:
        return False


def _generate_csv_string(fieldnames, rows):
    """Menghasilkan string CSV dengan BOM UTF-8 agar kompatibel langsung dengan Microsoft Excel."""
    output = io.StringIO()
    # Tulis BOM agar Excel di Windows membaca UTF-8 dengan benar
    output.write("\ufeff")
    writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator="\r\n")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue()


# =========================================================
# 1. ENDPOINT: DAFTAR TANGGAL YANG TERSEDIA
# =========================================================
@export_bp.route("/dates", methods=["GET"])
def get_available_dates():
    """
    Mengambil daftar tanggal unik yang tersimpan di database.
    Parameter query: module (all | traffic | airquality | flood)
    """
    module = request.args.get("module", "all").lower()
    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        date_set = set()

        if module in ("all", "traffic"):
            cursor.execute("""
                SELECT DISTINCT DATE(waktu) AS tgl 
                FROM vehicle_data 
                WHERE waktu IS NOT NULL
            """)
            for row in cursor.fetchall():
                if row["tgl"]:
                    date_set.add(row["tgl"].strftime("%Y-%m-%d"))

        if module in ("all", "airquality"):
            cursor.execute("""
                SELECT DISTINCT DATE(timestamp) AS tgl 
                FROM air_quality 
                WHERE timestamp IS NOT NULL
            """)
            for row in cursor.fetchall():
                if row["tgl"]:
                    date_set.add(row["tgl"].strftime("%Y-%m-%d"))

        if module in ("all", "flood"):
            cursor.execute("""
                SELECT DISTINCT DATE(timestamp) AS tgl 
                FROM flood_data 
                WHERE timestamp IS NOT NULL
            """)
            for row in cursor.fetchall():
                if row["tgl"]:
                    date_set.add(row["tgl"].strftime("%Y-%m-%d"))

        sorted_dates = sorted(list(date_set), reverse=True)

        return jsonify({
            "status": "success",
            "module": module,
            "count": len(sorted_dates),
            "dates": sorted_dates
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengambil tanggal: {str(e)}"
        }), 500

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


# =========================================================
# 2. ENDPOINT: CEK / PRATINJAU RIWAYAT HARI TERTENTU
# =========================================================
@export_bp.route("/check", methods=["GET"])
def check_history():
    """
    Memeriksa ringkasan data pada tanggal tertentu sebelum diunduh.
    Parameter query:
      - date: YYYY-MM-DD (wajib)
      - module: all | traffic | airquality | flood (default: all)
    """
    selected_date = request.args.get("date")
    module = request.args.get("module", "all").lower()

    if not _is_valid_date(selected_date):
        return jsonify({
            "status": "error",
            "message": "Format parameter 'date' tidak valid (gunakan YYYY-MM-DD)"
        }), 400

    start_time = f"{selected_date} 00:00:00"
    end_time = f"{selected_date} 23:59:59"

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        summary = {
            "date": selected_date,
            "has_data": False,
            "modules": {}
        }

        # --- A. Cek Lalu Lintas & Emisi ---
        if module in ("all", "traffic"):
            cursor.execute("""
                SELECT 
                    COUNT(v.id) AS total_record,
                    COALESCE(SUM(v.motor), 0) AS total_motor,
                    COALESCE(SUM(v.mobil), 0) AS total_mobil,
                    COALESCE(SUM(v.bus), 0) AS total_bus,
                    COALESCE(SUM(v.truck), 0) AS total_truck,
                    COALESCE(SUM(v.total), 0) AS total_kendaraan,
                    COALESCE(SUM(e.total_emisi_kg), 0) AS total_emisi_kg
                FROM vehicle_data v
                LEFT JOIN emission_data e ON v.id = e.vehicle_id
                WHERE v.waktu >= %s AND v.waktu <= %s
            """, (start_time, end_time))
            row = cursor.fetchone() or {}
            rec_count = int(row.get("total_record") or 0)
            summary["modules"]["traffic"] = {
                "record_count": rec_count,
                "total_vehicles": int(row.get("total_kendaraan") or 0),
                "motor": int(row.get("total_motor") or 0),
                "car": int(row.get("total_mobil") or 0),
                "bus": int(row.get("total_bus") or 0),
                "truck": int(row.get("total_truck") or 0),
                "total_emission_kg": float(row.get("total_emisi_kg") or 0.0)
            }
            if rec_count > 0:
                summary["has_data"] = True

        # --- B. Cek Kualitas Udara ---
        if module in ("all", "airquality"):
            cursor.execute("""
                SELECT 
                    COUNT(id) AS total_record,
                    ROUND(AVG(pm02), 1) AS avg_pm25,
                    ROUND(AVG(co2), 1) AS avg_co2,
                    ROUND(AVG(temperature), 1) AS avg_temp,
                    ROUND(AVG(humidity), 1) AS avg_humidity
                FROM air_quality
                WHERE timestamp >= %s AND timestamp <= %s
            """, (start_time, end_time))
            row = cursor.fetchone() or {}
            rec_count = int(row.get("total_record") or 0)
            summary["modules"]["airquality"] = {
                "record_count": rec_count,
                "avg_pm25": float(row.get("avg_pm25") or 0.0) if row.get("avg_pm25") is not None else None,
                "avg_co2": float(row.get("avg_co2") or 0.0) if row.get("avg_co2") is not None else None,
                "avg_temp": float(row.get("avg_temp") or 0.0) if row.get("avg_temp") is not None else None,
                "avg_humidity": float(row.get("avg_humidity") or 0.0) if row.get("avg_humidity") is not None else None
            }
            if rec_count > 0:
                summary["has_data"] = True

        # --- C. Cek Monitoring Banjir ---
        if module in ("all", "flood"):
            cursor.execute("""
                SELECT 
                    COUNT(id) AS total_record,
                    MAX(water_level) AS max_water_level,
                    MAX(rain_intensity) AS max_rain,
                    SUM(CASE WHEN lokasi = 'lidah' THEN 1 ELSE 0 END) AS count_lidah,
                    SUM(CASE WHEN lokasi = 'ketintang' THEN 1 ELSE 0 END) AS count_ketintang
                FROM flood_data
                WHERE timestamp >= %s AND timestamp <= %s
            """, (start_time, end_time))
            row = cursor.fetchone() or {}
            rec_count = int(row.get("total_record") or 0)
            summary["modules"]["flood"] = {
                "record_count": rec_count,
                "max_water_level_cm": float(row.get("max_water_level") or 0.0) if row.get("max_water_level") is not None else None,
                "max_rain_intensity": float(row.get("max_rain") or 0.0) if row.get("max_rain") is not None else None,
                "count_lidah": int(row.get("count_lidah") or 0),
                "count_ketintang": int(row.get("count_ketintang") or 0)
            }
            if rec_count > 0:
                summary["has_data"] = True

        return jsonify({
            "status": "success",
            "summary": summary
        }), 200

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengecek riwayat: {str(e)}"
        }), 500

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()


# =========================================================
# HELPER QUERY PER MODUL UNTUK EXPORT
# =========================================================

def _get_traffic_csv(cursor, start_time, end_time):
    cursor.execute("""
        SELECT 
            v.waktu AS 'Waktu',
            v.camera_id AS 'Kamera_ID',
            v.motor AS 'Motor',
            v.mobil AS 'Mobil',
            v.bus AS 'Bus',
            v.truck AS 'Truk',
            v.total AS 'Total_Kendaraan',
            COALESCE(e.co2_kg, 0) AS 'CO2_kg',
            COALESCE(e.co_kg, 0) AS 'CO_kg',
            COALESCE(e.hc_kg, 0) AS 'HC_kg',
            COALESCE(e.nox_kg, 0) AS 'NOx_kg',
            COALESCE(e.total_emisi_kg, 0) AS 'Total_Emisi_kg',
            COALESCE(e.status_kualitas, 'BAIK') AS 'Status_Kualitas'
        FROM vehicle_data v
        LEFT JOIN emission_data e ON v.id = e.vehicle_id
        WHERE v.waktu >= %s AND v.waktu <= %s
        ORDER BY v.waktu ASC
    """, (start_time, end_time))
    rows = cursor.fetchall()
    fieldnames = [
        "Waktu", "Kamera_ID", "Motor", "Mobil", "Bus", "Truk", "Total_Kendaraan",
        "CO2_kg", "CO_kg", "HC_kg", "NOx_kg", "Total_Emisi_kg", "Status_Kualitas"
    ]
    # Format waktu ke string jika datetime
    for r in rows:
        if isinstance(r.get("Waktu"), datetime):
            r["Waktu"] = r["Waktu"].strftime("%Y-%m-%d %H:%M:%S")
    return _generate_csv_string(fieldnames, rows)


def _get_airquality_csv(cursor, start_time, end_time):
    cursor.execute("""
        SELECT 
            timestamp AS 'Waktu',
            serialno AS 'Serial_No',
            location_name AS 'Lokasi',
            model AS 'Model_Sensor',
            pm01 AS 'PM1_0',
            pm02 AS 'PM2_5',
            pm10 AS 'PM10',
            temperature AS 'Suhu_C',
            humidity AS 'Kelembaban_Persen',
            co2 AS 'CO2_ppm',
            tvoc AS 'TVOC_ppb',
            tvoc_index AS 'TVOC_Index',
            nox_index AS 'NOx_Index'
        FROM air_quality
        WHERE timestamp >= %s AND timestamp <= %s
        ORDER BY timestamp ASC
    """, (start_time, end_time))
    rows = cursor.fetchall()
    fieldnames = [
        "Waktu", "Serial_No", "Lokasi", "Model_Sensor",
        "PM1_0", "PM2_5", "PM10", "Suhu_C", "Kelembaban_Persen",
        "CO2_ppm", "TVOC_ppb", "TVOC_Index", "NOx_Index"
    ]
    for r in rows:
        if isinstance(r.get("Waktu"), datetime):
            r["Waktu"] = r["Waktu"].strftime("%Y-%m-%d %H:%M:%S")
    return _generate_csv_string(fieldnames, rows)


def _get_flood_csv(cursor, start_time, end_time):
    cursor.execute("""
        SELECT 
            timestamp AS 'Waktu',
            lokasi AS 'Lokasi',
            water_level AS 'Tinggi_Air_cm',
            air_temp AS 'Suhu_Udara_C',
            soil_moisture AS 'Kelembaban_Tanah_Persen',
            rain_intensity AS 'Intensitas_Hujan_mm_jam',
            panel_temp AS 'Suhu_Panel_C',
            panel_humidity AS 'Kelembaban_Panel_Persen',
            status AS 'Status'
        FROM flood_data
        WHERE timestamp >= %s AND timestamp <= %s
        ORDER BY timestamp ASC
    """, (start_time, end_time))
    rows = cursor.fetchall()
    fieldnames = [
        "Waktu", "Lokasi", "Tinggi_Air_cm", "Suhu_Udara_C",
        "Kelembaban_Tanah_Persen", "Intensitas_Hujan_mm_jam",
        "Suhu_Panel_C", "Kelembaban_Panel_Persen", "Status"
    ]
    for r in rows:
        if isinstance(r.get("Waktu"), datetime):
            r["Waktu"] = r["Waktu"].strftime("%Y-%m-%d %H:%M:%S")
    return _generate_csv_string(fieldnames, rows)


# =========================================================
# 3. ENDPOINT: DOWNLOAD RIWAYAT DATA (CSV / ZIP)
# =========================================================
@export_bp.route("/download", methods=["GET"])
def download_data():
    """
    Mengunduh data riwayat tanggal tertentu.
    Parameter query:
      - date: YYYY-MM-DD (wajib)
      - module: traffic | airquality | flood | all (default: traffic)
    """
    selected_date = request.args.get("date")
    module = request.args.get("module", "traffic").lower()

    if not _is_valid_date(selected_date):
        return jsonify({
            "status": "error",
            "message": "Format parameter 'date' tidak valid (gunakan YYYY-MM-DD)"
        }), 400

    start_time = f"{selected_date} 00:00:00"
    end_time = f"{selected_date} 23:59:59"

    conn = None
    cursor = None

    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        # -------------------------------------------------
        # OPSI A: DOWNLOAD ZIP GABUNGAN SEMUA MODUL
        # -------------------------------------------------
        if module == "all":
            traffic_csv = _get_traffic_csv(cursor, start_time, end_time)
            air_csv = _get_airquality_csv(cursor, start_time, end_time)
            flood_csv = _get_flood_csv(cursor, start_time, end_time)

            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(f"USSC_Lalu_Lintas_Emisi_{selected_date}.csv", traffic_csv.encode("utf-8-sig"))
                zf.writestr(f"USSC_Kualitas_Udara_{selected_date}.csv", air_csv.encode("utf-8-sig"))
                zf.writestr(f"USSC_Monitoring_Banjir_{selected_date}.csv", flood_csv.encode("utf-8-sig"))

            zip_buffer.seek(0)
            filename = f"USSC_Laporan_Lengkap_{selected_date}.zip"

            return Response(
                zip_buffer.getvalue(),
                mimetype="application/zip",
                headers={
                    "Content-Disposition": f"attachment; filename=\"{filename}\"",
                    "Cache-Control": "no-cache"
                }
            )

        # -------------------------------------------------
        # OPSI B: DOWNLOAD CSV SPESIFIK MODUL
        # -------------------------------------------------
        if module == "traffic":
            csv_content = _get_traffic_csv(cursor, start_time, end_time)
            filename = f"USSC_Lalu_Lintas_Emisi_{selected_date}.csv"
        elif module == "airquality":
            csv_content = _get_airquality_csv(cursor, start_time, end_time)
            filename = f"USSC_Kualitas_Udara_{selected_date}.csv"
        elif module == "flood":
            csv_content = _get_flood_csv(cursor, start_time, end_time)
            filename = f"USSC_Monitoring_Banjir_{selected_date}.csv"
        else:
            return jsonify({
                "status": "error",
                "message": f"Module '{module}' tidak dikenali. Pilih: traffic, airquality, flood, atau all."
            }), 400

        return Response(
            csv_content.encode("utf-8-sig"),
            mimetype="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f"attachment; filename=\"{filename}\"",
                "Cache-Control": "no-cache"
            }
        )

    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengunduh data: {str(e)}"
        }), 500

    finally:
        if cursor:
            cursor.close()
        if conn:
            conn.close()
