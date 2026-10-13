import MainLayout from "../components/layout/MainLayout";

export default function ReportsPage() {
  return (
    <MainLayout>
      <div style={{ padding: "20px 30px" }}>

        {/* =================================================
             PAGE HEADING
        ================================================== */}
        <div className="page-heading">
          <div>
            <span className="eyebrow">DATABASE &amp; DATA ARCHIVE</span>
            <h2>Riwayat &amp; Ekspor Data Kampus</h2>
            <p>Pilih tanggal tertentu untuk memeriksa riwayat data atau mengunduh arsip laporan (CSV / ZIP) untuk ketiga proyek USSC.</p>
          </div>
        </div>

        <p className="mt-2 text-slate-500">
          Halaman ini sedang dalam pengembangan.
        </p>
      </div>
    </MainLayout>
  );
}
