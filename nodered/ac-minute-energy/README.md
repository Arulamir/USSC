# Energi AC pada interval satu menit terbaru

Kartu AC di dashboard dan Smart Office memakai `ac_minute_wh`, bukan
`active_power`. Nilainya adalah selisih `power_consumption` (Wh) pada interval
60 detik terbaru yang tersedia untuk empat meter AC. Meter atas pintu dikecualikan.
Ini bukan counter kumulatif atau total harian. Daya lampu tetap W.

UG65 menyimpan paling banyak 16 observasi counter asli selama 10 menit hanya
untuk menghitung batas interval terbaru. Observasi lama tidak dijumlahkan ke
kartu. Publish tiap menit tidak memperbarui waktu observasi meter.
Backend memakai satu rentang waktu yang sama untuk meter yang tersedia,
berakhir pada waktu pembacaan terbaru bersama, bukan jam browser.
Interpolasi batas hanya antara observasi berjarak maksimal 90 detik dan diberi
metadata `estimated`; laporan 10 menit tidak diperkirakan menjadi data 1 menit.
Reset counter perlu pembacaan baru yang mencakup satu menit penuh. Meter
hilang/konflik dikecualikan, semua hilang menjadi null; nol asli tetap 0 Wh.
Umur pembacaan maksimum 3 menit, umur packet maksimum 150 detik seperti feed lama.

## Memperbarui sistem yang sudah memakai feed daya 1 menit

Cadangkan flow. Ganti **isi Function** berikut, pertahankan ID, wires, On Start,
dan broker yang sudah ada. Deploy **Modified Nodes**.

| Lokasi | Function / ID | Isi pengganti |
| --- | --- | --- |
| UG65 | Telemetry: simpan nilai actual+umur / `d953695374b19765` | `UG65_Telemetry_counter_1menit.txt` |
| UG65 | Daya W: baca cache meter / `a10e001000000002` | `UG65_Publish_counter_1menit.txt` |
| Mini PC | Daya W: cache terbaru tanpa SQL / `a10e002000000002` | `MiniPC_Cache_counter_1menit.txt` |

Collector ini sudah menyertakan monitoring occupancy `region_1` sebelumnya.
Untuk instalasi baru, fragment `../smart-office-power/` sudah memuat publisher
dan receiver terbaru, tetapi collector di atas juga harus diperbarui.
Jangan import fragment yang sama dua kali.

Reporting Interval WS523 harus 1 menit; tunggu setidaknya dua uplink counter
yang mencakup 60 detik. Setelah restart/history kosong, kartu sementara “—”.
Jika uplink hilang sehingga jarak pembacaan melebihi 90 detik, tunggu data baru.

Update backend/frontend lalu build dan restart layanan. `.env` tetap memakai
`SMART_OFFICE_POWER_URL=http://100.97.64.86:1880/office1/power` dan key lama.
Flow tidak mengirim ON/OFF atau menulis SQL. Snapshot, perhitungan energi
harian, grafik, Excel, dan jalur kontrol tidak diubah oleh fitur ini.

JSON lengkap privat disediakan di luar repo, karena berisi konfigurasi key
dari export pengguna. Untuk mempertahankan timer yang sedang berjalan, gunakan
penggantian isi tiga Function di atas.

Tes offline: `node nodered/ac-minute-energy/test.cjs` dan tes backend
`backend/tests/test_office_minute_energy.py`.
