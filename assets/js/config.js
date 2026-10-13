/**
 * =========================================================
 * APP CONFIGURATION (FRONTEND)
 * File ini mengatur endpoint API dan parameter aplikasi.
 * CATATAN KEAMANAN: Jangan letakkan password/kunci rahasia server di sini
 * karena file ini dapat dibaca oleh browser publik.
 * =========================================================
 */

const APP_CONFIG = {
    // Mode koneksi backend Flask
    API_BASE_URL: window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:5000"
        : "",

    // Interval fetch data realtime (dalam milidetik)
    POLLING_INTERVALS: {
        AIR_QUALITY: 10000,    // 10 detik
        TRAFFIC: 10000,        // 10 detik
        FLOOD: 2000,           // 2 detik (fallback polling)
        DASHBOARD: 2000       // 2 detik
    },

    // Status simulator fallback jika MQTT/Backend tidak aktif
    ENABLE_FALLBACK_SIMULATOR: false,

    // API Cuaca Kota Surabaya (Open-Meteo)
    WEATHER_SURABAYA_URL: "https://api.open-meteo.com/v1/forecast?latitude=-7.31&longitude=112.73&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FJakarta",

    // Endpoints API Server Flask
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
        EXPORT_DOWNLOAD: "/api/export/download"
    }
};

// Freeze agar konfigurasi tidak sengaja termutasi di runtime
Object.freeze(APP_CONFIG);
Object.freeze(APP_CONFIG.POLLING_INTERVALS);
Object.freeze(APP_CONFIG.ENDPOINTS);
