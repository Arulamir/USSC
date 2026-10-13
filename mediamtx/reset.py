
import getpass
import mariadb
import config
from werkzeug.security import generate_password_hash


def main():
    username = input("Username akun yang direset: ").strip()

    if not username:
        print("Username wajib diisi.")
        return

    password = getpass.getpass("Password baru: ")
    confirm = getpass.getpass("Ulangi password baru: ")

    if len(password) < 12:
        print("Password minimal 12 karakter.")
        return

    if password != confirm:
        print("Password tidak sama.")
        return

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

        cursor.execute(
            "SELECT id FROM users WHERE username = ? LIMIT 1",
            (username,),
        )
        user = cursor.fetchone()

        if not user:
            print("Akun tidak ditemukan.")
            return

        cursor.execute(
            """
            UPDATE users
            SET password_hash = ?
            WHERE id = ?
            """,
            (generate_password_hash(password), user[0]),
        )

        db.commit()
        print("Password berhasil diubah.")
        print("Username:", username)

    except mariadb.Error:
        if db:
            db.rollback()
        print("Gagal mengubah password. Periksa koneksi database.")

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


if __name__ == "__main__":
    main()