import re

from flask import jsonify, request
from werkzeug.security import generate_password_hash


def register_account_routes(app, get_db):
    current_user = app.extensions["ussc_current_user"]

    def get_actor(user_id):
        """Ambil role terbaru langsung dari database."""
        db = None
        cursor = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT id, username, role, is_master_admin, is_active
                FROM users
                WHERE id = ?
                LIMIT 1
                """,
                (user_id,),
            )
            return cursor.fetchone()
        finally:
            if cursor:
                cursor.close()
            if db:
                db.close()

    def authorize_account_manager():
        session_user = current_user()
        if not session_user:
            return None, (jsonify(
                success=False, error="Silakan login terlebih dahulu"
            ), 401)

        actor = get_actor(session_user["id"])
        if not actor or not actor["is_active"]:
            return None, (jsonify(
                success=False, error="Akun tidak aktif atau sesi tidak valid"
            ), 401)

        if actor["role"] not in ("admin", "user"):
            return None, (jsonify(
                success=False, error="Role tidak valid"
            ), 403)

        return actor, None

    @app.get("/api/admin/accounts")
    def list_accounts():
        actor, error = authorize_account_manager()
        if error:
            return error

        # Hanya Master Admin boleh melihat daftar seluruh akun.
        if not actor["is_master_admin"]:
            return jsonify(
                success=False,
                error="Hanya Master Admin yang dapat melihat daftar akun"
            ), 403

        db = None
        cursor = None
        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT id, username, display_name, role,
                       is_master_admin, is_active, created_at
                FROM users
                ORDER BY id DESC
                """
            )
            accounts = cursor.fetchall()

            response = jsonify(success=True, accounts=accounts)
            response.headers["Cache-Control"] = "no-store"
            return response
        except Exception:
            app.logger.exception("Gagal mengambil daftar akun")
            return jsonify(
                success=False, error="Gagal mengambil daftar akun"
            ), 500
        finally:
            if cursor:
                cursor.close()
            if db:
                db.close()

    @app.post("/api/admin/accounts")
    def create_account():
        actor, error = authorize_account_manager()
        if error:
            return error

        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(success=False, error="Body JSON tidak valid"), 400

        username = data.get("username")
        display_name = data.get("display_name")
        password = data.get("password")
        role = data.get("role", "user")

        if not all(isinstance(value, str) for value in (
            username, display_name, password, role
        )):
            return jsonify(
                success=False, error="Semua input wajib berupa teks"
            ), 400

        username = username.strip().lower()
        display_name = display_name.strip()

        if (
            len(username) > 100
            or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", username)
        ):
            return jsonify(
                success=False, error="Gunakan alamat email yang valid"
            ), 400

        if not display_name or len(display_name) > 150:
            return jsonify(
                success=False, error="Nama wajib diisi, maksimal 150 karakter"
            ), 400

        if len(password) < 12 or len(password) > 1024:
            return jsonify(
                success=False,
                error="Password harus terdiri dari 12–1024 karakter"
            ), 400

        if role not in ("admin", "user"):
            return jsonify(
                success=False, error="Role hanya boleh admin atau user"
            ), 400

        # Admin biasa tidak boleh membuat akun admin.
        if role == "admin" and not actor["is_master_admin"]:
            return jsonify(
                success=False,
                error="Hanya Master Admin yang dapat membuat akun admin"
            ), 403

        db = None
        cursor = None
        try:
            db = get_db()
            cursor = db.cursor()

            # Pertahanan tambahan: akun master tidak dibuat melalui endpoint ini.
            cursor.execute(
                "SELECT COUNT(*) FROM users WHERE is_master_admin = 1"
            )
            master_count = cursor.fetchone()[0]
            if master_count < 1:
                db.rollback()
                return jsonify(
                    success=False,
                    error="Master Admin belum dikonfigurasi"
                ), 500

            cursor.execute(
                """
                INSERT INTO users
                    (username, display_name, password_hash, role,
                     is_active, is_master_admin)
                VALUES (?, ?, ?, ?, 1, 0)
                """,
                (
                    username,
                    display_name,
                    generate_password_hash(password),
                    role,
                ),
            )
            new_id = cursor.lastrowid
            db.commit()

            response = jsonify(
                success=True,
                message="Akun berhasil dibuat",
                account={
                    "id": new_id,
                    "username": username,
                    "display_name": display_name,
                    "role": role,
                    "is_active": 1,
                },
            )
            response.status_code = 201
            response.headers["Cache-Control"] = "no-store"
            return response

        except Exception as exc:
            if db:
                db.rollback()

            # MariaDB duplicate-key error.
            if getattr(exc, "errno", None) == 1062:
                return jsonify(
                    success=False, error="Email tersebut sudah terdaftar"
                ), 409

            app.logger.exception("Gagal membuat akun")
            return jsonify(
                success=False, error="Terjadi kesalahan server"
            ), 500
        finally:
            if cursor:
                cursor.close()
            if db:
                db.close()
