import os
from pathlib import Path
from dotenv import load_dotenv

# Cari file .env di folder backend/ atau di root folder proyek
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent

if (BASE_DIR / ".env").exists():
    load_dotenv(dotenv_path=BASE_DIR / ".env")
elif (ROOT_DIR / ".env").exists():
    load_dotenv(dotenv_path=ROOT_DIR / ".env")
else:
    load_dotenv()

class Config:

    SECRET_KEY = os.getenv("SECRET_KEY", "")

    # Database MariaDB / MySQL
    DB_HOST = os.getenv("DB_HOST", "localhost")
    DB_USER = os.getenv("DB_USER", "root")
    DB_PASSWORD = os.getenv("DB_PASSWORD", "")
    DB_NAME = os.getenv("DB_NAME", "ussc_db")
    DB_PORT = int(os.getenv("DB_PORT", 3306))

    # Host & Port Server Flask
    HOST = os.getenv("HOST", os.getenv("BACKEND_HOST", "0.0.0.0"))
    PORT = int(os.getenv("PORT", os.getenv("BACKEND_PORT", 5000)))

    # AirGradient Configuration
    AIRGRADIENT_TOKEN = os.getenv("AIRGRADIENT_TOKEN", "")
    AIRGRADIENT_LOCATION_ID = int(os.getenv("AIRGRADIENT_LOCATION_ID", 202132))

    # MQTT EMQX Cloud Configuration
    MQTT_BROKER = os.getenv("MQTT_BROKER", os.getenv("EMQX_HOST", "oc61af70.ala.eu-central-1.emqxsl.com"))
    MQTT_TCP_PORT = int(os.getenv("MQTT_TCP_PORT", os.getenv("EMQX_PORT", 8883)))
    MQTT_WS_PORT = int(os.getenv("MQTT_WS_PORT", 8084))

    # Kredensial Khusus Project Banjir
    MQTT_FLOOD_USERNAME = os.getenv("MQTT_FLOOD_USERNAME", "Banjir")
    MQTT_FLOOD_PASSWORD = os.getenv("MQTT_FLOOD_PASSWORD", "")
    MQTT_TOPIC_FLOOD_LW = os.getenv("MQTT_TOPIC_FLOOD_LW", "unesa/flows/lidahwetan")
    MQTT_TOPIC_FLOOD_KT = os.getenv("MQTT_TOPIC_FLOOD_KT", "unesa/flows/ketintang")

    # Kredensial Sensor / Project Lainnya (ESP32 UNESA / Monitoring)
    MQTT_USERNAME = os.getenv("MQTT_USERNAME", os.getenv("EMQX_USERNAME", "esp32unesa"))
    MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", os.getenv("EMQX_PASSWORD", ""))
    MQTT_TOPIC_MONITORING = os.getenv("MQTT_TOPIC_MONITORING", os.getenv("EMQX_TOPIC", "unesa/monitoring"))
    MQTT_TOPIC_AIR = os.getenv("MQTT_TOPIC_AIR", "unesa/airquality")