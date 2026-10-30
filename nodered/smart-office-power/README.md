# Tambahan daya W setiap 1 menit

**Kartu AC dan lampu memakai W.** Fragment di sini juga meneruskan counter
energi untuk diagnostik interval Wh. Collector yang sudah mendukung counter
tetap kompatibel; lihat [panduan Function UG65](../ac-interval-energy/README.md).
Untuk instalasi yang sudah berjalan cukup ganti isi Function sesuai panduan;
jangan import node yang sama dua kali.

Flow ini menambahkan jalur monitoring daya yang terpisah dari snapshot 10 menit.
File fragment di folder ini tidak berisi nilai key atau kredensial MQTT.

1. Cadangkan flow Node-RED yang sedang berjalan.
2. UG65: buka tab **automasi_system** yang aktif. Import
   `UG65_tambahan_daya_1menit.json` ke **current flow**. Tiga node tambahan
   sudah saling terhubung. Pilih broker MQTT lama `192.168.137.1:1883`.
3. Mini PC: buka tab **Office1 kontrol web**. Import
   `MiniPC_tambahan_daya_1menit.json` ke **current flow**. Lima node tambahan
   sudah saling terhubung. Pilih broker MQTT yang sama. Pertahankan environment
   `OFFICE_CONTROL_KEY` dan context store RAM `telemetryRuntime` yang sudah dipakai.
4. Deploy **Modified Nodes**. Tidak perlu mengubah Function timer atau node lama.
5. Terapkan kode website terbaru, isi `.env` backend:

   ```dotenv
   SMART_OFFICE_POWER_URL=http://100.97.64.86:1880/office1/power
   ```

   Build frontend dan restart layanan frontend/backend. Key backend menggunakan
   `OFFICE_CONTROL_KEY` lama, bukan key operator. Sumber HTTP yang diizinkan tetap
   server `100.86.6.76`, `127.0.0.1`, dan `::1` sesuai flow kontrol sebelumnya.

WS523 AC melapor mengikuti interval aktual (sekitar 10–20 menit). Untuk lampu W tiap
menit, WS502 perlu melapor tiap 1 menit. Flow hanya membaca cache dan tidak
mempercepat sensor. Tidak ada perintah perubahan interval, ON/OFF, IR atau LoRa downlink
dalam tambahan ini. Jika memakai Source ID selain `ug65-ussc`, sesuaikan field
source_id di kedua Function tambahan dan `SMART_OFFICE_SOURCE_ID` backend.

Snapshot 10 menit, Wh/grafik/Excel, environment, dan kontrol tetap berjalan
seperti sebelumnya. Feed power tidak menulis MySQL atau mengubah umur pengukuran.
Packet lebih dari 150 detik dan pembacaan meter lebih dari 3 menit tidak dianggap
daya terbaru. Website tetap menampilkan nilai daya terakhir dengan penanda data
sebelumnya dan timestamp asli. Nilai nol dibedakan dari data hilang.

**Perbaikan 30 Oktober 2026:** Function **Daya W: baca cache meter** tidak lagi
mengosongkan W setelah 3 menit. Nilai tetap dikirim dengan waktu observasi asli;
usia 3 menit hanya menjadi penanda kesegaran pada website. Backend menyimpan
nilai per EUI: pembaruan satu AC tidak menghapus nilai AC lainnya yang belum
melapor. Observasi nol baru dari meter yang sama tetap mengganti nilai lamanya.
Untuk instalasi aktif cukup ganti isi Function menggunakan
`../ac-interval-energy/UG65_Publish_counter_10menit.txt` dan restart backend
setelah menerapkan kode terbaru. Mini PC, key, dan `.env` tidak perlu diubah.

JSON lengkap khusus pengguna disediakan terpisah karena memuat key asli dari
export. Untuk sistem yang sudah aktif, fragment tambahan di atas menghindari
penggantian tab dan reset timer. Jangan import fragment dua kali.

Untuk konfigurasi interval melalui downlink: dokumentasi WS50x dan WS52x
menetapkan Report Interval sebagai channel `ff`, type `03`, UINT16 little-endian
dalam detik. Nilai 60 detik menghasilkan payload HEX **`ff033c00`**, default
application port **85**. Kirim hanya ke delapan meter AC/lampu yang dipakai
website bila memang ingin mengubah interval; instalasi AC sekarang tetap 10 menit.
Ini mengubah interval laporan; bukan perintah ON/OFF atau reset counter energi.
Sesuaikan port jika perangkat Anda telah dikonfigurasi berbeda dan verifikasi
uplink berisi daya baru tiap menit. Paket tidak mengirim downlink ini otomatis.

Referensi: [WS50x Downlink](https://www.milesight.com/products/docs/en/ws50x/protocol/ws5xx/ws50x-downlink.html)
dan [WS52x Downlink](https://www.milesight.com/products/docs/en/ws52x/protocol/ws5xx/ws52x-downlink.html).

Lihat [SMART_OFFICE.md](../../SMART_OFFICE.md) untuk detail backend dan kualitas data.
