import json
import queue
from flask import Blueprint, jsonify, Response, stream_with_context

try:
    from kirimesp.ambildata import (
        get_latest_flood_data,
        register_flood_listener,
        unregister_flood_listener
    )
except ImportError:
    try:
        from backend.kirimesp.ambildata import (
            get_latest_flood_data,
            register_flood_listener,
            unregister_flood_listener
        )
    except ImportError:
        def get_latest_flood_data():
            return {"lidah": None, "ketintang": None, "last_updated": None}
        def register_flood_listener(q):
            pass
        def unregister_flood_listener(q):
            pass

flood_bp = Blueprint("flood", __name__, url_prefix="/api")

def _enrich_row(r):
    """Mengekstrak data sensor tambahan seperti pH dari raw_payload jika tersedia."""
    if not r:
        return r
    raw = r.get("raw_payload")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                for k in ["ph", "ph_adc", "ph_voltage", "status_ph", "suhu_air", "suhu_air_1", "suhu_air_2", "status_suhu_air", "suhu_udara", "curah_hujan_per_jam"]:
                    if k in parsed and k not in r:
                        r[k] = parsed[k]
                # Sinkronkan alias suhu_air <-> suhu_air_2 dan suhu_udara <-> suhu_air_1
                if "suhu_air" in r and "suhu_air_2" not in r:
                    r["suhu_air_2"] = r["suhu_air"]
                elif "suhu_air_2" in r and "suhu_air" not in r:
                    r["suhu_air"] = r["suhu_air_2"]
                if "suhu_udara" in r and "suhu_air_1" not in r:
                    r["suhu_air_1"] = r["suhu_udara"]
                elif "suhu_air_1" in r and "suhu_udara" not in r:
                    r["suhu_udara"] = r["suhu_air_1"]
        except Exception:
            pass
    return r

def get_latest_from_database(location=None):
    """Mengambil data sensor paling akhir dari tabel flood_data di MariaDB."""
    try:
        from database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        if location in ["lidah", "ketintang"]:
            cursor.execute("""
                SELECT id, lokasi, water_level as jarak, air_temp as suhu_udara, 
                       soil_moisture as soil, soil_moisture as kelembapan_tanah,
                       rain_intensity as rain, panel_temp as temp_panel, 
                       panel_humidity as hum_panel, status, raw_payload,
                       DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%S') as timestamp
                FROM flood_data
                WHERE lokasi = %s
                ORDER BY id DESC
                LIMIT 1
            """, (location,))
            row = cursor.fetchone()
            cursor.close()
            conn.close()
            return _enrich_row(row)
        else:
            result = {"lidah": None, "ketintang": None, "last_updated": None}
            for loc in ["lidah", "ketintang"]:
                cursor.execute("""
                    SELECT id, lokasi, water_level as jarak, air_temp as suhu_udara, 
                           soil_moisture as soil, soil_moisture as kelembapan_tanah,
                           rain_intensity as rain, panel_temp as temp_panel, 
                           panel_humidity as hum_panel, status, raw_payload,
                           DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%S') as timestamp
                    FROM flood_data
                    WHERE lokasi = %s
                    ORDER BY id DESC
                    LIMIT 1
                """, (loc,))
                row = cursor.fetchone()
                if row:
                    result[loc] = _enrich_row(row)
                    result["last_updated"] = row.get("timestamp")
            cursor.close()
            conn.close()
            return result
    except Exception as e:
        print(f"[Flood-API] Gagal query DB get_latest_from_database: {e}")
        return None

@flood_bp.route("/flood", methods=["GET"])
def get_flood():
    """Mengembalikan data sensor terkini dari Database, fallback ke MQTT."""
    try:
        from flask import request
        location = request.args.get("location", "").strip().lower()

        db_data = get_latest_from_database(location if location in ["lidah", "ketintang"] else None)
        if db_data:
            if location in ["lidah", "ketintang"] or db_data.get("lidah") or db_data.get("ketintang"):
                return jsonify({"status": "success", "source": "database", "data": db_data}), 200

        mem_data = get_latest_flood_data()
        if location in ["lidah", "ketintang"]:
            return jsonify({"status": "success", "source": "memory", "data": mem_data.get(location)}), 200

        return jsonify({"status": "success", "source": "memory", "data": mem_data}), 200
    except Exception as e:
        return jsonify({"status": "error", "message": f"Gagal mengambil data banjir: {str(e)}"}), 500

@flood_bp.route("/flood/latest", methods=["GET"])
def get_flood_latest():
    """
    Endpoint fast-check: mengambil 1 data sensor paling akhir dari database.
    Query: ?location=ketintang|lidah
    Menyertakan 'id' dan 'timestamp' untuk deteksi pembaruan data secara instan.
    """
    from flask import request
    location = request.args.get("location", "ketintang").strip().lower()
    if location not in ["lidah", "ketintang"]:
        location = "ketintang"

    try:
        row = get_latest_from_database(location)
        if row:
            return jsonify({
                "status": "success",
                "source": "database",
                "data": row
            }), 200

        mem = get_latest_flood_data().get(location)
        return jsonify({
            "status": "success",
            "source": "memory",
            "data": mem
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengambil data sensor terkini: {str(e)}"
        }), 500


@flood_bp.route("/flood/recent", methods=["GET"])
def get_flood_recent():
    """
    Mengambil N data terakhir (default 10) dari tabel flood_data untuk keperluan grafik.
    Data dibalik urutannya (ASC) agar tersusun kronologis (kiri ke kanan).
    """
    from flask import request
    location = request.args.get("location", "ketintang").strip().lower()
    if location not in ["lidah", "ketintang"]:
        location = "ketintang"

    limit = request.args.get("limit", 10)
    try:
        limit = max(1, min(int(limit), 100))
    except ValueError:
        limit = 10

    try:
        from database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT id, lokasi, 
                   water_level as water, 
                   air_temp as temp, 
                   soil_moisture as soil, 
                   rain_intensity as rain,
                   panel_temp, panel_humidity, status,
                   DATE_FORMAT(timestamp, '%H:%i:%S') as time,
                   DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%S') as timestamp
            FROM flood_data
            WHERE lokasi = %s
            ORDER BY id DESC
            LIMIT %s
        """, (location, limit))

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        # Urutan kronologis untuk grafik
        rows.reverse()

        chart_points = []
        for r in rows:
            chart_points.append({
                "id": r.get("id"),
                "time": r.get("time") or "",
                "timestamp": r.get("timestamp") or "",
                "water": float(r.get("water") or 0),
                "temp": float(r.get("temp") or 0) if r.get("temp") is not None else 0,
                "soil": float(r.get("soil") or 0) if r.get("soil") is not None else 0,
                "status": r.get("status") or "AMAN"
            })

        latest_id = rows[-1]["id"] if rows else None

        return jsonify({
            "status": "success",
            "location": location,
            "total": len(chart_points),
            "latest_id": latest_id,
            "data": chart_points
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengambil data grafik dari database: {str(e)}"
        }), 500



@flood_bp.route("/flood/stream", methods=["GET"])
def stream_flood():
    """
    Streaming Server-Sent Events (SSE) untuk update data banjir realtime sub-detik.
    """
    def event_stream():
        q = queue.Queue(maxsize=30)
        register_flood_listener(q)
        try:
            # Kirim data terkini langsung saat client baru terkoneksi
            initial_data = get_latest_flood_data()
            yield f"data: {json.dumps(initial_data)}\n\n"

            while True:
                try:
                    # Tunggu data baru dari MQTT broker maksimal 15 detik
                    data = q.get(timeout=15)
                    yield f"data: {json.dumps(data)}\n\n"
                except queue.Empty:
                    # Heartbeat comment untuk menjaga koneksi SSE tetap hidup
                    yield ": ping\n\n"
        except GeneratorExit:
            pass
        finally:
            unregister_flood_listener(q)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive"
        }
    )


@flood_bp.route("/flood/history", methods=["GET"])
def get_flood_history():
    """
    Mengambil riwayat data banjir dari tabel flood_data di MariaDB.
    Parameter query:
      - location: 'lidah' atau 'ketintang' (opsional)
      - limit: jumlah baris maksimal (opsional, default 50, max 200)
      - interval: '10m' (default, dikelompokkan per 10 menit) atau 'raw' (per record)
    """
    from flask import request
    location = request.args.get("location", "").strip().lower()
    interval = request.args.get("interval", "10m").strip().lower()
    limit = request.args.get("limit", 50)
    try:
        limit = max(1, min(int(limit), 200))
    except ValueError:
        limit = 50

    try:
        from database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        if interval == "raw":
            if location in ["lidah", "ketintang"]:
                cursor.execute("""
                    SELECT id, lokasi, water_level, air_temp, soil_moisture, 
                           rain_intensity, panel_temp, panel_humidity, status, raw_payload,
                           DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%S') as timestamp
                    FROM flood_data
                    WHERE lokasi = %s
                    ORDER BY id DESC
                    LIMIT %s
                """, (location, limit))
            else:
                cursor.execute("""
                    SELECT id, lokasi, water_level, air_temp, soil_moisture, 
                           rain_intensity, panel_temp, panel_humidity, status, raw_payload,
                           DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%S') as timestamp
                    FROM flood_data
                    ORDER BY id DESC
                    LIMIT %s
                """, (limit,))
        else:
            # Default: Agregasi per 10 menit (600 detik)
            if location in ["lidah", "ketintang"]:
                cursor.execute("""
                    SELECT 
                        MAX(id) AS id,
                        lokasi,
                        ROUND(AVG(water_level), 1) AS water_level,
                        ROUND(AVG(air_temp), 1) AS air_temp,
                        ROUND(AVG(soil_moisture), 1) AS soil_moisture,
                        ROUND(SUM(rain_intensity), 1) AS rain_intensity,
                        ROUND(AVG(panel_temp), 1) AS panel_temp,
                        ROUND(AVG(panel_humidity), 1) AS panel_humidity,
                        MAX(status) AS status,
                        MAX(raw_payload) AS raw_payload,
                        DATE_FORMAT(FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(timestamp) / 600) * 600), '%Y-%m-%d %H:%i:00') AS timestamp
                    FROM flood_data
                    WHERE lokasi = %s
                    GROUP BY FLOOR(UNIX_TIMESTAMP(timestamp) / 600), lokasi
                    ORDER BY timestamp DESC
                    LIMIT %s
                """, (location, limit))
            else:
                cursor.execute("""
                    SELECT 
                        MAX(id) AS id,
                        lokasi,
                        ROUND(AVG(water_level), 1) AS water_level,
                        ROUND(AVG(air_temp), 1) AS air_temp,
                        ROUND(AVG(soil_moisture), 1) AS soil_moisture,
                        ROUND(SUM(rain_intensity), 1) AS rain_intensity,
                        ROUND(AVG(panel_temp), 1) AS panel_temp,
                        ROUND(AVG(panel_humidity), 1) AS panel_humidity,
                        MAX(status) AS status,
                        MAX(raw_payload) AS raw_payload,
                        DATE_FORMAT(FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(timestamp) / 600) * 600), '%Y-%m-%d %H:%i:00') AS timestamp
                    FROM flood_data
                    GROUP BY FLOOR(UNIX_TIMESTAMP(timestamp) / 600), lokasi
                    ORDER BY timestamp DESC
                    LIMIT %s
                """, (limit,))

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        for r in rows:
            _enrich_row(r)

        return jsonify({
            "status": "success",
            "total": len(rows),
            "data": rows
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengambil riwayat banjir dari database: {str(e)}"
        }), 500


@flood_bp.route("/flood/history/today", methods=["GET"])
def get_flood_history_today():
    """
    Mengambil data riwayat banjir per jam (00:00 s/d 23:00) khusus hari ini (maks 24 data).
    Data otomatis ter-reset saat berganti hari karena difilter berdasarkan CURDATE().
    """
    try:
        from database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        query = """
            SELECT 
                lokasi,
                DATE_FORMAT(timestamp, '%d %b %Y') as formatted_date,
                CONCAT(DATE_FORMAT(timestamp, '%Y-%m-%d'), ' ', LPAD(HOUR(timestamp), 2, '0'), ':', LPAD(FLOOR(MINUTE(timestamp) / 10) * 10, 2, '0'), ':00') as bucket_timestamp,
                CONCAT(LPAD(HOUR(timestamp), 2, '0'), ':', LPAD(FLOOR(MINUTE(timestamp) / 10) * 10, 2, '0')) as time,
                HOUR(timestamp) as hour_num,
                FLOOR(MINUTE(timestamp) / 10) as min_slot,
                ROUND(AVG(water_level), 1) as water,
                ROUND(AVG(air_temp), 1) as temp,
                ROUND(AVG(soil_moisture), 1) as soil,
                MAX(status) as status,
                MAX(raw_payload) as raw_payload
            FROM flood_data
            WHERE DATE(timestamp) = CURDATE()
            GROUP BY lokasi, DATE(timestamp), HOUR(timestamp), FLOOR(MINUTE(timestamp) / 10)
            ORDER BY hour_num DESC, min_slot DESC
        """
        cursor.execute(query)
        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        result = {
            "lidah": [],
            "ketintang": []
        }

        for r in rows:
            _enrich_row(r)
            loc = r.get("lokasi", "").lower()
            suhu_air_val = r.get("suhu_air") if r.get("suhu_air") is not None else r.get("suhu_air_2")
            ph_val = r.get("ph")
            item = {
                "date": r.get("formatted_date"),
                "time": r.get("time"),
                "timestamp": r.get("bucket_timestamp"),
                "water": f"{float(r.get('water') or 0):.1f}",
                "temp": f"{float(r.get('temp') or 0):.1f}" if r.get("temp") is not None else "--",
                "soil": f"{float(r.get('soil') or 0):.1f}" if r.get("soil") is not None else "--",
                "temp_water": f"{float(suhu_air_val):.1f}" if suhu_air_val is not None and str(suhu_air_val).strip() != "" and str(suhu_air_val).strip() != "--" else "--",
                "suhu_air": suhu_air_val,
                "suhu_air_2": suhu_air_val,
                "ph": f"{float(ph_val):.1f}" if ph_val is not None and str(ph_val).strip() != "" and str(ph_val).strip() != "--" else "--",
                "status": r.get("status") or "AMAN"
            }
            if loc in result:
                result[loc].append(item)

        return jsonify({
            "status": "success",
            "data": result
        }), 200
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": f"Gagal mengambil data banjir harian: {str(e)}"
        }), 500



@flood_bp.route("/flood/export", methods=["GET"])
def export_flood_data():
    """
    Ekspor data telemetri banjir dalam format CSV (UTF-8 BOM untuk Excel).
    Query: location ('ketintang'|'lidah'), period ('today'|'monthly'), year, month.
    """
    import csv, io
    from datetime import datetime
    from flask import request

    location = request.args.get("location", "ketintang").strip().lower()
    if location not in ["ketintang", "lidah"]:
        location = "ketintang"

    period = request.args.get("period", "today").strip().lower()
    now = datetime.now()
    loc_label = "Ketintang" if location == "ketintang" else "Lidah_Wetan"

    conn, cursor = None, None
    try:
        from database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)

        if period == "monthly":
            try:
                year = int(request.args.get("year", now.year))
                month = int(request.args.get("month", now.month))
                if month < 1 or month > 12: month = now.month
            except ValueError:
                year, month = now.year, now.month

            m_names = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                       "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
            m_name = m_names[month] if 1 <= month <= 12 else str(month)
            filename = f"Laporan_Banjir_{loc_label}_{m_name}_{year}.csv"

            # Opsi 1: Rangkuman Rata-rata per Jam
            cursor.execute("""
                SELECT 
                    DATE_FORMAT(timestamp, '%Y-%m-%d') as tanggal,
                    DATE_FORMAT(timestamp, '%H:00') as jam,
                    ROUND(AVG(water_level), 1) as avg_water,
                    ROUND(MAX(water_level), 1) as max_water,
                    ROUND(MIN(water_level), 1) as min_water,
                    ROUND(AVG(air_temp), 1) as avg_temp,
                    ROUND(AVG(soil_moisture), 1) as avg_soil,
                    ROUND(SUM(rain_intensity), 1) as total_rain,
                    MAX(status) as max_status
                FROM flood_data
                WHERE lokasi = %s AND YEAR(timestamp) = %s AND MONTH(timestamp) = %s
                GROUP BY DATE(timestamp), HOUR(timestamp)
                ORDER BY DATE(timestamp) ASC, HOUR(timestamp) ASC
            """, (location, year, month))
            db_rows = cursor.fetchall()

            fieldnames = [
                "No", "Tanggal", "Jam", "Rata_Rata_Air_cm", "Maks_Air_cm", "Min_Air_cm",
                "Rata_Rata_Suhu_C", "Kelembaban_Tanah_Persen", "Curah_Hujan_mm", "Status_Tertinggi"
            ]
            rows = [{
                "No": i,
                "Tanggal": r.get("tanggal") or "",
                "Jam": r.get("jam") or "",
                "Rata_Rata_Air_cm": r.get("avg_water") if r.get("avg_water") is not None else "--",
                "Maks_Air_cm": r.get("max_water") if r.get("max_water") is not None else "--",
                "Min_Air_cm": r.get("min_water") if r.get("min_water") is not None else "--",
                "Rata_Rata_Suhu_C": r.get("avg_temp") if r.get("avg_temp") is not None else "--",
                "Kelembaban_Tanah_Persen": r.get("avg_soil") if r.get("avg_soil") is not None else "--",
                "Curah_Hujan_mm": r.get("total_rain") if r.get("total_rain") is not None else "0.0",
                "Status_Tertinggi": r.get("max_status") or "AMAN"
            } for i, r in enumerate(db_rows, 1)]

        else:
            today_str = now.strftime("%Y-%m-%d")
            filename = f"Laporan_Banjir_{loc_label}_{today_str}.csv"
            cursor.execute("""
                SELECT 
                    DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i:%S') as waktu,
                    water_level as water, air_temp as temp,
                    soil_moisture as soil, rain_intensity as rain, status,
                    raw_payload
                FROM flood_data
                WHERE lokasi = %s AND DATE(timestamp) = CURDATE()
                ORDER BY timestamp ASC
            """, (location,))
            db_rows = cursor.fetchall()

            fieldnames = [
                "No", "Waktu", "Ketinggian_Air_cm", "Suhu_Udara_C",
                "Suhu_Air_C", "Kelembaban_Tanah_Persen", "pH_Air",
                "Intensitas_Hujan_mm", "Status"
            ]
            rows = []
            for i, r in enumerate(db_rows, 1):
                _enrich_row(r)
                suhu_air_val = r.get("suhu_air") if r.get("suhu_air") is not None else r.get("suhu_air_2")
                ph_val = r.get("ph")
                rows.append({
                    "No": i,
                    "Waktu": r.get("waktu") or "",
                    "Ketinggian_Air_cm": f"{float(r.get('water') or 0):.1f}",
                    "Suhu_Udara_C": f"{float(r.get('temp') or 0):.1f}" if r.get("temp") is not None else "--",
                    "Suhu_Air_C": f"{float(suhu_air_val):.1f}" if suhu_air_val is not None and str(suhu_air_val).strip() not in ["", "--"] else "--",
                    "Kelembaban_Tanah_Persen": f"{float(r.get('soil') or 0):.1f}" if r.get("soil") is not None else "--",
                    "pH_Air": f"{float(ph_val):.1f}" if ph_val is not None and str(ph_val).strip() not in ["", "--"] else "--",
                    "Intensitas_Hujan_mm": f"{float(r.get('rain') or 0):.1f}" if r.get("rain") is not None else "0.0",
                    "Status": r.get("status") or "AMAN"
                })

        cursor.close()
        conn.close()

        output = io.StringIO()
        output.write("\ufeff")
        writer = csv.DictWriter(output, fieldnames=fieldnames, lineterminator="\r\n")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

        return Response(
            output.getvalue().encode("utf-8-sig"),
            mimetype="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-cache"
            }
        )
    except Exception as e:
        if cursor:
            try: cursor.close()
            except Exception: pass
        if conn:
            try: conn.close()
            except Exception: pass
        return jsonify({"status": "error", "message": f"Gagal ekspor: {str(e)}"}), 500

