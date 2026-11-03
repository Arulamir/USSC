"""
Background Service Pengambilan Data Sensor AirGradient
Mengambil data kualitas udara secara berkala dan menyimpannya ke database MariaDB/MySQL.
"""
import time
import requests
from datetime import datetime
from backend.database.db import get_connection
from backend.config import Config

# Default konfigurasi AirGradient
DEFAULT_TOKEN = getattr(Config, "AIRGRADIENT_TOKEN", "")
DEFAULT_LOCATION_ID = 202132
LAST_SENSOR_TIMESTAMP = None

import threading

# In-memory cache agar data tetap tersedia jika DB lokal offline
AIR_LOCK = threading.Lock()
LATEST_AIR_DATA = None

def get_latest_air_data():
    with AIR_LOCK:
        return LATEST_AIR_DATA



def fetch_and_save_airgradient():
    """
    Mengambil data satu kali dari AirGradient API dan menyimpan ke DB.
    """
    global LAST_SENSOR_TIMESTAMP
    global LATEST_AIR_DATA
    token = getattr(Config, "AIRGRADIENT_TOKEN", DEFAULT_TOKEN) or DEFAULT_TOKEN
    location_id = getattr(Config, "AIRGRADIENT_LOCATION_ID", DEFAULT_LOCATION_ID) or DEFAULT_LOCATION_ID
    
    url = f"https://api.airgradient.com/public/api/v1/locations/{location_id}/measures/current"
    
    try:
        response = requests.get(
            url,
            params={"token": token},
            timeout=15
        )
        if response.status_code != 200:
            print(f"[AirGradient] Gagal fetch: HTTP {response.status_code}")
            return
            
        data = response.json()
        if not data:
            return
        
        # Ambil timestamp asli dari API AirGradient
        sensor_timestamp = data.get("timestamp")

        if not sensor_timestamp:
            print("[AirGradient] Timestamp sensor tidak tersedia, data tidak disimpan")
            return

        # Konversi timestamp sensor
        from datetime import datetime, timezone, timedelta

        try:
            sensor_time = datetime.fromisoformat(
                sensor_timestamp.replace("Z", "+00:00")
            )

            if sensor_time.tzinfo is None:
                print("[AirGradient] Timestamp tanpa timezone, data tidak disimpan")
                return

            now = datetime.now(timezone.utc)

            # Hitung usia data sensor
            age_seconds = (now - sensor_time).total_seconds()

            # Jika data lebih dari 3 menit, anggap sensor offline
            if age_seconds > 180:
                print("[AirGradient] Sensor OFFLINE, data lama tidak disimpan")
                return

            if age_seconds < -60:
                print("[AirGradient] Timestamp sensor tidak valid")
                return

            # Cek apakah timestamp sensor sudah pernah disimpan
            if LAST_SENSOR_TIMESTAMP == sensor_timestamp:
                print("[AirGradient] Data duplikat, tidak disimpan")
                return

        except (ValueError, TypeError, AttributeError) as e:
            print(f"[AirGradient] Timestamp tidak valid: {e}")
            return

        # Simpan ke cache memory
        current_time_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        latest_record = {
            "id": 1,
            "serialno": data.get("serialno", "AG-UNESA"),
            "location_name": data.get("locationName", f"UNESA Location {location_id}"),
            "model": data.get("model", "I-9PSL"),
            "firmware": data.get("firmwareVersion", "3.1.4"),
            "pm01": float(data.get("pm01", 0) or 0),
            "pm02": float(data.get("pm02", 0) or 0),
            "pm10": float(data.get("pm10", 0) or 0),
            "temperature": float(data.get("atmp", 0) or 0),
            "humidity": float(data.get("rhum", 0) or 0),
            "co2": float(data.get("rco2", 0) or 0),
            "tvoc": float(data.get("tvoc", 0) or 0),
            "tvoc_index": float(data.get("tvocIndex", 0) or 0),
            "nox_index": float(data.get("noxIndex", 0) or 0),
            "wifi": data.get("wifi", -60),
            "timestamp": current_time_str
        }
        with AIR_LOCK:
            LATEST_AIR_DATA = latest_record

        conn = None
        cursor = None
        try:
            conn = get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT IGNORE INTO air_quality (
                    serialno,
                    location_name,
                    model,
                    firmware,
                    pm01,
                    pm02,
                    pm10,
                    temperature,
                    humidity,
                    co2,
                    tvoc,
                    tvoc_index,
                    nox_index,
                    wifi,
                    timestamp,
                    sensor_timestamp
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
            """, (
                data.get("serialno", "AG-UNESA"),
                data.get("locationName", f"UNESA Location {location_id}"),
                data.get("model", "I-9PSL"),
                data.get("firmwareVersion", "3.1.4"),
                data.get("pm01", 0),
                data.get("pm02", 0),
                data.get("pm10", 0),
                data.get("atmp", 0),
                data.get("rhum", 0),
                data.get("rco2", 0),
                data.get("tvoc", 0),
                data.get("tvocIndex", 0),
                data.get("noxIndex", 0),
                data.get("wifi", -60),
                datetime.now(),
                sensor_time.astimezone(timezone.utc).replace(tzinfo=None)
            ))

            inserted = cursor.rowcount
            conn.commit()

            LAST_SENSOR_TIMESTAMP = sensor_timestamp

            if inserted == 1:
                print(f"[AirGradient] Data baru tersimpan: {sensor_timestamp}")
            else:
                print(f"[AirGradient] Data duplikat dilewati: {sensor_timestamp}")
            
        except Exception as db_err:
            print(f"[AirGradient] Gagal simpan ke DB: {db_err}")
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
                
    except Exception as e:
        print(f"[AirGradient] Network error: {e}")

def mulai_airgradient():
    """
    Loop worker background service AirGradient
    """
    print("[AirGradient] Worker service dimulai...")
    while True:
        try:
            fetch_and_save_airgradient()
        except Exception as e:
            print(f"[AirGradient] Worker exception: {e}")
        time.sleep(60)  # Polling setiap 60 detik
