import sys
from pathlib import Path

# Tambahkan path backend ke sys.path jika dijalankan langsung dari folder services
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
    from kirimesp.ambildata import main as ambildata
except ImportError:
    from backend.kirimesp.ambildata import main as ambildata

def main():
    print("=" * 50)
    print("USSC - Menjalankan MQTT Flood Monitoring Service")
    print("=" * 50)
    try:
        ambildata()
    except Exception as e:
        print(f"❌ MQTT Service Error: {e}")
        raise

if __name__ == "__main__":
    main()