from database.db import get_connection
from emisi.service import proses_emisi


def proses_semua_dummy():

    conn = get_connection()
    cursor = conn.cursor(dictionary=True)

    cursor.execute("""
        SELECT id
        FROM vehicle_data
        WHERE camera_id = 'DUMMY'
        ORDER BY id ASC
    """)

    rows = cursor.fetchall()

    cursor.close()
    conn.close()

    print(f"Jumlah data dummy: {len(rows)}")

    for row in rows:

        print(f"\nMemproses vehicle ID: {row['id']}")

        proses_emisi(row["id"])


if __name__ == "__main__":
    proses_semua_dummy()