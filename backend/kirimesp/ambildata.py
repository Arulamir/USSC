"""
Background Gateway MQTT / ESP32 Data Aggregator
Menghubungkan ke broker EMQX untuk menerima payload sensor banjir dan telemetri ESP32.
"""
import time
import json
from threading import Lock
import paho.mqtt.client as mqtt
from config import Config

# Cache data flood terbaru di memori
FLOOD_LOCK = Lock()
LATEST_FLOOD_DATA = {
    "lidah": None,
    "ketintang": None,
    "last_updated": None
}

# Listener queues untuk Server-Sent Events (SSE)
FLOOD_LISTENERS = set()
FLOOD_LISTENERS_LOCK = Lock()

def register_flood_listener(q):
    """Mendaftarkan queue SSE client baru."""
    with FLOOD_LISTENERS_LOCK:
        FLOOD_LISTENERS.add(q)

def unregister_flood_listener(q):
    """Menghapus queue SSE client saat disconnect."""
    with FLOOD_LISTENERS_LOCK:
        FLOOD_LISTENERS.discard(q)

def broadcast_flood_data(data):
    """Mengirim data terbaru ke seluruh antrian SSE yang aktif."""
    with FLOOD_LISTENERS_LOCK:
        dead_queues = []
        for q in FLOOD_LISTENERS:
            try:
                if q.full():
                    try:
                        q.get_nowait()
                    except Exception:
                        pass
                q.put_nowait(data)
            except Exception:
                dead_queues.append(q)
        for dq in dead_queues:
            FLOOD_LISTENERS.discard(dq)

def get_latest_flood_data():
    """Mengambil salinan data banjir terbaru yang diterima dari MQTT."""
    with FLOOD_LOCK:
        return {
            "lidah": LATEST_FLOOD_DATA["lidah"],
            "ketintang": LATEST_FLOOD_DATA["ketintang"],
            "last_updated": LATEST_FLOOD_DATA["last_updated"]
        }

def on_flood_connect(client, userdata, flags, rc, *args):
    if rc == 0:
        print("[MQTT-Flood] Terhubung ke broker EMQX dengan akun Banjir!")
        topic_lw = getattr(Config, "MQTT_TOPIC_FLOOD_LW", "unesa/flows/lidahwetan")
        topic_kt = getattr(Config, "MQTT_TOPIC_FLOOD_KT", "unesa/flows/ketintang")
        client.subscribe([(topic_lw, 0), (topic_kt, 0)])
        print(f"[MQTT-Flood] Subscribed ke topik banjir: {topic_lw}, {topic_kt}")
    else:
        print(f"[MQTT-Flood] Gagal terhubung, return code: {rc}")

# Rate limiter simpan database banjir (maksimal 1 record per 1 detik per lokasi)
LAST_FLOOD_DB_SAVE = {
    "lidah": 0,
    "ketintang": 0
}

def save_flood_to_db(location, data, raw_payload=None):
    """Menyimpan data telemetri banjir ke tabel flood_data di MariaDB."""
    global LAST_FLOOD_DB_SAVE
    now = time.time()
    
    # Throttle: simpan maksimal 1x per 1 detik per lokasi agar data database selalu segar (delay rendah)
    if now - LAST_FLOOD_DB_SAVE.get(location, 0) < 1.0:
        return

    conn = None
    cursor = None
    try:
        from database.db import get_connection
        conn = get_connection()
        cursor = conn.cursor()

        water = float(data.get("jarak", 0) or 0)
        temp_val = data.get("suhu_udara")
        if temp_val is None:
            temp_val = data.get("suhu_air_1", 0)
        temp = float(temp_val or 0)
        soil = float(data.get("soil", 0) or 0)
        rain = float(data.get("rain", 0) or 0)
        p_temp = float(data.get("temp_panel", 0) or 0)
        p_hum = float(data.get("hum_panel", 0) or 0)

        status = data.get("status")
        if not status:
            if water >= 100:
                status = "BAHAYA"
            elif water >= 50:
                status = "WASPADA"
            else:
                status = "AMAN"
        else:
            status = str(status).strip().upper()

        query = """
            INSERT INTO flood_data (
                lokasi, water_level, air_temp, soil_moisture, 
                rain_intensity, panel_temp, panel_humidity, status, raw_payload
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        cursor.execute(query, (
            location, water, temp, soil, rain, p_temp, p_hum, status, raw_payload
        ))
        conn.commit()
        LAST_FLOOD_DB_SAVE[location] = now
        print(f"[Flood-DB] Data banjir {location} tersimpan: water={water}cm, status={status}")
    except Exception as e:
        print(f"[Flood-DB] Gagal simpan ke DB: {e}")
    finally:
        if cursor:
            try:
                cursor.close()
            except Exception:
                pass
        if conn:
            try:
                conn.close()
            except Exception:
                pass

def on_flood_message(client, userdata, msg):
    try:
        payload = msg.payload.decode("utf-8")
        data = json.loads(payload)
        if isinstance(data, dict):
            # Normalisasi alias suhu udara & suhu air
            if "suhu_air" in data and "suhu_air_2" not in data:
                data["suhu_air_2"] = data["suhu_air"]
            elif "suhu_air_2" in data and "suhu_air" not in data:
                data["suhu_air"] = data["suhu_air_2"]
            if "suhu_udara" in data and "suhu_air_1" not in data:
                data["suhu_air_1"] = data["suhu_udara"]
            elif "suhu_air_1" in data and "suhu_udara" not in data:
                data["suhu_udara"] = data["suhu_air_1"]
        topic = msg.topic

        topic_lw = getattr(Config, "MQTT_TOPIC_FLOOD_LW", "unesa/flows/lidahwetan")
        topic_kt = getattr(Config, "MQTT_TOPIC_FLOOD_KT", "unesa/flows/ketintang")

        updated_data = None
        current_loc = None
        with FLOOD_LOCK:
            if topic == topic_lw:
                current_loc = "lidah"
                LATEST_FLOOD_DATA["lidah"] = data
                LATEST_FLOOD_DATA["last_updated"] = time.time()
                updated_data = dict(LATEST_FLOOD_DATA)
            elif topic == topic_kt:
                current_loc = "ketintang"
                LATEST_FLOOD_DATA["ketintang"] = data
                LATEST_FLOOD_DATA["last_updated"] = time.time()
                updated_data = dict(LATEST_FLOOD_DATA)

        if updated_data:
            broadcast_flood_data(updated_data)

        # Simpan ke MariaDB secara otomatis
        if current_loc:
            save_flood_to_db(current_loc, data, raw_payload=payload)
    except Exception as e:
        print(f"[MQTT-Flood] Kesalahan parsing pesan ({msg.topic}): {e}")

_flood_client_instance = None

def start_flood_subscriber():
    """
    Inisialisasi dan jalankan MQTT flood subscriber client (non-blocking / loop_start).
    Bisa dipanggil aman dari app.py atau background worker.
    """
    global _flood_client_instance
    if _flood_client_instance is not None:
        return _flood_client_instance

    broker = getattr(Config, "MQTT_BROKER", "oc61af70.ala.eu-central-1.emqxsl.com")
    port = int(getattr(Config, "MQTT_TCP_PORT", 8883))

    flood_user = getattr(Config, "MQTT_FLOOD_USERNAME", "Banjir")
    flood_pwd = getattr(Config, "MQTT_FLOOD_PASSWORD", "")

    try:
        # Dukungan paho-mqtt v1 dan v2
        try:
            client = mqtt.Client(
                callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"flask_flood_{int(time.time())}"
            )
        except (AttributeError, TypeError):
            client = mqtt.Client(client_id=f"flask_flood_{int(time.time())}")

        if flood_user and flood_pwd:
            client.username_pw_set(flood_user, flood_pwd)

        client.on_connect = on_flood_connect
        client.on_message = on_flood_message

        if port == 8883:
            try:
                client.tls_set()
            except Exception as e:
                print(f"[MQTT-Flood] TLS Setup warning: {e}")

        client.connect(broker, port, 60)
        client.loop_start()
        _flood_client_instance = client
        print(f"[MQTT-Flood] Client dimulai ke {broker}:{port}")
        return client
    except Exception as e:
        print(f"[MQTT-Flood] Error inisialisasi koneksi: {e}")
        return None

def main():
    """
    Entry point jika dijalankan sebagai standalone service.
    """
    print("=" * 50)
    print("USSC - FLOOD MONITORING MQTT SUBSCRIBER")
    print("=" * 50)
    client = start_flood_subscriber()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[MQTT-Flood] Menghentikan service...")
        if client:
            client.loop_stop()
            client.disconnect()

if __name__ == "__main__":
    main()

