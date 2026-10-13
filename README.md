# Smart Sustainability Campus - UNESA 🌿

> Panduan backup dan pemulihan untuk snapshot ini: [BACKUP.md](BACKUP.md).
> Nilai kredensial di source backup sudah diganti dengan variabel lingkungan.

Sistem Monitoring Cerdas Kampus Berkelanjutan Universitas Negeri Surabaya (Pemantauan Kualitas Udara, Kendaraan & Emisi, serta Deteksi Banjir).

---

## 📁 Struktur Folder & Organisasi Kode

Struktur proyek mandiri (Fullstack Frontend + Backend Server Flask) di folder **`USSC`**:

```
USSC/
│
├── .gitignore                  # [KEAMANAN] Mencegah file rahasia ter-upload ke Git/Public
├── .env.example                # Template variabel lingkungan (DB, MQTT, Flask Port)
├── README.md                   # Dokumentasi proyek dan panduan lengkap
│
├── index.html                  # Halaman antarmuka utama (Single Page Application)
│
├── assets/                     # Berkas statis publik
│   ├── css/
│   │   └── style.css           # Styling antarmuka dashboard
│   │
│   ├── js/
│   │   ├── config.js           # Konfigurasi endpoint & timeout frontend
│   │   ├── api.js              # Service layer untuk fetch data ke server backend & MQTT
│   │   └── jawa.js             # Logika interaktivitas, chart rendering & UI state
│   │
│   └── img/
│       ├── lo.png              # Ikon/Logo aplikasi
│       └── logoweb.png         # Logo UNESA / Banner
│
└── server/                     # Backend Python Flask Server
    ├── app.py                  # Entrypoint Flask Server (CORS + Static Serving + Background Workers)
    ├── config.py               # Pengaturan server & koneksi database dari .env
    ├── requirements.txt        # Daftar dependensi Python
    ├── cekdata.py              # Skrip penguji koneksi API AirGradient
    │
    ├── database/
    │   ├── db.py               # Modul koneksi MariaDB / MySQL (mysql.connector)
    │   └── schema.sql          # Skema tabel database
    │
    ├── api/                    # REST API Endpoints Flask
    │   ├── airquality.py       # GET /api/airquality
    │   ├── trafficgrafik.py    # GET /api/traffic-grafik
    │   ├── traffic.py          # POST /api/traffic
    │   ├── dashboard.py        # GET /api/dashboard
    │   ├── chart.py            # GET /api/chart
    │   └── table.py            # GET /api/table
    │
    ├── airgradient/            # Background service pengambilan data sensor AirGradient
    ├── emisi/                  # Modul perhitungan emisi karbon kendaraan
    └── kirimesp/               # Background service MQTT gateway ESP32
```

---

## 🔒 Panduan Keamanan Data (Mencegah Kebocoran ke Publik)

1. **Jangan Menyimpan Password / Token di Frontend (`assets/js/`)**:
   - Seluruh file di dalam `assets/js/` dapat dilihat oleh siapa saja melalui browser *Inspect Element / DevTools*.
   - Kunci API rahasia, password database MySQL/MariaDB, atau kredensial MQTT **hanya disimpan di backend (`.env`)**.

2. **Penggunaan File `.env`**:
   - Salin `.env.example` menjadi `.env`.
   - Isi file `.env` dengan kredensial database & broker Anda.
   - File `.env` sudah otomatis diblokir oleh `.gitignore` sehingga aman dari kebocoran ke Git/publik.

---

## 🚀 Cara Menjalankan

### 1. Instalasi Dependensi Python (Sekali di awal):
Buka terminal di folder `BERGABUNG` lalu jalankan:
```bash
pip install -r server/requirements.txt
```

### 2. Jalankan Backend Server Flask:
```bash
cd server
python app.py
```
Server akan aktif di **`http://localhost:5000`**.

### 3. Akses Website:
Cukup buka browser di alamat:
👉 **`http://localhost:5000`**

*(Server Flask akan otomatis melayani halaman web `index.html` berserta seluruh API dan koneksi database MariaDB).*
