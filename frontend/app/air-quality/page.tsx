"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  Title,
} from "chart.js";

import MainLayout from "../components/layout/MainLayout";
import "./airquality.css";

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  Title
);

const API_URL = "/api/airquality";
const ROWS_PER_PAGE = 10;

/*
 * =========================================================
 * TYPE
 * =========================================================
 */

type AirQualityRow = {
  timestamp?: string;

  pm01?: number | string | null;
  pm02?: number | string | null;
  pm10?: number | string | null;

  temperature?: number | string | null;
  humidity?: number | string | null;

  co2?: number | string | null;
  tvoc?: number | string | null;
  tvoc_index?: number | string | null;
  nox_index?: number | string | null;

  wifi?: string | number | null;
};

type LatestData = AirQualityRow | null;

type AirQualityResponse = {
  status?: string;
  message?: string;

  available_dates?: string[];

  selected_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;

  total?: number;

  latest?: LatestData;

  history?: AirQualityRow[];
};

/*
 * =========================================================
 * HELPER
 * =========================================================
 */

function formatNumber(value: unknown): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "--";
  }

  const number = Number(value);

  if (Number.isNaN(number)) {
    return "--";
  }

  return number.toLocaleString("id-ID", {
    maximumFractionDigits: 2,
  });
}

function toNumber(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  const number = Number(value);

  return Number.isNaN(number) ? 0 : number;
}

function formatDate(
  dateString?: string | null
): string {
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

  if (
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    return dateString;
  }

  return `${Number(day)} ${monthNames[monthIndex]} ${year}`;
}

function getTodayString(): string {
  const today = new Date();

  const year = today.getFullYear();

  const month = String(
    today.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    today.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatTime(
  timestamp?: string | null
): string {
  if (!timestamp) {
    return "--.--";
  }

  const match = timestamp.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );

  if (!match) {
    return "--.--";
  }

  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

function formatTimeAMPM(
  timeString?: string | null
): string {
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

  const period =
    hour >= 12 ? "PM" : "AM";

  hour = hour % 12;

  if (hour === 0) {
    hour = 12;
  }

  return `${String(hour).padStart(
    2,
    "0"
  )}:${minute} ${period}`;
}

function formatWifi(
  value: unknown
): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "--";
  }

  return String(value);
}

function downloadCSV(
  data: AirQualityRow[],
  filename: string
) {
  if (!data || data.length === 0) {
    return;
  }

  const headers = [
    "No",
    "Waktu",
    "PM1.0",
    "PM2.5",
    "PM10",
    "Temperature",
    "Humidity",
    "CO2",
    "TVOC",
    "TVOC Index",
    "NOx Index",
    "WiFi",
  ];

  const csvRows = [
    headers.join(","),

    ...data.map((row, index) => {
      const values = [
        index + 1,
        formatTime(row.timestamp),
        row.pm01 ?? "",
        row.pm02 ?? "",
        row.pm10 ?? "",
        row.temperature ?? "",
        row.humidity ?? "",
        row.co2 ?? "",
        row.tvoc ?? "",
        row.tvoc_index ?? "",
        row.nox_index ?? "",
        row.wifi ?? "",
      ];

      return values
        .map((value) =>
          `"${String(value).replace(/"/g, '""')}"`
        )
        .join(",");
    }),
  ];

  const csvContent =
    "\uFEFF" + csvRows.join("\n");

  const blob = new Blob(
    [csvContent],
    {
      type: "text/csv;charset=utf-8;",
    }
  );

  const url =
    URL.createObjectURL(blob);

  const link =
    document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/*
 * =========================================================
 * PAGE
 * =========================================================
 */

export default function AirQualityPage() {
  /*
   * -------------------------------------------------------
   * FILTER
   * -------------------------------------------------------
   */

  const [availableDates, setAvailableDates] =
    useState<string[]>([]);

  const [selectedDate, setSelectedDate] =
    useState("");

  const [startTime, setStartTime] =
    useState("");

  const [endTime, setEndTime] =
    useState("");

  /*
   * -------------------------------------------------------
   * INFO
   * -------------------------------------------------------
   */

  const [selectedDateLabel, setSelectedDateLabel] =
    useState("--");

  const [selectedTimeLabel, setSelectedTimeLabel] =
    useState(
      "12:00 AM - 11:59 PM"
    );

  const [latest, setLatest] =
    useState<LatestData>(null);

  /*
   * -------------------------------------------------------
   * DATA
   * -------------------------------------------------------
   */

  const [totalData, setTotalData] =
    useState(0);

  const [airQualityData, setAirQualityData] =
    useState<AirQualityRow[]>([]);

  /*
   * -------------------------------------------------------
   * PAGINATION
   * -------------------------------------------------------
   */

  const [currentPage, setCurrentPage] =
    useState(1);

  /*
   * -------------------------------------------------------
   * LOADING / ERROR
   * -------------------------------------------------------
   */

  const [loadingDates, setLoadingDates] =
    useState(true);

  const [loadingData, setLoadingData] =
    useState(false);

  const [error, setError] =
    useState("");

  /*
   * -------------------------------------------------------
   * DARK MODE
   * -------------------------------------------------------
   */

  const [isDark, setIsDark] =
    useState(false);

  /*
   * -------------------------------------------------------
   * CHART REFS
   * -------------------------------------------------------
   */

  const pmChartRef =
    useRef<HTMLCanvasElement | null>(null);

  const environmentChartRef =
    useRef<HTMLCanvasElement | null>(null);

  const gasChartRef =
    useRef<HTMLCanvasElement | null>(null);

  const pmChartInstance =
    useRef<Chart | null>(null);

  const environmentChartInstance =
    useRef<Chart | null>(null);

  const gasChartInstance =
    useRef<Chart | null>(null);

  /*
   * =========================================================
   * DARK MODE OBSERVER
   * =========================================================
   */

  useEffect(() => {
    const updateTheme = () => {
      setIsDark(
        document.documentElement.classList.contains(
          "dark"
        )
      );
    };

    updateTheme();

    const observer =
      new MutationObserver(() => {
        updateTheme();
      });

    observer.observe(
      document.documentElement,
      {
        attributes: true,
        attributeFilter: ["class"],
      }
    );

    return () => {
      observer.disconnect();
    };
  }, []);

  /*
   * =========================================================
   * LOAD AVAILABLE DATES
   * =========================================================
   */

  const loadAvailableDates =
    useCallback(async () => {
      try {
        setLoadingDates(true);
        setError("");

        const response =
          await fetch(API_URL, {
            cache: "no-store",
          });

        const result: AirQualityResponse =
          await response.json();

       

        const dates =
          result.available_dates || [];

        const today =
          getTodayString();

        const mergedDates =
          Array.from(
            new Set([
              today,
              ...dates,
            ])
          );

        mergedDates.sort((a, b) =>
          b.localeCompare(a)
        );

        setAvailableDates(
          mergedDates
        );

        setSelectedDate(today);

        setSelectedDateLabel(
          formatDate(today)
        );

      } catch (err) {
        console.error(
          "Load dates error:",
          err
        );

        const today =
          getTodayString();

        setAvailableDates([
          today,
        ]);

        setSelectedDate(today);

        setSelectedDateLabel(
          formatDate(today)
        );

       

      } finally {
        setLoadingDates(false);
      }
    }, []);

  /*
   * =========================================================
   * LOAD AIR QUALITY
   * =========================================================
   */

  const loadAirQuality =
    useCallback(async () => {
      if (!selectedDate) {
        return;
      }

      try {
        setLoadingData(true);
        setError("");

        const params =
          new URLSearchParams();

        params.append(
          "date",
          selectedDate
        );

        if (startTime) {
          params.append(
            "start",
            startTime
          );
        }

        if (endTime) {
          params.append(
            "end",
            endTime
          );
        }

        const response =
          await fetch(
            `${API_URL}?${params.toString()}`,
            {
              cache: "no-store",
            }
          );

    

        const result: AirQualityResponse =
          await response.json();

        if (
          result.status !== "success"
        ) {
          throw new Error(
            result.message ||
              "Gagal mengambil data"
          );
        }

        const history =
          result.history || [];

        setAirQualityData(
          history
        );

        setCurrentPage(1);

        setSelectedDateLabel(
          formatDate(
            result.selected_date ||
              selectedDate
          )
        );

        let timeText =
          "12:00 AM - 11:59 PM";

        if (
          result.start_time ||
          result.end_time
        ) {
          const start =
            result.start_time ||
            "00:00";

          const end =
            result.end_time ||
            "23:59";

          timeText =
            `${formatTimeAMPM(start)} - ${formatTimeAMPM(end)}`;

        } else if (
          startTime ||
          endTime
        ) {
          const start =
            startTime || "00:00";

          const end =
            endTime || "23:59";

          timeText =
            `${formatTimeAMPM(start)} - ${formatTimeAMPM(end)}`;
        }

        setSelectedTimeLabel(
          timeText
        );

        setTotalData(
          result.total !== undefined
            ? result.total
            : history.length
        );

        setLatest(
          result.latest || null
        );

      } catch (err) {
        console.error(
          "Air Quality API Error:",
          err
        );

        setError(
          err instanceof Error
            ? err.message
            : "Gagal mengambil data"
        );

        setAirQualityData([]);

        setLatest(null);

        setTotalData(0);

        setSelectedDateLabel(
          formatDate(selectedDate)
        );

        setSelectedTimeLabel(
          "12:00 AM - 11:59 PM"
        );

      } finally {
        setLoadingData(false);
      }
    }, [
      selectedDate,
      startTime,
      endTime,
    ]);

  /*
   * =========================================================
   * INITIAL LOAD
   * =========================================================
   */

  useEffect(() => {
    loadAvailableDates();
  }, [loadAvailableDates]);

  useEffect(() => {
    if (
      !selectedDate ||
      loadingDates
    ) {
      return;
    }

    loadAirQuality();
  }, [
    selectedDate,
    loadingDates,
    loadAirQuality,
  ]);

  /*
   * =========================================================
   * CHART DATA
   * =========================================================
   */

  const chartData: AirQualityRow[] =
    airQualityData.length > 0
      ? airQualityData
      : [
          {
            timestamp: "00:00",
            pm01: 0,
            pm02: 0,
            pm10: 0,
            temperature: 0,
            humidity: 0,
            co2: 0,
            tvoc: 0,
            nox_index: 0,
          },
        ];

  /*
   * =========================================================
   * PM CHART
   * =========================================================
   */

  useEffect(() => {
    if (!pmChartRef.current) {
      return;
    }

    if (
      pmChartInstance.current
    ) {
      pmChartInstance.current.destroy();
      pmChartInstance.current = null;
    }

    const labels =
      chartData.map((row) =>
        formatTime(row.timestamp)
      );

    const pm01 =
      chartData.map((row) =>
        toNumber(row.pm01)
      );

    const pm02 =
      chartData.map((row) =>
        toNumber(row.pm02)
      );

    const pm10 =
      chartData.map((row) =>
        toNumber(row.pm10)
      );

    pmChartInstance.current =
      new Chart(
        pmChartRef.current,
        {
          type: "line",

          data: {
            labels,

            datasets: [
              {
                label: "PM1.0",
                data: pm01,
                borderColor: "#0d6efd",
                pointBackgroundColor: "#0d6efd",
                pointBorderColor: "#0d6efd",
                borderWidth: 3,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5,
              },

              {
                label: "PM2.5",
                data: pm02,
                borderColor: "#198754",
                pointBackgroundColor: "#198754",
                pointBorderColor: "#198754",
                borderWidth: 3,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5,
              },

              {
                label: "PM10",
                data: pm10,
                borderColor: "#dc3545",
                pointBackgroundColor: "#dc3545",
                pointBorderColor: "#dc3545",
                borderWidth: 3,
                tension: 0.3,
                pointRadius: 2,
                pointHoverRadius: 5,
              },
            ],
          },

          options:
            getChartOptions(
              "µg/m³",
              isDark
            ),
        }
      );

    return () => {
      if (
        pmChartInstance.current
      ) {
        pmChartInstance.current.destroy();
        pmChartInstance.current = null;
      }
    };
  }, [
    airQualityData,
    isDark,
  ]);

  /*
   * =========================================================
   * ENVIRONMENT CHART
   * =========================================================
   */

  useEffect(() => {
    if (
      !environmentChartRef.current
    ) {
      return;
    }

    if (
      environmentChartInstance.current
    ) {
      environmentChartInstance.current.destroy();

      environmentChartInstance.current =
        null;
    }

    const labels =
      chartData.map((row) =>
        formatTime(row.timestamp)
      );

    const temperature =
      chartData.map((row) =>
        toNumber(row.temperature)
      );

    const humidity =
      chartData.map((row) =>
        toNumber(row.humidity)
      );

    const gridColor = isDark
      ? "rgba(203, 213, 225, 0.30)"
      : "rgba(100, 116, 139, 0.45)";

    const textColor = isDark
      ? "#cbd5e1"
      : "#475569";

    const titleColor = isDark
      ? "#e2e8f0"
      : "#334155";

    environmentChartInstance.current =
      new Chart(
        environmentChartRef.current,
        {
          type: "line",

          data: {
            labels,

            datasets: [
              {
                label:
                  "Temperature (°C)",

                data: temperature,

                borderColor:
                  "#0d6efd",
                pointBackgroundColor: "#0d6efd",
                pointBorderColor: "#0d6efd",
                  

                borderWidth: 3,

                tension: 0.3,

                pointRadius: 2,

                pointHoverRadius: 5,

                yAxisID:
                  "temperature",
              },

              {
                label:
                  "Humidity (%)",

                data: humidity,

                borderColor:
                  "#198754",
                pointBackgroundColor: "#198754",
                pointBorderColor: "#198754",

                borderWidth: 3,

                tension: 0.3,

                pointRadius: 2,

                pointHoverRadius: 5,

                yAxisID:
                  "humidity",
              },
            ],
          },

          options: {
            responsive: true,

            maintainAspectRatio: false,

            animation: false as const,

            interaction: {
              mode: "index" as const,
              intersect: false,
            },

            plugins: {
              legend: {
              display: true,
              labels: {
                color: textColor,
                usePointStyle: true,
                font: { size: 12 },
                padding: 16,
              },
            },

              tooltip: {
                enabled: true,
              },
            },

            scales: {
              x: {
                ticks: {
                  color:
                    textColor,
                },

                title: {
                  display: true,
                  text: "Waktu",
                  color:
                    titleColor,
                },

                grid: {
                  display: true,
                  color:
                    gridColor,
                  lineWidth: 1.5,
                  drawTicks: true,
                },
              },

              temperature: {
                type:
                  "linear" as const,

                position: "left",

                beginAtZero: true,

                min: 0,

                ticks: {
                  color:
                    textColor,
                },

                title: {
                  display: true,

                  text:
                    "Temperature (°C)",

                  color:
                    titleColor,
                },

                grid: {
                  display: true,

                  color:
                    gridColor,

                  lineWidth: 1.5,

                  drawTicks: true,
                },
              },

              humidity: {
                type:
                  "linear" as const,

                position: "right",

                beginAtZero: true,

                min: 0,

                ticks: {
                  color:
                    textColor,
                },

                title: {
                  display: true,

                  text:
                    "Humidity (%)",

                  color:
                    titleColor,
                },

                grid: {
                  display: false,

                  drawOnChartArea:
                    false,
                },
              },
            },
          },
        }
      );

    return () => {
      if (
        environmentChartInstance.current
      ) {
        environmentChartInstance.current.destroy();

        environmentChartInstance.current =
          null;
      }
    };
  }, [
    airQualityData,
    isDark,
  ]);

  /*
   * =========================================================
   * GAS CHART
   * =========================================================
   */

  useEffect(() => {
    if (
      !gasChartRef.current
    ) {
      return;
    }

    if (
      gasChartInstance.current
    ) {
      gasChartInstance.current.destroy();

      gasChartInstance.current =
        null;
    }

    const labels =
      chartData.map((row) =>
        formatTime(row.timestamp)
      );

    const co2 =
      chartData.map((row) =>
        toNumber(row.co2)
      );

    const tvoc =
      chartData.map((row) =>
        toNumber(row.tvoc)
      );

    const gridColor = isDark
      ? "rgba(203, 213, 225, 0.30)"
      : "rgba(100, 116, 139, 0.45)";

    const textColor = isDark
      ? "#cbd5e1"
      : "#475569";

    const titleColor = isDark
      ? "#e2e8f0"
      : "#334155";

    gasChartInstance.current =
      new Chart(
        gasChartRef.current,
        {
          type: "line",

          data: {
            labels,

            datasets: [
              {
                label:
                  "CO₂ (ppm)",

                data: co2,

                borderColor:
                  "#0d6efd",
                pointBackgroundColor: "#0d6efd",
                pointBorderColor: "#0d6efd",

                borderWidth: 3,

                tension: 0.3,

                pointRadius: 2,

                pointHoverRadius: 5,

                yAxisID: "co2",
              },

              {
                label:
                  "TVOC (ppb)",

                data: tvoc,

                borderColor:
                  "#198754",
                pointBackgroundColor: "#198754",
                pointBorderColor: "#198754",

                borderWidth: 3,

                tension: 0.3,

                pointRadius: 2,

                pointHoverRadius: 5,

                yAxisID: "tvoc",
              },
            ],
          },

          options: {
            responsive: true,

            maintainAspectRatio:
              false,

            animation:
              false as const,

            interaction: {
              mode:
                "index" as const,

              intersect: false,
            },

            plugins: {
              legend: {
              display: true,
              labels: {
                color: textColor,
                usePointStyle: true,
                font: { size: 12 },
                padding: 16,
              },
            },
            
           
      

            
              tooltip: {
                enabled: true,
              },
            },

            scales: {
              x: {
                ticks: {
                  color:
                    textColor,
                },

                title: {
                  display: true,

                  text:
                    "Waktu",

                  color:
                    titleColor,
                },

                grid: {
                  display: true,

                  color:
                    gridColor,

                  lineWidth: 1.5,

                  drawTicks: true,
                },
              },

              co2: {
                type:
                  "linear" as const,

                position: "left",

                beginAtZero: true,

                min: 0,

                ticks: {
                  color:
                    textColor,
                },

                title: {
                  display: true,

                  text:
                    "CO₂ (ppm)",

                  color:
                    titleColor,
                },

                grid: {
                  display: true,

                  color:
                    gridColor,

                  lineWidth: 1.5,

                  drawTicks: true,
                },
              },

              tvoc: {
                type:
                  "linear" as const,

                position: "right",

                beginAtZero: true,

                min: 0,

                ticks: {
                  color:
                    textColor,
                },

                title: {
                  display: true,

                  text:
                    "TVOC (ppb)",

                  color:
                    titleColor,
                },

                grid: {
                  display: false,

                  drawOnChartArea:
                    false,
                },
              },
            },
          },
        }
      );

    return () => {
      if (
        gasChartInstance.current
      ) {
        gasChartInstance.current.destroy();

        gasChartInstance.current =
          null;
      }
    };
  }, [
    airQualityData,
    isDark,
  ]);

  /*
   * =========================================================
   * FILTER BUTTON
   * =========================================================
   */

  function handleFilter() {
    if (!selectedDate) {
      return;
    }

    if (
      startTime &&
      endTime &&
      startTime > endTime
    ) {
      setError(
        "Waktu mulai tidak boleh lebih besar dari waktu selesai."
      );

      return;
    }

    setError("");

    loadAirQuality();
  }

  /*
   * =========================================================
   * PAGINATION
   * =========================================================
   */

  const totalPages =
    Math.ceil(
      airQualityData.length /
        ROWS_PER_PAGE
    );

  const startIndex =
    (currentPage - 1) *
    ROWS_PER_PAGE;

  const endIndex =
    startIndex +
    ROWS_PER_PAGE;

  const pageData =
    airQualityData.slice(
      startIndex,
      endIndex
    );

  function getPaginationPages(
    current: number,
    total: number
  ): (number | "...")[] {
    const pages: (
      | number
      | "..."
    )[] = [];

    if (total <= 7) {
      for (
        let i = 1;
        i <= total;
        i++
      ) {
        pages.push(i);
      }

      return pages;
    }

    pages.push(1);

    if (current > 4) {
      pages.push("...");
    }

    const start = Math.max(
      2,
      current - 1
    );

    const end = Math.min(
      total - 1,
      current + 1
    );

    for (
      let i = start;
      i <= end;
      i++
    ) {
      pages.push(i);
    }

    if (
      current <
      total - 3
    ) {
      pages.push("...");
    }

    pages.push(total);

    return pages;
  }

  function changePage(
    page: number
  ) {
    setCurrentPage(page);

    setTimeout(() => {
      const tableCard =
        document.querySelector(
          ".aq-table-card"
        );

      if (tableCard) {
        const top =
          (tableCard as HTMLElement)
            .offsetTop - 20;

        window.scrollTo({
          top,
          behavior: "smooth",
        });
      }
    }, 0);
  }

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  return (
    <MainLayout>
      <div className="air-quality-page">

        <div className="aq-container">

          {/* ==================================================
                     HEADER
                ================================================== */}

                <div className="page-heading">
                  <div>
                    <span className="eyebrow">Monitoring Kualitas Udara</span>
                    <h2>Kualitas Udara Lidah Wetan</h2>
                    <p>Monitoring Kondisi udara Lingkungan Direktorat</p>
                  </div>
                  
                </div>

          {/* FILTER */}

          <div className="aq-card aq-filter-card aq-shadow aq-mb-4">

            <div className="aq-card-body">

              <div className="aq-filter-grid">

                <div className="aq-field">

                  <label
                    htmlFor="dateSelect"
                    className="aq-form-label aq-fw-semibold"
                  >
                    <i className="bi bi-calendar3 aq-icon-spacing"></i>
                    Tanggal
                  </label>

                  <select
                    id="dateSelect"
                    className="aq-form-select"
                    value={selectedDate}
                    onChange={(event) =>
                      setSelectedDate(
                        event.target.value
                      )
                    }
                    disabled={
                      loadingDates
                    }
                  >
                    {loadingDates ? (
                      <option value="">
                        Memuat tanggal...
                      </option>
                    ) : (
                      availableDates.map(
                        (date) => (
                          <option
                            key={date}
                            value={date}
                          >
                            {formatDate(
                              date
                            )}
                          </option>
                        )
                      )
                    )}
                  </select>

                </div>

                <div className="aq-field">

                  <label
                    htmlFor="startTime"
                    className="aq-form-label aq-fw-semibold"
                  >
                    <i className="bi bi-clock aq-icon-spacing"></i>
                    Dari Jam
                  </label>

                  <input
                    type="time"
                    id="startTime"
                    className="aq-form-control"
                    value={startTime}
                    onChange={(event) =>
                      setStartTime(
                        event.target.value
                      )
                    }
                  />

                </div>

                <div className="aq-field">

                  <label
                    htmlFor="endTime"
                    className="aq-form-label aq-fw-semibold"
                  >
                    <i className="bi bi-clock-history aq-icon-spacing"></i>
                    Sampai Jam
                  </label>

                  <input
                    type="time"
                    id="endTime"
                    className="aq-form-control"
                    value={endTime}
                    onChange={(event) =>
                      setEndTime(
                        event.target.value
                      )
                    }
                  />

                </div>

                <div className="aq-field">

                  <button
                    id="filterButton"
                    className="aq-btn aq-btn-primary aq-btn-full"
                    type="button"
                    onClick={
                      handleFilter
                    }
                    disabled={
                      loadingData ||
                      !selectedDate
                    }
                  >
                    {loadingData ? (
                      <>
                        <span
                          className="aq-spinner aq-spinner-sm aq-spinner-spacing"
                          aria-hidden="true"
                        ></span>

                        Memuat
                      </>
                    ) : (
                      <>
                        <i className="bi bi-search aq-icon-spacing"></i>

                        Tampilkan
                      </>
                    )}
                  </button>

                </div>

              </div>

            </div>

          </div>

          {/* INFO */}

          <div className="aq-card aq-info-card aq-shadow aq-mb-4">

            <div className="aq-card-body">

              <div className="aq-info-grid">

                <div>

                  <small className="aq-text-muted">
                    Tanggal
                  </small>

                  <div className="aq-fw-bold">
                    {selectedDateLabel}
                  </div>

                </div>

                <div>

                  <small className="aq-text-muted">
                    Rentang Waktu
                  </small>

                  <div className="aq-fw-bold">
                    {selectedTimeLabel}
                  </div>

                </div>

                <div>

                  <small className="aq-text-muted">
                    Update Terakhir
                  </small>

                  <div className="aq-fw-bold">
                    {latest?.timestamp
                      ? formatTimeAMPM(
                          latest.timestamp
                        )
                      : "--.--"}
                  </div>

                </div>

              </div>

            </div>

          </div>

          {/* SENSOR */}

          <div className="aq-sensor-grid aq-mb-4">

            <SensorCard
              title="PM1.0"
              value={formatNumber(
                latest?.pm01
              )}
              unit="µg/m³"
            />

            <SensorCard
              title="PM2.5"
              value={formatNumber(
                latest?.pm02
              )}
              unit="µg/m³"
            />

            <SensorCard
              title="PM10"
              value={formatNumber(
                latest?.pm10
              )}
              unit="µg/m³"
            />

            <SensorCard
              title="Temperature"
              value={formatNumber(
                latest?.temperature
              )}
              unit="°C"
            />

            <SensorCard
              title="Humidity"
              value={formatNumber(
                latest?.humidity
              )}
              unit="%"
            />

            <SensorCard
              title="CO₂"
              value={formatNumber(
                latest?.co2
              )}
              unit="ppm"
            />

            <SensorCard
              title="TVOC"
              value={formatNumber(
                latest?.tvoc
              )}
              unit="ppb"
            />

            <SensorCard
              title="NOx Index"
              value={formatNumber(
                latest?.nox_index
              )}
              unit="Index"
            />

          </div>

          {/* PM CHART */}

          <ChartCard
            icon="bi-graph-up"
            title="Grafik Particulate Matter"
          >
            <canvas
              ref={pmChartRef}
            ></canvas>
          </ChartCard>

          {/* ENVIRONMENT CHART */}

          <ChartCard
            icon="bi-thermometer-half"
            title="Grafik Suhu dan Kelembapan"
          >
            <canvas
              ref={environmentChartRef}
            ></canvas>
          </ChartCard>

          {/* GAS CHART */}

          <ChartCard
            icon="bi-cloud-haze2"
            title="Grafik Gas"
          >
            <canvas
              ref={gasChartRef}
            ></canvas>
          </ChartCard>

          {/* TABLE */}

          <div className="aq-card aq-table-card aq-shadow aq-mb-4">
            <div className="aq-card-header">
              <div>
                <i className="bi bi-table aq-icon-spacing"></i>
                Riwayat Kualitas Udara
              </div>

              <button
                type="button"
                className="aq-btn aq-btn-success"
                onClick={() =>
                  downloadCSV(
                    airQualityData,
                    `air-quality-${selectedDate}.csv`
                  )
                }
                disabled={
                  loadingData ||
                  airQualityData.length === 0
                }
              >
                <i className="bi bi-download aq-icon-spacing"></i>
                Download CSV
              </button>
            </div>

            <div className="aq-card-body">

              <div className="ussc-table-scroll aq-table-responsive">

                <table className="ussc-data-table aq-table">

                  <thead>

                    <tr>
                      <th>No</th>
                      <th>Waktu</th>
                      <th>PM1.0</th>
                      <th>PM2.5</th>
                      <th>PM10</th>
                      <th>Temperature</th>
                      <th>Humidity</th>
                      <th>CO₂</th>
                      <th>TVOC</th>
                      <th>TVOC Index</th>
                      <th>NOx Index</th>
                      <th>WiFi</th>
                    </tr>

                  </thead>

                  <tbody>

                    {loadingData ? (

                      <tr>

                        <td
                          colSpan={12}
                          className="aq-text-center"
                        >
                          <span className="aq-spinner aq-spinner-sm aq-spinner-spacing"></span>

                          Memuat data...
                        </td>

                      </tr>

                    ) : pageData.length === 0 ? (

                      <tr>

                        <td
                          colSpan={12}
                          className="aq-text-center aq-text-muted"
                        >
                          Tidak ada data pada periode yang dipilih
                        </td>

                      </tr>

                    ) : (

                      pageData.map(
                        (
                          row,
                          index
                        ) => {

                          const number =
                            startIndex +
                            index +
                            1;

                          return (
                            <tr
                              key={`${row.timestamp}-${number}`}
                            >

                              <td>
                                {number}
                              </td>

                              <td>
                                {formatTime(
                                  row.timestamp
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.pm01
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.pm02
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.pm10
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.temperature
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.humidity
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.co2
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.tvoc
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.tvoc_index
                                )}
                              </td>

                              <td>
                                {formatNumber(
                                  row.nox_index
                                )}
                              </td>

                              <td>
                                {formatWifi(
                                  row.wifi
                                )}
                              </td>

                            </tr>
                          );
                        }
                      )

                    )}

                  </tbody>

                </table>

              </div>

              

              {totalPages > 1 && (

                <div className="aq-pagination">

                  <button
                    type="button"
                    className="aq-btn aq-btn-sm aq-btn-outline-primary"
                    disabled={
                      currentPage === 1
                    }
                    onClick={() =>
                      changePage(
                        currentPage - 1
                      )
                    }
                  >
                    ←
                  </button>

                  {getPaginationPages(
                    currentPage,
                    totalPages
                  ).map(
                    (
                      page,
                      index
                    ) => {

                      if (
                        page === "..."
                      ) {
                        return (
                          <span
                            key={`ellipsis-${index}`}
                            className="aq-pagination-ellipsis"
                          >
                            ...
                          </span>
                        );
                      }

                      return (
                        <button
                          key={page}
                          type="button"
                          className={`aq-btn aq-btn-sm aq-btn-outline-primary ${
                            page ===
                            currentPage
                              ? "active"
                              : ""
                          }`}
                          onClick={() =>
                            changePage(
                              page
                            )
                          }
                        >
                          {page}
                        </button>
                      );
                    }
                  )}

                  <button
                    type="button"
                    className="aq-btn aq-btn-sm aq-btn-outline-primary"
                    disabled={
                      currentPage ===
                      totalPages
                    }
                    onClick={() =>
                      changePage(
                        currentPage + 1
                      )
                    }
                  >
                    →
                  </button>

                </div>

              )}

            </div>

          </div> 
          

        </div>

      </div>
    </MainLayout>
  );
}

/*
 * =========================================================
 * SENSOR CARD
 * =========================================================
 */

function SensorCard({
  title,
  value,
  unit,
}: {
  title: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="aq-sensor-item">

      <div className="aq-card aq-data-card aq-shadow">

        <div className="aq-card-body">

          <h6>{title}</h6>

          <h2>{value}</h2>

          <span>{unit}</span>

        </div>

      </div>

    </div>
  );
}

/*
 * =========================================================
 * CHART CARD
 * =========================================================
 */

function ChartCard({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="aq-card aq-chart-card aq-shadow aq-mb-4">

      <div className="aq-card-header aq-chart-header">

      <div className="aq-chart-title">
        <i
          className={`bi ${icon} aq-icon-spacing`}
        ></i>

        {title}
      </div>

    </div>

      <div className="aq-card-body">

        <div className="aq-chart-container">
          {children}
        </div>

      </div>

    </div>
  );
}

/*
 * =========================================================
 * CHART OPTIONS
 * =========================================================
 */

function getChartOptions(
  unit: string,
  isDark: boolean
) {
  const gridColor = isDark
    ? "rgba(203, 213, 225, 0.30)"
    : "rgba(100, 116, 139, 0.45)";

  const textColor = isDark
    ? "#cbd5e1"
    : "#475569";

  const titleColor = isDark
    ? "#e2e8f0"
    : "#334155";

  return {
    responsive: true,

    maintainAspectRatio: false,

    animation: false as const,

    interaction: {
      mode: "index" as const,
      intersect: false,
    },

    plugins: {
      legend: {
      display: true,
      labels: {
        color: textColor,
        usePointStyle: true,
        font: { size: 12 },
        padding: 16,
      },
    },

      tooltip: {
        enabled: true,
      },
    },

    scales: {
      x: {
        ticks: {
          color: textColor,
        },

        title: {
          display: true,

          text: "Waktu",

          color: titleColor,
        },

        grid: {
          display: true,

          color: gridColor,

          lineWidth: 1.5,

          drawTicks: true,
        },
      },

      y: {
        type: "linear" as const,

        beginAtZero: true,

        min: 0,

        ticks: {
          color: textColor,
        },

        title: {
          display: true,

          text: unit,

          color: titleColor,
        },

        grid: {
          display: true,

          color: gridColor,

          lineWidth: 1.5,

          drawTicks: true,
        },
      },
    },
  };
}