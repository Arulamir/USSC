import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

# ============================================================
# KONFIGURASI DAHUA DSS
# ============================================================

DSS_HOST = "https://103.242.125.125"

DSS_USERNAME = "ussc"
DSS_PASSWORD = os.getenv("DSS_PASSWORD", "")


# ============================================================
# KONFIGURASI LIVE VIEW
# ============================================================

REQUEST_TIMEOUT = 15

# 0 = Main Stream
# 1 = Sub Stream
STREAM_TYPE = "1"

DB_HOST = "localhost"
DB_PORT = 3306
DB_USER = os.getenv("DB_USER", "")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = "ussc_db"