import os
import sys
from pathlib import Path
from flask import Flask

# =====================================================
# PATH RESOLUTION (Mencegah ModuleNotFoundError)
# =====================================================
# Pastikan folder backend dan root selalu ada di sys.path
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent

if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# =====================================================
# CONFIG & BLUEPRINTS
# =====================================================
try:
    from backend.config import Config
except ImportError:
    from config import Config

try:
    from backend.api.traffic import traffic_bp
    from backend.api.trafficgrafik import traffic_grafik_bp
    from backend.api.dashboard import dashboard_bp
    from backend.api.chart import chart_bp
    from backend.api.table import table_bp
    from backend.api.airquality import airquality_bp
    from backend.api.flood import flood_bp
    from backend.api.export import export_bp
    from backend.api.digital_twin import digital_twin_bp
except ImportError:
    from api.traffic import traffic_bp
    from api.trafficgrafik import traffic_grafik_bp
    from api.dashboard import dashboard_bp
    from api.chart import chart_bp
    from api.table import table_bp
    from api.airquality import airquality_bp
    from api.flood import flood_bp
    from api.export import export_bp
    from api.digital_twin import digital_twin_bp


# =====================================================
# UTF-8 ENCODING
# =====================================================
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


# =====================================================
# FLASK APP SETUP
# =====================================================
app = Flask(__name__)
app.config.from_object(Config)


# =====================================================
# CORS SETUP
# =====================================================
try:
    from flask_cors import CORS

    CORS(
        app,
        origins=[
            "http://192.168.1.147:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "http://ussc.hint-lab.id",
            "https://ussc.hint-lab.id",
            "http://100.86.6.76:3000",
        ]
    )
    print("✓ CORS enabled")
except ImportError:
    print("⚠ flask-cors tidak terpasang")


# =====================================================
# REGISTER BLUEPRINTS
# =====================================================
app.register_blueprint(traffic_bp)
app.register_blueprint(traffic_grafik_bp)
app.register_blueprint(dashboard_bp)
app.register_blueprint(chart_bp)
app.register_blueprint(table_bp)
app.register_blueprint(airquality_bp)
app.register_blueprint(flood_bp)
app.register_blueprint(export_bp)
app.register_blueprint(digital_twin_bp)


# =====================================================
# BACKGROUND WORKERS (MQTT FLOOD SUBSCRIBER)
# =====================================================
def start_background_workers():
    # 1. Start Flood Monitoring MQTT Subscriber
    try:
        try:
            from kirimesp.ambildata import start_flood_subscriber
        except ImportError:
            from backend.kirimesp.ambildata import start_flood_subscriber

        start_flood_subscriber()
        print("🌊 Flood Monitoring MQTT Subscriber Berhasil Dimulai!")
    except Exception as e:
        print(f"⚠ Gagal memulai Flood MQTT Subscriber: {e}")

    # 2. Start AirGradient Background Service (opsional)
    try:
        try:
            from airgradient.ambil import mulai_airgradient
        except ImportError:
            from backend.airgradient.ambil import mulai_airgradient
        
        from threading import Thread
        ag_thread = Thread(target=mulai_airgradient, daemon=True)
        ag_thread.start()
        print("🌿 AirGradient Background Service Berhasil Dimulai!")
    except Exception as e:
        pass

# Jalankan background workers otomatis saat app dimuat
start_background_workers()


# =====================================================
# HEALTH CHECK
# =====================================================
@app.route("/health")
def health():
    return {
        "status": "ok",
        "service": "Smart Sustainability Campus API"
    }


# =====================================================
# RUN DEV SERVER
# =====================================================
if __name__ == "__main__":
    print("=" * 60)
    print("SMART SUSTAINABILITY CAMPUS")
    print("Flask API")
    print("=" * 60)
    print(f"Host : {Config.HOST}")
    print(f"Port : {Config.PORT}")

    app.run(
        host=Config.HOST,
        port=Config.PORT,
        debug=False,
        threaded=True
    )
