
import mariadb
import config

MASTER_USERNAME = "ussccctv1@gmail.com"


def main():
    db = None
    cursor = None

    try:
        db = mariadb.connect(
            host=config.DB_HOST,
            port=config.DB_PORT,
            user=config.DB_USER,
            password=config.DB_PASSWORD,
            database=config.DB_NAME,
        )
        cursor = db.cursor()

        # Pastikan akun master yang dimaksud memang ada.
        cursor.execute(
            "SELECT id, role FROM users WHERE username = ? LIMIT 1",
            (MASTER_USERNAME,),
        )
        account = cursor.fetchone()

        if not account:
            raise RuntimeError(
                "Akun master tidak ditemukan. Tidak ada perubahan yang disimpan."
            )

        if account[1] != "admin":
            raise RuntimeError(
                "Akun tersebut bukan admin. Migrasi dibatalkan."
            )

        # Periksa apakah kolom sudah tersedia.
        cursor.execute(
            """
            SELECT COUNT(*)
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'users'
              AND COLUMN_NAME = 'is_master_admin'
            """
        )
        column_exists = cursor.fetchone()[0] > 0

        if not column_exists:
            cursor.execute(
                """
                ALTER TABLE users
                ADD COLUMN is_master_admin TINYINT(1)
                NOT NULL DEFAULT 0
                """
            )

        # Hanya akun yang ditetapkan di atas yang dijadikan master.
        cursor.execute(
            """
            UPDATE users
            SET is_master_admin = 1
            WHERE username = ? AND role = 'admin'
            """,
            (MASTER_USERNAME,),
        )

        db.commit()

        cursor.execute(
            """
            SELECT username, role, is_master_admin, is_active
            FROM users
            WHERE username = ?
            """,
            (MASTER_USERNAME,),
        )

        print("Pemeriksaan master admin:")
        print(cursor.fetchone())
        print("Migrasi berhasil.")

    except Exception as exc:
        if db:
            db.rollback()
        print("Migrasi gagal:", type(exc).__name__, str(exc))

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


if __name__ == "__main__":
    main()