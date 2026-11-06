"""Public CCTV routing when Nginx sends /api requests to the main backend."""
import re
import requests
from flask import Blueprint, Response, jsonify, request

camera_bp = Blueprint("public_camera_proxy", __name__, url_prefix="/api/cctv")


@camera_bp.route("/<path:path>", methods=["GET", "HEAD", "POST"])
def public_camera_proxy(path):
    parts = path.split("/")
    if path == "public/cameras" and request.method in ("GET", "HEAD"):
        target = "/api/public/cameras"
    elif (len(parts) == 2 and parts[0] == "whep" and request.method == "POST"
          and parts[1] in ("lidah_h264", "ketintang_h264")):
        target = "/api/" + path
    elif (len(parts) == 3 and parts[0] == "hls" and request.method in ("GET", "HEAD")
          and parts[1] in ("lidah_h264", "ketintang_h264")
          and re.fullmatch(r"[a-zA-Z0-9_-]{1,150}\.(?:m3u8|mp4|m4s|ts)", parts[2])):
        target = "/" + path
    else:
        return jsonify(success=False, error="Stream tidak tersedia"), 404
    if request.content_length and request.content_length > 65536:
        return jsonify(success=False, error="Permintaan terlalu besar"), 413
    headers = {key: request.headers[key] for key in ("Content-Type", "Range") if key in request.headers}
    try:
        with requests.Session() as session:
            session.trust_env = False
            response = session.request(request.method, "http://127.0.0.1:5003" + target,
                headers=headers, params=request.args, data=request.get_data(),
                timeout=(2, 25), allow_redirects=False)
            response_headers = {key: value for key, value in response.headers.items()
                                if key.lower() in ("content-type", "content-range", "accept-ranges")}
            response_headers["Cache-Control"] = "no-store"
            return Response(response.content, status=response.status_code, headers=response_headers)
    except requests.RequestException:
        return jsonify(success=False, error="Siaran CCTV belum dapat dihubungi"), 502
