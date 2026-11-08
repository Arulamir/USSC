"use client";

import { useEffect, useState } from "react";
import { ApiService } from "../../lib/api";

type Summary = {
  summary: string;
  mode: "qwen" | "calculated" | "no_data";
  stale: boolean;
  generated_at_utc: string;
  facts: {
    month: string; month_label: string;
    total_kwh: number | null; ac_kwh: number | null; lamp_kwh: number | null;
    emissions_kg_co2: number | null; emissions_t_co2: number | null;
    partial: boolean; in_progress: boolean;
    days_with_ac: number; days_with_lamp: number; elapsed_days: number;
    factor: { value: number; unit: string; reference_year: number; source_url: string };
  };
};

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta"}).formatToParts(new Date());
  return `${parts.find(p => p.type === "year")?.value}-${parts.find(p => p.type === "month")?.value}`;
}

function value(amount: number | null, unit: string, digits = 3) {
  return amount === null ? "—" : `${amount.toLocaleString("id-ID", {maximumFractionDigits: digits})} ${unit}`;
}

export default function MonthlySummary() {
  const [month, setMonth] = useState(currentMonth);
  const [result, setResult] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await ApiService.request<Summary>(`/api/smart-office/summary?month=${encodeURIComponent(month)}`,
          {signal: controller.signal, timeout: 35000, cache: "no-store"});
        if (active) setResult(response);
      } catch {
        if (active) setError("Ringkasan belum dapat diperbarui. Silakan coba lagi sebentar.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 30 * 60 * 1000);
    return () => { active = false; controller.abort(); window.clearInterval(timer); };
  }, [month, revision]);

  const visible = result?.facts.month === month ? result : null;
  const facts = visible?.facts;
  return (
    <section className="office-monthly-summary" aria-labelledby="office-monthly-title">
      <div className="section-title office-section-heading">
        <h3 id="office-monthly-title">Ringkasan Energi &amp; Estimasi Emisi Bulanan</h3>
        <label className="office-date">Bulan ringkasan
          <input type="month" value={month} min="1970-01" max={currentMonth()}
            onChange={event => { if (/^\d{4}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value); }} />
        </label>
      </div>
      <div className="location-card office-monthly-panel" aria-busy={loading}>
        {facts && <>
          <div className="office-monthly-topline">
            <strong>{facts.month_label}</strong>
            <span>{facts.partial ? "Subtotal data tersedia" : facts.in_progress ? "Bulan berjalan" : "Total bulanan"}</span>
          </div>
          <div className="office-monthly-facts">
            <div><span>Total energi AC + lampu</span><strong>{value(facts.total_kwh, "kWh")}</strong>
              <small>AC {value(facts.ac_kwh, "kWh")} · Lampu {value(facts.lamp_kwh, "kWh")}</small></div>
            <div><span>Estimasi emisi konsumsi listrik</span><strong>{value(facts.emissions_kg_co2, "kg CO₂")}</strong>
              <small>{value(facts.emissions_t_co2, "t CO₂", 6)}</small></div>
          </div>
          <p className="office-monthly-narrative" role="status">{visible.summary}</p>
          <p className="office-monthly-meta">
            {visible.mode === "qwen" ? "Ringkasan AI" : visible.mode === "no_data" ? "Menunggu data energi" : "Ringkasan perhitungan · AI sementara belum tersedia"}
            {` · ${new Date(visible.generated_at_utc).toLocaleString("id-ID", {day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Jakarta"})} WIB`}
            {visible.stale && " · Menampilkan ringkasan sebelumnya"}
          </p>
          <p className="office-monthly-meta">
            Jamali · Faktor referensi {value(facts.factor.value, facts.factor.unit, 2)} · Tahun acuan {facts.factor.reference_year}.{" "}
            <a href={facts.factor.source_url} target="_blank" rel="noopener noreferrer">Referensi ESDM</a>
            <br />Emisi (kg CO₂) = energi (kWh) × 0,87. Cakupan: AC {facts.days_with_ac}/{facts.elapsed_days} hari, lampu {facts.days_with_lamp}/{facts.elapsed_days} hari.
          </p>
        </>}
        {loading && <p className="office-monthly-meta" role="status">Menyiapkan ringkasan bulanan...</p>}
        {error && <div className="office-notice" role="alert">{error}{visible && " Menampilkan ringkasan terakhir untuk bulan ini."}{" "}
          <button type="button" className="office-download" disabled={loading} onClick={() => setRevision(n => n + 1)}>Coba lagi</button>
        </div>}
      </div>
    </section>
  );
}
