from flask import Blueprint, jsonify
from backend.database.db import get_connection

dashboard_bp = Blueprint("dashboard", __name__)

@dashboard_bp.route("/api/dashboard")
def dashboard():

    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""

        SELECT
            motor,
            mobil,
            bus,
            truck,
            total
        FROM vehicle_data
        ORDER BY id DESC
        LIMIT 1;

    """)

    data = cursor.fetchone()

    cursor.close()
    conn.close()

    return jsonify(data)