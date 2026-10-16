
from flask import Flask, jsonify, request
import requests
from flask_cors import CORS
import mariadb
import os
import threading
import time
import math
import json
from functools import wraps
from dotenv import load_dotenv
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

import config
import dssready
from dss_session import dss_session
from mediamtx_client import MediaMTXClient
from auth_routes import register_auth_routes
from account_routes import register_account_routes


# ============================================================
# FLASK
# ============================================================

app = Flask(__name__)


# ============================================================
# CORS
# ============================================================

CORS(
    app,
    origins=[
        "http://localhost:3000",
        "http://100.86.6.76:3003",
        "https://admin-ussc.nurutomo.my.id"
    ]
)


# ============================================================
# MEDIAMTX CONFIG
# ============================================================

# Host MediaMTX yang digunakan oleh browser/frontend.
#
# Contoh:
#   MEDIAMTX_PUBLIC_HOST=100.86.6.76
#
# Jangan gunakan 127.0.0.1 di sini jika URL ini dikirim
# ke browser client lain.
#
load_dotenv(Path(__file__).resolve().parent / ".env")
MEDIAMTX_PUBLIC_HOST = os.getenv(
    "MEDIAMTX_PUBLIC_HOST",
    "100.86.6.76"
)

MEDIAMTX_RTSP_PORT = int(
    os.getenv(
        "MEDIAMTX_RTSP_PORT",
        "8554"
    )
)

MEDIAMTX_WEBRTC_PORT = int(
    os.getenv(
        "MEDIAMTX_WEBRTC_PORT",
        "8889"
    )
)


# ============================================================
# MEDIAMTX INTERNAL CONFIG
# ============================================================

# Flask berkomunikasi langsung dengan MediaMTX di server yang
# sama, sehingga gunakan localhost.
#
MEDIAMTX_INTERNAL_HOST = os.getenv(
    "MEDIAMTX_INTERNAL_HOST",
    "127.0.0.1"
)

MEDIAMTX_API_PORT = int(
    os.getenv(
        "MEDIAMTX_API_PORT",
        "9997"
    )
)


# ============================================================
# MEDIAMTX VIEWER AUTH
# ============================================================

MEDIAMTX_VIEWER_USERNAME = os.getenv(
    "MEDIAMTX_VIEWER_USERNAME",
    "ussc_viewer"
)

MEDIAMTX_VIEWER_PASSWORD = os.getenv("MEDIAMTX_VIEWER_PASSWORD", "")


# ============================================================
# MEDIAMTX CLIENT
# ============================================================

mediamtx_client = MediaMTXClient()


# ============================================================
# GLOBAL STREAM STATE
# ============================================================

stream_cache = {}


# Lock untuk operasi stream.
stream_lock = threading.Lock()


# ============================================================
# MEDIAMTX PATH HELPER
# ============================================================

def make_mediamtx_path(public_code):
    """
    Mengubah public_code menjadi nama path MediaMTX
    yang aman digunakan sebagai path/URL.
    """

    safe_name = "".join(
        c
        if c.isalnum() or c in "-_"
        else "_"
        for c in public_code
    )

    return safe_name


# ============================================================
# STREAM URL HELPER
# ============================================================

def build_stream_urls(mediamtx_path):
    """
    Membuat URL stream MediaMTX untuk client/frontend.
    """

    rtsp_url = (
        f"rtsp://"
        f"{MEDIAMTX_PUBLIC_HOST}:"
        f"{MEDIAMTX_RTSP_PORT}/"
        f"{mediamtx_path}"
    )

    webrtc_url = (
        f"http://"
        f"{MEDIAMTX_PUBLIC_HOST}:"
        f"{MEDIAMTX_WEBRTC_PORT}/"
        f"{mediamtx_path}/whep"
    )

    return {
        "rtsp": rtsp_url,
        "webrtc": webrtc_url
    }


# ============================================================
# DATABASE
# ============================================================

def get_db():

    return mariadb.connect(
        host=config.DB_HOST,
        port=config.DB_PORT,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_NAME
    )

# ============================================================
# AUTHENTICATION: LOGIN, SESSION, LOGOUT
# ============================================================

register_auth_routes(app, get_db)
register_account_routes(app, get_db)


# ============================================================
# AUTHORIZATION: ADMIN CAMERA API
# ============================================================

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        current_user = app.extensions["ussc_current_user"]
        user = current_user()

        if not user:
            return jsonify(
                success=False,
                error="Silakan login terlebih dahulu"
            ), 401

        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        current_user = app.extensions["ussc_current_user"]
        user = current_user()

        if not user:
            return jsonify(
                success=False,
                error="Silakan login terlebih dahulu"
            ), 401

        is_master = bool(user.get("is_master_admin"))
        is_admin = user.get("role") == "admin"

        if not (is_master or is_admin):
            return jsonify(
                success=False,
                error="Akses khusus Admin atau Master"
            ), 403

        return view(*args, **kwargs)

    return wrapped

# ============================================================
# GET SEMUA CAMERA
# ============================================================

@app.route("/api/admin/cameras",methods=["GET"])
@login_required
def get_cameras():

    db = None
    cursor = None

    try:

        db = get_db()

        cursor = db.cursor(
            dictionary=True
        )

        cursor.execute("""
            SELECT
                c.id,
                c.public_code,
                c.public_name,
                c.source_type,
                c.source_id,

                c.latitude,
                c.longitude,

                c.status,
                c.enabled,

                c.created_at,
                c.updated_at

            FROM cameras c

            WHERE c.enabled = 1

            ORDER BY c.public_code
        """)

        cameras = cursor.fetchall()

        return jsonify({
            "success": True,
            "data": cameras
        })

    except Exception as e:

        print(
            "[GET CAMERAS ERROR]",
            type(e).__name__,
            e
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

    finally:

        if cursor:

            cursor.close()

        if db:

            db.close()


# ============================================================
# GET SATU CAMERA
# ============================================================

@app.route("/api/admin/cameras/<path:public_code>",methods=["GET"])
@login_required
def get_camera(public_code):

    db = None
    cursor = None

    try:

        db = get_db()

        cursor = db.cursor(
            dictionary=True
        )

        # ====================================================
        # CAMERA UTAMA
        # ====================================================

        cursor.execute("""
            SELECT
                id,
                public_code,
                public_name,
                source_type,
                source_id,
                latitude,
                longitude,
                enabled,
                status
            FROM cameras
            WHERE public_code = ?
            LIMIT 1
        """, (public_code,))

        camera = cursor.fetchone()

        if not camera:

            return jsonify({
                "success": False,
                "error": "Kamera tidak ditemukan"
            }), 404

        # ====================================================
        # DSS
        # ====================================================

        if camera["source_type"] == "DSS":

            cursor.execute("""
                SELECT
                    public_code,
                    public_name,
                    dss_camera_code,
                    dss_camera_name,
                    dss_device_code,
                    status,
                    enabled,
                    gateway_id,
                    remote_path,
                    mediamtx_path
                FROM dss_cameras
                WHERE public_code = ?
                LIMIT 1
            """, (public_code,))

            source = cursor.fetchone()

            if source:

                camera.update(source)

        # ====================================================
        # TAILSCALE
        # ====================================================

        elif camera["source_type"] == "TAILSCALE":

            cursor.execute("""
                SELECT
                    id,
                    name AS gateway_name,
                    tailscale_ip,
                    rtsp_port,
                    mediamtx_path AS gateway_mediamtx_path,
                    enabled AS gateway_enabled,
                    status AS gateway_status
                FROM stream_tailscale
                WHERE id = ?
                LIMIT 1
            """, (camera["source_id"],))

            source = cursor.fetchone()

            if source:

                camera.update(source)

        return jsonify({
            "success": True,
            "data": camera
        })

    except Exception as e:

        print(
            "[GET CAMERA ERROR]",
            type(e).__name__,
            e
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

    finally:

        if cursor:

            cursor.close()

        if db:

            db.close()


# ============================================================
# UPDATE DATA KAMERA
# ============================================================

PUBLIC_CAMERA_NAMES = {
    "CCTV GERBANG UTAMA LIDAH 2",
    "CCTV GERBANG UTAMA KETINTANG 1",
}

@app.route("/api/public/cameras", methods=["GET"])
def get_public_cameras():
    conn = get_db()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT public_code, public_name,
                   latitude, longitude, status
            FROM cameras
            WHERE enabled = 1
        """)
        rows = cursor.fetchall()

        allowed = [
            {
                "public_code": row["public_code"],
                "public_name": row["public_name"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "status": row["status"],
            }
            for row in rows
            if row["public_name"] in PUBLIC_CAMERA_NAMES
        ]

        return {"success": True, "data": allowed}, 200
    finally:
        conn.close()

@app.route("/api/admin/cameras/<path:public_code>",methods=["PUT"])
@admin_required
def update_camera(public_code):
    print(f"[AUDIT DEBUG] PUT kamera diterima: {public_code}")
    db = None
    cursor = None

    try:
        payload = request.get_json(silent=True)

        if not isinstance(payload, dict):
            return jsonify({
                "success": False,
                "error": "Body harus berupa JSON"
            }), 400

        # Pastikan ketiga field dikirim oleh frontend.
        required_fields = {
            "public_name",
            "latitude",
            "longitude"
        }

        if not required_fields.issubset(payload.keys()):
            return jsonify({
                "success": False,
                "error": (
                    "Field public_name, latitude, "
                    "dan longitude wajib dikirim"
                )
            }), 400

        # Nama kamera boleh kosong; tampilan akan menggunakan
        # public_code sebagai nama pengganti.
        public_name = payload["public_name"]

        if public_name is not None:
            if not isinstance(public_name, str):
                return jsonify({
                    "success": False,
                    "error": "Nama kamera harus berupa teks"
                }), 400

            public_name = public_name.strip() or None

            if public_name and len(public_name) > 100:
                return jsonify({
                    "success": False,
                    "error": "Nama kamera maksimal 100 karakter"
                }), 400

        def parse_coordinate(value, field, minimum, maximum):
            if value is None or value == "":
                return None

            if isinstance(value, bool):
                raise ValueError(
                    f"{field} harus berupa angka"
                )

            try:
                number = float(value)
            except (TypeError, ValueError):
                raise ValueError(
                    f"{field} harus berupa angka"
                )

            if not math.isfinite(number):
                raise ValueError(
                    f"{field} harus berupa angka yang valid"
                )

            if not minimum <= number <= maximum:
                raise ValueError(
                    f"{field} harus antara {minimum} dan {maximum}"
                )

            return number

        latitude = parse_coordinate(
            payload["latitude"],
            "Latitude",
            -90,
            90
        )

        longitude = parse_coordinate(
            payload["longitude"],
            "Longitude",
            -180,
            180
        )

        db = get_db()
        cursor = db.cursor(dictionary=True)

        cursor.execute("""
            SELECT id, public_code, public_name, latitude, longitude
            FROM cameras
            WHERE public_code = ?
            LIMIT 1
        """, (public_code,))

        camera = cursor.fetchone()

        if not camera:
            return jsonify({
                "success": False,
                "error": "Kamera tidak ditemukan"
            }), 404

        # Ambil identitas aktor dari sesi login yang tervalidasi.
        actor = app.extensions["ussc_current_user"]()

        if not actor:
            return jsonify({
                "success": False,
                "error": "Sesi login tidak valid"
            }), 401

        def audit_coordinate(value):
            if value is None or value == "":
                return None
            return round(float(value), 7)

        before_data = {
            "public_name": camera["public_name"],
            "latitude": audit_coordinate(camera["latitude"]),
            "longitude": audit_coordinate(camera["longitude"]),
        }

        after_data = {
            "public_name": public_name,
            "latitude": audit_coordinate(latitude),
            "longitude": audit_coordinate(longitude),
        }

        # Hanya catat jika ada perubahan nilai.
        if before_data != after_data:
            print("[AUDIT DEBUG] Nilai berubah, mencoba menyimpan audit")
            print("[AUDIT DEBUG] Actor:", actor["username"])
            cursor.execute("""
                UPDATE cameras
                SET
                    public_name = ?,
                    latitude = ?,
                    longitude = ?
                WHERE public_code = ?
            """, (
                public_name,
                latitude,
                longitude,
                public_code
            ))

            cursor.execute("""
                INSERT INTO audit_logs (
                    actor_user_id,
                    actor_username,
                    action,
                    object_type,
                    object_id,
                    object_code,
                    before_data,
                    after_data
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                actor["id"],
                actor["username"],
                "camera.update",
                "camera",
                str(camera["id"]),
                camera["public_code"],
                json.dumps(before_data, ensure_ascii=False),
                json.dumps(after_data, ensure_ascii=False)
            ))

        # Perubahan kamera dan catatan audit disimpan bersama.
        db.commit()
        print("[AUDIT DEBUG] Transaksi berhasil di-commit")

        # Ambil data terbaru setelah disimpan.
        cursor.execute("""
            SELECT
                id,
                public_code,
                public_name,
                source_type,
                source_id,
                latitude,
                longitude,
                status,
                enabled
            FROM cameras
            WHERE public_code = ?
            LIMIT 1
        """, (public_code,))

        updated_camera = cursor.fetchone()

        return jsonify({
            "success": True,
            "message": "Data kamera berhasil diperbarui",
            "data": updated_camera
        })

    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400

    except Exception as e:
        if db:
            db.rollback()

        print(
            "[UPDATE CAMERA ERROR]",
            type(e).__name__,
            e
        )

        return jsonify({
            "success": False,
            "error": "Gagal memperbarui data kamera"
        }), 500

    finally:
        if cursor:
            cursor.close()

        if db:
            db.close()
            
# ============================================================
# START CAMERA
# ============================================================

@app.route("/api/admin/cameras/<path:public_code>/start", methods=["POST"])
@admin_required
def start_camera(public_code):

    db = None
    cursor = None

    try:

        # ====================================================
        # 1. CAMERA UTAMA
        # ====================================================

        db = get_db()

        cursor = db.cursor(
            dictionary=True
        )

        cursor.execute("""
            SELECT
                id,
                public_code,
                public_name,
                source_type,
                source_id,
                latitude,
                longitude,
                enabled,
                status
            FROM cameras
            WHERE public_code = ?
            LIMIT 1
        """, (public_code,))

        camera = cursor.fetchone()

        if not camera:

            return jsonify({
                "success": False,
                "error": "Kamera tidak ditemukan"
            }), 404

        if not camera["enabled"]:

            return jsonify({
                "success": False,
                "error": "Kamera sedang disabled"
            }), 400

        source_type = camera["source_type"]

        print()
        print("=" * 70)
        print(
            f"[CAMERA] START {public_code}"
        )
        print(
            f"[CAMERA] SOURCE TYPE = {source_type}"
        )
        print("=" * 70)

        # ====================================================
        # 2. CACHE
        # ====================================================

        with stream_lock:

            cached_stream = stream_cache.get(
                public_code
            )

        if cached_stream:

            print(
                f"[CAMERA] Stream cache ditemukan: "
                f"{public_code}"
            )

            urls = build_stream_urls(
                cached_stream["mediamtx_path"]
            )

            return jsonify({
                "success": True,

                "camera":
                    camera,

                "stream": {
                    "type":
                        "mediamtx",

                    "path":
                        cached_stream[
                            "mediamtx_path"
                        ],

                    "rtsp":
                        urls["rtsp"],

                    "webrtc":
                        urls["webrtc"]
                }
            })

        # ====================================================
        # 3. MEDIAMTX PATH
        # ====================================================

        mediamtx_path = make_mediamtx_path(
            public_code
        )

        print(
            f"[MEDIAMTX] PATH = "
            f"{mediamtx_path}"
        )

        # ====================================================
        # 4. SOURCE RTSP
        # ====================================================

        rtsp_url = None

        # ====================================================
        # SOURCE DSS
        # ====================================================

        if source_type == "DSS":

            cursor.execute("""
                SELECT
                    public_code,
                    public_name,
                    dss_camera_code,
                    dss_camera_name,
                    dss_device_code,
                    status,
                    enabled,
                    gateway_id,
                    remote_path,
                    mediamtx_path
                FROM dss_cameras
                WHERE public_code = ?
                LIMIT 1
            """, (public_code,))

            dss_camera = cursor.fetchone()

            if not dss_camera:

                return jsonify({
                    "success": False,
                    "error":
                        "Data kamera DSS tidak ditemukan"
                }), 404

            if not dss_camera["enabled"]:

                return jsonify({
                    "success": False,
                    "error":
                        "Kamera DSS sedang disabled"
                }), 400

            # ------------------------------------------------
            # CHANNEL DSS
            # ------------------------------------------------

            channel = {
                "channelCode":
                    dss_camera[
                        "dss_camera_code"
                    ],

                "channelName":
                    dss_camera[
                        "dss_camera_name"
                    ],

                "deviceCode":
                    dss_camera[
                        "dss_device_code"
                    ]
            }

            print(
                "[DSS] Request StartVideo..."
            )

            result = dss_session.start_live(
                channel
            )

            if not result:

                return jsonify({
                    "success": False,
                    "error":
                        "StartVideo DSS gagal"
                }), 500

            # ------------------------------------------------
            # RTSP DSS
            # ------------------------------------------------

            rtsp_url = dssready.find_rtsp(
                result
            )
            if not rtsp_url:
                print("[DSS ERROR] RTSP URL tidak ditemukan dalam hasil StartLive")

                return jsonify({
                    "success": False,
                    "error": "RTSP DSS tidak ditemukan"
                }), 500
            parsed = urlsplit(rtsp_url)

            
            if parsed.scheme not in ("rtsp", "rtsps") or not parsed.hostname:
                print("[DSS ERROR] Format RTSP tidak valid")

                return jsonify({
                    "success": False,
                    "error": "Format RTSP DSS tidak valid"
                }), 500

            print("[DSS] RTSP berhasil diperoleh")

            if not rtsp_url:

                return jsonify({
                    "success": False,
                    "error":
                        "RTSP DSS tidak ditemukan"
                }), 500

            print(
                "[DSS] RTSP berhasil diperoleh"
            )

        # ====================================================
        # SOURCE TAILSCALE
        # ====================================================

        elif source_type == "TAILSCALE":

            cursor.execute("""
                SELECT
                    id,
                    name,
                    tailscale_ip,
                    rtsp_port,
                    mediamtx_path,
                    enabled,
                    status
                FROM stream_tailscale
                WHERE id = ?
                LIMIT 1
            """, (camera["source_id"],))

            tailscale = cursor.fetchone()

            if not tailscale:

                return jsonify({
                    "success": False,
                    "error":
                        "Gateway Tailscale tidak ditemukan"
                }), 404

            if not tailscale["enabled"]:

                return jsonify({
                    "success": False,
                    "error":
                        "Gateway Tailscale sedang disabled"
                }), 400

            tailscale_ip = (
                tailscale["tailscale_ip"]
            )

            rtsp_port = (
                tailscale["rtsp_port"]
            )

            remote_path = (
                tailscale["mediamtx_path"]
            )

            rtsp_url = (
                f"rtsp://"
                f"{tailscale_ip}:"
                f"{rtsp_port}/"
                f"{remote_path}"
            )

            print(
                "[TAILSCALE] RTSP source:"
            )

            print(
                f"[TAILSCALE] {rtsp_url}"
            )

        # ====================================================
        # SOURCE TIDAK DIDUKUNG
        # ====================================================

        else:

            return jsonify({
                "success": False,
                "error":
                    f"Source type tidak didukung: "
                    f"{source_type}"
            }), 400

        # ====================================================
        # 5. DAFTARKAN RTSP KE MEDIAMTX
        # ====================================================

        try:

            print(
                f"[MEDIAMTX] Checking path "
                f"{mediamtx_path}"
            )

            existing_paths = (
                mediamtx_client.list_paths()
            )

            existing = None

            for item in existing_paths.get(
                "items",
                []
            ):

                if item.get(
                    "name"
                ) == mediamtx_path:

                    existing = item

                    break

            # ------------------------------------------------
            # DELETE PATH LAMA
            # ------------------------------------------------

            if existing:

                print(
                    f"[MEDIAMTX] Path lama ditemukan: "
                    f"{mediamtx_path}"
                )

                mediamtx_client.delete_path(
                    mediamtx_path
                )

                print(
                    "[MEDIAMTX] Path lama dihapus"
                )

            # ------------------------------------------------
            # ADD PATH
            # ------------------------------------------------

            print(
                "[MEDIAMTX] Adding path..."
            )

            mediamtx_client.add_path(
                mediamtx_path,
                rtsp_url
            )

            print(
                f"[MEDIAMTX] ADD SUCCESS "
                f"{mediamtx_path}"
            )
            # ------------------------------------------------
            # WAIT UNTIL STREAM READY
            # ------------------------------------------------

            print()
            print("=" * 70)
            print("[MEDIAMTX] Waiting for stream to become ready...")
            print("PATH :", mediamtx_path)
            print("=" * 70)

            mediamtx_status = (
                mediamtx_client.wait_until_online(
                    mediamtx_path,
                    timeout=10,
                    interval=0.25
                )
            )

            if not mediamtx_status:

                print()
                print("=" * 70)
                print(
                    f"[MEDIAMTX] STREAM NOT READY "
                    f"{mediamtx_path}"
                )
                print("=" * 70)

                # --------------------------------------------
                # CLEANUP MEDIAMTX PATH
                # --------------------------------------------

                try:

                    mediamtx_client.delete_path(
                        mediamtx_path
                    )

                    print(
                        f"[MEDIAMTX] Cleanup path success "
                        f"{mediamtx_path}"
                    )

                except Exception as cleanup_error:

                    print(
                        "[MEDIAMTX CLEANUP ERROR]",
                        type(cleanup_error).__name__,
                        cleanup_error
                    )

                return jsonify({
                    "success": False,
                    "error":
                        "MediaMTX stream tidak menjadi ready",
                    "path":
                        mediamtx_path
                }), 504

            print()
            print("=" * 70)
            print(
                f"[MEDIAMTX] STREAM READY "
                f"{mediamtx_path}"
            )
            print(
                "[MEDIAMTX] TRACKS :",
                mediamtx_status.get("tracks")
            )
            print("=" * 70)

        except Exception as e:

            print(
                "[MEDIAMTX ERROR]",
                type(e).__name__,
                e
            )

            return jsonify({
                "success": False,
                "error":
                    f"MediaMTX gagal: {str(e)}"
            }), 500

        # ====================================================
        # 6. CACHE
        # ====================================================

        with stream_lock:

            stream_cache[
                public_code
            ] = {

                "rtsp_url":
                    rtsp_url,

                "mediamtx_path":
                    mediamtx_path,

                "created_at":
                    time.time()
            }

        # ====================================================
        # 7. URL
        # ====================================================

        urls = build_stream_urls(
            mediamtx_path
        )

        # ====================================================
        # 8. RESPONSE
        # ====================================================

        print()
        print("=" * 70)
        print(
            f"[CAMERA] START SUCCESS "
            f"{public_code}"
        )
        print("=" * 70)

        return jsonify({

            "success": True,

            "camera":
                camera,

            "stream": {

                "type":
                    "mediamtx",

                "path":
                    mediamtx_path,

                "rtsp":
                    urls["rtsp"],

                "webrtc":
                    urls["webrtc"]
            }
        })

    except Exception as e:

        print(
            "[START CAMERA ERROR]",
            type(e).__name__,
            e
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

    finally:

        if cursor:

            cursor.close()

        if db:

            db.close()

@app.route("/api/whep/<path:camera_path>",methods=["POST"])
def whep_proxy(camera_path):

    print()
    print("=" * 70)
    print("[WHEP PROXY]")
    print("=" * 70)

    print(
        "[WHEP] CAMERA PATH :",
        camera_path
    )

    # ========================================================
    # AUTH
    # ========================================================

    viewer_username = (
        MEDIAMTX_VIEWER_USERNAME
    )

    viewer_password = (
        MEDIAMTX_VIEWER_PASSWORD
    )

    # ========================================================
    # TARGET MEDIAMTX
    # ========================================================

    whep_url = (
        f"http://"
        f"{MEDIAMTX_INTERNAL_HOST}:"
        f"{MEDIAMTX_WEBRTC_PORT}/"
        f"{camera_path}/whep"
    )

    print(
        "[WHEP] TARGET :",
        whep_url
    )

    print(
        "[WHEP] USER   :",
        viewer_username
    )

    print(
        "[WHEP] PASSWORD LENGTH :",
        len(viewer_password)
    )

    # ========================================================
    # PASSWORD CHECK
    # ========================================================

    if not viewer_password:

        print(
            "[WHEP ERROR] "
            "Viewer password belum diset"
        )

        return jsonify({
            "success": False,
            "error":
                "MediaMTX viewer password "
                "belum dikonfigurasi"
        }), 500

    try:

        # ====================================================
        # AMBIL SDP DARI BROWSER
        # ====================================================

        sdp = request.get_data(
            as_text=True
        )

        if not sdp:

            print(
                "[WHEP ERROR] SDP kosong"
            )

            return jsonify({
                "success": False,
                "error": "SDP kosong"
            }), 400

        print(
            "[WHEP] SDP LENGTH :",
            len(sdp)
        )

        # ====================================================
        # REQUEST KE MEDIAMTX
        # ====================================================

        response = requests.post(
            whep_url,

            data=sdp,

            headers={
                "Content-Type":
                    "application/sdp"
            },

            auth=(
                viewer_username,
                viewer_password
            ),

            timeout=15
        )

        # ====================================================
        # RESPONSE STATUS
        # ====================================================

        print(
            "[WHEP] STATUS :",
            response.status_code
        )

        # ====================================================
        # ERROR DARI MEDIAMTX
        # ====================================================

        if not response.ok:

            print(
                "[WHEP ERROR BODY] :",
                response.text
            )

            return (
                response.text,

                response.status_code,

                {
                    "Content-Type":
                        response.headers.get(
                            "Content-Type",
                            "text/plain"
                        )
                }
            )

        # ====================================================
        # BERHASIL
        # ====================================================

        print(
            "[WHEP] SDP ANSWER RECEIVED"
        )

        return (
            response.text,

            response.status_code,

            {
                "Content-Type":
                    "application/sdp"
            }
        )

    except requests.RequestException as e:

        print(
            "[WHEP REQUEST ERROR]",
            repr(e)
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 502

    except Exception as e:

        print(
            "[WHEP INTERNAL ERROR]",
            type(e).__name__,
            e
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ============================================================
# STOP CAMERA
# ============================================================

@app.route(
    "/api/admin/cameras/<path:public_code>/stop",
    methods=["POST"]
)
@admin_required
def stop_camera(public_code):

    try:

        # ====================================================
        # 1. MEDIA MTX PATH
        # ====================================================

        mediamtx_path = make_mediamtx_path(
            public_code
        )

        print()
        print("=" * 70)
        print(
            f"[CAMERA] STOP {public_code}"
        )
        print("=" * 70)

        # ====================================================
        # 2. DELETE MEDIA MTX PATH
        # ====================================================

        try:

            mediamtx_client.delete_path(
                mediamtx_path
            )

            print(
                f"[MEDIAMTX] DELETE SUCCESS "
                f"{mediamtx_path}"
            )

        except Exception as e:

            print(
                "[MEDIAMTX DELETE ERROR]",
                type(e).__name__,
                e
            )

        # ====================================================
        # 3. HAPUS CACHE
        # ====================================================

        with stream_lock:

            stream_cache.pop(
                public_code,
                None
            )

        # ====================================================
        # 4. RESPONSE
        # ====================================================

        print(
            f"[CAMERA] STOP SUCCESS "
            f"{public_code}"
        )

        return jsonify({

            "success": True,

            "camera":
                public_code,

            "mediamtx_path":
                mediamtx_path

        })

    except Exception as e:

        print(
            "[STOP CAMERA ERROR]",
            type(e).__name__,
            e
        )

        return jsonify({

            "success": False,

            "error":
                str(e)

        }), 500


# ============================================================
# GET ACTIVE STREAMS
# ============================================================

@app.route("/api/admin/streams", methods=["GET"])
@admin_required
def get_active_streams():

    with stream_lock:

        streams = dict(
            stream_cache
        )

    return jsonify({

        "success": True,

        "count":
            len(streams),

        "data":
            streams

    })


# ============================================================
# HEALTH
# ============================================================

@app.route("/api/admin/health",methods=["GET"])
@admin_required
def health():

    # ========================================================
    # DSS
    # ========================================================

    dss_status = (
        dss_session.status()
    )

    # ========================================================
    # MEDIAMTX
    # ========================================================

    mediamtx_status = None

    try:

        result = (
            mediamtx_client.list_paths()
        )

        mediamtx_status = {

            "online":
                True,

            "path_count":
                len(
                    result.get(
                        "items",
                        []
                    )
                )
        }

    except Exception as e:

        mediamtx_status = {

            "online":
                False,

            "error":
                str(e)
        }

    # ========================================================
    # RESPONSE
    # ========================================================

    return jsonify({

        "success": True,

        "service":
            "USSC CCTV Admin",

        "status":
            "running",

        "dss_session":
            dss_status,

        "mediamtx":
            mediamtx_status

    })


# ============================================================
# DEBUG ROUTES
# ============================================================

@app.route("/api/debug/routes",methods=["GET"])
@admin_required
def debug_routes():

    routes = []

    for rule in app.url_map.iter_rules():

        routes.append({
            "rule": str(rule),
            "endpoint": rule.endpoint,
            "methods":
                sorted(
                    list(rule.methods)
                )
        })

    return jsonify({
        "success": True,
        "routes": routes
    })


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":

    print()
    print("=" * 70)
    print("USSC BACKEND STARTING")
    print("=" * 70)

    print(
        "[MEDIAMTX PUBLIC HOST]:",
        MEDIAMTX_PUBLIC_HOST
    )

    print(
        "[MEDIAMTX INTERNAL HOST]:",
        MEDIAMTX_INTERNAL_HOST
    )

    print(
        "[MEDIAMTX RTSP PORT]:",
        MEDIAMTX_RTSP_PORT
    )

    print(
        "[MEDIAMTX WEBRTC PORT]:",
        MEDIAMTX_WEBRTC_PORT
    )

    print(
        "[MEDIAMTX VIEWER USER]:",
        MEDIAMTX_VIEWER_USERNAME
    )

    print(
        "[MEDIAMTX VIEWER PASSWORD LENGTH]:",
        len(
            MEDIAMTX_VIEWER_PASSWORD
        )
    )

    # ========================================================
    # START PERSISTENT DSS SESSION
    # ========================================================

    dss_session.start()

    # ========================================================
    # START FLASK
    # ========================================================

    app.run(
        host="0.0.0.0",
        port=5003,
        debug=False
    )

