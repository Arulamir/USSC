from flask import Blueprint, jsonify
from backend.database.db import get_connection

chart_bp = Blueprint("chart", __name__)

@chart_bp.route("/api/chart")
def chart():

    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""

        SELECT
            HOUR(waktu) AS jam,
            SUM(total) AS total
        FROM vehicle_data
        GROUP BY HOUR(waktu)
        ORDER BY jam

    """)

    data = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(data)