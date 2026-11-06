# Koreksi EUI WS523 dari ekspor pengguna 6 November 2026

Pemetaan sesuai Device Filter, Decoder WS523, dan switch Debug pada ekspor:

| Meter | EUI |
|---|---|
| Ruang Utama A | 24E124148060C6A0 |
| Ruang Utama B | 24E12414806031FC |
| Direktur (ID BU_DINI) | 24E124148060D73E |
| Magang | 24E1241480609B86 |
| Atas pintu | 24E1241480608D1A |

Yang berubah hanya Magang (sebelumnya 24E1241480609886) dan Atas Pintu
(sebelumnya 24E124148060801A). A, B, dan direktur sudah sama pada filter,
decoder, dan Debug; ketidaksesuaian nilai di ketiganya belum terbukti berasal
dari mapping. Nama Debug sendiri tidak membuktikan lokasi fisik meter.

## UG65

Cadangkan flow aktif. Gunakan patch empat node dengan ID lama, perbarui node
yang sama; jangan membuat salinan paralel. Keempatnya: collector telemetry,
snapshot, publisher daya, diagnostik counter. Kabel, On Start, dan bagian
lainnya dipertahankan. Full JSON di folder unduhan adalah salinan 113 node
lampiran pengguna dengan hanya empat Function itu diperbarui; dapat mengandung
key asli sehingga jangan upload full JSON ke GitHub atau membagikannya publik.

Deploy Modified Nodes. Tidak perlu mereset seluruh context atau menghapus
riwayat. Tunggu uplink asli EUI baru; cache EUI lama tidak disalin ke EUI baru
agar tidak mencampur counter yang belum terbukti berasal dari meter yang sama.

## Mini PC dan website

Ganti isi Function cache penerima topic office1/monitoring/power menggunakan
MiniPC_cache_daya_EUI_baru.txt. Ini bukan Function cache status relay/IR!
Pertahankan ID, tab, broker, dan kabel lama, lalu Deploy Modified Nodes.
Backend website juga memakai allowlist EUI: tarik source terbaru lalu restart
backend. Tidak ada perubahan .env atau build frontend untuk koreksi ini.

Sumber template monitoring pada repo ikut diselaraskan. Tidak ada migrasi SQL
atau penulisan ulang histori; histori lama yang memakai salah EUI perlu diaudit
tersendiri sebelum digabungkan. Atas pintu tetap tidak dihitung sebagai AC.

Verifikasi offline: node nodered/ws523-eui-correction/test.cjs menguji collector,
publisher dan snapshot; jika diberi path full JSON, ikut menguji jalur decoder,
penyimpanan global, daya_sum/energi_sum, dan switch Debug. Belum diuji pada
perangkat fisik dan tidak ada perintah ON/OFF yang dikirim oleh pengujian.
