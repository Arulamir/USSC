import threading
import time
import atexit
import signal

import config
import dssready


class DSSSession:
    """
    Persistent DSS session.

    Fungsi:
    - Login DSS sekali
    - Menyimpan token
    - Dipakai bersama oleh semua request
    - Auto relogin jika token invalid/expired
    - Background thread menjaga session
    - Logout saat aplikasi shutdown
    """

    def __init__(self):
        self.token = None

        self.lock = threading.RLock()

        self.running = False
        self.thread = None

        self.last_login = 0
        self.last_error = None

        # Cek session setiap 60 detik
        self.keepalive_interval = 60

        # Maksimal retry login
        self.max_login_retry = 3

    # ==========================================================
    # LOGIN
    # ==========================================================

    def login(self):
        """
        Login ke DSS.

        Hanya boleh ada satu login yang aktif.
        """

        with self.lock:

            # Kalau masih punya token, jangan login lagi
            if self.token:
                return self.token

            print()
            print("=" * 70)
            print("[DSS SESSION] LOGIN")
            print("=" * 70)

            for attempt in range(1, self.max_login_retry + 1):

                try:

                    print(
                        f"[DSS SESSION] Login attempt "
                        f"{attempt}/{self.max_login_retry}"
                    )

                    token = dssready.login()

                    if token:

                        self.token = token
                        self.last_login = time.time()
                        self.last_error = None

                        print("[DSS SESSION] LOGIN SUCCESS")
                        print("[DSS SESSION] Persistent token aktif")

                        return self.token

                    print("[DSS SESSION] Login gagal: token kosong")

                except Exception as e:

                    self.last_error = str(e)

                    print(
                        f"[DSS SESSION] Login error: "
                        f"{type(e).__name__}: {e}"
                    )

                if attempt < self.max_login_retry:

                    time.sleep(3)

            print("[DSS SESSION] LOGIN FAILED")

            return None

    # ==========================================================
    # GET TOKEN
    # ==========================================================

    def get_token(self):
        """
        Mengambil token aktif.

        Jika belum login:
            otomatis login.

        Ini fungsi utama yang dipakai app.py.
        """

        with self.lock:

            if self.token:
                return self.token

            return self.login()

    # ==========================================================
    # FORCE RELOGIN
    # ==========================================================

    def relogin(self):
        """
        Paksa logout token lama kemudian login ulang.
        """

        with self.lock:

            print()
            print("[DSS SESSION] FORCE RELOGIN")

            old_token = self.token

            self.token = None

            if old_token:

                try:

                    dssready.logout(old_token)

                    print(
                        "[DSS SESSION] Old token logout"
                    )

                except Exception as e:

                    print(
                        "[DSS SESSION] Old logout error:",
                        e
                    )

            return self.login()

    # ==========================================================
    # START LIVE
    # ==========================================================

    def start_live(self, channel):
        """
        Start video menggunakan persistent DSS token.

        Kalau token ditolak DSS:
            1. relogin
            2. retry StartVideo
        """

        with self.lock:

            token = self.get_token()

            if not token:

                raise RuntimeError(
                    "DSS session tidak tersedia"
                )

            try:

                print(
                    f"[DSS SESSION] StartLive "
                    f"{channel.get('channelName')}"
                )

                result = dssready.start_live(
                    token,
                    channel
                )

                # Kalau DSS mengembalikan result,
                # berarti request berhasil.
                if result:

                    return result

                print(
                    "[DSS SESSION] StartLive gagal, "
                    "mencoba relogin..."
                )

            except Exception as e:

                print(
                    "[DSS SESSION] StartLive error:",
                    type(e).__name__,
                    e
                )

            # Token kemungkinan expired
            token = self.relogin()

            if not token:

                raise RuntimeError(
                    "DSS relogin gagal"
                )

            print(
                "[DSS SESSION] Retry StartLive "
                "setelah relogin"
            )

            result = dssready.start_live(
                token,
                channel
            )

            if not result:

                raise RuntimeError(
                    "StartLive tetap gagal setelah relogin"
                )

            return result

    # ==========================================================
    # BACKGROUND SESSION
    # ==========================================================

    def _background_worker(self):

        print(
            "[DSS SESSION] Background worker started"
        )

        while self.running:

            try:

                with self.lock:

                    if not self.token:

                        print(
                            "[DSS SESSION] "
                            "Token tidak tersedia"
                        )

                        self.login()

                    else:

                        # Untuk saat ini kita tidak melakukan
                        # API request khusus sebagai keepalive.
                        #
                        # Kita hanya memastikan token masih
                        # tersimpan.
                        #
                        # Jika token ternyata invalid,
                        # start_live() akan melakukan relogin.
                        pass

            except Exception as e:

                self.last_error = str(e)

                print(
                    "[DSS SESSION] Background error:",
                    type(e).__name__,
                    e
                )

            # Tunggu sebelum pemeriksaan berikutnya
            for _ in range(self.keepalive_interval):

                if not self.running:
                    break

                time.sleep(1)

        print(
            "[DSS SESSION] Background worker stopped"
        )

    # ==========================================================
    # START BACKGROUND
    # ==========================================================

    def start(self):

        with self.lock:

            if self.running:

                print(
                    "[DSS SESSION] "
                    "Background sudah berjalan"
                )

                return

            self.running = True

            print()
            print("=" * 70)
            print("[DSS SESSION] START")
            print("=" * 70)

            # Login awal
            token = self.login()

            if not token:

                print(
                    "[DSS SESSION] "
                    "Initial login gagal"
                )

            self.thread = threading.Thread(
                target=self._background_worker,
                name="DSS-Session-Worker",
                daemon=True
            )

            self.thread.start()

    # ==========================================================
    # STOP
    # ==========================================================

    def stop(self):

        with self.lock:

            if not self.running and not self.token:

                return

            print()
            print("=" * 70)
            print("[DSS SESSION] STOP")
            print("=" * 70)

            self.running = False

            token = self.token

            self.token = None

            if token:

                try:

                    dssready.logout(token)

                    print(
                        "[DSS SESSION] "
                        "DSS logout berhasil"
                    )

                except Exception as e:

                    print(
                        "[DSS SESSION] "
                        "Logout error:",
                        e
                    )

            self.last_login = 0

            print(
                "[DSS SESSION] Session stopped"
            )

    # ==========================================================
    # STATUS
    # ==========================================================

    def status(self):

        with self.lock:

            return {
                "connected": self.token is not None,
                "running": self.running,
                "last_login": self.last_login,
                "last_error": self.last_error,
            }


# ==============================================================
# GLOBAL DSS SESSION
# ==============================================================

dss_session = DSSSession()


# ==============================================================
# CLEANUP
# ==============================================================

def cleanup():

    try:

        dss_session.stop()

    except Exception as e:

        print(
            "[DSS SESSION] Cleanup error:",
            e
        )


atexit.register(cleanup)


def signal_handler(signum, frame):

    print(
        f"\n[DSS SESSION] Signal received: {signum}"
    )

    cleanup()


    # Jangan memanggil sys.exit() di sini dulu.
    # atexit akan menangani cleanup.


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)