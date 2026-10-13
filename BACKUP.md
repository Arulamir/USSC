# Backup USSC — 13 Oktober 2026

Snapshot kode dari `/home/cctvpro/USSC`, disiapkan untuk
`https://github.com/Arulamir/USSC`.

## Isi backup

Kode frontend Next.js, admin kamera Next.js, backend Flask, integrasi
MediaMTX/Dahua DSS, aset statis, lockfile npm, dan template konfigurasi.
File LICENSE dan riwayat awal repository tujuan tetap dipertahankan.

Snapshot ini disiapkan dalam worktree terpisah. Source dan konfigurasi
aplikasi yang sedang berjalan di server tidak diubah atau direstart.
Nilai token dan password yang tertulis di source diganti dengan pembacaan
variabel lingkungan dalam salinan backup saja.

## Yang harus disimpan terpisah secara privat

- File `.env` di root, frontend, admin-cam, dan mediamtx.
- Token AirGradient dan kredensial lain yang masih tertulis di kode asli
  server: backup ini menghapus nilai default tersebut. Lengkapi variabel
  di `.env.example`, termasuk AIRGRADIENT_TOKEN, DSS_PASSWORD,
  MEDIAMTX_PASSWORD, MEDIAMTX_VIEWER_PASSWORD, dan SECRET_KEY.
- Konfigurasi `mediamtx/mediamtx.yml` yang berisi password asli.
- Database SQL/SQLite, dump data, kunci privat, konfigurasi Nginx,
  konfigurasi PM2 dan tunnel, serta layanan di luar folder USSC.

Dependencies, virtualenv Python, hasil build Next.js, cache runtime,
arsip frontend, file salinan lama, dan hasil ekspor device tree
dikecualikan. File-file tersebut dapat berukuran besar atau berisi
data/kredensial runtime.

Backup GitHub ini adalah backup kode; belum cukup untuk memulihkan
seluruh layanan tanpa data dan konfigurasi privat di atas.

## Pemulihan

1. Clone repository. Salin `.env.example` menjadi `.env` dan isi nilai
   privat dari server atau penyimpanan rahasia. Lakukan hal yang sama
   untuk template frontend, admin-cam, dan mediamtx sesuai kebutuhan.
   Isi SECRET_KEY dengan nilai privat yang kuat. Jangan upload `.env`.
2. Buat virtualenv dan install dependency backend:

   ```bash
   python3 -m venv ussc_venv
   ussc_venv/bin/pip install -r backend/requirements.txt
   ```

3. Siapkan database dan pulihkan data dari backup database terpisah.
   Jalankan backend dari root proyek dengan `ussc_venv/bin/python3 -m backend.app`.
4. Di frontend, jalankan `npm ci`, `npm run build`, dan `npm start`.
   Ulangi untuk admin-cam jika layanan tersebut diperlukan.
5. Untuk MediaMTX, salin `mediamtx/mediamtx.yml.example` menjadi
   `mediamtx/mediamtx.yml`, isi password API dan viewer, serta sesuaikan
   alamat jaringan. Samakan password tersebut dengan MEDIAMTX_PASSWORD
   dan MEDIAMTX_VIEWER_PASSWORD sebelum menjalankan Docker Compose.
   Ekspor variabel dari `.env` yang sesuai untuk layanan MediaMTX:
   modul `mediamtx_client.py` membaca environment proses.
6. Pulihkan Nginx, PM2, tunnel, dan konfigurasi layanan sesuai server.
   Nginx situs USSC saat snapshot meneruskan `/` ke port 3000
   dan `/api/` ke port 5000.

## Upload dari server setelah autentikasi Git tersedia

Jalankan dari worktree backup, bukan dari source live yang masih
memuat nilai default kredensial:

```bash
git -C /home/cctvpro/ussc-github-backup-20261013 push origin HEAD:main
```

Push normal mempertahankan riwayat remote. Jika branch main berubah
sebelum upload, periksa perubahan remote terlebih dahulu; jangan force-push.

## Pemeriksaan snapshot

- Pemindaian Gitleaks dan pencarian nilai kredensial asli dalam source: lulus.
- Sintaks 47 modul Python: lulus. `backend/database/model.py` berisi
  catatan struktur direktori, bukan modul Python; file asli dipertahankan.
- Aplikasi tidak dibuild atau direstart karena perubahan hanya dilakukan
  pada salinan backup. Konfigurasi privat wajib dilengkapi sebelum restore.
