"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, registerables } from "chart.js";

import MainLayout from "../components/layout/MainLayout";
import "./traffic.css";

Chart.register(...registerables);

const API_URL = "/api/traffic-grafik";
const ROWS_PER_PAGE = 10;

type TrafficTableRow = {
  timestamp: string;
  motor: number;
  mobil: number;
  bus: number;
  truck: number;
  total: number;
};

type TrafficData = {
  status: string;
  selected_date?: string | null;
  available_dates?: string[];

  start_time?: string | null;
  end_time?: string | null;

  vehicle: {
    summary: {
      motor: number;
      mobil: number;
      bus: number;
      truck: number;
      total: number;
    };

    hourly: Array<{
    jam: number;
    motor: number;
    mobil: number;
    bus: number;
    truck: number;
    total: number;

    previous_total?: number | null;
    change?: number | null;
    reduction?: number | null;
  }>;

    table: TrafficTableRow[];
  };

  emission: {
    summary: {
      motor: number;
      mobil: number;
      bus: number;
      truck: number;
      total: number;
    };

    hourly: Array<{
      jam: number;
      total: number;
      previous_total?: number | null;
    }>;

    table: TrafficTableRow[];
  };
};

function formatDate(dateString?: string | null): string {
  if (!dateString) {
    return "--";
  }

  const parts = dateString.split("-");

  if (parts.length !== 3) {
    return dateString;
  }

  const [year, month, day] = parts;

  const monthNames = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];

  const monthIndex = Number(month) - 1;

  if (monthIndex < 0 || monthIndex > 11) {
    return dateString;
  }

  return `${Number(day)} ${monthNames[monthIndex]} ${year}`;
}

function getTodayString(): string {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTimeAMPM(timeString?: string | null): string {
  if (!timeString) {
    return "--.--";
  }

  const match = timeString.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );

  if (!match) {
    return "--.--";
  }

  let hour = Number(match[1]);
  const minute = match[2];

  const period = hour >= 12 ? "PM" : "AM";

  hour = hour % 12;

  if (hour === 0) {
    hour = 12;
  }

  return `${String(hour).padStart(2, "0")}:${minute} ${period}`;
}

function formatTimestampAMPM(timestamp?: string | null): string {
  if (!timestamp) {
    return "--.--";
  }

  const match = timestamp.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );

  if (!match) {
    return "--.--";
  }

  let hour = Number(match[1]);
  const minute = match[2];

  const period = hour >= 12 ? "PM" : "AM";

  hour = hour % 12;

  if (hour === 0) {
    hour = 12;
  }

  return `${String(hour).padStart(2, "0")}:${minute} ${period}`;
}

function formatNumber(value: number): string {
  return Number(value || 0).toLocaleString("id-ID", {
    maximumFractionDigits: 0,
  });
}

function formatEmission(value: number): string {
  return Number(value || 0).toLocaleString("id-ID", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function getLatestTimestamp(
  vehicleTable: TrafficTableRow[],
  emissionTable: TrafficTableRow[]
): string {
  const timestamps = [
    ...vehicleTable.map((item) => item.timestamp),
    ...emissionTable.map((item) => item.timestamp),
  ].filter(Boolean);

  if (timestamps.length === 0) {
    return "--.--";
  }

  timestamps.sort((a, b) => {
    return (
      new Date(b).getTime() -
      new Date(a).getTime()
    );
  });

  return formatTimestampAMPM(timestamps[0]);
}


function downloadCSV(
  data: TrafficTableRow[],
  filename: string
) {
  if (!data || data.length === 0) return;

  const headers = [
    "No",
    "Waktu",
    "Motor",
    "Mobil",
    "Bus",
    "Truk",
    "Total",
  ];

  const csvRows = [
    headers.join(","),
    ...data.map((row, index) =>
      [
        index + 1,
        formatTimestampAMPM(row.timestamp),
        row.motor,
        row.mobil,
        row.bus,
        row.truck,
        row.total,
      ]
        .map((value) => {
          const escaped = String(value ?? "")
            .replace(/"/g, '""');

          return `"${escaped}"`;
        })
        .join(",")
    ),
  ];

  // BOM agar karakter terbaca dengan benar di Excel
  const csvContent =
    "\uFEFF" + csvRows.join("\r\n");

  const blob = new Blob(
    [csvContent],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export default function VehiclesPage() {
  /*
   * =========================================================
   * FILTER
   * =========================================================
   */

  const [dates, setDates] = useState<string[]>([]);

  const [selectedDate, setSelectedDate] =
    useState(getTodayString());

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  /*
   * =========================================================
   * DATA
   * =========================================================
   */

  const [data, setData] =
    useState<TrafficData | null>(null);

  const [lastUpdate, setLastUpdate] =
    useState("--.--");

  const [loadingDates, setLoadingDates] =
    useState(true);

  const [loadingData, setLoadingData] =
    useState(false);

  const [error, setError] = useState("");

  /*
   * =========================================================
   * PAGINATION
   * =========================================================
   */

  const [vehiclePage, setVehiclePage] = useState(1);
  const [emissionPage, setEmissionPage] = useState(1);

  /*
   * =========================================================
   * THEME
   * =========================================================
   *
   * Mengikuti pola Air Quality.
   * Chart.js tidak otomatis mengetahui perubahan
   * class "dark", sehingga kita pantau perubahan
   * class pada document.documentElement.
   */

  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(
        document.documentElement.classList.contains(
          "dark"
        )
      );
    };

    updateTheme();

    const observer = new MutationObserver(() => {
      updateTheme();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * =========================================================
   * CHART
   * =========================================================
   */

  const vehicleChartRef =
    useRef<HTMLCanvasElement | null>(null);

  const emissionChartRef =
    useRef<HTMLCanvasElement | null>(null);

  const vehicleChart =
    useRef<Chart | null>(null);

  const emissionChart =
    useRef<Chart | null>(null);

  const chartTimer =
    useRef<number | null>(null);

  /*
   * =========================================================
   * LOAD AVAILABLE DATES
   * =========================================================
   */

  async function loadDates() {
    try {
      setLoadingDates(true);
      setError("");

      const response = await fetch(API_URL, {
        cache: "no-store",
      });

     

      const result = await response.json();

      if (result.status !== "success") {
        throw new Error(
          result.message ||
            "Gagal mengambil daftar tanggal"
        );
      }

      const databaseDates: string[] =
        result.available_dates || [];

      const today = getTodayString();

      const mergedDates = Array.from(
        new Set([
          today,
          ...databaseDates,
        ])
      );

      mergedDates.sort((a, b) =>
        b.localeCompare(a)
      );

      setDates(mergedDates);
      setSelectedDate(today);
    } catch (error) {
      console.error(
        "Load tanggal traffic error:",
        error
      );

      setDates([getTodayString()]);
      setSelectedDate(getTodayString());
    } finally {
      setLoadingDates(false);
    }
  }

  const vehicleHourlyAnalysis = useMemo(() => {
  if (!data?.vehicle.hourly) {
    return [];
  }

  return [...data.vehicle.hourly]
    .sort((a, b) => Number(a.jam) - Number(b.jam))
    .filter((row) => Number(row.jam) >= 1)
    .map((row) => ({
      jam: Number(row.jam),
      motor: Number(row.motor || 0),
      mobil: Number(row.mobil || 0),
      bus: Number(row.bus || 0),
      truck: Number(row.truck || 0),
      total: Number(row.total || 0),
    }));
}, [data]);

const emissionHourlyAnalysis = useMemo(() => {
  if (!data?.emission.hourly) {
    return [];
  }

  return [...data.emission.hourly]
    .sort((a, b) => Number(a.jam) - Number(b.jam))
    .filter((row) => Number(row.jam) >= 1)
    .map((row) => ({
      jam: Number(row.jam),
      total: Number(row.total || 0),
    }));
}, [data]);
  /*
   * =========================================================
   * LOAD TRAFFIC DATA
   * =========================================================
   */

  async function loadTraffic() {
    if (!selectedDate) {
      return;
    }

    try {
      setLoadingData(true);
      setError("");

      const params = new URLSearchParams();

      params.append("date", selectedDate);

      if (startTime) {
        params.append("start", startTime);
      }

      if (endTime) {
        params.append("end", endTime);
      }

      const response = await fetch(
        `${API_URL}?${params.toString()}`,
        {
          cache: "no-store",
        }
      );

      const result: TrafficData =
        await response.json();

      if (result.status !== "success") {
        throw new Error(
          "Gagal mengambil data traffic"
        );
      }

      setData(result);

      setVehiclePage(1);
      setEmissionPage(1);

      const latest = getLatestTimestamp(
        result.vehicle?.table || [],
        result.emission?.table || []
      );

      setLastUpdate(latest);
    } catch (error) {
      console.error("Traffic monitoring error:", error);
      setData(null);
      setLastUpdate("--.--");

      // Jangan tampilkan error backend di halaman
    } finally {
      setLoadingData(false);
    }
  }

  /*
   * =========================================================
   * INITIAL LOAD
   * =========================================================
   */

  useEffect(() => {
    loadDates();
  }, []);

  /*
   * =========================================================
   * LOAD DATA KETIKA TANGGAL BERUBAH
   * =========================================================
   */

  useEffect(() => {
    if (!selectedDate || loadingDates) {
      return;
    }

    loadTraffic();
  }, [selectedDate, loadingDates]);

  /*
   * =========================================================
   * CHART
   * =========================================================
   *
   * Grafik mengikuti tema Air Quality:
   *
   * LIGHT:
   * - teks #475569
   * - grid rgba(100,116,139,0.45)
   *
   * DARK:
   * - teks #cbd5e1
   * - grid rgba(203,213,225,0.30)
   *
   * Jadi ketika dark mode aktif, grid tidak lagi
   * gelap/hilang.
   */

  useEffect(() => {
  if (!data) {
    if (vehicleChart.current) {
      vehicleChart.current.destroy();
      vehicleChart.current = null;
    }

    if (emissionChart.current) {
      emissionChart.current.destroy();
      emissionChart.current = null;
    }

    return;
  }

  if (chartTimer.current) {
    window.clearTimeout(chartTimer.current);
  }

  chartTimer.current = window.setTimeout(() => {

    /*
     * =====================================================
     * DATA VEHICLE
     * =====================================================
     *
     * Backend sekarang sudah mengirim:
     *
     * 09 → total kendaraan jam 09
     * 10 → total kendaraan jam 10
     * 11 → total kendaraan jam 11
     * 12 → total kendaraan jam 12
     *
     * Jadi TIDAK perlu loop 24 jam lagi.
     */

    const vehicleLabels =
      vehicleHourlyAnalysis.map(
        (item) =>
          `${String(item.jam).padStart(2, "0")}:00`
      );

    const vehicleValues =
  vehicleHourlyAnalysis.map(
    (item) => Math.round(item.total)
  );


    /*
     * =====================================================
     * DATA EMISSION
     * =====================================================
     *
     * Untuk emission sementara tetap menggunakan
     * data hourly dari backend.
     */

    // const emissionHours =
    //   [...data.emission.hourly]
    //     .sort(
    //       (a, b) =>
    //         Number(a.jam) - Number(b.jam)
    //     );

    const emissionLabels =
      emissionHourlyAnalysis.map(
        (item) =>
          `${String(item.jam).padStart(2, "0")}:00`
      );

    const emissionValues =
  emissionHourlyAnalysis.map(
    (item) => item.total
  );


    /*
     * =====================================================
     * WARNA CHART
     * =====================================================
     */

    const chartTextColor = isDark
      ? "#cbd5e1"
      : "#475569";

    const chartTitleColor = isDark
      ? "#e2e8f0"
      : "#334155";

    const chartGridColor = isDark
      ? "rgba(203, 213, 225, 0.30)"
      : "rgba(100, 116, 139, 0.45)";

    const chartBorderColor = isDark
      ? "#60a5fa"
      : "#0d6efd";

    const emissionBorderColor = isDark
      ? "#4ade80"
      : "#198754";

    const tooltipBackground = isDark
      ? "#0f172a"
      : "#ffffff";

    const tooltipBorder = isDark
      ? "#475569"
      : "#dee2e6";

    vehicleChart.current?.destroy();
    vehicleChart.current = null;

    emissionChart.current?.destroy();
    emissionChart.current = null;

    /*
     * =====================================================
     * VEHICLE CHART
     * =====================================================
     */

    if (vehicleChartRef.current) {

      vehicleChart.current = new Chart(
        vehicleChartRef.current,
        {
          type: "line",

          data: {
            labels: vehicleLabels,

            datasets: [
              {
                label: "Total Kendaraan",

                data: vehicleValues,

                borderColor:
                  chartBorderColor,

                backgroundColor:
                  isDark
                    ? "rgba(96, 165, 250, 0.12)"
                    : "rgba(13, 110, 253, 0.08)",

                borderWidth: 2,

                tension: 0.3,

                /*
                 * TITIK PER JAM
                 */
                pointRadius: 4,

                pointHoverRadius: 7,

                pointBackgroundColor:
                  chartBorderColor,

                pointBorderColor:
                  chartBorderColor,

                pointBorderWidth: 2,

                fill: false,
              },
            ],
          },

          options: {
            responsive: true,

            maintainAspectRatio: false,

            animation: false,

            interaction: {
              mode: "index",

              intersect: false,
            },

            plugins: {

              legend: {
                display: true,

                labels: {
                  color:
                    chartTextColor,

                  font: {
                    size: 12,
                  },

                  usePointStyle: true,

                  padding: 16,
                },
              },

              /*
               * =================================================
               * TOOLTIP VEHICLE
               * =================================================
               */
              tooltip: {
                enabled: true,
                backgroundColor:
                  tooltipBackground,
                titleColor:
                  chartTitleColor,
                bodyColor:
                  chartTextColor,
                borderColor:
                  tooltipBorder,
                borderWidth: 1,
                padding: 10,
                displayColors: false,

                callbacks: {

                  title: (tooltipItems) => {
                    return tooltipItems[0]
                      ?.label || "";
                  },

                  label: (context) => {

                    const index =
                      context.dataIndex;

                    const row =
                      vehicleHourlyAnalysis[
                        index
                      ];

                    if (!row) {
                      return "";
                    }

                    return [
                      `Total Kendaraan: ${formatNumber(
                        row.total
                      )}`,
                    ];
                  },
                },
              },
            },

            scales: {

              x: {
                title: {
                  display: true,

                  text: "Jam",

                  color:
                    chartTitleColor,

                  font: {
                    size: 12,

                    weight: 600,
                  },
                },

                ticks: {
                  color:
                    chartTextColor,

                  font: {
                    size: 11,
                  },
                },

                grid: {
                  display: true,

                  color:
                    chartGridColor,
                },

                border: {
                  color:
                    chartGridColor,
                },
              },

              y: {
                beginAtZero: true,

                title: {
                  display: true,

                  text: "Jumlah Kendaraan",

                  color:
                    chartTitleColor,

                  font: {
                    size: 12,

                    weight: 600,
                  },
                },

                ticks: {
                  color: chartTextColor,
                  font: {
                    size: 11,
                  },
                  precision: 0,
                  callback: (value) => Math.round(Number(value)).toString(),
                },

                grid: {
                  display: true,

                  color:
                    chartGridColor,
                },

                border: {
                  color:
                    chartGridColor,
                },
              },
            },
          },
        }
      );
    }

    /*
     * =====================================================
     * EMISSION CHART
     * =====================================================
     */

    if (emissionChartRef.current) {

      emissionChart.current = new Chart(
        emissionChartRef.current,
        {
          type: "line",

          data: {
            labels: emissionLabels,

            datasets: [
              {
                label: "Total Emisi",

                data: emissionValues,

                borderColor:
                  emissionBorderColor,

                backgroundColor:
                  isDark
                    ? "rgba(74, 222, 128, 0.12)"
                    : "rgba(25, 135, 84, 0.08)",

                borderWidth: 2,

                tension: 0.3,

                pointRadius: 4,

                pointHoverRadius: 7,

                pointBackgroundColor:
                  emissionBorderColor,

                pointBorderColor:
                  emissionBorderColor,

                pointBorderWidth: 2,

                fill: false,
              },
            ],
          },

          options: {
            responsive: true,

            maintainAspectRatio: false,

            animation: false,

            interaction: {
              mode: "index",

              intersect: false,
            },

            plugins: {

              legend: {
                display: true,

                labels: {
                  color:
                    chartTextColor,

                  font: {
                    size: 12,
                  },

                  usePointStyle: true,

                  padding: 16,
                },
              },

              tooltip: {
                enabled: true,
                backgroundColor: tooltipBackground,
                titleColor: chartTitleColor,
                bodyColor: chartTextColor,
                borderColor: tooltipBorder,
                borderWidth: 1,
                padding: 10,
                displayColors: false,

                callbacks: {
                  title: (tooltipItems) => {
                    return tooltipItems[0]?.label || "";
                  },

                  label: (context) => {
                    const index = context.dataIndex;

                    const row =
                      emissionHourlyAnalysis[index];

                    if (!row) {
                      return "";
                    }

                    return [
                      `Total Emisi: ${formatEmission(
                        row.total
                      )} g/km`,
                    ];
                  },
                },
              },
            },

            scales: {

              x: {
                title: {
                  display: true,

                  text: "Jam",

                  color:
                    chartTitleColor,

                  font: {
                    size: 12,

                    weight: 600,
                  },
                },

                ticks: {
                  color:
                    chartTextColor,

                  font: {
                    size: 11,
                  },
                },

                grid: {
                  display: true,

                  color:
                    chartGridColor,
                },

                border: {
                  color:
                    chartGridColor,
                },
              },

              y: {
                beginAtZero: true,

                title: {
                  display: true,

                  text: "Total Emisi",

                  color:
                    chartTitleColor,

                  font: {
                    size: 12,

                    weight: 600,
                  },
                },

                ticks: {
                  color:
                    chartTextColor,

                  font: {
                    size: 11,
                  },
                },

                grid: {
                  display: true,

                  color:
                    chartGridColor,
                },

                border: {
                  color:
                    chartGridColor,
                },
              },
            },
          },
        }
      );
    }

  }, 100);


  /*
   * =====================================================
   * CLEANUP
   * =====================================================
   */

  return () => {

    if (chartTimer.current) {

      window.clearTimeout(
        chartTimer.current
      );

      chartTimer.current = null;
    }

    vehicleChart.current?.destroy();

    vehicleChart.current = null;

    emissionChart.current?.destroy();

    emissionChart.current = null;
  };

}, [
  data,
  isDark,
  vehicleHourlyAnalysis,
  emissionHourlyAnalysis,
]);

  /*
   * =========================================================
   * SUMMARY
   * =========================================================
   */

  const vehicle =
    data?.vehicle.summary;

  const emission =
    data?.emission.summary;

  /*
   * =========================================================
   * TABLE DATA
   * =========================================================
   */

  const vehicleTable =
    data?.vehicle.table || [];

  const emissionTable =
    data?.emission.table || [];

  /*
   * =========================================================
   * PAGINATION
   * =========================================================
   */

  const vehicleTotalPages =
    Math.ceil(
      vehicleTable.length /
        ROWS_PER_PAGE
    );

  const emissionTotalPages =
    Math.ceil(
      emissionTable.length /
        ROWS_PER_PAGE
    );

  const vehicleStartIndex =
    (vehiclePage - 1) *
    ROWS_PER_PAGE;

  const emissionStartIndex =
    (emissionPage - 1) *
    ROWS_PER_PAGE;

  const vehiclePaginatedData =
    vehicleTable.slice(
      vehicleStartIndex,
      vehicleStartIndex +
        ROWS_PER_PAGE
    );

  const emissionPaginatedData =
    emissionTable.slice(
      emissionStartIndex,
      emissionStartIndex +
        ROWS_PER_PAGE
    );

  /*
   * =========================================================
   * FILTER INFO
   * =========================================================
   */

  const selectedTimeLabel =
    startTime || endTime
      ? `${formatTimeAMPM(
          startTime || "00:00"
        )} - ${formatTimeAMPM(
          endTime || "23:59"
        )}`
      : "12:00 AM - 11:59 PM";

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <MainLayout>
      <div className="traffic-page">
        <div className="traffic-container">

          {/* ==================================================
                     HEADER
                ================================================== */}

                <div className="page-heading">
                  <div>
                    <span className="eyebrow">KENDARAAN</span>
                    <h2>Pemantauan Kendaraan</h2>
                    <p>Monitoring Kendaraan Lingkungkan Kampus</p>
                  </div>
                  
                </div>


          {/* =================================================
              FILTER
          ================================================= */}

          <section className="traffic-card traffic-filter-card">
            <div className="traffic-card-body">

              <div className="traffic-grid traffic-filter-grid">

                {/* TANGGAL */}

                <div className="traffic-field traffic-field-date">

                  <label
                    htmlFor="dateSelect"
                    className="traffic-label"
                  >
                    <i className="bi bi-calendar3"></i>
                    Tanggal
                  </label>

                  <select
                    id="dateSelect"
                    className="traffic-control"
                    value={selectedDate}
                    onChange={(e) =>
                      setSelectedDate(
                        e.target.value
                      )
                    }
                    disabled={loadingDates}
                  >
                    {dates.map((date) => (
                      <option
                        key={date}
                        value={date}
                      >
                        {formatDate(date)}
                      </option>
                    ))}
                  </select>

                </div>

                {/* DARI JAM */}

                <div className="traffic-field">

                  <label
                    htmlFor="startTime"
                    className="traffic-label"
                  >
                    <i className="bi bi-clock"></i>
                    Dari Jam
                  </label>

                  <input
                    id="startTime"
                    type="time"
                    className="traffic-control"
                    value={startTime}
                    onChange={(e) =>
                      setStartTime(
                        e.target.value
                      )
                    }
                  />

                </div>

                {/* SAMPAI JAM */}

                <div className="traffic-field">

                  <label
                    htmlFor="endTime"
                    className="traffic-label"
                  >
                    <i className="bi bi-clock-history"></i>
                    Sampai Jam
                  </label>

                  <input
                    id="endTime"
                    type="time"
                    className="traffic-control"
                    value={endTime}
                    onChange={(e) =>
                      setEndTime(
                        e.target.value
                      )
                    }
                  />

                </div>

                {/* BUTTON */}

                <div className="traffic-field traffic-button-field">

                  <button
                    type="button"
                    className="traffic-button"
                    onClick={loadTraffic}
                    disabled={
                      loadingData ||
                      !selectedDate
                    }
                  >
                    <i className="bi bi-search traffic-icon-spacing"></i>
                    Tampilkan
                  </button>

                </div>

              </div>

            </div>
          </section>

          {/* =================================================
              INFO
          ================================================= */}

          <section className="traffic-card traffic-info-card">

            <div className="traffic-card-body">

              <div className="traffic-info-grid">

                <div>
                  <small className="traffic-muted">
                    Tanggal
                  </small>

                  <div className="aq-fw-semibold">
                    {formatDate(
                      selectedDate
                    )}
                  </div>
                </div>

                <div>
                  <small className="traffic-muted">
                    Rentang Waktu
                  </small>

                  <div className="traffic-fw-bold">
                    {selectedTimeLabel}
                  </div>
                </div>

                <div>
                  <small className="traffic-muted">
                    Update Terakhir
                  </small>

                  <div className="traffic-fw-bold">
                    {lastUpdate}
                  </div>
                </div>

              </div>

            </div>

          </section>

          {/* =================================================
              VEHICLE SUMMARY
          ================================================= */}

          <section className="traffic-section">

            <div className="traffic-section-title">
              🚗 Jumlah Kendaraan
            </div>

            <div className="traffic-summary-grid">

              {[
                ["Motor", vehicle?.motor],
                ["Mobil", vehicle?.mobil],
                ["Bus", vehicle?.bus],
                ["Truk", vehicle?.truck],
                ["Total Kendaraan", vehicle?.total],
              ].map(
                ([title, value]) => (
                  <div
                    className="traffic-summary-item"
                    key={String(title)}
                  >
                    <div className="traffic-card traffic-data-card">
                      <div className="traffic-card-body">

                        <h6>{title}</h6>

                        <h2>
                          {formatNumber(
                            Number(value || 0)
                          )}
                        </h2>

                        <span>
                          kendaraan
                        </span>

                      </div>
                    </div>
                  </div>
                )
              )}

            </div>

          </section>

          {/* =================================================
              EMISSION SUMMARY
          ================================================= */}

          <section className="traffic-section traffic-emission-section">

            <div className="traffic-section-title">
              🌫️ Emisi Kendaraan
            </div>

            <div className="traffic-summary-grid">

              {[
                ["Emisi Motor", emission?.motor],
                ["Emisi Mobil", emission?.mobil],
                ["Emisi Bus", emission?.bus],
                ["Emisi Truk", emission?.truck],
                ["Total Emisi", emission?.total],
              ].map(
                ([title, value]) => (
                  <div
                    className="traffic-summary-item"
                    key={String(title)}
                  >
                    <div className="traffic-card traffic-data-card">
                      <div className="traffic-card-body">

                        <h6>{title}</h6>

                        <h2>
                          {formatEmission(
                            Number(value || 0)
                          )}
                        </h2>

                        <span>
                          g/km
                        </span>

                      </div>
                    </div>
                  </div>
                )
              )}

            </div>

          </section>

          {/* =================================================
              VEHICLE CHART
          ================================================= */}

          <section className="traffic-card traffic-chart-card">

            <div className="traffic-card-header">
              📊 Grafik Jumlah Kendaraan Per Jam
            </div>

            <div className="traffic-card-body">

              <div className="traffic-chart-container">

                {data ? (
                  <canvas
                    ref={vehicleChartRef}
                  />
                ) : (
                  <div className="traffic-empty">
                    Tidak ada data
                  </div>
                )}

              </div>

            </div>

          </section>

          {/* =================================================
              EMISSION CHART
          ================================================= */}

          <section className="traffic-card traffic-chart-card">

            <div className="traffic-card-header">
              📈 Grafik Emisi Kendaraan Per Jam
            </div>

            <div className="traffic-card-body">

              <div className="traffic-chart-container">

                {data ? (
                  <canvas
                    ref={emissionChartRef}
                  />
                ) : (
                  <div className="traffic-empty">
                    Tidak ada data
                  </div>
                )}

              </div>

            </div>

          </section>

          {/* =================================================
              VEHICLE TABLE
          ================================================= */}

          <section className="traffic-card traffic-table-card">

            <div className="traffic-card-header traffic-table-header">
              <div>
                <i className="bi bi-car-front traffic-icon-spacing"></i>
                Riwayat Kendaraan
              </div>

              <button
                type="button"
                className="traffic-btn traffic-btn-success"
                onClick={() =>
                  downloadCSV(
                    vehicleTable,
                    `vehicle-${selectedDate}.csv`
                  )
                }
                disabled={
                  loadingData ||
                  vehicleTable.length === 0
                }
              >
                <i className="bi bi-download traffic-icon-spacing"></i>
                Download CSV
              </button>
            </div>

            <div className="traffic-card-body">

              <div className="traffic-table-wrapper">

                <table className="traffic-table">

                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Waktu</th>
                      <th>Motor</th>
                      <th>Mobil</th>
                      <th>Bus</th>
                      <th>Truk</th>
                      <th>Total</th>
                    </tr>
                  </thead>

                  <tbody>

                    {vehiclePaginatedData.length > 0 ? (
                      vehiclePaginatedData.map(
                        (item, index) => (
                          <tr
                            key={`${item.timestamp}-${index}`}
                          >
                            <td>
                              {vehicleStartIndex +
                                index +
                                1}
                            </td>

                            <td>
                              {formatTimestampAMPM(
                                item.timestamp
                              )}
                            </td>

                            <td>{item.motor}</td>
                            <td>{item.mobil}</td>
                            <td>{item.bus}</td>
                            <td>{item.truck}</td>
                            <td>{item.total}</td>
                          </tr>
                        )
                      )
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="traffic-empty"
                        >
                          Tidak ada data
                        </td>
                      </tr>
                    )}

                  </tbody>

                </table>

              </div>

              {vehicleTotalPages > 1 && (
                <div className="traffic-pagination">

                  <div className="traffic-pagination-buttons">

                    <button
                      type="button"
                      disabled={
                        vehiclePage === 1
                      }
                      onClick={() =>
                        setVehiclePage(
                          (page) =>
                            page - 1
                        )
                      }
                    >
                      ‹
                    </button>

                    {Array.from(
                      {
                        length:
                          vehicleTotalPages,
                      },
                      (_, index) =>
                        index + 1
                    ).map((page) => (
                      <button
                        type="button"
                        key={page}
                        className={
                          vehiclePage === page
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          setVehiclePage(
                            page
                          )
                        }
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      type="button"
                      disabled={
                        vehiclePage ===
                        vehicleTotalPages
                      }
                      onClick={() =>
                        setVehiclePage(
                          (page) =>
                            page + 1
                        )
                      }
                    >
                      ›
                    </button>

                  </div>

                </div>
              )}

            </div>

          </section> 

          {/* =================================================
              EMISSION TABLE
          ================================================= */}

          <section className="traffic-card traffic-table-card">
            <div className="traffic-card-header traffic-table-header">
              <div>
                🌫️ Riwayat Emisi Kendaraan
              </div>

              <button
                type="button"
                className="traffic-btn traffic-btn-success"
                onClick={() =>
                  downloadCSV(
                    emissionTable,
                    `emission-${selectedDate}.csv`
                  )
                }
                disabled={
                  loadingData ||
                  emissionTable.length === 0
                }
              >
                <i className="bi bi-download traffic-icon-spacing"></i>
                Download CSV
              </button>
            </div>


            <div className="traffic-card-body">

              <div className="traffic-table-wrapper">

                <table className="traffic-table">

                  <thead>
                    <tr>
                      <th>No</th>
                      <th>Waktu</th>
                      <th>Motor</th>
                      <th>Mobil</th>
                      <th>Bus</th>
                      <th>Truk</th>
                      <th>Total</th>
                    </tr>
                  </thead>

                  <tbody>

                    {emissionPaginatedData.length > 0 ? (
                      emissionPaginatedData.map(
                        (item, index) => (
                          <tr
                            key={`${item.timestamp}-${index}`}
                          >
                            <td>
                              {emissionStartIndex +
                                index +
                                1}
                            </td>

                            <td>
                              {formatTimestampAMPM(
                                item.timestamp
                              )}
                            </td>

                            <td>{item.motor}</td>
                            <td>{item.mobil}</td>
                            <td>{item.bus}</td>
                            <td>{item.truck}</td>
                            <td>{item.total}</td>
                          </tr>
                        )
                      )
                    ) : (
                      <tr>
                        <td
                          colSpan={7}
                          className="traffic-empty"
                        >
                          Tidak ada data
                        </td>
                      </tr>
                    )}

                  </tbody>

                </table>

              </div>

              {emissionTotalPages > 1 && (
                <div className="traffic-pagination">

                  <div className="traffic-pagination-buttons">

                    <button
                      type="button"
                      disabled={
                        emissionPage === 1
                      }
                      onClick={() =>
                        setEmissionPage(
                          (page) =>
                            page - 1
                        )
                      }
                    >
                      ‹
                    </button>

                    {Array.from(
                      {
                        length:
                          emissionTotalPages,
                      },
                      (_, index) =>
                        index + 1
                    ).map((page) => (
                      <button
                        type="button"
                        key={page}
                        className={
                          emissionPage === page
                            ? "active"
                            : ""
                        }
                        onClick={() =>
                          setEmissionPage(
                            page
                          )
                        }
                      >
                        {page}
                      </button>
                    ))}

                    <button
                      type="button"
                      disabled={
                        emissionPage ===
                        emissionTotalPages
                      }
                      onClick={() =>
                        setEmissionPage(
                          (page) =>
                            page + 1
                        )
                      }
                    >
                      ›
                    </button>

                  </div>

                </div>
              )}

            </div>

          </section>

        </div>
      </div>
    </MainLayout>
  );
}