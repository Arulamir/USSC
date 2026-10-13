import os
from pathlib import Path
from dotenv import load_dotenv
import requests
from datetime import datetime

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

API_TOKEN = os.getenv("AIRGRADIENT_TOKEN", "")
LOCATION_ID = 202132

BASE_URL = (
    f"https://api.airgradient.com/public/api/v1/"
    f"locations/{LOCATION_ID}/measures/current"
)

print("=" * 70)
print("CEK LANGSUNG API AIRGRADIENT")
print("=" * 70)

print("Waktu cek :", datetime.now())
print("Location  :", LOCATION_ID)
print("URL       :", BASE_URL)

try:

    response = requests.get(
        BASE_URL,
        params={
            "token": API_TOKEN
        },
        timeout=15
    )

    print("\nHTTP STATUS :", response.status_code)

    print("\nRESPONSE:")
    print(response.text)

    response.raise_for_status()

except requests.exceptions.HTTPError as e:

    print("\nHTTP ERROR:")
    print(e)

except Exception as e:

    print("\nERROR:")
    print(e)