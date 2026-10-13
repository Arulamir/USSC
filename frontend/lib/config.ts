export const APP_CONFIG = {
  API_BASE_URL: "",

  POLLING_INTERVALS: {
    AIR_QUALITY: 10000,
    TRAFFIC: 10000,
    FLOOD: 2000,
    DASHBOARD: 2000,
  },

  ENABLE_FALLBACK_SIMULATOR: false,

  WEATHER_SURABAYA_URL:
    "https://api.open-meteo.com/v1/forecast?latitude=-7.31&longitude=112.73&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FJakarta",

  ENDPOINTS: {
    AIR_QUALITY: "/api/airquality",
    TRAFFIC_GRAFIK: "/api/traffic-grafik",
    DASHBOARD: "/api/dashboard",
    CHART: "/api/chart",
    TABLE: "/api/table",
    FLOOD: "/api/flood",
    FLOOD_STREAM: "/api/flood/stream",
    EXPORT_DATES: "/api/export/dates",
    EXPORT_CHECK: "/api/export/check",
    EXPORT_DOWNLOAD: "/api/export/download",
  },
} as const;