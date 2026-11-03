"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import MainLayout from "./components/layout/MainLayout";
import SmartOfficeMonitoring from "./components/dashboard/SmartOfficeMonitoring";
import ConfigurableMonitoring from "./components/dashboard/ConfigurableMonitoring";
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

type CameraTraffic = {
  motor: number;
  mobil: number;
  bus: number;
  truck: number;
  total: number;
};

type CameraEmission = {
  emisimotor: number;
  emisimobil: number;
  emisibus: number;
  emisitruck: number;
  emisitotal: number;
};

type AirData = {
  // pm01?: number | null;
  // pm1?: number| null;
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
  // pm01_avg: number | null;
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
  const [trafficByCamera, setTrafficByCamera] = useState<{CAM01: CameraTraffic | null;CAM02: CameraTraffic | null;}>({CAM01: null,CAM02: null,});
  const [emissionByCamera, setEmissionByCamera] = useState<{CAM01: CameraEmission | null; CAM02: CameraEmission | null;}>({CAM01: null,CAM02: null,});
  const [showMobilityPopup, setShowMobilityPopup] = useState(false);
  // const [showVehiclePopup, setShowVehiclePopup] = useState(false);
  // const [showEmissionPopup, setShowEmissionPopup] = useState(false);
  /* =======================================================
     LOAD DATA DARI API trafic
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
          // const displayTimestamp = usingYesterdayData
          //   ? `${today}T00:00:00+07:00`
          //   : latest.hour_end;

          const displayTimestamp = latest.hour_end;

          setAir({
            // pm01: latest.pm01_avg,
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

  

  const loadCameraTraffic = useCallback(async () => {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Fungsi mengambil data dari satu kamera
  const getCamera = async (cameraId: "CAM01" | "CAM02") => {
    const response = await fetch(
      `/api/traffic-grafik?date=${date}&camera_id=${cameraId}`
    );

    if (!response.ok) {
      throw new Error(`Gagal mengambil data ${cameraId}`);
    }

    const result = await response.json();

    console.log(`[TRAFFIC ${cameraId}] Response API:`, result);
    console.log(`[TRAFFIC ${cameraId}] Hourly:`, result.vehicle?.hourly);

    if (result.status !== "success") {
      throw new Error(result.message || `API ${cameraId} gagal`);
    }

    const summary = result.vehicle?.summary;
    const emissionSummary = result.emission?.summary;

    const vehicle = {
      motor: Number(summary.motor ?? 0),
      mobil: Number(summary.mobil ?? 0),
      bus: Number(summary.bus ?? 0),
      truck: Number(summary.truck ?? 0),
      total: Number(summary.total ?? 0),
    };

    const emission: CameraEmission | null = emissionSummary
      ? {
          emisimotor: Number(emissionSummary.motor ?? 0),
          emisimobil: Number(emissionSummary.mobil ?? 0),
          emisibus: Number(emissionSummary.bus ?? 0),
          emisitruck: Number(
            emissionSummary.truck ?? emissionSummary.truk ?? 0
          ),
          emisitotal: Number(emissionSummary.total ?? 0),
        }
      : null;

    return { vehicle, emission };
  };


  // AMBIL DATA KEDUA KAMERA
  const results = await Promise.allSettled([
    getCamera("CAM01"),
    getCamera("CAM02"),
  ]);

  // SIMPAN DATA KENDARAAN
  setTrafficByCamera({
    CAM01:
      results[0].status === "fulfilled"
        ? results[0].value.vehicle
        : null,

    CAM02:
      results[1].status === "fulfilled"
        ? results[1].value.vehicle
        : null,
  });

  // SIMPAN DATA EMISI
  setEmissionByCamera({
    CAM01:
      results[0].status === "fulfilled"
        ? results[0].value.emission
        : null,

    CAM02:
      results[1].status === "fulfilled"
        ? results[1].value.emission
        : null,
  });
}, []);

  useEffect(() => {
  const refreshDashboard = () => {
    loadData();
    loadCameraTraffic();
  };

  refreshDashboard();

  const interval = setInterval(refreshDashboard, 4000);

  return () => clearInterval(interval);
}, [loadData, loadCameraTraffic]);

  



  /* =======================================================
     LOGIKA STATUS BANJIR & AGREGAT (SESUAI MIAW.JS)
     ======================================================= */
  const determineFloodStatus = (water?: number | null, explicitStatus?: string) => {
    if (explicitStatus) {
      const s = String(explicitStatus).trim().toUpperCase();
      if (s === "DARURAT" || s === "BAHAYA") return "DARURAT";
      if (s === "WASPADA") return "WASPADA";
      if (s === "NORMAL" || s === "AMAN") return "NORMAL";
    }
    if (water === null || water === undefined || isNaN(water)) return "--";
    if (water >= 65) return "DARURAT";
    if (water >= 40) return "WASPADA";
    return "NORMAL";
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
    if (status === "DARURAT" || status === "BAHAYA") return "danger";
    if (status === "WASPADA") return "warning";
    if (status === "NORMAL" || status === "AMAN") return "safe";
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
  const [selectedHour, setSelectedHour] = useState<AirHourlyData | null>(null);
  const [showAirPopup, setShowAirPopup] = useState(false);

  // const pm1Val = air.pm01 ?? air.pm1 ?? 0;
  const pm25Val = air.pm02 ?? air.pm25 ?? 0;
  const pm10Val = air.pm10 ?? 0;
  const co2Val = air.co2 ?? 0;
  const tvocVal = (air as any).tvoc ?? (air as any).tvoc_index ?? 0;
  // STATUS SENSOR AIR QUALITY
  const airValues = [air.pm02 ?? air.pm25,air.pm10,air.co2,air.tvoc,air.humidity,];

  const hasValidAirData = airValues.some((value) =>
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value)) &&
      Number(value) > 0);

  // Waktu pengukuran asli
  const airTimestamp = air.timestamp? new Date(air.timestamp).getTime(): NaN;

  // const isAirOnline = hasValidAirData && Number.isFinite(airTimestamp) && airTimestamp <= Date.now() + 60000 && Date.now() - airTimestamp <= 2 * 60 * 60 * 1000;
  // Data tersedia jika nilai rata-rata sensor valid
  const isAirOnline = hasValidAirData;

  // Evaluasi Agregat Dashboard Utama
  let finalFloodStatus = "--";
  let finalFloodDesc = "Menunggu data sensor...";
  let floodTextColor = "#64748b";

  if ((!statusLidah || statusLidah === "--") && (!statusKetintang || statusKetintang === "--")) {
    finalFloodStatus = "--";
    finalFloodDesc = "Sensor offline";
    floodTextColor = "#64748b";
  } else if (statusLidah === "DARURAT" && statusKetintang === "DARURAT") {
    finalFloodStatus = "DARURAT";
    finalFloodDesc = "2 lokasi darurat";
    floodTextColor = "#ef4444";
  } else if (statusLidah === "DARURAT" || statusKetintang === "DARURAT") {
    finalFloodStatus = "DARURAT";
    finalFloodDesc =
      statusLidah === "DARURAT"
        ? "Lidah Wetan darurat"
        : "Ketintang darurat";
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
  } else if (statusLidah === "NORMAL" && statusKetintang === "NORMAL") {
    finalFloodStatus = "NORMAL";
    finalFloodDesc = "2 lokasi normal";
    floodTextColor = "#10b981";
  } else if (statusLidah === "NORMAL" || statusKetintang === "NORMAL") {
    finalFloodStatus = "NORMAL";
    finalFloodDesc =
      statusLidah === "NORMAL"
        ? "Lidah Wetan normal"
        : "Ketintang normal";
    floodTextColor = "#10b981";
  }

const getSensorStatusLevel = (
  value: number,
  limits: [number, number, number, number]
): number => {
  if (value > limits[3]) return 4; // BERBAHAYA
  if (value > limits[2]) return 3; // SANGAT TIDAK SEHAT
  if (value > limits[1]) return 2; // TIDAK SEHAT
  if (value > limits[0]) return 1; // SEDANG
  return 0; // BAIK
};





function getSensorBarHeight(name: string, value: number): number {
  const limits: Record<string, [number, number, number, number]> = {
    "PM2.5": [50, 100, 200, 250],
    "PM10": [50, 100, 200, 300],
    "CO₂": [500, 700, 1200, 1500],
    "TVOC": [300, 500, 800, 1000],
  };

  // Kelembapan menggunakan skala persentase biasa
  if (name === "RH") {
    const level =
      value < 5 || value > 90 ? 4 :
      value < 10 || value > 80 ? 3 :
      value < 20 || value > 70 ? 2 :
      value < 30 || value > 60 ? 1 : 0;

    // Tinggi batang berdasarkan kategori
    const heights = [15, 35, 55, 75, 95];

    return heights[level];
  }

  const thresholds = limits[name];
  if (!thresholds) return 0;

  const level = getSensorStatusLevel(value, thresholds);

  const lower = level === 0 ? 0 : thresholds[level - 1];
  const upper =
    level === 4
      ? thresholds[3] + (thresholds[3] - thresholds[2])
      : thresholds[level];

  const progress = Math.min(
    1,
    Math.max(0, (value - lower) / (upper - lower))
  );

  // Setiap kategori mendapatkan rentang 20%
  return Math.min(100, level * 20 + progress * 20);
}

const airStatuses: AirStatus[] = [
  "BAIK",
  "SEDANG",
  "TIDAK SEHAT",
  "SANGAT TIDAK SEHAT",
  "BERBAHAYA",
];


// =======================
// RH (KELEMBAPAN)
// =======================

let rhScore = 0;
const rhVal = air.humidity ?? null;

if (rhVal !== null) {
  if (rhVal < 5 || rhVal > 90) {
    rhScore = 9;
  } else if (rhVal < 10 || rhVal > 80) {
    rhScore = 7;
  } else if (rhVal < 20 || rhVal > 70) {
    rhScore = 6;
  } else if (rhVal < 30 || rhVal > 60) {
    rhScore = 2;
  }
}

const rhLevel =
  rhScore === 9 ? 4 :
  rhScore === 7 ? 3 :
  rhScore === 6 ? 2 :
  rhScore === 2 ? 1 : 0;

const worstLevel = Math.max(
  getSensorStatusLevel(pm25Val, [50, 100, 200, 250]),
  getSensorStatusLevel(pm10Val, [50, 100, 200, 250]),
  getSensorStatusLevel(co2Val, [500, 600, 700, 800]),
  getSensorStatusLevel(tvocVal, [300, 500, 800, 1000]),
  rhLevel
);

const airStatus = isAirOnline
  ? airStatuses[worstLevel]
  : "--";

//pm2.5 35,55,75,100
//pm2.5 50,100,200,300

// =======================
// PM2.5
// =======================
if (pm25Val > 500) {
  airScore += 9;
} else if (pm25Val > 300) {
  airScore += 7;
} else if (pm25Val > 200) {
  airScore += 6;
} else if (pm25Val > 100) {
  airScore += 2;
} else if (pm25Val > 50) {
  airScore += 1;
}



// =======================
// PM10
// =======================
if (pm10Val > 350) {
  airScore += 9;
} else if (pm10Val > 300) {
  airScore += 7;
} else if (pm10Val > 200) {
  airScore += 6;
} else if (pm10Val > 100) {
  airScore += 2;
} else if (pm10Val > 50) {
  airScore += 1;
}

// =======================
// CO2
// =======================
if (co2Val > 3000) {
  airScore += 9;
} else if (co2Val > 2000) {
  airScore += 7;
} else if (co2Val > 1500) {
  airScore += 6;
} else if (co2Val > 1000) {
  airScore += 2;
} else if (co2Val > 800) {
  airScore += 1;
}

// =======================
// TVOC
// =======================
if (tvocVal > 1500) {
  airScore += 9;
} else if (tvocVal > 1000) {
  airScore += 7;
} else if (tvocVal > 800) {
  airScore += 6;
} else if (tvocVal > 500) {
  airScore += 2;
} else if (tvocVal > 300) {
  airScore += 1;
}









// const airStatus = isAirOnline? getAirStatus(airScore): "--";

const airTextColor = isAirOnline? getAirColor(airStatus as AirStatus): "#94a3b8";

const airStatusDescription = isAirOnline? getAirStatusDescription(airStatus as AirStatus)
  : "Sensor AirGradient sedang offline atau data pengukuran tidak tersedia.";

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
  if (score <= 3) return "BAIK";
  if (score <= 5) return "SEDANG";
  if (score <= 7) return "TIDAK SEHAT";
  if (score <= 9) return "SANGAT TIDAK SEHAT";
  return "BERBAHAYA";
}

function getAirColor(status: AirStatus): string {
  switch (status) {
    case "BAIK":
      return "#22c55e";
    case "SEDANG":
      return "#f59e0b";
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
  const limits: Record<string, [number, number, number, number]> = {
    // "PM1.0": [15, 30, 55, 90, 150],
    "PM2.5": [50, 100, 200, 250],
    "PM10": [50, 100, 200, 300],
    "CO₂": [500, 600, 700, 800],
    "TVOC": [300, 500, 800, 1000],
    
  };

  // const levels: Record<string, number[]> = {
  //   "PM1.0": [15, 30, 55, 90, 150],
  //   "PM2.5": [35, 55, 75, 100, 150],
  //   "PM10": [50, 100, 150, 250, 350],
  //   "CO₂": [800, 1000, 1500, 2000, 3000],
  //   "TVOC": [100, 300, 500, 1000, 2000],
  // };

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
   if (name === "RH") {
    let level = 0;

    if (value < 5 || value > 90) level = 4;
    else if (value < 10 || value > 80) level = 3;
    else if (value < 20 || value > 70) level = 2;
    else if (value < 30 || value > 60) level = 1;

    return colors[level];
  }

  const thresholds = limits[name];
  if (!thresholds) return colors[0];

  return colors[getSensorStatusLevel(value, thresholds)];
}

const airChartItems = [
  // {
  //   name: "PM1.0",
  //   value: air.pm01 ?? air.pm1 ?? null,
  //   unit: "µg/m³",
  //   max: 100,
  //   color: "#3b82f6",
  // },
  {
    name: "PM2.5",
    value: air.pm02 ?? air.pm25 ?? null,
    unit: "µg/m³",
    max: 500,
    color: "#8b5cf6",
  },
  {
    name: "PM10",
    value: air.pm10 ?? null,
    unit: "µg/m³",
    max: 500,
    color: "#f59e0b",
  },
  {
    name: "CO₂",
    value: air.co2 ?? null,
    unit: "ppm",
    max: 1000,
    color: "#ef4444",
  },
  {
    name: "TVOC",
    value: air.tvoc ?? null,
    unit: "ppb",
    max: 1000,
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

  const totalVehicleAll =
    trafficByCamera.CAM01 && trafficByCamera.CAM02
      ? trafficByCamera.CAM01.total + trafficByCamera.CAM02.total
      : null;

  const totalEmissionAll =
    emissionByCamera.CAM01 && emissionByCamera.CAM02
      ? emissionByCamera.CAM01.emisitotal +
        emissionByCamera.CAM02.emisitotal
      : null;

  const formatEmission = (value: number | null) =>
    value === null
      ? "--"
      : value.toLocaleString("id-ID", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        });


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
          <div className="summary-card flood-summary-card">
  <div className="flood-card-content">

    <span className="flood-card-title">
      PEMANTAUAN BANJIR
    </span>

    <div className="flood-card-main">
      <div className="summary-icon blue">
        <i className="bi bi-water"></i>
      </div>

      <div className="flood-card-info">
        <strong
          id="dashboardFloodStatus"
          style={{ color: floodTextColor }}
        >
          {finalFloodStatus}
        </strong>

        <small id="dashboardFloodDesc">
          {finalFloodDesc}
        </small>
      </div>
    </div>

  </div>
</div>
            
            <button
              type="button"
              className="summary-card air-summary-card"
              onClick={() => setShowAirPopup(true)}
              aria-label="Buka detail kualitas udara"
            >
              <div className="air-card-content">

                {/* JUDUL */}
                <span className="air-card-title">
                  KUALITAS UDARA
                </span>

                {/* IKON DAN STATUS */}
                <div className="air-card-main">
                  <div className="summary-icon green">
                    <i className="bi bi-wind"></i>
                  </div>

                  <div className="air-card-info">
                    <strong
                      id="dashboardAirStatus"
                      style={{ color: airTextColor }}
                    >
                      {airStatus}
                    </strong>

                    <small>Status Udara</small>
                  </div>
                </div>

                {/* LIHAT DETAIL DI BAWAH */}
                <small className="air-card-detail">
                  Lihat Detail
                </small>

              </div>

              {/* PANAH KANAN */}
              <i className="bi bi-chevron-right air-card-arrow"></i>
            </button>

            <button
              type="button"
              className="summary-card mobility-summary-card"
              onClick={() => setShowMobilityPopup(true)}
              aria-label="Lihat detail kendaraan dan emisi karbon"
            >
              <div className="mobility-content">
                <span className="mobility-title">
                  KENDARAAN & ESTIMASI JEJAK KARBON
                </span>

                <div className="mobility-stats">
                  <div className="mobility-stat">
                    <div className="summary-icon green">
                      <i className="bi bi-car-front"></i>
                    </div>

                    <div className="mobility-stat-info">
                      <strong>
                        {totalVehicleAll?.toLocaleString("id-ID") ?? "--"}
                      </strong>
                      <small>Kendaraan</small>
                    </div>
                  </div>

                  <div className="mobility-stat">
                    <div className="summary-icon green">
                      <i className="bi bi-cloud-haze2"></i>
                    </div>

                    <div className="mobility-stat-info">
                      <strong>{formatEmission(totalEmissionAll)}</strong>
                      <small>Estimasi Emisi</small>
                    </div>
                  </div>
                </div>

                <small className="vehicle-card-detail">
                  Lihat Detail
                </small>
              </div>

                

              

              <i className="bi bi-chevron-right vehicle-card-arrow"></i>
            </button>

            {showMobilityPopup && (
              <div
                className="vehicle-popup-overlay"
                onClick={() => setShowMobilityPopup(false)}
              >
                <div
                  className="vehicle-popup"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="mobility-popup-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="vehicle-popup-header">
                    <h3 id="mobility-popup-title">
                      Detail Kendaraan & Emisi Karbon
                    </h3>

                    <button
                      type="button"
                      onClick={() => setShowMobilityPopup(false)}
                      aria-label="Tutup popup"
                    >
                      <i className="bi bi-x-lg"></i>
                    </button>
                  </div>

                  <div className="vehicle-popup-total">
                    <span>Total Kendaraan Hari Ini</span>
                    <strong>
                      {totalVehicleAll?.toLocaleString("id-ID") ?? "--"}
                    </strong>

                    <span>Total Estimasi Emisi Karbon</span>
                    <strong>
                      {formatEmission(totalEmissionAll)} Metric Ton
                    </strong>
                  </div>

                  <div className="vehicle-popup-locations">
                    {(["CAM01", "CAM02"] as const).map((cameraId) => {
                      const vehicle = trafficByCamera[cameraId];
                      const emission = emissionByCamera[cameraId];

                      return (
                        <div key={cameraId}>
                          <span>
                            {cameraId === "CAM01"
                              ? "Lidah Wetan"
                              : "Ketintang"}
                          </span>

                          <small>{cameraId}</small>

                          <p>Total Kendaraan</p>
                          <strong>
                            {vehicle?.total.toLocaleString("id-ID") ?? "--"}
                          </strong>

                          <p>Estimasi Emisi Karbon</p>
                          <strong>
                            {formatEmission(emission?.emisitotal ?? null)}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}


            
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

                        <div className="air-popup-connection">

                          <span
                            className={`air-connection-badge ${
                              isAirOnline ? "online" : "offline"
                            }`}
                          >
                            <span className="air-connection-dot"></span>
                            {isAirOnline ? "ONLINE" : "OFFLINE"}
                          </span>

                          {isAirOnline && (
                            <span className="air-popup-updated">
                              <i className="bi bi-clock-history"></i>

                              {new Date(air.timestamp!).toLocaleString("id-ID", {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                                hour12: false,
                                timeZone: "Asia/Jakarta",
                              }) + " WIB"}
                            </span>
                          )}

                        </div>
                      </div>

                      <strong style={{ color: airTextColor }}>
                        {airStatus}
                      </strong>

                      {/* <small>
                        Skor sensor: {isAirOnline ? `${airScore} / 10` : "--"}
                      </small> */}
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
                          isAirOnline &&
                          item.value !== null &&
                          item.value !== undefined &&
                          Number.isFinite(Number(item.value)) &&
                          Number(item.value) > 0;

                          const numericValue = hasValue
                            ? Number(item.value)
                            : 0;

                          const barHeight = hasValue
                            ? Math.max(
                                2,
                                getSensorBarHeight(item.name, numericValue)
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
                        // {
                        //   name: "BERBAHAYA",
                        //   min: 9,
                        //   max: 10,
                        //   color: "#171717",
                        // },
                        // {
                        //   name: "SANGAT TIDAK SEHAT",
                        //   min: 7,
                        //   max: 8,
                        //   color: "#7f1d1d",
                        // },
                        // {
                        //   name: "TIDAK SEHAT",
                        //   min: 5,
                        //   max: 6,
                        //   color: "#ef4444",
                        // },
                        // {
                        //   name: "SEDANG",
                        //   min: 3,
                        //   max: 4,
                        //   color: "#facc15",
                        // },
                        // {
                        //   name: "BAIK",
                        //   min: 0,
                        //   max: 2,
                        //   color: "#22c55e",
                        // },
                        { name: "BERBAHAYA", color: "#171717" },
                        { name: "SANGAT TIDAK SEHAT", color: "#7f1d1d" },
                        { name: "TIDAK SEHAT", color: "#ef4444" },
                        { name: "SEDANG", color: "#facc15" },
                        { name: "BAIK", color: "#22c55e" },
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

          <SmartOfficeMonitoring />
          <ConfigurableMonitoring />
        </section>
      </div>
    </MainLayout>
  );
}
