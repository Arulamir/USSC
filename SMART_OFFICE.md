# Smart Office Monitoring

Panel berada di bagian paling bawah Dashboard Utama, sebelum footer.
Panel mengikuti kartu, ikon hijau, dan tema terang/gelap dashboard yang ada;
CSS tambahan hanya berlaku pada panel baru.

## Data yang ditampilkan

- Daya AC dan lampu dalam **W**, dijumlahkan dari pembacaan `power_w`
  pada `device_samples` di snapshot terbaru `smart_office.office1`.
  Masing-masing menggunakan empat meter sesuai paket office1; meter
  `ATAS_PINTU` tidak masuk total AC.
- Occupancy: `occupied` → Terisi, `vacant` → Kosong.
- Suhu dalam °C dan kelembapan dalam %.
- Illumination: `bright` → Terang, `dim` → Redup. Sensor ini tidak memberikan lux.

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

Panel memeriksa endpoint setiap 60 detik; data sensor mengikuti interval
snapshot dari gateway (paket yang diberikan memakai 10 menit). Waktu data
ditampilkan dalam WIB. Snapshot lebih dari 30 menit atau bertanggal di masa
depan ditandai “Data terlambat”.
Jika koneksi gagal, panel memberi status “Koneksi terputus”; data terakhir
yang sudah berhasil dimuat tetap disertai waktu pembacaannya.

## Penerapan

Perubahan ini disiapkan pada salinan project lokal. Untuk menayangkannya di
website, terapkan file yang berubah, lengkapi konfigurasi database di server,
build frontend, lalu restart layanan frontend dan backend sesuai pengelola
proses yang digunakan. Tidak ada perubahan tabel atau flow Node-RED yang diperlukan.

Koneksi MariaDB dan pembacaan perangkat langsung perlu diverifikasi di
server yang memiliki akses ke `smart_office.office1`.

## Halaman Smart Office

Menu **Smart Office** berada di navigasi samping dan membuka `/smart-office`.
Ringkasan menampilkan daya AC/lampu (W) serta energi harian AC/lampu (Wh).
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
