"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../../../lib/api";
import type { SmartOfficeSnapshot } from "../../../lib/smart-office";
import "./smart-office.css";

function formatValue(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("id-ID", { maximumFractionDigits: 1 })} ${unit}`;
}

function formatTime(timestamp: string | undefined) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta",
  })} WIB`;
}

export default function SmartOfficeMonitoring() {
  const [data, setData] = useState<SmartOfficeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;

    const refresh = async () => {
      controller = new AbortController();
      try {
        const response = await ApiService.getSmartOffice(controller.signal);
        if (!cancelled) {
          setData(response.data);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(refresh, 60_000);
        }
      }
    };

    refresh();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const updatedAt = formatTime(data?.sampled_at_utc);
  const status = loading ? "Memuat data..."
    : failed ? "Koneksi terputus"
    : !data ? "Belum ada data"
    : data.stale ? "Data terlambat"
    : `Snapshot ${data.interval_minutes} menit`;
  const metrics = [
    { label: "Daya AC", icon: "bi-snow", value: formatValue(data?.ac_power_w, "W") },
    { label: "Daya Lampu", icon: "bi-lightbulb", value: formatValue(data?.lamp_power_w, "W") },
    { label: "Status Occupancy", icon: "bi-people", value: data?.occupancy === "occupied" ? "Terisi"
      : data?.occupancy === "vacant" ? "Kosong" : "—" },
    { label: "Suhu", icon: "bi-thermometer-half", value: formatValue(data?.temperature_c, "°C") },
    { label: "Kelembapan", icon: "bi-droplet", value: formatValue(data?.humidity_pct, "%") },
    { label: "Illumination", icon: "bi-brightness-high", value: data?.illumination === "bright" ? "Terang"
      : data?.illumination === "dim" ? "Redup" : "—" },
  ];

  return (
    <section className="smart-office-section" aria-labelledby="smart-office-title">
      <div className="section-title smart-office-heading">
        <h3 id="smart-office-title">Smart Office Monitoring</h3>
        <span role="status">{status}</span>
      </div>
      <div className="location-card smart-office-panel" aria-busy={loading}>
        <div className="smart-office-grid">
          {metrics.map((metric) => (
            <div className="smart-office-metric" key={metric.label}>
              <div className="summary-icon green" aria-hidden="true">
                <i className={`bi ${metric.icon}`} />
              </div>
              <div className="smart-office-reading">
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
            </div>
          ))}
        </div>
        <p className="smart-office-updated">
          <i className="bi bi-clock-history" aria-hidden="true" />
          {updatedAt ? `Data terakhir: ${updatedAt}` : "Menunggu data Smart Office"}
          {failed && (data ? " · Menampilkan data terakhir yang berhasil dimuat."
            : " · Data belum dapat dimuat.")}
          {!failed && data?.stale && " · Belum ada snapshot terbaru."}
        </p>
      </div>
    </section>
  );
}
