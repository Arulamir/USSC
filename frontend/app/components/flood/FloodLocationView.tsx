"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
  Legend,
  Title,
} from "chart.js";
import { ApiService } from "../../../lib/api";
import "../../flood.css";

// Register Chart.js modules
Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Filler,
  Tooltip,
  Legend,
  Title
);

type FloodLocationData = {
  jarak?: number;
  suhu_udara?: number;
  suhu_air?: number;
  suhu_air_1?: number;
  suhu_air_2?: number;
  kelembapan_tanah?: number;
  soil?: number;
  rain?: number;
  temp_panel?: number;
  hum_panel?: number;
  status?: string;
};

type HourlyHistoryItem = {
  date?: string;
  time?: string;
  water?: string | number;
  temp?: string | number;
  soil?: string | number;
  status?: string;
};

type FloodLocationViewProps = {
  locationKey: "lidah" | "ketintang";
  locationName: string;
};

export default function FloodLocationView({
  locationKey,
  locationName,
}: FloodLocationViewProps) {
  const router = useRouter();
  const [data, setData] = useState<FloodLocationData | null>(null);
  const [history, setHistory] = useState<HourlyHistoryItem[]>([]);
  const [cityWeather, setCityWeather] = useState<{
    temperature?: number;
    humidity?: number;
  }>({});
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [loading, setLoading] = useState(true);

  // Chart Canvas Refs
  const waterChartRef = useRef<HTMLCanvasElement | null>(null);
  const soilChartRef = useRef<HTMLCanvasElement | null>(null);
  const tempChartRef = useRef<HTMLCanvasElement | null>(null);
  const rainChartRef = useRef<HTMLCanvasElement | null>(null);

  // Chart Instances
  const waterChartInst = useRef<Chart | null>(null);
  const soilChartInst = useRef<Chart | null>(null);
  const tempChartInst = useRef<Chart | null>(null);
  const rainChartInst = useRef<Chart | null>(null);

  const determineStatus = (water?: number, explicitStatus?: string) => {
    if (explicitStatus) {
      const s = explicitStatus.toUpperCase();
      if (s === "BAHAYA" || s === "WASPADA" || s === "AMAN") return s;
    }
    if (water === undefined || water === null) return "AMAN";
    if (water >= 100) return "BAHAYA";
    if (water >= 50) return "WASPADA";
    return "AMAN";
  };

  const currentStatus = determineStatus(
    data?.jarak,
    data?.status
  );

  const statusClass =
    currentStatus === "BAHAYA"
      ? "danger"
      : currentStatus === "WASPADA"
      ? "warning"
      : "safe";

  const statusTextClass =
    currentStatus === "BAHAYA"
      ? "text-danger"
      : currentStatus === "WASPADA"
      ? "text-warning"
      : "text-safe";

  const statusDescription =
    currentStatus === "BAHAYA"
      ? "Peringatan! Ketinggian air telah melebihi batas kritis. Waspada banjir!"
      : currentStatus === "WASPADA"
      ? "Perhatian! Ketinggian air meningkat. Pantau saluran air secara berkala."
      : "Kondisi lingkungan dan saluran air kampus dalam keadaan normal dan aman.";

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      // 1. Status Terkini
      const res = await ApiService.getFloodStatus();
      if (res?.data && res.data[locationKey]) {
        setData(res.data[locationKey]);
        setLastUpdated(
          new Date().toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        );
      }

      // 2. Riwayat Hari Ini
      const histRes = await ApiService.getTodayFloodHistory();
      if (histRes?.data && histRes.data[locationKey]) {
        setHistory(histRes.data[locationKey]);
      }
    } catch (err) {
      console.warn("[FloodView] Gagal mengambil data banjir:", err);
    } finally {
      setLoading(false);
    }
  }, [locationKey]);

  // Cuaca Kota Surabaya
  useEffect(() => {
    async function loadCityWeather() {
      try {
        const weatherRes = await ApiService.getSurabayaWeather();
        if (weatherRes?.current) {
          setCityWeather({
            temperature: weatherRes.current.temperature_2m,
            humidity: weatherRes.current.relative_humidity_2m,
          });
        }
      } catch (e) {
        // Fallback default jika offline
        setCityWeather({ temperature: 31.0, humidity: 68 });
      }
    }
    loadCityWeather();
  }, []);

  // Polling Real-time (setiap 4 detik)
  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 4000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // Render & Update Charts
  useEffect(() => {
    if (loading) return;

    // Siapkan label jam dan dataset
    const labels = history.length > 0 
      ? history.map((h) => h.time || "")
      : ["06:00", "08:00", "10:00", "12:00", "14:00", "Sekarang"];

    const currentWater = data?.jarak || 0;
    const currentSoil = data?.kelembapan_tanah || data?.soil || 0;
    const currentTemp = data?.suhu_udara || 0;
    const currentRain = data?.rain || 0;

    const waterData = history.length > 0 
      ? history.map((h) => parseFloat(String(h.water || 0)))
      : [12, 14, 15, 13, 14, currentWater];

    const soilData = history.length > 0 
      ? history.map((h) => parseFloat(String(h.soil || 0)))
      : [45, 48, 50, 46, 44, currentSoil];

    const tempData = history.length > 0 
      ? history.map((h) => parseFloat(String(h.temp || 0)))
      : [27, 28, 30, 31, 29, currentTemp];

    const rainData = history.length > 0 
      ? history.map((_, i) => (i === history.length - 1 ? currentRain : 0))
      : [0, 0, 0, 0, 0, currentRain];

    // Chart 1: Ketinggian Air
    if (waterChartRef.current) {
      if (waterChartInst.current) waterChartInst.current.destroy();
      waterChartInst.current = new Chart(waterChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Ketinggian Air (cm)",
              data: waterData,
              borderColor: "#0284c7",
              backgroundColor: "rgba(2, 132, 199, 0.15)",
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, suggestedMax: 100 },
            x: { grid: { display: false } },
          },
        },
      });
    }

    // Chart 2: Kelembaban Tanah
    if (soilChartRef.current) {
      if (soilChartInst.current) soilChartInst.current.destroy();
      soilChartInst.current = new Chart(soilChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Kelembaban Tanah (%)",
              data: soilData,
              borderColor: "#10b981",
              backgroundColor: "rgba(16, 185, 129, 0.12)",
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, suggestedMax: 100 },
            x: { grid: { display: false } },
          },
        },
      });
    }

    // Chart 3: Suhu Lingkungan
    if (tempChartRef.current) {
      if (tempChartInst.current) tempChartInst.current.destroy();
      tempChartInst.current = new Chart(tempChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Suhu (°C)",
              data: tempData,
              borderColor: "#f97316",
              backgroundColor: "rgba(249, 115, 22, 0.12)",
              borderWidth: 2.5,
              fill: true,
              tension: 0.35,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: false, suggestedMin: 20, suggestedMax: 40 },
            x: { grid: { display: false } },
          },
        },
      });
    }

    // Chart 4: Intensitas Hujan
    if (rainChartRef.current) {
      if (rainChartInst.current) rainChartInst.current.destroy();
      rainChartInst.current = new Chart(rainChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Curah Hujan (mm/jam)",
              data: rainData,
              borderColor: "#6366f1",
              backgroundColor: "rgba(99, 102, 241, 0.15)",
              borderWidth: 2.5,
              fill: true,
              tension: 0.3,
              pointRadius: 3,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, suggestedMax: 20 },
            x: { grid: { display: false } },
          },
        },
      });
    }

    return () => {
      waterChartInst.current?.destroy();
      soilChartInst.current?.destroy();
      tempChartInst.current?.destroy();
      rainChartInst.current?.destroy();
    };
  }, [history, data, loading]);

  const waterVal = data?.jarak !== undefined ? `${data.jarak} cm` : "-- cm";
  const tempVal =
    data?.suhu_udara !== undefined
      ? `${data.suhu_udara} °C`
      : data?.suhu_air_1 !== undefined
      ? `${data.suhu_air_1} °C`
      : "-- °C";
  const soilVal =
    data?.kelembapan_tanah !== undefined
      ? `${data.kelembapan_tanah} %`
      : data?.soil !== undefined
      ? `${data.soil} %`
      : "-- %";
  const rainVal =
    data?.rain !== undefined ? `${data.rain} mm/jam` : "0.0 mm/jam";
  const panelTempVal =
    data?.temp_panel !== undefined ? `${data.temp_panel} °C` : "-- °C";
  const panelHumVal =
    data?.hum_panel !== undefined ? `${data.hum_panel} %` : "-- %";
  const cityTempVal =
    cityWeather.temperature !== undefined
      ? `${cityWeather.temperature} °C`
      : "-- °C";
  const cityHumVal =
    cityWeather.humidity !== undefined
      ? `${cityWeather.humidity} %`
      : "-- %";

  return (
    <div className="flood-container">
      {/* Quick Campus Switcher */}
      <div className="flood-switcher">
        <button
          onClick={() => router.push("/lidah-wetan")}
          className={locationKey === "lidah" ? "active" : ""}
        >
          <i className="bi bi-geo-alt me-1" />
          Kampus Lidah Wetan
        </button>
        <button
          onClick={() => router.push("/ketintang")}
          className={locationKey === "ketintang" ? "active" : ""}
        >
          <i className="bi bi-geo-alt me-1" />
          Kampus Ketintang
        </button>
      </div>

      {/* Page Heading */}
      <div className="flood-heading">
        <div>
          <span className="flood-eyebrow">FLOOD MONITORING</span>
          <h2 className="flood-title">{locationName}</h2>
          <p className="flood-subtitle">
            Monitoring kondisi lingkungan, ketinggian air, dan potensi banjir kampus secara real-time.
          </p>
        </div>

        <div className="flood-location-badge">
          <i className="bi bi-geo-alt-fill text-emerald-600 dark:text-emerald-400" />
          <span>{locationName}</span>
          {lastUpdated && (
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal ms-1">
              • {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Status Hero Panel */}
      <div className="flood-status-panel">
        <div className={`flood-status-light ${statusClass}`} />
        <div className="flood-status-info">
          <span>STATUS KONDISI</span>
          <strong className={statusTextClass}>{currentStatus}</strong>
          <small>{statusDescription}</small>
        </div>
      </div>

      {/* Section: Data Monitoring */}
      <div className="flood-section-title">
        <h3>Data Monitoring</h3>
        <span>Real-time Update</span>
      </div>

      {/* Grid 8 Kartu Sensor */}
      <div className="flood-monitor-grid">
        {/* 1. Ketinggian Air */}
        <div className="flood-monitor-card primary-accent">
          <div className="flood-monitor-icon blue">
            <i className="bi bi-water" />
          </div>
          <span className="flood-monitor-label">Ketinggian Air</span>
          <strong className="flood-monitor-value">{waterVal}</strong>
          <small className="flood-monitor-note">Sensor JSN-SR04T</small>
        </div>

        {/* 2. Suhu Lingkungan */}
        <div className="flood-monitor-card temp-accent">
          <div className="flood-monitor-icon orange">
            <i className="bi bi-thermometer-half" />
          </div>
          <span className="flood-monitor-label">Suhu Udara</span>
          <strong className="flood-monitor-value">{tempVal}</strong>
          <small className="flood-monitor-note">Sensor lingkungan</small>
        </div>

        {/* 3. Kelembaban Tanah */}
        <div className="flood-monitor-card soil-accent">
          <div className="flood-monitor-icon emerald">
            <i className="bi bi-moisture" />
          </div>
          <span className="flood-monitor-label">Kelembaban Tanah</span>
          <strong className="flood-monitor-value">{soilVal}</strong>
          <small className="flood-monitor-note">Soil moisture sensor</small>
        </div>

        {/* 4. Curah Hujan */}
        <div className="flood-monitor-card rain-accent">
          <div className="flood-monitor-icon indigo">
            <i className="bi bi-cloud-rain" />
          </div>
          <span className="flood-monitor-label">Intensitas Hujan</span>
          <strong className="flood-monitor-value">{rainVal}</strong>
          <small className="flood-monitor-note">Tipping bucket / Optical</small>
        </div>

        {/* 5. Suhu Box Panel */}
        <div className="flood-monitor-card">
          <div className="flood-monitor-icon purple">
            <i className="bi bi-cpu" />
          </div>
          <span className="flood-monitor-label">Suhu Panel ESP32</span>
          <strong className="flood-monitor-value">{panelTempVal}</strong>
          <small className="flood-monitor-note">Kondisi box perangkat</small>
        </div>

        {/* 6. Kelembaban Box Panel */}
        <div className="flood-monitor-card">
          <div className="flood-monitor-icon cyan">
            <i className="bi bi-droplet-half" />
          </div>
          <span className="flood-monitor-label">Kelembaban Panel</span>
          <strong className="flood-monitor-value">{panelHumVal}</strong>
          <small className="flood-monitor-note">Kondisi box perangkat</small>
        </div>

        {/* 7. Suhu Surabaya */}
        <div className="flood-monitor-card">
          <div className="flood-monitor-icon amber">
            <i className="bi bi-cloud-sun" />
          </div>
          <span className="flood-monitor-label">Suhu Surabaya</span>
          <strong className="flood-monitor-value">{cityTempVal}</strong>
          <small className="flood-monitor-note">Open-Meteo Surabaya</small>
        </div>

        {/* 8. Kelembaban Surabaya */}
        <div className="flood-monitor-card">
          <div className="flood-monitor-icon blue">
            <i className="bi bi-cloud-drizzle" />
          </div>
          <span className="flood-monitor-label">Kelembaban Surabaya</span>
          <strong className="flood-monitor-value">{cityHumVal}</strong>
          <small className="flood-monitor-note">Open-Meteo Surabaya</small>
        </div>
      </div>

      {/* Section: Grafik Monitoring */}
      <div className="flood-section-title">
        <h3>Grafik Monitoring Lingkungan</h3>
        <span>Tren Fluktuasi Hari Ini</span>
      </div>

      {/* Grid 4 Charts */}
      <div className="flood-charts-grid">
        {/* Chart 1: Water Level */}
        <div className="flood-chart-card">
          <div className="flood-chart-header">
            <div>
              <h4>Ketinggian Air</h4>
              <span>Satuan: cm</span>
            </div>
            <i className="bi bi-water text-sky-600" />
          </div>
          <div className="flood-chart-wrapper">
            <canvas ref={waterChartRef} />
          </div>
        </div>

        {/* Chart 2: Soil Moisture */}
        <div className="flood-chart-card">
          <div className="flood-chart-header">
            <div>
              <h4>Kelembaban Tanah</h4>
              <span>Satuan: %</span>
            </div>
            <i className="bi bi-moisture text-emerald-600" />
          </div>
          <div className="flood-chart-wrapper">
            <canvas ref={soilChartRef} />
          </div>
        </div>

        {/* Chart 3: Temperature */}
        <div className="flood-chart-card">
          <div className="flood-chart-header">
            <div>
              <h4>Suhu Lingkungan</h4>
              <span>Satuan: °C</span>
            </div>
            <i className="bi bi-thermometer-half text-orange-500" />
          </div>
          <div className="flood-chart-wrapper">
            <canvas ref={tempChartRef} />
          </div>
        </div>

        {/* Chart 4: Rainfall */}
        <div className="flood-chart-card">
          <div className="flood-chart-header">
            <div>
              <h4>Intensitas Curah Hujan</h4>
              <span>Satuan: mm/jam</span>
            </div>
            <i className="bi bi-cloud-rain text-indigo-500" />
          </div>
          <div className="flood-chart-wrapper">
            <canvas ref={rainChartRef} />
          </div>
        </div>
      </div>

      {/* Section: Tabel Riwayat Hari Ini */}
      <div className="flood-section-title">
        <h3>Riwayat Telemetri Hari Ini</h3>
        <span>{history.length} Catatan</span>
      </div>

      <div className="flood-table-card">
        <table className="flood-table">
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Ketinggian Air</th>
              <th>Suhu Udara</th>
              <th>Kelembaban Tanah</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {history.length > 0 ? (
              history.map((row, idx) => {
                const rowStatus = (row.status || "AMAN").toUpperCase();
                const badgeClass =
                  rowStatus === "BAHAYA"
                    ? "danger"
                    : rowStatus === "WASPADA"
                    ? "warning"
                    : "safe";

                return (
                  <tr key={idx}>
                    <td className="font-semibold">{row.time || "--:--"}</td>
                    <td>{row.water} cm</td>
                    <td>{row.temp !== "--" ? `${row.temp} °C` : "--"}</td>
                    <td>{row.soil !== "--" ? `${row.soil} %` : "--"}</td>
                    <td>
                      <span className={`flood-badge-status ${badgeClass}`}>
                        {rowStatus}
                      </span>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={5} className="text-center py-6 text-slate-400">
                  <i className="bi bi-info-circle me-1" />
                  Belum ada rekaman riwayat untuk hari ini. Menampilkan data telemetri terkini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
