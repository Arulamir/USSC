import sys
import time
from pathlib import Path

# Tambahkan path backend ke sys.path jika dijalankan langsung dari folder services atau root
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

root_dir = backend_dir.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

try:
    from airgradient.ambil import mulai_airgradient
except ImportError:
    from backend.airgradient.ambil import mulai_airgradient

def main():
    print("=" * 50)
    print("USSC - Menjalankan AirGradient Collector Service")
    print("=" * 50)
    try:
        mulai_airgradient()
    except Exception as e:
        print(f"❌ AirGradient Service Error: {e}")
        raise

if __name__ == "__main__":
    main()
