from flask import Blueprint, request, jsonify
from datetime import datetime

digital_twin_bp = Blueprint(
    "digital_twin",
    __name__,
    url_prefix="/api"
)

# Menyimpan kondisi kendaraan TERBARU saja
latest_data = {}


@digital_twin_bp.route("/digital-twin", methods=["POST"])
def receive_digital_twin():

    global latest_data

    data = request.get_json()

    if not data:
        return jsonify({
            "status": "error",
            "message": "Data JSON tidak ditemukan"
        }), 400

    camera_id = data.get("camera_id")
    vehicles = data.get("vehicles", [])
    timestamp = data.get("timestamp")

    if not camera_id:
        return jsonify({
            "status": "error",
            "message": "camera_id wajib diisi"
        }), 400

    latest_data[camera_id] = {
        "camera_id": camera_id,
        "timestamp": timestamp,
        "vehicles": vehicles,
        "received_at": datetime.now().isoformat()
    }

    print(
        f"[DIGITAL TWIN] "
        f"Camera={camera_id} "
        f"Vehicles={len(vehicles)}"
    )

    return jsonify({
        "status": "success",
        "camera_id": camera_id,
        "vehicles": len(vehicles)
    }), 200


@digital_twin_bp.route("/digital-twin", methods=["GET"])
def get_digital_twin():

    return jsonify({
        "status": "success",
        "data": latest_data
    }), 200