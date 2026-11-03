
import time
import logging
import mariadb

import config
import dssready

from dss_session import dss_session
from mediamtx_client import MediaMTXClient

CHECK_INTERVAL = 30
RETRY_COOLDOWN = 90
FAILURE_THRESHOLD = 2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)

mtx = MediaMTXClient()
last_attempt = {}
failures = {}


def get_cameras():
    conn = mariadb.connect(
        host=config.DB_HOST,
        port=config.DB_PORT,
        user=config.DB_USER,
        password=config.DB_PASSWORD,
        database=config.DB_NAME
    )

    try:
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT public_code,
                   public_name,
                   dss_camera_code,
                   dss_camera_name,
                   dss_device_code,
                   mediamtx_path
            FROM dss_cameras
            WHERE enabled = 1
              AND dss_camera_code IS NOT NULL
        """)

        return cursor.fetchall()
    finally:
        conn.close()


def path_name(camera):
    if camera.get("mediamtx_path"):
        return camera["mediamtx_path"]

    return "".join(
        c if c.isalnum() or c in "-_" else "_"
        for c in camera["public_code"]
    )


def get_ready_paths():
    result = mtx._request("GET", "/v3/paths/list")

    return {
        p["name"]: p.get("ready", False)
        for p in result.get("items", [])
    }


def get_configured_paths():
    result = mtx.list_paths()

    return {
        p["name"]
        for p in result.get("items", [])
    }


def recover(camera, configured):
    path = path_name(camera)

    channel = {
        "channelCode": camera["dss_camera_code"],
        "channelName": camera["dss_camera_name"],
        "deviceCode": camera["dss_device_code"]
    }

    logging.warning("Memulihkan kamera %s", path)

    result = dss_session.start_live(channel)
    rtsp_url = dssready.find_rtsp(result)

    if not rtsp_url:
        raise RuntimeError("DSS tidak memberikan RTSP URL")

    if path in configured:
        mtx.update_path(path, rtsp_url)
    else:
        mtx.add_path(path, rtsp_url)

    online = mtx.wait_until_online(
        path,
        timeout=20,
        interval=1
    )

    if online:
        logging.info("RECOVERY SUCCESS: %s", path)
        return True

    logging.error("RECOVERY FAILED: %s", path)
    return False


def main():
    logging.info("USSC Camera Monitor started")

    # Login DSS dilakukan saat dibutuhkan.
    # Tidak memulai worker sesi tambahan.
    while True:
        try:
            cameras = get_cameras()
            ready_paths = get_ready_paths()
            configured = get_configured_paths()

            for camera in cameras:
                path = path_name(camera)

                if ready_paths.get(path, False):
                    failures[path] = 0
                    continue

                failures[path] = failures.get(path, 0) + 1

                if failures[path] < FAILURE_THRESHOLD:
                    continue

                now = time.monotonic()

                if now - last_attempt.get(path, -1e12) < RETRY_COOLDOWN:
                    continue

                last_attempt[path] = now

                try:
                    if recover(camera, configured):
                        failures[path] = 0
                        configured.add(path)
                except Exception:
                    logging.exception(
                        "Recovery %s gagal",
                        path
                    )

        except Exception:
            logging.exception("Monitor cycle failed")

        time.sleep(CHECK_INTERVAL)


if __name__ == "__main__":
    main()
