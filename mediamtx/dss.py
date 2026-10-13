import hashlib
import json
import requests
import config
import mariadb
requests.packages.urllib3.disable_warnings()

BASE = config.DSS_HOST
USERNAME = config.DSS_USERNAME
PASSWORD = config.DSS_PASSWORD

STREAM_TYPE = config.STREAM_TYPE
TIMEOUT = config.REQUEST_TIMEOUT


# ============================================================
# MD5
# ============================================================

def md5(text):
    return hashlib.md5(
        text.encode("utf-8")
    ).hexdigest()


# ============================================================
# LOGIN DSS
# ============================================================

def login():

    url = BASE + "/brms/api/v1.0/accounts/authorize"

    print()
    print("=" * 70)
    print("[1] REQUEST CHALLENGE DSS")
    print("=" * 70)

    payload = {
        "userName": USERNAME,
        "ipAddress": "",
        "clientType": "WINPC_V2"
    }

    try:

        response = requests.post(
            url,
            json=payload,
            verify=False,
            timeout=TIMEOUT
        )

    except requests.RequestException as e:

        print("Koneksi ke DSS gagal:")
        print(e)

        return None


    print("HTTP:", response.status_code)


    if response.status_code != 401:

        print()
        print("Response:")
        print(response.text)

        return None


    try:

        challenge = response.json()

    except ValueError:

        print("Response challenge bukan JSON.")

        return None


    realm = challenge.get("realm")
    random_key = challenge.get("randomKey")
    encrypt_type = challenge.get("encryptType")


    if not realm or not random_key or not encrypt_type:

        print()
        print("Data challenge tidak lengkap.")

        print(
            json.dumps(
                challenge,
                indent=2
            )
        )

        return None


    print("Realm     :", realm)
    print("RandomKey :", random_key)
    print("Encrypt   :", encrypt_type)


    # ========================================================
    # SIGNATURE DSS
    # ========================================================

    temp1 = md5(PASSWORD)
    temp2 = md5(USERNAME + temp1)
    temp3 = md5(temp2)

    temp4 = md5(
        USERNAME
        + ":"
        + realm
        + ":"
        + temp3
    )

    signature = md5(
        temp4
        + ":"
        + random_key
    )


    # ========================================================
    # LOGIN
    # ========================================================

    print()
    print("=" * 70)
    print("[2] LOGIN DSS")
    print("=" * 70)


    payload = {

        "mac": "",

        "signature": signature,

        "userName": USERNAME,

        "randomKey": random_key,

        "publicKey": "",

        "encryptType": encrypt_type,

        "ipAddress": "",

        "clientType": "WINPC_V2",

        "userType": "0"
    }


    try:

        response = requests.post(
            url,
            json=payload,
            verify=False,
            timeout=TIMEOUT
        )

    except requests.RequestException as e:

        print("Login DSS gagal:")
        print(e)

        return None


    print("HTTP:", response.status_code)


    try:

        result = response.json()

    except ValueError:

        print()
        print("Response login bukan JSON.")

        print(response.text)

        return None


    # ========================================================
    # ERROR LOGIN
    # ========================================================

    code = result.get("code")
    desc = result.get("desc")


    if code == 2001:

        print()
        print("=" * 70)
        print("LOGIN GAGAL")
        print("=" * 70)

        print("Code :", code)
        print("Desc :", desc)

        data = result.get("data")

        if isinstance(data, dict):

            if "unlockRemainTimes" in data:

                print(
                    "Sisa percobaan:",
                    data["unlockRemainTimes"]
                )

        return None


    if code == 2004:

        print()
        print("=" * 70)
        print("USER MASIH LOGIN DI DSS")
        print("=" * 70)

        print("Code :", code)
        print("Desc :", desc)

        print()
        print(
            "Logout terlebih dahulu dari DSS "
            "atau tunggu session sebelumnya berakhir."
        )

        return None


    # ========================================================
    # TOKEN
    # ========================================================

    token = result.get("token")


    if not token:

        print()
        print("=" * 70)
        print("TOKEN TIDAK DITEMUKAN")
        print("=" * 70)

        print(
            json.dumps(
                result,
                indent=2
            )
        )

        return None


    print()
    print("=" * 70)
    print("LOGIN BERHASIL")
    print("=" * 70)

    print("User ID :", result.get("userId"))
    print("Duration:", result.get("duration"))
    print("Token   : BERHASIL")


    return token


# ============================================================
# DEVICE TREE
# ============================================================

def get_device_tree(token):

    url = BASE + "/brms/api/v1.0/tree/devices"


    headers = {

        "X-Subject-Token": token,

        "Content-Type":
        "application/json"
    }


    payload = {

        "deviceCodes": [],

        "categories": [],

        "containVirtualDevice": "0",

        "sourceTypes": []
    }


    print()
    print("=" * 70)
    print("[3] MENGAMBIL DEVICE TREE")
    print("=" * 70)


    try:

        response = requests.post(
            url,
            headers=headers,
            json=payload,
            verify=False,
            timeout=TIMEOUT
        )

    except requests.RequestException as e:

        print("Device Tree gagal:")
        print(e)

        return None


    print("HTTP:", response.status_code)


    if response.status_code != 200:

        print()
        print(response.text)

        return None


    try:

        result = response.json()

    except ValueError:

        print("Response bukan JSON.")

        return None


    code = result.get("code")
    desc = result.get("desc")


    print("Code:", code)
    print("Desc:", desc)


    if code != 1000:

        print()
        print("DSS menolak Device Tree.")

        print(
            json.dumps(
                result,
                indent=2,
                ensure_ascii=False
            )
        )

        return None


    data = result.get("data")


    if not data:

        print()
        print("Device Tree kosong.")

        return None


    # Simpan untuk debugging
    try:

        with open(
            "device_tree.json",
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                data,
                f,
                indent=2,
                ensure_ascii=False
            )

        print()
        print(
            "Device Tree disimpan ke "
            "device_tree.json"
        )

    except Exception as e:

        print(
            "Gagal menyimpan Device Tree:",
            e
        )


    return data


# ============================================================
# AMBIL SEMUA CHANNEL
# ============================================================

def get_all_channels(data):

    channels = []


    if not isinstance(data, dict):

        return channels


    devices = data.get("devices", [])


    for device in devices:

        device_code = device.get(
            "code",
            ""
        )

        device_name = device.get(
            "name",
            ""
        )

        device_status = device.get(
            "status",
            ""
        )


        units = device.get(
            "units",
            []
        )


        for unit in units:

            unit_seq = unit.get(
                "unitSeq",
                ""
            )


            unit_channels = unit.get(
                "channels",
                []
            )


            for channel in unit_channels:

                channel_code = channel.get(
                    "channelCode"
                )

                channel_name = channel.get(
                    "channelName",
                    ""
                )

                channel_status = channel.get(
                    "status",
                    ""
                )

                channel_seq = channel.get(
                    "channelSeq",
                    ""
                )


                if not channel_code:

                    continue


                channels.append({

                    "deviceCode":
                        device_code,

                    "deviceName":
                        device_name,

                    "deviceStatus":
                        device_status,

                    "unitSeq":
                        unit_seq,

                    "channelCode":
                        channel_code,

                    "channelName":
                        channel_name,

                    "channelStatus":
                        channel_status,

                    "channelSeq":
                        channel_seq
                })


    return channels


# ============================================================
# SYNC CCTV KE DATABASE
# ============================================================

def sync_cameras_to_database(channels):

    print()
    print("=" * 70)
    print("[4] SYNC CCTV KE DATABASE")
    print("=" * 70)

    if not channels:

        print()
        print("Tidak ada CCTV untuk disinkronkan.")

        return False

    try:
        db = mariadb.connect(
            host=config.DB_HOST,
            port=config.DB_PORT,
            user=config.DB_USER,
            password=config.DB_PASSWORD,
            database=config.DB_NAME
        )
        cursor = db.cursor()
    except mariadb.Error as e:

        print()
        print("Koneksi database gagal:")
        print(e)

        return False

    try:

        query = """
            INSERT INTO dss_cameras (
                public_code,
                dss_camera_code,
                dss_camera_name,
                dss_device_code,
                status,
                enabled
            )
            VALUES (
                %s,
                %s,
                %s,
                %s,
                %s,
                1
            )
            ON DUPLICATE KEY UPDATE
                dss_camera_name =
                    VALUES(dss_camera_name),
                dss_device_code =
                    VALUES(dss_device_code),
                status =
                    VALUES(status),
                updated_at =
                    CURRENT_TIMESTAMP
        """

        total = 0

        for channel in channels:

            public_code = channel["channelName"]

            dss_camera_code = channel["channelCode"]

            dss_camera_name = channel["channelName"]

            dss_device_code = channel["deviceCode"]

            # DSS:
            # 1 = ONLINE
            # selain 1 = OFFLINE

            if channel["channelStatus"] == "1":

                status = "ONLINE"

            else:

                status = "OFFLINE"

            cursor.execute(
                query,
                (
                    public_code,
                    dss_camera_code,
                    dss_camera_name,
                    dss_device_code,
                    status
                )
            )

            total += 1

            print(
                f"[OK] {public_code}"
                f" → {status}"
            )

        db.commit()
        print()
        print("-" * 70)
        print(f"Total CCTV : {total}")
        print("Database   : UPDATED")
        print("-" * 70)
        return True
    except mariadb.Error as e:

        db.rollback()

        print()
        print("Gagal sinkronisasi database:")
        print(e)

        return False

    finally:

        cursor.close()
        db.close()

# ============================================================
# TAMPILKAN CHANNEL
# ============================================================

def show_channels(channels):
    print()
    print("=" * 70)
    print("DAFTAR CCTV")
    print("=" * 70)


    if not channels:

        print()
        print("Tidak ada channel CCTV.")

        return


    for index, channel in enumerate(channels):

        status = channel["channelStatus"]

        if status == "1":
            status_text = "ONLINE"
        else:
            status_text = "OFFLINE"


        print()
        print(
            f"[{index}] "
            f"{channel['channelName']}"
        )

        print(
            f"     Device : "
            f"{channel['deviceName']}"
        )

        print(
            f"     Code   : "
            f"{channel['channelCode']}"
        )

        print(
            f"     Status : "
            f"{status_text}"
        )


    print()
    print("=" * 70)


# ============================================================
# PILIH CHANNEL
# ============================================================

def select_channels(channels):
    """
    Memilih satu atau beberapa kamera dari daftar channel DSS.
    Contoh input:
        1
        1,2,3
        1,4,7,10
    """

    print()
    print("=" * 70)
    print("PILIH KAMERA")
    print("=" * 70)

    for i, channel in enumerate(channels, start=1):
        print(
            f"{i:2d}. "
            f"{channel.get('channelName')} "
            f"[{channel.get('channelCode')}]"
        )

    print()
    print("Contoh:")
    print("  1        = satu kamera")
    print("  1,2,3    = tiga kamera")
    print("  1,4,7,10 = empat kamera")
    print()

    while True:
        choice = input("Pilih nomor kamera: ").strip()

        try:
            indexes = [
                int(x.strip()) - 1
                for x in choice.split(",")
                if x.strip()
            ]

            if not indexes:
                print("[ERROR] Tidak ada kamera yang dipilih.")
                continue

            if any(i < 0 or i >= len(channels) for i in indexes):
                print("[ERROR] Nomor kamera tidak valid.")
                continue

            # Hilangkan nomor yang sama
            indexes = list(dict.fromkeys(indexes))

            selected_channels = [
                channels[i]
                for i in indexes
            ]

            print()
            print("Kamera yang dipilih:")

            for channel in selected_channels:
                print(
                    f"  - {channel.get('channelName')} "
                    f"[{channel.get('channelCode')}]"
                )

            return selected_channels

        except ValueError:
            print("[ERROR] Masukkan nomor seperti: 1,2,3")


# ============================================================
# START VIDEO
# ============================================================

def start_live(token, channel):

    url = (
        BASE
        + "/brms/api/v1.0/"
        + "MTS/Video/StartVideo"
    )


    channel_code = channel[
        "channelCode"
    ]


    headers = {

        "X-Subject-Token": token,

        "Content-Type":
        "application/json"
    }


    payload = {

        "data": {

            "streamType":
                STREAM_TYPE,

            "trackId":
                "",

            "channelId":
                channel_code,

            "keyCode":
                "",

            "dataType":
                "2",

            "enableRtsps":
                "0",

            "enableMulticast":
                "0",

            "fakeSdp":
                "0"
        }
    }


    print()
    print("=" * 70)
    print("[4] START LIVE VIDEO")
    print("=" * 70)


    print()
    print("Channel ID:")
    print(channel_code)


    print()
    print("Request:")

    print(
        json.dumps(
            payload,
            indent=2
        )
    )


    try:

        response = requests.post(
            url,
            headers=headers,
            json=payload,
            verify=False,
            timeout=TIMEOUT
        )

    except requests.RequestException as e:

        print()
        print("StartVideo gagal:")
        print(e)

        return None


    print()
    print("HTTP:", response.status_code)


    print()
    print("Response:")

    print(response.text)


    if response.status_code != 200:

        return None


    try:

        result = response.json()

    except ValueError:

        print()
        print(
            "Response StartVideo "
            "bukan JSON."
        )

        return None


    return result


# ============================================================
# CARI RTSP URL
# ============================================================

# ============================================================
# CARI RTSP URL DSS
# ============================================================

def find_rtsp(obj):

    if not isinstance(obj, dict):
        return None

    data = obj.get("data")

    if not isinstance(data, dict):
        return None

    raw_url = data.get("url")

    if not isinstance(raw_url, str):
        return None

    # DSS mengembalikan:
    #
    # rtsp://IP-INTERNAL/...|rtsp://IP-PUBLIC/...
    #
    urls = [
        u.strip()
        for u in raw_url.split("|")
        if u.strip()
    ]

    print()
    print("=" * 70)
    print("RTSP URL DARI DSS")
    print("=" * 70)

    for i, url in enumerate(urls, 1):

        print()
        print(f"URL {i}:")
        print(url)

    # ========================================================
    # PILIH URL PUBLIC
    # ========================================================

    public_url = None

    for url in urls:

        if "103.242.125.125" in url:
            public_url = url
            break

    # Kalau URL public tidak ditemukan,
    # gunakan URL pertama
    if public_url is None and urls:
        public_url = urls[0]

    if public_url is None:
        return None

    # ========================================================
    # AMBIL TOKEN/SESSION DARI STARTVIDEO
    # ========================================================

    session = data.get("session")
    stream_token = data.get("token")

    print()
    print("=" * 70)
    print("SESSION STREAM")
    print("=" * 70)

    print("Session : tersedia" if session else "Session : tidak ada")
    print("Token   : tersedia" if stream_token else "Token   : tidak ada")

    # ========================================================
    # TAMBAHKAN TOKEN KE RTSP
    # ========================================================

    if stream_token:

        separator = "&" if "?" in public_url else "?"

        public_url = (
            public_url
            + separator
            + "token="
            + str(stream_token)
        )

    return public_url


# ============================================================
# CARI MEDIA SERVER
# ============================================================

def find_media_info(obj):

    if isinstance(obj, dict):

        ip = None
        port = None


        for key in [

            "ip",
            "serverIp",
            "serverIP",

            "mediaIp",
            "mediaIP",

            "host"
        ]:

            value = obj.get(key)


            if value:

                ip = value

                break


        for key in [

            "port",
            "serverPort",

            "mediaPort"
        ]:

            value = obj.get(key)


            if value:

                port = value

                break


        if ip and port:

            return ip, port


        for value in obj.values():

            result = find_media_info(value)


            if result:

                return result


    elif isinstance(obj, list):

        for item in obj:

            result = find_media_info(item)


            if result:

                return result


    return None


# ============================================================
# MASK TOKEN PADA URL
# ============================================================

# ============================================================
# MASK TOKEN PADA URL
# ============================================================

def mask_rtsp_url(url):

    if not isinstance(url, str):
        return url

    if "token=" in url:

        before, after = url.split(
            "token=",
            1
        )

        # Token mungkin diikuti parameter lain
        if "&" in after:

            after = (
                "<REDACTED>"
                + after[after.index("&"):]
            )

        else:

            after = "<REDACTED>"

        return (
            before
            + "token="
            + after
        )

    return url
# ============================================================
# FFPLAY
# ============================================================

# ============================================================
# FFPLAY
# ============================================================

# def play_rtsp(rtsp_url):

#     print()
#     print("=" * 70)
#     print("[5] MEMBUKA FFPLAY")
#     print("=" * 70)

#     print()
#     print(
#         "RTSP URL:",
#         mask_rtsp_url(rtsp_url)
#     )

#     print()
#     print(
#         "FFplay sedang dibuka..."
#     )

#     print(
#         "Tekan Q pada jendela FFplay "
#         "untuk keluar."
#     )

#     command = [

#         "ffplay",

#         "-rtsp_transport",
#         "tcp",

#         "-fflags",
#         "nobuffer",

#         "-flags",
#         "low_delay",

#         rtsp_url
#     ]

#     try:

#         subprocess.run(command)

#     except FileNotFoundError:

#         print()
#         print(
#             "FFplay tidak ditemukan."
#         )

#         print()
#         print(
#             "Install FFmpeg dengan:"
#         )

#         print(
#             "sudo apt update && "
#             "sudo apt install ffmpeg"
#         )

def logout(token):

    if not token:
        return

    url = (
        BASE
        + "/brms/api/v1.0/accounts/unauthorize"
    )

    headers = {
        "X-Subject-Token": token,
        "Content-Type": "application/json"
    }

    print()
    print("=" * 70)
    print("LOGOUT DSS")
    print("=" * 70)

    try:

        response = requests.post(
            url,
            headers=headers,
            json={},
            verify=False,
            timeout=TIMEOUT
        )

        print("HTTP:", response.status_code)

        try:
            result = response.json()

            print(
                "Code:",
                result.get("code")
            )

            print(
                "Desc:",
                result.get("desc")
            )

        except ValueError:

            print(response.text)

    except requests.RequestException as e:

        print(
            "Logout DSS gagal:",
            e
        )

# ============================================================
# MAIN
# ============================================================
# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("#" * 70)
    print("#             DAHUA DSS LIVE VIEW + YOLO")
    print("#" * 70)

    # ========================================================
    # LOGIN
    # ========================================================

    token = login()

    if not token:
        print()
        print("Program berhenti karena login gagal.")
        return

    # ========================================================
    # SEMUA PROSES DSS + YOLO DIBUNGKUS TRY/FINALLY
    # ========================================================

    try:

        # ====================================================
        # DEVICE TREE
        # ====================================================

        data = get_device_tree(token)

        if data is None:
            print()
            print("Program berhenti karena Device Tree gagal.")
            return

        # ====================================================
        # AMBIL CHANNEL
        # ====================================================

        channels = get_all_channels(data)

        sync_cameras_to_database(channels)

        # ====================================================
        # TAMPILKAN CHANNEL
        # ====================================================

        show_channels(channels)

        if not channels:
            print()
            print("Tidak ada channel CCTV.")
            return

        # ====================================================
        # PILIH CCTV
        # ====================================================

        selected_channels = select_channels(channels)

        print()
        print("=" * 70)
        print("MEMULAI STREAM KAMERA")
        print("=" * 70)

        streams = []

        for selected in selected_channels:

            print()
            print("-" * 70)
            print(f"Memulai kamera: {selected.get('channelName')}")
            print(f"Channel Code : {selected.get('channelCode')}")
            print("-" * 70)

            try:
                # Start video di DSS
                result = start_live(token, selected)

                # Ambil RTSP
                rtsp_url = find_rtsp(result)

                if rtsp_url:

                    stream_info = {
                        "channelCode": selected.get("channelCode"),
                        "channelName": selected.get("channelName"),
                        "deviceCode": selected.get("deviceCode"),
                        "rtsp_url": rtsp_url
                    }

                    streams.append(stream_info)

                    print()
                    print("[OK] RTSP berhasil ditemukan")
                    print(f"Camera : {selected.get('channelName')}")
                    print(f"RTSP   : {rtsp_url}")

                else:
                    print(
                        f"[ERROR] RTSP tidak ditemukan: "
                        f"{selected.get('channelName')}"
                    )

            except Exception as e:
                print(
                    f"[ERROR] Gagal menjalankan "
                    f"{selected.get('channelName')}: {e}"
                )


        print()
        print("=" * 70)
        print("HASIL STREAM")
        print("=" * 70)

        for stream in streams:
            print()
            print(f"Camera : {stream['channelName']}")
            print(f"Code   : {stream['channelCode']}")
            print(f"RTSP   : {stream['rtsp_url']}")

        print()
        print(f"Total stream berhasil: {len(streams)}")
        print("=" * 70)

        # ====================================================
        # TAMPILKAN RTSP TANPA TOKEN ASLI
        # ====================================================

        print()
        print("=" * 70)
        print("RTSP SIAP")
        print("=" * 70)

        print(
            mask_rtsp_url(rtsp_url)
        )

        # ====================================================
        # JALANKAN YOLO
        # ====================================================

        # print()
        # print("=" * 70)
        # print("MEMULAI YOLO")
        # print("=" * 70)

        print()
        print("CCTV DSS → RTSP → YOLO")
        print()
        print("Tekan Q pada jendela YOLO untuk berhenti.")

        

    except KeyboardInterrupt:

        print()
        print("Program dihentikan dengan Ctrl+C.")

    except Exception as e:

        print()
        print("=" * 70)
        print("ERROR PROGRAM")
        print("=" * 70)

        print(
            type(e).__name__,
            ":",
            e
        )

    finally:

        # ====================================================
        # LOGOUT DSS
        # ====================================================

        logout(token)


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    main()


