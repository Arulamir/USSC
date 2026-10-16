"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import MainLayout from "./components/layout/MainLayout";
import { ApiService } from "../lib/api";
import "./dashboard.css";

type TrafficData = {
  motor?: number;
  mobil?: number;
  bus?: number;
  truck?: number;
  total?: number;
  emisimotor?: number;
  emisimobil?: number;
  emisibus?: number;
  emisitruck?: number;
  emisitotal?: number;
};

type AirData = {
  pm01?: number | null;
  pm1?: number| null;
  pm02?: number | null;
  pm25?: number| null;
  pm10?: number | null;
  co2?: number | null;
  tvoc?: number | null;
  humidity?: number | null;

  timestamp?: string | null;
  created_at?: string | null;
  recorded_at?: string | null;
  calculated_at?: string | null;
};

type AirHourlyData = {
  id: number;
  hour_start: string;
  hour_end: string;
  pm01_avg: number | null;
  pm02_avg: number | null;
  pm10_avg: number | null;
  co2_avg: number | null;
  tvoc_avg: number | null;
  humidity_avg: number | null;
  sample_count: number;
  calculated_at: string;
};

type FloodLocation = {
  jarak?: number;
  suhu_udara?: number;
  kelembapan_tanah?: number;
  soil?: number;
  rain?: number;
  status?: string;
  ph?: number | null;
  ph_adc?: number;
  ph_voltage?: number;
  status_ph?: string;
  suhu_air?: number;
  suhu_air_1?: number;
  suhu_air_2?: number;
  curah_hujan_per_jam?: number;
};

type FloodResponseData = {
  lidah?: FloodLocation | null;
  ketintang?: FloodLocation | null;
};

export default function Home() {
  const router = useRouter();

  const [traffic, setTraffic] = useState<TrafficData>({});
  const [air, setAir] = useState<AirData>({});
  const [flood, setFlood] = useState<FloodResponseData>({});
  const [loading, setLoading] = useState(true);

  /* =======================================================
     LOAD DATA DARI API
     ======================================================= */
  const loadData = useCallback(async () => {
    try {
      // 1. Ambil Traffic / Kendaraan & Emisi
      try {
        const trafficRes = await ApiService.getTrafficData();
        if (trafficRes) {
          const vSummary = trafficRes?.vehicle?.summary || {};
          const eSummary = trafficRes?.emission?.summary || {};

          setTraffic({
            motor: vSummary.motor ?? trafficRes.motor ?? 0,
            mobil: vSummary.mobil ?? trafficRes.mobil ?? 0,
            bus: vSummary.bus ?? trafficRes.bus ?? 0,
            truck: vSummary.truck ?? trafficRes.truck ?? 0,
            total: vSummary.total ?? trafficRes.total ?? 0,
            emisimotor: eSummary.motor ?? trafficRes.emisimotor ?? 0,
            emisimobil: eSummary.mobil ?? trafficRes.emisimobil ?? 0,
            emisibus: eSummary.bus ?? trafficRes.emisibus ?? 0,
            emisitruck: eSummary.truck ?? trafficRes.emisitruck ?? 0,
            emisitotal: eSummary.total ?? trafficRes.emisitotal ?? 0,
          });
        }
      } catch (e) {
        console.warn("[Dashboard] Traffic API warning:", e);
      }

      
      
        // 2. Ambil kualitas udara dari tabel agregat per jam
      try {
        // Gunakan tanggal lokal WIB, bukan tanggal UTC.
        const getLocalDateString = (date: Date) => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");

          return `${year}-${month}-${day}`;
        };

        const now = new Date();

        const today = getLocalDateString(now);

        // Tanggal kemarin untuk fallback saat pergantian hari.
        const yesterdayDate = new Date(now);
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);

        const yesterday = getLocalDateString(yesterdayDate);

        // Ambil data agregat hari ini terlebih dahulu.
        const hourlyRes = await ApiService.getAirQualityHourly(today);

        let hourlyData: AirHourlyData[] =
          Array.isArray(hourlyRes?.data)
            ? hourlyRes.data
            : [];

        let usingYesterdayData = false;

        // Jika hari ini belum memiliki data, gunakan data kemarin.
        if (hourlyData.length === 0) {
          console.info(
            "[Dashboard] Data hari ini kosong, mengambil data kemarin:",
            yesterday
          );

          const yesterdayRes =
            await ApiService.getAirQualityHourly(yesterday);

          const yesterdayData: AirHourlyData[] =
            Array.isArray(yesterdayRes?.data)
              ? yesterdayRes.data
              : [];

          if (yesterdayData.length > 0) {
            hourlyData = yesterdayData;
            usingYesterdayData = true;
          }
        }

        // Simpan data yang tersedia untuk kebutuhan chart.
        setAirHourly(hourlyData);

        if (hourlyData.length > 0) {
          // Urutkan agar data paling baru berada di urutan pertama.
          const latest = [...hourlyData].sort(
            (a, b) =>
              new Date(b.hour_start).getTime() -
              new Date(a.hour_start).getTime()
          )[0];

          // Saat menggunakan data kemarin, waktu tampil di dashboard
          // menjadi pukul 00.00 WIB pada tanggal hari ini.
          const displayTimestamp = usingYesterdayData
            ? `${today}T00:00:00+07:00`
            : latest.hour_end;

          setAir({
            pm01: latest.pm01_avg,
            pm02: latest.pm02_avg,
            pm25: latest.pm02_avg,
            pm10: latest.pm10_avg,
            co2: latest.co2_avg,
            tvoc: latest.tvoc_avg,
            humidity: latest.humidity_avg,
            timestamp: displayTimestamp,
            calculated_at: latest.calculated_at,
          });
        } else {
          console.warn(
            "[Dashboard] Data kualitas udara hari ini dan kemarin tidak tersedia."
          );
        }
      } catch (e) {
        console.warn(
          "[Dashboard] Air hourly API warning:",
          e
        );
      }




      // 3. Ambil Status Banjir
      try {
        const floodRes = await ApiService.getFloodStatus();
        if (floodRes?.data) {
          setFlood(floodRes.data);
        }
      } catch (e) {
        console.warn("[Dashboard] Flood API warning:", e);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 4000);
    return () => clearInterval(interval);
  }, [loadData]);

  /* =======================================================
     LOGIKA STATUS BANJIR & AGREGAT (SESUAI MIAW.JS)
     ======================================================= */
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

  const isLidahConnected = Boolean(
    flood?.lidah &&
      flood.lidah.jarak !== null &&
      flood.lidah.jarak !== undefined &&
      !isNaN(Number(flood.lidah.jarak))
  );

  const isKetintangConnected = Boolean(
    flood?.ketintang &&
      flood.ketintang.jarak !== null &&
      flood.ketintang.jarak !== undefined &&
      !isNaN(Number(flood.ketintang.jarak))
  );

  const getStatusClass = (status: string, isConnected: boolean) => {
    if (!isConnected || status === "--") return "offline";
    if (status === "BAHAYA") return "danger";
    if (status === "WASPADA") return "warning";
    if (status === "AMAN") return "safe";
    return "safe";
  };

  const statusLidah = determineFloodStatus(flood?.lidah?.jarak, flood?.lidah?.status);
  const statusKetintang = determineFloodStatus(flood?.ketintang?.jarak, flood?.ketintang?.status);
  const lidahSoil = flood?.lidah?.kelembapan_tanah ?? flood?.lidah?.soil;
  const ketintangSoil = flood?.ketintang?.kelembapan_tanah ?? flood?.ketintang?.soil;
  const lidahLightClass = getStatusClass(statusLidah, isLidahConnected);
  const ketintangLightClass = getStatusClass(statusKetintang, isKetintangConnected);
  
  const [isAirPopupDark, setIsAirPopupDark] = useState(false);
  const [airUpdatedAt, setAirUpdatedAt] = useState<string | null>(null);
  let airScore = 0;
  const [airHourly, setAirHourly] = useState<AirHourlyData[]>([]);
  const [selectedHour, setSelectedHour] =
    useState<AirHourlyData | null>(null);
  const [showAirPopup, setShowAirPopup] = useState(false);
  const pm1Val = air.pm01 ?? air.pm1 ?? 0;
  const pm25Val = air.pm02 ?? air.pm25 ?? 0;
  const pm10Val = air.pm10 ?? 0;
  const co2Val = air.co2 ?? 0;
  const tvocVal = (air as any).tvoc ?? (air as any).tvoc_index ?? 0;
  


  // Evaluasi Agregat Dashboard Utama
  let finalFloodStatus = "--";
  let finalFloodDesc = "Menunggu data sensor...";
  let floodTextColor = "#64748b";

  if ((!statusLidah || statusLidah === "--") && (!statusKetintang || statusKetintang === "--")) {
    finalFloodStatus = "--";
    finalFloodDesc = "Sensor offline";
    floodTextColor = "#64748b";
  } else if (statusLidah === "BAHAYA" && statusKetintang === "BAHAYA") {
    finalFloodStatus = "BAHAYA";
    finalFloodDesc = "2 lokasi bahaya";
    floodTextColor = "#ef4444";
  } else if (statusLidah === "BAHAYA" || statusKetintang === "BAHAYA") {
    finalFloodStatus = "BAHAYA";
    finalFloodDesc =
      statusLidah === "BAHAYA"
        ? "Lidah Wetan bahaya"
        : "Ketintang bahaya";
    floodTextColor = "#ef4444";
  } else if (statusLidah === "WASPADA" && statusKetintang === "WASPADA") {
    finalFloodStatus = "WASPADA";
    finalFloodDesc = "2 lokasi waspada";
    floodTextColor = "#f59e0b";
  } else if (statusLidah === "WASPADA" || statusKetintang === "WASPADA") {
    finalFloodStatus = "WASPADA";
    finalFloodDesc =
      statusLidah === "WASPADA"
        ? "Lidah Wetan waspada"
        : "Ketintang waspada";
    floodTextColor = "#f59e0b";
  } else if (statusLidah === "AMAN" && statusKetintang === "AMAN") {
    finalFloodStatus = "AMAN";
    finalFloodDesc = "2 lokasi aman";
    floodTextColor = "#10b981";
  } else if (statusLidah === "AMAN" || statusKetintang === "AMAN") {
    finalFloodStatus = "AMAN";
    finalFloodDesc =
      statusLidah === "AMAN"
        ? "Lidah Wetan aman"
        : "Ketintang aman";
    floodTextColor = "#10b981";
  }


// =======================
// PM2.5 (bobot terbesar)
// =======================
if(pm25Val > 55){airScore += 4;}
else if(pm25Val > 35){
airScore += 2;
}

// =======================
// PM10
// =======================
if(pm10Val > 150){airScore += 2;}
else if(pm10Val > 50){
  airScore += 1;
}

// =======================
// CO2
// =======================
if(co2Val > 1000){airScore += 2;}
else if(co2Val > 800){
  airScore += 1;
}

// =======================
// TVOC
// =======================
if(tvocVal > 300){airScore += 2;}
else if(tvocVal > 100){
  airScore += 1;
}

const airStatus = getAirStatus(airScore);
const airTextColor = getAirColor(airStatus); 
const airStatusDescription = getAirStatusDescription(airStatus);


function getAirStatusDescription(status: AirStatus): string {
  switch (status) {
    case "BAIK":
      return "";

    case "SEDANG":
      return "Tingkat kualitas udara masih dapat diterima bagi kesehatan manusia, hewan, dan tumbuhan.";

    case "TIDAK SEHAT":
      return "Tingkat kualitas udara yang dapat merugikan kesehatan manusia, hewan, dan tumbuhan.";

    case "SANGAT TIDAK SEHAT":
      return "Tingkat kualitas udara yang dapat meningkatkan risiko kesehatan pada sejumlah segmen populasi yang terpapar.";

    case "BERBAHAYA":
      return "Tingkat kualitas udara yang dapat menimbulkan dampak serius terhadap kesehatan masyarakat dan memerlukan penanganan segera.";

    default:
      return "";
  }
}

  

type AirStatus =
  | "BAIK"
  | "SEDANG"
  | "TIDAK SEHAT"
  | "SANGAT TIDAK SEHAT"
  | "BERBAHAYA";

function getAirStatus(score: number): AirStatus {
  if (score <= 2) return "BAIK";
  if (score <= 4) return "SEDANG";
  if (score <= 6) return "TIDAK SEHAT";
  if (score <= 8) return "SANGAT TIDAK SEHAT";
  return "BERBAHAYA";
}

function getAirColor(status: AirStatus): string {
  switch (status) {
    case "BAIK":
      return "#22c55e";
    case "SEDANG":
      return "#facc15";
    case "TIDAK SEHAT":
      return "#ef4444";
    case "SANGAT TIDAK SEHAT":
      return "#7f1d1d";
    case "BERBAHAYA":
      return "#171717";
  }
}


function getSensorColor(name: string, value: number): string {
  // Warna bertingkat:
  // hijau -> kuning -> oranye -> merah -> merah tua -> hitam
  const levels: Record<string, number[]> = {
    "PM1.0": [15, 30, 55, 90, 150],
    "PM2.5": [15, 35, 55, 75, 150],
    "PM10": [50, 100, 150, 250, 350],
    "CO₂": [800, 1000, 1500, 2000, 3000],
    "TVOC": [100, 300, 500, 1000, 2000],
  };

  const colors = [
    "#22c55e", // Hijau: aman
    "#facc15", // Kuning: mulai meningkat
    "#f97316", // Oranye: perlu perhatian
    "#ef4444", // Merah: tidak sehat
    "#7f1d1d", // Merah tua: sangat tidak sehat
    "#171717", // Hitam: sangat tinggi
  ];

  // Kelembapan tidak menggunakan aturan polutan.
  // Rentang 30-60% dijadikan rentang nyaman secara visual.
  if (name === "Kelembapan") {
    if (value >= 30 && value <= 60) return colors[0];
    if ((value >= 20 && value < 30) ||
        (value > 60 && value <= 70)) return colors[1];
    if ((value >= 10 && value < 20) ||
        (value > 70 && value <= 80)) return colors[2];
    if ((value >= 5 && value < 10) ||
        (value > 80 && value <= 90)) return colors[3];
    if (value >= 0 && value < 5) return colors[4];
    return colors[5];
  }

  const thresholds = levels[name];

  // Jika nama sensor tidak dikenal, gunakan warna hijau.
  if (!thresholds) return colors[0];

  if (value <= thresholds[0]) return colors[0];
  if (value <= thresholds[1]) return colors[1];
  if (value <= thresholds[2]) return colors[2];
  if (value <= thresholds[3]) return colors[3];
  if (value <= thresholds[4]) return colors[4];

  return colors[5];
}

const airChartItems = [
  {
    name: "PM1.0",
    value: air.pm01 ?? air.pm1 ?? null,
    unit: "µg/m³",
    max: 100,
    color: "#3b82f6",
  },
  {
    name: "PM2.5",
    value: air.pm02 ?? air.pm25 ?? null,
    unit: "µg/m³",
    max: 150,
    color: "#8b5cf6",
  },
  {
    name: "PM10",
    value: air.pm10 ?? null,
    unit: "µg/m³",
    max: 200,
    color: "#f59e0b",
  },
  {
    name: "CO₂",
    value: air.co2 ?? null,
    unit: "ppm",
    max: 2000,
    color: "#ef4444",
  },
  {
    name: "TVOC",
    value: air.tvoc ?? null,
    unit: "ppb",
    max: 500,
    color: "#14b8a6",
  },
  {
    name: "RH",
    value: air.humidity ?? null,
    unit: "%",
    max: 100,
    color: "#06b6d4",
  },
];


  /* =======================================================
     LOGIKA EVALUASI SENSOR pH AIR / LINGKUNGAN
     Thresholds:
     - < 5.0      : BERBAHAYA (Merah)
     - 5.0 - 6.5  : CENDERUNG ASAM (Amber)
     - 6.5 - 8.5  : NORMAL (Hijau)
     - 8.5 - 9.0  : CENDERUNG BASA (Cyan)
     - > 9.0      : BERBAHAYA (Merah)
     ======================================================= */
  const lidahPh =
    flood?.lidah?.ph !== undefined &&
    flood?.lidah?.ph !== null &&
    !isNaN(Number(flood.lidah.ph))
      ? Number(flood.lidah.ph)
      : null;

  const ketintangPh =
    flood?.ketintang?.ph !== undefined &&
    flood?.ketintang?.ph !== null &&
    !isNaN(Number(flood.ketintang.ph))
      ? Number(flood.ketintang.ph)
      : null;

  let activePh: number | null = null;
  let phLocationLabel = "";

  if (lidahPh !== null && ketintangPh !== null) {
    activePh = Number(((lidahPh + ketintangPh) / 2).toFixed(2));
    phLocationLabel = "2 Lokasi Terpantau";
  } else if (lidahPh !== null) {
    activePh = Number(lidahPh.toFixed(2));
    phLocationLabel = "Lidah Wetan";
  } else if (ketintangPh !== null) {
    activePh = Number(ketintangPh.toFixed(2));
    phLocationLabel = "Ketintang";
  }

  let phValueDisplay = "-- pH";
  let phTextColor = "#64748b";
  let phDesc = "Menunggu data sensor...";

  if (activePh !== null) {
    phValueDisplay = `${activePh.toFixed(1)} pH`;
    if (activePh < 5.0) {
      phTextColor = "#ef4444";
      phDesc = `Sangat Asam (${phLocationLabel})`;
    } else if (activePh <= 6.5) {
      phTextColor = "#f59e0b";
      phDesc = `Cenderung Asam (${phLocationLabel})`;
    } else if (activePh <= 8.5) {
      phTextColor = "#10b981";
      phDesc = `Kondisi Netral (${phLocationLabel})`;
    } else if (activePh <= 9.0) {
      phTextColor = "#06b6d4";
      phDesc = `Cenderung Basa (${phLocationLabel})`;
    } else {
      phTextColor = "#ef4444";
      phDesc = `Sangat Basa (${phLocationLabel})`;
    }
  }

  /* =======================================================
     LOGIKA KENDARAAN & EMISI (SESUAI MIAW.JS)
     ======================================================= */
  const totalVehicles =
    traffic.total ??
    ((traffic.motor ?? 0) +
      (traffic.mobil ?? 0) +
      (traffic.bus ?? 0) +
      (traffic.truck ?? 0));

  const totalEmission =
    traffic.emisitotal ??
    ((traffic.emisimotor ?? 0) +
      (traffic.emisimobil ?? 0) +
      (traffic.emisibus ?? 0) +
      (traffic.emisitruck ?? 0));

  const formatSensorValue = (val?: number | string | null, unit = "") => {
    if (val === undefined || val === null || val === "" || isNaN(Number(val))) {
      return `-- ${unit}`.trim();
    }
    return `${Number(val).toFixed(1)} ${unit}`.trim();
  };

 
  return (
    <MainLayout>
      <div className="dashboard-page-container">
        <section className="page active" id="page-dashboard">
          {/* =================================================
               PAGE HEADING
          ================================================== */}
          <div className="page-heading">
            <div>
              <span className="eyebrow">OVERVIEW</span>
              <h2>Dashboard Utama</h2>
              <p>Ringkasan kondisi lingkungan kampus secara real-time.</p>
            </div>
          </div>

          {/* =================================================
               DASHBOARD SUMMARY STATUS
               Desktop: 1 Baris (5 Kartu Utama)
               Mobile/Tablet: 2 Kelompok (Lingkungan & Mobilitas)
          ================================================== */}
          <div className="summary-grid">
            <div className="summary-card">
              <div className="summary-icon blue">
                <i className="bi bi-water"></i>
              </div>
              <div>
                <span>Pemantauan Banjir</span>
                <strong
                  id="dashboardFloodStatus"
                  style={{ color: floodTextColor }}
                >
                  {finalFloodStatus}
                </strong>
                <small id="dashboardFloodDesc">{finalFloodDesc}</small>
              </div>
            </div>
            
            <button
              type="button"
              className="summary-card air-summary-card"
              onClick={() => setShowAirPopup(true)}
              aria-label="Buka detail kualitas udara"
            >
              <div className="summary-icon green">
                <i className="bi bi-wind"></i>
              </div>

              <div>
                <span>Kualitas Udara</span>
                <strong
                  id="dashboardAirStatus"
                  style={{ color: airTextColor }}
                >
                  {airStatus}
                </strong>
                <small>lihat detail cuaca</small>
              </div>
              <i className="bi bi-chevron-right air-card-arrow"></i>
            </button>

            

            <div className="summary-card">
              <div className="summary-icon green">
                <i className="bi bi-car-front"></i>
              </div>
              <div>
                <span>Total Kendaraan</span>
                <strong id="dashboardVehicleTotal">
                  {loading ? "0" : totalVehicles}
                </strong>
                <small>Kendaraan terpantau</small>
              </div>
            </div>

            <div className="summary-card">
              <div className="summary-icon green">
                <i className="bi bi-cloud-haze2"></i>
              </div>
              <div>
                <span>Emisi Karbon</span>
                <strong id="dashboardEmission">
                  {loading ? "0 g/Km" : `${Number(totalEmission).toFixed(1)} g/Km`}
                </strong>
                <small>Total emisi kendaraan</small>
              </div>
            </div>
            
            {showAirPopup && (
              <div
                className="air-popup-overlay"
                onClick={() => setShowAirPopup(false)}
              >
                <div
                  className="air-popup"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="air-popup-title"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="air-popup-header">
                    <button
                      type="button"
                      className="air-popup-close"
                      onClick={() => setShowAirPopup(false)}
                      aria-label="Tutup popup"
                    >
                      <i className="bi bi-x-lg"></i>
                    </button>
                  </div>
                  
                    <div className="air-popup-status">
                    <div className="air-popup-status-content">
                      <div className="air-popup-status-heading">
                        <span className="air-popup-title">
                          Status kualitas udara saat ini
                        </span>

                        <span className="air-popup-updated">
                          <i className="bi bi-clock-history"></i>

                          {(() => {
                            const rawTimestamp =
                              air.timestamp ??
                              air.created_at ??
                              air.recorded_at;

                            if (!rawTimestamp) {
                              return "Waktu data tidak tersedia";
                            }

                            const date = new Date(rawTimestamp);

                            if (Number.isNaN(date.getTime())) {
                              return "Format waktu tidak valid";
                            }

                            return (
                              date.toLocaleString("id-ID", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false,
                                timeZone: "Asia/Jakarta",
                              }) + " WIB"
                            );
                          })()}
                        </span>
                      </div>

                      <strong style={{ color: airTextColor }}>
                        {airStatus}
                      </strong>

                      <small>
                        Skor sensor: {airScore} / 10
                      </small>
                    </div>

  <div className="air-popup-status-icon">
    <i className="bi bi-wind"></i>
  </div>
</div>




                  <div className="air-vertical-layout">
                    {/* DIAGRAM BATANG VERTIKAL */}
                    <div className="air-vertical-chart">
                      <h3>Parameter Sensor</h3>
                      <p className="air-chart-subtitle">
                        Nilai terkini setiap sensor
                      </p>

                      <div className="air-vertical-bars">
                        {airChartItems.map((item) => {
                          const hasValue =
                            item.value !== null &&
                            item.value !== undefined &&
                            Number.isFinite(Number(item.value));

                          const numericValue = hasValue
                            ? Number(item.value)
                            : 0;

                          const barHeight = hasValue
                            ? Math.min(
                                100,
                                Math.max(
                                  numericValue > 0 ? 2 : 0,
                                  (numericValue / item.max) * 100
                                )
                              )
                            : 0;

                          return (
                            <div
                              className="air-vertical-item"
                              key={item.name}
                            >
                              <span className="air-vertical-value">
                                {hasValue
                                  ? numericValue.toLocaleString("id-ID", {
                                      maximumFractionDigits: 1,
                                    })
                                  : "--"}
                              </span>

                              <div className="air-vertical-track">
                                {hasValue && (
                                  <div
                                    className="air-vertical-fill"
                                    style={{
                                      height: `${barHeight}%`,
                                      backgroundColor: hasValue
                                        ? getSensorColor(item.name, numericValue)
                                        : "transparent",
                                      transition: "height 0.4s ease, background-color 0.4s ease",
                                    }}
                                  />
                                )}
                              </div>

                              <strong className="air-vertical-name">
                                {item.name}
                              </strong>

                              <span className="air-vertical-unit">
                                {item.unit}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* SKALA STATUS DI SAMPING GRAFIK */}
                    <div className="air-quality-scale">
                      <h3>Indeks</h3>

                      {([
                        {
                          name: "BERBAHAYA",
                          min: 9,
                          max: 10,
                          color: "#171717",
                        },
                        {
                          name: "SANGAT TIDAK SEHAT",
                          min: 7,
                          max: 8,
                          color: "#7f1d1d",
                        },
                        {
                          name: "TIDAK SEHAT",
                          min: 5,
                          max: 6,
                          color: "#ef4444",
                        },
                        {
                          name: "SEDANG",
                          min: 3,
                          max: 4,
                          color: "#facc15",
                        },
                        {
                          name: "BAIK",
                          min: 0,
                          max: 2,
                          color: "#22c55e",
                        },
                      ]).map((level) => {
                        const active = level.name === airStatus;

                        return (
                          <div
                            key={level.name}
                            className={`air-scale-level ${
                              active ? "active" : ""
                            }`}
                          >
                            <span
                              className="air-scale-color"
                              style={{
                                backgroundColor: level.color,
                              }}
                            />

                            <div className="air-scale-text">
                              <strong>{level.name}</strong>
                              {active && (
                                <small>
                                  <i className="bi bi-check-circle-fill"></i>
                                  {" "}Saat ini
                                </small>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="air-popup-footer">
                    <i className="bi bi-info-circle"></i>
                    
                      <span>
                        {airStatusDescription}
                      </span>

                  </div>
                </div>
              </div>
            )}

          </div>

          {/* =================================================
               DASHBOARD: STATUS LOKASI BANJIR RINGKAS
          ================================================== */}
          <div className="section-title">
            <h3>Status Lokasi Banjir</h3>
            <span>Real-time</span>
          </div>

          <div className="location-grid">
            {/* Lokasi 1: Lidah Wetan */}
            <div className="location-card">
              <div className="location-header">
                <div>
                  <span className="location-label">LOKASI 01</span>
                  <h3>Lidah Wetan</h3>
                </div>
                <div
                  className={`status-light ${lidahLightClass}`}
                  id="dashboardLightLidah"
                  title={
                    isLidahConnected
                      ? `Device Terhubung (${statusLidah})`
                      : "Device Belum Terhubung (Offline)"
                  }
                ></div>
              </div>
              <div className="location-data">
                <div>
                  <span>Ketinggian Air</span>
                  <strong id="dashLidahWater">
                    {formatSensorValue(flood?.lidah?.jarak, "cm")}
                  </strong>
                </div>
                <div>
                  <span>Suhu</span>
                  <strong id="dashLidahTemp">
                    {formatSensorValue(flood?.lidah?.suhu_udara, "°C")}
                  </strong>
                </div>
                <div>
                  <span>Kelembaban Tanah</span>
                  <strong id="dashLidahSoil">
                    {formatSensorValue(lidahSoil, "%")}
                  </strong>
                </div>
              </div>
              <button
                className="detail-btn"
                data-page="lidah-wetan"
                onClick={() => router.push("/lidah-wetan")}
              >
                Lihat Detail <i className="bi bi-arrow-right"></i>
              </button>
            </div>

            {/* Lokasi 2: Ketintang */}
            <div className="location-card">
              <div className="location-header">
                <div>
                  <span className="location-label">LOKASI 02</span>
                  <h3>Ketintang</h3>
                </div>
                <div
                  className={`status-light ${ketintangLightClass}`}
                  id="dashboardLightKetintang"
                  title={
                    isKetintangConnected
                      ? `Device Terhubung (${statusKetintang})`
                      : "Device Belum Terhubung (Offline)"
                  }
                ></div>
              </div>
              <div className="location-data">
                <div>
                  <span>Ketinggian Air</span>
                  <strong id="dashKetintangWater">
                    {formatSensorValue(flood?.ketintang?.jarak, "cm")}
                  </strong>
                </div>
                <div>
                  <span>Suhu</span>
                  <strong id="dashKetintangTemp">
                    {formatSensorValue(flood?.ketintang?.suhu_udara, "°C")}
                  </strong>
                </div>
                <div>
                  <span>Kelembaban Tanah</span>
                  <strong id="dashKetintangSoil">
                    {formatSensorValue(ketintangSoil, "%")}
                  </strong>
                </div>
              </div>
              <button
                className="detail-btn"
                data-page="ketintang"
                onClick={() => router.push("/ketintang")}
              >
                Lihat Detail <i className="bi bi-arrow-right"></i>
              </button>
            </div>
          </div>

         

          
        </section>
      </div>
    </MainLayout>
  );
}