from mediamtx_client import MediaMTXClient


client = MediaMTXClient()

TEST_PATH = "api_test"
TEST_SOURCE = "rtsp://100.97.64.86:8554/hikvision"


print("=" * 60)
print("TEST MEDIAMTX ADD / LIST / DELETE")
print("=" * 60)


# ============================================================
# 1. ADD
# ============================================================

print("\n[1] ADD PATH")

try:
    result = client.add_path(
        TEST_PATH,
        TEST_SOURCE
    )

    print("ADD SUCCESS")
    print(result)

except Exception as e:
    print("ADD FAILED")
    print(type(e).__name__, e)


# ============================================================
# 2. LIST
# ============================================================

print("\n[2] LIST PATHS")

try:
    result = client.list_paths()

    for item in result.get("items", []):
        print(
            f"PATH      : {item.get('name')}\n"
            f"SOURCE    : {item.get('source')}\n"
            f"TRANSPORT : {item.get('rtspTransport')}\n"
        )

except Exception as e:
    print("LIST FAILED")
    print(type(e).__name__, e)


# ============================================================
# 3. DELETE
# ============================================================

print("\n[3] DELETE PATH")

try:
    result = client.delete_path(TEST_PATH)

    print("DELETE SUCCESS")
    print(result)

except Exception as e:
    print("DELETE FAILED")
    print(type(e).__name__, e)


# ============================================================
# 4. FINAL LIST
# ============================================================

print("\n[4] FINAL LIST")

try:
    result = client.list_paths()

    for item in result.get("items", []):
        print(
            f"PATH      : {item.get('name')}\n"
            f"SOURCE    : {item.get('source')}\n"
            f"TRANSPORT : {item.get('rtspTransport')}\n"
        )

except Exception as e:
    print("FINAL LIST FAILED")
    print(type(e).__name__, e)