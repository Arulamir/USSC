# Pintu region_1: 1 jam, CLOSE 2 menit, ulang 2 jam

Aturan ini menggantikan siklus pintu 120 menit lama. Lampu/AC memakai timer
terpisah. Sumber occupancy keduanya adalah VS321 `24E124443F431957` **region_1**;
people count dan gabungan region tidak menentukan keputusan.

## Pintu

1. Tap valid memulai siklus dan meneruskan `accepted_tap` melalui jalur lampu/AC
   yang sudah ada. Tap berulang saat siklus aktif tidak mereset waktu.
2. Kirim `alwaysOpen`. Setelah ACK ISAPI diterima, mulai 60 menit. Laporan vacant
   pada satu jam pertama tidak menghentikan periode ini, sesuai pilihan pengguna.
3. Setelah 60 menit, kirim `close` terlebih dahulu. Jika vacant, siklus berakhir
   sesudah ACK. Jika occupied/unknown, ACK close memulai jeda dua menit.
4. Sesudah jeda: occupied yang masih valid mengirim `alwaysOpen` untuk maksimal
   120 menit; vacant menyelesaikan siklus tanpa membuka lagi; unknown/stale
   tetap menunggu laporan region_1 baru, tanpa meminta unlock.
5. Selama periode tambahan, vacant baru langsung mengirim close dan mengakhiri
   siklus. Jika 120 menit habis saat occupied, lakukan close dua menit lalu cek
   lagi; siklus ini berulang selama occupied.
6. CLOSE manual tetap tersedia dan mengakhiri siklus. ACK gagal/timeout
   menghasilkan status `fault`, tidak membuka ulang dan tidak retry otomatis.

`close` adalah permintaan penguncian biasa, **bukan `alwaysClose`**. Jeda dua
menit berarti flow tidak mempertahankan mode free access selama dua menit;
kartu yang sah atau exit button masih dapat memicu pembukaan sesaat sesuai
pengaturan MinMoe. Flow tidak mengubah pengaturan exit button dan tidak
mengirim perintah `alwaysClose`.

ACK adalah penerimaan perintah oleh MinMoe, bukan bukti fisik magnet menahan
pintu atau daun pintu sudah tertutup. Timer dimulai dari ACK, bukan dari door
contact. Kondisi fisik dan fungsi exit button tetap perlu dicek onsite.

## Lampu utama A/B dan AC

Tap menyalakan lewat Function/MQTT/LoRa lama. Periode awal 10 jam tetap.
Sesudah 10 jam, region_1 occupied memperpanjang 120 menit; vacant mematikan
lampu A/B dan AC melalui Function HVAC/MQTT lama. Sesudah evaluasi 10 jam
pertama, laporan vacant baru pada periode tambahan langsung OFF, tanpa harus
menunggu sisa 120 menit. Unknown menunggu laporan valid. Jeda web 60 menit dan
jalur manual dipertahankan. WS523 tetap hanya meter.

## Perubahan node UG65

ID berikut mengikuti ekspor terakhir pengguna (tab `4e88b253dca29971`). Patch
tidak boleh dijalankan sebagai salinan paralel dari node aktif.

| Node yang sudah ada | Perubahan |
| --- | --- |
| Pintu: satu siklus 120 menit (`a2971f6c9ccd8043`) | Isi `Timer_pintu_region1.txt`; output tetap lima |
| VS321: simpan + occupancy aktual (`0f726f15fca00761`) | Isi `VS321_sumber_region1.txt`; dua output dan kabel lama tetap |
| OPEN/CLOSE: JSON satu baris (`0389cefc495868e6`) | Isi `Bridge_kirim_door_command.txt`; protocol TCP tetap sama |
| Pintu: periksa balasan mini PC (`eb407415d4abc81b`) | Isi `Bridge_balasan_door_command.txt`; output pertama ke Debug lama **dan input Function pintu** |
| Pintu: tunggu 120 menit (`294e39ca0a98cb66`) | Aktifkan override delay dengan `msg.delay`; jangan extend; default 60 menit |
| Utama: lampu A/B + AC 10 jam (`d24b9627054d4094`) | Isi `../ac-main-timer/Timer_utama_lampu_AC.txt`; delapan output tetap |
| Utama: 10 jam / ulang 35 menit (`bba243a50b2f7d03`) | Nama diperbarui ke 120 menit; konfigurasi delay dinamis lama tetap |
| Daya W: baca cache meter (`93dde0bc8c83e852`) | Publisher terakhir per meter tetap disertakan; tidak mengosongkan W setelah tiga menit |

Output pertama periksa-balasan membawa identitas siklus dari cache pending
lokal. Respons terlambat atau milik siklus lain tidak boleh mereset timer baru.
Output kedua tetap menuju pembatalan timeout. Isi On Start/On Stop, broker,
key, semua jalur ON/OFF lampu/AC dan output lainnya dipertahankan.

Untuk instalasi aktif, cadangkan/export tab saat ini lalu ganti node-nya **di
tempat**, pertahankan ID dan kabel di luar daftar perubahan. Tidak perlu
mengimpor full flow lama di atas perubahan lain yang sudah dibuat pengguna.
Mengganti Function timer menjalankan On Start lama dan mereset siklus aktif;
itu tidak otomatis memulihkan kondisi fisik pintu. Sesudah pemulihan manual,
tap baru memulai siklus baru. Deploy Modified Nodes setelah seluruh perubahan
dan sambungan ACK selesai.

Full JSON privat yang disediakan di luar repo adalah referensi 110 node dari
ekspor UG65 terakhir, ditambah toleransi jam kontrol tiga menit dan publisher W
terbaru. File itu berisi key asli; jangan push atau bagikan publik. Mini PC
tidak perlu diubah karena pesan `door_command`/`door_result` tetap kompatibel.

## Mengembalikan pintu ke normal tanpa menulis perintah ISAPI sendiri

1. Nonaktifkan sementara node **Payload alwaysOpen** di UG65 dan Deploy
   Modified Nodes, agar automasi tidak meminta free access lagi saat pemulihan.
2. Jika tersedia iVMS-4200: **Monitoring → pilih pintu → Lock / Close Door**.
   Pilih penguncian biasa, bukan Remain Locked/Remain Closed. Ini memakai UI
   client Hikvision, bukan perintah ISAPI yang diketik sendiri.
3. Minta orang onsite memeriksa magnet menahan pintu, kartu tetap membuka
   sesaat, dan exit button tetap bisa membuka. Jika tetap terbuka, periksa
   balasan kontrol, jadwal remain-open/first-person, serta relay/power/kontak
   tombol dengan petugas; jangan menganggap label door contact adalah status lock.
4. Setelah pemulihan dan pemasangan aturan baru, aktifkan kembali jalur OPEN
   dan gunakan tap baru untuk memulai pengujian yang terpantau.

Tidak perlu factory reset, menghapus kartu, atau mengubah tipe NO/NC tanpa
memeriksa pengkabelan yang sebenarnya.

Sumber UI: [Panduan iVMS-4200, Control Door Status](https://www.hikvision.com/content/dam/hikvision/en/support/download/vms/ivms4200-series/user-manual/UD15309B_iVMS-4200%20AC%20Client%20Software_User%20Manual_1.0.1_20190712.PDF).

## Verifikasi offline

`node nodered/door-cycle-region1/test.cjs` dan
`node nodered/ac-main-timer/test.cjs` menjalankan Function aktual dengan jam dan
balasan tiruan. Uji tidak membuka koneksi, tidak mengirim MQTT/ISAPI atau
menggerakkan lock. Keberhasilan onsite belum dibuktikan.
