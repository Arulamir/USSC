import hashlib
import os
import secrets
from datetime import datetime, timedelta

from flask import jsonify, request
from werkzeug.security import check_password_hash


SESSION_COOKIE = "ussc_session"
SESSION_HOURS = 8

# Untuk pengujian lokal HTTP gunakan 0.
# Wajib ubah menjadi 1 ketika menggunakan HTTPS produksi.
COOKIE_SECURE = os.getenv("USSC_COOKIE_SECURE", "0") == "1"


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def register_auth_routes(app, get_db):

    def current_user():
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return None

        db = None
        cursor = None

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("""
                SELECT
                    u.id,
                    u.username,
                    u.display_name,
                    u.role,
                    u.is_master_admin
                FROM user_sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ?
                  AND s.revoked_at IS NULL
                  AND s.expires_at > UTC_TIMESTAMP()
                  AND u.is_active = 1
                LIMIT 1
            """, (hash_token(token),))

            return cursor.fetchone()
        except Exception:
            app.logger.exception("Gagal memvalidasi sesi")
            return None
        finally:
            if cursor:
                cursor.close()
            if db:
                db.close()

    # Fungsi ini akan digunakan pada tahap berikutnya
    # untuk mengamankan route kamera dan stream.
    app.extensions["ussc_current_user"] = current_user

    @app.post("/api/auth/login")
    def auth_login():
        data = request.get_json(silent=True) or {}
        username = data.get("username", "")
        password = data.get("password", "")

        if not isinstance(username, str) or not isinstance(password, str):
            return jsonify(success=False, error="Input tidak valid"), 400

        username = username.strip()
        if not username or not password or len(username) > 100 or len(password) > 1024:
            return jsonify(success=False, error="Username atau password tidak valid"), 400

        db = None
        cursor = None

        try:
            db = get_db()
            cursor = db.cursor(dictionary=True)
            cursor.execute("""
                SELECT id, username, display_name, role,
                       password_hash, is_active, is_master_admin
                FROM users
                WHERE username = ?
                LIMIT 1
            """, (username,))
            user = cursor.fetchone()

            # Pesan generik agar tidak membocorkan keberadaan akun.
            if (
                not user
                or not user["is_active"]
                or not check_password_hash(user["password_hash"], password)
            ):
                return jsonify(
                    success=False,
                    error="Username atau password salah"
                ), 401

            raw_token = secrets.token_urlsafe(32)
            token_hash = hash_token(raw_token)
            expires_at = datetime.utcnow() + timedelta(hours=SESSION_HOURS)

            cursor.execute("""
                INSERT INTO user_sessions
                    (user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, UTC_TIMESTAMP())
            """, (user["id"], token_hash, expires_at))
            db.commit()

            response = jsonify(
                success=True,
                user={
                    "id": user["id"],
                    "username": user["username"],
                    "display_name": user["display_name"],
                    "role": user["role"],
                    "is_master_admin": bool(user["is_master_admin"]),
                }
            )
            response.set_cookie(
                SESSION_COOKIE,
                raw_token,
                max_age=SESSION_HOURS * 60 * 60,
                httponly=True,
                secure=COOKIE_SECURE,
                samesite="Lax",
                path="/",
            )
            response.headers["Cache-Control"] = "no-store"
            return response

        except Exception:
            if db:
                db.rollback()
            app.logger.exception("Login gagal karena kesalahan server")
            return jsonify(success=False, error="Terjadi kesalahan server"), 500
        finally:
            if cursor:
                cursor.close()
            if db:
                db.close()

    @app.get("/api/auth/me")
    def auth_me():
        user = current_user()
        if not user:
            response = jsonify(success=False, error="Belum login")
            response.status_code = 401
        else:
            response = jsonify(success=True, user=user)

        response.headers["Cache-Control"] = "no-store"
        return response

    @app.post("/api/auth/logout")
    def auth_logout():
        token = request.cookies.get(SESSION_COOKIE)

        if token:
            db = None
            cursor = None
            try:
                db = get_db()
                cursor = db.cursor()
                cursor.execute("""
                    UPDATE user_sessions
                    SET revoked_at = UTC_TIMESTAMP()
                    WHERE token_hash = ?
                      AND revoked_at IS NULL
                """, (hash_token(token),))
                db.commit()
            except Exception:
                if db:
                    db.rollback()
                app.logger.exception("Gagal mencabut sesi")
                return jsonify(
                    success=False,
                    error="Logout gagal; coba lagi"
                ), 500
            finally:
                if cursor:
                    cursor.close()
                if db:
                    db.close()

        response = jsonify(success=True)
        response.delete_cookie(
            SESSION_COOKIE,
            path="/",
            secure=COOKIE_SECURE,
            httponly=True,
            samesite="Lax",
        )
        response.headers["Cache-Control"] = "no-store"
        return response
