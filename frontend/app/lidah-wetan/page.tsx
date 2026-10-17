"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import MainLayout from "../components/layout/MainLayout";
import "./lidah-wetan.css";
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
import { ApiService } from "../../lib/api";
import FloodDownloadModal from "../components/flood/FloodDownloadModal";


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

type FloodSensorData = {
  id?: number;
  jarak?: number;
  suhu_udara?: number;
  suhu_air?: number;
  suhu_air_1?: number;
  suhu_air_2?: number;
  ph?: number;
  ph_adc?: number;
  ph_voltage?: number;
  status_ph?: string;
  kelembapan_tanah?: number;
  soil?: number;
  rain?: number;
  temp_panel?: number;
  hum_panel?: number;
  status?: string;
  status_suhu_air?: string;
  curah_hujan_per_jam?: number;
  timestamp?: string;
};

type HistoryEntry = {
  id?: number;
  date?: string;
  time?: string;
  timestamp?: string;
  water?: string | number;
  temp?: string | number;
  temp_water?: string | number;
  suhu_air?: string | number;
  suhu_air_2?: string | number;
  soil?: string | number;
  ph?: string | number;
  status?: string;
};

type ChartPoint = {
  id?: number;
  time: string;
  water: number;
  temp: number;
  soil: number;
};

export default function LidahWetanPage() {
  const [data, setData] = useState<FloodSensorData | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);
  const [rowsLimit, setRowsLimit] = useState<number | "all">(25);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const lastRecordedIdRef = useRef<number | null>(null);
  const [cityWeather, setCityWeather] = useState<{
    temperature?: number;
    humidity?: number;
  }>({});
  const [todayDate, setTodayDate] = useState<string>("Hari ini");
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);


  // Chart Canvas Refs
  const waterChartRef = useRef<HTMLCanvasElement | null>(null);
  const tempChartRef = useRef<HTMLCanvasElement | null>(null);
  const soilChartRef = useRef<HTMLCanvasElement | null>(null);

  // Chart Instances
  const waterChartInst = useRef<Chart | null>(null);
  const tempChartInst = useRef<Chart | null>(null);
  const soilChartInst = useRef<Chart | null>(null);

  // Format Helper
  const formatSensor = (val?: number, unit = "") => {
    if (val === undefined || val === null || isNaN(val)) return `-- ${unit}`.trim();
    return `${val} ${unit}`.trim();
  };

  // Status Logic sesuai jawa.js
  const determineFloodStatus = (water?: number | null, explicitStatus?: string) => {
    if (explicitStatus) {
      const s = String(explicitStatus).toUpperCase();
      if (s === "BAHAYA" || s === "WASPADA" || s === "AMAN") return s;
    }
    if (water === null || water === undefined || isNaN(water)) return "--";
    if (water >= 65) return "BAHAYA";
    if (water >= 40) return "WASPADA";
    return "AMAN";
  };

  const getStatusClass = (status: string) => {
    if (status === "BAHAYA") return "danger";
    if (status === "WASPADA") return "warning";
    if (status === "AMAN") return "safe";
    return "offline";
  };

  const currentStatus = determineFloodStatus(data?.jarak, data?.status);
  const statusClass = getStatusClass(currentStatus);

  const statusDescription =
    currentStatus === "BAHAYA"
      ? "Level kritis, waspada potensi banjir."
      : currentStatus === "WASPADA"
        ? "Air meningkat, pantau berkala."
        : currentStatus === "AMAN"
          ? "Kondisi normal dan aman."
          : "Menunggu data sensor...";

  // 1. Ambil 10 data grafik terakhir langsung dari Database
  const fetchRecentChartData = useCallback(async () => {
    try {
      const res = await ApiService.getFloodRecentChart("lidah", 10);
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        setChartPoints(res.data);
      }
    } catch (err) {
      console.warn("[LidahWetan] Gagal mengambil data grafik dari DB:", err);
    }
  }, []);

  // 2. Ambil riwayat log tabel langsung dari Database
  const fetchHistoryData = useCallback(async () => {
    try {
      const res = await ApiService.getFloodHistory("lidah", 50);
      if (res?.data && Array.isArray(res.data) && res.data.length > 0) {
        const formatted = res.data.map((r: any) => ({
          id: r.id,
          date: r.timestamp ? r.timestamp.split(" ")[0] : "",
          time: r.timestamp ? r.timestamp.split(" ")[1] : "",
          timestamp: r.timestamp,
          water: r.water_level !== undefined ? Number(r.water_level).toFixed(1) : "--",
          temp: r.air_temp !== undefined && r.air_temp !== null ? Number(r.air_temp).toFixed(1) : (r.suhu_udara !== undefined && r.suhu_udara !== null ? Number(r.suhu_udara).toFixed(1) : (r.suhu_air_1 !== undefined && r.suhu_air_1 !== null ? Number(r.suhu_air_1).toFixed(1) : "--")),
          temp_water: (r.suhu_air !== undefined && r.suhu_air !== null && !isNaN(Number(r.suhu_air)))
            ? Number(r.suhu_air).toFixed(1)
            : (r.suhu_air_2 !== undefined && r.suhu_air_2 !== null && !isNaN(Number(r.suhu_air_2)) ? Number(r.suhu_air_2).toFixed(1) : "--"),
          suhu_air: r.suhu_air ?? r.suhu_air_2,
          suhu_air_2: r.suhu_air_2 ?? r.suhu_air,
          soil: r.soil_moisture !== undefined && r.soil_moisture !== null ? Number(r.soil_moisture).toFixed(1) : "--",
          ph: r.ph !== undefined && r.ph !== null && !isNaN(Number(r.ph)) ? Number(r.ph).toFixed(1) : "--",
          status: r.status || "AMAN",
        }));
        setHistory(formatted);
      } else {
        const histRes = await ApiService.getTodayFloodHistory();
        if (histRes?.data?.lidah && Array.isArray(histRes.data.lidah)) {
          setHistory(histRes.data.lidah);
        }
      }
    } catch (err) {
      console.warn("[LidahWetan] Gagal mengambil riwayat tabel dari DB:", err);
    }
  }, []);

  // 3. Smart Fast-Check Polling Sensor dari Database (Delay Rendah 1.5s)
  const pollLatestSensorData = useCallback(async () => {
    try {
      const res = await ApiService.getFloodLatest("lidah");
      if (res?.data) {
        const item = res.data;
        setData(item);

        const currentId = item.id !== undefined && item.id !== null ? Number(item.id) : null;
        if (currentId !== null && currentId !== lastRecordedIdRef.current) {
          lastRecordedIdRef.current = currentId;
          fetchRecentChartData();
          fetchHistoryData();
        }
      }
    } catch (err) {
      console.warn("[LidahWetan] Gagal mengambil sensor terkini:", err);
    }
  }, [fetchRecentChartData, fetchHistoryData]);

  // Format tanggal hari ini
  useEffect(() => {
    const now = new Date();
    const formatted = now.toLocaleDateString("id-ID", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    setTodayDate(formatted);
  }, []);

  // Ambil data cuaca Surabaya
  useEffect(() => {
    async function loadWeather() {
      try {
        const wRes = await ApiService.getSurabayaWeather();
        if (wRes?.current) {
          setCityWeather({
            temperature: wRes.current.temperature_2m,
            humidity: wRes.current.relative_humidity_2m,
          });
        }
      } catch {
        setCityWeather({ temperature: 31.0, humidity: 68 });
      }
    }
    loadWeather();
  }, []);

  // Inisialisasi awal saat halaman dibuka
  useEffect(() => {
    pollLatestSensorData();
    fetchRecentChartData();
    fetchHistoryData();
  }, [pollLatestSensorData, fetchRecentChartData, fetchHistoryData]);

  // Fast-Check Polling Sensor: Cek database setiap 1.5 detik (delay rendah)
  useEffect(() => {
    const fastCheckTimer = setInterval(pollLatestSensorData, 1500);
    return () => clearInterval(fastCheckTimer);
  }, [pollLatestSensorData]);

  // Interval Refresh Grafik Berkala: Pastikan 10 data terakhir dari DB selalu segar setiap 10 detik
  useEffect(() => {
    const chartRefreshTimer = setInterval(() => {
      fetchRecentChartData();
    }, 10000);
    return () => clearInterval(chartRefreshTimer);
  }, [fetchRecentChartData]);

  // Destroy charts on component unmount
  useEffect(() => {
    return () => {
      waterChartInst.current?.destroy();
      tempChartInst.current?.destroy();
      soilChartInst.current?.destroy();
      waterChartInst.current = null;
      tempChartInst.current = null;
      soilChartInst.current = null;
    };
  }, []);

  // Urutan data tabel riwayat: dari database (terbaru di atas)
  const sortedHistory = useMemo(() => {
    return history;
  }, [history]);

  // Batasi jumlah baris berdasarkan pilihan "Data per hari"
  const displayedRows = useMemo(() => {
    if (rowsLimit === "all") return sortedHistory;
    return sortedHistory.slice(0, rowsLimit);
  }, [sortedHistory, rowsLimit]);

  // Fungsi Refresh Manual
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        pollLatestSensorData(),
        fetchRecentChartData(),
        fetchHistoryData(),
      ]);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  };

  const getTableBadgeClass = (status: string) => {
    if (status === "BAHAYA") return "badge-danger";
    if (status === "WASPADA") return "badge-warning";
    if (status === "AMAN") return "badge-safe";
    return "badge-offline";
  };

  // Fungsi Download CSV Histori Sesuai Format Tabel Real-time
  const downloadHistoryCSV = useCallback(() => {
    if (sortedHistory.length === 0) return;

    const BOM = "\uFEFF";
    const header = [
      "No",
      "Timestamp",
      "Ketinggian Air (cm)",
      "Suhu Udara (°C)",
      "Suhu Air (°C)",
      "Kelembaban Tanah (%)",
      "pH Air",
      "Status",
    ];
    const csvLines = [header.join(",")];

    sortedHistory.forEach((item, idx) => {
      const water =
        item.water !== undefined && item.water !== "" && !isNaN(Number(item.water))
          ? Number(item.water).toFixed(1)
          : "--";
      const temp =
        item.temp !== undefined && item.temp !== "" && item.temp !== "--" && !isNaN(Number(item.temp))
          ? Number(item.temp).toFixed(1)
          : "--";
      const tempWater =
        item.temp_water !== undefined && item.temp_water !== "" && item.temp_water !== "--" && !isNaN(Number(item.temp_water))
          ? Number(item.temp_water).toFixed(1)
          : item.suhu_air !== undefined && item.suhu_air !== "" && item.suhu_air !== "--" && !isNaN(Number(item.suhu_air))
          ? Number(item.suhu_air).toFixed(1)
          : item.suhu_air_2 !== undefined && item.suhu_air_2 !== "" && item.suhu_air_2 !== "--" && !isNaN(Number(item.suhu_air_2))
          ? Number(item.suhu_air_2).toFixed(1)
          : "--";
      const soil =
        item.soil !== undefined && item.soil !== "" && item.soil !== "--" && !isNaN(Number(item.soil))
          ? Number(item.soil).toFixed(1)
          : "--";
      const ph =
        item.ph !== undefined && item.ph !== "" && item.ph !== "--" && !isNaN(Number(item.ph))
          ? Number(item.ph).toFixed(1)
          : "--";
      const status = (item.status || "AMAN").toUpperCase();
      const timestamp =
        item.timestamp ||
        (item.date && item.time ? `${item.date} ${item.time}` : `${todayDate} ${item.time || "--:--"}`);

      csvLines.push([idx + 1, `"${timestamp}"`, water, temp, tempWater, soil, ph, status].join(","));
    });

    const csvContent = BOM + csvLines.join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `Data_Pengukuran_Realtime_Lidah_Wetan_${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [sortedHistory, todayDate]);

  // Render & Update Chart (10 data terakhir dari Database)
  useEffect(() => {
    let labels: string[] = [];
    let waterSeries: number[] = [];
    let tempSeries: number[] = [];
    let soilSeries: number[] = [];

    if (chartPoints.length > 0) {
      labels = chartPoints.map((item) => item.time);
      waterSeries = chartPoints.map((item) => item.water);
      tempSeries = chartPoints.map((item) => item.temp);
      soilSeries = chartPoints.map((item) => item.soil);
    } else if (history.length > 0) {
      const slice = history.slice(0, 10).reverse();
      labels = slice.map((item) => item.time || "");
      waterSeries = slice.map((item) => Number(item.water) || 0);
      tempSeries = slice.map((item) => Number(item.temp) || 0);
      soilSeries = slice.map((item) => Number(item.soil) || 0);
    } else if (data && data.jarak !== undefined && data.jarak !== null) {
      const timeNow = new Date().toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      labels = [timeNow];
      waterSeries = [Number(data.jarak)];
      tempSeries = [Number(data.suhu_udara ?? data.suhu_air_1 ?? 0)];
      soilSeries = [Number(data.kelembapan_tanah ?? data.soil ?? 0)];
    } else {
      labels = ["Menunggu Database..."];
      waterSeries = [0];
      tempSeries = [0];
      soilSeries = [0];
    }

    const commonOptions = (unit: string) => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index" as const,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context: any) {
              return `${context.parsed.y} ${unit}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 9 },
            color: "#94a3b8",
          },
        },
        y: {
          beginAtZero: false,
          grid: { color: "#edf1f5" },
          ticks: {
            font: { size: 9 },
            color: "#94a3b8",
          },
        },
      },
    });

    // 1. Chart Ketinggian Air
    if (waterChartRef.current) {
      if (waterChartInst.current) waterChartInst.current.destroy();
      waterChartInst.current = new Chart(waterChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Ketinggian Air",
              data: waterSeries,
              borderColor: "#0284c7",
              backgroundColor: "rgba(2, 132, 199, 0.12)",
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
              tension: 0.35,
              fill: true,
            },
          ],
        },
        options: commonOptions("cm"),
      });
    }

    // 2. Chart Suhu
    if (tempChartRef.current) {
      if (tempChartInst.current) tempChartInst.current.destroy();
      tempChartInst.current = new Chart(tempChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Suhu",
              data: tempSeries,
              borderColor: "#f97316",
              backgroundColor: "rgba(249, 115, 22, 0.12)",
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
              tension: 0.35,
              fill: true,
            },
          ],
        },
        options: commonOptions("°C"),
      });
    }

    // 3. Chart Kelembaban Tanah
    if (soilChartRef.current) {
      if (soilChartInst.current) soilChartInst.current.destroy();
      soilChartInst.current = new Chart(soilChartRef.current, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Kelembaban Tanah",
              data: soilSeries,
              borderColor: "#059669",
              backgroundColor: "rgba(16, 185, 129, 0.10)",
              borderWidth: 2,
              pointRadius: 3,
              pointHoverRadius: 5,
              tension: 0.35,
              fill: true,
            },
          ],
        },
        options: commonOptions("%"),
      });
    }

    return () => {
      waterChartInst.current?.destroy();
      tempChartInst.current?.destroy();
      soilChartInst.current?.destroy();
    };
  }, [chartPoints, history, data]);

  const soilValue = data?.kelembapan_tanah ?? data?.soil;

  const phVal =
    data?.ph !== undefined && data?.ph !== null && !isNaN(Number(data.ph))
      ? Number(data.ph)
      : null;

  let phValueDisplay = "-- pH";
  let phTextColor = "#64748b";
  let phDesc = "Sensor Analog pH";

  if (phVal !== null) {
    phValueDisplay = `${phVal.toFixed(1)} pH`;
    if (phVal < 5.0) {
      phTextColor = "#ef4444";
      phDesc = "Sangat Asam";
    } else if (phVal <= 6.5) {
      phTextColor = "#f59e0b";
      phDesc = "Cenderung Asam";
    } else if (phVal <= 8.5) {
      phTextColor = "#10b981";
      phDesc = "Kondisi Netral";
    } else if (phVal <= 9.0) {
      phTextColor = "#06b6d4";
      phDesc = "Cenderung Basa";
    } else {
      phTextColor = "#ef4444";
      phDesc = "Sangat Basa";
    }
  } else if (data?.status_ph) {
    const rawStatus = String(data.status_ph).toUpperCase();
    if (rawStatus.includes("NORMAL")) {
      phTextColor = "#10b981";
      phDesc = "Kondisi Netral";
    } else if (rawStatus.includes("ASAM")) {
      phTextColor = "#f59e0b";
      phDesc = "Cenderung Asam";
    } else if (rawStatus.includes("BASA")) {
      phTextColor = "#06b6d4";
      phDesc = "Cenderung Basa";
    } else if (rawStatus.includes("BAHAYA")) {
      phTextColor = "#ef4444";
      phDesc = "Sangat Asam / Basa";
    } else {
      phDesc = String(data.status_ph);
    }
  }

  return (
    <MainLayout>
      <div className="flood-page-container">
        <section className="page active" id="page-lidah-wetan">
          {/* =================================================
               PAGE HEADING
          ================================================== */}
          <div className="page-heading">
            <div>
              <span className="eyebrow">ENVIRONMENTAL MONITORING SYSTEM</span>
              <h2>Lidah Wetan</h2>
              <p>Monitoring kondisi lingkungan dan potensi banjir.</p>
            </div>
          </div>

          {/* =================================================
               STATUS PANEL
          ================================================== */}
          <div className="status-panel">
            <div
              className={`status-light large ${statusClass}`}
              id="lidahStatusLight"
            ></div>
            <div className="status-info">
              <span>STATUS KONDISI</span>
              <strong id="lidahStatus" className={statusClass}>
                {currentStatus}
              </strong>
              <small id="lidahStatusDescription">{statusDescription}</small>
            </div>
          </div>

          {/* =================================================
               DATA MONITORING (10 SENSOR CARDS)
          ================================================== */}
          <div className="section-title">
            <h3>Data Monitoring</h3>
            <span>Real-time</span>
          </div>

          <div className="monitor-grid">
            <div className="monitor-card water">
              <div className="monitor-icon">
                <i className="bi bi-water"></i>
              </div>
              <span>Ketinggian Air</span>
              <strong id="lidahWater">
                {formatSensor(data?.jarak, "cm")}
              </strong>
              <small>Sensor JSN-SR04T</small>
            </div>

            <div className="monitor-card">
              <div className="monitor-icon">
                <i className="bi bi-thermometer-half"></i>
              </div>
              <span>Suhu Udara</span>
              <strong id="lidahTemp">
                {formatSensor(data?.suhu_udara ?? data?.suhu_air_1, "°C")}
              </strong>
              <small>Sensor DS18B20 (Udara)</small>
            </div>

            <div className="monitor-card">
              <div className="monitor-icon">
                <i className="bi bi-thermometer-sun"></i>
              </div>
              <span>Suhu Air</span>
              <strong id="lidahTemp2">
                {formatSensor(data?.suhu_air ?? data?.suhu_air_2, "°C")}
              </strong>
              <small>Sensor DS18B20 (Air)</small>
            </div>

            <div className="monitor-card">
              <div className="monitor-icon">
                <i className="bi bi-droplet-half"></i>
              </div>
              <span>Sensor pH</span>
              <strong id="lidahPhStatus">
                {phValueDisplay}
              </strong>
              <small id="lidahPhDesc">{phDesc}</small>
            </div>

            <div className="monitor-card">
              <div className="monitor-icon">
                <i className="bi bi-moisture"></i>
              </div>
              <span>Kelembaban Tanah</span>
              <strong id="lidahSoil">
                {formatSensor(soilValue, "%")}
              </strong>
              <small>Sensor Capacitive Soil Moisture</small>
            </div>

            <div className="monitor-card rain">
              <div className="monitor-icon">
                <i className="bi bi-cloud-rain"></i>
              </div>
              <span>Intensitas Hujan</span>
              <strong id="lidahRain">
                {formatSensor(data?.rain, "mm/jam")}
              </strong>
              <small>Sensor Tipping Bucket</small>
            </div>

            <div className="monitor-card">
              <div className="monitor-icon">
                <i className="bi bi-cloud-sun"></i>
              </div>
              <span>Suhu Surabaya</span>
              <strong id="lidahCityTemp">
                {formatSensor(cityWeather.temperature, "°C")}
              </strong>
              <small>Data lingkungan kota</small>
            </div>

            <div className="monitor-card">
              <div className="monitor-icon">
                <i className="bi bi-cloud-drizzle"></i>
              </div>
              <span>Kelembaban Surabaya</span>
              <strong id="lidahCityHumidity">
                {formatSensor(cityWeather.humidity, "%")}
              </strong>
              <small>Data lingkungan kota</small>
            </div>
          </div>

          {/* =================================================
               GRAFIK MONITORING
          ================================================== */}
          <div className="section-title">
            <h3>Grafik Monitoring</h3>
            <span>Update 5 detik</span>
          </div>

          <div className="charts-grid">
            <div className="chart-card">
              <div className="chart-header">
                <div>
                  <h4>Ketinggian Air</h4>
                  <span>cm</span>
                </div>
                <i className="bi bi-water"></i>
              </div>
              <div className="chart-wrapper">
                <canvas id="lidahWaterChart" ref={waterChartRef}></canvas>
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-header">
                <div>
                  <h4>Suhu</h4>
                  <span>°C</span>
                </div>
                <i className="bi bi-thermometer-half"></i>
              </div>
              <div className="chart-wrapper">
                <canvas id="lidahTempChart" ref={tempChartRef}></canvas>
              </div>
            </div>

            <div className="chart-card">
              <div className="chart-header">
                <div>
                  <h4>Kelembaban Tanah</h4>
                  <span>%</span>
                </div>
                <i className="bi bi-moisture"></i>
              </div>
              <div className="chart-wrapper">
                <canvas id="lidahSoilChart" ref={soilChartRef}></canvas>
              </div>
            </div>
          </div>

          {/* =================================================
               TABEL PENGUKURAN REAL-TIME (SESUAI SCREENSHOT TPS)
          ================================================== */}
          <div className="realtime-table-card">
            <div className="realtime-table-toolbar">
              <div className="realtime-table-title-area">
                <div className="realtime-table-title">Data pengukuran real-time</div>
                <div className="realtime-table-subtitle">Urutan terbaru lebih dahulu</div>
              </div>
              <div className="realtime-table-actions">
                <span className="realtime-table-filter-label">Data per hari</span>
                <select
                  className="realtime-table-select"
                  value={rowsLimit}
                  onChange={(e) =>
                    setRowsLimit(e.target.value === "all" ? "all" : Number(e.target.value))
                  }
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                </select>
                <button
                  className="realtime-btn-refresh"
                  onClick={handleManualRefresh}
                  title="Segarkan Data"
                >
                  <i className={`bi bi-arrow-clockwise ${isRefreshing ? "spin-animation" : ""}`}></i>
                </button>
                <button
                  className="realtime-btn-export"
                  onClick={downloadHistoryCSV}
                  title="Ekspor CSV"
                >
                  <i className="bi bi-download"></i>
                  <span>Ekspor CSV</span>
                </button>
                <button
                  className="realtime-btn-monthly"
                  onClick={() => setIsDownloadModalOpen(true)}
                  title="Unduh Laporan Bulanan"
                  aria-label="Unduh Laporan Bulanan"
                >
                  <i className="bi bi-file-earmark-spreadsheet"></i>
                </button>
              </div>
            </div>

            <div className="ussc-table-scroll realtime-table-wrapper">
              <table className="ussc-data-table realtime-data-table">
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ width: "45px" }}>No</th>
                    <th rowSpan={2} style={{ minWidth: "155px" }}>Timestamp</th>
                    <th rowSpan={2} style={{ minWidth: "140px" }}>Ketinggian Air (cm)</th>
                    <th colSpan={4}>Parameter Lingkungan</th>
                    <th rowSpan={2} style={{ minWidth: "100px" }}>Status</th>
                  </tr>
                  <tr>
                    <th style={{ minWidth: "100px" }}>Suhu Udara (°C)</th>
                    <th style={{ minWidth: "100px" }}>Suhu Air (°C)</th>
                    <th style={{ minWidth: "135px" }}>Kelembaban Tanah (%)</th>
                    <th style={{ minWidth: "85px" }}>pH Air</th>
                  </tr>
                </thead>
                <tbody id="lidahHistoryBody">
                  {displayedRows && displayedRows.length > 0 ? (
                    displayedRows.map((item, index) => {
                      const itemStatus = (item.status || "AMAN").toUpperCase();
                      const badgeClass = getTableBadgeClass(itemStatus);
                      const displayTimestamp =
                        item.timestamp ||
                        (item.date && item.time
                           ? `${item.date} ${item.time}`
                           : `${todayDate} ${item.time || "--:--"}`);

                      const waterVal =
                        item.water !== undefined && item.water !== "" && !isNaN(Number(item.water))
                          ? Number(item.water).toFixed(1)
                          : "--";
                      const tempVal =
                        item.temp !== undefined && item.temp !== "" && item.temp !== "--" && !isNaN(Number(item.temp))
                          ? Number(item.temp).toFixed(1)
                          : "--";
                      const tempWaterVal =
                        item.temp_water !== undefined && item.temp_water !== "" && item.temp_water !== "--" && !isNaN(Number(item.temp_water))
                          ? Number(item.temp_water).toFixed(1)
                          : item.suhu_air !== undefined && item.suhu_air !== "" && item.suhu_air !== "--" && !isNaN(Number(item.suhu_air))
                          ? Number(item.suhu_air).toFixed(1)
                          : item.suhu_air_2 !== undefined && item.suhu_air_2 !== "" && item.suhu_air_2 !== "--" && !isNaN(Number(item.suhu_air_2))
                          ? Number(item.suhu_air_2).toFixed(1)
                          : "--";
                      const soilVal =
                        item.soil !== undefined && item.soil !== "" && item.soil !== "--" && !isNaN(Number(item.soil))
                          ? Number(item.soil).toFixed(1)
                          : "--";
                      const phVal =
                        item.ph !== undefined && item.ph !== "" && item.ph !== "--" && !isNaN(Number(item.ph))
                          ? Number(item.ph).toFixed(1)
                          : "--";

                      return (
                        <tr key={index}>
                          <td className="realtime-cell-no">{index + 1}</td>
                          <td className="realtime-cell-mono realtime-cell-center">{displayTimestamp}</td>
                          <td className="realtime-cell-mono realtime-cell-center">{waterVal}</td>
                          <td className="realtime-cell-mono realtime-cell-center">{tempVal}</td>
                          <td className="realtime-cell-mono realtime-cell-center">{tempWaterVal}</td>
                          <td className="realtime-cell-mono realtime-cell-center">{soilVal}</td>
                          <td className="realtime-cell-mono realtime-cell-center">{phVal}</td>
                          <td className="realtime-cell-center">
                            <span className={`realtime-badge ${badgeClass}`}>
                              {itemStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        style={{
                          textAlign: "center",
                          padding: "24px",
                          color: "#94a3b8",
                        }}
                      >
                        Belum ada data pengukuran.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* =================================================
               KONDISI BOX PANEL (SUB BAB BARU)
          ================================================== */}
          <div className="section-title panel-section-title">
            <h3>Kondisi Box Panel</h3>
            <span>Internal ESP32</span>
          </div>

          <div className="panel-box-card">
            <div className="panel-box-header">
              <div className="panel-box-title">
                <i className="bi bi-hdd-network"></i>
                <span>Monitoring Box Panel Kontrol</span>
              </div>
              <span className="panel-box-badge">ESP32 &bull; DHT11</span>
            </div>
            <div className="panel-box-content">
              <div className="panel-box-item">
                <div className="panel-box-item-left">
                  <div className="panel-icon cpu">
                    <i className="bi bi-cpu"></i>
                  </div>
                  <div>
                    <span className="panel-item-label">Suhu Panel</span>
                    <small className="panel-item-sensor">Sensor DHT11</small>
                  </div>
                </div>
                <strong className="panel-item-value" id="lidahPanelTemp">
                  {formatSensor(data?.temp_panel, "°C")}
                </strong>
              </div>

              <div className="panel-box-divider"></div>

              <div className="panel-box-item">
                <div className="panel-box-item-left">
                  <div className="panel-icon moisture">
                    <i className="bi bi-droplet-half"></i>
                  </div>
                  <div>
                    <span className="panel-item-label">Kelembaban Panel</span>
                    <small className="panel-item-sensor">Sensor DHT11</small>
                  </div>
                </div>
                <strong className="panel-item-value" id="lidahPanelHumidity">
                  {formatSensor(data?.hum_panel, "%")}
                </strong>
              </div>
            </div>
          </div>
        </section>
      </div>
        {/* MODAL UNDUH LAPORAN */}
        <FloodDownloadModal
          isOpen={isDownloadModalOpen}
          onClose={() => setIsDownloadModalOpen(false)}
          locationKey="lidah"
          locationName="Kampus Lidah Wetan"
        />

    </MainLayout>
  );
}
