import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    from airgradient.ambil_jam import mulai_hourly_average
except ImportError:
    from backend.airgradient.ambil_jam import mulai_hourly_average


def main():
    print("=" * 50)
    print("USSC - Menjalankan AirGradient Hourly Average Service")
    print("=" * 50)

    try:
        mulai_hourly_average()
    except Exception as e:
        print(f"AirGradient Hourly Average Service Error: {e}")
        raise


if __name__ == "__main__":
    main()