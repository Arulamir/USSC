# Sistem Pemantauan Banjir & Lingkungan (Environmental & Flood Monitoring) - USSC UNESA 🌊

Dokumentasi teknis khusus modul **Pemantauan Banjir dan Cuaca Mikro Kampus** di lingkungan Universitas Negeri Surabaya (UNESA). Modul ini mencakup pemantauan telemetri sensor lingkungan di dua kampus utama: **Ketintang** dan **Lidah Wetan**.

---

## 📌 Daftar Isi

1. [Gambaran Umum](#-gambaran-umum)
2. [Arsitektur Sistem & Aliran Data](#-arsitektur-sistem--aliran-data)
3. [Spesifikasi Sensor & Parameter Pengukuran](#-spesifikasi-sensor--parameter-pengukuran)
4. [Logika Penentuan Status & Ambang Batas](#-logika-penentuan-status--ambang-batas)
5. [Skema Basis Data (MariaDB)](#-skema-basis-data-mariadb)
6. [Konfigurasi Lingkungan (`.env`)](#-konfigurasi-lingkungan-env)
7. [Dokumentasi REST API & Real-time Streaming](#-dokumentasi-rest-api--real-time-streaming)
8. [Antarmuka Pengguna (Frontend Dashboard)](#-antarmuka-pengguna-frontend-dashboard)
9. [Panduan Simulasi & Pengujian MQTT](#-panduan-simulasi--pengujian-mqtt)

---

## 🌐 Gambaran Umum

Sistem Pemantauan Banjir UNESA dirancang untuk memberikan peringatan dini (*early warning system*) terhadap potensi banjir di titik-titik rawan kampus, sekaligus memantau parameter kualitas air dan cuaca mikro.

Data dikumpulkan dari stasiun sensor berbasis mikrokontroler (ESP32) di lapangan, dikirimkan melalui protokol MQTT secara terenkripsi, diproses oleh server backend berbasis Python Flask, disimpan ke basis data MariaDB, dan disajikan secara *real-time* kepada civitas akademika melalui antarmuka Next.js.

### Titik Pemantauan Aktif:
- **Kampus Ketintang**: Mengawasi ketinggian permukaan air di area danau Ketintang.
- **Kampus Lidah Wetan**: Mengawasi ketinggian permukaan air di area danau hutan kampus Lidah Wetan.

---

## 🏗 Arsitektur Sistem & Aliran Data

```text
  [ Hardware Node (ESP32) ]
   ├── Sensor Ultrasonik (JSN-SR04T)
   ├── Sensor Suhu Ganda (DS18B20)
   ├── Sensor pH Analog
   ├── Sensor Kelembaban Tanah
   └── Rain Gauge (Tipping Bucket)
                 │
                 ▼ (MQTT TLS / Port 8883)
  [ Broker EMQX Cloud ]
   ├── Topik: unesa/flows/ketintang
   └── Topik: unesa/flows/lidahwetan
                 │
                 ▼
  [ USSC Flask Backend (`kirimesp/ambildata.py`) ]
   ├── Background Subscriber Client
   ├── Thread-safe Memory Cache (`LATEST_FLOOD_DATA`)
   ├── Broadcast Server-Sent Events (SSE: `/api/flood/stream`)
   └── Auto-save Database Throttle (1 detik)
                 │
                 ├──► [ MariaDB Database (`flood_data`) ]
                 │
                 ▼
  [ USSC Next.js Frontend Dashboard ]
   ├── Fast Polling (1.5s): `/api/flood/latest`
   ├── Auto-refresh Chart (10s): `/api/flood/recent`
   ├── Aggregated History (10m): `/api/flood/history`
   └── Real-time Status Card & Ekspor Data CSV
```

---

## 🌡 Spesifikasi Sensor & Parameter Pengukuran

| No | Parameter | Sensor / Sumber | Satuan | Deskripsi & Rentang Normal |
|---|---|---|---|---|
| 1 | **Ketinggian Air** | JSN-SR04T (Ultrasonik Waterproof) | `cm` | Mengukur jarak muka air ke sensor / kedalaman genangan air. |
| 2 | **Suhu Udara** | DS18B20 (Sensor 1 / Udara) | `°C` | Suhu ambien udara sekitar stasiun pantau (24°C - 35°C). |
| 3 | **Suhu Air** | DS18B20 (Sensor 2 / Probe Celup) | `°C` | Suhu air genangan atau aliran saluran (22°C - 32°C). |
| 4 | **Keasaman Air (pH)** | Sensor pH Analog | `pH` | Indeks keasaman air (Netral: 6.5 - 8.5, Asam < 6.5, Basa > 8.5). |
| 5 | **Kelembaban Tanah** | Capacitive Soil Moisture Sensor | `%` | Kadar air dalam tanah permukaan sekitar sensor (0% - 100%). |
| 6 | **Intensitas Hujan** | Tipping Bucket Rain Gauge | `mm/jam` | Curah hujan akumulatif per jam (0 = Cerah, > 20 = Hujan Lebat). |
| 7 | **Suhu Panel Box** | Internal Thermistor / DHT | `°C` | Kondisi suhu di dalam panel kontrol luar ruangan. |
| 8 | **Kelembaban Panel** | Internal DHT | `%` | Kelembaban udara di dalam box perlindungan elektronik. |
| 9 | **Cuaca Kota Surabaya** | Open-Meteo Integration | `°C`, `%` | Data referensi suhu & kelembaban regional Kota Surabaya. |

---

## ⚠️ Logika Penentuan Status & Ambang Batas

Status kondisi banjir diklasifikasikan ke dalam 3 tingkatan utama:

```text
+-------------------+----------------------------+--------------------------------------------+
| Tingkat Status    | Ambang Ketinggian Air      | Keterangan & Tindakan                      |
+-------------------+----------------------------+--------------------------------------------+
| NORMAL            | Jarak Air < 50 cm          | Kondisi aman, tidak ada potensi genangan.  |
| WASPADA           | 50 cm <= Jarak Air < 100 cm| Permukaan air meningkat, waspada genangan. |
| DARURAT           | Jarak Air >= 100 cm        | Kritis, sistem membunyikan peringatan dini.|
+-------------------+----------------------------+--------------------------------------------+
```

> **Catatan Fuzzy Sugeno / Mikrokontroler**:
> Apabila mikrokontroler mengirimkan label status eksplisit (`status` atau `sugeno` pada raw payload), backend dan antarmuka akan memprioritaskan label tersebut:
> - Nilai `DARURAT` $\rightarrow$ Tampilan indikator Merah (`badge-danger`).
> - Nilai `WASPADA` $\rightarrow$ Tampilan indikator Kuning (`badge-warning`).
> - Nilai `NORMAL`  $\rightarrow$ Tampilan indikator Hijau (`badge-safe`).


---

## 🗄 Skema Basis Data (MariaDB)

Tabel `flood_data` pada basis data `ussc_db` bertugas mencatat histori pembacaan:

```sql
CREATE TABLE IF NOT EXISTS `flood_data` (
    `id` INT AUTO_INCREMENT PRIMARY KEY,
    `lokasi` VARCHAR(50) NOT NULL,            -- 'lidah' atau 'ketintang'
    `water_level` FLOAT DEFAULT 0,           -- ketinggian air (cm)
    `air_temp` FLOAT DEFAULT 0,              -- suhu udara sekitar (°C)
    `soil_moisture` FLOAT DEFAULT 0,         -- kelembaban tanah (%)
    `rain_intensity` FLOAT DEFAULT 0,        -- intensitas curah hujan (mm/jam)
    `panel_temp` FLOAT DEFAULT 0,            -- suhu panel box (°C)
    `panel_humidity` FLOAT DEFAULT 0,        -- kelembaban panel box (%)
    `status` VARCHAR(20) DEFAULT 'NORMAL',   -- NORMAL / WASPADA / DARURAT
    `raw_payload` TEXT NULL,                 -- string JSON mentah dari perangkat
    `timestamp` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_lokasi` (`lokasi`),
    INDEX `idx_timestamp` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## ⚙️ Konfigurasi Lingkungan (`.env`)

Pastikan variabel-variabel berikut terisi dengan benar di file `.env` root atau `backend/.env`:

```dotenv
# Konfigurasi Database MariaDB
DB_HOST=localhost
DB_PORT=3306
DB_NAME=ussc_db
DB_USER=root
DB_PASSWORD=your_password

# Konfigurasi EMQX Cloud Broker untuk Sistem Banjir
MQTT_BROKER=oc61af70.ala.eu-central-1.emqxsl.com
MQTT_TCP_PORT=8883
MQTT_WS_PORT=8084
MQTT_FLOOD_USERNAME=Banjir
MQTT_FLOOD_PASSWORD=

# Topik Langganan Data Banjir
MQTT_TOPIC_FLOOD_LW=unesa/flows/lidahwetan
MQTT_TOPIC_FLOOD_KT=unesa/flows/ketintang
```

---

## 📡 Dokumentasi REST API & Real-time Streaming

Seluruh endpoint di bawah ini beralamat dasar pada prefix `/api`.

### 1. Data Sensor Terkini (General)
- **Endpoint**: `GET /api/flood`
- **Query Params**: `location` (opsional: `ketintang` atau `lidah`)
- **Contoh Respons**:
  ```json
  {
    "status": "success",
    "source": "database",
    "data": {
      "id": 1420,
      "lokasi": "ketintang",
      "jarak": 24.5,
      "suhu_udara": 29.8,
      "suhu_air": 27.2,
      "soil": 65.0,
      "rain": 0.0,
      "ph": 7.1,
      "status": "NORMAL",
      "timestamp": "2026-10-20 11:45:00"
    }
  }
  ```

### 2. Fast-Check Polling Terkini
- **Endpoint**: `GET /api/flood/latest?location={ketintang|lidah}`
- **Fungsi**: Dipanggil frontend setiap 1.5 detik untuk deteksi pembaruan data secara instan tanpa membebani server.

### 3. Data Kronologis untuk Grafik
- **Endpoint**: `GET /api/flood/recent?location={ketintang|lidah}&limit=10`
- **Fungsi**: Mengambil $N$ titik data terakhir yang telah diurutkan dari waktu terlama ke terbaru (ASC) untuk visualisasi Chart.js.

### 4. Riwayat Tabel Teragregasi / Mentah
- **Endpoint**: `GET /api/flood/history`
- **Query Params**:
  - `location`: `ketintang` atau `lidah`
  - `interval`: `10m` (agregasi rata-rata per 10 menit, default) atau `raw` (tiap baris data)
  - `limit`: default 50 (maksimal 200)

### 5. Riwayat Hari Ini (Per Jam)
- **Endpoint**: `GET /api/flood/history/today`
- **Fungsi**: Mengelompokkan data sensor per jam (00:00 - 23:00) khusus hari berjalan. Data otomatis berganti setiap pergantian hari.

### 6. Real-time Streaming (Server-Sent Events)
- **Endpoint**: `GET /api/flood/stream`
- **Format**: `text/event-stream`
- **Deskripsi**: Push data telemetri instan dari broker MQTT langsung ke browser client secara sub-detik tanpa perlunya polling manual. Disertai komentar `: ping\n\n` tiap 15 detik sebagai heartbeat.

### 7. Ekspor Data Laporan (CSV Format)
- **Endpoint**: `GET /api/flood/export`
- **Query Params**:
  - `location`: `ketintang` atau `lidah`
  - `period`: `today` (hari ini) atau `monthly` (satu bulan penuh)
  - `year`: angka tahun (misal `2026`)
  - `month`: angka bulan 1-12 (misal `10`)
- **Output**: File CSV dengan encoding `UTF-8 with BOM` agar langsung rapi saat dibuka di Microsoft Excel.


---

## 💻 Antarmuka Pengguna (Frontend Dashboard)

Modul banjir memiliki antarmuka khusus yang dapat diakses melalui bilah navigasi (Sidebar):

1. **Ringkasan Beranda (`/`)**:
   - Kartu metrik pemantauan banjir pada *Summary Grid*.
   - Status teragregasi kedua kampus (NORMAL/WASPADA/DARURAT) pada bagian *Status Lokasi Banjir*.
2. **Halaman Ketintang (`/ketintang`) & Lidah Wetan (`/lidah-wetan`)**:
   - **Status Card Utama**: Indikator lampu status dinamis (Hijau/Kuning/Merah) beserta deskripsi situasional.
   - **10 Kartu Metrik Lingkungan**:
     1. Ketinggian Air (cm)
     2. Suhu Udara (°C)
     3. Suhu Air (°C)
     4. Sensor pH Air (dengan penanda visual asam/netral/basa)
     5. Kelembaban Tanah (%)
     6. Intensitas Curah Hujan (mm/jam)
     7. Suhu Surabaya (Open-Meteo)
     8. Kelembaban Surabaya (Open-Meteo)
   - **3 Grafik Tren Dinamis (Chart.js)**:
     - Tren Ketinggian Air
     - Tren Suhu Lingkungan
     - Tren Kelembaban Tanah
   - **Tabel Log Riwayat**: Riwayat kronologis pengukuran dengan limit baris, pagination, dan tombol unduh langsung ke file CSV (`downloadHistoryCSV`).
   - **Modal Unduh Khusus**: Dukungan unduh riwayat hari ini atau bulanan melalui tombol filter.

---

## 🧪 Panduan Simulasi & Pengujian MQTT

Untuk menguji pengiriman data ke sistem tanpa perangkat fisik di lapangan, jalankan skrip Python publisher berikut:

```python
import json
import time
import paho.mqtt.client as mqtt

BROKER = "oc61af70.ala.eu-central-1.emqxsl.com"
PORT = 8883
USER = "Banjir"
PASSWORD = "GANTI_DENGAN_PASSWORD_MQTT_PRIVAT"
TOPIC = "unesa/flows/ketintang"

payload_dummy = {
    "jarak": 32.5,
    "suhu_udara": 29.4,
    "suhu_air": 26.8,
    "ph": 7.2,
    "soil": 60.5,
    "rain": 0.0,
    "temp_panel": 34.0,
    "hum_panel": 55.0,
    "status": "NORMAL"
}

client = mqtt.Client()
client.username_pw_set(USER, PASSWORD)
client.tls_set()  # Mengaktifkan enkripsi SSL/TLS untuk port 8883
client.connect(BROKER, PORT, 60)

client.publish(TOPIC, json.dumps(payload_dummy))
print("Payload uji coba berhasil dikirim ke topik:", TOPIC)
client.disconnect()
```

Setelah payload dikirim:
1. Periksa terminal server backend Flask: log `[Flood-DB] Data banjir ketintang tersimpan...` akan muncul.
2. Halaman dashboard web di `/ketintang` akan memperbarui kartu sensor secara otomatis dalam rentang 1.5 detik.

---

*USSC - Smart Sustainability Campus, Universitas Negeri Surabaya.*

