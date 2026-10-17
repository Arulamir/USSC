# Automasi AC mengikuti timer lampu Ruang Utama A+B

Sesuai permintaan pengguna, AC mendapat keputusan otomatis OFF dari siklus
yang sama dengan lampu utama. Sumber occupancy adalah VS321 region_1, bukan
people count atau gabungan area. Perubahan ini tidak menggunakan WS523 untuk
menyalakan atau mematikan AC. WS523 tetap hanya monitoring.

## Perilaku

1. Tap yang diterima mengikuti jalur lama: Function pintu mengirim accepted_tap
   ke timer lampu dan Function HVAC. Function HVAC lama menghasilkan payload
   DAIKIN Power On ke MQTT cmnd/ussc/IRHVAC, dengan pengaturan lama Cool 24 C.
2. Timer lampu Ruang Utama A/B tetap 10 jam. Tap berulang tidak mereset deadline.
3. Pada akhir timer, region_1 vacant mematikan lampu A+B dan mengirim Power Off
   melalui Function HVAC yang sama dan node MQTT yang sama.
4. Region_1 occupied mempertahankan keadaan ON dan memperpanjang 35 menit;
   pemeriksaan yang sama diulang sampai vacant. Tidak perlu mengirim ulang ON
   pada setiap pemeriksaan occupied.
5. Region_1 tidak tersedia, tidak valid, atau kedaluwarsa membuat timer menunggu
   laporan baru; tidak dianggap vacant dan tidak diganti nilai people count.

## Perubahan flow

- ID Function timer c26b6e8123f41b6d dipertahankan, dengan nama baru
  **Utama: lampu A/B + AC 10 jam** dan delapan output.
- Output 1..7 lama dipertahankan persis. Output 7 tetap menuju Dispatch kontrol
  web. Output 8 baru menuju Function HVAC ID 8ce39f78a70667df.
- Function HVAC diberi nama **HVAC: ON tap / OFF manual atau timer utama**.
  Isi Function, output ke MQTT, topic, broker, serta parameter IR tidak diubah.
- Output 8 hanya menghasilkan perintah saat keputusan vacant otomatis.
  Jalur ON tap tetap jalur lama sehingga tidak menambah perintah ON ganda.
- Source region_1 lampu, aturan pintu, manual ON/OFF, tombol website, flow
  telemetry, database, dan daya 1 menit dipertahankan.

Manual AC/website tetap memakai jalur langsung yang sudah ada; fitur ini tidak
membuat override AC terpisah. Jeda 60 menit dari kontrol lampu website tetap
menjeda timer bersama. Karena evaluasi AC mengikuti timer yang sama, waktu
evaluasi OFF otomatis AC ikut tertunda jika timer bersama dijeda. OFF utama
manual lokal tetap membatalkan timer lampu sesuai flow lama; OFF SEMUA dan
kontrol AC manual tetap lewat jalur AC yang sebelumnya tersedia.

## Pemasangan

Gunakan JSON lengkap terbaru khusus pengguna:
**UG65_lengkap_AC_lampu_10jam_region1.json** di folder output percakapan. File
ini sudah mencakup monitoring website region_1, timer region_1, daya 1 menit,
kontrol web, serta seluruh flow automasi_system terbaru.

1. Export cadangan tab automasi_system yang sedang dipakai.
2. Hapus tab automasi_system lama dari editor TANPA Deploy dahulu.
3. Import JSON lengkap pengganti. Pastikan hanya satu automasi_system aktif
   dan konfigurasi broker MQTT lama tetap sesuai.
4. Setelah flow lengkap tersedia, klik Deploy. Penggantian tab/Function timer
   mereset siklus timer yang sedang aktif. Mini PC dan website tidak perlu
   perubahan tambahan untuk automasi AC ini.

File lengkap berisi key privat dan tidak disimpan di repo. File patch tanpa
key dalam folder ini adalah referensi perubahan node, bukan flow lengkap;
jangan mengimpornya sebagai salinan paralel dari Function timer lama.

## Verifikasi

Jalankan `node nodered/ac-main-timer/test.cjs`. Simulasi mempercepat jam di RAM
pengujian saja: ON tap -> DAIKIN MQTT, 10 jam + occupied -> 35 menit, vacant ->
OFF lampu dan DAIKIN MQTT OFF, stale -> menunggu, serta preservasi jeda web dan
jalur manual. Tidak ada perintah MQTT/LoRa/IR nyata dikirim saat pengembangan.
Pengiriman MQTT berarti perintah diteruskan, bukan bukti keadaan fisik AC.
