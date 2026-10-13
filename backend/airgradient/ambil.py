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
            global LATEST_AIR_DATA
            LATEST_AIR_DATA = latest_record

        conn = None
        cursor = None
        try:
            conn = get_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO air_quality (
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
                    timestamp
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                data.get("serialno", "AG-UNESA"),
                data.get("locationName", f"UNESA Location {location_id}"),
                data.get("model", "I-9PSL"),
                data.get("firmwareVersion", "3.1.4"),
                data.get("pm01", 0),
                data.get("pm02", 0),
                data.get("pm10", 0),
                data.get("atmp", 0),  # ambient temp
                data.get("rhum", 0),  # relative humidity
                data.get("rco2", 0),  # CO2
                data.get("tvoc", 0),
                data.get("tvocIndex", 0),
                data.get("noxIndex", 0),
                data.get("wifi", -60),
                datetime.now()
            ))
            conn.commit()
            print(f"[AirGradient] Data tersimpan: PM2.5={data.get('pm02')}, CO2={data.get('rco2')}")
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
