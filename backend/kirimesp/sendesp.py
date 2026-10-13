import os
import json
import ssl
from pathlib import Path
import paho.mqtt.client as mqtt
from dotenv import load_dotenv

# Prioritaskan loading .env dari direktori backend atau root proyek
_base_dir = Path(__file__).resolve().parent.parent
if (_base_dir / ".env").exists():
    load_dotenv(_base_dir / ".env")
elif (_base_dir.parent / ".env").exists():
    load_dotenv(_base_dir.parent / ".env")
else:
    load_dotenv()

EMQX_HOST = os.getenv("EMQX_HOST")
EMQX_PORT = int(os.getenv("EMQX_PORT", 8883))
EMQX_USERNAME = os.getenv("EMQX_USERNAME")
EMQX_PASSWORD = os.getenv("EMQX_PASSWORD")
EMQX_TOPIC = os.getenv("EMQX_TOPIC", "unesa/monitoring")


client = mqtt.Client(
    mqtt.CallbackAPIVersion.VERSION2,
    client_id="server-monitoring"
)

client.username_pw_set(
    EMQX_USERNAME,
    EMQX_PASSWORD
)

client.tls_set(
    cert_reqs=ssl.CERT_REQUIRED
)


def connect_mqtt():
    try:
        client.connect(
            EMQX_HOST,
            EMQX_PORT,
            keepalive=60
        )

        print("MQTT berhasil terhubung ke EMQX")

        client.loop_start()

        return True

    except Exception as e:
        print("MQTT gagal terhubung:", e)
        return False


def publish_monitoring(data):
    try:
        payload = json.dumps(data)

        result = client.publish(
            EMQX_TOPIC,
            payload,
            qos=1
        )

        if result.rc == mqtt.MQTT_ERR_SUCCESS:
            print("MQTT publish berhasil:")
            # print(payload)
            return True

        print("MQTT publish gagal:", result.rc)
        return False

    except Exception as e:
        print("Error MQTT:", e)
        return False