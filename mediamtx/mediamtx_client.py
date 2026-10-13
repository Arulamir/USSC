import os
import requests
import time
from urllib.parse import urlsplit

MEDIAMTX_API = os.getenv(
    "MEDIAMTX_API",
    "http://127.0.0.1:9997"
)

MEDIAMTX_USERNAME = os.getenv(
    "MEDIAMTX_USERNAME",
    "ussc_api"
)

MEDIAMTX_PASSWORD = os.getenv("MEDIAMTX_PASSWORD", "")


class MediaMTXClient:

    def __init__(self):
        self.base_url = MEDIAMTX_API.rstrip("/")

        self.auth = (
            MEDIAMTX_USERNAME,
            MEDIAMTX_PASSWORD
        )

    def _request(self, method, endpoint, **kwargs):

        url = f"{self.base_url}{endpoint}"

        print()
        print("=" * 70)
        print("[MEDIAMTX API]")
        print("METHOD :", method)
        print("URL    :", url)

        if "json" in kwargs:
            print("JSON   :", kwargs["json"])

        try:

            response = requests.request(
                method,
                url,
                auth=self.auth,
                timeout=10,
                **kwargs
            )

            print("STATUS :", response.status_code)
            print("BODY   :", response.text)

            response.raise_for_status()

            if response.text:
                return response.json()

            return None

        except Exception as e:

            print("[MEDIAMTX ERROR]", repr(e))

            raise

    def list_paths(self):

        return self._request(
            "GET",
            "/v3/config/paths/list"
        )

    
    def add_path(self, path_name, source):
        parsed = urlsplit(source)

        print()
        print("=" * 70)
        print("[MEDIAMTX ADD PATH]")
        print("PATH          :", path_name)
        print("RTSP HOST     :", parsed.hostname)
        print("RTSP PORT     :", parsed.port)
        print("RTSP PATH     :", parsed.path)
        print("HAS USERNAME  :", parsed.username is not None)
        print("=" * 70)

        return self._request(
            "POST",
            f"/v3/config/paths/add/{path_name}",
            json={
                "source": source,
                "rtspTransport": "tcp"
            }
        )


    def update_path(self, path_name, source):

        return self._request(
            "PATCH",
            f"/v3/config/paths/patch/{path_name}",
            json={
                "source": source,
                "rtspTransport": "tcp"
            }
        )

    def delete_path(self, path_name):

        return self._request(
            "DELETE",
            f"/v3/config/paths/delete/{path_name}"
        )

    
    def wait_until_online(
        self,
        path_name,
        timeout=15,
        interval=0.5
    ):
        print()
        print("=" * 70)
        print("[MEDIAMTX WAIT FOR ONLINE]")
        print("PATH    :", path_name)
        print("TIMEOUT :", timeout)
        print("=" * 70)

        deadline = time.time() + timeout

        while time.time() < deadline:
            try:
                result = self._request(
                    "GET",
                    f"/v3/paths/get/{path_name}"
                )

                ready = result.get("ready", False)

                print(
                    f"[MEDIAMTX STATUS] "
                    f"path={path_name}, ready={ready}"
                )

                if ready:
                    print(
                        f"[MEDIAMTX READY] {path_name}"
                    )
                    return result

            except requests.HTTPError as e:
                print(
                    f"[MEDIAMTX WAIT] "
                    f"Path belum tersedia: {e}"
                )

            except Exception as e:
                print(
                    f"[MEDIAMTX WAIT ERROR] {repr(e)}"
                )

            time.sleep(interval)

        print(
            f"[MEDIAMTX TIMEOUT] "
            f"Path {path_name} tidak siap dalam "
            f"{timeout} detik"
        )

        return None
