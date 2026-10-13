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
  pm01?: number;
  pm1?: number;
  pm02?: number;
  pm25?: number;
  pm10?: number;
  co2?: number;
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

      // 2. Ambil Kualitas Udara
      try {
        const now = new Date();
        const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
          now.getDate()
        ).padStart(2, "0")}`;

        const airRes = await ApiService.getAirQuality(today);
        if (airRes?.latest) {
          setAir(airRes.latest);
        } else if (airRes?.data) {
          setAir(airRes.data);
        }
      } catch (e) {
        console.warn("[Dashboard] Air API warning:", e);
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

  const lidahLightClass = getStatusClass(statusLidah, isLidahConnected);
  const ketintangLightClass = getStatusClass(statusKetintang, isKetintangConnected);

  // Evaluasi Agregat Dashboard Utama
  let finalFloodStatus = "--";
  let finalFloodDesc = "Menunggu data sensor...";
  let floodTextColor = "#64748b";

  if ((!statusLidah || statusLidah === "--") && (!statusKetintang || statusKetintang === "--")) {
    finalFloodStatus = "--";
    finalFloodDesc = "Sensor belum terhubung / offline";
    floodTextColor = "#64748b";
  } else if (statusLidah === "BAHAYA" && statusKetintang === "BAHAYA") {
    finalFloodStatus = "BAHAYA";
    finalFloodDesc = "2 Lokasi Kondisi BAHAYA";
    floodTextColor = "#ef4444";
  } else if (statusLidah === "BAHAYA" || statusKetintang === "BAHAYA") {
    finalFloodStatus = "BAHAYA";
    finalFloodDesc =
      statusLidah === "BAHAYA"
        ? "Lidah Wetan kondisi BAHAYA"
        : "Ketintang kondisi BAHAYA";
    floodTextColor = "#ef4444";
  } else if (statusLidah === "WASPADA" && statusKetintang === "WASPADA") {
    finalFloodStatus = "WASPADA";
    finalFloodDesc = "2 Lokasi Kondisi Waspada";
    floodTextColor = "#f59e0b";
  } else if (statusLidah === "WASPADA" || statusKetintang === "WASPADA") {
    finalFloodStatus = "WASPADA";
    finalFloodDesc =
      statusLidah === "WASPADA"
        ? "Lidah Wetan kondisi Waspada"
        : "Ketintang kondisi Waspada";
    floodTextColor = "#f59e0b";
  } else if (statusLidah === "AMAN" && statusKetintang === "AMAN") {
    finalFloodStatus = "AMAN";
    finalFloodDesc = "2 Lokasi Kondisi AMAN";
    floodTextColor = "#10b981";
  } else if (statusLidah === "AMAN" || statusKetintang === "AMAN") {
    finalFloodStatus = "AMAN";
    finalFloodDesc =
      statusLidah === "AMAN"
        ? "Lidah Wetan AMAN (Ketintang menunggu data)"
        : "Ketintang AMAN (Lidah Wetan menunggu data)";
    floodTextColor = "#10b981";
  }

  /* =======================================================
   LOGIKA KUALITAS UDARA (SCORING)
======================================================= */

const pm1Val = air.pm01 ?? air.pm1 ?? 0;
const pm25Val = air.pm02 ?? air.pm25 ?? 0;
const pm10Val = air.pm10 ?? 0;
const co2Val = air.co2 ?? 0;

// jika nanti API sudah mengirim TVOC
const tvocVal = (air as any).tvoc ?? (air as any).tvoc_index ?? 0;
let airScore = 0;

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

// =======================
// STATUS AKHIR
// =======================

let airStatus = "BAIK";
let airTextColor = "#10b981";

if(airScore >= 6){
  airStatus = "BURUK";
  airTextColor = "#ef4444";
}
else if(airScore >= 3){
  airStatus = "WASPADA";
  airTextColor = "#f59e0b";
}
else{
  airStatus = "BAIK";
  airTextColor = "#10b981";
}

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

  const lidahSoil = flood?.lidah?.kelembapan_tanah ?? flood?.lidah?.soil;
  const ketintangSoil = flood?.ketintang?.kelembapan_tanah ?? flood?.ketintang?.soil;

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
            <div className="last-update">
              <i className="bi bi-arrow-repeat"></i> Update otomatis
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

            <div className="summary-card">
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
                <small>Kondisi udara kampus</small>
              </div>
            </div>

            <div className="summary-card summary-card-ph">
              <div className="summary-icon green">
                <i className="bi bi-droplet-half"></i>
              </div>
              <div>
                <span>Sensor pH</span>
                <strong
                  id="dashboardPhStatus"
                  style={{ color: phTextColor }}
                >
                  {phValueDisplay}
                </strong>
                <small id="dashboardPhDesc">{phDesc}</small>
              </div>
            </div>

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

          {/* =================================================
               DASHBOARD: LINGKUNGAN KAMPUS (Kualitas Udara)
          ================================================== */}
          <div className="section-title">
            <h3>Lingkungan Kampus</h3>
            <span>Data terbaru</span>
          </div>

          <div className="environment-grid">
            <div className="metric-card">
              <i className="bi bi-circle"></i>
              <span>PM1.0</span>
              <strong id="dashboardPM1">
                {pm1Val ? `${Number(pm1Val).toFixed(1)} µg/m³` : "-- µg/m³"}
              </strong>
            </div>
            <div className="metric-card">
              <i className="bi bi-circle-half"></i>
              <span>PM2.5</span>
              <strong id="dashboardPM25">
                {pm25Val ? `${Number(pm25Val).toFixed(1)} µg/m³` : "-- µg/m³"}
              </strong>
            </div>
            <div className="metric-card">
              <i className="bi bi-cloud"></i>
              <span>PM10</span>
              <strong id="dashboardPM10">
                {pm10Val ? `${Number(pm10Val).toFixed(1)} µg/m³` : "-- µg/m³"}
              </strong>
            </div>
            <div className="metric-card">
              <i className="bi bi-cloud-haze2"></i>
              <span>CO₂</span>
              <strong id="dashboardCO2">
                {co2Val ? `${Math.round(Number(co2Val))} ppm` : "-- ppm"}
              </strong>
            </div>
          </div>
        </section>
      </div>
    </MainLayout>
  );
}