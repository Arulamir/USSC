
import getpass
import mariadb
import config
from werkzeug.security import generate_password_hash


def main():
    username = input("Username master admin: ").strip()
    display_name = input("Nama tampilan: ").strip()

    if not username or len(username) > 100:
        print("Username wajib diisi dan maksimal 100 karakter.")
        return

    if not display_name or len(display_name) > 150:
        print("Nama tampilan wajib diisi dan maksimal 150 karakter.")
        return

    password = getpass.getpass("Password baru: ")
    confirm = getpass.getpass("Ulangi password: ")

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

        # Hanya izinkan membuat master admin pertama.
        cursor.execute(
            "SELECT COUNT(*) FROM users WHERE role = ?",
            ("admin",),
        )
        admin_count = cursor.fetchone()[0]

        if admin_count > 0:
            print(
                "Pembuatan ditolak: akun admin sudah ada. "
                "Gunakan prosedur pengelolaan akun admin."
            )
            return

        # Hindari username duplikat.
        cursor.execute(
            "SELECT id FROM users WHERE username = ? LIMIT 1",
            (username,),
        )
        if cursor.fetchone():
            print("Username sudah digunakan.")
            return

        password_hash = generate_password_hash(password)

        cursor.execute(
            """
            INSERT INTO users
                (username, display_name, password_hash, role, is_active)
            VALUES (?, ?, ?, 'admin', 1)
            """,
            (username, display_name, password_hash),
        )

        db.commit()
        print("Master admin berhasil dibuat.")
        print("Username:", username)
        print("Role: admin")

    except mariadb.Error:
        if db:
            db.rollback()
        print("Gagal membuat admin. Periksa koneksi database dan log server.")

    finally:
        if cursor:
            cursor.close()
        if db:
            db.close()


if __name__ == "__main__":
    main()