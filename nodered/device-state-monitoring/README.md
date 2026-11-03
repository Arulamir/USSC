# Status perangkat untuk sakelar geser Smart Office

Tambahan ini hanya membaca laporan, tanpa mengirim perintah IR, ON/OFF, LoRa
downlink, atau mengubah automasi pintu/lampu/AC. Tidak mengganti full flow.

## Pemasangan UG65

1. Export cadangan tab automasi_system yang sedang berjalan.
2. Import `UG65_tambahan_status_relay.json` ke **current flow automasi_system**.
   Tiga node baru sudah tersambung; pilih broker MQTT lama yang sama dengan
   feed daya (`192.168.137.1:1883` dari sisi UG65).
3. Tambahkan satu kabel dari output **Decoder WS502** ke Function baru
   **Status relay: baca laporan WS502**. Pertahankan seluruh kabel lama.
   Jangan mengambil input dari Function `WS502: daya_sum + energi_sum`, karena
   outputnya sudah tidak mengandung `switch_1` / `switch_2`.
4. Deploy Modified Nodes. Tidak perlu mengubah Function pintu, timer, validator,
   decoder, collector daya, atau kontrol.

Publisher menerima `switch_1` dan `switch_2` dari uplink WS502. Status hanya
diperbarui jika kanal tersebut dilaporkan. Publish tiap 60 detik tidak
memperbarui waktu observasi asli. Nilai W dan pesan perintah tidak menentukan
status relay. Semua kontrol saat ini memakai payload 0833ff/0830ff untuk kedua
kanal, sehingga grup ON/OFF harus didukung laporan kedua kanal setiap meter.

## Pemasangan mini PC

1. Import `MiniPC_tambahan_status_perangkat.json` ke **current flow Office1
   kontrol web**, agar memakai environment `OFFICE_CONTROL_KEY` dan context
   store RAM `telemetryRuntime` yang sudah ada.
2. Pada tiga MQTT In baru, pilih broker lama yang sama dengan kontrol/daya.
3. Deploy Modified Nodes. Tidak perlu mengubah jalur kontrol/ACK lama atau
   mengimpor ulang tab MinMoe.

Input MQTT:

- `office1/monitoring/relays`: laporan relay WS502 dari UG65.
- `stat/ussc/#`: hanya `stat/ussc/RESULT` dan `stat/ussc/IRHVAC` dengan objek
  `IRHVAC` Vendor DAIKIN serta Power On/Off yang digunakan.
- `tele/ussc/#`: hanya `tele/ussc/RESULT` dengan `IrReceived.IRHVAC` Vendor
  DAIKIN, serta LWT Online/Offline. Field POWER milik relay Tasmota diabaikan.

Jika Topic/FullTopic Tasmota berbeda, sesuaikan topic MQTT dan filter Function.
Incoming retained IR tanpa waktu observasi aslinya diabaikan agar tidak tampak
sebagai laporan baru. Packet relay mempertahankan waktu observasi UG65. Pembacaan status menerima
selisih jam ke depan maksimal tiga menit; waktu asli tetap ditampilkan. Ini
tidak mengubah TTL atau validasi perintah ON/OFF yang sudah ada.

Endpoint privat baru **GET `/office1/state`** memakai key dan pembatasan sumber
yang sama dengan `/office1/power` (server 100.86.6.76 dan loopback). Tidak
menyimpan key di browser, node tambahan, atau file publik. Cache berada di RAM;
setelah restart Node-RED, status menunggu laporan baru. Tidak mengirim perintah
untuk menebak atau menginisialisasi ON/OFF.

## Website/backend

- Terapkan source terbaru, restart backend, build/restart frontend.
- Tidak perlu variabel `.env` baru. Backend mengambil host/port dari
  `SMART_OFFICE_CONTROL_URL` yang sudah divalidasi, mengganti hanya path
  menjadi `/office1/state`, dan memakai `OFFICE_CONTROL_KEY` lama.
- Browser yang sudah membuka akses operator membaca
  **GET `/api/smart-office/control/states`** setiap 5 detik dan saat kembali
  fokus/online. Reload tidak mengirim ON/OFF. Posisi tidak disimpan sebagai
  tebakan di localStorage dan tidak didasarkan pada ACK pengiriman.
- Status pertama menunggu laporan WS502 yang mengandung switch_1/switch_2 dan
  laporan IR Tasmota. Jika belum tersedia, posisi netral; bukan default ON/OFF.
- ON hijau, OFF merah. Perangkat/grup campuran memakai posisi netral. Jika ada
  kanal yang belum diketahui, grup juga belum diketahui; jangan menganggap
  kanal yang hilang sebagai OFF. Perubahan otomatis ikut terbaca karena jalur
  ini mendengar laporan perangkat, tidak hanya tombol website.
- Klik/tap **ON di kiri** untuk penanda hijau, atau **OFF di kanan** untuk
  penanda merah. Penanda bergerak saat mengirim; setelah ACK diterima, pilihan
  tetap terlihat dengan keterangan menunggu laporan. Laporan lama tidak
  mengembalikan posisi pilihan. Laporan dengan waktu observasi sejak perintah
  dikirim kembali menentukan posisi berdasarkan status yang dilaporkan.
- Geser kiri/kanan, panah kiri/kanan, Home/End, serta Enter/Space juga tersedia.
  Geseran pendek atau gesture dibatalkan tidak mengirim perintah; satu gesture
  tidak mengirim dua kali. Selama mengirim, kontrol dikunci sementara.
- ACK hanya berarti UG65 menerima perintah. Jika perintah ditolak atau balasan
  tidak dapat dipastikan, pilihan kembali ke posisi sebelumnya. Timeout tidak
  mengirim ulang otomatis. Laporan lama tetap disertai waktu aslinya dan penanda.

Status lampu adalah laporan relay perangkat, bukan bukti semua bohlam menyala.
Status AC diberi label **IR Tasmota — kondisi AC belum dikonfirmasi**, sesuai
pilihan pengguna. IR transmitter tidak membuktikan AC menerima sinyal. Remote
fisik bisa ikut terbaca hanya jika pengendali mempunyai receiver IR dan
protokolnya terdekode. POWER milik Tasmota sendiri bukan status AC IR.

## Perintah Tasmota yang diteliti

Di **Console Tasmota**, `Power` tanpa parameter membaca relay pengendali jika
relay tersedia; `Status 11` membaca keadaan umum Tasmota. Keduanya bukan query
universal untuk kondisi fisik AC yang dikendalikan lewat IR.

Untuk state IR, tambahan ini membaca balasan `IRHVAC.Power` dari topic RESULT
dan, bila ada penerima IR, `IrReceived.IRHVAC.Power`. Tidak menerbitkan command
IRHVAC hanya untuk membaca status. Pada driver IR penuh yang diteliti,
IRHVAC tanpa payload bukan pembacaan state tersimpan. StateMode=SendStore
menyimpan state pengiriman, sedangkan StoreOnly memperbarui state tersimpan;
tidak digunakan otomatis dalam patch ini dan bukan bukti fisik AC.

Referensi primer:
[Tasmota IR](https://tasmota.github.io/docs/Tasmota-IR/),
[Commands](https://tasmota.github.io/docs/Commands/),
[MQTT](https://tasmota.github.io/docs/MQTT/),
[source driver IR](https://github.com/arendst/Tasmota/blob/development/tasmota/tasmota_xdrv_driver/xdrv_05_irremote_full.ino).

## Pengujian

`node nodered/device-state-monitoring/test.cjs` dan
`python -m unittest backend.tests.test_office_state` memeriksa laporan aktual,
dua kanal, grup campuran, waktu asli, invalid/retained/future, autentikasi, dan
perbedaan relay vs IR. QA browser lokal memeriksa klik/tap ON-OFF, satu command
per geseran, pembatalan gesture, pilihan setelah ACK, laporan otomatis, nol
command saat GET, penolakan/timeout tanpa retry, keyboard, tema terang/gelap,
dan ponsel. Semua memakai fixture; tidak ada
perintah perangkat nyata dikirim saat pengembangan.
