# Smart Office Monitoring

Panel berada di bagian paling bawah Dashboard Utama, sebelum footer.
Panel mengikuti kartu, ikon hijau, dan tema terang/gelap dashboard yang ada;
CSS tambahan hanya berlaku pada panel baru.

## Data yang ditampilkan

- **Daya AC (W)**: jumlah pembacaan `power_w` meter AC yang tersedia.
  Sumbernya `active_power` WS523, sama dengan nilai `daya_sum` pada Function
  `WS523: daya_sum + energi_sum`. Function tersebut memberi alias per perangkat,
  bukan menjumlahkan seluruh AC. Backend melakukan penjumlahan kelompok AC.
  `energi_sum` adalah alias `power_consumption` (Wh), sehingga tidak dipakai
  sebagai daya W. Pembacaan mengikuti laporan perangkat; perubahan selama
  lima menit bisa terlewat jika terjadi di antara dua laporan sepuluh menit.
  Energi pemakaian singkat tetap dapat masuk counter Wh jika pencatatan aktif.
- Daya lampu tetap **W**, jumlah pembacaan `power_w` empat meter lampu.
  AC juga menggunakan empat meter; `ATAS_PINTU` tidak masuk total AC.
- Occupancy: `occupied` → Terisi, `vacant` → Kosong.
- Suhu dalam °C dan kelembapan dalam %.
- Illumination: `bright` → Terang, `dim` → Redup. Sensor ini tidak memberikan lux.

Untuk monitoring occupancy sesuai flow lama pengguna, tersedia perbaikan
[VS321 region_1](nodered/vs321-region1/README.md). Collector membaca status
`region_1` langsung, tanpa inferensi jumlah orang atau gabungan region. Frontend
dan backend sudah membaca nilai occupancy sehingga tidak perlu perubahan kode
website untuk mengganti sumbernya. Perubahan ini berlaku pada snapshot baru
setelah kedua Function monitoring UG65 diperbarui.

Sesuai perubahan automasi berikutnya, tersedia [automasi AC bersama lampu
utama](nodered/ac-main-timer/README.md): tap mengirim ON melalui Function HVAC
dan MQTT lama; akhir 10 jam memeriksa region_1. Vacant menghasilkan OFF lampu
A/B dan AC melalui IRHVAC, occupied memperpanjang 35 menit, data unknown
menunggu. WS523 tetap hanya meter daya, bukan jalur kontrol AC.

Kolom `ac_jam_wh` / `lampu_jam_wh` dan periode lainnya berisi **energi**, sehingga
tidak dipakai sebagai daya. Nilai nol tetap ditampilkan sebagai nol; data yang
tidak tersedia ditampilkan “—”. Keterangan kecil di bawah keenam indikator,
termasuk jumlah meter dan “Data sebagian”, tidak ditampilkan sesuai permintaan.
Metadata kelengkapan meter tetap tersedia pada respons API.

Setiap nilai diperiksa berdasarkan waktu observasi di `device_samples`, relatif
terhadap waktu snapshot: daya, suhu, kelembapan, dan illumination maksimal
30 menit; occupancy maksimal 15 menit. Observasi sesudah snapshot diabaikan.
Status kualitas energi tidak dipakai untuk membuang pembacaan daya yang valid.

## Koneksi backend

Endpoint: `GET /api/smart-office`. Proxy API Next.js yang sudah ada meneruskan
permintaan ke Flask; konfigurasi Nginx `/api/` yang ada juga tetap dapat dipakai.

Isi variabel berikut di `.env` root atau `backend/.env` pada server:

```dotenv
SMART_OFFICE_DB_HOST=alamat-server-mariadb
SMART_OFFICE_DB_PORT=3306
SMART_OFFICE_DB_NAME=smart_office
SMART_OFFICE_DB_USER=akun-pembaca
SMART_OFFICE_DB_PASSWORD=
SMART_OFFICE_SOURCE_ID=ug65-ussc
```

Host, port, user, dan password yang tidak diisi menggunakan variabel `DB_*`
yang sudah ada. Nama database default tetap `smart_office`, terpisah dari
database USSC. Gunakan akun yang memiliki akses SELECT ke tabel `office1`.
Jangan menyimpan kredensial pada frontend atau Git.

Panel memeriksa endpoint setiap 15 detik; data sensor mengikuti interval
snapshot dari gateway (paket yang diberikan memakai 10 menit). Waktu data
ditampilkan dalam WIB. Snapshot lebih dari 30 menit atau bertanggal di masa
depan ditandai “Data terlambat”.
Jika koneksi gagal, panel memberi status “Koneksi terputus”; data terakhir
yang sudah berhasil dimuat tetap disertai waktu pembacaannya.
Halaman juga membaca ulang segera saat tab kembali aktif, koneksi pulih, atau
halaman dipulihkan dari cache navigasi browser. Permintaan lama yang masih
tertunda dibatalkan agar tidak menimpa respons yang lebih baru.

## Penerapan

Perubahan ini disiapkan pada salinan project lokal. Untuk menayangkannya di
website, terapkan file yang berubah, lengkapi konfigurasi database di server,
build frontend, lalu restart layanan frontend dan backend sesuai pengelola
proses yang digunakan. Pembacaan snapshot lama tidak memerlukan perubahan tabel.
Untuk pembaruan daya 1 menit, pasang tambahan flow Node-RED di bawah.

Koneksi MariaDB dan pembacaan perangkat langsung perlu diverifikasi di
server yang memiliki akses ke `smart_office.office1`.

## Feed monitoring setiap 1 menit

Jalur ini memperbarui daya AC dan lampu dalam **W**.
UG65 membaca cache meter
yang sudah ada setiap 60 detik, menerbitkan `office1/monitoring/power`, lalu
mini PC menyimpan pembacaan terbaru di RAM. Backend membaca endpoint privat
`GET /office1/power` menggunakan `OFFICE_CONTROL_KEY` yang sama dengan kontrol.
Key tetap di backend dan Node-RED; tidak dikirim ke browser.

Flow yang sudah mengirim `power_w` tetap kompatibel, termasuk flow counter
AC terakhir. Penggantian kartu Wh menjadi W tidak memerlukan JSON Node-RED
atau variabel `.env` baru. Riwayat counter interval tetap tersedia dalam API
untuk diagnostik sesuai [panduan ini](nodered/ac-interval-energy/README.md).
Perhitungan **energi harian AC**, grafik, dan Excel tetap memakai jalur dan
kolom lama.

Pasang tambahan pada tab yang sama dengan flow lama:

- UG65: `nodered/smart-office-power/UG65_tambahan_daya_1menit.json`, import
  ke **current flow automasi_system** agar dapat membaca cache di tab tersebut.
- Mini PC: `nodered/smart-office-power/MiniPC_tambahan_daya_1menit.json`, import
  ke **current flow Office1 kontrol web** agar memakai environment key dan
  broker yang sudah berjalan. Gunakan store RAM `telemetryRuntime` yang sama
  dengan API kontrol. Pilih ulang broker lama jika diperlukan setelah import.

Kemudian tambahkan pada `.env` server yang benar-benar dibaca backend:

```dotenv
SMART_OFFICE_POWER_URL=http://100.97.64.86:1880/office1/power
```

Restart backend dan build/restart frontend setelah menerapkan perubahan kode.
Biarkan variabel kosong bila flow tambahan belum dipasang; daya AC dan lampu
tetap membaca W dari snapshot database. Wh harian dan lingkungan tetap tersedia.
Jika feed terlambat atau terputus, nilai daya terakhir tetap
ditampilkan dengan penanda **Menampilkan data sebelumnya** dan waktu
observasi aslinya. Nilai nol tetap dipertahankan.
Backend memilih nilai terakhir yang tersedia dari feed, cache proses, atau
snapshot database. Cache dipisahkan per sumber dan diisi kembali dari database
setelah restart. Jika belum pernah ada nilai yang valid, tampilan tetap “—”.
Respons kosong juga mempertahankan data yang sudah ditampilkan di browser.
Pemilihan nilai terbaru mengikuti waktu observasi meter paling baru pada tiap
kelompok. Meter lain yang masih memakai data sebelumnya tidak menghalangi
perubahan total watt. Waktu data lama tetap ditampilkan untuk penanda kesegaran.

**WS523 AC mengikuti interval laporan yang diterima, sekitar 10 atau 20 menit;
WS502 lampu dapat mengirim setiap 1 menit
agar pembacaan lampu benar-benar diperbarui per menit.** Sesuaikan Reporting
Interval pada perangkat melalui ToolBox atau konfigurasi downlink yang sesuai.
Fitur ini tidak otomatis mengubah konfigurasi meter atau mengirim ON/OFF.
Menyalin cache tiap menit tidak menciptakan pengukuran baru.

Timestamp `power_w_at` asli dipertahankan. Packet lebih dari 150 detik atau
pembacaan meter lebih dari 3 menit ditandai sebagai data sebelumnya. Nilai nol valid;
meter hilang tidak diubah menjadi nol; meter duplikat ditolak dan meter ATAS_PINTU
tetap dikecualikan. Browser memeriksa setiap 15 detik, sehingga tampilan juga
bergantung pada interval uplink dan keterlambatan jaringan, bukan jaminan tepat
60 detik. Jam UG65, mini PC, dan server harus sinkron.

Snapshot database **10 menit**, energi harian Wh, grafik, Excel, occupancy, suhu,
kelembapan, illumination, dan kontrol ON/OFF tetap memakai jalur semula. Tidak ada
tabel baru, perubahan SQL, atau penambahan baris daya 1 menit di `office1`.

Referensi perangkat: [WS50x Reporting Interval](https://www.milesight.com/products/docs/en/ws50x/steps/ws50x/general-settings.html)
dan [WS523 User Guide](https://resource.milesight.com/milesight/iot/document/ws52x-user-guide-en.pdf).

## Halaman Smart Office

Menu **Smart Office** berada di navigasi samping dan membuka `/smart-office`.
Ringkasan menampilkan daya AC (W), daya lampu (W),
energi harian AC/lampu (Wh), suhu (°C),
kelembapan (%), illumination (Terang/Redup), dan occupancy (Terisi/Kosong).
Keempat kartu kondisi ruangan memakai snapshot sensor dan pembaruan otomatis
yang sama dengan ringkasan lainnya. Data sensor yang belum tersedia ditampilkan
sebagai `—`, termasuk status illumination dan occupancy yang belum diketahui.
Energi harian mengambil `ac_hari_wh` dan `lampu_hari_wh` dari satu snapshot
terbaru, disertai tanggal snapshot dalam WIB. Snapshot lama tidak ditampilkan
seolah-olah berasal dari hari ini.

Tanggal acuan menentukan periode grafik:

| Pilihan | Rentang | Interval grafik dan laporan |
| --- | --- | --- |
| Per Hari | Tanggal acuan | Per jam |
| Per Minggu | Senin–Minggu yang memuat tanggal acuan | Per hari |
| Per Bulan | Bulan tanggal acuan | Per hari |
| Per Tahun | Tahun tanggal acuan | Per bulan |

`GET /api/smart-office/history?period=daily&date=2026-10-16` membaca counter
`energy_wh` dan `energy_wh_at` di `device_samples`. Counter yang sama pada
beberapa snapshot tidak dihitung berulang. Energi dihitung dari selisih counter
pada kedua batas periode; interpolasi hanya dipakai jika pembacaan di kedua
sisi batas masing-masing berjarak paling jauh 30 menit. Reset counter dan
konflik dikecualikan. Meter yang tersedia tetap dijumlahkan dengan penanda
kualitas. Interval mendatang kosong, interval berjalan belum final.

**Unduh Excel** memakai periode dan tanggal yang sedang dipilih melalui
`GET /api/smart-office/export`. File `.xlsx` memiliki sheet **Ringkasan** dan
**Energi**, subtotal data tersedia, status kelengkapan, waktu WIB, filter,
header beku, format angka, serta pengaturan cetak. Nilai hilang tidak menjadi
nol. Laporan tidak menjumlahkan kolom kumulatif harian antarsnapshot.

## Kontrol Node-RED melalui Tailscale

Alamat default mini PC mengikuti IP yang diberikan pengguna:

```dotenv
SMART_OFFICE_CONTROL_URL=http://100.97.64.86:1880/office1/control
OFFICE_CONTROL_KEY=
SMART_OFFICE_OPERATOR_KEY=
```

- `OFFICE_CONTROL_KEY` harus sama dengan variabel bernama sama di Node-RED
  mini PC. Kunci ini hanya dikirim backend ke Node-RED.
- `SMART_OFFICE_OPERATOR_KEY` adalah kunci terpisah untuk membuka kontrol di
  halaman website, minimal 8 karakter. `OFFICE_CONTROL_KEY` tetap minimal 32
  karakter sesuai validasi Node-RED. Kedua kunci wajib berbeda dan berupa
  karakter ASCII tanpa spasi. Isi secara privat; jangan simpan di Git atau chat.
- Kunci operator dimasukkan melalui bagian **Kontrol Perangkat**. Website
  menyimpannya hanya selama halaman terbuka; **Kunci kembali** atau memuat
  ulang halaman menghapusnya. Tidak ada kunci Node-RED dalam bundle frontend.
- Port 1880 adalah konfigurasi awal Node-RED. Jika layanan memakai port lain,
  sesuaikan konfigurasi backend dan validasi port yang diizinkan pada modul
  kontrol. URL wajib berupa alamat IPv4 Tailscale dan path `/office1/control`.
- Flow yang diberikan hanya menerima sumber `100.86.6.76` dan loopback.
  Karena itu backend harus berjalan di server yang keluar melalui IP Tailscale
  tersebut. Laptop dapat melihat halaman tetapi bisa ditolak ketika mengontrol
  langsung dengan IP sumber lain. Jangan membuka kontrol untuk semua sumber.

Target yang tersedia mengikuti flow yang diberikan:

| Target Node-RED | Perangkat |
| --- | --- |
| `AC_KANTOR` | Kelompok AC kantor |
| `WS502_RUANG_UTAMA` | Lampu Ruang Utama, satu kontrol untuk A dan B |
| `WS502_RUANG_MAGANG` | Lampu ruang magang |
| `WS502_BU_DINI` | Lampu Ruang Direktur USSC |
| `WS502_ALL` | Seluruh lampu |

Browser mengirim `POST /api/smart-office/control` dengan JSON `device` dan
`state` (`on`/`off`), kunci operator pada header Authorization, dan ID permintaan.
Backend memvalidasi target lalu meneruskan perintah dengan kunci Node-RED.
Balasan `accepted_by_ug65` berarti gateway menerima perintah; kondisi fisik
belum terkonfirmasi. Timeout tidak diulang otomatis karena perintah mungkin
sudah dijalankan. Periksa perangkat sebelum mengirim ulang.

## Menjalankan dan memeriksa

Jalankan backend sesuai BACKUP.md dengan konfigurasi database yang benar,
lalu frontend dari folder `frontend`:

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3107
```

Buka `http://localhost:3107/smart-office`. Proxy Next.js memakai backend
`http://127.0.0.1:5000`; bila perlu alamat berbeda, isi
`USSC_API_BACKEND_ORIGIN` di `frontend/.env.local` lalu restart frontend.
Konfigurasi Nginx produksi yang meneruskan `/api/` langsung ke Flask tetap
didukung.

Pengujian lokal memakai database dan balasan kontrol tiruan. Koneksi database
produksi, kunci akses, sumber IP server, dan perubahan kondisi perangkat fisik
tetap perlu diverifikasi saat penerapan. Tidak ada perintah ON/OFF dikirim ke
perangkat nyata selama pengembangan.
