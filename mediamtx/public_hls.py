"""Authenticated HTTP playback of the two already-public Digital Twin streams."""

import re
import requests
from flask import Blueprint, Response, request, jsonify

PUBLIC_STREAMS = frozenset(("lidah_h264", "ketintang_h264"))
MAX_MEDIA_BYTES = 8 * 1024 * 1024


def create_public_hls_blueprint(host, username, password, port=8888):
    bp = Blueprint("public_hls", __name__)

    @bp.route("/hls/<stream>/<asset>", methods=["GET", "HEAD"])
    def public_hls(stream, asset):
        if (stream not in PUBLIC_STREAMS or len(asset) > 160
                or not re.fullmatch(r"[a-zA-Z0-9_-]+\.(?:m3u8|mp4|m4s|ts)", asset)):
            return jsonify(success=False, error="Stream tidak tersedia"), 404
        if not password:
            return jsonify(success=False, error="Pemutar CCTV belum dikonfigurasi"), 503
        query = {}
        for key, value in request.args.items():
            valid = ((key == "session" and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value))
                     or (key == "cookieCheck" and value == "1")
                     or (key in ("_HLS_msn", "_HLS_part") and re.fullmatch(r"[0-9]{1,15}", value))
                     or (key == "_HLS_skip" and value in ("YES", "v2")))
            if not valid:
                return jsonify(success=False, error="Parameter stream tidak valid"), 400
            query[key] = value
        # Use MediaMTX's cookieless mode: playlist URLs carry the session query.
        # Do not claim cookie support or create a browser-cookie dependency in
        # this stateless proxy. Viewer auth is still required on every request.
        query["cookieCheck"] = "1"
        headers = {}
        byte_range = request.headers.get("Range")
        if byte_range:
            if not re.fullmatch(r"bytes=[0-9]{0,15}-[0-9]{0,15}", byte_range):
                return jsonify(success=False, error="Rentang tidak valid"), 400
            headers["Range"] = byte_range
        try:
            with requests.Session() as session:
                session.trust_env = False
                with session.request(request.method, f"http://{host}:{port}/{stream}/{asset}",
                        params=query, headers=headers, auth=(username, password),
                        timeout=(3, 18), allow_redirects=False, stream=True) as upstream:
                    if upstream.status_code not in (200, 206, 304):
                        status = 404 if upstream.status_code == 404 else 502
                        return jsonify(success=False, error="Siaran CCTV belum tersedia"), status
                    chunks, length = [], 0
                    if request.method != "HEAD":
                        for chunk in upstream.iter_content(65536):
                            length += len(chunk)
                            if length > MAX_MEDIA_BYTES:
                                return jsonify(success=False, error="Segmen CCTV terlalu besar"), 502
                            chunks.append(chunk)
                    response_headers = {k: v for k, v in upstream.headers.items()
                                        if k.lower() in ("content-type", "content-range", "accept-ranges")}
                    response_headers["Cache-Control"] = "no-store"
                    return Response(b"".join(chunks), status=upstream.status_code, headers=response_headers)
        except requests.RequestException:
            return jsonify(success=False, error="Siaran CCTV belum dapat dihubungi"), 502

    return bp
