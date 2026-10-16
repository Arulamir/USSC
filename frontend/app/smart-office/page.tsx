"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
  type ChartOptions,
} from "chart.js";
import MainLayout from "../components/layout/MainLayout";
import { useTheme } from "../components/layout/Theme";
import { ApiService } from "../../lib/api";
import type { OfficeHistory, OfficePeriod, SmartOfficeSnapshot } from "../../lib/smart-office";
import OfficeControls from "./OfficeControls";
import "../dashboard.css";
import "./office.css";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const periods: { value: OfficePeriod; label: string }[] = [
  { value: "daily", label: "Per Hari" },
  { value: "weekly", label: "Per Minggu" },
  { value: "monthly", label: "Per Bulan" },
  { value: "yearly", label: "Per Tahun" },
];

function number(value: number | null | undefined, unit: string) {
  return value == null || !Number.isFinite(value) ? "—"
    : `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`;
}

function dateTime(value: string | undefined, withTime = false) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00+07:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Jakarta",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } as const : {}),
  }) + (withTime ? " WIB" : "");
}

function todayWib() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function qualityLabel(status: string) {
  return ({ complete: "Lengkap", estimated: "Estimasi batas waktu", partial: "Data sebagian",
    partial_estimated: "Data sebagian dengan estimasi", missing_current: "Data meter belum tersedia",
    missing_baseline: "Counter batas waktu belum tersedia", counter_reset: "Counter meter ter-reset",
    conflict: "Pembacaan meter bertentangan", future: "Belum berlangsung" } as Record<string, string>)[status] ?? status;
}

export default function SmartOfficePage() {
  const { theme } = useTheme();
  const [snapshot, setSnapshot] = useState<SmartOfficeSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [period, setPeriod] = useState<OfficePeriod>("daily");
  const [date, setDate] = useState(todayWib);
  const [history, setHistory] = useState<OfficeHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    let stopped = false;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      controller = new AbortController();
      try {
        const response = await ApiService.getSmartOffice(controller.signal);
        if (!stopped) { setSnapshot(response.data); setSnapshotError(false); }
      } catch {
        if (!stopped) setSnapshotError(true);
      } finally {
        if (!stopped) { setSnapshotLoading(false); timer = setTimeout(refresh, 60_000); }
      }
    };
    refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let stopped = false;
    let controller: AbortController;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      controller = new AbortController();
      try {
        const response = await ApiService.getSmartOfficeHistory(period, date, controller.signal);
        if (!stopped) { setHistory(response); setHistoryError(false); }
      } catch {
        if (!stopped) setHistoryError(true);
      } finally {
        if (!stopped) { setHistoryLoading(false); timer = setTimeout(refresh, 60_000); }
      }
    };
    refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [period, date]);

  const changePeriod = (next: OfficePeriod) => {
    if (next === period) return;
    setPeriod(next);
    setHistory(null);
    setHistoryLoading(true);
    setHistoryError(false);
    setDownloadError("");
  };

  const changeDate = (next: string) => {
    if (!next || next === date) return;
    setDate(next);
    setHistory(null);
    setHistoryLoading(true);
    setHistoryError(false);
    setDownloadError("");
  };

  const chartData = useMemo(() => ({
    labels: history?.data.map(row => {
      if (period === "daily") return row.label;
      if (period === "yearly") return new Date(`${row.label}-01T00:00:00+07:00`)
        .toLocaleDateString("id-ID", { month: "short", timeZone: "Asia/Jakarta" });
      return new Date(`${row.label}T00:00:00+07:00`)
        .toLocaleDateString("id-ID", { day: "2-digit", month: "short", timeZone: "Asia/Jakarta" });
    }) ?? [],
    datasets: [
      { label: "AC", data: history?.data.map(row => row.ac_wh) ?? [], backgroundColor: "#10b981", borderRadius: 4 },
      { label: "Lampu", data: history?.data.map(row => row.lamp_wh) ?? [], backgroundColor: "#f59e0b", borderRadius: 4 },
    ],
  }), [history, period]);

  const chartOptions: ChartOptions<"bar"> = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { color: theme === "dark" ? "#cbd5e1" : "#475569", usePointStyle: true } },
      tooltip: { callbacks: {
        label: context => `${context.dataset.label}: ${number(context.parsed.y, "Wh")}`,
        afterLabel: context => {
          const row = history?.data[context.dataIndex];
          return row ? `${qualityLabel(context.datasetIndex === 0 ? row.ac_status : row.lamp_status)}${row.in_progress ? " · Sedang berjalan" : ""}` : "";
        },
      } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: theme === "dark" ? "#94a3b8" : "#64748b", maxRotation: 45 } },
      y: { beginAtZero: true, title: { display: true, text: "Energi (Wh)", color: theme === "dark" ? "#94a3b8" : "#64748b" },
        ticks: { color: theme === "dark" ? "#94a3b8" : "#64748b" },
        grid: { color: theme === "dark" ? "#334155" : "#e2e8f0" } },
    },
  };

  const download = async () => {
    if (!history || downloading) return;
    // Capture the visible period so a later filter change cannot relabel the file.
    const requested = { period: history.period, date: history.date };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    setDownloading(true);
    setDownloadError("");
    try {
      const response = await fetch(`/api/smart-office/export?${new URLSearchParams(requested)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message || "Laporan belum dapat diunduh.");
      }
      if (!response.headers.get("content-type")?.includes("spreadsheetml")) throw new Error("Format laporan tidak valid.");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `USSC_Smart_Office_${requested.period}_${requested.date}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Laporan belum dapat diunduh.");
    } finally { clearTimeout(timer); setDownloading(false); }
  };

  const cards = [
    { label: "Daya AC", icon: "bi-snow", value: number(snapshot?.ac_power_w, "W"), color: "green" },
    { label: "Daya Lampu", icon: "bi-lightbulb", value: number(snapshot?.lamp_power_w, "W"), color: "green" },
    { label: "Energi Harian AC", icon: "bi-lightning-charge", value: number(snapshot?.ac_day_wh, "Wh"), color: "green" },
    { label: "Energi Harian Lampu", icon: "bi-lightning-charge", value: number(snapshot?.lamp_day_wh, "Wh"), color: "orange" },
  ];
  const hasChartData = Boolean(history?.data.some(row => row.ac_wh !== null || row.lamp_wh !== null));
  const range = history ? `${dateTime(history.start_wib)} – ${dateTime(new Date(new Date(history.end_wib).getTime() - 1).toISOString())} WIB` : "";

  return (
    <MainLayout>
      <div className="dashboard-page-container office-page">
        <div className="page-heading">
          <div><span className="eyebrow">SMART OFFICE</span><h2>Smart Office</h2>
            <p>Pemantauan daya, konsumsi energi, dan kontrol perangkat kantor.</p></div>
        </div>
        <div className="summary-grid">
          {cards.map(card => <div className="summary-card" key={card.label}>
            <div className={`summary-icon ${card.color}`}><i className={`bi ${card.icon}`} aria-hidden="true" /></div>
            <div><span>{card.label}</span><strong>{card.value}</strong></div>
          </div>)}
        </div>
        <p className="office-snapshot-status" role="status">
          {snapshotLoading ? "Memuat data kantor..." : snapshotError ? "Koneksi data terputus." : !snapshot ? "Belum ada snapshot kantor." : snapshot.stale ? "Data terlambat." : "Data terakhir tersedia."}
          {snapshot && ` Snapshot: ${dateTime(snapshot.sampled_at_utc, true)}. Energi harian tanggal ${dateTime(snapshot.energy_date_wib)}.`}
        </p>

        <section aria-labelledby="office-energy-title">
          <div className="section-title office-section-heading">
            <h3 id="office-energy-title">Konsumsi Energi AC dan Lampu</h3>
            <button type="button" className="office-download" disabled={!history || historyLoading || downloading} onClick={download}>
              <i className={`bi ${downloading ? "bi-hourglass-split" : "bi-file-earmark-excel"}`} aria-hidden="true" />
              {downloading ? "Menyiapkan Excel..." : "Unduh Excel"}
            </button>
          </div>
          <div className="location-card office-energy-panel">
            <div className="office-filters">
              <div className="office-periods" aria-label="Periode grafik">
                {periods.map(item => <button type="button" key={item.value} aria-pressed={period === item.value}
                  className={period === item.value ? "selected" : ""} onClick={() => changePeriod(item.value)}>{item.label}</button>)}
              </div>
              <label className="office-date">Tanggal acuan
                <input type="date" value={date} min="1970-01-01" max="9998-12-31" onChange={event => changeDate(event.target.value)} />
              </label>
            </div>
            <div className="office-period-summary">
              <p>{historyLoading ? "Memuat riwayat energi..." : range || "Riwayat belum tersedia."}</p>
              {history && <div className="office-energy-totals">
                <span>AC: <strong>{number(history.totals.ac_wh, "Wh")}</strong></span>
                <span>Lampu: <strong>{number(history.totals.lamp_wh, "Wh")}</strong></span>
              </div>}
            </div>
            {historyError && <p className="office-notice" role="alert">Riwayat energi belum dapat diperbarui.{history ? " Menampilkan data terakhir yang berhasil dimuat." : " Periksa koneksi backend dan database."}</p>}
            {downloadError && <p className="office-notice" role="alert">{downloadError}</p>}
            <div className="office-chart" aria-label="Grafik konsumsi energi AC dan lampu dalam Wh">
              {historyLoading ? <div className="office-chart-empty">Memuat grafik...</div>
                : hasChartData ? <Bar data={chartData} options={chartOptions} />
                : <div className="office-chart-empty"><i className="bi bi-bar-chart" aria-hidden="true" />Belum ada data energi untuk periode ini.</div>}
            </div>
            <p className="office-chart-note">
              {period === "daily" ? "Energi per jam." : period === "yearly" ? "Energi per bulan." : "Energi per hari."}
              {period === "weekly" && " Minggu dimulai pada hari Senin."}
              {" "}Waktu mengikuti WIB. Interval tanpa data dibiarkan kosong; interval berjalan belum final.
              {(history?.totals.ac_partial || history?.totals.lamp_partial) && " Angka periode adalah subtotal data yang tersedia karena sebagian meter atau interval belum lengkap."}
            </p>
          </div>
        </section>
        <OfficeControls />
      </div>
    </MainLayout>
  );
}
