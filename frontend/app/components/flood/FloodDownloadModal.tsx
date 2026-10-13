"use client";

import { useState } from "react";
import { ApiService } from "../../../lib/api";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  locationKey: "ketintang" | "lidah";
  locationName: string;
};

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

export default function FloodDownloadModal({
  isOpen, onClose, locationKey, locationName
}: Props) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const triggerDownload = (url: string) => {
    setLoading(true);
    window.location.href = url;
    setTimeout(() => { setLoading(false); onClose(); }, 1200);
  };

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  return (
    <div className="flood-modal-backdrop" onClick={onClose}>
      <div className="flood-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="flood-modal-header">
          <div className="flood-modal-title-group">
            <div className="flood-modal-icon"><i className="bi bi-file-earmark-spreadsheet-fill"></i></div>
            <div>
              <h3>Unduh Laporan Bulanan</h3>
              <p>Lokasi: <strong>{locationName}</strong></p>
            </div>
          </div>
          <button className="flood-modal-close" onClick={onClose}><i className="bi bi-x-lg"></i></button>
        </div>

        <div className="flood-modal-body">
          <div className="flood-tab-panel" style={{ marginTop: 0 }}>
            <div className="flood-option-info">
              <i className="bi bi-info-circle text-emerald-600"></i>
              <div>
                <strong>Rangkuman Telemetri Bulanan</strong>
                <p>Data diringkas rata-rata per jam (~720 baris per bulan), rapi dan siap dibuka di Microsoft Excel.</p>
              </div>
            </div>

            <div className="flood-form-row">
              <div className="flood-form-group">
                <label>Pilih Bulan:</label>
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="flood-form-select">
                  {MONTHS.map((name, i) => (<option key={i + 1} value={i + 1}>{name}</option>))}
                </select>
              </div>
              <div className="flood-form-group">
                <label>Pilih Tahun:</label>
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="flood-form-select">
                  {years.map((y) => (<option key={y} value={y}>{y}</option>))}
                </select>
              </div>
            </div>

            <button
              type="button"
              className="btn-download-primary"
              onClick={() => triggerDownload(ApiService.getFloodExportUrl(locationKey, "monthly", year, month))}
              disabled={loading}
              style={{
                width: "100%",
                marginTop: "12px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              <i className="bi bi-cloud-arrow-down-fill"></i>
              {loading ? "Menyiapkan File..." : `Unduh CSV (${MONTHS[month - 1]} ${year})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
