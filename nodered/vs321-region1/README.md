# Occupancy monitoring website dari region_1 VS321

Website sudah membaca kolom occupancy dari snapshot database, tanpa menghitung
jumlah orang sendiri. Perbaikan ini mengubah pengisian kolom tersebut pada
cabang monitoring Node-RED agar sesuai flow lama pengguna:

- region_1 = occupied -> occupancy = occupied -> website Terisi.
- region_1 = vacant -> occupancy = vacant -> website Kosong.
- region_1 eksplisit tidak dikenal -> data occupancy dihapus/unknown, bukan Kosong.
- Packet tanpa region_1 tidak memperbarui nilai atau timestamp occupancy.
- people_total_counts, region lain, dan occupancy hasil inferensi di node
  sebelumnya tidak dipakai untuk monitoring website.

## Pemasangan tanpa mengganti tab

Di UG65, cadangkan flow, lalu ganti hanya isi Function pada dua node:

1. **Telemetry: simpan nilai aktual + umur**:
   gunakan `VS321_Telemetry_region1.txt`.
2. **VS321: occupancy, suhu, humidity, illumination**:
   gunakan `VS321_Debug_status_sensor.txt`.

Pertahankan nama/ID, On Start/On Stop, output, dan semua kabel. Deploy
**Modified Nodes**. Tidak perlu mengganti decoder, mini PC, database, backend,
frontend, atau Function timer untuk perbaikan sumber occupancy ini.

Kedua Function di atas memperbaiki monitoring saja. Untuk automasi lampu setelah
10 jam, pasang perbaikan tambahan pada bagian berikut. Function bersama
`VS321: simpan + occupancy aktual` tetap dipertahankan sebagai sumber pintu.

Tunggu uplink VS321 baru, lalu snapshot berikutnya (interval 10 menit) untuk
melihat perubahan di website. Baris database lama tidak dihitung ulang.
Nilai occupancy yang dahulu dihitung dari people count dibersihkan pada
packet VS321 pertama setelah pembaruan; occupancy menunggu status region_1 baru.

## Illumination

Bagian inti decoder yang diberikan pengguna sama dengan decoder flow saat ini:
0 = dim dan 1 = bright. Tidak ada aturan brightness berdasarkan people count,
occupancy atau daya lampu. Perbaikan ini tidak membalik label atau memaksa Redup.

Debug baru menampilkan `sensor_report.region_1`,
`sensor_report.illuminance_status`, `occupancy_at`, `illumination_at`, serta
`received_at`. Nilai cahaya yang tidak ada pada suatu packet tidak diperbarui
timestamp-nya; nilai lebih dari 30 menit ditampilkan null. Nilai eksplisit tidak
valid dibersihkan. Monitoring occupancy memakai batas umur 15 menit seperti
sebelumnya. Tanpa packet nyata, penyebab sensor terus mengirim bright belum
dapat dipastikan; periksa hasil Debug berikutnya.

## Pengujian

Jalankan `node nodered/vs321-region1/test.cjs` dari root repo. Simulasi lokal
tambahan juga membandingkan decoder pengguna dan decoder flow dengan packet
region_1 occupied + people count 0, serta illumination dim/bright, lalu meneruskan
hasil ke collector dan snapshot asli. Tidak ada perintah ke perangkat nyata.

JSON lengkap khusus pengguna disediakan di folder output percakapan, di luar
repo, karena memuat key kontrol. Mengganti seluruh tab dapat mereset timer dan
context RAM; pembaruan dua Function di atas menghindari penggantian timer.

## Automasi lampu setelah 10 jam: region_1 juga

Tambahan ini mengikuti permintaan pengguna untuk keputusan lampu saja:

- Node baru **VS321: region_1 untuk timer lampu** menerima output decoder VS321.
- Hanya `region_1: occupied/vacant` dari EUI VS321 yang ditentukan yang disimpan
  ke `flow.vs321_lights_region1`, dengan source `region_1` dan waktu penerimaan asli.
- Output node baru menuju Function timer lampu sebagai `occupancy_update`.
- Sambungan lama dari output 2 **VS321: simpan + occupancy aktual** ke timer
  lampu dilepas; sambungannya ke timer pintu tetap dipertahankan.
- Function timer lampu membaca cache khusus baru, tidak memakai cache bersama
  yang sebelumnya dapat dihitung dari people count atau gabungan area.

Setelah 10 jam: occupied memperpanjang 35 menit, vacant mematikan RUANG_UTAMA
A/B, dan data tidak tersedia/tidak valid/lebih tua dari 15 menit membuat sistem
menunggu status baru. Packet tanpa region_1 tidak memperbarui umur status.
Status invalid eksplisit menghapus cache region_1. EUI, batas umur yang sudah
dikonfigurasi, durasi timer, enam output lama, output 7 web, On Start/On Stop,
jeda web 60 menit, antrean, telemetry 10 menit dan daya W 1 menit dipertahankan.
Aturan dan sumber occupancy pintu tidak diubah.

`UG65_patch_automasi_region1_tanpa_key.json` memuat empat node terkait untuk
review/perubahan existing node; jangan import sebagai salinan node paralel.
Untuk pemasangan mudah, gunakan JSON lengkap terbaru dari folder output
percakapan: **UG65_lengkap_monitoring_dan_automasi_region1.json**. File ini sudah
mencakup dua perbaikan monitoring sebelumnya, wiring automasi baru, daya 1 menit,
serta kontrol web. Cadangkan lalu ganti tab automasi_system lama dengan satu tab
baru saja; jangan Deploy di antara penghapusan tab lama dan import penggantinya.
Mengganti Function timer/tab ini mereset timer yang sedang aktif. Mini PC dan
kode website tidak memerlukan perubahan tambahan untuk sumber occupancy ini.

Pengujian tambahan: `node nodered/vs321-region1/test-automation.cjs`.
