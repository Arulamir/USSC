# Energi AC pada dua laporan 10 menit terbaru

WS523 AC pada instalasi ini mengirim setiap 10 menit dan intervalnya tidak
dapat diubah. Kartu **Energi AC (Wh)** memakai periode **10 menit**, yaitu selisih dua counter
`power_consumption` terbaru per meter, kemudian menjumlahkan meter AC yang valid.
Tidak memakai `active_power`, tidak dibagi sepuluh, tidak diinterpolasi, dan
tidak menjumlahkan seluruh pemakaian sebelumnya. Meter ATAS_PINTU dikecualikan.
Energi harian, grafik, Excel, snapshot database, dan kontrol tetap memakai jalur lama.

Counter disimpan maksimal 16 observasi selama 45 menit agar laporan sebelumnya
tidak hilang saat jarak antar-uplink sekitar 10 menit. Waktu observasi asli
dipertahankan. Selisih terakhir berlaku sampai laporan berikutnya, maksimal
15 menit sejak pembacaan akhir. Reset, konflik, dan data hilang tidak menjadi nol.
Nol asli tetap 0 Wh. Dua laporan harus berjarak 10 menit dengan toleransi
90 detik untuk variasi penerimaan radio; jika satu laporan hilang sehingga
jaraknya sekitar 20 menit, meter dikecualikan sampai pasangan berikutnya valid.

Metadata `ac_interval_quality.intervals` mencatat waktu awal/akhir dan durasi
aktual tiap meter. Waktu yang ditampilkan adalah pembacaan akhir tertua di
antara meter yang dijumlahkan. Meter tidak harus mengirim pada detik yang sama.

## Memperbarui UG65 yang sudah memakai flow sebelumnya

Cadangkan flow, lalu ganti isi dua Function berikut. Pertahankan On Start dan
semua jalur automasi yang ada:

| Function / ID | Isi pengganti |
| --- | --- |
| Telemetry: simpan nilai actual+umur / `d953695374b19765` | `UG65_Telemetry_counter_10menit.txt` |
| Daya W: baca cache meter / `a10e001000000002` | `UG65_Publish_counter_10menit.txt` |

Hubungkan output Function Telemetry tersebut ke input Function Daya W: baca
cache meter. Dengan demikian laporan counter AC langsung diteruskan ke MQTT,
tanpa menunggu Inject 60 detik. Inject lama tetap menjadi pengiriman berkala.
Deploy **Modified Nodes**. Kedua Function hanya mengubah monitoring; tidak
mengirim ON/OFF, downlink, SQL, atau mengubah timer HVAC/lampu.

Mini PC yang sudah memakai flow counter sebelumnya tidak perlu diubah lagi.
Format `office_power` versi 1, `energy_points`, endpoint `/office1/power`,
key, source ID, dan batas packet 32 KB tetap sama. File cache Mini PC di folder
ini hanya untuk referensi instalasi baru. `.env` backend tidak berubah.

Backend/frontend perlu diperbarui dan di-restart/build bersamaan. Browser
memeriksa setiap 15 detik saat tab aktif; angka AC berubah ketika meter mengirim,
bukan setiap kali browser memeriksa. Setelah history kosong, tunggu dua laporan
WS523 yang valid. Snapshot/Wh harian dan VS321 region_1 tetap dipertahankan.

JSON lengkap privat UG65 disediakan di luar repo karena menyertakan key export.
Untuk mempertahankan timer yang berjalan, gunakan penggantian dua Function dan
satu sambungan di atas, bukan mengganti seluruh tab.

Tes offline: `node nodered/ac-interval-energy/test.cjs` dan
`backend/tests/test_office_interval_energy.py`.
