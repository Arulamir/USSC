import subprocess
import time
import yaml
from urllib.parse import quote

CONFIG = "/home/cctvpro/USSC/mediamtx/mediamtx.yml"

def get_password():
    with open(CONFIG, "r") as f:
        config = yaml.safe_load(f)

    for user in config["authInternalUsers"]:
        if user["user"] == "ffmpeg_transcoder":
            return str(user["pass"])

    raise RuntimeError("ffmpeg_transcoder tidak ditemukan")

while True:
    try:
        password = quote(get_password(), safe="")

        source = (
            f"rtsp://ffmpeg_transcoder:{password}"
            "@127.0.0.1:8554/CCTV_GK_1_01_01_01"
        )

        destination = (
            f"rtsp://ffmpeg_transcoder:{password}"
            "@127.0.0.1:8554/ketintang_h264"
        )

        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "warning",
            "-rtsp_transport", "tcp",
            "-i", source,
            "-map", "0:v:0",
            "-an",
            "-vf", "scale=1280:720,fps=15",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-tune", "zerolatency",
            "-pix_fmt", "yuv420p",
            "-profile:v", "baseline",
            "-bf", "0",
            "-g", "30",
            "-b:v", "1200k",
            "-maxrate", "1200k",
            "-bufsize", "2400k",
            "-f", "rtsp",
            "-rtsp_transport", "tcp",
            destination,
        ]

        print("Memulai CCTV Lidah H264...", flush=True)
        result = subprocess.run(command)
        print(f"FFmpeg berhenti: {result.returncode}", flush=True)

    except Exception as e:
        print(f"ERROR: {e}", flush=True)

    time.sleep(5)
