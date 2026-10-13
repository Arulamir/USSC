import time

from dss_session import dss_session


print()
print("=" * 70)
print("TEST DSS PERSISTENT SESSION")
print("=" * 70)

dss_session.start()

print()
print("[TEST] Session status:")

print(
    dss_session.status()
)

print()
print("[TEST] Tunggu 10 detik...")

for i in range(10):

    time.sleep(1)

    print(
        f"[TEST] {i + 1}/10",
        dss_session.status()
    )

print()
print("[TEST] Stop session")

dss_session.stop()

print()
print("[TEST] SELESAI")