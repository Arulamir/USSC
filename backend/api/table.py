from flask import Blueprint, jsonify
from backend.database.db import get_connection

table_bp = Blueprint("table", __name__)

@table_bp.route("/api/table")
def table():

    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""

        SELECT *
        FROM vehicle_data
        ORDER BY waktu DESC
        LIMIT 20

    """)

    data = cursor.fetchall()

    cursor.close()
    conn.close()

    return jsonify(data)