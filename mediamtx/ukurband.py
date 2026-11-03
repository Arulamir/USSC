import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

import time
import requests

API_URL = "http://127.0.0.1:9997/v3/paths/list"

AUTH = (os.getenv("MEDIAMTX_USERNAME", "ussc_api"), os.getenv("MEDIAMTX_PASSWORD", ""))

def get_camera_bytes():
    response = requests.get(
        API_URL,
        auth=AUTH,
        timeout=5
    )
    response.raise_for_status()

    items = response.json()["items"]

    for item in items:
        if item["name"] == "camera1":
            return (
                item["bytesReceived"],
                item["bytesSent"],
                item["ready"]
            )

    raise RuntimeError("Path camera1 tidak ditemukan")


before_in, before_out, ready = get_camera_bytes()

print("Camera1 ready:", ready)
print("Mengukur selama 30 detik...")

time.sleep(30)

after_in, after_out, ready = get_camera_bytes()

rx_mbps = (after_in - before_in) * 8 / 30 / 1_000_000
tx_mbps = (after_out - before_out) * 8 / 30 / 1_000_000

print(f"Bitrate masuk : {rx_mbps:.2f} Mbps")
print(f"Bitrate keluar: {tx_mbps:.2f} Mbps")